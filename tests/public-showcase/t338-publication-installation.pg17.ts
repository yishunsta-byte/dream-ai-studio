import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { PublicationInstallationError, publicationInstallation } from "../../lib/db/postgres/publication/installation";
import { createAdminPublicationService } from "../../lib/public-showcase/admin-publication-service";
import { serveCover } from "../../lib/public-showcase/cover-source";
import { createPublicationRuntime } from "../../lib/public-showcase/publication-runtime";
import { createVerifiedPublicationRuntimeOptions } from "../../lib/public-showcase/publication-verified-adapters";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import { evidence, syntheticCover, verified, work } from "../admin/publication-http-fixture";

type Fixture = Readonly<{
  host: string; port: number; database: string; ca: string; installer: string;
  url(name: string, password: string): string;
  openInstaller(): Promise<Client>;
}>;
const owner = "10000000-0000-4000-8000-0000000000a1";
const other = "10000000-0000-4000-8000-0000000000b1";
const secret = () => randomBytes(24).toString("hex");
const checkError = (code: PublicationInstallationError["code"]) => ({ code, outcome: "not-applied" });

export async function runT338PublicationInstallation(control: Client, fixture: Fixture) {
  const { host, port, database, ca, installer } = fixture;
  assert(host === "127.0.0.1" && /^t253_[a-f0-9]{32}$/.test(database));
  const systemIdentifier: string = (await control.query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0].id;
  const target = { database, systemIdentifier, port, installer };
  const run = (mode: "verify" | "install") => publicationInstallation(control, target, mode);
  const fresh = { mode: "absent", applied: false };
  const sameSession = run("verify");
  await assert.rejects(run("install"), checkError("PUBLICATION_TARGET"));
  assert.deepEqual(await sameSession, fresh);
  await assert.rejects(publicationInstallation(control, { ...target, systemIdentifier: "1" }, "install"), checkError("PUBLICATION_TARGET"));
  await control.query("BEGIN");
  try {
    await assert.rejects(run("install"), checkError("PUBLICATION_TARGET"));
    assert.equal(control.getTransactionStatus(), "T");
  } finally { await control.query("ROLLBACK"); }
  await control.query("CREATE ROLE t293_app NOLOGIN");
  try { await assert.rejects(run("install"), checkError("PUBLICATION_SCHEMA")); }
  finally { await control.query("DROP ROLE t293_app"); }
  assert.deepEqual(await run("verify"), fresh);

  await control.query(`CREATE FUNCTION public.t338_mid_install_failure() RETURNS event_trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='t295.attestations') THEN
        RAISE EXCEPTION 'fixture failure after publication roles and tables were created';
      END IF;
    END $$;
    CREATE EVENT TRIGGER t338_mid_install_failure ON ddl_command_end EXECUTE FUNCTION public.t338_mid_install_failure()`);
  try { await assert.rejects(run("install"), checkError("PUBLICATION_INSTALL")); }
  finally { await control.query("DROP EVENT TRIGGER t338_mid_install_failure; DROP FUNCTION public.t338_mid_install_failure()"); }
  assert.deepEqual(await run("verify"), fresh);

  const contender = await fixture.openInstaller();
  let outcomes;
  try {
    outcomes = await Promise.all([run("install"), publicationInstallation(contender, target, "install")]);
  } finally { await contender.end(); }
  assert.deepEqual(outcomes.map(result => result.applied).sort(), [false, true]);
  const stable = await run("verify");
  assert.equal(stable.mode, "installed");
  assert.deepEqual(await run("install"), stable);
  assert.deepEqual(outcomes.map(result => ({ ...result, applied: false })), [stable, stable]);
  assert.equal((await control.query("SELECT count(*)::int AS n FROM t293.actor_bindings")).rows[0].n, 0);
  assert.equal((await control.query("SELECT count(*)::int AS n FROM t253_showcase.publishers")).rows[0].n, 0);

  await control.query("GRANT EXECUTE ON FUNCTION t295.list_approved() TO t295_file");
  try {
    await assert.rejects(run("verify"), checkError("PUBLICATION_SCHEMA"));
    await assert.rejects(run("install"), checkError("PUBLICATION_SCHEMA"));
  } finally { await control.query("REVOKE EXECUTE ON FUNCTION t295.list_approved() FROM t295_file"); }
  await control.query("GRANT SELECT ON t295.frozen_manifest TO PUBLIC");
  try { await assert.rejects(run("verify"), checkError("PUBLICATION_SCHEMA")); }
  finally { await control.query("REVOKE SELECT ON t295.frozen_manifest FROM PUBLIC"); }
  await control.query("UPDATE t_publication_install.history SET source_sha256=repeat('0',64)");
  try { await assert.rejects(run("install"), checkError("PUBLICATION_SCHEMA")); }
  finally { await control.query("UPDATE t_publication_install.history SET source_sha256=$1", [stable.sourceSha]); }
  assert.deepEqual(await run("verify"), stable);

  async function provision(name: string, role: string) {
    const password = secret();
    await control.query(`CREATE ROLE ${name} LOGIN INHERIT PASSWORD '${password}'; GRANT ${role} TO ${name}`);
    return { name, connectionString: fixture.url(name, password) };
  }
  async function connect(connectionString: string) {
    const session = new Client({ connectionString, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 5000 });
    try { await session.connect(); return session; }
    catch (error) { await session.end().catch(() => undefined); throw error; }
  }
  const logins = {
    admin: await provision("t338_admin", "t293_app"),
    list: await provision("t338_list", "t295_list"),
    cover: await provision("t338_cover", "t295_file"),
  };
  const second = await provision("t338_other", "t293_app");
  const authority = await provision("t338_authority", "t_publication_authority");
  const grantor = await connect(authority.connectionString);
  try {
    await grantor.query("INSERT INTO t293.actor_bindings VALUES ('t338_admin'::regrole,$1),('t338_other'::regrole,$2)", [owner, other]);
    await grantor.query("INSERT INTO t253_showcase.publishers VALUES ($1)", [owner]);
    await assert.rejects(grantor.query("SELECT t295.list_approved()"), { code: "42501" });
  } finally { await grantor.end(); }

  const writer = await connect(logins.admin.connectionString);
  try {
    await assert.rejects(writer.query("SELECT * FROM t293.actor_bindings"), { code: "42501" });
    await assert.rejects(writer.query("SELECT t293.apply_t253(NULL,NULL,NULL,NULL,NULL,NULL)"), { code: "42501" });
    await assert.rejects(writer.query("SELECT t295.list_approved()"), { code: "42501" });
  } finally { await writer.end(); }
  const wrongActor = await connect(second.connectionString);
  try {
    await wrongActor.query("BEGIN");
    await wrongActor.query("SELECT set_config('t293.actor',$1,true)", [owner]);
    assert.equal((await wrongActor.query("SELECT t293.actor() AS actor")).rows[0].actor, null);
    await wrongActor.query("SELECT set_config('t293.actor',$1,true)", [other]);
    assert.equal((await wrongActor.query("SELECT t293.actor() AS actor")).rows[0].actor, other);
    await wrongActor.query("ROLLBACK");
  } finally { await wrongActor.end(); }
  await control.query("DROP ROLE t338_other");
  const reusedName = await provision("t338_other", "t293_app");
  const unbound = await connect(reusedName.connectionString);
  try {
    await unbound.query("BEGIN");
    await unbound.query("SELECT set_config('t293.actor',$1,true)", [other]);
    assert.equal((await unbound.query("SELECT t293.actor() AS actor")).rows[0].actor, null);
    await unbound.query("ROLLBACK");
  } finally { await unbound.end(); }

  const image = await syntheticCover();
  const slug = "t338-published";
  const item = work(owner, slug, 80);
  const proof = evidence(item, "1", image);
  const manifest = { sourceId: item.artifact.id, sourceRevision: item.artifact.revision, sourceSha: item.artifact.sha,
    rightsRef: proof.rights.reference, display: item.display, coverSha: image.sha, coverBytes: image.bytes.length };
  await control.query("INSERT INTO t293.works VALUES($1,$2,$3)", [owner, slug, item]);
  await control.query("INSERT INTO t293.evidence VALUES($1,$2,$3)", [owner, slug, proof]);
  await control.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,$3,$4,true)", [owner, item.artifact.id, item.artifact.revision, item.artifact.sha]);
  await control.query("INSERT INTO t295.attestations VALUES ($1,$2,$3,$4,'perpetual',NULL)", [owner, slug, proof.rights.reference, manifest]);
  const runtime = createPublicationRuntime(() => createVerifiedPublicationRuntimeOptions({
    database: { target: { host, port, database, systemIdentifier }, logins, ca }, adminActorId: owner,
    rightsReader: { schema: "t295", name: "rights_state" },
    async readAdminCover(actor, key) { assert.equal(actor, owner); assert.equal(key, proof.cover.objectKey); return image.bytes; },
    async readPublicCover(key) { assert.equal(key, proof.cover.objectKey); return image.bytes; },
  }));
  try {
    const state = await runtime.get();
    assert.equal(state.mode, "active");
    const service = createAdminPublicationService(state.adminStore, async () => verified(owner));
    const command = (command: "prepare" | "complete" | "revoke", expectedVersion: string, generation: string | null) => ({
      requestId: randomUUID(), slug, command, expectedVersion, generation, rightsConfirmed: command !== "revoke",
    });
    const path = `/media/public/${slug}/1/cover.webp`;
    const cover = () => serveCover(new Request(`https://test.invalid${path}`), state.coverSource);
    const shows = async () => (await loadShowcaseFeed(state.showcaseSource)).works.some(entry => entry.image?.src === path);
    assert.deepEqual(await service.apply(command("prepare", "0", null)), { status: "prepared", version: "1", generation: "1" });
    assert.equal((await cover()).status, 404);
    const complete = command("complete", "1", "1");
    const published = { status: "published", version: "2", generation: "1" };
    assert.deepEqual(await service.apply(complete), published);
    assert.deepEqual(await service.apply(complete), published);
    assert.equal(await shows(), true);
    assert.deepEqual(Buffer.from(await (await cover()).arrayBuffer()), image.bytes);
    assert.deepEqual(await service.apply(command("revoke", "2", "1")), { status: "revoked", version: "3", generation: "1" });
    assert.equal(await shows(), false);
    assert.equal((await cover()).status, 404);
  } finally { await runtime.close(); }
  assert.deepEqual(await run("install"), stable);
  assert.equal((await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='dream-backend'")).rows[0].n, 0);
  console.log("T338 transactional install/history, rollback, permission checks and verified publication passed");
}
