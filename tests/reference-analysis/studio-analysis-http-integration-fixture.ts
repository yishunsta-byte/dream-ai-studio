import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { mediaToolsFolder } from "../../lib/media/tools";
import { createIsolatedStudioAnalysis } from "../../lib/reference-analysis/studio-analysis-source";
import { privateObjectKey } from "../../lib/storage/supabase/object-key";

export const analysisPath = "/fixture/studio-analysis";
export const selection = { projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012" };
export const ownerId = "10000000-0000-4000-8000-000000000010";
export const credential = "t294-synthetic-reader";
const owner: ServerAuthResult = { kind: "verified", userId: ownerId, email: "owner@example.invalid" };
const other: ServerAuthResult = { ...owner, userId: "20000000-0000-4000-8000-000000000010" };
const bucket = "t294-isolated";
type Mode = "owner" | "other" | "denied" | "stall-after-staging";
type Result = Awaited<ReturnType<ReturnType<typeof createIsolatedStudioAnalysis>>>;
type Call = {
  mode: Mode;
  input: unknown;
  authCalls: number;
  signal: AbortSignal;
  stalled?: ReturnType<typeof Promise.withResolvers<ServerAuthResult>>;
  result?: Result;
};

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(value));
}

async function readSelection(request: IncomingMessage): Promise<unknown> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024) throw new Error("Fixture request too large");
  }
  return JSON.parse(body);
}

export async function startStudioAnalysisHttpFixture({ serverTimeoutMs = 8_000, bundle }: { serverTimeoutMs?: number; bundle?: { js: string; css: string } } = {}) {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const temp = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temp, "dream-t294-")));
  if (dirname(root) !== temp || !basename(root).startsWith("dream-t294-")) throw new Error("Fixture cleanup boundary rejected");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const baseAsset = { id: selection.assetId, ownerId, sha256, sizeBytes: bytes.length, mime: "image/png", kind: "image" } as const;
  const asset = { ...baseAsset, objectKey: privateObjectKey(baseAsset) };
  const registration = {
    status: "authorized", ownerId, ...selection, asset, linkActive: true, ownerEnabled: true, scopeEnabled: true,
    storeId: "fixture-store", restoreGeneration: "fixture-restore", linkGeneration: "1", ownerPermissionGeneration: "1",
    scopePermissionGeneration: "1", sourceGeneration: "fixture-source", storageGeneration: "1", verifiedStorageGeneration: "1",
  };
  const objectPath = `/storage/v1/object/${bucket}/${asset.objectKey}`;
  const requests: Call[] = [];
  const storageReads: string[] = [];
  const activeHandlers = new Set<Promise<void>>();
  const contexts = new AsyncLocalStorage<Call>();
  let nextMode: Mode = "owner";
  let runner: ReturnType<typeof createIsolatedStudioAnalysis>;

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/storage/v1/")) {
      if (request.headers.authorization !== `Bearer ${credential}` || request.headers.apikey !== credential) {
        response.writeHead(403).end();
        return;
      }
      storageReads.push(request.url);
      if (request.url === `/storage/v1/bucket/${bucket}`) json(response, 200, { id: bucket, name: bucket, public: false });
      else if (request.url === objectPath) response.writeHead(200, { "Content-Length": bytes.length }).end(bytes);
      else response.writeHead(404).end();
    } else if (request.method === "GET" && request.url === "/" && bundle) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
        `<!doctype html><html lang="ko" style="--font-pretendard:system-ui"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css">
        <main class="content"><div id="root" data-uri="${analysisPath}" data-project-id="${selection.projectId}" data-asset-id="${selection.assetId}"></div></main><script src="/fixture.js" defer></script></html>`,
      );
    } else if (request.method === "GET" && request.url === "/fixture.js" && bundle) {
      response.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle.js);
    } else if (request.method === "GET" && request.url === "/fixture.css" && bundle) {
      response.writeHead(200, { "Content-Type": "text/css" }).end(bundle.css);
    } else if (request.method === "POST" && request.url === analysisPath) {
      const handler = handleAnalysis(request, response);
      activeHandlers.add(handler);
      void handler.then(() => activeHandlers.delete(handler));
    } else response.writeHead(404).end();
  });

  async function close() {
    if (server.listening) {
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await stopped;
    }
    for (const call of requests) call.stalled?.resolve(owner);
    await Promise.all(activeHandlers);
    await rm(root, { recursive: true, force: true });
  }

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const run = createIsolatedStudioAnalysis({
      storage: { profile: "synthetic", projectUrl: origin, projectRef: "abcdefghijklmnopqrst", bucket, privateBucket: true,
        credential: { mode: "service-role", key: credential }, maxBytes: 1_048_576, timeoutMs: serverTimeoutMs, maxConcurrent: 1,
        workRoot: root, ffprobePath: join(mediaToolsFolder(), process.platform === "win32" ? "ffprobe.exe" : "ffprobe"),
      },
      async resolveAuth() {
        const call = contexts.getStore();
        if (!call) throw new Error("Missing isolated HTTP request context");
        call.authCalls++;
        if (call.mode === "denied") return { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
        if (call.mode === "other") return other;
        if (call.mode !== "stall-after-staging" || call.authCalls !== 2) return owner;
        call.stalled = Promise.withResolvers<ServerAuthResult>();
        return call.stalled.promise;
      },
      async readAuthority(actor, chosen) {
        if (actor.id === ownerId && chosen.projectId === selection.projectId && chosen.assetId === selection.assetId) return registration;
      },
      async openBytes(_actor, currentAsset, signal) {
        if (currentAsset.objectKey !== asset.objectKey) throw new Error("Unknown synthetic asset");
        const response = await fetch(origin + objectPath, {
          signal, headers: { authorization: `Bearer ${credential}`, apikey: credential },
        });
        if (!response.ok || !response.body) throw new Error("Synthetic receiver unavailable");
        return response.body;
      },
    });

    runner = run;
    return { origin, root, requests, storageReads, sha256, objectPath, setNextMode: (mode: Mode) => { nextMode = mode; }, close };
  } catch (error) {
    await close();
    throw error;
  }

  async function handleAnalysis(request: IncomingMessage, response: ServerResponse) {
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", disconnect);
    response.once("close", disconnect);
    const mode = nextMode;
    nextMode = "owner";
    try {
      const input = await readSelection(request);
      const call: Call = { mode, input, authCalls: 0, signal: controller.signal };
      requests.push(call);
      call.result = await contexts.run(call, () => runner(input, controller.signal));
      if (!controller.signal.aborted && !response.destroyed) json(response, 200, call.result);
    } catch {
      if (!controller.signal.aborted && !response.destroyed) json(response, 400, { status: "bad_request" });
    } finally {
      request.off("aborted", disconnect);
      response.off("close", disconnect);
    }
  }
}
