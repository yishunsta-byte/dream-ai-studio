/* global console, process, URL */
// P2-MANAGED-ASSET-VERIFIER-OBSERVATION-DB: isolated synthetic PostgreSQL check of 0006_storage_observation.sql.
// PG17: P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/storage-observation.pg17.mjs
//   0001..0004 (+ managed-project-core for the app read path) are installed as in managed-project-core.pg17.mjs.
//   0005 requires PostgreSQL 18 by its own preflight and is not installed in this mode; its source stays checksum-verified.
// PG18: P102_PG_BIN=<pg18.7 bin> node --conditions=react-server --import tsx tests/postgres/storage-observation.pg17.mjs --pg18
//   the loader-verified published 0001..0005 bodies run in one explicit migration transaction by a LOGIN CREATEROLE owner,
//   with the synthetic bootstrap/owner native OIDs and the PG18 default createrole_self_grant boundary, then 0006.
//   managed-project-core is not installed: its own preflight accepts PostgreSQL 17 only (SQL unchanged). The same
//   app read query text then runs on the admin connection filtered by owner.
// PG17 draft: P102_PG_BIN=<pg17 bin> node --conditions=react-server --import tsx tests/postgres/storage-observation.pg17.mjs --pg17-draft
//   same owner/bootstrap/role checks as PG18, but the loader-verified published 0001..0004 bodies run with the unpublished
//   drafts/pg17_upload_reservation.sql body (published 0005 is checksum-verified, compared line by line, never executed),
//   then managed-project-core and 0006 in the same database. The app read runs as dream_project_core_app. Uploads are reserved through 0005 reserve_upload_v1 by a restricted dream_api login.
// Receipts come from the upload state model with observation v1; the DB rows are then written as an executor would.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { v7 } from "uuid";
import { reserveUpload, transition } from "../../lib/storage/uploads/state.ts";
import { canonicalJson, protocolDigest } from "../../lib/storage/uploads/receipt.ts";
import { decodeUploadReservation, encodeUploadReservation } from "../../lib/db/postgres/upload-reservation-codec.ts";
import { loadPostgresMigrationsV3 } from "../../lib/db/postgres/migration-manifest-v3.ts";
import { fixturePolicy } from "./managed-project-core-asset-fixture.mjs";

const root = new URL("../../", import.meta.url);
const read = async path => (await readFile(new URL(path, root), "utf8")).replaceAll("\r\n", "\n");
const sha = text => createHash("sha256").update(text).digest("hex");
const dh = (domain, raw) => sha(`${domain}:v1\n${raw}`);
const at = ms => new Date(ms).toISOString();
const clock = { last: 0 };
const tick = () => (clock.last = Math.max(Date.now(), clock.last + 1));
const pg18 = process.argv.slice(2).includes("--pg18");
const pg17Draft = process.argv.slice(2).includes("--pg17-draft");
assert(!(pg18 && pg17Draft));
// Both schema5-style modes reserve uploads through reserve_upload_v1 under the asset-upload policy.
const reserving = pg18 || pg17Draft;
const results = [];
const note = (name, value) => { results.push({ name, ...value }); console.log(JSON.stringify({ name, ...value })); };

const users = [1, 2].map(i => "10000000-0000-4000-8000-" + String(i).padStart(12, "0"));
const owner = users[0], worker = randomUUID(), collector = randomUUID(), manager = randomUUID();
const policy = reserving ? { id: "asset-upload", epoch: 1, digest: sha("p2obs-asset-upload-policy") } : { id: "p102-fixture", epoch: 1, digest: "b".repeat(64) };
// 0005 policy body for the PG18 reservation entry (same field set as the schema5 wire tests).
const policyBody = { bodyVersion: 1, collectors: [collector], incomingBucket: "p102-incoming", intentTtlMs: 600_000, issueEnvelopeMs: 60_000,
  keyRule: "owner/incoming/object/intent:v1", maxBytes: 1_048_576, maxIssues: 2, maxPreparationAgeMs: 60_000, policyManagers: [manager],
  providerMaxBytes: 1_048_576, verifiers: [worker] };
const versions = { verifierVersion: "observation-db-v1", toolVersion: "synthetic-probe-1" };
const mediaFor = kind => kind === "video" ? { width: 4, height: 6, durationMs: 1200 } : { width: 3, height: 2, durationMs: null };
const media = mediaFor("image");
const fp = protocolDigest("operation", { test: "storage-observation" });
const identityFor = (assetId, label, kind = "image") => {
  const bytes = `synthetic-object-${label}`, digest = sha(bytes), [mime, extension] = kind === "video" ? ["video/mp4", "mp4"] : ["image/png", "png"];
  return { ownerId: owner, assetId, bucket: "p102-final", key: `${owner}/assets/${assetId}/${digest}.${extension}`, sha256: digest,
    sizeBytes: bytes.length, kind, mime, providerVersion: null };
};
const finalSource = identity => ({ bucket: identity.bucket, key: identity.key, providerVersion: identity.providerVersion });
const observationOf = (kind, source, identity) => ({ v: 1, kind, source, bytes: { sha256: identity.sha256, sizeBytes: identity.sizeBytes },
  format: { mime: identity.mime, kind: identity.kind }, media: mediaFor(identity.kind), published: kind === "initial" ? { sha256: identity.sha256, sizeBytes: identity.sizeBytes } : null,
  tools: versions });

await withPostgres(async (admin, cluster) => {
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", users);
  if (reserving) {
    const raw = canonicalJson(policyBody);
    await admin.query("INSERT INTO dream.storage_policy_versions VALUES($1,$2,$3,clock_timestamp())", [policy.id, policy.epoch, policy.digest]);
    await admin.query("INSERT INTO dream_reservation.upload_policy_versions VALUES($1,$2,$3,$4,$5)", [policy.id, policy.epoch, policy.digest, raw, dh("upload-policy-body", raw)]);
    await admin.query("INSERT INTO dream.storage_policies VALUES($1,$2,$3,0,clock_timestamp())", [policy.id, policy.epoch, policy.digest]);
  } else await fixturePolicy(admin);
  const httpSource = await read("lib/cloud/managed-project-core-http.ts");
  const currentAssetReceipts = /const currentAssetReceipts = `([\s\S]*?)`;/.exec(httpSource)[1];
  const asRole = async (role, actor, sql, values = []) => {
    await admin.query("BEGIN");
    try {
      await admin.query(`SET LOCAL ROLE ${role}`); await admin.query("SELECT set_config('dream.actor_id',$1,true)", [actor]);
      const { rows } = await admin.query(sql, values); await admin.query("COMMIT"); return rows;
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
  };
  // PG17: the app role. PG18: dream_project_core_app does not exist (core install is PG17-only) and dream_api has no
  // storage_policies grant, so the same query text runs on the admin connection filtered by owner; RLS reads are checked as dream_api.
  const readQuery = `SELECT a.id ${currentAssetReceipts} ORDER BY a.id`;
  const visible = async () => (pg18 ? (await admin.query(readQuery, [owner])).rows : await asRole("dream_project_core_app", owner, readQuery, [owner])).map(r => r.id);
  const insert = (table, row) => { const keys = Object.keys(row);
    return admin.query(`INSERT INTO dream.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`, Object.values(row)); };
  const tx = async run => {
    await admin.query("BEGIN");
    try { await run(); await admin.query("COMMIT"); } catch (error) { await admin.query("ROLLBACK"); throw error; }
  };
  const counts = async () => (await admin.query(`SELECT (SELECT count(*)::int FROM dream.storage_verification_receipts) AS receipts,
    (SELECT count(*)::int FROM dream.storage_verification_runs) AS runs`)).rows[0];

  // ---------- model + executor-style DB writes ----------
  const apply = (s, command, principal = worker) => transition(s, command, { principalId: principal, now: tick(), expectedRevision: s.revision });
  const opOf = (s, id) => s.operations.find(o => o.id === id);
  const reservations = [];
  // PG18: the 0005 entry point, as a restricted login acting as dream_api; the stored rows decode back to the same model.
  async function reserveThroughSchema5(label, kind) {
    const api = cluster.api, requestId = v7(), objectId = v7(), assetId = v7(), intentId = v7();
    const client = canonicalJson({ claimedMime: kind === "video" ? "video/mp4" : "image/png", clientVersion: 1, requestedMaxBytes: policyBody.maxBytes });
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
      reservations.push({ label, tag: staged.tag, decoded: true });
      return { model, objectId, assetId, intentId, identity: identityFor(assetId, label, kind) };
    } catch (error) { await api.query("ROLLBACK").catch(() => {}); throw error; }
  }
  async function reserve(label, kind = "image") {
    if (reserving) return reserveThroughSchema5(label, kind);
    const assetId = v7(), intentId = v7(), reservedAt = tick();
    const value = { ownerId: owner, objectId: v7(), assetId, intentId, intentExpiresAt: reservedAt + 600_000, issueEnvelopeUntil: reservedAt + 60_000,
      maxIssues: 2, verifiers: [worker], collectors: [collector], policyManagers: [manager], policyEpoch: policy.epoch, policyDigest: policy.digest,
      incoming: { bucket: "p102-incoming", key: `${owner}/incoming/${intentId}/nonce`, providerVersion: null } };
    const model = reserveUpload(value, { principalId: owner, now: reservedAt, expectedRevision: 0 });
    const encoded = encodeUploadReservation({ model, requestJson: canonicalJson({ codecVersion: 1, requestId: v7(), maxBytes: 1024 * 1024, reservedAt, reservation: value }) });
    await admin.query(encoded.object.text, encoded.object.values);
    await admin.query(encoded.intent.text, encoded.intent.values);
    return { model, objectId: model.objectId, assetId, intentId, identity: identityFor(assetId, label, kind) };
  }
  const begin = async (item, o) => tx(async () => {
    await insert("storage_verification_operations", { owner_id: owner, id: o.id, object_id: item.objectId, intent_id: o.kind === "initial" ? item.intentId : null,
      kind: o.kind, generation: o.generation, request_fingerprint: o.fingerprint, request_json: "{}", request_raw_sha: sha("{}"), policy_id: policy.id,
      policy_epoch: o.policyEpoch, policy_digest: o.policyDigest, authorization_until: at(o.authorizationUntil), expected_state_revision: o.expectedStateRevision,
      fence: 0, status: "pending", revision: 0, created_at: at(o.createdAt) });
    await admin.query("UPDATE dream.storage_objects SET active_generation=$2,revision=revision+1 WHERE id=$1", [item.objectId, o.generation]);
  });
  const claim = async (item, o) => tx(async () => {
    await admin.query("UPDATE dream.storage_verification_operations SET status='running',fence=$2,worker_id=$3,claimed_at=$4,claim_verifiers=$5::uuid[],lease_until=$6,revision=revision+1 WHERE id=$1",
      [o.id, o.fence, o.workerId, at(o.claimedAt), o.claimVerifiers, at(o.leaseUntil)]);
    await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [item.objectId]);
  });
  // Model through finalize (observation v1 enforced by the model), DB through claim/publication. Nothing issued in the DB yet.
  async function prepareInitial(item) {
    const op = v7(), receipt = v7();
    let s = apply(item.model, { type: "complete", operationId: op, kind: "initial", fingerprint: fp, authorizationUntil: tick() + 300_000 }, owner);
    s = apply(s, { type: "claim", operationId: op, fingerprint: fp, expectedFence: 0, leaseUntil: opOf(s, op).authorizationUntil });
    const published = apply(s, { type: "reservePublication", operationId: op, fingerprint: fp, expectedFence: 1, identity: item.identity });
    const observation = observationOf("initial", item.model.incoming, item.identity);
    const done = apply(published, { type: "finalize", operationId: op, fingerprint: fp, expectedFence: 1, receiptId: receipt, identity: item.identity,
      source: item.model.incoming, media: mediaFor(item.identity.kind), notAfter: Date.now() + 600_000, ...versions, observation });
    const o = opOf(done, op);
    await begin(item, o); await claim(item, o);
    await admin.query("UPDATE dream.storage_objects SET lifecycle='publication_reserved',bucket=$2,object_key=$3,kind=$4,mime=$5,sha256=$6,size_bytes=$7,identity_json=$8,identity_digest=$9,publication_json=$10,revision=revision+1 WHERE id=$1",
      [item.objectId, item.identity.bucket, item.identity.key, item.identity.kind, item.identity.mime, item.identity.sha256, item.identity.sizeBytes,
        canonicalJson(item.identity), protocolDigest("object-identity", item.identity), canonicalJson(published.publication)]);
    const m = mediaFor(item.identity.kind);
    await insert("assets", { owner_id: owner, id: item.assetId, kind: item.identity.kind, title: "Synthetic observation", role: "original", file_path: item.identity.key,
      mime: item.identity.mime, sha256: item.identity.sha256, size_bytes: item.identity.sizeBytes, width: m.width, height: m.height, duration_ms: m.durationMs,
      origin: "upload", created_at: at(item.model.reservedAt) });
    return { item, model: done, op: o, receipt: done.receipts.find(r => r.body.id === receipt), observation };
  }
  async function prepareReverify(item, base) {
    const op = v7(), receipt = v7();
    let s = apply(base, { type: "complete", operationId: op, kind: "reverify", fingerprint: fp, authorizationUntil: tick() + 300_000 }, owner);
    const claimed = apply(s, { type: "claim", operationId: op, fingerprint: fp, expectedFence: 0, leaseUntil: opOf(s, op).authorizationUntil });
    const observation = observationOf("reverify", finalSource(item.identity), item.identity);
    const done = apply(claimed, { type: "finalize", operationId: op, fingerprint: fp, expectedFence: 1, receiptId: receipt, identity: item.identity,
      source: finalSource(item.identity), media: mediaFor(item.identity.kind), notAfter: Date.now() + 600_000, ...versions, observation });
    const o = opOf(done, op);
    await begin(item, o); await claim(item, o);
    return { item, claimed, model: done, op: o, receipt: done.receipts.find(r => r.body.id === receipt), observation };
  }
  // One issuance transaction as the executor writes it. `observed` is the raw observed_json; overrides tamper the run row.
  async function issue(prep, observed, overrides = {}) {
    const { item, op: o, receipt: r } = prep, body = r.body, runId = v7(), raw = typeof observed === "string" ? observed : canonicalJson(observed);
    await tx(async () => {
      await insert("storage_verification_runs", { owner_id: owner, id: runId, object_id: item.objectId, operation_id: o.id, generation: o.generation, fence: o.fence,
        worker_id: overrides.workerId ?? o.workerId, outcome: "succeeded", observed_json: raw, observed_sha: sha(raw), recorded_at: at(overrides.recordedAt ?? o.completedAt) });
      await insert("storage_verification_receipts", { owner_id: owner, id: body.id, object_id: item.objectId, asset_id: body.identity.assetId, operation_id: o.id,
        run_id: runId, generation: body.generation, fence: body.fence, identity_digest: protocolDigest("object-identity", body.identity), policy_id: policy.id,
        policy_epoch: body.policyEpoch, policy_digest: body.policyDigest, source_bucket: body.source.bucket, source_key: body.source.key,
        source_version: body.source.providerVersion, width: overrides.width ?? body.media.width, height: body.media.height, duration_ms: body.media.durationMs,
        verifier_id: body.verifierId, verifier_version: body.verifierVersion, tool_version: body.toolVersion, verified_at: at(body.verifiedAt),
        not_after: at(body.notAfter), receipt_json: canonicalJson(body), receipt_digest: r.digest });
      const terminal = canonicalJson({ status: "succeeded", receiptId: body.id });
      await admin.query("UPDATE dream.storage_verification_operations SET status='succeeded',terminal_receipt_id=$2,terminal_json=$3,terminal_digest=$4,completed_at=$5,completed_state_revision=$6,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$7),revision=revision+1 WHERE id=$1",
        [o.id, body.id, terminal, dh("verification-terminal", terminal), at(o.completedAt), o.completedStateRevision, item.objectId]);
      if (o.kind === "initial") {
        await admin.query("UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=reserved_asset_id,revision=revision+1 WHERE id=$1", [item.objectId]);
        await insert("asset_receipt_state", { owner_id: owner, asset_id: item.assetId, object_id: item.objectId, current_receipt_id: body.id, status: "ready",
          revision: o.completedStateRevision, updated_at: at(o.completedAt) });
      } else {
        await admin.query("UPDATE dream.asset_receipt_state SET current_receipt_id=$2,revision=$3,updated_at=$4 WHERE object_id=$1", [item.objectId, body.id, o.completedStateRevision, at(o.completedAt)]);
        await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [item.objectId]);
      }
    });
    return r;
  }
  const refused = async (label, prep, observed, overrides) => {
    const before = await counts();
    try { await issue(prep, observed, overrides); }
    catch (error) {
      assert.deepEqual(await counts(), before, label);
      return { label, code: error.code, message: error.message };
    }
    throw new Error(`accepted: ${label}`);
  };

  // ---------- 1) a pre-observation receipt (run observed_json '{}') before 0006 ----------
  const legacy = await reserve("legacy");
  const legacyPrep = await prepareInitial(legacy);
  await issue(legacyPrep, "{}");
  assert((await visible()).includes(legacy.assetId));
  const snapshot = async () => ({
    rows: (await admin.query(`SELECT
      (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)) FROM dream.storage_verification_runs t) AS runs,
      (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)) FROM dream.storage_verification_receipts t) AS receipts,
      (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)) FROM dream.storage_verification_operations t) AS operations,
      (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id)) FROM dream.storage_objects t) AS objects,
      (SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY t.asset_id)) FROM dream.asset_receipt_state t) AS receipt_state`)).rows[0],
    visible: await visible(),
    apiReceipts: (await asRole("dream_api", owner, "SELECT id,receipt_digest FROM dream.storage_verification_receipts ORDER BY id")),
    apiRuns: (await asRole("dream_api", owner, "SELECT id,observed_json FROM dream.storage_verification_runs ORDER BY id")),
    otherOwnerReceipts: (await asRole("dream_api", users[1], "SELECT id FROM dream.storage_verification_receipts")).length,
    privileges: (await admin.query(`SELECT string_agg(format('%s/%s/%s', r.rolname, c.relname, p.privilege), ',' ORDER BY r.rolname, c.relname, p.privilege) AS granted
      FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='dream'
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilege)
      WHERE r.rolname IN ('dream_api','dream_worker','dream_project_core_app','dream_upload_reserver','anon','authenticated','authenticator') AND c.relkind='r'
        AND has_table_privilege(r.oid, c.oid, p.privilege)`)).rows[0].granted,
    functions: (await admin.query(`SELECT string_agg(format('%s:%s:%s', p.proname, md5(p.prosrc), coalesce(p.proacl::text,'')), ',' ORDER BY p.proname) AS f
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('dream','dream_reservation') AND p.proname<>'storage_observation_guard'`)).rows[0].f,
    triggers: (await admin.query(`SELECT string_agg(format('%s.%s:%s', c.relname, t.tgname, t.tgfoid::regprocedure), ',' ORDER BY c.relname, t.tgname) AS t
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='dream' AND NOT t.tgisinternal AND t.tgname<>'storage_observation'`)).rows[0].t,
    manifest: (await loadPostgresMigrationsV3(5)).map(e => `${e.id}:${e.checksum}`),
  });
  const before = await snapshot();
  assert.equal(before.manifest.length, 5);
  assert(!(await read("lib/db/postgres/migration-manifest-v3.ts")).includes("0006"));

  // ---------- 2) install 0006: preflight refusals, then the real install ----------
  const sql = await read("lib/db/postgres/0006_storage_observation.sql");
  await assert.rejects(admin.query(sql), { message: "STORAGE_OBSERVATION_PREFLIGHT" }); // superuser installer refused
  await admin.query("ROLLBACK");
  const empty = await cluster.connect("p2obs_empty");
  try {
    await empty.query("SET ROLE p102_migrate"); await empty.query("CREATE SCHEMA dream");
    await assert.rejects(empty.query(sql), { message: "STORAGE_OBSERVATION_PREFLIGHT" }); // no 0004 tables
    await empty.query("ROLLBACK");
  } finally { await empty.end(); }
  await admin.query("SET ROLE p102_migrate");
  try {
    assert.equal((await admin.query(sql)).at(-1).command, "COMMIT");
    await assert.rejects(admin.query(sql), { message: "STORAGE_OBSERVATION_PREFLIGHT" }); // second install refused
    await admin.query("ROLLBACK");
  } finally { await admin.query("RESET ROLE"); }
  const after = await snapshot();
  assert.deepEqual(after, before);
  const { rows: [fn] } = await admin.query(`SELECT p.prosecdef, p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner,
    has_function_privilege('dream_api','dream.storage_observation_guard()','EXECUTE') AS api_exec,
    has_function_privilege('dream_worker','dream.storage_observation_guard()','EXECUTE') AS worker_exec,
    (SELECT count(*)::int FROM pg_trigger WHERE tgname='storage_observation') AS triggers FROM pg_proc p WHERE p.oid='dream.storage_observation_guard()'::regprocedure`);
  note("install", { preflightRefusals: ["superuser", "missing 0004", "second install"], existingUnchanged: true, rows: after.rows, visible: after.visible.length,
    apiReceipts: after.apiReceipts.length, legacyRun: after.apiRuns.map(r => r.observed_json), manifest: after.manifest.map(e => e.split(":")[0]),
    function: fn });
  assert.deepEqual({ ...fn, acl: undefined }, { prosecdef: false, acl: undefined, owner: "p102_migrate", api_exec: false, worker_exec: false, triggers: 1 });

  // ---------- 3) new initial issuance ----------
  const fresh = await reserve("fresh");
  const initial = await prepareInitial(fresh);
  const good = initial.observation;
  const tampered = patch => canonicalJson({ ...good, ...patch });
  const initialRefusals = [
    await refused("legacy empty observation", initial, "{}"),
    await refused("version 2", initial, tampered({ v: 2 })),
    await refused("extra key", initial, canonicalJson({ ...good, note: "x" })),
    await refused("missing key", initial, canonicalJson(Object.fromEntries(Object.entries(good).filter(([key]) => key !== "tools")))),
    await refused("kind reverify", initial, tampered({ kind: "reverify" })),
    await refused("source is final key", initial, tampered({ source: finalSource(fresh.identity) })),
    await refused("hash", initial, tampered({ bytes: { ...good.bytes, sha256: "d".repeat(64) } })),
    await refused("size", initial, tampered({ bytes: { ...good.bytes, sizeBytes: good.bytes.sizeBytes + 1 } })),
    await refused("mime", initial, tampered({ format: { mime: "image/jpeg", kind: "image" } })),
    await refused("format undetected", initial, tampered({ format: null })),
    await refused("media", initial, tampered({ media: { ...media, width: 4 } })),
    await refused("published missing", initial, tampered({ published: null })),
    await refused("published hash", initial, tampered({ published: { ...good.published, sha256: "e".repeat(64) } })),
    await refused("tools", initial, tampered({ tools: { ...versions, toolVersion: "other" } })),
    await refused("run by another worker", initial, good, { workerId: randomUUID() }),
    await refused("run recorded after receipt", initial, good, { recordedAt: initial.op.completedAt + 1000 }),
  ];
  assert(initialRefusals.every(r => r.code === "23514" && r.message === "receipt observation differs"));
  // Existing receipt checks still run first: a column/JSON mismatch reports the 0004 error even with a bad observation.
  const precedence = await refused("receipt columns differ and observation empty", initial, "{}", { width: 99 });
  assert.equal(precedence.message, "receipt asset/media tuple differs"); // 0004 storage_guard message
  const issued = await issue(initial, good);
  const { rows: [stored] } = await admin.query("SELECT receipt_digest,receipt_json FROM dream.storage_verification_receipts WHERE id=$1", [issued.body.id]);
  note("initial", { refusals: initialRefusals.map(r => `${r.label}:${r.code}`), precedence: precedence.message, committed: true, digestEqualsModel: stored.receipt_digest === issued.digest,
    jsonEqualsModel: stored.receipt_json === canonicalJson(issued.body), visible: (await visible()).includes(fresh.assetId) });
  assert(stored.receipt_digest === issued.digest && (await visible()).includes(fresh.assetId));

  // ---------- 4) new reverify issuance ----------
  const reverify = await prepareReverify(fresh, initial.model);
  const goodR = reverify.observation;
  const tamperedR = patch => canonicalJson({ ...goodR, ...patch });
  const reverifyRefusals = [
    await refused("legacy empty observation", reverify, "{}"),
    await refused("published present", reverify, tamperedR({ published: { ...goodR.bytes } })),
    await refused("source is incoming", reverify, tamperedR({ source: fresh.model.incoming })),
    await refused("kind initial", reverify, tamperedR({ kind: "initial", published: { ...goodR.bytes } })),
    await refused("hash", reverify, tamperedR({ bytes: { ...goodR.bytes, sha256: "d".repeat(64) } })),
    await refused("media", reverify, tamperedR({ media: { ...media, height: 9 } })),
  ];
  assert(reverifyRefusals.every(r => r.code === "23514" && r.message === "receipt observation differs"));
  await issue(reverify, goodR);
  const generations = async objectId => (await admin.query("SELECT generation::int, (SELECT observed_json FROM dream.storage_verification_runs u WHERE u.id=r.run_id) AS observed FROM dream.storage_verification_receipts r WHERE object_id=$1 ORDER BY generation", [objectId])).rows;
  note("reverify", { refusals: reverifyRefusals.map(r => `${r.label}:${r.code}`), committed: true,
    generations: (await generations(fresh.objectId)).map(r => r.generation), visible: (await visible()).includes(fresh.assetId) });

  // ---------- 4b) video (durationMs present): initial and reverify ----------
  const clip = await reserve("clip", "video");
  const clipInitial = await prepareInitial(clip);
  const clipRefusal = await refused("video duration differs", clipInitial, canonicalJson({ ...clipInitial.observation, media: { ...clipInitial.observation.media, durationMs: 1201 } }));
  await issue(clipInitial, clipInitial.observation);
  const clipReverify = await prepareReverify(clip, clipInitial.model);
  const clipReverifyRefusal = await refused("video reverify image media", clipReverify, canonicalJson({ ...clipReverify.observation, media: { ...clipReverify.observation.media, durationMs: null } }));
  await issue(clipReverify, clipReverify.observation);
  note("video", { refusals: [clipRefusal, clipReverifyRefusal].map(r => `${r.label}:${r.code}:${r.message}`), generations: (await generations(clip.objectId)).map(r => r.generation),
    visible: (await visible()).includes(clip.assetId) });
  assert(clipRefusal.message === "receipt observation differs" && clipReverifyRefusal.message === "receipt observation differs");

  // ---------- 5) a legacy object keeps its old receipt and can be reverified only with observation v1 ----------
  const legacyReverify = await prepareReverify(legacy, legacyPrep.model);
  const legacyRefusal = await refused("legacy reverify without observation", legacyReverify, "{}");
  await issue(legacyReverify, legacyReverify.observation);
  const legacyHistory = await generations(legacy.objectId);
  note("legacy-compatibility", { refusal: `${legacyRefusal.code}:${legacyRefusal.message}`, generations: legacyHistory.map(r => r.generation),
    firstRunObservation: legacyHistory[0].observed, secondRunObservationVersion: JSON.parse(legacyHistory[1].observed).v, visible: (await visible()).includes(legacy.assetId) });
  assert.deepEqual(legacyHistory.map(r => r.generation), [1, 2]);
  assert.equal(legacyHistory[0].observed, "{}");

  // ---------- 6) a failed reverify still records its run (no receipt), unaffected by 0006 ----------
  const failOp = v7();
  let s = apply(reverify.model, { type: "complete", operationId: failOp, kind: "reverify", fingerprint: fp, authorizationUntil: tick() + 300_000 }, owner);
  s = apply(s, { type: "claim", operationId: failOp, fingerprint: fp, expectedFence: 0, leaseUntil: opOf(s, failOp).authorizationUntil });
  const failObservation = { ...observationOf("reverify", finalSource(fresh.identity), fresh.identity), bytes: { sha256: "d".repeat(64), sizeBytes: fresh.identity.sizeBytes } };
  const failed = apply(s, { type: "rejectVerification", operationId: failOp, fingerprint: fp, expectedFence: 1, failureCode: "HASH_MISMATCH", observation: failObservation });
  const fo = opOf(failed, failOp);
  await begin(fresh, fo); await claim(fresh, fo);
  const countsBeforeFailure = await counts();
  await tx(async () => {
    const raw = canonicalJson(failObservation);
    await insert("storage_verification_runs", { owner_id: owner, id: v7(), object_id: fresh.objectId, operation_id: failOp, generation: fo.generation, fence: fo.fence,
      worker_id: fo.workerId, outcome: "failed", observed_json: raw, observed_sha: sha(raw), recorded_at: at(fo.completedAt) });
    const terminal = canonicalJson({ status: "failed", code: fo.failureCode });
    await admin.query("UPDATE dream.storage_verification_operations SET status='failed',failure_code=$2,terminal_json=$3,terminal_digest=$4,completed_at=$5,completed_state_revision=$6,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$7),revision=revision+1 WHERE id=$1",
      [failOp, fo.failureCode, terminal, dh("verification-terminal", terminal), at(fo.completedAt), fo.completedStateRevision, fresh.objectId]);
    await admin.query("UPDATE dream.asset_receipt_state SET status='unavailable',revocation_history_json=$2,revision=$3,updated_at=$4 WHERE object_id=$1",
      [fresh.objectId, canonicalJson(failed.revocations), failed.stateRevision, at(fo.completedAt)]);
    await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1", [fresh.objectId]);
  });
  const countsAfterFailure = await counts();
  note("failed-reverify", { committed: true, receipts: [countsBeforeFailure.receipts, countsAfterFailure.receipts], runs: [countsBeforeFailure.runs, countsAfterFailure.runs],
    visible: (await visible()).includes(fresh.assetId) });
  assert.equal(countsAfterFailure.receipts, countsBeforeFailure.receipts);
  assert.equal(countsAfterFailure.runs, countsBeforeFailure.runs + 1);
  assert(!(await visible()).includes(fresh.assetId));

  // ---------- 7) existing permissions and published functions after all writes ----------
  const end = await snapshot();
  assert.equal(end.privileges, before.privileges);
  assert.equal(end.functions, before.functions);
  assert.equal(end.triggers, before.triggers);
  assert.deepEqual(end.manifest, before.manifest);
  assert.equal(end.otherOwnerReceipts, 0);
  const schema5 = reserving ? (await admin.query(`SELECT (SELECT count(*)::int FROM dream_reservation.upload_requests) AS requests,
    pg_get_userbyid(p.proowner) AS owner, p.prosecdef, has_function_privilege('dream_api', p.oid, 'EXECUTE') AS api_exec,
    has_function_privilege('dream_worker', p.oid, 'EXECUTE') AS worker_exec
    FROM pg_proc p WHERE p.oid='dream_reservation.reserve_upload_v1(uuid,text,text)'::regprocedure`)).rows[0] : null;
  if (reserving) assert.deepEqual(schema5, { requests: reservations.length, owner: "dream_upload_reserver", prosecdef: true, api_exec: true, worker_exec: false });
  // The restricted app role never sees another owner's current receipts (RLS), asked for by that owner id or its own.
  const otherOwnerAppRows = pg18 ? null : [...await asRole("dream_project_core_app", users[1], readQuery, [owner]), ...await asRole("dream_project_core_app", users[1], readQuery, [users[1]])].length;
  if (!pg18) assert.equal(otherOwnerAppRows, 0);
  note("final", { schema5Reservations: reserving ? { ...schema5, staged: reservations.map(r => r.label) } : "not installed (PG17)",
    appRole: pg18 ? "admin connection, owner filter" : "dream_project_core_app", ownerAppRows: (await visible()).length, otherOwnerAppRows, privilegesUnchanged: true, publishedFunctionsUnchanged: true, triggersUnchanged: true, manifestUnchanged: true,
    apiReceipts: end.apiReceipts.length, otherOwnerReceipts: end.otherOwnerReceipts, counts: await counts() });
});
if (process.env.STORAGE_OBSERVATION_RESULTS) await writeFile(process.env.STORAGE_OBSERVATION_RESULTS, JSON.stringify(results, null, 2) + "\n", { flag: "wx" });

// ---------- isolated PostgreSQL 17 (managed-project-core.pg17.mjs order), 18 (schema5, --pg18) or 17 with the draft (--pg17-draft) ----------
async function withPostgres(body) {
  const run = promisify(execFile), loopback = "127.0.0.1", projectRef = "abcdefghijklmnopqrst";
  const bin = await realpath(process.env.P102_PG_BIN);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP|PATH)$/i.test(name)));
  const pgExec = (name, args) => run(join(bin, name + ".exe"), args, { env, windowsHide: true, timeout: 120_000 });
  const freePort = async () => { const s = createServer(); await new Promise((ok, no) => s.once("error", no).listen(0, loopback, ok));
    const port = s.address().port; await new Promise(ok => s.close(ok)); return port; };
  const parent = await realpath(tmpdir());
  const dir = await mkdtemp(join(parent, "dream-p2obs-"));
  const data = join(dir, "cluster"), password = randomBytes(28).toString("hex"), port = await freePort();
  let started = false, admin, api;
  const connect = async (database, user = "p102_root", secret = password) => { const client = new pg.Client({ host: loopback, port, database, user, password: secret, connectionTimeoutMillis: 5000, query_timeout: 15000 });
    await client.connect(); return client; };
  try {
    const pw = join(dir, "bootstrap.txt");
    await writeFile(pw, password + "\n", { flag: "wx" });
    await pgExec("initdb", ["-D", data, "--username=p102_root", "--pwfile=" + pw, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
    await rm(pw); started = true;
    const output = await open(join(dir, "pg-start.log"), "wx");
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(join(bin, "pg_ctl.exe"), ["-D", data, "-l", join(dir, "postgres.log"), "-o", "-h " + loopback + " -p " + port + " -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length_on_error=0", "-w", "-t", "30", "start"],
          { env, windowsHide: true, stdio: ["ignore", output.fd, output.fd], timeout: 40_000 });
        child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Local PostgreSQL startup failed.")));
      });
    } finally { await output.close(); }
    admin = await connect("postgres");
    const version = (await admin.query("SHOW server_version")).rows[0].server_version;
    assert.match(version, pg18 ? /^18\./ : /^17\./);
    const selfGrant = (await admin.query("SELECT current_setting('createrole_self_grant') AS v")).rows[0].v;
    note("postgres", { mode: pg18 ? "pg18-schema5" : pg17Draft ? "pg17-draft" : "pg17", version, loopback, createroleSelfGrant: selfGrant });
    await admin.query("CREATE DATABASE p2obs_empty");
    await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE authenticator NOLOGIN");
    if (!reserving) {
      await admin.query("CREATE ROLE p102_migrate NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS CREATEROLE; GRANT CREATE ON DATABASE postgres, p2obs_empty TO p102_migrate; GRANT USAGE ON SCHEMA auth TO p102_migrate; GRANT REFERENCES ON auth.users TO p102_migrate; SET ROLE p102_migrate");
      for (const file of ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql", "0004_storage_verification.sql"])
        assert.equal((await admin.query(await read("lib/db/postgres/" + file))).at(-1).command, "COMMIT");
      await admin.query("SELECT set_config('dream.project_core.install_ref',$1,false)", [projectRef]);
      assert.equal((await admin.query(await read("lib/db/postgres/managed-project-core/0001_install.sql"))).at(-1).command, "COMMIT");
      await admin.query("RESET ROLE");
    } else {
      // Synthetic LOGIN owner; its password lives only in memory and the server logs no statements.
      const ownerSecret = randomBytes(24).toString("hex");
      await admin.query(`CREATE ROLE p102_migrate LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOREPLICATION PASSWORD '${ownerSecret}'`);
      await admin.query("GRANT CREATE ON DATABASE postgres, p2obs_empty TO p102_migrate; GRANT USAGE ON SCHEMA auth TO p102_migrate; GRANT REFERENCES ON auth.users TO p102_migrate");
      const { rows: [ids] } = await admin.query("SELECT oid::text AS owner, (SELECT oid::text FROM pg_roles WHERE rolname='p102_root' AND rolsuper) AS bootstrap FROM pg_roles WHERE rolname='p102_migrate' AND rolcreaterole AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit");
      assert(ids?.owner && ids.bootstrap && ids.owner !== ids.bootstrap);
      const sources = await loadPostgresMigrationsV3(5), major = pg18 ? "18" : "17";
      let bodies = sources, draft = null;
      if (pg17Draft) {
        // Published 0005 is re-read and must be the loader-verified bytes; the draft may differ only in its header
        // comment (lines 1-3) and the two server-major preflight lines (15-16, 18 -> 17). Only the draft body runs.
        const published = await read("lib/db/postgres/0005_upload_reservation.sql"), raw = await read("lib/db/postgres/drafts/pg17_upload_reservation.sql");
        assert.equal(sha(published), sources[4].checksum);
        const a = published.split("\n"), b = raw.split("\n");
        assert.equal(a.length, b.length);
        const differing = a.flatMap((line, i) => line === b[i] ? [] : [i + 1]);
        assert.deepEqual(differing, [1, 2, 3, 15, 16]);
        for (const n of [15, 16]) assert.equal(b[n - 1], a[n - 1].replace(/18/g, "17"));
        const start = raw.indexOf("\nBEGIN;\n") + 8, end = raw.lastIndexOf("\nCOMMIT;");
        assert(start > 8 && end > start && raw.slice(end) === "\nCOMMIT;\n" && raw.indexOf("\nBEGIN;\n", start) === -1);
        draft = { id: "drafts/pg17_upload_reservation", sha256: sha(raw), differingLines: differing, sql: raw.slice(start, end) };
        bodies = [...sources.slice(0, 4), draft];
      }
      const migration = await connect("postgres", "p102_migrate", ownerSecret);
      try {
        await migration.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await migration.query("SET LOCAL search_path=pg_catalog");
        await migration.query("SELECT pg_catalog.set_config('dream.b27_migration_owner_oid',$1,true),pg_catalog.set_config('dream.b27_bootstrap_oid',$2,true),pg_catalog.set_config('dream.b27_expected_pg_major',$3,true)", [ids.owner, ids.bootstrap, major]);
        for (const entry of bodies) await migration.query(entry.sql);
        assert.equal((await migration.query("COMMIT")).command, "COMMIT");
        const edges = (await admin.query("SELECT roleid::regrole::text AS role, grantor::text AS grantor, admin_option, inherit_option, set_option FROM pg_auth_members WHERE member=$1::oid OR roleid=$1::oid ORDER BY 1", [ids.owner])).rows;
        assert.deepEqual(edges.map(e => e.role), ["dream_api", "dream_upload_reserver", "dream_worker"]);
        assert(edges.every(e => e.grantor === ids.bootstrap && e.admin_option && !e.inherit_option && !e.set_option));
        if (pg17Draft) {
          await migration.query("SELECT set_config('dream.project_core.install_ref',$1,false)", [projectRef]);
          assert.equal((await migration.query(await read("lib/db/postgres/managed-project-core/0001_install.sql"))).at(-1).command, "COMMIT");
        }
        note("schema5-install", { verifiedPublished: sources.map(e => `${e.id}:${e.checksum}`), executed: bodies.map(e => e.id),
          draft: draft && { id: draft.id, sha256: draft.sha256, differingLinesFromPublished0005: draft.differingLines }, oneTransaction: true,
          ownerEdges: edges.map(e => `${e.role}:admin`), edgeGrantorIsBootstrap: true,
          managedProjectCore: pg17Draft ? "COMMIT" : "not installed (its preflight requires PostgreSQL 17)",
          appReadRole: pg17Draft ? "dream_project_core_app" : "admin connection, owner filter" });
      } finally { await migration.end().catch(() => {}); }
      const apiSecret = randomBytes(24).toString("hex");
      await admin.query(`CREATE ROLE p2obs_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${apiSecret}'`);
      await admin.query("GRANT dream_api TO p2obs_api WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
      api = await connect("postgres", "p2obs_api", apiSecret);
    }
    await body(admin, { connect, api });
  } finally {
    await api?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (started) await pgExec("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "50", "stop"]).catch(() => {});
    const actual = await realpath(dir);
    assert.equal(dirname(actual), parent); assert.match(basename(actual), /^dream-p2obs-[A-Za-z0-9]+$/);
    await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}
