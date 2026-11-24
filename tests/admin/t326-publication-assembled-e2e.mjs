/* global console, process, fetch, setTimeout */
// T326 관리자·공개 라우트 공통 게시 조립 종단 시험(격리 사본 전용 진행기).
// 준비물(커밋하지 않는 격리 절차는 T326 인계 문서 참고):
//   1) T306 네이티브 실행기(서버 모드)가 띄운 소유 루프백 PG17 + 제어 창구.
//   2) T326 주입 패치를 적용해 운영 빌드한 격리 Next 사본(next start는 이 진행기가 모드별로 직접 띄우고 끈다).
// 사용: node tests/admin/t326-publication-assembled-e2e.mjs <격리 앱 폴더> <T306 실행기 출력 파일> <이벤트 기록 폴더> [--inspect]
// 각 모드는 새 Next 프로세스 하나 = T325 조립 한 번이다. 조립 결과는 관리자 GET·POST, 홈, 표지 GET·HEAD가 함께 쓴다.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Buffer } from "node:buffer";

const [app, nativeLog, eventsDir, flag] = process.argv.slice(2);
assert(app && nativeLog && eventsDir, "usage: <app> <native-log> <events-dir> [--inspect]");
const ready = JSON.parse(readFileSync(nativeLog, "utf8").split("\n").find((line) => line.startsWith("{\"ready\":true")));
const CTRL = `http://127.0.0.1:${ready.controlPort}`;
const ctrl = async (path, method = "GET") => (await fetch(CTRL + path, { method })).json();
const okStatus = new Set(["prepared", "published", "revoked", "complete"]);
const ok = ([status, json], expected) => status === 200 && okStatus.has(json.status) && (!expected || json.status === expected);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = {};

async function freePort() {
  const server = createServer();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address();
  await new Promise((ok) => server.close(ok));
  return port;
}
function listeners(port) {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" });
  return Number(out.trim());
}

async function withServer(mode, run) {
  const port = await freePort();
  const events = join(eventsDir, `events-${mode}.log`);
  assert(!existsSync(events), `events file exists: ${mode}`);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", T306_CONFIG: ready.configPath, T326_MODE: mode, T326_EVENTS: events },
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; ; i++) {
      try { await fetch(base + "/favicon.ico"); break; } catch { assert(i < 120, `server ${mode} did not start: ${log.slice(-400)}`); await sleep(500); }
    }
    return await run(base, () => readFileSync(events, "utf8").split("\n").filter(Boolean).map((line) => line.replace(/^\S+ pid=\d+ /, "")));
  } finally {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    for (let i = 0; listeners(port) !== 0; i++) { assert(i < 40, `listener left on ${port}`); await sleep(250); }
    results[`${mode}_listenerAfterStop`] = 0;
  }
}

function client(base) {
  const as = (actor) => ({ cookie: `t306-actor=${actor}` });
  return {
    list: async (actor = "A") => { const r = await fetch(base + "/api/admin/publications", { headers: as(actor) }); return [r.status, await r.json()]; },
    post: async (body, actor = "A") => {
      const r = await fetch(base + "/api/admin/publications", { method: "POST", body: JSON.stringify(body),
        headers: { ...as(actor), origin: base, "content-type": "application/json" } });
      return [r.status, await r.json()];
    },
    home: async () => {
      const r = await fetch(base + "/", { headers: { "cache-control": "no-cache" } });
      const html = await r.text();
      return { status: r.status, cache: r.headers.get("cache-control"), html };
    },
    cover: async (slug, generation) => {
      const url = `${base}/media/public/${slug}/${generation}/cover.webp`;
      const g = await fetch(url); const bytes = Buffer.from(await g.arrayBuffer());
      const h = await fetch(url, { method: "HEAD" }); const headBytes = (await h.arrayBuffer()).byteLength;
      return { get: g.status, type: g.headers.get("content-type"), cache: g.headers.get("cache-control"), bytes: bytes.length,
        sha: g.status === 200 ? sha(bytes).slice(0, 12) : null, head: h.status, headLength: h.headers.get("content-length"), headBytes };
    },
  };
}
const titles = { "neon-alley": "네온 골목 포스터", "timed-coast": "기한 있는 해안", "b-harbor": "B의 항구" };
const homeShows = (html, slug) => html.includes(titles[slug]) && html.includes(`/media/public/${slug}/`);
const row = (list, slug) => list.items?.find((item) => item.slug === slug) ?? list.works?.find((item) => item.slug === slug);
const body = (command, slug, expectedVersion, generation) => ({ requestId: randomUUID(), command, slug, expectedVersion, generation,
  rightsConfirmed: command !== "revoke" });

if (flag === "--inspect") {
  await withServer("normal", async (base, events) => {
    const c = client(base);
    console.log(JSON.stringify({ events: events(), list: await c.list() }, null, 1).slice(0, 4000));
  });
  process.exit(0);
}

// ── 1) 닫힘 모드: 구성 누락 · 관리자 대상 불일치 · 표지 대상만 불일치(합성) ──
for (const mode of ["missing", "admin-mismatch", "cover-mismatch"]) {
  results[mode] = await withServer(mode, async (base, events) => {
    const c = client(base);
    const before = (await ctrl("/state")).counts;
    const [listStatus, list] = await c.list();
    const [postStatus, post] = await c.post(body("prepare", "neon-alley", "0", null));
    const home = await c.home();
    const cover = await c.cover("neon-alley", "1");
    const after = (await ctrl("/state")).counts;
    const out = { events: events(), listStatus, listKind: list.kind, postStatus, postCode: post.code, homeStatus: home.status,
      homeSample: !homeShows(home.html, "neon-alley"), cover, dbUnchanged: JSON.stringify(before) === JSON.stringify(after) };
    assert.equal(listStatus, 200); assert.equal(list.kind, "closed");
    assert.equal(postStatus, 503); assert.equal(post.code, "PUBLICATION_UNLINKED");
    assert.equal(home.status, 200); assert(out.homeSample);
    assert.equal(cover.get, 404); assert.equal(cover.head, 404);
    assert(out.dbUnchanged);
    const ev = out.events;
    assert(ev.includes("assemble-done mode=inactive"), mode);
    if (mode === "missing") assert(!ev.some((line) => /open/.test(line)));
    if (mode === "admin-mismatch") {
      assert(ev.some((line) => line.startsWith("admin-open")) && ev.some((line) => line.startsWith("admin-close pools=0,0")));
      assert(!ev.some((line) => line.startsWith("public-open")));
    }
    if (mode === "cover-mismatch") {
      assert(ev.some((line) => line.startsWith("admin-close pools=0,0")) && ev.includes("public-close"));
    }
    return out;
  });
}

// ── 2) 정상 모드: 한 조립 인스턴스로 준비→게시→홈·표지→중복→철회→재게시→만료 ──
results.normal = await withServer("normal", async (base, events) => {
  const c = client(base);
  const out = {};
  out.eventsAtStart = events();
  assert.deepEqual(out.eventsAtStart.filter((line) => /assemble-start|admin-open|public-open/.test(line)).length, 3, "assembled once");
  const [s0, l0] = await c.list();
  assert.equal(s0, 200);
  out.queue0 = row(l0, "neon-alley");
  out.home0 = homeShows((await c.home()).html, "neon-alley");

  // 준비
  const prep = await c.post(body("prepare", "neon-alley", "0", null));
  out.prepare = prep;
  assert(ok(prep, "prepared"), JSON.stringify(prep));
  out.homeAfterPrepare = homeShows((await c.home()).html, "neon-alley");
  out.coverAfterPrepare = await c.cover("neon-alley", "1");
  assert.equal(out.homeAfterPrepare, false); assert.equal(out.coverAfterPrepare.get, 404);

  // 같은 요청 동시 5회 → 한 번만 처리
  const completeBody = body("complete", "neon-alley", "1", "1");
  const before = (await ctrl("/state")).counts;
  out.duplicate = (await Promise.all(Array.from({ length: 5 }, () => c.post(completeBody)))).map(([status, json]) => `${status}:${json.status ?? json.code}`);
  const afterDup = await ctrl("/state");
  const req = afterDup.requests.filter((r) => r.id === completeBody.requestId);
  out.duplicateLedger = { appRequests: req.length, audits: req[0]?.audits, t295: req[0]?.t295, countsBefore: before, countsAfter: afterDup.counts };
  assert.equal(req.length, 1); assert.equal(req[0].audits, 1); assert.equal(req[0].t295, 1);
  assert(out.duplicate.every((line) => line === out.duplicate[0]) && out.duplicate[0] === "200:published", out.duplicate.join());

  // 홈·표지
  const home1 = await c.home();
  out.homePublished = { status: home1.status, cache: home1.cache, shows: homeShows(home1.html, "neon-alley") };
  out.coverPublished = await c.cover("neon-alley", "1");
  assert(out.homePublished.shows);
  assert.equal(out.coverPublished.get, 200); assert.equal(out.coverPublished.head, 200); assert.equal(out.coverPublished.headBytes, 0);
  out.coverOtherGen = await c.cover("neon-alley", "2");
  assert.equal(out.coverOtherGen.get, 404);

  // 서로 다른 요청이 같은 버전으로 경합 → 하나만 성공
  const [, lr] = await c.list();
  out.queueAfterPublish = row(lr, "neon-alley");
  const { version: v2, activeGeneration: g1 } = out.queueAfterPublish;
  const race = await Promise.all(Array.from({ length: 4 }, () => c.post(body("revoke", "neon-alley", v2, g1))));
  out.revokeRace = race.map(([status, json]) => `${status}:${json.status ?? json.code}`);
  assert.equal(race.filter((r) => ok(r, "revoked")).length, 1, out.revokeRace.join());
  assert.equal(race.filter((r) => r[1].status === "conflict").length, 3, out.revokeRace.join());

  // 철회 뒤
  out.homeRevoked = homeShows((await c.home()).html, "neon-alley");
  out.coverRevoked = await c.cover("neon-alley", "1");
  assert.equal(out.homeRevoked, false); assert.equal(out.coverRevoked.get, 404); assert.equal(out.coverRevoked.head, 404);

  // 재게시(새 세대) → 과거 세대 차단
  const [, l3] = await c.list();
  out.queueAfterRevoke = row(l3, "neon-alley");
  out.repost = { prepare: await c.post(body("prepare", "neon-alley", out.queueAfterRevoke.version, null)) };
  const [, l4] = await c.list();
  const next = row(l4, "neon-alley").pendingGeneration;
  out.repost.pendingGeneration = next;
  // T306 실행기 /cover: 위험한 세대·모르는 slug 거절, 안전한 다음 세대만 준비, 반복은 같은 바이트 재사용
  out.repost.coverUnsafe = await ctrl(`/cover?slug=neon-alley&generation=${Number(next) + 1}`, "POST");
  out.repost.coverUnknown = await ctrl(`/cover?slug=not-seeded&generation=${next}`, "POST");
  // T326-F1: 같은 세대 /cover 12건 병렬 → 모두 200, 생성 1·재사용 11. 오류(위 409·400) 뒤에도 제어 창구가 정상이다.
  const parallel = await Promise.all(Array.from({ length: 12 }, async () => {
    const r = await fetch(`${CTRL}/cover?slug=neon-alley&generation=${next}`, { method: "POST" });
    return [r.status, await r.json()];
  }));
  out.repost.coverParallel = { statuses: [...new Set(parallel.map(([status]) => status))], created: parallel.filter(([, j]) => j.reused === false).length,
    reused: parallel.filter(([, j]) => j.reused === true).length };
  assert(out.repost.coverUnsafe.error && out.repost.coverUnknown.error);
  assert.deepEqual(out.repost.coverParallel, { statuses: [200], created: 1, reused: 11 }, JSON.stringify(parallel));
  out.repost.stateAfterCover = (await ctrl("/state")).works.find((w) => w.slug === "neon-alley");
  assert(out.repost.stateAfterCover);
  out.repost.complete = await c.post(body("complete", "neon-alley", next, next));
  assert(ok(out.repost.prepare, "prepared")); assert(ok(out.repost.complete, "published"), JSON.stringify(out.repost));
  out.coverGen1AfterRepost = await c.cover("neon-alley", g1);
  out.coverNewGen = await c.cover("neon-alley", next);
  out.homeRepost = homeShows((await c.home()).html, "neon-alley");
  out.homeRepostOldGenLink = (await c.home()).html.includes(`/media/public/neon-alley/${g1}/`);
  assert.equal(out.coverGen1AfterRepost.get, 404); assert.equal(out.coverGen1AfterRepost.head, 404);
  assert.equal(out.coverNewGen.get, 200); assert(out.homeRepost); assert.equal(out.homeRepostOldGenLink, false);
  // 과거 세대 명령 재사용(이전 철회 본문의 세대로 다시 철회) → 거절
  out.staleRevoke = await c.post(body("revoke", "neon-alley", row((await c.list())[1], "neon-alley").version, g1));
  assert(!ok(out.staleRevoke), JSON.stringify(out.staleRevoke));
  out.stateAfterRepost = (await ctrl("/state")).slots;

  // 만료: timed-coast 권리를 짧게 두고 게시 → 만료 뒤 홈·표지 차단
  out.expire = await ctrl("/expire?slug=timed-coast&seconds=12", "POST");
  out.timedPrepare = await c.post(body("prepare", "timed-coast", "0", null));
  out.timedComplete = await c.post(body("complete", "timed-coast", "1", "1"));
  out.timedBefore = { home: homeShows((await c.home()).html, "timed-coast"), cover: await c.cover("timed-coast", "1") };
  const wait = Number(out.expire.evidenceMs) - Date.now() + 1500;
  if (wait > 0) await sleep(wait);
  out.timedAfter = { home: homeShows((await c.home()).html, "timed-coast"), cover: await c.cover("timed-coast", "1") };
  assert(ok(out.timedPrepare, "prepared"), JSON.stringify(out.timedPrepare)); assert(ok(out.timedComplete, "published"), JSON.stringify(out.timedComplete));
  assert(out.timedBefore.home); assert.equal(out.timedBefore.cover.get, 200);
  assert.equal(out.timedAfter.home, false); assert.equal(out.timedAfter.cover.get, 404); assert.equal(out.timedAfter.cover.head, 404);
  // 만료 뒤 같은 세대를 다시 게시하려는 완료 재전송도 새로 반영되지 않는다(원장 재응답 또는 거절)
  out.timedReplayAfterExpiry = await c.post(body("complete", "timed-coast", "1", "1"));
  out.timedAfterReplay = await c.cover("timed-coast", "1");
  assert.equal(out.timedAfterReplay.get, 404);
  out.eventsAtEnd = events();
  return out;
});

console.log(JSON.stringify(results, null, 1));
