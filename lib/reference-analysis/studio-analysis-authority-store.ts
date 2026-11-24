import "server-only";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { ownedStorageAsset } from "../storage/supabase/object-key";
import { referenceFileByteLimit } from "./input";

const database = "dream_test_t281";
const login = "t307_authority_login";
const reader = "t307_authority_reader";
const id = z.guid().transform(value => value.toLowerCase());
const selection = z.strictObject({ projectId: id, assetId: z.uuidv7().transform(value => value.toLowerCase()) });
const token = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const generation = z.string().refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);
const positive = generation.refine(value => value !== "0");
const rowSchema = z.strictObject({
  ownerId: id, ...selection.shape, storeId: token, restoreGeneration: token, sourceGeneration: token,
  linkGeneration: generation, ownerPermissionGeneration: positive, scopePermissionGeneration: positive,
  storageGeneration: positive, verifiedStorageGeneration: positive,
  kind: z.enum(["image", "video"]), mime: z.string(), objectKey: z.string(), sha256: z.string(),
  sizeBytes: positive.transform(Number).pipe(z.number().int().positive().safe()),
});

type Options = Readonly<{
  profile: "t307-loopback-fixture";
  port: number;
  password: string;
  bucket: string;
  maxBytes: number;
  timeoutMs: number;
}>;

const capability = `SELECT current_database() AS db, session_user AS login, current_user AS role,
    host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('server_version_num') AS version,
    current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation,
    login_role.rolcanlogin AS login_can_login, read_role.rolcanlogin AS reader_can_login,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN (session_user, current_user)
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) AS privileged,
    pg_has_role(session_user, 'dream_api', 'MEMBER') OR pg_has_role(session_user, 'dream_worker', 'MEMBER')
      OR pg_has_role(session_user, 't281_operator', 'MEMBER') OR pg_has_role(session_user, 't281_guard', 'MEMBER') AS writer,
    (SELECT bool_and(row_security_active(source)) FROM unnest(ARRAY['dream.projects','dream.assets','dream.project_assets',
      'dream.asset_receipt_state','dream.storage_objects','dream.storage_verification_receipts','rea_t281.owner_state',
      'rea_t281.scope_state','rea_t307.asset_witness']::regclass[]) AS sources(source)) AS scoped
  FROM pg_roles AS login_role CROSS JOIN pg_roles AS read_role
  WHERE login_role.rolname = session_user AND read_role.rolname = current_user`;

// Both entry points use these joins in a single owner-scoped read snapshot.
const authority = `SELECT a.owner_id AS "ownerId", l.project_id AS "projectId", a.id AS "assetId",
    w.store_id AS "storeId", w.restore_generation AS "restoreGeneration", w.source_generation AS "sourceGeneration",
    g.link_generation::text AS "linkGeneration", u.generation::text AS "ownerPermissionGeneration",
    g.permission_generation::text AS "scopePermissionGeneration", o.active_generation::text AS "storageGeneration",
    r.generation::text AS "verifiedStorageGeneration", a.kind, a.mime, a.file_path AS "objectKey",
    a.sha256, a.size_bytes::text AS "sizeBytes"
  FROM dream.project_assets l
  JOIN dream.projects p ON p.owner_id = l.owner_id AND p.id = l.project_id
  JOIN dream.assets a ON a.owner_id = l.owner_id AND a.id = l.asset_id
  JOIN rea_t281.owner_state u ON u.owner_id = l.owner_id
  JOIN rea_t281.scope_state g ON g.owner_id = l.owner_id AND g.project_id = l.project_id AND g.asset_id = l.asset_id
  JOIN dream.asset_receipt_state s ON s.owner_id = a.owner_id AND s.asset_id = a.id
  JOIN dream.storage_objects o ON o.owner_id = s.owner_id AND o.id = s.object_id AND o.registered_asset_id = a.id
  JOIN dream.storage_verification_receipts r ON r.owner_id = s.owner_id
    AND r.id = s.current_receipt_id AND r.object_id = o.id AND r.asset_id = a.id
  JOIN rea_t307.asset_witness w ON w.owner_id = a.owner_id AND w.asset_id = a.id
    AND w.object_id = o.id AND w.identity_digest = o.identity_digest AND w.receipt_id = r.id AND w.storage_generation = r.generation
  JOIN rea_t307.restore_witness e ON e.singleton AND e.store_id = w.store_id AND e.restore_generation = w.restore_generation
  WHERE l.owner_id = $1 AND l.purpose = 'rea-reference'
    AND ($2::uuid IS NULL OR (l.project_id = $2 AND l.asset_id = $3::uuid))
    AND p.archived_at IS NULL AND a.archived_at IS NULL AND a.is_mock = 0 AND a.kind IN ('image', 'video')
    AND u.enabled AND u.generation > 0 AND g.active AND g.permission_generation > 0
    AND s.status = 'ready' AND o.lifecycle = 'registered' AND o.bucket = $4
    AND o.object_key = a.file_path AND o.sha256 = a.sha256 AND o.size_bytes = a.size_bytes AND a.size_bytes <= $5::bigint
    AND o.kind = a.kind AND o.mime = a.mime AND r.identity_digest = o.identity_digest
    AND r.generation = o.active_generation AND r.verified_at <= clock_timestamp()
    AND LEAST(r.not_after, e.not_after, w.not_after) > clock_timestamp()
  ORDER BY l.project_id, a.id`;

const unavailable = () => new Error("STUDIO_ANALYSIS_AUTHORITY_UNAVAILABLE");

async function withSnapshot<T>(pool: Pool, signal: AbortSignal, run: (client: PoolClient, signal: AbortSignal) => Promise<T>) {
  if (signal.aborted) throw unavailable();
  let lease: PoolClient | undefined;
  function release(destroy: boolean) {
    const client = lease;
    lease = undefined;
    client?.release(destroy);
  }
  const stopped = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => {
    stopped.reject(unavailable());
    release(true);
  });
  try {
    const work = async () => {
      if (signal.aborted) throw unavailable();
      const client = await pool.connect();
      lease = client;
      let committed = false;
      try {
        if (signal.aborted || client.getTransactionStatus() !== "I") throw unavailable();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        signal.throwIfAborted();
        await client.query(`SET LOCAL ROLE ${reader}`);
        signal.throwIfAborted();
        const result = await run(client, signal);
        signal.throwIfAborted();
        await client.query("COMMIT");
        if (signal.aborted || client.getTransactionStatus() !== "I") throw unavailable();
        committed = true;
        return result;
      } finally { release(!committed); }
    };
    return await Promise.race([stopped.promise, work()]);
  } catch { throw unavailable(); }
  finally { listener[Symbol.dispose](); }
}

/** The witness contract is installed only in the owned loopback fixture. No environment or legacy fallback. */
export async function openIsolatedStudioAnalysisAuthorityStore(options?: Options) {
  if (!options) return;
  const { profile, port, password, bucket, maxBytes, timeoutMs } = options;
  if (profile !== "t307-loopback-fixture" || !Number.isInteger(port) || port < 1 || port > 65535 ||
    typeof password !== "string" || !/^[a-f0-9]{48}$/.test(password) ||
    typeof bucket !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(bucket) ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return;

  const byteLimit = Math.min(referenceFileByteLimit, maxBytes);
  const pool = new Pool({ host: "127.0.0.1", port, database, user: login, password, ssl: false,
    options: "-c search_path=pg_catalog -c default_transaction_read_only=on", application_name: "t307-studio-authority",
    max: 2, statement_timeout: timeoutMs, connectionTimeoutMillis: timeoutMs });
  pool.on("error", () => {}); // pg removes broken idle connections.
  let shutdown: Promise<void> | undefined;
  const close = () => shutdown ??= pool.end();

  async function read(actor: VerifiedActor, selected?: z.infer<typeof selection>, caller?: AbortSignal) {
    if (shutdown || !isVerifiedActor(actor) || (caller !== undefined && !(caller instanceof AbortSignal))) throw unavailable();
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([deadline, caller]) : deadline;
    return withSnapshot(pool, signal, async client => {
      await client.query("SELECT set_config('dream.actor_id', $1, true)", [actor.id]);
      signal.throwIfAborted();
      const { rows } = await client.query(authority, [actor.id, selected?.projectId ?? null, selected?.assetId ?? null, bucket, byteLimit]);
      return rows.map(value => {
        const { kind, mime, objectKey, sha256, sizeBytes, ...scope } = rowSchema.parse(value);
        if (scope.ownerId !== actor.id || scope.storageGeneration !== scope.verifiedStorageGeneration ||
          (selected && (scope.projectId !== selected.projectId || scope.assetId !== selected.assetId))) throw unavailable();
        const asset = ownedStorageAsset(actor, { ownerId: scope.ownerId, id: scope.assetId, kind, mime, objectKey, sha256, sizeBytes }, byteLimit);
        return { status: "authorized", ...scope, linkActive: true, ownerEnabled: true, scopeEnabled: true, asset } as const;
      });
    });
  }

  try {
    await withSnapshot(pool, AbortSignal.timeout(timeoutMs), async (client, signal) => {
      const { rows } = await client.query(capability);
      const row = rows[0];
      if (rows.length !== 1 || row.db !== database || row.login !== login || row.role !== reader || row.host !== "127.0.0.1" ||
        row.port !== port || row.version !== "170012" || row.read_only !== "on" || row.isolation !== "repeatable read" ||
        row.login_can_login !== true || row.reader_can_login !== false || row.privileged !== false ||
        row.writer !== false || row.scoped !== true) throw unavailable();
      signal.throwIfAborted();
      await client.query(`EXPLAIN ${authority}`, ["00000000-0000-4000-8000-000000000000", null, null, bucket, byteLimit]);
    });
  } catch {
    await close().catch(() => {});
    return;
  }

  type Registration = Awaited<ReturnType<typeof read>>[number];
  function projectMaterial({ ownerId, projectId, assetId, asset }: Registration) {
    return {
      ownerId, projectId, assetId,
      label: `${asset.kind === "image" ? "등록 이미지" : "등록 영상"} · ${assetId.slice(-8)}`,
      registration: "current", analysisAllowed: true,
    } as const;
  }

  return {
    close,
    async listAnalyzableMaterials(actor: VerifiedActor) {
      const rows = await read(actor);
      return rows.map(projectMaterial);
    },
    async readMaterialSnapshots(actor: VerifiedActor, signal: AbortSignal) {
      const rows = await read(actor, undefined, signal);
      return rows.map(row => ({
        ...projectMaterial(row),
        revision: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
      }));
    },
    async readAuthority(actor: VerifiedActor, input: unknown, signal: AbortSignal) {
      const selected = selection.safeParse(input);
      if (!selected.success) return;
      const rows = await read(actor, selected.data, signal);
      if (rows.length > 1) throw unavailable();
      return rows[0];
    },
  };
}
