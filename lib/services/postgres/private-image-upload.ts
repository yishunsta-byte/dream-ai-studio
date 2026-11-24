import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { posix } from "node:path";
import { v7 } from "uuid";
import { isVerifiedActor, type VerifiedActor } from "../../db/postgres/types";

const incoming = "t367-incoming", permanent = "t367-private", policyId = "t367-local-png";
const contentType = "image/png", maxBytes = 1024 * 1024;
const ttl = 60_000, evidenceTtl = 10 * 60_000;
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const digest = (domain: string, text: string) => sha(`${domain}:v1\n${text}`);
const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = /^[0-9a-f]{64}$/;
const roles = ["t367_ingest", "t367_verify", "t367_cleanup"] as const;
type Role = typeof roles[number];
type Code = "INVALID_FILENAME" | "INVALID_RIGHTS_NOTE" | "INPUT" | "NOT_FOUND" | "CONFLICT" | "CLOSED" | "EXPIRED" | "INVALID_IMAGE" | "UNAVAILABLE";
export class ImageUploadError extends Error {
  constructor(readonly code: Code, cause?: unknown) { super(code, { cause }); }
}
const requireValue: (ok: unknown, code: Code) => asserts ok = (ok, code) => {
  if (!ok) throw new ImageUploadError(code);
};
type ObjectTarget = { bucket: string; key: string };
type Expected = Readonly<{ size: number; sha256: string }>;
type Row = { objectId: string; requestId: string; intentId: string; assetId: string; incomingKey: string; raw: string;
  expires: Date; lifecycle: "reserved" | "publication_reserved" | "registered" | "cleanup_claimed" | "tombstoned";
  revision: string; key: string | null; identityDigest: string | null; cleanupId: string | null };
type Operation = { id: string; authorization_until: Date; policy_epoch: string; policy_digest: string; claimed_at: Date;
  lease_until: Date; worker_id: string; claim_verifiers: string[]; status: string; fence: string };
type Image = { bytes: Buffer; width: number; height: number; size: number; sha256: string };
type Pools = Readonly<Record<Role, Pick<Pool, "connect">>>;

function target(row: Row): ObjectTarget { return { bucket: incoming, key: row.incomingKey }; }
function destination(row: Row, hash: string): ObjectTarget {
  const owner = row.incomingKey.split("/", 1)[0];
  return { bucket: permanent, key: `${owner}/assets/${row.assetId}/${hash}.png` };
}

// Only the owned protocol test uses this adapter. A real provider must separately
// prove equivalent immutability, write closure, and absence semantics.
function loopbackStorage(origin: string) {
  const url = new URL(origin);
  requireValue(url.origin === origin && url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port, "INPUT");
  async function call(object: ObjectTarget, method: string, query = "", bytes?: Buffer) {
    const path = object.key.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${origin}/${object.bucket}/${path}${query}`, {
      method, body: bytes && Uint8Array.from(bytes), redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(4000),
    }).catch(cause => { throw new ImageUploadError("UNAVAILABLE", cause); });
    if (response.status === 409) {
      await response.body?.cancel();
      throw new ImageUploadError("CLOSED");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImageUploadError("UNAVAILABLE");
    }
    return response;
  }
  return {
    async put(object: ObjectTarget, bytes: Buffer) { await (await call(object, "PUT", "", bytes)).body?.cancel(); },
    async seal(object: ObjectTarget) {
      const proof = await (await call(object, "POST", "?seal=1")).text();
      requireValue(proof === "sealed", "UNAVAILABLE");
    },
    async read(object: ObjectTarget, limit: number) {
      const response = await call(object, "GET");
      requireValue(response.body, "UNAVAILABLE");
      const reader = response.body.getReader(), parts: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          requireValue(size <= limit, "INVALID_IMAGE");
          parts.push(Buffer.from(result.value));
        }
        return Buffer.concat(parts);
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    },
    async purge(object: ObjectTarget) {
      const proof = await (await call(object, "DELETE")).text();
      requireValue(proof === "sealed-and-absent", "UNAVAILABLE");
    },
  };
}

async function decode(bytes: Buffer, expected: Expected): Promise<Image> {
  requireValue(bytes.length === expected.size && sha(bytes) === expected.sha256, "INVALID_IMAGE");
  try {
    const pipeline = sharp(bytes, { limitInputPixels: 4_000_000, failOn: "error" });
    const metadata = await pipeline.metadata();
    requireValue(metadata.format === "png" && metadata.width && metadata.height &&
      (!metadata.pages || metadata.pages === 1), "INVALID_IMAGE");
    await pipeline.raw().toBuffer();
    return { bytes, width: metadata.width, height: metadata.height, ...expected };
  } catch (cause) { throw new ImageUploadError("INVALID_IMAGE", cause); }
}

export function createOwnedPrivateImageUpload(pools: Pools, storageOrigin: string, verifier: VerifiedActor) {
  requireValue(isVerifiedActor(verifier), "INPUT");
  const storage = loopbackStorage(storageOrigin);
  async function transaction<T>(role: Role, actor: VerifiedActor, requestId: string, run: (c: PoolClient) => Promise<T>) {
    requireValue(isVerifiedActor(actor) && uuid7.test(requestId), "INPUT");
    const c = await pools[role].connect().catch(cause => { throw new ImageUploadError("UNAVAILABLE", cause); });
    let destroy = false, committing = false;
    const failed = () => { destroy = true; };
    c.on("error", failed);
    try {
      await c.query("BEGIN; SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='8s'");
      const identity = await c.query<{ ok: boolean }>(`SELECT current_database()='dream_test_t367'
        AND inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int/10000=17
        AND current_user=session_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb
        AND NOT pg_has_role(session_user,'dream_api','MEMBER') AND NOT pg_has_role(session_user,'dream_worker','MEMBER')
        AND (SELECT array_agg(x.rolname::text) FROM pg_roles x WHERE x.rolname=ANY($1::text[])
          AND pg_has_role(session_user,x.oid,'SET'))=ARRAY[$2::text] AS ok
        FROM pg_roles r WHERE r.rolname=session_user`, [roles, role]);
      requireValue(identity.rows[0]?.ok, "UNAVAILABLE");
      await c.query(`SET LOCAL ROLE ${role}`);
      await c.query("SELECT set_config('dream.actor_id',$1,true), set_config('row_security','on',true)", [actor.id]);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,367))", [`${actor.id}/${requestId}`]);
      const result = await run(c);
      committing = true;
      const resultTx = await c.query("COMMIT");
      requireValue(resultTx.command === "COMMIT" && !destroy, "UNAVAILABLE");
      return result;
    } catch (cause) {
      destroy ||= committing;
      try { await c.query("ROLLBACK"); } catch { destroy = true; }
      if (!destroy && cause instanceof ImageUploadError) throw cause;
      throw new ImageUploadError("UNAVAILABLE", cause);
    } finally { c.release(destroy); c.removeListener("error", failed); }
  }
  const row = async (c: PoolClient, requestId: string) => (await c.query<Row>(`SELECT i.request_id AS "requestId",
    i.id AS "intentId",i.incoming_key AS "incomingKey",i.authorization_until AS expires,i.request_json AS raw,
    o.id AS "objectId",o.reserved_asset_id AS "assetId",o.lifecycle,o.revision,o.object_key AS key,
    o.identity_digest AS "identityDigest",o.cleanup_id AS "cleanupId"
    FROM dream.upload_intents i JOIN dream.storage_objects o ON (o.owner_id,o.id)=(i.owner_id,i.object_id)
    WHERE i.owner_id=dream.actor_id() AND i.incoming_bucket=$1 AND i.request_id=$2`, [incoming, requestId])).rows[0];
  const existing = async (c: PoolClient, req: string) => {
    const found = await row(c, req); requireValue(found, "NOT_FOUND"); return found;
  };
  const live = (r: Row) => {
    requireValue(r.lifecycle === "reserved" || r.lifecycle === "publication_reserved", "CLOSED");
    requireValue(r.expires.getTime() > Date.now(), "EXPIRED");
  };
  const operation = async (c: PoolClient, r: Row) => (await c.query<Operation>(
    "SELECT * FROM dream.storage_verification_operations WHERE object_id=$1 AND generation=1", [r.objectId])).rows[0];
  const lockPolicy = async (c: PoolClient) => {
    const result = await c.query<{ epoch: string; digest: string }>(
      "SELECT epoch,digest FROM dream.storage_policies WHERE policy_id=$1 FOR SHARE", [policyId]);
    requireValue(result.rows[0], "UNAVAILABLE");
    return result.rows[0];
  };
  const evidence = async (c: PoolClient, r: Row) => (await c.query<{ assetId: string }>(`SELECT a.id AS "assetId"
    FROM dream.asset_receipt_state s JOIN dream.assets a ON (a.owner_id,a.id)=(s.owner_id,s.asset_id)
    JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(a.owner_id,s.object_id,a.id)
    JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
      =(a.owner_id,s.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
    JOIN dream.storage_verification_operations v ON (v.owner_id,v.id,v.object_id,v.terminal_receipt_id)
      =(r.owner_id,r.operation_id,r.object_id,r.id)
    JOIN dream.storage_policies p ON (p.policy_id,p.epoch,p.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
    WHERE s.status='ready' AND o.lifecycle='registered' AND v.status='succeeded' AND p.policy_id=$2
      AND o.bucket=$3 AND a.archived_at IS NULL AND a.is_mock=0
      AND (a.file_path,a.sha256,a.size_bytes,a.mime,a.kind)=(o.object_key,o.sha256,o.size_bytes,o.mime,o.kind)
      AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp() AND o.id=$1`,
  [r.objectId, policyId, permanent])).rows[0];
  async function enqueue(c: PoolClient, actor: VerifiedActor, r: Row, kind: "publish" | "delete" | "reconcile", which: "incoming" | "final",
    metadata: Readonly<{ operationId?: string; identity?: string; key?: string; cleanupId?: string }> = {}) {
    const payload = JSON.stringify({ kind, which });
    await c.query(`INSERT INTO dream.storage_outbox(owner_id,id,object_id,kind,target_kind,operation_id,generation,
      fence,barrier_fence,intent_id,cleanup_id,bucket,object_key,identity_digest,payload_json,payload_sha,status,attempts,revision,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',0,0,clock_timestamp())`, [
      actor.id, v7(), r.objectId, kind, which, metadata.operationId ?? null, metadata.operationId ? 1 : null,
      metadata.operationId ? 1 : 0, metadata.cleanupId ? 1 : 0, which === "incoming" ? r.intentId : null,
      metadata.cleanupId ?? null, which === "incoming" ? incoming : permanent, which === "incoming" ? r.incomingKey : metadata.key,
      metadata.identity ?? null, payload, sha(payload),
    ]);
  }

  async function prepare(actor: VerifiedActor, req: string, image: Image) {
    return transaction("t367_verify", actor, req, async c => {
      const r = await existing(c, req);
      if (r.lifecycle === "registered") return null;
      live(r);
      const p = await lockPolicy(c);
      const final = destination(r, image.sha256);
      const identity = { ownerId: actor.id, assetId: r.assetId, ...final, providerVersion: null,
        kind: "image", mime: contentType, sha256: image.sha256, sizeBytes: image.size };
      const raw = JSON.stringify(identity), identityDigest = digest("object-identity", raw);
      if (r.lifecycle === "publication_reserved") {
        const op = await operation(c, r);
        requireValue(r.identityDigest === identityDigest && op?.policy_epoch === p.epoch && op?.policy_digest === p.digest, "CLOSED");
        return final;
      }
      const now = new Date(), operationId = v7();
      requireValue(r.expires > now, "EXPIRED");
      await c.query(`INSERT INTO dream.storage_verification_operations(owner_id,id,object_id,intent_id,kind,generation,
        request_fingerprint,request_json,request_raw_sha,policy_id,policy_epoch,policy_digest,authorization_until,
        expected_state_revision,fence,status,revision,created_at)
        VALUES($1,$2,$3,$4,'initial',1,$5,$6,$7,$8,$9,$10,$11,0,0,'pending',0,$12)`,
      [actor.id, operationId, r.objectId, r.intentId, digest("t367-request", r.raw), r.raw, sha(r.raw), policyId, p.epoch, p.digest, r.expires, now]);
      await c.query(`UPDATE dream.storage_verification_operations SET status='running',fence=1,
        worker_id=$2,claimed_at=$3,lease_until=$4,claim_verifiers=ARRAY[$2::uuid],revision=1 WHERE id=$1`,
      [operationId, verifier.id, now, r.expires]);
      const claim = { workerId: verifier.id, fence: 1, claimedAt: now.getTime(), leaseUntil: r.expires.getTime(),
        authorizationUntil: r.expires.getTime(), policyEpoch: Number(p.epoch), policyDigest: p.digest, claimVerifiers: [verifier.id] };
      const publication = JSON.stringify({ operationId, fence: 1, barrierFence: 0, reservedAt: now.getTime(), claim, identityDigest });
      await c.query(`UPDATE dream.storage_objects SET lifecycle='publication_reserved',active_generation=1,bucket=$2,
        object_key=$3,kind='image',mime=$4,sha256=$5,size_bytes=$6,identity_json=$7,identity_digest=$8,publication_json=$9,
        revision=revision+1 WHERE id=$1`, [r.objectId, permanent, final.key, contentType, image.sha256, image.size, raw, identityDigest, publication]);
      await c.query("UPDATE dream.upload_intents SET status='completion_requested',revision=revision+1 WHERE id=$1", [r.intentId]);
      await enqueue(c, actor, r, "publish", "final", { operationId, key: final.key, identity: identityDigest });
      return final;
    });
  }

  async function finish(actor: VerifiedActor, req: string, image: Image) {
    return transaction("t367_verify", actor, req, async c => {
      const r = await existing(c, req);
      if (r.lifecycle === "registered") {
        const current = await evidence(c, r); requireValue(current, "CLOSED"); return current;
      }
      live(r);
      const p = await lockPolicy(c), op = await operation(c, r);
      requireValue(r.lifecycle === "publication_reserved" && r.identityDigest && r.key &&
        op?.status === "running" && op.worker_id === verifier.id && p.epoch === op.policy_epoch && p.digest === op.policy_digest, "CLOSED");
      const now = new Date(), expiry = new Date(now.getTime() + evidenceTtl), receipt = v7(), run = v7();
      requireValue(now < op.lease_until, "EXPIRED");
      const identity = (await c.query<{ value: string }>(
        "SELECT identity_json AS value FROM dream.storage_objects WHERE id=$1", [r.objectId])).rows[0].value;
      const decoded = JSON.parse(identity);
      requireValue(decoded.sha256 === image.sha256 && decoded.sizeBytes === image.size, "INVALID_IMAGE");
      const metadata = JSON.parse(r.raw);
      await c.query(`INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,size_bytes,sha256,origin,width,height,created_at,rights_note)
        VALUES($1,$2,'image',$11,'original',$3,$4,$5,$6,'upload',$7,$8,$9,$10)`,
      [actor.id, r.assetId, r.key, contentType, image.size, image.sha256, image.width, image.height, now, metadata.rightsNote ?? null, metadata.title ?? "Private image"]);
      await c.query(`UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=reserved_asset_id,
        revision=revision+1 WHERE id=$1`, [r.objectId]);
      await c.query(`INSERT INTO dream.storage_verification_runs(owner_id,id,object_id,operation_id,generation,fence,worker_id,
        outcome,observed_json,observed_sha,recorded_at) VALUES($1,$2,$3,$4,1,1,$5,'succeeded',$6,$7,$8)`,
      [actor.id, run, r.objectId, op.id, verifier.id, identity, sha(identity), now]);
      const raw = JSON.stringify({ id: receipt, objectId: r.objectId, identity: decoded, operationId: op.id, generation: 1, fence: 1,
        policyEpoch: Number(p.epoch), policyDigest: p.digest, source: { ...target(r), providerVersion: null },
        media: { width: image.width, height: image.height, durationMs: null }, verifiedAt: now.getTime(), notAfter: expiry.getTime(),
        verifierId: verifier.id, verifierVersion: "t367-png-v1", toolVersion: "sharp-png" });
      await c.query(`INSERT INTO dream.storage_verification_receipts(owner_id,id,object_id,asset_id,operation_id,run_id,generation,fence,
        identity_digest,policy_id,policy_epoch,policy_digest,source_bucket,source_key,width,height,verifier_id,verifier_version,
        tool_version,verified_at,not_after,receipt_json,receipt_digest)
        VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,'t367-png-v1','sharp-png',$16,$17,$18,$19)`,
      [actor.id, receipt, r.objectId, r.assetId, op.id, run, r.identityDigest, policyId, p.epoch, p.digest, incoming, r.incomingKey,
        image.width, image.height, verifier.id, now, expiry, raw, digest("verification-receipt", raw)]);
      const terminal = JSON.stringify({ status: "succeeded", receiptId: receipt });
      await c.query(`UPDATE dream.storage_verification_operations SET status='succeeded',terminal_receipt_id=$2,terminal_json=$3,
        terminal_digest=$4,completed_at=$5,completed_state_revision=1,completed_aggregate_revision=$6,revision=revision+1 WHERE id=$1`,
      [op.id, receipt, terminal, digest("verification-terminal", terminal), now, Number(r.revision) + 1]);
      await c.query(`INSERT INTO dream.asset_receipt_state(owner_id,asset_id,object_id,current_receipt_id,status,revision,updated_at)
        VALUES($1,$2,$3,$4,'ready',1,$5)`, [actor.id, r.assetId, r.objectId, receipt, now]);
      await c.query("UPDATE dream.upload_intents SET status='succeeded',revision=revision+1 WHERE id=$1", [r.intentId]);
      await c.query("UPDATE dream.storage_outbox SET status='done',revision=revision+1 WHERE object_id=$1 AND kind='publish'", [r.objectId]);
      await enqueue(c, actor, r, "reconcile", "incoming");
      const current = await evidence(c, r); requireValue(current, "UNAVAILABLE");
      return current;
    });
  }

  async function cleanup(actor: VerifiedActor, req: string) {
    const killed = await transaction("t367_cleanup", actor, req, async c => {
      const r = await existing(c, req);
      if (r.lifecycle === "registered" || r.lifecycle === "tombstoned") return r;
      if (r.lifecycle === "cleanup_claimed") return r;
      const now = new Date(), cleanupId = v7(), revision = Number(r.revision) + 1;
      const closure = JSON.stringify({ revision, at: now.getTime(), principalId: actor.id, authorizers: [actor.id],
        reason: "cancel", operationId: null });
      const op = await operation(c, r);
      if (op) {
        const claim = JSON.stringify({ workerId: op.worker_id, fence: Number(op.fence), claimedAt: op.claimed_at.getTime(),
          leaseUntil: op.lease_until.getTime(), authorizationUntil: op.authorization_until.getTime(),
          policyEpoch: Number(op.policy_epoch), policyDigest: op.policy_digest, claimVerifiers: op.claim_verifiers });
        const terminal = '{"status":"canceled"}';
        await c.query(`UPDATE dream.storage_verification_operations SET status='canceled',fence=fence+1,
          worker_id=NULL,claimed_at=NULL,claim_verifiers='{}',lease_until=NULL,completed_at=$2,completed_state_revision=0,
          completed_aggregate_revision=$3,canceled_claim_json=$4,terminal_json=$5,terminal_digest=$6,revision=revision+1 WHERE id=$1`,
        [op.id, now, revision, claim, terminal, digest("verification-terminal", terminal)]);
      }
      await c.query(`INSERT INTO dream.storage_cleanup_claims(owner_id,id,object_id,barrier_fence,claimed_at,claimed_aggregate_revision)
        VALUES($1,$2,$3,1,$4,$5)`, [actor.id, cleanupId, r.objectId, now, revision + 1]);
      // Claim closure as its own revision, then link the cleanup claim in the next revision.
      await c.query(`UPDATE dream.storage_objects SET initial_closed=true,closure_json=$2,revision=revision+1 WHERE id=$1`, [r.objectId, closure]);
      await c.query(`UPDATE dream.storage_objects SET lifecycle='cleanup_claimed',cleanup_id=$2,barrier_fence=1,revision=revision+1
        WHERE id=$1`, [r.objectId, cleanupId]);
      await c.query("UPDATE dream.upload_intents SET status='canceled',revision=revision+1 WHERE id=$1", [r.intentId]);
      await c.query("UPDATE dream.storage_outbox SET status='done',revision=revision+1 WHERE object_id=$1 AND kind='publish'", [r.objectId]);
      await enqueue(c, actor, r, "delete", "incoming", { cleanupId });
      if (r.key && r.identityDigest) await enqueue(c, actor, r, "delete", "final", { cleanupId, key: r.key, identity: r.identityDigest });
      return existing(c, req);
    });
    if (killed.lifecycle === "registered") {
      await removeIncoming(actor, req);
      return killed.lifecycle;
    }
    if (killed.lifecycle === "tombstoned") return killed.lifecycle;
    await storage.purge(target(killed));
    if (killed.key) await storage.purge({ bucket: permanent, key: killed.key });
    return transaction("t367_cleanup", actor, req, async c => {
      const r = await existing(c, req);
      if (r.lifecycle === "tombstoned") return r.lifecycle;
      requireValue(r.lifecycle === "cleanup_claimed" && r.cleanupId === killed.cleanupId, "CLOSED");
      const observation = JSON.stringify({ at: Date.now(), absent: true, writerQuiescent: true,
        identityDigest: r.identityDigest ?? digest("object-identity", "null") });
      await c.query("UPDATE dream.storage_cleanup_claims SET observation_json=$2,revision=revision+1 WHERE id=$1", [r.cleanupId, observation]);
      await c.query("UPDATE dream.storage_objects SET lifecycle='tombstoned',revision=revision+1 WHERE id=$1", [r.objectId]);
      await c.query("UPDATE dream.storage_outbox SET status='done',revision=revision+1 WHERE object_id=$1 AND kind='delete'", [r.objectId]);
      return "tombstoned" as const;
    });
  }

  async function incomingNotice(c: PoolClient, r: Row) {
    requireValue(r.lifecycle === "registered", "CLOSED");
    const { rows } = await c.query<{ id: string; status: string; matches: boolean }>(
      `SELECT id,status,target_kind='incoming' AND intent_id=$2 AND bucket=$3 AND object_key=$4 AS matches
       FROM dream.storage_outbox WHERE owner_id=dream.actor_id() AND object_id=$1 AND kind='reconcile'`,
      [r.objectId, r.intentId, incoming, r.incomingKey]);
    const notice = rows[0];
    requireValue(rows.length === 1 && notice.matches && (notice.status === "pending" || notice.status === "done"), "UNAVAILABLE");
    return notice;
  }

  // Registration closes the intake path permanently. Cleaning its staging bytes
  // does not consume, renew or check the evidence used to serve the registered asset.
  async function removeIncoming(actor: VerifiedActor, req: string) {
    const pending = await transaction("t367_cleanup", actor, req, async c => {
      const r = await existing(c, req);
      const notice = await incomingNotice(c, r);
      return notice.status === "pending" ? { object: target(r), id: notice.id } : null;
    });
    if (!pending) return;
    await storage.purge(pending.object);
    await transaction("t367_cleanup", actor, req, async c => {
      const r = await existing(c, req);
      const notice = await incomingNotice(c, r);
      requireValue(notice.id === pending.id, "UNAVAILABLE");
      if (notice.status === "done") return;
      const changed = await c.query(`UPDATE dream.storage_outbox SET status='done',revision=revision+1
        WHERE owner_id=dream.actor_id() AND id=$1 AND status='pending'`, [notice.id]);
      requireValue(changed.rowCount === 1, "UNAVAILABLE");
    });
  }

  return Object.freeze({
    async reserve(actor: VerifiedActor, req: string, expected: Expected, rightsNote = "", filename?: string | null) {
      requireValue(expected && Number.isSafeInteger(expected.size) && expected.size > 0 && expected.size <= maxBytes &&
        typeof expected.sha256 === "string" && hex.test(expected.sha256), "INPUT");
      requireValue(typeof rightsNote === "string", "INVALID_RIGHTS_NOTE");
      const note = rightsNote.trim();
      requireValue(note.length <= 500 && !note.includes("\0"), "INVALID_RIGHTS_NOTE");
      // Omitting a blank note preserves the identity of reservations created before metadata support.
      const request = { size: expected.size, sha256: expected.sha256, ...(note && { rightsNote: note }) };
      const title = filename == null ? null : posix.basename(filename.replaceAll("\\", "/")).normalize("NFC").trim();
      requireValue(title === null || (title.length > 0 && title.length <= 255 && title !== "." && title !== ".." &&
        !Array.from(title).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)), "INVALID_FILENAME");
      const raw = JSON.stringify({ ...request, ...(filename !== undefined && { title }) });
      return transaction("t367_ingest", actor, req, async c => {
        const r = await row(c, req);
        if (r) {
          // Earlier request records bound only the bytes and rights note.
          requireValue(r.raw === raw || r.raw === JSON.stringify(request), "CONFLICT");
          return { requestId: req, assetId: r.assetId };
        }
        const object = v7(), intent = v7(), asset = v7(), now = new Date(), expires = new Date(now.getTime() + ttl);
        await c.query(`INSERT INTO dream.storage_objects(owner_id,id,reserved_asset_id,lifecycle,revision,barrier_fence,active_generation,created_at)
          VALUES($1,$2,$3,'reserved',0,0,0,$4)`, [actor.id, object, asset, now]);
        await c.query(`INSERT INTO dream.upload_intents(owner_id,id,object_id,request_id,request_fingerprint,request_json,
          request_raw_sha,incoming_bucket,incoming_key,max_bytes,authorization_until,issue_envelope_until,max_issues,
          issue_count,status,revision,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,1,0,'open',0,$12)`,
        [actor.id, intent, object, req, digest("t367-request", raw), raw, sha(raw), incoming, `${actor.id}/incoming/${object}/${intent}`,
          expected.size, expires, now]);
        return { requestId: req, assetId: asset };
      });
    },
    async receive(actor: VerifiedActor, req: string, body: Buffer) {
      requireValue(Buffer.isBuffer(body) && body.length > 0 && body.length <= maxBytes, "INPUT");
      const bytes = Buffer.from(body);
      const r = await transaction("t367_ingest", actor, req, c => existing(c, req));
      live(r);
      requireValue(r.lifecycle === "reserved", "CLOSED");
      const expected: Expected = JSON.parse(r.raw);
      requireValue(bytes.length === expected.size && sha(bytes) === expected.sha256, "INVALID_IMAGE");
      await storage.put(target(r), bytes);
    },
    async complete(actor: VerifiedActor, req: string) {
      const lookup = await transaction("t367_verify", actor, req, async c => {
        const r = await existing(c, req);
        if (r.lifecycle !== "registered") { live(r); return { row: r }; }
        const result = await evidence(c, r); requireValue(result, "CLOSED"); return { row: r, result };
      });
      if (lookup.result) { await removeIncoming(actor, req); return lookup.result; }
      const source = target(lookup.row), expected: Expected = JSON.parse(lookup.row.raw);
      let result: { assetId: string };
      try {
        await storage.seal(source);
        const image = await decode(await storage.read(source, expected.size), expected);
        const final = await prepare(actor, req, image);
        if (final) {
          await storage.put(final, image.bytes);
          const stored = await storage.read(final, image.size);
          requireValue(stored.length === image.size && sha(stored) === image.sha256, "UNAVAILABLE");
        }
        result = await finish(actor, req, image);
      } catch (error) {
        if (error instanceof ImageUploadError && error.code === "INVALID_IMAGE") {
          await cleanup(actor, req);
          throw error;
        }
        // A matching completion may commit while this attempt is reading the
        // sealed staging object. Its cleanup can remove those staging bytes.
        const committed = await transaction("t367_verify", actor, req, async c => {
          const r = await existing(c, req);
          return r.lifecycle === "registered" ? evidence(c, r) : undefined;
        });
        if (!committed) throw error;
        result = committed;
      }
      await removeIncoming(actor, req);
      return result;
    },
    cancel: cleanup,
  });
}
