import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { createAdminPublicationService } from "../../lib/public-showcase/admin-publication-service";
import { serveCover } from "../../lib/public-showcase/cover-source";
import { createPublicationRuntime } from "../../lib/public-showcase/publication-runtime";
import { createVerifiedPublicationRuntimeOptions } from "../../lib/public-showcase/publication-verified-adapters";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import { evidence, syntheticCover, verified, work } from "../admin/publication-http-fixture";

type Options = NonNullable<Parameters<typeof createVerifiedPublicationRuntimeOptions>[0]>;
const owner = "10000000-0000-4000-8000-0000000000a1";
const other = "10000000-0000-4000-8000-0000000000b1";

// Same restricted rights DTO as T306, installed only in the owned T328 cluster.
const rightsSql = `
  CREATE SCHEMA t332;
  REVOKE ALL ON SCHEMA t332 FROM PUBLIC;
  GRANT USAGE ON SCHEMA t332 TO t293_app,t295_writer;
  CREATE FUNCTION t332.exact_ms(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE STRICT
  SET search_path=pg_catalog,pg_temp AS $$
    SELECT CASE WHEN ms=trunc(ms) THEN trunc(ms)::bigint::text ELSE 'frac:' || ms::text END
    FROM (SELECT extract(epoch FROM value)*1000 AS ms) x
  $$;
  REVOKE ALL ON FUNCTION t332.exact_ms(timestamptz) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION t332.exact_ms(timestamptz) TO t295_writer;
  CREATE FUNCTION t332.rights_state(target_slug text,target_generation bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
    SELECT jsonb_build_object(
      'frozen', (SELECT jsonb_build_object('rights_ref',m.rights_ref,'manifest',m.manifest,'mode',m.mode,'expires_ms',t332.exact_ms(m.expires_at))
        FROM t295.frozen_manifest m WHERE m.owner_id=t293.actor() AND m.slug=target_slug AND m.generation=target_generation),
      'activation', (SELECT jsonb_build_object('rights_ref',a.rights_ref,'mode',a.mode,'expires_ms',t332.exact_ms(a.expires_at),'approved_ms',a.approved_ms::text)
        FROM t295.activation a WHERE a.owner_id=t293.actor() AND a.slug=target_slug AND a.generation=target_generation))
  $$;
  ALTER FUNCTION t332.rights_state(text,bigint) OWNER TO t295_writer;
  REVOKE ALL ON FUNCTION t332.rights_state(text,bigint) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION t332.rights_state(text,bigint) TO t293_app;
`;

export async function runT332VerifiedAdapters(control: Client, database: Options["database"]) {
  await control.query(rightsSql);
  const image = await syntheticCover();
  const objects = new Map<string, Uint8Array>();
  let publicReads = 0;
  let beforePublicRead: (() => Promise<void>) | undefined;
  const options: Options = {
    database,
    adminActorId: owner,
    rightsReader: { schema: "t332", name: "rights_state" },
    async readAdminCover(ownerId, key, { maxBytes }) {
      assert.equal(ownerId, owner);
      const bytes = objects.get(key);
      assert(bytes && bytes.byteLength <= maxBytes);
      return bytes;
    },
    async readPublicCover(key, { maxBytes }) {
      publicReads++;
      await beforePublicRead?.();
      const bytes = objects.get(key);
      assert(bytes && bytes.byteLength <= maxBytes);
      return bytes;
    },
  };

  const command = (action: "prepare" | "complete" | "revoke", slug: string, version: string, generation: string | null) => ({
    requestId: randomUUID(), command: action, slug, expectedVersion: version, generation, rightsConfirmed: action !== "revoke",
  });
  const key = (slug: string, generation: string) => `${slug}/${generation}/${image.sha}.webp`;
  const path = (slug: string, generation: string) => `/media/public/${slug}/${generation}/cover.webp`;
  async function seed(slug: string, index: number, expiresAtMs: number | null = null, databaseExpiry = expiresAtMs, actorId = owner) {
    const item = work(actorId, slug, index);
    const original = evidence(item, "1", image);
    const proof = { ...original, rights: { ...original.rights, expiresAtMs } };
    const manifest = { sourceId: item.artifact.id, sourceRevision: item.artifact.revision, sourceSha: item.artifact.sha,
      rightsRef: proof.rights.reference, display: item.display, coverSha: image.sha, coverBytes: image.bytes.length };
    await control.query("INSERT INTO t293.works VALUES ($1,$2,$3)", [actorId, slug, item]);
    await control.query("INSERT INTO t293.evidence VALUES ($1,$2,$3)", [actorId, slug, proof]);
    await control.query("INSERT INTO t253_showcase.source_images VALUES ($1,$2,$3,$4,true)", [actorId, item.artifact.id, item.artifact.revision, item.artifact.sha]);
    await control.query("INSERT INTO t295.attestations VALUES ($1,$2,$3,$4,$5,$6)",
      [actorId, slug, proof.rights.reference, manifest, databaseExpiry === null ? "perpetual" : "timed", databaseExpiry === null ? null : new Date(databaseExpiry)]);
    objects.set(key(slug, "1"), image.bytes);
    return proof;
  }

  const publisher = await control.query("INSERT INTO t253_showcase.publishers VALUES ($1) ON CONFLICT DO NOTHING", [owner]);
  await seed("t332-foreign", 5, null, null, other);
  const slug = "t332-normal";
  const proof = await seed(slug, 1);
  const runtime = createPublicationRuntime(() => createVerifiedPublicationRuntimeOptions(options));
  try {
    const connected = await runtime.get();
    assert.equal(connected.mode, "active");
    const service = createAdminPublicationService(connected.adminStore, async () => verified(owner));
    const outsider = createAdminPublicationService(connected.adminStore, async () => verified(other));
    const feed = () => loadShowcaseFeed(connected.showcaseSource);
    const cover = (workSlug: string, generation: string, method = "GET") =>
      serveCover(new Request(`https://test.invalid${path(workSlug, generation)}`, { method }), connected.coverSource);
    const hidden = async (workSlug: string, generation: string) => {
      assert(!(await feed()).works.some(entry => entry.image?.src === path(workSlug, generation)));
      assert.equal((await cover(workSlug, generation)).status, 404);
      assert.equal((await cover(workSlug, generation, "HEAD")).status, 404);
    };
    const queue = await service.list();
    assert.equal(queue.kind, "ok");
    assert(queue.items.some(item => item.slug === slug));
    assert(!queue.items.some(item => item.slug === "t332-foreign"));
    assert.deepEqual(await outsider.list(), { kind: "closed" });
    assert.deepEqual(await outsider.apply(command("prepare", slug, "0", null)), { status: "denied" });
    assert.deepEqual(await service.apply(command("prepare", "t332-foreign", "0", null)), { status: "denied" });

    await hidden(slug, "1");
    assert.equal(publicReads, 0);
    assert.deepEqual(await service.apply(command("prepare", slug, "0", null)), { status: "prepared", version: "1", generation: "1" });
    await hidden(slug, "1");
    const complete = command("complete", slug, "1", "1");
    const result = { status: "published", version: "2", generation: "1" };
    assert.deepEqual(await Promise.all([service.apply(complete), service.apply(complete)]), [result, result]);
    const { rows: [counts] } = await control.query(`SELECT (SELECT count(*)::int FROM t293.app_requests WHERE request_id=$1) AS ledger,
      (SELECT count(*)::int FROM t293.audit WHERE request_id=$1) AS audit,
      (SELECT count(*)::int FROM t295.requests WHERE request_id=$1) AS publication`, [complete.requestId]);
    assert.deepEqual(counts, { ledger: 1, audit: 1, publication: 1 });
    assert((await feed()).works.some(entry => entry.image?.src === path(slug, "1")));
    const response = await cover(slug, "1");
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes);
    const head = await cover(slug, "1", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    beforePublicRead = async () => {
      beforePublicRead = undefined;
      assert.deepEqual(await service.apply(command("revoke", slug, "2", "1")), { status: "revoked", version: "3", generation: "1" });
    };
    assert.equal((await cover(slug, "1")).status, 404);
    await hidden(slug, "1");
    assert.deepEqual(await service.apply(complete), result);
    await hidden(slug, "1");
    objects.set(key(slug, "4"), image.bytes);
    await control.query("UPDATE t293.evidence SET value=$1 WHERE owner_id=$2 AND slug=$3", [{ ...proof, cover: { ...proof.cover, objectKey: key(slug, "4") } }, owner, slug]);
    assert.deepEqual(await service.apply(command("prepare", slug, "3", null)), { status: "prepared", version: "4", generation: "4" });
    assert.deepEqual(await service.apply(command("complete", slug, "4", "4")), { status: "published", version: "5", generation: "4" });
    await hidden(slug, "1");
    assert.equal((await cover(slug, "4")).status, 200);

    const cutoff = Date.now() + 3500;
    await seed("t332-timed", 2, cutoff);
    assert.equal((await service.apply(command("prepare", "t332-timed", "0", null))).status, "prepared");
    assert.equal((await service.apply(command("complete", "t332-timed", "1", "1"))).status, "published");
    assert.equal((await cover("t332-timed", "1")).status, 200);
    await control.query("SELECT pg_sleep_until($1::timestamptz)", [new Date(cutoff + 10)]);
    await hidden("t332-timed", "1");

    const evidenceExpiry = Date.now() + 60_000;
    await seed("t332-disagreement", 3, evidenceExpiry, evidenceExpiry + 1);
    const inconsistent = command("prepare", "t332-disagreement", "0", null);
    assert.deepEqual(await service.apply(inconsistent), { status: "unavailable" });
    const { rows: [rolledBack] } = await control.query(`SELECT
      (SELECT state->>'revision' FROM t293.works WHERE slug=$1) AS revision,
      (SELECT count(*)::int FROM t293.manifests WHERE slug=$1) AS manifest,
      (SELECT count(*)::int FROM t295.frozen_manifest WHERE slug=$1) AS frozen,
      (SELECT count(*)::int FROM t293.app_requests WHERE request_id=$2) AS ledger,
      (SELECT count(*)::int FROM t295.requests WHERE request_id=$2) AS publication,
      (SELECT count(*)::int FROM t293.audit WHERE request_id=$2) AS audit`, [inconsistent.slug, inconsistent.requestId]);
    assert.deepEqual(rolledBack, { revision: "0", manifest: 0, frozen: 0, ledger: 0, publication: 0, audit: 0 });

    await control.query("REVOKE t295_file FROM t328_cover");
    try {
      assert.equal((await cover(slug, "4")).status, 503);
      assert.equal((await service.list()).kind, "failed");
      assert.equal((await feed()).state, "unavailable");
    } finally { await control.query("GRANT t295_file TO t328_cover"); }
  } finally { await runtime.close(); }

  for (const test of [{ ...options, adminActorId: other }, { ...options, rightsReader: { schema: "t332", name: "missing" } }]) {
    const failing = createPublicationRuntime(() => createVerifiedPublicationRuntimeOptions(test));
    try { assert.equal((await failing.get()).mode, "inactive"); }
    finally { await failing.close(); }
  }
  await control.query("GRANT EXECUTE ON FUNCTION t332.rights_state(text,bigint) TO t328_list");
  const leaked = createPublicationRuntime(() => createVerifiedPublicationRuntimeOptions(options));
  try { assert.equal((await leaked.get()).mode, "inactive"); }
  finally {
    await leaked.close();
    await control.query("REVOKE EXECUTE ON FUNCTION t332.rights_state(text,bigint) FROM t328_list");
  }
  const sessions = await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='dream-backend'");
  assert.equal(sessions.rows[0].n, 0);
  if (publisher.rowCount === 1) await control.query("DELETE FROM t253_showcase.publishers WHERE actor=$1", [owner]);
  console.log("T332 bound actors, publish/withdraw/replay, generations, expiry, rights rollback, invalid roles and cleanup passed");
}
