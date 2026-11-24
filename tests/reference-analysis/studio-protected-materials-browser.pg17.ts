import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readdir, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { createIsolatedStudioAnalysisConnection } from "../../lib/reference-analysis/studio-analysis-connection";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";

/**
 * 브라우저 → 보호 목록 GET → 사용 권리 확인 → 등록 PNG 분석 POST → 실제 이미지 결과(PG17 격리 루프백).
 * studio-analysis-authority-store.pg17.mjs가 STUDIO_ANALYSIS_VERIFY_BROWSER=1일 때 소유 PG17을 띄우고 이 함수를 부른다.
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

export async function verifyProtectedMaterialsBrowser({ admin, root, options, images, ownerA, ownerB, selectA, selectB,
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
    return [`/storage/v1/object/${bucket}/${owner}/assets/${id}/${sha256(bytes)}.png`, bytes];
  }));
  const counts = { downloads: 0, listGets: 0, listPrefetch: 0, posts: 0, ready: 0, sourceUnavailable: 0 };
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
    response.writeHead(200, { "content-length": bytes.length }).end(bytes);
  });
  storageServer.listen(0, "127.0.0.1");
  await once(storageServer, "listening");
  const storageAddress = storageServer.address();
  assert(storageAddress && typeof storageAddress !== "string");
  const storage = { profile: "synthetic", projectUrl: `http://127.0.0.1:${storageAddress.port}`, projectRef: "abcdefghijklmnopqrst", bucket,
    privateBucket: true, credential: { mode: "service-role", key: credential }, maxBytes: 1_048_576, timeoutMs: 2750, maxConcurrent: 2,
    workRoot, ffprobePath: join(workRoot, "unused-ffprobe.exe") } as const;
  const auth: ServerAuthResult = { kind: "verified", userId: ownerA, email: "synthetic@example.invalid" };
  const resolveAuth = async () => auth;

  // 소유자 A만 승인: 목록은 A의 등록 PNG 하나.
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
    assert.deepEqual({ ...counts }, { downloads: 0, listGets: 0, listPrefetch: 3, posts: 0, ready: 0, sourceUnavailable: 0 });
    console.log(`BROWSER-FIXTURE-READY ${origin}`);

    // 10분 대기 제한은 유지하되, 보고를 받든 시간이 지나든 타이머를 지워 실행기가 정리 뒤 바로 끝나게 한다.
    let timer: NodeJS.Timeout | undefined;
    const browserReport = await Promise.race([done.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser step timeout")), 600_000); })])
      .finally(() => clearTimeout(timer));
    console.log("BROWSER-REPORT " + JSON.stringify(browserReport));
    console.log("SERVER-COUNTS " + JSON.stringify(counts));
    // 브라우저 보고 판정: 폭마다 확인 전 POST 증가 0, 승인 결과·초점, 철회 뒤 결과·목록·체크 정리, 넘침 0.
    type Step = { width: number; firstEntry: string; domLeaks: string[]; checkFocus: string; beforeRights: typeof counts; afterResult: typeof counts;
      afterRevoke: typeof counts; result: { focus: string; palette: boolean; draft: boolean; headings: string[] };
      revoked: Record<string, boolean>; revokedFocus: string; overflowX: number; layout: string };
    const steps = browserReport as Step[];
    assert.deepEqual(steps.map(({ width }) => width), [390, 1440]);
    let previousPosts = 0;
    for (const step of steps) {
      assert.equal(step.firstEntry, "BODY");
      assert.deepEqual(step.domLeaks, []);
      assert.equal(step.checkFocus, "INPUT:체크(끔)");
      assert.equal(step.beforeRights.posts, previousPosts, "POST before rights confirmation");
      assert.equal(step.afterResult.posts, previousPosts + 1);
      assert.equal(step.result.focus, "H3:분석 결과");
      assert.deepEqual(step.result.headings, ["관찰 근거", "분석 추정", "창작 초안"]);
      assert(step.result.palette && step.result.draft);
      assert.deepEqual(step.revoked, { select: false, textarea: false, check: false, palette: false });
      assert.match(step.revokedFocus, /^DIV:분석할 수 있는 등록 자료가 없어요/);
      assert.equal(step.afterRevoke.downloads, step.afterResult.downloads, "Revoked analysis must not download");
      assert.equal(step.overflowX, 0);
      previousPosts = step.afterRevoke.posts;
    }
    assert.deepEqual(steps.map(({ layout }) => layout), ["아래", "옆"]);
    // 폭 두 개(390·1440)마다: 승인 결과 1건(다운로드 1), 철회 뒤 다시 분석 1건은 자료 다운로드 전에 차단.
    assert.equal(counts.ready, 2);
    assert.equal(counts.sourceUnavailable, 2);
    assert.equal(counts.posts, 4);
    assert.equal(counts.downloads, 2);
    const ready = results.find((result) => (result as { status?: string })?.status === "ready");
    assert(JSON.stringify(ready).includes("#e02020"), "Expected the red registered PNG palette");
    assert(!JSON.stringify(results).includes(sha256(images.get(selectA.assetId)!)));
    assert.deepEqual(await readdir(workRoot), []);
    console.log("PG17 protected browser: initial HTML/prefetch clean, no POST before rights, approved PNG result, revocation cleared result and list");
  } finally {
    await connection.close();
    for (const server of [app, storageServer]) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
}
