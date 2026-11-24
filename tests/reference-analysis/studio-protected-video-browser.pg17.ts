import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readdir, realpath } from "node:fs/promises"; // readdir: 작업 폴더 비움 확인
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { mediaBinary } from "../../lib/media/tools";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { createIsolatedStudioAnalysisConnection } from "../../lib/reference-analysis/studio-analysis-connection";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";

/**
 * 브라우저 → 보호 목록 GET → 사용 권리 확인 → 등록 MP4 분석 POST → 실제 프레임·장면 전환 결과 → 철회·계정 격리(PG17 격리 루프백).
 * studio-analysis-authority-store.pg17.mjs가 STUDIO_ANALYSIS_VERIFY_VIDEO_BROWSER=1일 때 소유 PG17을 띄우고 이 함수를 부른다.
 * 화면 묶음은 PNG 통합과 같은 진입점(studio-protected-materials-browser.tsx)을 그대로 쓴다. 실제 Next 페이지·RSC가 아니라
 * 일반 HTML + 묶음 스크립트다(실제 Next 셸의 HTML·Flight 무노출은 T317·7514ad0 범위).
 * 준비되면 "BROWSER-FIXTURE-READY <origin>"을 출력하고, 외부 브라우저 조작이 /__fixture/done을 부를 때까지 기다린 뒤
 * 서버 쪽 요청·다운로드·결과를 검사한다. 운영 설정·서비스 연결은 쓰지 않는다.
 */
type Selection = Readonly<{ projectId: string; assetId: string }>;
type ConnectionOptions = NonNullable<Parameters<typeof createIsolatedStudioAnalysisConnection>[0]>;
type Fixture = Readonly<{
  admin: Client; root: string; options: ConnectionOptions["authority"] & { bucket: string }; images: Map<string, Buffer>;
  ownerA: string; ownerB: string; selectA: Selection; selectB: Selection;
  ownerPermission: (client: Client, owner: string, allowed: boolean) => Promise<void>;
  scopePermission: (client: Client, owner: string, project: string, asset: string, allowed: boolean) => Promise<void>;
}>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const listPath = "/api/studio/reference-analysis/materials";
const analysisPath = "/api/studio/reference-analysis";

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
function toRequest(origin: string, request: IncomingMessage, body?: Buffer) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
  return new Request(origin + (request.url ?? "/"), { method: request.method, headers, body: body?.length ? new Uint8Array(body) : undefined });
}
async function send(response: ServerResponse, reply: Response) {
  const headers: Record<string, string> = {};
  reply.headers.forEach((value, key) => { headers[key] = value; });
  response.writeHead(reply.status, headers).end(Buffer.from(await reply.arrayBuffer()));
}

/** 2초 MP4 두 개: A는 빨강→청록(1초 장면 전환), B는 파랑→노랑. 32×24, 30fps, mpeg4. */
export async function makeVideos(root: string, assetA: string, assetB: string) {
  const make = async (first: string, second: string, name: string) => {
    const path = join(root, name);
    await promisify(execFile)(mediaBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-nostdin",
      "-f", "lavfi", "-i", `color=${first}:s=32x24:r=30:d=1`, "-f", "lavfi", "-i", `color=${second}:s=32x24:r=30:d=1`,
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4", path], { timeout: 15_000, windowsHide: true });
    return readFile(path);
  };
  return new Map([[assetA, await make("red", "cyan", "video-a.mp4")], [assetB, await make("blue", "yellow", "video-b.mp4")]]);
}

export async function verifyProtectedVideoBrowser({ admin, root, options, images, ownerA, ownerB, selectA, selectB,
  ownerPermission, scopePermission }: Fixture) {
  // 화면 묶음(next/link는 일반 링크로 대체; 시험 화면에는 라우터가 없다).
  const { build } = await import("esbuild");
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL("./studio-protected-materials-browser.tsx", import.meta.url))],
    bundle: true, platform: "browser", jsx: "automatic", write: false, outfile: "fixture.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "plain-link", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "plain-link", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(),
        contents: "import { createElement } from 'react'; export default function Link({ href, ...rest }) { return createElement('a', { href, ...rest }); }" }));
    } }],
  });
  const js = outputFiles.find(({ path }) => path.endsWith(".js"))?.text;
  const css = outputFiles.find(({ path }) => path.endsWith(".css"))?.text;
  assert(js && css, "Missing browser fixture bundle");

  const workRoot = join(await realpath(root), "studio-analysis-files");
  await mkdir(workRoot);
  const bucket = options.bucket;
  const credential = "synthetic-t307-storage-key";
  const objects = new Map([[ownerA, selectA.assetId], [ownerB, selectB.assetId]].map(([owner, id]) => {
    const bytes = images.get(id)!;
    return [`/storage/v1/object/${bucket}/${owner}/assets/${id}/${sha256(bytes)}.mp4`, bytes];
  }));
  const counts = { downloads: 0, downloadsA: 0, downloadsB: 0, listGets: 0, listPrefetch: 0, posts: 0, ready: 0, sourceUnavailable: 0 };
  const storageServer = createServer((request, response) => {
    if (request.method !== "GET" || request.headers.authorization !== `Bearer ${credential}` || request.headers.apikey !== credential) {
      response.writeHead(403).end(); return;
    }
    if (request.url === `/storage/v1/bucket/${bucket}`) {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: bucket, name: bucket, public: false })); return;
    }
    const bytes = objects.get(request.url ?? "");
    if (!bytes) { response.writeHead(404).end(); return; }
    counts.downloads++;
    if (request.url?.includes(`/${ownerA}/`)) counts.downloadsA++; else counts.downloadsB++;
    response.writeHead(200, { "content-length": bytes.length }).end(bytes);
  });
  storageServer.listen(0, "127.0.0.1");
  await once(storageServer, "listening");
  const storageAddress = storageServer.address();
  assert(storageAddress && typeof storageAddress !== "string");
  const storage = { profile: "synthetic", projectUrl: `http://127.0.0.1:${storageAddress.port}`, projectRef: "abcdefghijklmnopqrst", bucket,
    privateBucket: true, credential: { mode: "service-role", key: credential }, maxBytes: 1_048_576, timeoutMs: 2750, maxConcurrent: 2,
    workRoot, ffprobePath: resolve(mediaBinary("ffprobe")) } as const;
  const account = (userId: string): ServerAuthResult => ({ kind: "verified", userId, email: "synthetic@example.invalid" });
  let auth = account(ownerA);
  let ownerBEnabled = false;
  const resolveAuth = async () => auth;

  // 소유자 A만 승인: 목록은 A의 등록 MP4 하나. B의 MP4는 계정 전환 단계에서만 승인한다.
  await ownerPermission(admin, ownerA, true);
  await scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, true);
  const connection = await createIsolatedStudioAnalysisConnection({ authority: options, storage, resolveAuth });
  assert(connection, "Isolated connection unavailable");
  const post = createStudioAnalysisPost(connection.post);
  const results: unknown[] = [];
  const done = Promise.withResolvers<unknown>();
  let origin = "";

  const app = createServer((request, response) => {
    const handle = async () => {
      const path = (request.url ?? "/").split("?")[0];
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(
          `<!doctype html><html lang="ko" style="--font-pretendard:system-ui"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>콘텐츠 분석 시험</title><link rel="stylesheet" href="/fixture.css"><main id="main-content" class="content"><h1 tabindex="-1">콘텐츠 분석</h1><div id="root"></div></main><script src="/fixture.js" defer></script>`);
      } else if (request.method === "GET" && request.url === "/fixture.js") {
        response.writeHead(200, { "content-type": "application/javascript" }).end(js);
      } else if (request.method === "GET" && request.url === "/fixture.css") {
        response.writeHead(200, { "content-type": "text/css" }).end(css);
      } else if (path === listPath) {
        const reply = await connection.getMaterials(toRequest(origin, request));
        if (reply.status === 204) counts.listPrefetch++; else counts.listGets++;
        await send(response, reply);
      } else if (request.method === "POST" && path === analysisPath) {
        counts.posts++;
        const reply = await post(toRequest(origin, request, await readBody(request)));
        const body = await reply.clone().json().catch(() => null) as { status?: string; reason?: string } | null;
        if (body?.status === "ready") counts.ready++;
        if (body?.reason === "source_unavailable") counts.sourceUnavailable++;
        results.push(body);
        await send(response, reply);
      } else if (request.method === "GET" && path === "/__fixture/state") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && path === "/__fixture/revoke") {
        await scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, false);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && path === "/__fixture/restore") {
        await scopePermission(admin, ownerA, selectA.projectId, selectA.assetId, true);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && path === "/__fixture/account-b") {
        // 계정 격리: 로그인 계정을 B로 바꾸고 B의 자기 자료만 승인한다. A의 승인은 그대로 둔다.
        // 소유자 권한은 한 번만 켠다(이미 켜진 권한을 다시 켜면 권한 함수가 거절한다). 자료 승인은 단계마다 켜고 끈다.
        if (!ownerBEnabled) { await ownerPermission(admin, ownerB, true); ownerBEnabled = true; }
        await scopePermission(admin, ownerB, selectB.projectId, selectB.assetId, true);
        auth = account(ownerB);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && path === "/__fixture/account-a") {
        await scopePermission(admin, ownerB, selectB.projectId, selectB.assetId, false);
        auth = account(ownerA);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && path === "/__fixture/done") {
        response.writeHead(200).end("ok");
        done.resolve(JSON.parse((await readBody(request)).toString() || "null"));
      } else response.writeHead(404).end();
    };
    void handle().catch(error => { console.error("fixture handler failed", String(error).slice(0, 200)); response.destroy(); });
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const appAddress = app.address();
  assert(appAddress && typeof appAddress !== "string");
  origin = `http://127.0.0.1:${appAddress.port}`;

  try {
    // 초기 HTML과 프리페치: 보호 메타데이터 없음, 목록 사전 요청은 204·인증/목록 호출 없음.
    const html = await (await fetch(origin + "/")).text();
    for (const secret of [selectA.projectId, selectA.assetId, selectB.assetId, ownerA, "등록 이미지", "등록 자료"]) assert(!html.includes(secret), "HTML leaked");
    for (const headers of [{ rsc: "1" }, { "next-router-prefetch": "1" }, { "sec-purpose": "prefetch" }] as Record<string, string>[]) {
      const reply = await fetch(origin + listPath, { headers });
      assert.equal(reply.status, 204);
      assert.equal((await reply.arrayBuffer()).byteLength, 0);
    }
    assert.deepEqual({ ...counts }, { downloads: 0, downloadsA: 0, downloadsB: 0, listGets: 0, listPrefetch: 3, posts: 0, ready: 0, sourceUnavailable: 0 });
    console.log(`BROWSER-FIXTURE-READY ${origin}`);

    // 보고를 받으면 시한 타이머를 지워 실행기가 정리 뒤 바로 끝나게 한다.
    let timer: NodeJS.Timeout | undefined;
    const browserReport = await Promise.race([done.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser step timeout")), 600_000); })])
      .finally(() => clearTimeout(timer));
    console.log("BROWSER-REPORT " + JSON.stringify(browserReport));
    console.log("SERVER-COUNTS " + JSON.stringify(counts));
    // 서버 쪽 계정 격리: 로그인한 계정이 다른 계정의 자료 ID로 직접 보내도 다운로드 없이 차단된다.
    const crossPost = async (selection: Selection) => {
      const reply = await fetch(origin + analysisPath, { method: "POST", body: JSON.stringify(selection),
        headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" } });
      return { status: reply.status, body: await reply.json().catch(() => null) as { status?: string; reason?: string } | null };
    };
    const beforeCross = { ...counts };
    const aToB = await crossPost(selectB);
    await scopePermission(admin, ownerB, selectB.projectId, selectB.assetId, true);
    auth = account(ownerB);
    const bToA = await crossPost(selectA);
    await scopePermission(admin, ownerB, selectB.projectId, selectB.assetId, false);
    auth = account(ownerA);
    const cross = { aToB, bToA, downloads: counts.downloads - beforeCross.downloads };
    console.log("CROSS-ACCOUNT " + JSON.stringify(cross));
    assert.deepEqual(cross, { aToB: { status: 200, body: { schemaVersion: 1, status: "unavailable", reason: "source_unavailable" } },
      bToA: { status: 200, body: { schemaVersion: 1, status: "unavailable", reason: "source_unavailable" } }, downloads: 0 });

    // 브라우저 보고 판정
    type Counts = typeof counts;
    type Analysis = { checkFocus: string; beforeRights: Counts; afterResult: Counts; runFocus: string;
      result: { focus: string; meta: string | null; items: string[]; headings: string[]; evidence: string; draft: boolean };
      details: { seek: string | null; evidence: string }[] };
    type Step = Analysis & { width: number; firstEntry: string; options: string[]; domLeaks: string[]; layout: string;
      revoked: Record<string, boolean>; revokedFocus: string; afterRevoke: Counts; overflowX: number;
      accountB: Analysis & { options: string[]; fresh: { selected: number; checked: boolean | null; textarea: boolean; result: boolean } } };
    const steps = browserReport as Step[];
    assert.deepEqual(steps.map(({ width }) => width), [390, 1440]);
    const checkAnalysis = (step: Analysis, previous: Counts, owner: "downloadsA" | "downloadsB") => {
      assert.equal(step.checkFocus, "INPUT:체크(끔)");
      assert.equal(step.beforeRights.posts, previous.posts, "POST before rights confirmation");
      assert.equal(step.beforeRights.downloads, previous.downloads);
      assert.equal(step.runFocus, "BUTTON:분석 실행");
      assert.equal(step.afterResult.posts, previous.posts + 1);
      assert.equal(step.afterResult.ready, previous.ready + 1);
      assert.equal(step.afterResult.downloads, previous.downloads + 1);
      assert.equal(step.afterResult[owner], previous[owner] + 1, "Downloaded another account's object");
      assert.equal(step.result.focus, "H3:분석 결과");
      assert.deepEqual(step.result.headings, ["관찰 근거", "분석 추정", "창작 초안"]);
      assert(step.result.draft);
      assert.equal(step.result.meta, `영상 분석 · 결과 ${step.result.items.length}개`);
      // 2초 MP4(1초에 빨강→청록): 0 ms·1000 ms 디코딩 프레임과 1초 장면 전환 후보(인접 프레임 967–1000 ms).
      assert(step.result.items.some(item => /· 0 ms$/.test(item)), "frame at 0 ms");
      assert(step.result.items.some(item => /· 1000 ms$/.test(item)), "frame at 1000 ms");
      assert(step.result.items.some(item => /· 1000 ms · 장면 전환 후보$/.test(item)), "cut candidate at 1000 ms");
      assert.deepEqual(step.details.map(({ seek }) => seek), step.result.items.map(item => item.match(/· (\d+) ms/)?.[1] ?? null));
      assert(step.details.some(({ evidence }) => /967.?1000 ms/.test(evidence)), "cut evidence 967–1000 ms");
      assert(step.details.every(({ seek }) => seek === null || Number(seek) <= 2000), "times within 2 s");
    };
    let previous: Counts = { downloads: 0, downloadsA: 0, downloadsB: 0, listGets: 0, listPrefetch: 3, posts: 0, ready: 0, sourceUnavailable: 0 };
    for (const step of steps) {
      assert.equal(step.firstEntry, "BODY");
      assert.deepEqual(step.domLeaks, []);
      assert.deepEqual(step.options, ["등록 자료를 선택하세요", "등록 자료 1"]);
      checkAnalysis(step, previous, "downloadsA");
      assert.deepEqual(step.revoked, { select: false, textarea: false, check: false, result: false });
      assert.match(step.revokedFocus, /^DIV:분석할 수 있는 등록 자료가 없어요/);
      assert.equal(step.afterRevoke.downloads, step.afterResult.downloads, "Revoked analysis must not download");
      assert.equal(step.afterRevoke.sourceUnavailable, step.afterResult.sourceUnavailable + 1);
      assert.equal(step.overflowX, 0);
      // 계정 B: 자기 자료 1개만, A의 선택·체크·결과가 남지 않음, B 분석은 B 객체만 내려받음.
      assert.deepEqual(step.accountB.options, ["등록 자료를 선택하세요", "등록 자료 1"]);
      assert.deepEqual(step.accountB.fresh, { selected: 0, checked: false, textarea: false, result: false });
      checkAnalysis(step.accountB, step.afterRevoke, "downloadsB");
      assert.equal(step.accountB.afterResult.downloadsA, step.afterRevoke.downloadsA);
      previous = step.accountB.afterResult;
    }
    assert.deepEqual(steps.map(({ layout }) => layout), ["아래", "옆"]);
    assert.deepEqual({ downloads: counts.downloads, downloadsA: counts.downloadsA, downloadsB: counts.downloadsB, posts: counts.posts,
      ready: counts.ready, sourceUnavailable: counts.sourceUnavailable },
    { downloads: 4, downloadsA: 2, downloadsB: 2, posts: 8, ready: 4, sourceUnavailable: 4 });
    assert(!JSON.stringify(results).includes(sha256(images.get(selectA.assetId)!)));
    assert.deepEqual(await readdir(workRoot), []);
    console.log("PG17 protected video browser: initial HTML/prefetch clean, no POST before rights, approved MP4 frames and cut, revocation cleared result and list, account isolation");
  } finally {
    await connection.close();
    for (const server of [app, storageServer]) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
}
