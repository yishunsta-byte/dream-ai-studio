import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, realpath, rmdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type ClientConfig, type QueryResultRow } from "pg";
import { v7 } from "uuid";
import { resolveServerAuth } from "../../lib/auth/resolve";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { localPrivateWav } from "../../lib/cloud/local-private-wav";
import type { VerifiedActor } from "../../lib/db/postgres/types";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";
import { createIsolatedStudioMaterialsGet } from "../../lib/reference-analysis/studio-protected-materials-get";
import { createIsolatedRegisteredPcmWavAnalysis } from "../../lib/reference-analysis/studio-registered-pcm-wav-analysis";
import { inspectPcmWav } from "../../lib/services/postgres/pcm-wav";

/**
 * 등록 PCM WAV · 보호 분석 세션 방어 보완 확인(소유 PG17 루프백). 2f77c62 같은 문서 세션 경계 시험과 같은 시험 서버를 쓰고,
 * 보완된 어댑터(POST 401·403 → 로그인·접근 불가, 경계 epoch → 진행 중 취소·목록 재조회)를 판정하는 별도 시험이다.
 * 실행: node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-session-guard-run.mjs
 * 화면은 클라우드 레이아웃과 같은 SessionBoundary → ProtectedContent → 보호 목록 화면이다(제품 코드 그대로, 진입점만 시험용).
 * 세션 신호는 제품 session-sync(다른 탭 BroadcastChannel·focus 복귀)를 그대로 쓰고, /api/auth/session 계약은 시험 서버가 흉내 낸다.
 * 문서를 유지한 채 쿠키만 바꾸는 /__fixture/cookie, 세션 확인 응답 붙잡기(/__fixture/hold-session)를 더했다.
 * "WAV-GUARD-READY <주소>"가 나오면 registered-pcm-wav-session-guard.ego.mjs로 브라우저를 조작한다.
 */
type Fixture = {
  admin: Client; cfg: ClientConfig & { host: string; database: string; port: number; password: string };
  a: VerifiedActor; b: VerifiedActor; baselineProject: string; storagePort: number;
};
type Selection = { projectId: string; assetId: string };
type Evidence = QueryResultRow & {
  content: Buffer; sha256: string; size_bytes: number; registration_generation: number; approval_generation: number;
};
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const rightsNote = "SYNTHETIC_TEST_RIGHTS_NOTE";
const listPath = "/api/studio/reference-analysis/materials";
const analysisPath = "/api/studio/reference-analysis";

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
async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
function toRequest(request: IncomingMessage, body?: Buffer) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
  return new Request(`http://${request.headers.host}${request.url ?? "/"}`, { method: request.method, headers, body: body?.length ? new Uint8Array(body) : undefined });
}
async function send(response: ServerResponse, reply: Response) {
  const headers: Record<string, string> = {};
  reply.headers.forEach((value, key) => { headers[key] = value; });
  response.writeHead(reply.status, headers).end(Buffer.from(await reply.arrayBuffer()));
}

export async function verifySessionGuard({ admin, cfg, a, b, baselineProject, storagePort }: Fixture) {
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.database, "dream_test_t367");
  const { installOwnedWav } = await import(new URL("../postgres/private-wav-http.mjs", import.meta.url).href) as
    { installOwnedWav: (client: Client, config: ClientConfig) => Promise<void> };
  const { withFixtureAuth } = await import(new URL("../../lib/auth/resolve.ts", import.meta.url).href) as
    { withFixtureAuth: <T>(result: ServerAuthResult, run: () => Promise<T>) => Promise<T> };
  assert.equal(typeof withFixtureAuth, "function");
  const verified = (actor: VerifiedActor) => ({ kind: "verified", userId: actor.id, email: "fixture@example.invalid" }) as const;

  // 화면 묶음(PNG·MP4 통합과 같은 진입점, next/link만 일반 링크로)
  const { build } = await import("esbuild");
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL("./registered-pcm-wav-session-boundary-browser.tsx", import.meta.url))],
    bundle: true, platform: "browser", jsx: "automatic", write: false, outfile: "fixture.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "plain-link", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "plain-link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(),
        contents: "import { createElement } from 'react'; export default function Link({ href, ...rest }) { return createElement('a', { href, ...rest }); }" }));
    } }],
  });
  const js = outputFiles.find(({ path }) => path.endsWith(".js"))?.text;
  const css = outputFiles.find(({ path }) => path.endsWith(".css"))?.text;
  assert(js && css, "Missing browser fixture bundle");

  // f1d2b53과 같은 등록·승인 스키마와 RLS 읽기 역할
  await installOwnedWav(admin, cfg);
  await admin.query(await readFile(new URL("registered-pcm-wav-authority.fixture.sql", import.meta.url), "utf8"));
  const { rows: [credential] } = await admin.query("SELECT quote_literal($1::text) AS quoted", [cfg.password]);
  await admin.query("CREATE ROLE pcm_fixture_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD " + credential.quoted);
  await admin.query("GRANT pcm_fixture_reader TO pcm_fixture_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
  const reader = new Client({ ...cfg, user: "pcm_fixture_login", application_name: "pcm-wav-guard-fixture" });
  const root = await realpath(await mkdtemp(join(await realpath(tmpdir()), "dream-pcm-guard-")));
  const env = { DREAM_PRIVATE_UPLOAD_BACKEND: "owned-pg17", DREAM_OWNED_CREATE_PG_PORT: String(cfg.port),
    DREAM_OWNED_CREATE_PG_PASSWORD: cfg.password, DREAM_AUTH_MODE: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + storagePort, FFMPEG_PATH: "", FFPROBE_PATH: "" };
  const prior = Object.keys(env).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, env);
  const servers: ReturnType<typeof createServer>[] = [];

  try {
    await reader.connect();
    // 읽기 연결 하나를 요청 사이에 나눠 쓰므로 트랜잭션을 한 번에 하나씩만 연다.
    let queue: Promise<unknown> = Promise.resolve();
    const asOwner = <T>(actor: VerifiedActor, run: () => Promise<T>) => {
      const next = queue.then(async () => {
        await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL ROLE pcm_fixture_reader");
        try {
          await reader.query("SELECT set_config('dream.actor_id',$1,true)", [actor.id]);
          return await run();
        } finally { await reader.query("ROLLBACK"); }
      });
      queue = next.catch(() => undefined);
      return next;
    };

    async function register(actor: VerifiedActor, bytes: Buffer) {
      assert.deepEqual(inspectPcmWav(bytes), { channels: 1, sampleRate: 8000, frames: 1000 });
      const response = await withFixtureAuth(verified(actor), () => localPrivateWav(new Request(
        "http://127.0.0.1:39970/api/assets/upload?format=wav&filename=track.wav&rightsNote=" + rightsNote,
        { method: "POST", headers: { "content-type": "audio/wav", "idempotency-key": v7() }, body: Uint8Array.from(bytes) })));
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()).id as string;
    }
    const bytesA = wav(8192), bytesB = wav(4096);
    const assetA = await register(a, bytesA), assetB = await register(b, bytesB);
    const projectB = v7();
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,
      goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,'fixture','1','{}','{}','private fixture','','','9:16',4,now(),now())`, [b.id, projectB]);
    const selectedA = { projectId: baselineProject, assetId: assetA };
    const selectedB = { projectId: projectB, assetId: assetB };
    const approve = (actor: VerifiedActor, { projectId, assetId }: Selection) => admin.query(`
      INSERT INTO pcm_fixture.approvals SELECT owner_id,$2,asset_id,generation,1,true FROM pcm_fixture.registrations WHERE owner_id=$1 AND asset_id=$3
      ON CONFLICT(owner_id,project_id,asset_id) DO UPDATE SET active=true,registration_generation=excluded.registration_generation,
        generation=pcm_fixture.approvals.generation+1`, [actor.id, projectId, assetId]);
    const revokeA = () => admin.query("UPDATE pcm_fixture.approvals SET active=false,generation=generation+1 WHERE owner_id=$1 AND asset_id=$2", [a.id, assetA]);
    for (const [actor, selected, bytes] of [[a, selectedA, bytesA], [b, selectedB, bytesB]] as const) {
      await admin.query("INSERT INTO pcm_fixture.registrations VALUES($1,$2,1,$3,$4)", [actor.id, selected.assetId, hash(bytes), bytes.length]);
      await admin.query("INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,'rea-reference')", [actor.id, selected.projectId, selected.assetId]);
      await approve(actor, selected);
    }

    // 원본 바이트를 읽은 횟수(다운로드에 해당). 권한 없는 요청은 행이 없어 늘지 않는다.
    const counts = { listGets: 0, listPrefetch: 0, posts: 0, ready: 0, sourceUnavailable: 0, unauthorized: 0, readsA: 0, readsB: 0,
      held: 0, heldDiscarded: 0, heldDelivered: 0, sessionChecks: 0, sessionHeld: 0 };
    // 세션 확인(/api/auth/session) 응답을 /__fixture/release-session까지 붙잡는다(의심 상태를 관찰하려고).
    let holdSession = false;
    let releaseSession = Promise.withResolvers<void>();
    // 다음 분석 POST 응답 하나를 계산한 뒤 붙잡아 두었다가 /__fixture/release에서 보낸다.
    let holdNext = false;
    let release = Promise.withResolvers<void>();
    const adapter = createIsolatedRegisteredPcmWavAnalysis({
      profile: "isolated-registered-pcm-wav", resolveAuth: resolveServerAuth, workRoot: root,
      async readRegistration(viewer, selection, signal) {
        const result = await asOwner(viewer, () => reader.query<Evidence>(`
          SELECT w.*,f.content FROM pcm_fixture.current_wav w JOIN local_wav.files f USING (owner_id,asset_id)
          WHERE w.owner_id=$1 AND w.project_id=$2 AND w.asset_id=$3`, [viewer.id, selection.projectId, selection.assetId]));
        signal.throwIfAborted();
        const row = result.rows[0];
        if (!row) return;
        if (viewer.id === a.id) counts.readsA++; else counts.readsB++;
        return { status: "authorized", ownerId: viewer.id, ...selection, purpose: "rea-reference",
          storeId: "owned-wav-fixture", restoreGeneration: "1", linkGeneration: "1", ownerPermissionGeneration: "1",
          scopePermissionGeneration: String(row.approval_generation),
          registrationGeneration: String(row.registration_generation), authorizedRegistrationGeneration: String(row.registration_generation),
          mime: "audio/wav", sizeBytes: row.size_bytes, sha256: row.sha256, bytes: row.content };
      },
    });
    assert(adapter);
    const post = createStudioAnalysisPost(adapter);
    const getMaterials = createIsolatedStudioMaterialsGet({ resolveAuth: resolveServerAuth, async readMaterialSnapshots(actor, signal) {
      const { rows } = await asOwner(actor, () => reader.query(`SELECT owner_id,project_id,asset_id,sha256,registration_generation,approval_generation
        FROM pcm_fixture.current_wav ORDER BY asset_id`));
      signal.throwIfAborted();
      return rows.map(row => ({ ownerId: row.owner_id, projectId: row.project_id, assetId: row.asset_id,
        label: `등록 음악 · ${String(row.asset_id).slice(-8)}`, registration: "current", analysisAllowed: true,
        revision: hash(JSON.stringify([row.sha256, row.registration_generation, row.approval_generation])) }));
    } });

    // 요청별 세션: /__session?as=a|b가 그 주소(호스트)에만 쿠키를 남긴다. 쿠키가 없으면 로그인 없음(401).
    const sessionOf = (request: IncomingMessage): ServerAuthResult => {
      const value = /(?:^|;\s*)wav-session=(a|b)(?:;|$)/.exec(request.headers.cookie ?? "")?.[1];
      return value === "a" ? verified(a) : value === "b" ? verified(b) : { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
    };
    const done = Promise.withResolvers<unknown>();
    const app = createServer((request, response) => {
      const handle = async () => {
        const path = (request.url ?? "/").split("?")[0];
        if (request.method === "GET" && path === "/") {
          const session = sessionOf(request);
          const account = session.kind === "verified" ? (session.userId === a.id ? "a@example.invalid" : "b@example.invalid") : "";
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(
            `<!doctype html><html lang="ko" style="--font-pretendard:system-ui"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>콘텐츠 분석 시험</title><link rel="stylesheet" href="/fixture.css"><main id="main-content" class="content"><h1 tabindex="-1">콘텐츠 분석</h1><div id="root" data-account="${account}"></div></main><script src="/fixture.js" defer></script>`);
        } else if (request.method === "GET" && path === "/login") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(
            `<!doctype html><html lang="ko"><meta charset="utf-8"><title>로그인 시험</title><main id="main-content"><h1>로그인 시험 화면</h1></main>`);
        } else if (request.method === "POST" && path === "/api/auth/session") {
          // 제품 checkSession 계약: 401 로그인 없음, 200 {state:"same"|"changed"}. 계정 값은 표시 비교에만 쓴다.
          counts.sessionChecks++;
          const { account } = JSON.parse((await readBody(request)).toString() || "{}") as { account?: string };
          if (holdSession) { counts.sessionHeld++; await releaseSession.promise; }
          const session = sessionOf(request);
          if (session.kind !== "verified") {
            response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ code: "AUTH_REQUIRED" }));
          } else {
            const current = session.userId === a.id ? "a@example.invalid" : "b@example.invalid";
            response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ state: current === account ? "same" : "changed" }));
          }
        } else if (request.method === "GET" && path === "/__fixture/cookie") {
          // 문서를 유지한 채 쿠키만 바꾼다(페이지 안 fetch로 부른다). as=none이면 지운다(만료와 같은 효과).
          const as = new URL(request.url ?? "/", "http://x").searchParams.get("as");
          assert(as === "a" || as === "b" || as === "none");
          response.writeHead(204, { "set-cookie": as === "none" ? "wav-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
            : `wav-session=${as}; Path=/; HttpOnly; SameSite=Strict`, "cache-control": "no-store" }).end();
        } else if (request.method === "GET" && path === "/fixture.js") {
          response.writeHead(200, { "content-type": "application/javascript" }).end(js);
        } else if (request.method === "GET" && path === "/fixture.css") {
          response.writeHead(200, { "content-type": "text/css" }).end(css);
        } else if (request.method === "GET" && path === "/__session") {
          const as = new URL(request.url ?? "/", "http://x").searchParams.get("as");
          assert(as === "a" || as === "b");
          response.writeHead(302, { "set-cookie": `wav-session=${as}; Path=/; HttpOnly; SameSite=Strict`, location: "/" }).end();
        } else if (request.method === "GET" && path === "/__logout") {
          response.writeHead(302, { "set-cookie": "wav-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0", location: "/" }).end();
        } else if (path === listPath) {
          const reply = await withFixtureAuth(sessionOf(request), () => getMaterials(toRequest(request)));
          if (reply.status === 204) counts.listPrefetch++; else counts.listGets++;
          await send(response, reply);
        } else if (request.method === "POST" && path === analysisPath) {
          counts.posts++;
          const body = await readBody(request);
          const reply = await withFixtureAuth(sessionOf(request), () => post(toRequest(request, body)));
          const json = await reply.clone().json().catch(() => null) as { status?: string; reason?: string } | null;
          if (json?.status === "ready") counts.ready++;
          if (json?.reason === "source_unavailable") counts.sourceUnavailable++;
          if (reply.status === 401) counts.unauthorized++;
          if (holdNext) {
            holdNext = false;
            counts.held++;
            await release.promise;
            if (request.socket.destroyed || response.destroyed) { counts.heldDiscarded++; return; }
            counts.heldDelivered++;
          }
          await send(response, reply);
        } else if (request.method === "GET" && path === "/__fixture/state") {
          response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/revoke-a") {
          await revokeA();
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/restore-a") {
          await approve(a, selectedA);
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/hold-next-post") {
          holdNext = true;
          release = Promise.withResolvers<void>();
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/hold-session") {
          holdSession = true;
          releaseSession = Promise.withResolvers<void>();
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/release-session") {
          holdSession = false;
          releaseSession.resolve();
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/release") {
          release.resolve();
          await new Promise(resolveLater => setTimeout(resolveLater, 300));
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
        } else if (request.method === "POST" && path === "/__fixture/done") {
          response.writeHead(200).end("ok");
          done.resolve(JSON.parse((await readBody(request)).toString() || "null"));
        } else response.writeHead(404).end();
      };
      void handle().catch(error => { console.error("fixture handler failed", String(error).slice(0, 200)); response.destroy(); });
    });
    servers.push(app);
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;

    // 초기 HTML·목록 사전 요청: 자료 정보 없음, 204·목록 조회 없음
    const html = await (await fetch(origin + "/")).text();
    for (const secret of [assetA, assetB, a.id, b.id, baselineProject, projectB, "등록 음악", "등록 자료", rightsNote]) assert(!html.includes(secret), "HTML leaked");
    for (const headers of [{ rsc: "1" }, { "next-router-prefetch": "1" }, { "sec-purpose": "prefetch" }] as Record<string, string>[]) {
      const reply = await fetch(origin + listPath, { headers });
      assert.equal(reply.status, 204);
      assert.equal((await reply.arrayBuffer()).byteLength, 0);
    }
    const anonymous = await fetch(origin + listPath);
    assert.equal(anonymous.status, 401);
    assert(!(await anonymous.text()).includes(assetA));
    assert.deepEqual({ ...counts }, { listGets: 1, listPrefetch: 3, posts: 0, ready: 0, sourceUnavailable: 0, unauthorized: 0, readsA: 0, readsB: 0,
      held: 0, heldDiscarded: 0, heldDelivered: 0, sessionChecks: 0, sessionHeld: 0 });
    console.log(`WAV-GUARD-READY ${origin}`);

    let timer: NodeJS.Timeout | undefined;
    const report = await Promise.race([done.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser step timeout")), 600_000); })])
      .finally(() => clearTimeout(timer));
    console.log("WAV-GUARD-REPORT " + JSON.stringify(report));
    console.log("WAV-GUARD-COUNTS " + JSON.stringify(counts));
    const { verdict, failures } = report as { verdict?: string; failures?: string[] };
    assert.equal(verdict, "pass", "Browser round failed: " + JSON.stringify(failures));

    // 서버 쪽 교차 POST: 각 세션이 상대 자료로 보내도 원본을 읽지 않고 차단된다.
    const cross = async (as: "a" | "b", selection: Selection) => {
      const reply = await fetch(origin + analysisPath, { method: "POST", body: JSON.stringify(selection),
        headers: { cookie: `wav-session=${as}`, origin, "content-type": "application/json", "sec-fetch-site": "same-origin" } });
      return (await reply.json() as { reason?: string }).reason;
    };
    const beforeCross = { readsA: counts.readsA, readsB: counts.readsB };
    assert.equal(await cross("a", selectedB), "source_unavailable");
    assert.equal(await cross("b", selectedA), "source_unavailable");
    assert.deepEqual({ readsA: counts.readsA, readsB: counts.readsB }, beforeCross);
    // 두 폭 × [갱신·만료(A 분석·무세션 재분석 401) + 다른 탭 계정 변경(A 분석·붙잡힌 A 재분석·B 분석)
    //          + 같은 계정 신호(A 분석·확인 뒤 새 선택 A 분석) + 신호 없는 쿠키 교체(A 분석·B 쿠키로 A 재분석)] + 교차 2건
    // 붙잡힌 A 재분석은 경계 epoch 전환으로 화면이 취소하므로 전달 0(버림 2)이어야 한다.
    assert.deepEqual({ posts: counts.posts, ready: counts.ready, sourceUnavailable: counts.sourceUnavailable, unauthorized: counts.unauthorized,
      readsA: counts.readsA, readsB: counts.readsB, held: counts.held, heldDelivered: counts.heldDelivered, heldDiscarded: counts.heldDiscarded },
      { posts: 20, ready: 14, sourceUnavailable: 4, unauthorized: 2, readsA: 24, readsB: 4, held: 2, heldDelivered: 0, heldDiscarded: 2 });
    assert.deepEqual(await readdir(root), []);
    console.log("PG17 WAV session guard: refresh keeps state, POST 401 to login state, epoch cancels late analysis, same-account re-query, cookie swap re-query, cleanup");
  } finally {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    }
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { await reader.end(); }
    finally { await rmdir(root); }
  }
}
