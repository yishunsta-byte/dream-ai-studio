import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Client } from "pg";
import type { resolveServerAuth } from "../../lib/auth/resolve";
import { createAdminPublicationService } from "../../lib/public-showcase/admin-publication-service";
import { readApprovedSnapshot } from "../../lib/public-showcase/showcase-source";
import { createT306PublicationStore } from "./t306-publication-e2e-store";

// T306-F1 권리 대조 시나리오(시험 전용). t306-publication-e2e-native.ts --scenarios 가 본인 소유 루프백 PG17 하나에서 부른다.
// 실제 관리자 게시 서비스 + T306 저장소(계정 로그인 t293_actor_a/b) + 고정 SQL(T253·T293·T295)로,
// 만료 전 서로 다른 두 시한, 무기한↔시한부, 밀리초 아래 자투리, 최초 manifest 불일치가 앱 상태·공개 활성·
// 네 원장(app_requests·t295.requests·t253 requests·manifests)·감사를 하나도 남기지 않는지, 정합 시 흐름은 그대로인지 확인한다.
type Seed = (owner: string, slug: string, title: string, options?: { evidenceMs?: number | null; attestation?: string | null; manifest?: Record<string, unknown> }) => Promise<void>;
export type ScenarioDeps = Readonly<{
  admin: Client; port: number; database: string; logins: Map<string, string>; ownerA: string; ownerB: string; seed: Seed;
}>;

export async function runScenarios({ admin, port, database, logins, ownerA, ownerB, seed }: ScenarioDeps) {
  const pools: pg.Pool[] = [];
  const clients: Client[] = [];
  const secret = (name: string) => { const value = logins.get(name); assert(value); return value; };
  const pool = (user: string) => {
    const created = new pg.Pool({ host: "127.0.0.1", port, database, user, password: secret(user), ssl: false, max: 2, statement_timeout: 12_000 });
    created.on("error", () => undefined);
    pools.push(created);
    return created;
  };
  const login = async (user: string) => {
    const client = new pg.Client({ host: "127.0.0.1", port, database, user, password: secret(user), ssl: false, statement_timeout: 12_000 });
    await client.connect();
    clients.push(client);
    return client;
  };
  try {
    const store = createT306PublicationStore({ [ownerA]: pool("t293_actor_a"), [ownerB]: pool("t293_actor_b") });
    const auth = (async () => ({ kind: "verified", userId: ownerA, email: "a@example.invalid" })) as unknown as typeof resolveServerAuth;
    const service = createAdminPublicationService(store, auth, Date.now);
    const [list, file, actorB] = await Promise.all([login("t295_read_list"), login("t295_read_file"), login("t293_actor_b")]);

    const body = (command: "prepare" | "complete" | "revoke", slug: string, expectedVersion: string, generation: string | null) =>
      ({ requestId: randomUUID(), command, slug, expectedVersion, generation, rightsConfirmed: command !== "revoke" });
    const ok = (status: string, version: string, generation: string) => ({ status, version, generation });
    const dbNow = async () => Number((await admin.query<{ ms: string }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS ms")).rows[0].ms);
    const iso = (ms: number) => new Date(ms).toISOString();
    const isoPlusMicros = (ms: number, micros: string) => iso(ms).replace(/Z$/, `${micros}Z`); // .097Z → .097500Z
    const ids = new Map<string, string[]>();
    async function run(input: ReturnType<typeof body>) {
      ids.set(input.slug, [...(ids.get(input.slug) ?? []), input.requestId]);
      return service.apply(input);
    }
    async function footprint(slug: string) {
      const requestIds = ids.get(slug) ?? [];
      return (await admin.query(`SELECT
        (SELECT state->>'revision' FROM t293.works WHERE slug=$1) AS revision,
        (SELECT count(*) FROM t293.app_requests WHERE slug=$1)::int AS app,
        (SELECT count(*) FROM t293.audit WHERE request_id = ANY($2::uuid[]))::int AS audit,
        (SELECT count(*) FROM t293.manifests WHERE slug=$1)::int AS manifests,
        (SELECT count(*) FROM t295.requests WHERE request_id = ANY($2::uuid[]))::int AS t295,
        (SELECT count(*) FROM t253_showcase.requests WHERE request_id = ANY($2::uuid[]))::int AS t253,
        (SELECT count(*) FROM t295.frozen_manifest WHERE slug=$1)::int AS frozen,
        (SELECT count(*) FROM t295.activation WHERE slug=$1)::int AS activation,
        (SELECT active_generation::text FROM t253_showcase.slots WHERE slug=$1) AS slot`, [slug, requestIds])).rows[0];
    }
    const nothing = { revision: "0", app: 0, audit: 0, manifests: 0, t295: 0, t253: 0, frozen: 0, activation: 0, slot: null };
    const listed = async (slug: string) => readApprovedSnapshot((await list.query("SELECT t295.list_approved() v")).rows[0].v).records.some((row) => row.id === slug);
    const coverRows = async (slug: string, generation: string) => (await file.query("SELECT * FROM t295.find_cover($1,$2)", [slug, generation])).rowCount;
    const report: Record<string, unknown> = {};

    const future = (await dbNow()) + 180_000;
    const titles: Record<string, string> = {};
    const seedA = async (slug: string, options: Parameters<Seed>[3]) => { titles[slug] = slug; await seed(ownerA, slug, `시나리오 ${slug}`, options); };
    await admin.query("BEGIN");
    await seedA("match-timed", { evidenceMs: future, attestation: iso(future) });
    await seedA("match-perpetual", { evidenceMs: null, attestation: null });
    await seedA("timed-two", { evidenceMs: future, attestation: iso(future + 1) });
    await seedA("timed-submilli", { evidenceMs: future, attestation: isoPlusMicros(future, "500") });
    await seedA("perpetual-vs-timed", { evidenceMs: null, attestation: iso(future) });
    await seedA("timed-vs-perpetual", { evidenceMs: future, attestation: null });
    await seedA("manifest-title", { evidenceMs: null, attestation: null, manifest: { display: { kind: "광고", title: "다른 제목", subtitle: "합성 시험 작품",
      creator: "합성 작업실", genre: "디자인", format: "이미지", description: "격리 종단 시험용 합성 완성본이에요.", width: 8, height: 6 } } });
    await seedA("manifest-source", { evidenceMs: null, attestation: null, manifest: { sourceSha: "b".repeat(64) } });
    await seedA("late-attestation", { evidenceMs: future, attestation: iso(future) });
    await admin.query("COMMIT");

    // ① 정합: 시한부(정확히 같은 ms) — 준비/게시/철회, 같은 UUID 재전송, 공개 리더
    const p1 = body("prepare", "match-timed", "0", null);
    assert.deepEqual(await run(p1), ok("prepared", "1", "1"));
    assert.deepEqual(await service.apply(p1), ok("prepared", "1", "1"));
    const c1 = body("complete", "match-timed", "1", "1");
    assert.deepEqual(await run(c1), ok("published", "2", "1"));
    assert.deepEqual(await service.apply(c1), ok("published", "2", "1"));
    const activeTimed = (await admin.query("SELECT mode, t306.exact_ms(expires_at) AS ms FROM t295.activation WHERE slug='match-timed'")).rows[0];
    assert.deepEqual(activeTimed, { mode: "timed", ms: String(future) });
    const appTimed = (await admin.query("SELECT (state->'active'->>'rightsUntilMs') AS until, (state->'active'->>'approvedMs') AS approved FROM t293.works WHERE slug='match-timed'")).rows[0];
    assert.equal(appTimed.until, String(future));
    assert.equal(appTimed.approved, (await admin.query("SELECT approved_ms::text AS v FROM t295.activation WHERE slug='match-timed'")).rows[0].v);
    assert.equal(await listed("match-timed"), true);
    assert.equal(await coverRows("match-timed", "1"), 1);
    const r1 = body("revoke", "match-timed", "2", "1");
    assert.deepEqual(await run(r1), ok("revoked", "3", "1"));
    assert.deepEqual(await service.apply(r1), ok("revoked", "3", "1"));
    assert.equal(await listed("match-timed"), false);
    assert.equal(await coverRows("match-timed", "1"), 0);
    assert.deepEqual(await footprint("match-timed"), { revision: "3", app: 3, audit: 3, manifests: 1, t295: 3, t253: 3, frozen: 1, activation: 1, slot: null });
    report.matchTimed = { activation: activeTimed, app: appTimed.until, ledgers: "3/3/3/3, manifest 1" };

    // ② 정합: 무기한
    assert.deepEqual(await run(body("prepare", "match-perpetual", "0", null)), ok("prepared", "1", "1"));
    assert.deepEqual(await run(body("complete", "match-perpetual", "1", "1")), ok("published", "2", "1"));
    assert.deepEqual((await admin.query("SELECT mode, expires_at FROM t295.activation WHERE slug='match-perpetual'")).rows[0], { mode: "perpetual", expires_at: null });
    assert.equal(await listed("match-perpetual"), true);
    assert.deepEqual(await footprint("match-perpetual"), { revision: "2", app: 2, audit: 2, manifests: 1, t295: 2, t253: 2, frozen: 1, activation: 1, slot: "1" });

    // ③ 불일치(만료 전): 결과 DTO는 같아도 권리·manifest가 다르면 전부 롤백 — 같은 UUID 재시도도 같은 결과, 흔적 0
    for (const slug of ["timed-two", "timed-submilli", "perpetual-vs-timed", "timed-vs-perpetual", "manifest-title", "manifest-source"]) {
      const prepare = body("prepare", slug, "0", null);
      assert.deepEqual(await run(prepare), { status: "unavailable" }, slug);
      assert.deepEqual(await service.apply(prepare), { status: "unavailable" }, slug);
      assert.deepEqual(await footprint(slug), nothing, slug);
      assert.equal(await listed(slug), false, slug);
      report[slug] = "rolled back";
    }

    // ④ 준비 뒤 권리 증명만 바뀜(둘 다 만료 전): SQL source-unavailable ≠ 서비스 published → 롤백, 준비 상태 그대로.
    //    되돌리면 새 요청으로 정상 게시.
    assert.deepEqual(await run(body("prepare", "late-attestation", "0", null)), ok("prepared", "1", "1"));
    const afterPrepare = await footprint("late-attestation");
    await admin.query("UPDATE t295.attestations SET expires_at=$2::timestamptz WHERE slug=$1", ["late-attestation", iso(future + 5000)]);
    const lateComplete = body("complete", "late-attestation", "1", "1");
    assert.deepEqual(await run(lateComplete), { status: "unavailable" });
    assert.deepEqual(await footprint("late-attestation"), { ...afterPrepare });
    assert.deepEqual(afterPrepare, { revision: "1", app: 1, audit: 1, manifests: 1, t295: 1, t253: 1, frozen: 1, activation: 0, slot: null });
    await admin.query("UPDATE t295.attestations SET expires_at=$2::timestamptz WHERE slug=$1", ["late-attestation", iso(future)]);
    assert.deepEqual(await run(lateComplete), ok("published", "2", "1")); // 같은 UUID: 앞선 시도가 아무것도 남기지 않았으므로 새로 처리
    assert.deepEqual(await footprint("late-attestation"), { revision: "2", app: 2, audit: 2, manifests: 1, t295: 2, t253: 2, frozen: 1, activation: 1, slot: "1" });

    // ⑤ 만료 경계: 시한 안 게시 → 만료 뒤 공개 리더에서 빠짐. 준비만 한 작품은 만료 뒤 게시가 양쪽 모두 거절(앱 원장 1, SQL 흔적 0)
    const edge = (await dbNow()) + 4000;
    await admin.query("BEGIN");
    await seedA("edge-published", { evidenceMs: edge, attestation: iso(edge) });
    await seedA("edge-pending", { evidenceMs: edge, attestation: iso(edge) });
    await admin.query("COMMIT");
    assert.deepEqual(await run(body("prepare", "edge-published", "0", null)), ok("prepared", "1", "1"));
    assert.deepEqual(await run(body("complete", "edge-published", "1", "1")), ok("published", "2", "1"));
    assert.deepEqual(await run(body("prepare", "edge-pending", "0", null)), ok("prepared", "1", "1"));
    assert.equal(await listed("edge-published"), true);
    assert.equal(await coverRows("edge-published", "1"), 1);
    await admin.query("SELECT pg_sleep_until($1::timestamptz + interval '5 milliseconds')", [iso(edge)]);
    assert.equal(await listed("edge-published"), false);
    assert.equal(await coverRows("edge-published", "1"), 0);
    const expiredComplete = body("complete", "edge-pending", "1", "1");
    assert.deepEqual(await run(expiredComplete), { status: "source-unavailable" });
    assert.deepEqual(await service.apply(expiredComplete), { status: "source-unavailable" });
    assert.deepEqual(await footprint("edge-pending"), { revision: "1", app: 2, audit: 1, manifests: 1, t295: 1, t253: 1, frozen: 1, activation: 0, slot: null });
    assert.deepEqual(await footprint("edge-published"), { revision: "2", app: 2, audit: 2, manifests: 1, t295: 2, t253: 2, frozen: 1, activation: 1, slot: "1" });

    // ⑥ 읽기 함수 경계: B 로그인은 A의 행을 못 보고, 공개 읽기 로그인은 함수 자체를 못 부른다.
    await actorB.query("BEGIN");
    await actorB.query("SELECT set_config('t293.actor',$1,true)", [ownerB]);
    assert.deepEqual((await actorB.query("SELECT t306.rights_state('match-perpetual',1) AS v")).rows[0].v, { frozen: null, activation: null });
    await actorB.query("ROLLBACK");
    const denied = async (client: Client) => client.query("SELECT t306.rights_state('match-perpetual',1)").then(() => "ok", (error) => error.code);
    report.readBoundary = { listLogin: await denied(list), fileLogin: await denied(file) };
    assert.deepEqual(report.readBoundary, { listLogin: "42501", fileLogin: "42501" });
    report.expiryBoundary = "published→hidden after expiry; pending→source-unavailable both sides";
    console.log(JSON.stringify({ scenarios: "passed", report }));
  } finally {
    await Promise.allSettled([...clients.map((client) => client.end()), ...pools.map((created) => created.end())]);
  }
}
