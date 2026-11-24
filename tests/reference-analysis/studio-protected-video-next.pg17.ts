import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { isAbsolute, join, resolve } from "node:path";
import type { Client } from "pg";
import { mediaBinary } from "../../lib/media/tools";

/**
 * 실제 Next 보호 셸용 PG17 격리 공급원(c07ebbe MP4 시험 어댑터).
 * studio-analysis-authority-store.pg17.mjs가 STUDIO_ANALYSIS_VERIFY_NEXT=1일 때 소유 PG17을 띄우고 이 함수를 부른다.
 * 이 프로세스는 PG17·합성 비공개 저장소·제어 서버만 맡는다. 목록 GET·분석 POST는 격리 Next 빌드(저장소 밖 오버레이)가
 * STUDIO_ANALYSIS_NEXT_CONFIG 파일의 연결 설정으로 같은 PG17·저장소에 직접 붙어 처리하고, 계정은 각 요청의 실제 로그인 세션으로 판정한다.
 * 전역 계정 전환은 없다. 운영 설정·서비스 연결은 쓰지 않는다.
 */
type Selection = Readonly<{ projectId: string; assetId: string }>;
type Fixture = Readonly<{
  admin: Client; root: string; options: Record<string, unknown> & { bucket: string }; images: Map<string, Buffer>;
  ownerA: string; ownerB: string; selectA: Selection; selectB: Selection;
  ownerPermission: (client: Client, owner: string, allowed: boolean) => Promise<void>;
  scopePermission: (client: Client, owner: string, project: string, asset: string, allowed: boolean) => Promise<void>;
}>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

export async function serveVideoNextFixture({ admin, root, options, images, ownerA, ownerB, selectA, selectB,
  ownerPermission, scopePermission }: Fixture) {
  const configPath = process.env.STUDIO_ANALYSIS_NEXT_CONFIG ?? "";
  assert(isAbsolute(configPath) && !resolve(configPath).startsWith(resolve(".")), "STUDIO_ANALYSIS_NEXT_CONFIG must be an absolute path outside the repository");

  const workRoot = join(await realpath(root), "studio-analysis-files");
  await mkdir(workRoot);
  const bucket = options.bucket;
  const credential = "synthetic-t307-storage-key";
  const objects = new Map([[ownerA, selectA.assetId], [ownerB, selectB.assetId]].map(([owner, id]) => {
    const bytes = images.get(id)!;
    return [`/storage/v1/object/${bucket}/${owner}/assets/${id}/${sha256(bytes)}.mp4`, bytes];
  }));
  const counts = { downloads: 0, downloadsA: 0, downloadsB: 0 };
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

  // 두 계정 모두 자기 자료만 승인한다. 어느 계정으로 보이는지는 요청마다 실제 로그인 세션이 정한다.
  for (const [owner, selection] of [[ownerA, selectA], [ownerB, selectB]] as const) {
    await ownerPermission(admin, owner, true);
    await scopePermission(admin, owner, selection.projectId, selection.assetId, true);
  }
  const scope = { a: [ownerA, selectA], b: [ownerB, selectB] } as const;
  const done = Promise.withResolvers<unknown>();
  const control = createServer((request, response) => {
    const handle = async () => {
      const path = request.url ?? "/";
      const match = /^\/(revoke|restore)-(a|b)$/.exec(path);
      if (request.method === "GET" && path === "/state") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && match) {
        const [owner, selection] = scope[match[2] as "a" | "b"];
        await scopePermission(admin, owner, selection.projectId, selection.assetId, match[1] === "restore");
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(counts));
      } else if (request.method === "POST" && path === "/done") {
        response.writeHead(200).end("ok");
        done.resolve(JSON.parse((await readBody(request)) || "null"));
      } else response.writeHead(404).end();
    };
    void handle().catch(error => { console.error("control handler failed", String(error).slice(0, 200)); response.destroy(); });
  });
  control.listen(0, "127.0.0.1");
  await once(control, "listening");
  const controlAddress = control.address();
  assert(controlAddress && typeof controlAddress !== "string");

  const storage = { profile: "synthetic", projectUrl: `http://127.0.0.1:${storageAddress.port}`, projectRef: "abcdefghijklmnopqrst", bucket,
    privateBucket: true, credential: { mode: "service-role", key: credential }, maxBytes: 1_048_576, timeoutMs: 2750, maxConcurrent: 2,
    workRoot, ffprobePath: resolve(mediaBinary("ffprobe")) };
  await writeFile(configPath, JSON.stringify({ authority: options, storage }), { flag: "wx" });

  try {
    console.log(`NEXT-FIXTURE-READY control=http://127.0.0.1:${controlAddress.port} config=${configPath}`);
    let timer: NodeJS.Timeout | undefined;
    const report = await Promise.race([done.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser step timeout")), 1_200_000); })])
      .finally(() => clearTimeout(timer));
    console.log("NEXT-REPORT " + JSON.stringify(report));
    console.log("STORAGE-COUNTS " + JSON.stringify(counts));
    const verdict = (report as { verdict?: unknown } | null)?.verdict;
    assert.equal(verdict, "pass", "Browser round did not pass");
    assert.deepEqual(await readdir(workRoot), []);
    console.log("PG17 Next protected video: browser round passed against the real Next shell, storage downloads recorded per account");
  } finally {
    await rm(configPath, { force: true });
    for (const server of [control, storageServer]) {
      server.closeAllConnections();
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    }
  }
}
