import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRenderedPublicationMedia } from "../../lib/public-showcase/rendered-media-evidence";
import { mediaBinary, runMedia } from "../../lib/media/tools";
import { servePlayback } from "../../lib/public-showcase/playback-source";
import type { PlaybackStore } from "../../lib/public-showcase/playback-source";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { readPostgresCatalogV2 } from "../../lib/db/postgres/migration-state-v2";
import { loadPostgresMigrationsV2 } from "../../lib/db/postgres/migration-manifest-v2";
import { installDelegatedPublication, verifyDelegatedPublication, withDelegatedPublicationManagement,
  withDelegatedPublicationWork, type DelegatedPlan } from "../../lib/db/postgres/publication/delegated/probe";
import { createAdminPublicationService } from "../../lib/public-showcase/admin-publication-service";
import { serveCover } from "../../lib/public-showcase/cover-source";
import { createPublicationRuntime } from "../../lib/public-showcase/publication-runtime";
import { createVerifiedPublicationRuntimeOptions } from "../../lib/public-showcase/publication-verified-adapters";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import { evidence, syntheticCover, verified, work } from "../admin/publication-http-fixture";

type Fixture = { host: string; port: number; database: string; ca: string; bootstrap: string;
  url(name: string, password: string): string; openBootstrap(db: string): Promise<Client> };
type Observer = (phase: "prepared" | "pending-seal" | "retained-session" | "sealed", context: {
  plan: DelegatedPlan; work: Parameters<typeof verifyDelegatedPublication>[2]; actor: string; verifierConnectionString: string;
  database: NonNullable<Parameters<typeof createVerifiedPublicationRuntimeOptions>[0]>["database"];
}) => Promise<void>;
const owners = ["t253_write_owner", "t293_gateway", "t293_binding_owner", "t295_writer", "t295_list_owner", "t295_file_owner", "t341_schema_owner", "t341_history_owner"];
const groups = [...owners, "t253_publish", "t293_app", "t295_list", "t295_file", "t_publication_authority", "t341_verify"];
const installerName = "t341_installer";
const verifierName = "t341_observer";
const provisionerName = "t341_provisioner";
const runtimeRoles = { admin: "t293_app", list: "t295_list", cover: "t295_file" } as const;
const denied = { code: "BLOCKED" };
const noPermission = { code: "42501" };

export async function runT341DelegatedPublicationInstaller(control: Client, fixture: Fixture, observe?: Observer, playback = false) {
  const { host, port, database, ca } = fixture;
  assert.equal(host, "127.0.0.1");
  assert.match(database, /^t253_[a-f0-9]{32}$/);
  const { rows: [pin] } = await control.query(`SELECT system_identifier::text AS cluster,d.oid::text AS "databaseOid",r.oid::text AS manager
    FROM pg_control_system(),pg_database d,pg_roles r WHERE d.datname=current_database() AND r.rolname=session_user`);
  const target = { database, databaseOid: String(pin.databaseOid), cluster: String(pin.cluster), port };
  const approval = { manager: { name: fixture.bootstrap, oid: String(pin.manager) }, target };
  const sessions: Client[] = [];
  const fixtureActor = randomUUID();
  const foundationSql = await loadPostgresMigrationsV2(4);
  await control.query("BEGIN");
  try {
    await control.query(`SET LOCAL search_path=pg_catalog; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE SCHEMA dream_migrations; REVOKE ALL ON SCHEMA dream_migrations FROM PUBLIC;
      CREATE TABLE dream_migrations.history(ordinal integer PRIMARY KEY CHECK(ordinal>0),id text NOT NULL UNIQUE,
        checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT transaction_timestamp());
      REVOKE ALL ON TABLE dream_migrations.history FROM PUBLIC`);
    await control.query("INSERT INTO auth.users VALUES ($1)", [fixtureActor]);
    for (const [i, entry] of foundationSql.entries()) {
      await control.query(entry.sql);
      // SQL4 is a DDL coexistence fixture. T339 verified PG17 v2 does not admit schema4.
      if (i < 3) await control.query("INSERT INTO dream_migrations.history(ordinal,id,checksum) VALUES ($1,$2,$3)", [i + 1, entry.id, entry.checksum]);
    }
    await control.query("COMMIT");
  } catch (error) { await control.query("ROLLBACK"); throw error; }

  const foundation = async () => ({ catalog: await readPostgresCatalogV2(control),
    history: (await control.query("SELECT ordinal,id,checksum,applied_at::text FROM dream_migrations.history ORDER BY ordinal")).rows,
    auth: (await control.query("SELECT id::text FROM auth.users ORDER BY id")).rows });
  const preserved = await foundation();
  const credentials = new Map<string, string>();
  async function login(name: string) {
    const password = randomBytes(24).toString("hex");
    await control.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION
      ${name === installerName ? "NOINHERIT" : "INHERIT"} PASSWORD '${password}'`);
    credentials.set(name, fixture.url(name, password));
  }
  async function connect(name: string) {
    const connectionString = credentials.get(name);
    assert(connectionString);
    const client = new Client({ connectionString, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 5000,
      statement_timeout: 10_000, application_name: "t341-candidate" });
    sessions.push(client);
    await client.connect();
    return client;
  }
  const runtimeNames = Object.keys(runtimeRoles).map(role => `t341_${role}`);
  const coordinator = await fixture.openBootstrap("postgres");
  sessions.push(coordinator);
  const otherDatabase = `t341_${randomUUID().replaceAll("-", "")}`;
  await coordinator.query(`CREATE DATABASE ${otherDatabase}`);
  const otherTargetSession = await fixture.openBootstrap(otherDatabase);
  sessions.push(otherTargetSession);
  const otherTarget = { ...target, database: otherDatabase,
    databaseOid: (await otherTargetSession.query("SELECT oid::text FROM pg_database WHERE datname=current_database()")).rows[0].oid };
  let completedWork: Parameters<typeof verifyDelegatedPublication>[2] | undefined;
  let completedPlan: DelegatedPlan | undefined;

  try {
    await withDelegatedPublicationWork(coordinator, approval, async delegation => {
      // A second target, plan and session all contend on the designated control DB.
      const contender = await fixture.openBootstrap("postgres");
      try {
        await assert.rejects(withDelegatedPublicationWork(contender, { ...approval, target: otherTarget }, work =>
          withDelegatedPublicationManagement(otherTargetSession, otherTarget, work, async () => assert.fail("second target admitted"))),
        { code: "BUSY" });
        await assert.rejects(withDelegatedPublicationWork(coordinator, approval, async () => assert.fail("reentrant work admitted")), { code: "BUSY" });
      } finally { await contender.end(); }
      await assert.rejects(withDelegatedPublicationManagement(otherTargetSession, otherTarget, delegation,
        async () => assert.fail("work reused on a different target")), denied);
      const wrongControl = await fixture.openBootstrap(database);
      try {
        await assert.rejects(withDelegatedPublicationWork(wrongControl, approval, async () => assert.fail("lock split by database")), denied);
      } finally { await wrongControl.end(); }

      const manage = <T>(operation: () => Promise<T>) => withDelegatedPublicationManagement(control, target, delegation, operation);
      await manage(async () => {
        // Exercise a real PG17 automatic administrator edge, with the expected grantor fixed below.
        await control.query(`CREATE ROLE ${provisionerName} NOLOGIN CREATEROLE NOINHERIT;
          SET LOCAL ROLE ${provisionerName}; CREATE ROLE t341_verify NOLOGIN; RESET ROLE`);
        for (const group of groups.filter(name => name !== "t341_verify")) await control.query(`CREATE ROLE ${group} NOLOGIN`);
        for (const name of [installerName, verifierName, ...runtimeNames]) await login(name);
        await control.query(`GRANT t253_publish TO t293_gateway WITH INHERIT TRUE, SET FALSE;
          GRANT t293_app TO t295_writer WITH INHERIT TRUE, SET FALSE;
          GRANT t341_verify TO ${verifierName} WITH INHERIT TRUE, SET FALSE;
          GRANT ${owners.join(",")} TO ${installerName} WITH INHERIT FALSE, SET TRUE;
          GRANT CREATE ON DATABASE ${database} TO ${installerName},t341_schema_owner,t341_history_owner`);
        for (const [kind, group] of Object.entries(runtimeRoles)) await control.query(`GRANT ${group} TO t341_${kind} WITH INHERIT TRUE, SET FALSE`);
      });

      // Role names and edge expectations are authored here. Only assigned OIDs are observed from management.
      const names = [...groups, installerName, verifierName, ...runtimeNames];
      const { rows: identifiers } = await control.query<{ name: string; oid: string }>(`SELECT rolname AS name,oid::text FROM pg_roles
        WHERE rolname=ANY($1::text[])`, [[...names, provisionerName]]);
      const oid = (name: string) => {
        const row = identifiers.find(entry => entry.name === name);
        assert(row);
        return row.oid;
      };
      const edge = (member: string, parent: string, inherit: boolean, set: boolean, admin = false) =>
        ({ member: oid(member), parent: oid(parent), grantor: approval.manager.oid, inherit, set, admin });
      const plan: DelegatedPlan = { target, installer: { name: installerName, oid: oid(installerName) },
        verifier: { name: verifierName, oid: oid(verifierName) }, principals: names.map(name => ({ name, oid: oid(name),
          login: !groups.includes(name), inherit: name !== installerName })),
        permanent: [edge("t293_gateway", "t253_publish", true, false), edge("t295_writer", "t293_app", true, false),
          edge(verifierName, "t341_verify", true, false), edge(provisionerName, "t341_verify", false, false, true),
          ...Object.entries(runtimeRoles).map(([kind, group]) => edge(`t341_${kind}`, group, true, false))],
        temporary: owners.map(owner => edge(installerName, owner, false, true)),
      };
      const profile = (name: string) => ({ name, connectionString: credentials.get(name)! });
      const publicationDatabase = { target: { host, port, database, systemIdentifier: target.cluster }, ca,
        logins: { admin: profile("t341_admin"), list: profile("t341_list"), cover: profile("t341_cover") } };
      const observePhase = (phase: Parameters<Observer>[0]) => observe?.(phase, { plan, work: delegation, actor: fixtureActor,
        verifierConnectionString: profile(verifierName).connectionString, database: publicationDatabase });
      const installer = await connect(installerName);
      let observer = await connect(verifierName);
      const verify = (expected = plan) => verifyDelegatedPublication(observer, expected, delegation);
      const install = (client = installer) => installDelegatedPublication(client, plan, delegation);
      assert.deepEqual(await verify(), { mode: "prepared" });
      await observePhase("prepared");
      await assert.rejects(verify({ ...plan, principals: plan.principals.map(role => role.name === "t295_writer" ? { ...role, oid: "1" } : role) }), denied);
      await assert.rejects(verify({ ...plan, permanent: plan.permanent.map((grant, index) => index === 0 ? { ...grant, grantor: "1" } : grant) }), denied);
      await manage(() => control.query("CREATE SCHEMA t295"));
      try { await assert.rejects(install(), denied); }
      finally { await manage(() => control.query("DROP SCHEMA t295")); }
      await manage(() => control.query("GRANT t295_writer TO t341_verify WITH INHERIT TRUE, SET FALSE"));
      try {
        await assert.rejects(verify(), denied);
        await assert.rejects(verify({ ...plan, permanent: [...plan.permanent, edge("t341_verify", "t295_writer", true, false)] }), denied);
      }
      finally { await manage(() => control.query("REVOKE t295_writer FROM t341_verify")); }

      await manage(() => control.query(`CREATE FUNCTION public.t341_stop_install() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='t295.attestations') THEN
          RAISE EXCEPTION 'owned fixture roll back'; END IF; END $$;
        CREATE EVENT TRIGGER t341_stop_install ON ddl_command_end EXECUTE FUNCTION public.t341_stop_install()`));
      try { await assert.rejects(install(), denied); }
      finally { await manage(() => control.query("DROP EVENT TRIGGER t341_stop_install; DROP FUNCTION public.t341_stop_install()")); }
      assert.deepEqual(await verify(), { mode: "prepared" });
      assert.deepEqual(await foundation(), preserved);

      const lostAck = { getTransactionStatus: () => installer.getTransactionStatus(), query: (async (sql: string, values?: unknown[]) => {
        const result = await installer.query(sql, values);
        if (sql === "COMMIT") throw new Error("Owned fixture dropped acknowledgement");
        return result;
      }) as Client["query"] };
      await assert.rejects(installDelegatedPublication(lostAck, plan, delegation), { code: "UNKNOWN" });
      await observer.end();
      observer = await connect(verifierName);
      if (playback) {
        assert.equal((await verify()).mode, "pending-seal");
        await installDelegatedPublication(installer, plan, delegation, 3);
      }
      const pending = await verify();
      assert.equal(pending.mode, "pending-seal");
      await observePhase("pending-seal");
      await assert.rejects(install(), denied);
      await installer.query("SET ROLE t295_writer");

      await manage(() => control.query(`ALTER ROLE ${installerName} NOLOGIN;
        REVOKE ${owners.join(",")} FROM ${installerName};
        REVOKE CREATE ON DATABASE ${database} FROM t341_schema_owner,t341_history_owner`));
      await assert.rejects(verify(), denied);
      await manage(() => control.query(`REVOKE CREATE ON DATABASE ${database} FROM ${installerName}`));
      assert.equal((await installer.query("SELECT current_user AS role")).rows[0].role, "t295_writer");
      assert.deepEqual(await verify(), pending);
      await observePhase("retained-session");
      await installer.end();
      await observer.end();
      observer = await connect(verifierName);
      const sealed = await verify();
      assert.deepEqual(sealed, { ...pending, mode: "sealed" });

      // Check ACLs in ordinary SQL sessions as well as through the READ ONLY verifier.
      for (const sql of ["UPDATE t_publication_install.history SET installed_at=clock_timestamp()", "SELECT * FROM t293.works",
        "CREATE SCHEMA t341_forbidden", "SET ROLE t341_history_owner", "SELECT t295.list_approved()"])
        await assert.rejects(observer.query(sql), noPermission);
      assert.equal((await observer.query("SELECT count(version)::int AS n FROM t_publication_install.history")).rows[0].n, playback ? 2 : 1);
      const { rows: [original] } = await control.query("SELECT plan_sha256 FROM t_publication_install.history");
      for (const [alter, restore, args] of [
        ["GRANT SELECT ON t_publication_install.history TO PUBLIC", "REVOKE SELECT ON t_publication_install.history FROM PUBLIC"],
        ["UPDATE t_publication_install.history SET plan_sha256=repeat('0',64)", "UPDATE t_publication_install.history SET plan_sha256=$1",
          [original.plan_sha256]],
      ] as [string, string, unknown[]?][]) {
        await manage(() => control.query(alter));
        try { await assert.rejects(verify(), denied); }
        finally { await manage(() => control.query(restore, args)); }
      }
      assert.deepEqual(await verify(), sealed);

      // The probe has no runtime configuration side effect. This owned test opens T332 only after a sealed proof.
      assert.equal(sealed.mode, "sealed");
      const slug = "t341-published";
      const image = await syntheticCover();
      const sample = playback ? (await runMedia(mediaBinary("ffmpeg"),
        ["-v","error","-f","lavfi","-i","sine=frequency=440:duration=0.2","-c:a","libmp3lame","-f","mp3","pipe:1"],
        { encoding: "buffer", windowsHide: true })).stdout : null;
      const inspected = await (async () => {
        if (!sample) return;
        const scratch = await mkdtemp(join(tmpdir(), "t370-proof-"));
        try {
          const path = join(scratch, "sample.mp3");
          await writeFile(path, sample);
          return await inspectRenderedPublicationMedia(path, "mp3");
        } finally { await rm(scratch, { recursive: true, force: true }); }
      })();
      const etag = '"t370-fixture"';
      const baseItem = work(fixtureActor, slug, 91);
      const item = sample ? { ...baseItem, media: "music" as const, artifact: {
        ...baseItem.artifact, sha: createHash("sha256").update(sample).digest("hex") } } : baseItem;
      const baseProof = evidence(item, "1", image);
      const proof = { ...baseProof, ...(inspected ? { media: { ...baseProof.source, ...inspected, version: etag, objectKey: `${slug}/1/${item.artifact.sha}.mp3` } } : {}) };
      const manifest = { sourceId: item.artifact.id, sourceRevision: item.artifact.revision, sourceSha: item.artifact.sha,
        rightsRef: proof.rights.reference, display: item.display, coverSha: image.sha, coverBytes: image.bytes.length,
        ...(sample ? { mediaKind: "audio", mediaMime: "audio/mpeg", mediaExt: "mp3", mediaBytes: sample.length,
          mediaSha: item.artifact.sha, mediaVersion: etag } : {}) };
      await control.query("INSERT INTO t293.actor_bindings VALUES ('t341_admin'::regrole,$1)", [fixtureActor]);
      await control.query("INSERT INTO t253_showcase.publishers VALUES ($1)", [fixtureActor]);
      await control.query("INSERT INTO t293.works VALUES ($1,$2,$3)", [fixtureActor, slug, item]);
      await control.query("INSERT INTO t293.evidence VALUES ($1,$2,$3)", [fixtureActor, slug, proof]);
      await control.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,$3,$4,true)", [fixtureActor, item.artifact.id, item.artifact.revision, item.artifact.sha]);
      await control.query("INSERT INTO t295.attestations VALUES ($1,$2,$3,$4,'perpetual',NULL)", [fixtureActor, slug, proof.rights.reference, manifest]);
      let corrupt = true;
      const readPublicMediaRange: PlaybackStore["readRange"] = async (row,start,end) => {
        assert(sample && proof.media);
        assert.equal(row.objectKey, proof.media.objectKey);
        const bytes = Uint8Array.from(sample.subarray(start,end+1));
        if (corrupt) bytes[0] ^= 1;
        return new Response(bytes,{ status: 206, headers: { etag, "content-range": `bytes ${start}-${end}/${sample.length}`,
          "content-length": String(bytes.length) } });
      };
      const runtime = createPublicationRuntime(() => createVerifiedPublicationRuntimeOptions({
        database: publicationDatabase,
        ...(playback ? { readPublicMediaRange } : {}),
        adminActorId: fixtureActor, rightsReader: { schema: "t295", name: "rights_state" },
        async readAdminCover(actor, key) { assert.equal(actor, fixtureActor); assert.equal(key, proof.cover.objectKey); return image.bytes; },
        async readPublicCover(key) { assert.equal(key, proof.cover.objectKey); return image.bytes; },
      }));
      try {
        const connected = await runtime.get();
        assert.equal(connected.mode, "active");
        const service = createAdminPublicationService(connected.adminStore, async () => verified(fixtureActor));
        const command = (command: "prepare" | "complete" | "revoke", expectedVersion: string, generation: string | null) => ({
          requestId: randomUUID(), command, slug, expectedVersion, generation, rightsConfirmed: command !== "revoke",
        });
        const path = `/media/public/${slug}/1/cover.webp`;
        const cover = () => serveCover(new Request(`https://test.invalid${path}`), connected.coverSource);
        const feed = async () => (await loadShowcaseFeed(connected.showcaseSource)).works.some(entry => entry.image?.src === path);
        assert.equal((await service.apply(command("prepare", "0", null))).status, "prepared");
        assert.equal((await serveCover(new Request(`https://test.invalid${path}`), connected.coverSource)).status, 404);
        const audioPath = `https://test.invalid/media/public/${slug}/1/play.mp3`;
        const listen = () => servePlayback(new Request(audioPath, { headers: { range: "bytes=0-23" } }), connected.coverSource);
        if (sample) {
          assert.equal((await listen()).status, 404);
          assert.equal((await service.apply(command("complete","1","1"))).status, "source-unavailable");
          corrupt = false;
        }
        assert.equal((await service.apply(command("complete", "1", "1"))).status, "published");
        if (sample) {
          const result = await listen();
          assert.equal(result.status, 206);
          assert.deepEqual(Buffer.from(await result.arrayBuffer()),sample.subarray(0,24));
          const feed = await loadShowcaseFeed(connected.showcaseSource);
          assert.equal(feed.works[0].media?.src, new URL(audioPath).pathname);
          assert(!JSON.stringify(feed).includes(item.artifact.sha));
          await control.query("UPDATE t295.frozen_manifest SET manifest=manifest || jsonb_build_object('mediaVersion',to_jsonb($2::text)) WHERE slug=$1",
            [slug, '"alternate-object"']);
          assert.equal((await listen()).status, 404);
          assert(!(await loadShowcaseFeed(connected.showcaseSource)).works.some(work => work.media?.src === new URL(audioPath).pathname));
          await control.query("UPDATE t295.frozen_manifest SET manifest=$2 WHERE slug=$1", [slug, manifest]);
          for (const table of ["frozen_manifest", "activation"]) {
            await control.query(`UPDATE t295.${table} SET mode='timed', expires_at='2000-01-01T00:00:00Z' WHERE slug=$1`, [slug]);
          }
          assert.equal((await listen()).status, 404);
          assert(!(await loadShowcaseFeed(connected.showcaseSource)).works.some(work => work.media?.src === new URL(audioPath).pathname));
          for (const table of ["frozen_manifest", "activation"]) {
            await control.query(`UPDATE t295.${table} SET mode='perpetual',expires_at=NULL WHERE slug=$1`, [slug]);
          }
          for (const name of ["t341_admin","t341_list"]) {
            const deniedReader = await connect(name);
            await assert.rejects(deniedReader.query("SELECT * FROM t295.find_media($1,1)",[slug]), noPermission);
            await deniedReader.end();
          }
        }
        assert.equal(await feed(), true);
        assert.deepEqual(Buffer.from(await (await cover()).arrayBuffer()), image.bytes);
        assert.equal((await service.apply(command("revoke", "2", "1"))).status, "revoked");
        assert.equal(await feed(), false);
        assert.equal((await cover()).status, 404);
        if (sample) assert.equal((await listen()).status, 404);
      } finally { await runtime.close(); }
      assert.deepEqual(await verify(), sealed);
      assert.deepEqual(await foundation(), preserved);
      await observePhase("sealed");
      completedPlan = plan;
      completedWork = delegation;
    });
    const witness = await connect(verifierName);
    const committedPlan = completedPlan;
    assert(completedWork && committedPlan);
    await assert.rejects(verifyDelegatedPublication(witness, committedPlan, completedWork), denied);
    const interrupted = await fixture.openBootstrap("postgres");
    sessions.push(interrupted);
    await assert.rejects(withDelegatedPublicationWork(interrupted, approval, async work => {
      assert.equal((await verifyDelegatedPublication(witness, committedPlan, work)).mode, "sealed");
      await interrupted.end();
      await assert.rejects(verifyDelegatedPublication(witness, committedPlan, work), denied);
    }), { code: "UNKNOWN" });
    await withDelegatedPublicationWork(coordinator, approval, async work => {
      assert.equal((await verifyDelegatedPublication(witness, committedPlan, work)).mode, "sealed");
    });
  } finally { await Promise.allSettled(sessions.map(client => client.end())); }
  assert.equal((await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name IN ('t341-candidate','dream-backend')")).rows[0].n, 0);
  console.log("T341 coordinated delegation, rollback/unknown, effective seal, independent history and publication passed");
}
