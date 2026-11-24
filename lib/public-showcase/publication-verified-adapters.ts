import "server-only";

import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { actorFromVerifiedUserId, isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import type { PublicationMediaEvidence, AdminPublicationStore, AdminPublicationTransaction, AdminPublicationWork } from "./admin-publication-service";
import { isCoverGeneration, isCoverSlug, type CoverAddress } from "./cover-path";
import { COVER_MAX_BYTES, type CoverRow, type CoverStore } from "./cover-source";
import { PLAYBACK_CHUNK_BYTES, readVerifiedPlaybackChunk, type PlaybackRow, type PlaybackStore } from "./playback-source";
import { isPlaybackExtension, playbackFormats } from "./playback-path";
import { openVerifiedPublicationDatabase } from "./publication-db-preflight";
import type { PublicationRuntimeOptions } from "./publication-runtime-config";
import { readApprovedSnapshot, ShowcaseSourceError } from "./showcase-source";

type DatabaseOptions = NonNullable<Parameters<typeof openVerifiedPublicationDatabase>[0]>;
type Connections = Extract<Awaited<ReturnType<typeof openVerifiedPublicationDatabase>>, { mode: "verified" }>;
type Query = Parameters<Parameters<Connections["withAdmin"]>[0]>[0];
type Entry = NonNullable<Awaited<ReturnType<AdminPublicationTransaction["findRequest"]>>>;
type RightsRow = { rights_ref: string; mode: string; expires_ms: string | null };
type RightsState = { frozen: (RightsRow & { manifest: unknown }) | null; activation: (RightsRow & { approved_ms: string }) | null };
type Options = Readonly<{
  database: DatabaseOptions;
  adminActorId: string;
  rightsReader: Readonly<{ schema: string; name: string }>;
  readAdminCover(ownerId: string, key: string, options: { maxBytes: number; signal: AbortSignal }): Promise<Uint8Array | null>;
  readPublicCover: CoverStore["readObject"];
  readPublicMediaRange?: PlaybackStore["readRange"];
}>;

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
const sha256 = /^[a-f0-9]{64}$/;
const coverKey = /^([^/]+)\/([^/]+)\/([a-f0-9]{64})\.webp$/;

function requireContract(value: unknown): asserts value {
  if (!value) throw new Error("Publication adapter contract rejected");
}

async function bindActor(query: Query, actorId: string) {
  await query("SELECT set_config('t293.actor',$1,true)", [actorId]);
  const { rows } = await query<{ actor: string | null }>("SELECT t293.actor()::text AS actor");
  requireContract(rows[0]?.actor === actorId);
}

function sameWindow(row: RightsRow, reference: string, expiresAtMs: number | null) {
  return row.rights_ref === reference && (expiresAtMs === null
    ? row.mode === "perpetual" && row.expires_ms === null
    : Number.isSafeInteger(expiresAtMs) && row.mode === "timed" && row.expires_ms === String(expiresAtMs));
}

async function readRights(query: Query, rightsSql: string, slug: string, generation: string) {
  const { rows } = await query<{ state: RightsState }>(rightsSql, [slug, generation]);
  const state = rows[0]?.state;
  requireContract(rows.length === 1 && state && typeof state === "object" && "frozen" in state && "activation" in state);
  return state;
}

function adminStore(db: Connections, actorId: string, rightsSql: string, readAdminCover: Options["readAdminCover"], readRange?: PlaybackStore["readRange"]): AdminPublicationStore {
  return {
    transaction: operation => db.withAdmin(async query => {
      await query("BEGIN");
      try {
        await bindActor(query, actorId);
        let locked: AdminPublicationWork | null = null;
        let requestId: string | undefined;
        let evidence: { media?: PublicationMediaEvidence; cover: { sha: string; sizeBytes: number }; rights: { expiresAtMs: number | null } } | undefined;
        const sameActor = (actor: VerifiedActor) => isVerifiedActor(actor) && actor.id === actorId;
        const publisher = async () => (await query<{ allowed: boolean }>("SELECT t293.can_publish() AS allowed")).rows[0]?.allowed === true;
        const record = async (entry: Entry, generation: string | null) => {
          requireContract(locked && requestId);
          const result = await query(`INSERT INTO t293.app_requests(owner_id,request_id,slug,entry,manifest_generation)
            VALUES ($1,$2,$3,$4,$5)`, [actorId, requestId, locked.slug, entry, generation]);
          requireContract(result.rowCount === 1);
        };

        const result = await operation({
          isPublisher: async actor => sameActor(actor) && await publisher(),
          async listOwnedWorks(actor) {
            requireContract(sameActor(actor));
            return (await query<{ state: AdminPublicationWork }>("SELECT state FROM t293.works WHERE owner_id=$1 ORDER BY slug", [actorId]))
              .rows.map(row => row.state);
          },
          async findOwnedWork(actor, slug) {
            requireContract(sameActor(actor));
            const result = await query<{ state: AdminPublicationWork }>("SELECT state FROM t293.works WHERE owner_id=$1 AND slug=$2 FOR UPDATE", [actorId, slug]);
            locked = result.rows[0]?.state ?? null;
            return locked;
          },
          async findRequest(actor, id) {
            requireContract(sameActor(actor) && locked && requestId === undefined);
            requestId = id;
            await query("SELECT pg_advisory_xact_lock(hashtextextended($1,293))", [`${actorId}/${id}`]);
            const { rows: [decision] } = await query<{ allowed: boolean; entry: Entry | null }>(`
              WITH grant_state AS MATERIALIZED (SELECT t293.can_publish() AS allowed)
              SELECT allowed, CASE WHEN allowed THEN (SELECT entry FROM t293.app_requests WHERE owner_id=$1 AND request_id=$2) END AS entry
              FROM grant_state`, [actorId, id]);
            requireContract(decision?.allowed === true);
            return decision.entry;
          },
          async readEvidence(actor, work) {
            requireContract(sameActor(actor) && work.ownerId === actorId);
            const { rows } = await query<{ value: typeof evidence }>("SELECT value FROM t293.evidence WHERE owner_id=$1 AND slug=$2", [actorId, work.slug]);
            evidence = rows[0]?.value;
            return evidence;
          },
          async readCover(actor, key, maxBytes) {
            requireContract(sameActor(actor) && locked && requestId && Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= COVER_MAX_BYTES);
            const match = coverKey.exec(key);
            requireContract(match && match[1] === locked.slug && match[2] === locked.review?.generation && match[3] === evidence?.cover.sha);
            const signal = AbortSignal.timeout(5000);
            const cancelled = Promise.withResolvers<never>();
            const listener = addAbortListener(signal, () => cancelled.reject(new Error("Publication cover read timed out")));
            try {
              const bytes = await Promise.race([readAdminCover(actorId, key, { maxBytes, signal }), cancelled.promise]);
              if (bytes === null) return null;
              requireContract(bytes instanceof Uint8Array && bytes.byteLength <= maxBytes);
              return Uint8Array.from(bytes);
            } finally { listener[Symbol.dispose](); }
          },
          ...(readRange ? { async verifyMedia(actor: VerifiedActor, row: PlaybackRow) {
            const m = evidence?.media;
            requireContract(sameActor(actor) && locked && requestId && m && locked.artifact.sha === m.sha &&
              row.objectKey === `${locked.slug}/${locked.review?.generation}/${m.sha}.${m.ext}` &&
              row.objectKey === m.objectKey && row.version === m.version && row.sizeBytes === m.sizeBytes &&
              row.sha === m.sha && row.ext === m.ext && row.mime === m.mime);
            const hash = createHash("sha256");
            for (let start = 0; start < row.sizeBytes; start += PLAYBACK_CHUNK_BYTES) {
              const end = Math.min(row.sizeBytes - 1, start + PLAYBACK_CHUNK_BYTES - 1);
              const bytes = await readVerifiedPlaybackChunk({ readRange }, row, start, end, AbortSignal.timeout(5000));
              hash.update(bytes);
            }
            return hash.digest("hex") === m.sha;
          } } : {}),
          async saveFailure(actor, id, entry) {
            requireContract(sameActor(actor) && id === requestId && await publisher());
            await record(entry, null);
          },
          async save({ work, request, audit }) {
            requireContract(locked && work.slug === locked.slug && work.id === locked.id && audit.workId === work.id &&
              work.ownerId === actorId && audit.actorId === actorId && audit.requestId === requestId);
            const { command, generation, rightsReference } = audit;
            let manifest: unknown;
            if (command === "prepare") {
              requireContract(evidence);
              const display = Object.fromEntries(Object.entries(work.display as Record<string, unknown>)
                .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
              manifest = { sourceId: audit.artifactId, sourceRevision: audit.artifactRevision, sourceSha: work.artifact.sha,
                rightsRef: rightsReference, display, coverSha: evidence.cover.sha, coverBytes: evidence.cover.sizeBytes,
                ...(evidence.media ? { mediaKind: evidence.media.kind, mediaExt: evidence.media.ext, mediaMime: evidence.media.mime,
                  mediaBytes: evidence.media.sizeBytes, mediaSha: evidence.media.sha, mediaVersion: evidence.media.version } : {}) };
              await query("INSERT INTO t293.manifests VALUES ($1,$2,$3,$4)", [actorId, work.slug, generation, manifest]);
            }
            const expected = String(BigInt(audit.version) - 1n);
            const { rows: [applied] } = await query<{ outcome: unknown }>("SELECT t295.apply($1,$2,$3,$4,$5,$6) AS outcome",
              [requestId, command, work.slug, expected, command === "prepare" ? null : generation, command === "prepare" ? rightsReference : null]);
            requireContract(isDeepStrictEqual(applied?.outcome, request.outcome));
            let state = work;
            let recorded = audit;
            if (command === "prepare") {
              const rights = await readRights(query, rightsSql, work.slug, generation);
              requireContract(evidence && rights.frozen && rights.activation === null &&
                sameWindow(rights.frozen, rightsReference, evidence.rights.expiresAtMs) && isDeepStrictEqual(rights.frozen.manifest, manifest));
            } else {
              const { rows: [clock] } = await query<{ approved_ms: string | null }>("SELECT t293.approved_ms($1,$2) AS approved_ms", [work.slug, generation]);
              if (command === "revoke") {
                requireContract(clock?.approved_ms === null);
              } else {
                const approvedMs = Number(clock?.approved_ms);
                const rights = await readRights(query, rightsSql, work.slug, generation);
                const { rows: [prepared] } = await query<{ value: unknown }>("SELECT value FROM t293.manifests WHERE owner_id=$1 AND slug=$2 AND generation=$3", [actorId, work.slug, generation]);
                const active = work.active;
                requireContract(active && rights.frozen && rights.activation && Number.isSafeInteger(approvedMs) && approvedMs > 0 &&
                  isDeepStrictEqual(rights.frozen.manifest, prepared?.value) && rights.activation.approved_ms === String(approvedMs) &&
                  sameWindow(rights.frozen, active.rightsReference, active.rightsUntilMs) &&
                  sameWindow(rights.activation, active.rightsReference, active.rightsUntilMs) &&
                  (active.rightsUntilMs === null || approvedMs < active.rightsUntilMs));
                state = { ...work, active: { ...active, approvedMs } };
                recorded = { ...audit, atMs: approvedMs };
              }
            }
            const updated = await query("UPDATE t293.works SET state=$3 WHERE owner_id=$1 AND slug=$2 AND state->>'revision'=$4",
              [actorId, work.slug, state, locked.revision]);
            requireContract(updated.rowCount === 1);
            await record(request, command === "revoke" ? null : generation);
            await query("INSERT INTO t293.audit VALUES ($1,$2,$3)", [actorId, requestId, recorded]);
          },
        });
        await query("COMMIT");
        return result;
      } catch (error) {
        await query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }),
  };
}

function publicStores(db: Connections, readPrivateCover: Options["readPublicCover"], readRange?: PlaybackStore["readRange"]) {
  const listApproved = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    return db.withList(async query => {
      signal.throwIfAborted();
      const { rows } = await query<{ value: unknown }>("SELECT t295.list_approved() AS value");
      signal.throwIfAborted();
      if (rows.length !== 1) throw new ShowcaseSourceError("contract");
      return rows[0].value;
    });
  };
  const findCover: CoverStore["findCover"] = async (address: CoverAddress, signal) => {
    if (!isCoverSlug(address.slug) || !isCoverGeneration(address.generation)) throw new ShowcaseSourceError("contract");
    signal.throwIfAborted();
    return db.withCover(async query => {
      signal.throwIfAborted();
      const { rows } = await query<{ object_key: string; mime: string; size_bytes: number; sha: string }>(
        "SELECT object_key,mime,size_bytes,sha FROM t295.find_cover($1::text,$2::bigint)", [address.slug, address.generation]);
      signal.throwIfAborted();
      if (!rows.length) return null;
      const { object_key: objectKey, mime, size_bytes: sizeBytes, sha } = rows[0];
      if (rows.length !== 1 || typeof sha !== "string" || !sha256.test(sha) || objectKey !== `${address.slug}/${address.generation}/${sha}.webp` ||
          mime !== "image/webp" || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > COVER_MAX_BYTES) throw new ShowcaseSourceError("contract");
      return { objectKey, mime, sizeBytes, sha };
    });
  };
  const media: PlaybackStore | undefined = readRange && {
    async findMedia(address, signal) {
      if (!isCoverSlug(address.slug) || !isCoverGeneration(address.generation)) throw new ShowcaseSourceError("contract");
      signal.throwIfAborted();
      return db.withCover(async query => {
        signal.throwIfAborted();
        const { rows } = await query<{ object_key: string; sha: string; ext: string; mime: string; size_bytes: number; version: string }>(
          "SELECT object_key,sha,ext,mime,size_bytes,version FROM t295.find_media($1::text,$2::bigint)", [address.slug, address.generation]);
        signal.throwIfAborted();
        if (rows.length === 0) return null;
        const { object_key: objectKey, sha, ext, mime, size_bytes: sizeBytes, version } = rows[0];
        if (rows.length !== 1 || typeof sha !== "string" || !sha256.test(sha) || !isPlaybackExtension(ext) ||
            mime !== playbackFormats[ext].mime || objectKey !== `${address.slug}/${address.generation}/${sha}.${ext}` ||
            !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > (playbackFormats[ext].kind === "video" ? 500 : 50) * 1024 ** 2 ||
            typeof version !== "string" || !/^"[\x21\x23-\x7e]{1,128}"$/.test(version)) throw new ShowcaseSourceError("contract");
        return { objectKey, sha, ext, mime, sizeBytes, version };
      });
    },
    readRange,
  };
  const store: CoverStore = {
    ...(media ? { media } : {}),
    findCover,
    async readObject(key, { maxBytes, signal }) {
      const match = coverKey.exec(key);
      if (!match || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > COVER_MAX_BYTES) throw new ShowcaseSourceError("contract");
      const row = await findCover({ slug: match[1], generation: match[2] }, signal);
      if (!row || row.objectKey !== key || row.sizeBytes > maxBytes) throw new ShowcaseSourceError("permission");
      signal.throwIfAborted();
      const bytes = await readPrivateCover(key, { maxBytes: row.sizeBytes, signal });
      signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.sizeBytes) throw new ShowcaseSourceError("contract");
      return Uint8Array.from(bytes);
    },
    async confirmCover(address, expected, signal) {
      const current: CoverRow | null = await findCover(address, signal);
      return current !== null && isDeepStrictEqual(current, expected);
    },
  };
  return { showcaseSource: { mode: "active", store: { listApproved } }, coverSource: { mode: "active", store } } as const;
}

/** Create a single-lifetime configuration for the shared publication assembly. */
export function createVerifiedPublicationRuntimeOptions(options?: Options): PublicationRuntimeOptions {
  if (!options?.database?.target || !options.database.logins || !options.rightsReader ||
      typeof options.readAdminCover !== "function" || typeof options.readPublicCover !== "function") return;
  const { schema, name } = options.rightsReader;
  if (typeof schema !== "string" || typeof name !== "string" || !identifier.test(schema) || !identifier.test(name)) return;
  let actorId: string;
  try { actorId = actorFromVerifiedUserId(options.adminActorId).id; } catch { return; }
  const { database: configured, readAdminCover, readPublicCover, readPublicMediaRange } = options;
  const config = { ...configured, target: { ...configured.target }, logins: {
    admin: { ...configured.logins.admin }, list: { ...configured.logins.list }, cover: { ...configured.logins.cover },
  } };
  const { host, port, database, systemIdentifier } = config.target;
  const approvedTarget = JSON.stringify([host, port, database, systemIdentifier]);
  const rightsSql = `SELECT "${schema}"."${name}"($1::text,$2::bigint) AS state`;
  let opening: ReturnType<typeof open> | undefined;

  async function open() {
    const db = await openVerifiedPublicationDatabase(config);
    requireContract(db.mode === "verified");
    try {
      requireContract(db.targetId === approvedTarget);
      await db.withAdmin(async query => {
        await query("BEGIN");
        try {
          await bindActor(query, actorId);
          const { rows } = await query<{ allowed: boolean }>(`SELECT p.prosecdef AND r.rolname='t295_writer'
            AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
            AND NOT has_function_privilege($3::name,p.oid,'EXECUTE') AND NOT has_function_privilege($4::name,p.oid,'EXECUTE') AS allowed
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
            WHERE n.nspname=$1 AND p.proname=$2 AND oidvectortypes(p.proargtypes)='text, bigint' AND p.prorettype='jsonb'::regtype`,
          [schema, name, config.logins.list.name, config.logins.cover.name]);
          requireContract(rows.length === 1 && rows[0].allowed === true);
          await readRights(query, rightsSql, "publication-config-probe", "1");
          await query("COMMIT");
        } catch (error) { await query("ROLLBACK").catch(() => undefined); throw error; }
      });
      // An older sealed catalog can continue to serve its image feed. The catalog
      // verifier independently pins the definition and grants for each supported version.
      const playback = readPublicMediaRange && await db.withCover(async query => {
        const { rows: [row] } = await query<{ ready: boolean }>(`SELECT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          JOIN pg_roles o ON p.proowner=o.oid WHERE n.nspname='t295' AND p.proname='find_media' AND oidvectortypes(p.proargtypes)='text, bigint'
          AND o.rolname='t295_file_owner' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
          AND has_function_privilege(p.oid,'EXECUTE') AND NOT has_function_privilege($1::name,p.oid,'EXECUTE')
          AND NOT has_function_privilege($2::name,p.oid,'EXECUTE')) AS ready`, [config.logins.admin.name, config.logins.list.name]);
        return row.ready ? readPublicMediaRange : undefined;
      });
      const publicProviders = publicStores(db, readPublicCover, playback);
      const signal = AbortSignal.timeout(5000);
      readApprovedSnapshot(await publicProviders.showcaseSource.store.listApproved(signal));
      await publicProviders.coverSource.store.findCover({ slug: "publication-config-probe", generation: "1" }, signal);
      return { db, publicProviders, playback };
    } catch (error) { await db.close().catch(() => undefined); throw error; }
  }

  return Object.freeze({
    approvedTarget,
    async openAdmin() {
      const { db, playback } = await (opening ??= open());
      return { verifiedTarget: db.targetId, store: adminStore(db, actorId, rightsSql, readAdminCover, playback), close: db.close };
    },
    async openPublic() {
      const { db, publicProviders } = await (opening ??= open());
      return { ...publicProviders, verifiedListTarget: db.targetId, verifiedCoverTarget: db.targetId, close: db.close };
    },
  });
}
