/* global console, URL */
// P2-MANAGED-STORAGE-RESERVATION-PG17-HTTP: same-database PG17 fixture for managed-project-core-http.mjs --pg17-draft.
// 0001..0004 come from the runner/HTTP flow; this file adds the unpublished drafts/pg17_upload_reservation.sql body
// (published 0001..0005 checksum-verified, published 0005 never executed) and 0006, then creates the HTTP assets through
// the restricted 0005 reservation login and issues receipts only from a matching observation v1. Synthetic data only.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { v7 } from "uuid";
import { reserveUpload, transition } from "../../lib/storage/uploads/state.ts";
import { canonicalJson, protocolDigest } from "../../lib/storage/uploads/receipt.ts";
import { decodeUploadReservation, encodeUploadReservation } from "../../lib/db/postgres/upload-reservation-codec.ts";
import { loadPostgresMigrationsV3 } from "../../lib/db/postgres/migration-manifest-v3.ts";

const sha = text => createHash("sha256").update(text).digest("hex");
const dh = (domain, raw) => sha(`${domain}:v1\n${raw}`);
const at = ms => new Date(ms).toISOString();
const clock = { last: 0 };
const tick = () => (clock.last = Math.max(Date.now(), clock.last + 1));
const worker = randomUUID(), collector = randomUUID(), manager = randomUUID();
const policy = { id: "asset-upload", epoch: 1, digest: sha("p2-pg17-draft-asset-upload-policy") };
const policyBody = { bodyVersion: 1, collectors: [collector], incomingBucket: "p102-incoming", intentTtlMs: 600_000, issueEnvelopeMs: 60_000,
  keyRule: "owner/incoming/object/intent:v1", maxBytes: 1_048_576, maxIssues: 2, maxPreparationAgeMs: 60_000, policyManagers: [manager],
  providerMaxBytes: 1_048_576, verifiers: [worker] };
const versions = { verifierVersion: "pg17-draft-http-v1", toolVersion: "synthetic-probe-1" };
const media = { width: 3, height: 2, durationMs: null };
const fp = protocolDigest("operation", { test: "pg17-draft-http" });
const read = async (rootPath, path) => (await readFile(new URL(path, rootPath), "utf8")).replaceAll("\r\n", "\n");
export const draftAssetTitle = "Synthetic reserved";

// Runs while the caller's session is SET ROLE p102_migrate (the dream schema owner), right after 0004.
export async function installPg17Draft({ admin, rootPath }) {
  const sources = await loadPostgresMigrationsV3(5);
  const published = await read(rootPath, "lib/db/postgres/0005_upload_reservation.sql");
  const raw = await read(rootPath, "lib/db/postgres/drafts/pg17_upload_reservation.sql");
  assert.equal(sha(published), sources[4].checksum);
  const a = published.split("\n"), b = raw.split("\n");
  const differing = a.flatMap((line, i) => line === b[i] ? [] : [i + 1]);
  assert.equal(a.length, b.length);
  assert.deepEqual(differing, [1, 2, 3, 15, 16]);
  for (const n of [15, 16]) assert.equal(b[n - 1], a[n - 1].replace(/18/g, "17"));
  const start = raw.indexOf("\nBEGIN;\n") + 8, end = raw.lastIndexOf("\nCOMMIT;");
  assert(start > 8 && end > start && raw.slice(end) === "\nCOMMIT;\n" && raw.indexOf("\nBEGIN;\n", start) === -1);
  const { rows: [ids] } = await admin.query(`SELECT r.oid::text AS owner, (SELECT oid::text FROM pg_roles WHERE rolname='p102_root' AND rolsuper) AS bootstrap
    FROM pg_roles r WHERE r.rolname=current_user AND r.rolname='p102_migrate' AND r.rolcreaterole AND NOT r.rolsuper AND NOT r.rolbypassrls`);
  assert(ids?.owner && ids.bootstrap);
  await admin.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    await admin.query("SET LOCAL search_path=pg_catalog");
    await admin.query("SELECT pg_catalog.set_config('dream.b27_migration_owner_oid',$1,true),pg_catalog.set_config('dream.b27_bootstrap_oid',$2,true),pg_catalog.set_config('dream.b27_expected_pg_major','17',true)",
      [ids.owner, ids.bootstrap]);
    await admin.query(raw.slice(start, end));
    assert.equal((await admin.query("COMMIT")).command, "COMMIT");
  } catch (error) { await admin.query("ROLLBACK").catch(() => {}); throw error; }
  const edges = (await admin.query("SELECT roleid::regrole::text AS role, grantor::text AS grantor, admin_option, inherit_option, set_option FROM pg_auth_members WHERE member=$1::oid OR roleid=$1::oid ORDER BY 1", [ids.owner])).rows;
  assert.deepEqual(edges.map(e => e.role), ["dream_api", "dream_upload_reserver", "dream_worker"]);
  assert(edges.every(e => e.grantor === ids.bootstrap && e.admin_option && !e.inherit_option && !e.set_option));
  const result = { verifiedPublished: sources.map(e => e.id), draftSha256: sha(raw), differingLinesFromPublished0005: differing,
    publishedOnly0005Executed: false, ownerEdges: edges.map(e => e.role), edgeGrantorIsBootstrap: true };
  console.log(JSON.stringify({ pg17Draft: result }));
  return result;
}

// Runs while SET ROLE p102_migrate, after managed-project-core.
export async function installObservation({ admin, rootPath }) {
  assert.equal((await admin.query(await read(rootPath, "lib/db/postgres/0006_storage_observation.sql"))).at(-1).command, "COMMIT");
  const { rows: [fn] } = await admin.query(`SELECT p.prosecdef, p.proacl::text AS acl,
    has_function_privilege('dream_api',p.oid,'EXECUTE') AS api, has_function_privilege('dream_project_core_app',p.oid,'EXECUTE') AS app
    FROM pg_proc p WHERE p.oid='dream.storage_observation_guard()'::regprocedure`);
  assert.deepEqual(fn, { prosecdef: false, acl: "{p102_migrate=X/p102_migrate}", api: false, app: false });
  console.log(JSON.stringify({ storageObservation: "COMMIT", guardAcl: fn.acl }));
}

// Superuser session (RESET ROLE). Returns the three asset ids the HTTP flow needs.
export async function reservedAssets({ admin, connect, users }) {
  const secret = randomBytes(24).toString("hex");
  const policyRaw = canonicalJson(policyBody);
  await admin.query("INSERT INTO dream.storage_policy_versions VALUES($1,$2,$3,clock_timestamp())", [policy.id, policy.epoch, policy.digest]);
  await admin.query("INSERT INTO dream_reservation.upload_policy_versions VALUES($1,$2,$3,$4,$5)", [policy.id, policy.epoch, policy.digest, policyRaw, dh("upload-policy-body", policyRaw)]);
  await admin.query("INSERT INTO dream.storage_policies VALUES($1,$2,$3,0,clock_timestamp())", [policy.id, policy.epoch, policy.digest]);
  await admin.query(`CREATE ROLE p2_reserve_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${secret}'`);
  await admin.query("GRANT dream_api TO p2_reserve_api WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
  const api = await connect("p2_reserve_api", secret);
  const insert = (table, row) => { const keys = Object.keys(row);
    return admin.query(`INSERT INTO dream.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`, Object.values(row)); };
  const tx = async run => { await admin.query("BEGIN"); try { await run(); await admin.query("COMMIT"); } catch (error) { await admin.query("ROLLBACK"); throw error; } };
  const receiptCount = async () => (await admin.query("SELECT count(*)::int AS n FROM dream.storage_verification_receipts")).rows[0].n;

  async function reserve(owner) {
    const requestId = v7(), objectId = v7(), assetId = v7(), intentId = v7();
    const client = canonicalJson({ claimedMime: "image/png", clientVersion: 1, requestedMaxBytes: policyBody.maxBytes });
    await api.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    try {
      await api.query("SET LOCAL ROLE dream_api"); await api.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
      const seed = (await api.query("SELECT dream_reservation.read_upload_seed_v1($1,$2) AS value", [requestId, client])).rows[0].value;
      assert.equal(seed.tag, "seed");
      clock.last = Math.max(clock.last, seed.now);
      const value = { ownerId: owner, objectId, assetId, intentId, intentExpiresAt: seed.now + policyBody.intentTtlMs, issueEnvelopeUntil: seed.now + policyBody.issueEnvelopeMs,
        maxIssues: policyBody.maxIssues, verifiers: policyBody.verifiers, collectors: policyBody.collectors, policyManagers: policyBody.policyManagers,
        policyEpoch: policy.epoch, policyDigest: policy.digest, incoming: { bucket: policyBody.incomingBucket, key: `${owner}/incoming/${objectId}/${intentId}`, providerVersion: null } };
      const model = reserveUpload(value, { principalId: owner, now: seed.now, expectedRevision: 0 });
      const requestJson = canonicalJson({ codecVersion: 1, requestId, maxBytes: policyBody.maxBytes, reservedAt: seed.now, reservation: value });
      const staged = (await api.query("SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [requestId, client, requestJson])).rows[0].value;
      assert.equal(staged.tag, "staged");
      assert.equal((await api.query("COMMIT")).command, "COMMIT");
      const codec = encodeUploadReservation({ model, requestJson });
      const object = (await admin.query(codec.selectObject.text, [...codec.selectObject.values])).rows[0];
      const intent = (await admin.query(codec.selectIntent.text, [...codec.selectIntent.values])).rows[0];
      assert.equal(canonicalJson(decodeUploadReservation({ object, intent }).model), canonicalJson(model));
      return { owner, model, objectId, assetId, intentId };
    } catch (error) { await api.query("ROLLBACK").catch(() => {}); throw error; }
  }

  // Model through finalize with observation v1, then the executor-style DB transactions (operation, claim, publication, run+receipt).
  async function register(owner, label, lifetimeMs) {
    const item = await reserve(owner);
    const bytes = `synthetic-reserved-${label}-${item.assetId}`, digest = sha(bytes);
    const identity = { ownerId: owner, assetId: item.assetId, bucket: "p102-final", key: `${owner}/assets/${item.assetId}/${digest}.png`, sha256: digest,
      sizeBytes: bytes.length, kind: "image", mime: "image/png", providerVersion: null };
    const apply = (s, command, principal = worker) => transition(s, command, { principalId: principal, now: tick(), expectedRevision: s.revision });
    const op = v7(), receiptId = v7();
    let s = apply(item.model, { type: "complete", operationId: op, kind: "initial", fingerprint: fp, authorizationUntil: tick() + 300_000 }, owner);
    s = apply(s, { type: "claim", operationId: op, fingerprint: fp, expectedFence: 0, leaseUntil: s.operations.find(o => o.id === op).authorizationUntil });
    const published = apply(s, { type: "reservePublication", operationId: op, fingerprint: fp, expectedFence: 1, identity });
    const observation = { v: 1, kind: "initial", source: item.model.incoming, bytes: { sha256: digest, sizeBytes: bytes.length },
      format: { mime: "image/png", kind: "image" }, media, published: { sha256: digest, sizeBytes: bytes.length }, tools: versions };
    const done = apply(published, { type: "finalize", operationId: op, fingerprint: fp, expectedFence: 1, receiptId, identity,
      source: item.model.incoming, media, notAfter: tick() + lifetimeMs, ...versions, observation });
    const o = done.operations.find(x => x.id === op), receipt = done.receipts.find(r => r.body.id === receiptId), body = receipt.body;
    await tx(async () => {
      await insert("storage_verification_operations", { owner_id: owner, id: o.id, object_id: item.objectId, intent_id: item.intentId, kind: o.kind,
        generation: o.generation, request_fingerprint: o.fingerprint, request_json: "{}", request_raw_sha: sha("{}"), policy_id: policy.id,
        policy_epoch: o.policyEpoch, policy_digest: o.policyDigest, authorization_until: at(o.authorizationUntil), expected_state_revision: o.expectedStateRevision,
        fence: 0, status: "pending", revision: 0, created_at: at(o.createdAt) });
      await admin.query("UPDATE dream.storage_objects SET active_generation=$2,revision=revision+1 WHERE id=$1", [item.objectId, o.generation]);
    });
    await tx(async () => {
      await admin.query("UPDATE dream.storage_verification_operations SET status='running',fence=$2,worker_id=$3,claimed_at=$4,claim_verifiers=$5::uuid[],lease_until=$6,revision=revision+1 WHERE id=$1",
        [o.id, o.fence, o.workerId, at(o.claimedAt), o.claimVerifiers, at(o.leaseUntil)]);
      await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [item.objectId]);
    });
    await admin.query("UPDATE dream.storage_objects SET lifecycle='publication_reserved',bucket=$2,object_key=$3,kind=$4,mime=$5,sha256=$6,size_bytes=$7,identity_json=$8,identity_digest=$9,publication_json=$10,revision=revision+1 WHERE id=$1",
      [item.objectId, identity.bucket, identity.key, identity.kind, identity.mime, identity.sha256, identity.sizeBytes,
        canonicalJson(identity), protocolDigest("object-identity", identity), canonicalJson(published.publication)]);
    await insert("assets", { owner_id: owner, id: item.assetId, kind: "image", title: draftAssetTitle, role: "original", file_path: identity.key,
      mime: identity.mime, sha256: identity.sha256, size_bytes: identity.sizeBytes, width: media.width, height: media.height, duration_ms: null,
      origin: "upload", created_at: at(item.model.reservedAt) });
    const issue = observed => tx(async () => {
      const runId = v7(), raw = canonicalJson(observed);
      await insert("storage_verification_runs", { owner_id: owner, id: runId, object_id: item.objectId, operation_id: o.id, generation: o.generation, fence: o.fence,
        worker_id: o.workerId, outcome: "succeeded", observed_json: raw, observed_sha: sha(raw), recorded_at: at(o.completedAt) });
      await insert("storage_verification_receipts", { owner_id: owner, id: body.id, object_id: item.objectId, asset_id: item.assetId, operation_id: o.id,
        run_id: runId, generation: body.generation, fence: body.fence, identity_digest: protocolDigest("object-identity", identity), policy_id: policy.id,
        policy_epoch: body.policyEpoch, policy_digest: body.policyDigest, source_bucket: body.source.bucket, source_key: body.source.key,
        source_version: body.source.providerVersion, width: body.media.width, height: body.media.height, duration_ms: body.media.durationMs,
        verifier_id: body.verifierId, verifier_version: body.verifierVersion, tool_version: body.toolVersion, verified_at: at(body.verifiedAt),
        not_after: at(body.notAfter), receipt_json: canonicalJson(body), receipt_digest: receipt.digest });
      const terminal = canonicalJson({ status: "succeeded", receiptId: body.id });
      await admin.query("UPDATE dream.storage_verification_operations SET status='succeeded',terminal_receipt_id=$2,terminal_json=$3,terminal_digest=$4,completed_at=$5,completed_state_revision=$6,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$7),revision=revision+1 WHERE id=$1",
        [o.id, body.id, terminal, dh("verification-terminal", terminal), at(o.completedAt), o.completedStateRevision, item.objectId]);
      await admin.query("UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=reserved_asset_id,revision=revision+1 WHERE id=$1", [item.objectId]);
      await insert("asset_receipt_state", { owner_id: owner, asset_id: item.assetId, object_id: item.objectId, current_receipt_id: body.id, status: "ready",
        revision: o.completedStateRevision, updated_at: at(o.completedAt) });
    });
    // Defensive: an observation that contradicts the registered bytes is refused by 0006 and leaves nothing behind.
    const before = await receiptCount();
    await assert.rejects(issue({ ...observation, bytes: { ...observation.bytes, sha256: "d".repeat(64) } }), { code: "23514", message: "receipt observation differs" });
    assert.equal(await receiptCount(), before);
    await issue(observation);
    assert.equal(await receiptCount(), before + 1);
    return { assetId: item.assetId, notAfter: body.notAfter };
  }

  try {
    const good = await register(users[0].id, "good", 600_000);
    const foreign = await register(users[1].id, "foreign", 600_000);
    const expired = await register(users[0].id, "expired", 1_000);
    while (Date.now() <= expired.notAfter + 50) await delay(100);
    const { rows: [state] } = await admin.query(`SELECT (SELECT count(*)::int FROM dream_reservation.upload_requests) AS requests,
      (SELECT count(*)::int FROM dream.storage_verification_receipts) AS receipts,
      (SELECT count(*)::int FROM dream.storage_verification_runs WHERE observed_json<>'{}') AS observed_runs`);
    assert.deepEqual(state, { requests: 3, receipts: 3, observed_runs: 3 });
    console.log(JSON.stringify({ reservedAssets: { restrictedLogin: "p2_reserve_api -> SET dream_api", staged: 3, receipts: state.receipts,
      observationRefusals: 3, expiredWaited: true } }));
    return { good: good.assetId, foreign: foreign.assetId, expired: expired.assetId };
  } finally { await api.end().catch(() => {}); }
}

// After the main HTTP flow: asset choices list only the caller's current receipts (not another owner's, not expired),
// and the 0005/0006 privileges are still the published ones.
export async function verifyDraftChoices({ admin, rootPath, projectRef, users, startProfile, body, good, foreign, expired }) {
  const sql = await read(rootPath, "lib/db/postgres/managed-project-core/0002_asset_choices.sql");
  await admin.query("SET ROLE p102_migrate");
  try {
    await admin.query("SELECT set_config('dream.project_core.install_ref',$1,false)", [projectRef]);
    assert.equal((await admin.query(sql)).at(-1).command, "COMMIT");
  } finally { await admin.query("RESET ROLE"); }
  const path = "/api/projects/asset-choices";
  await startProfile({}, async call => {
    await body(call(path, { actor: null }), 401);
    await body(call(path, { actor: 2 }), 403);
    assert.deepEqual(await body(call(path), 200), { assets: [{ id: good, title: draftAssetTitle, kind: "image" }] });
    assert.deepEqual(await body(call(path, { actor: 1 }), 200), { assets: [{ id: foreign, title: draftAssetTitle, kind: "image" }] });
    assert.deepEqual(await body(call(path + "?ownerId=" + users[1].id), 200), { assets: [{ id: good, title: draftAssetTitle, kind: "image" }] });
  });
  const { rows: [acl] } = await admin.query(`SELECT
    pg_get_userbyid(p.proowner) AS reserve_owner, p.prosecdef AS reserve_definer,
    has_function_privilege('dream_api',p.oid,'EXECUTE') AS api_reserve, has_function_privilege('dream_worker',p.oid,'EXECUTE') AS worker_reserve,
    has_function_privilege('dream_project_core_app',p.oid,'EXECUTE') AS app_reserve,
    has_table_privilege('dream_api','dream.storage_policies','SELECT') AS api_policies,
    has_table_privilege('dream_project_core_app','dream.storage_verification_receipts','INSERT') AS app_receipt_insert,
    (SELECT count(*)::int FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator')
      AND (has_schema_privilege(r.oid,'dream','USAGE') OR has_schema_privilege(r.oid,'dream_reservation','USAGE'))) AS browser_grants
    FROM pg_proc p WHERE p.oid='dream_reservation.reserve_upload_v1(uuid,text,text)'::regprocedure`);
  assert.deepEqual(acl, { reserve_owner: "dream_upload_reserver", reserve_definer: true, api_reserve: true, worker_reserve: false, app_reserve: false,
    api_policies: false, app_receipt_insert: false, browser_grants: 0 });
  // Every project created over HTTP is linked to a reserved asset: the owner's projects to `good`, the other owner's to `foreign`.
  const links = (await admin.query("SELECT pa.asset_id::text AS asset, count(*)::int AS n FROM dream.project_assets pa GROUP BY 1 ORDER BY 2 DESC")).rows;
  assert.deepEqual(links, [{ asset: good, n: 11 }, { asset: foreign, n: 1 }]);
  const { rows: [origin] } = await admin.query(`SELECT count(*)::int AS n FROM dream.storage_objects o
    JOIN dream_reservation.upload_requests r ON r.object_id=o.id WHERE o.registered_asset_id = ANY($1::uuid[]) AND o.lifecycle='registered'`, [[good, foreign, expired]]);
  assert.equal(origin.n, 3);
  console.log(JSON.stringify({ draftAssetChoices: { owner: [good], otherOwner: [foreign], expiredListed: false, projectLinks: { good: 11, foreign: 1 },
    reservedOrigin: origin.n, privileges: acl } }));
}
