import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type ClientConfig, type QueryResultRow } from "pg";
import { v7 } from "uuid";
import { resolveServerAuth } from "../../lib/auth/resolve";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { localPrivateWav } from "../../lib/cloud/local-private-wav";
import type { VerifiedActor } from "../../lib/db/postgres/types";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";
import { createIsolatedRegisteredPcmWavAnalysis } from "../../lib/reference-analysis/studio-registered-pcm-wav-analysis";
import { inspectPcmWav } from "../../lib/services/postgres/pcm-wav";

type Fixture = {
  admin: Client; cfg: ClientConfig & { host: string; database: string; port: number; password: string };
  a: VerifiedActor; b: VerifiedActor; baselineProject: string; storagePort: number;
};
type Selection = { projectId: string; assetId: string };
type Evidence = QueryResultRow & {
  content: Buffer; sha256: string; size_bytes: number; file_path: string;
  registration_generation: number; approval_generation: number;
};
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const unavailable = { schemaVersion: 1, status: "unavailable", reason: "source_unavailable" };
const rightsNote = "SYNTHETIC_TEST_RIGHTS_NOTE";
const origin = "http://127.0.0.1:39970";

function wav(peak: number) {
  const frames = 1000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE((frame % 2 ? 1 : -1) * peak, 44 + 2 * frame);
  return bytes;
}

export async function verify({ admin, cfg, a, b, baselineProject, storagePort }: Fixture) {
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.database, "dream_test_t367");
  assert(Number.isInteger(cfg.port) && cfg.port > 0 && cfg.port <= 65535);
  const { installOwnedWav } = await import(new URL("../postgres/private-wav-http.mjs", import.meta.url).href) as
    { installOwnedWav: (client: Client, config: ClientConfig) => Promise<void> };
  const { withFixtureAuth } = await import(new URL("../../lib/auth/resolve.ts", import.meta.url).href) as
    { withFixtureAuth: <T>(result: ServerAuthResult, run: () => Promise<T>) => Promise<T> };
  assert.equal(typeof withFixtureAuth, "function");
  const verified = (actor: VerifiedActor) => ({ kind: "verified", userId: actor.id, email: "fixture@example.invalid" }) as const;

  await installOwnedWav(admin, cfg);
  await admin.query(await readFile(new URL("registered-pcm-wav-authority.fixture.sql", import.meta.url), "utf8"));
  const { rows: [credential] } = await admin.query("SELECT quote_literal($1::text) AS quoted", [cfg.password]);
  await admin.query("CREATE ROLE pcm_fixture_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD " + credential.quoted);
  await admin.query("GRANT pcm_fixture_reader TO pcm_fixture_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
  const reader = new Client({ ...cfg, user: "pcm_fixture_login", application_name: "pcm-wav-authority-fixture" });
  const root = await realpath(await mkdtemp(join(await realpath(tmpdir()), "dream-pcm-approved-")));
  const env = { DREAM_PRIVATE_UPLOAD_BACKEND: "owned-pg17", DREAM_OWNED_CREATE_PG_PORT: String(cfg.port),
    DREAM_OWNED_CREATE_PG_PASSWORD: cfg.password, DREAM_AUTH_MODE: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + storagePort, FFMPEG_PATH: "", FFPROBE_PATH: "" };
  const prior = Object.keys(env).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, env);

  try {
    await reader.connect();
    const asOwner = async <T>(actor: VerifiedActor, run: () => Promise<T>) => {
      await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL ROLE pcm_fixture_reader");
      try {
        await reader.query("SELECT set_config('dream.actor_id',$1,true)", [actor.id]);
        return await run();
      } finally { await reader.query("ROLLBACK"); }
    };
    const ownBytes = (actor: VerifiedActor, id: string) => asOwner(actor, async () =>
      (await reader.query("SELECT asset_id FROM local_wav.files WHERE asset_id=$1", [id])).rows.length);
    assert.equal((await reader.query("SELECT pg_has_role(session_user,'local_wav','MEMBER') AS writer")).rows[0].writer, false);
    assert.equal(await asOwner(a, async () => (await reader.query(
      "SELECT has_table_privilege(current_user,'local_wav.files','INSERT') AS writer")).rows[0].writer), false);

    async function register(actor: VerifiedActor, bytes: Buffer) {
      assert.deepEqual(inspectPcmWav(bytes), { channels: 1, sampleRate: 8000, frames: 1000 });
      const response = await withFixtureAuth(verified(actor), () => localPrivateWav(new Request(
        origin + "/api/assets/upload?format=wav&filename=track.wav&rightsNote=" + rightsNote,
        { method: "POST", headers: { "content-type": "audio/wav", "idempotency-key": v7() }, body: Uint8Array.from(bytes) })));
      assert.equal(response.status, 201, await response.clone().text());
      const { id } = await response.json();
      const { rows: [row] } = await admin.query("SELECT content,digest,rights_note FROM local_wav.files WHERE owner_id=$1 AND asset_id=$2", [actor.id, id]);
      assert.deepEqual(row, { content: bytes, digest: hash(bytes), rights_note: rightsNote });
      return id as string;
    }
    const bytesA = wav(8192), bytesB = wav(4096);
    const assetA = await register(a, bytesA), assetB = await register(b, bytesB);
    const projectB = v7();
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,
      goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,'fixture','1','{}','{}','private fixture','','','9:16',4,now(),now())`, [b.id, projectB]);
    const selectedA = { projectId: baselineProject, assetId: assetA };
    const selectedB = { projectId: projectB, assetId: assetB };
    const link = (actor: VerifiedActor, { projectId, assetId }: Selection, purpose: string) =>
      admin.query("INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,$4)", [actor.id, projectId, assetId, purpose]);
    const issue = (actor: VerifiedActor, assetId: string, bytes: Buffer) =>
      admin.query("INSERT INTO pcm_fixture.registrations VALUES($1,$2,1,$3,$4)", [actor.id, assetId, hash(bytes), bytes.length]);
    const approve = (actor: VerifiedActor, { projectId, assetId }: Selection) => admin.query(`
      INSERT INTO pcm_fixture.approvals SELECT owner_id,$2,asset_id,generation,1,true FROM pcm_fixture.registrations WHERE owner_id=$1 AND asset_id=$3
      ON CONFLICT(owner_id,project_id,asset_id) DO UPDATE SET active=true,registration_generation=excluded.registration_generation,
        generation=pcm_fixture.approvals.generation+1`, [actor.id, projectId, assetId]);
    const revoke = () => admin.query("UPDATE pcm_fixture.approvals SET active=false,generation=generation+1 WHERE owner_id=$1 AND asset_id=$2", [a.id, assetA]);
    const advance = () => admin.query("UPDATE pcm_fixture.registrations SET generation=generation+1 WHERE owner_id=$1 AND asset_id=$2", [a.id, assetA]);

    let copies = 0;
    async function analyze(actor: VerifiedActor, selected: Selection, afterCopy?: () => Promise<unknown>) {
      let initialHash: string | undefined;
      const adapter = createIsolatedRegisteredPcmWavAnalysis({
        profile: "isolated-registered-pcm-wav", resolveAuth: resolveServerAuth, workRoot: root,
        async readRegistration(viewer, selection, signal) {
          if (initialHash !== undefined) {
            const entries = await readdir(root);
            assert.equal(entries.length, 1);
            assert(entries[0].startsWith("dream-registered-pcm-"));
            assert.equal(hash(await readFile(join(root, entries[0], "reference.wav"))), initialHash);
            copies++;
            if (afterCopy) await afterCopy();
          }
          const result = await asOwner(viewer, () => reader.query<Evidence>(`
            SELECT w.*,f.content FROM pcm_fixture.current_wav w JOIN local_wav.files f USING (owner_id,asset_id)
            WHERE w.owner_id=$1 AND w.project_id=$2 AND w.asset_id=$3`, [viewer.id, selection.projectId, selection.assetId]));
          signal.throwIfAborted();
          assert(result.rows.length <= 1);
          const row = result.rows[0];
          if (!row) return;
          initialHash ??= row.sha256;
          return { status: "authorized", ownerId: viewer.id, ...selection, purpose: "rea-reference",
            storeId: "owned-wav-fixture", restoreGeneration: "1", linkGeneration: "1", ownerPermissionGeneration: "1",
            scopePermissionGeneration: String(row.approval_generation),
            registrationGeneration: String(row.registration_generation), authorizedRegistrationGeneration: String(row.registration_generation),
            mime: "audio/wav", sizeBytes: row.size_bytes, sha256: row.sha256, bytes: row.content };
        },
      });
      assert(adapter);
      const post = createStudioAnalysisPost(adapter);
      const response = await withFixtureAuth(verified(actor), () => post(new Request(origin + "/api/studio/reference-analysis", {
        method: "POST", headers: { origin, host: new URL(origin).host, "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify(selected),
      })));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      const json = JSON.stringify(body);
      assert(!json.includes(root) && !json.includes(rightsNote) && !json.includes(hash(bytesA)) && !json.includes(hash(bytesB)));
      assert.deepEqual(await readdir(root), []);
      return body;
    }

    assert.deepEqual(await analyze(a, selectedA), unavailable); // ownership and rights note alone
    await issue(a, assetA, bytesA);
    await link(a, selectedA, "productionAudio");
    await approve(a, selectedA);
    assert.deepEqual(await analyze(a, selectedA), unavailable);
    assert.equal(await ownBytes(a, assetA), 0);
    await admin.query("DELETE FROM pcm_fixture.approvals WHERE owner_id=$1 AND asset_id=$2", [a.id, assetA]);
    await link(a, selectedA, "rea-reference");
    assert.deepEqual(await analyze(a, selectedA), unavailable);
    assert.equal(copies, 0);
    await approve(a, selectedA);
    await issue(b, assetB, bytesB);
    await link(b, selectedB, "rea-reference");
    await approve(b, selectedB);
    assert.deepEqual(await analyze(a, { projectId: selectedB.projectId, assetId: assetA }), unavailable);
    assert.deepEqual(await analyze(a, { projectId: selectedA.projectId, assetId: assetB }), unavailable);
    assert.equal(copies, 0);

    for (const [actor, own, other, peak] of [[a, selectedA, selectedB, 0.25], [b, selectedB, selectedA, 0.125]] as const) {
      const before: number = copies;
      const result = await analyze(actor, own);
      assert.equal(result.status, "ready");
      assert.equal(result.media, "music");
      const rms = result.proposals.flatMap((p: { observations: { measure: string }[] }) => p.observations)
        .find((item: { measure: string }) => item.measure === "normalized_full_scale_rms");
      assert(rms && rms.channels === 1 && rms.peakRms === peak);
      assert.deepEqual(rms.location, { kind: "time", startMs: 0, endMs: 125 });
      assert.deepEqual(await analyze(actor, other), unavailable);
      assert.equal(await ownBytes(actor, other.assetId), 0);
      assert.equal(copies, before + 1);
    }

    await revoke();
    assert.deepEqual(await analyze(a, selectedA), unavailable);
    assert.equal(await ownBytes(a, assetA), 0);
    await approve(a, selectedA);
    assert.equal((await analyze(a, selectedA)).status, "ready");
    const before: number = copies;
    await advance();
    assert.deepEqual(await analyze(a, selectedA), unavailable);
    assert.equal(copies, before);
    await approve(a, selectedA);
    assert.deepEqual(await analyze(a, selectedA, advance), unavailable);
    assert.equal(copies, before + 1);
    assert.equal(await ownBytes(a, assetA), 0);
    await approve(a, selectedA);
    assert.deepEqual(await analyze(a, selectedA, revoke), unavailable);
    assert.equal(copies, before + 2);
    assert.equal(await ownBytes(a, assetA), 0);
    assert.deepEqual(await readdir(root), []);
    console.log("Owned PG17 WAV: actual private registration and SHA, purpose/approval/owner RLS, native music DTO, revoke/rebind, and copies cleaned");
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { await reader.end(); }
    finally { await rmdir(root); }
  }
}
