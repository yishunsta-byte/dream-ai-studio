import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioRegisteredAnalysisProvider } from "../../components/reference-analysis/studio-registered-analysis-provider";
import { analyzeStudioReference } from "../../lib/reference-analysis/studio-analysis-contract";
import { analyzeRegisteredReferenceSnapshot } from "../../lib/reference-analysis/registered-snapshot";
import { syntheticAnalyses } from "./studio-project-preview-fixture";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/reference-analysis/registered-snapshot", { spy: true });

const selection = { projectId: "10000000-0000-4000-8000-000000000010", assetId: "10000000-0000-7000-8000-000000000011" };
const materials = [{ ...selection, label: "등록 자료" }];
const ownerId = "10000000-0000-4000-8000-000000000012";
const uri = "/test-only/registered-analysis";
const failure = { schemaVersion: 1, status: "unavailable", reason: "analysis_unavailable" };
const timeout = { ...failure, reason: "timed_out" };
const cancelled = { ...failure, reason: "cancelled" };

type Transport = Parameters<typeof createStudioRegisteredAnalysisProvider>[0]["transport"];
type TransportResponse = Awaited<ReturnType<Transport>>;

function providerFor(transport: Transport, timeoutMs = 1_000) {
  return createStudioRegisteredAnalysisProvider({ materials, uri, transport, timeoutMs });
}

function bodyResponse(body: unknown) {
  return { ok: true, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function projectedResult(media: "image" | "video" | "music") {
  const sha256 = "a".repeat(64);
  const sourceGeneration = "source-1";
  vi.mocked(analyzeRegisteredReferenceSnapshot).mockResolvedValueOnce({
    status: "bound", proof: { snapshotSha256: sha256, sourceGeneration }, analysis: syntheticAnalyses()[media],
  });
  const formats = { image: ["png", "image/png"], video: ["mp4", "video/mp4"], music: ["wav", "audio/wav"] };
  const [ext, mime] = formats[media];
  const result = await analyzeStudioReference(selection, {
    resolveAuth: async () => ({ kind: "verified", userId: ownerId, email: "owner@example.invalid" }),
    resolveRegisteredSource: async () => ({
      status: "authorized", ownerId, ...selection, sha256, sourceGeneration, name: `sample.${ext}`, mime,
      path: "synthetic-path", managedRoot: "synthetic-root", sizeBytes: 1, storeId: "store-1", restoreGeneration: "restore-1",
      linkGeneration: "link-1", ownerPermissionGeneration: "owner-1", scopePermissionGeneration: "scope-1",
    }),
  });
  if (result.status !== "ready") throw new Error(`Synthetic T284 result unavailable: ${result.reason}`);
  return result;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Studio registered analysis HTTP provider", () => {
  it.each(["image", "video", "music"] as const)("decodes T284 synthetic %s DTO through JSON", async (media) => {
    const result = await projectedResult(media);
    const transport = vi.fn<Transport>().mockImplementation(async () => Response.json(result));
    const provider = providerFor(transport);
    const caller = new AbortController();
    const selectionWithExtra = { ...selection, privatePath: "never-send" };
    expect(provider.materials).toBe(materials);
    expect(await provider.analyze(selectionWithExtra, caller.signal)).toEqual(result);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(uri, {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(selection), signal: expect.any(AbortSignal), cache: "no-store", credentials: "same-origin", redirect: "error",
    });
    expect(transport.mock.calls[0][1].signal).not.toBe(caller.signal);
  });

  it.each(["invalid_selection", "source_unavailable", "analysis_unavailable", "timed_out", "cancelled"])("preserves verified server status %s", async (reason) => {
    const result = { ...failure, reason };
    const provider = providerFor(async () => Response.json(result));
    expect(await provider.analyze(selection, new AbortController().signal)).toEqual(result);
  });

  it("skips HTTP for pre-cancelled input and releases stalled transport on user cancel", async () => {
    vi.useFakeTimers();
    const late = deferred<TransportResponse>();
    const transport = vi.fn<Transport>().mockReturnValueOnce(late.promise).mockResolvedValueOnce(bodyResponse(cancelled));
    const provider = providerFor(transport);
    const closed = new AbortController();
    closed.abort();
    expect(await provider.analyze(selection, closed.signal)).toEqual(failure);
    expect(transport).not.toHaveBeenCalled();

    const caller = new AbortController();
    const request = provider.analyze(selection, caller.signal);
    caller.abort();
    expect(await request).toEqual(failure);
    const originalSignal = transport.mock.calls[0][1].signal;
    expect(originalSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const response = bodyResponse(cancelled);
    late.resolve(response);
    await Promise.resolve();
    expect(response.json).not.toHaveBeenCalled();
    expect(await provider.analyze(selection, new AbortController().signal)).toEqual(cancelled);
    expect(transport.mock.calls[1][1].signal).not.toBe(originalSignal);
    expect(transport.mock.calls[1][1].signal?.aborted).toBe(false);
  });

  it("bounds time spent waiting for headers and supports same-material retry before old response arrives", async () => {
    vi.useFakeTimers();
    const late = deferred<TransportResponse>();
    const transport = vi.fn<Transport>().mockReturnValueOnce(late.promise).mockResolvedValueOnce(bodyResponse({ ...failure, reason: "source_unavailable" }));
    const provider = providerFor(transport, 400);
    const first = provider.analyze(selection, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(400);
    expect(await first).toEqual(timeout);
    expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(await provider.analyze(selection, new AbortController().signal)).toEqual({ ...failure, reason: "source_unavailable" });
    late.reject(new Error("late transport failure"));
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["timeout", "caller cancel"])("ends a stuck response body on %s and ignores late server acknowledgement", async (stop) => {
    vi.useFakeTimers();
    const late = deferred<unknown>();
    const response = { ok: true, json: vi.fn(() => late.promise) };
    const transport = vi.fn<Transport>().mockResolvedValue(response);
    const caller = new AbortController();
    const first = providerFor(transport, 150).analyze(selection, caller.signal);
    await Promise.resolve();
    expect(response.json).toHaveBeenCalledTimes(1);
    if (stop === "timeout") await vi.advanceTimersByTimeAsync(150);
    else caller.abort();
    expect(await first).toEqual(stop === "timeout" ? timeout : failure);
    expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
    late.resolve(cancelled);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces elapsed time even when a body finishes before the timer callback runs", async () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, "now").mockReturnValue(20);
    const json = vi.fn(async () => { now.mockReturnValue(151); return cancelled; });
    const transport = vi.fn<Transport>().mockResolvedValue({ ok: true, json });
    expect(await providerFor(transport, 130).analyze(selection, new AbortController().signal)).toEqual(timeout);
    expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up its deadline and caller listener on normal completion", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<Transport>().mockResolvedValue(bodyResponse(cancelled));
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    expect(await providerFor(transport, 700).analyze(selection, caller.signal)).toEqual(cancelled);
    caller.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.mock.calls[0][1].signal?.aborted).toBe(false);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes the socket for an unfinished 503 body and retries the same material", async () => {
    let closed = false;
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      let body = "";
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        bodies.push(body);
        if (bodies.length === 1) {
          request.socket.once("close", () => { closed = true; });
          response.writeHead(503, { "Content-Type": "application/json" });
          response.write("{");
        } else {
          const result = { ...failure, reason: "source_unavailable" };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(result));
        }
      });
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected loopback TCP address");
      const transport = vi.fn<Transport>(fetch);
      const provider = createStudioRegisteredAnalysisProvider({ materials, uri: `http://127.0.0.1:${address.port}${uri}`, transport, timeoutMs: 3_000 });
      expect(await provider.analyze(selection, new AbortController().signal)).toEqual(failure);
      expect(await provider.analyze(selection, new AbortController().signal)).toEqual({ ...failure, reason: "source_unavailable" });
      expect(bodies).toEqual([JSON.stringify(selection), JSON.stringify(selection)]);
      await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1_500 });
      expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
    } finally {
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await stopped;
    }
  });

  it("does not read or wait for cancellation of an unfinished HTTP error body", async () => {
    vi.useFakeTimers();
    const cleanup = deferred<void>();
    const body = { cancel: vi.fn(() => cleanup.promise) };
    const error = { ok: false, json: vi.fn(), body };
    const transport = vi.fn<Transport>().mockResolvedValueOnce(error).mockResolvedValueOnce(bodyResponse(cancelled));
    const provider = providerFor(transport);
    await expect(provider.analyze(selection, new AbortController().signal)).resolves.toEqual(failure);
    expect(error.json).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(await provider.analyze(selection, new AbortController().signal)).toEqual(cancelled);
    cleanup.reject(new Error("private asynchronous cleanup error"));
  });

  it("cleans up an unread response arriving after cancellation even if body cancellation throws", async () => {
    const late = deferred<TransportResponse>();
    const body = { cancel: vi.fn(() => { throw new Error("private synchronous cleanup error"); }) };
    const response = { ...bodyResponse(cancelled), body };
    const transport = vi.fn<Transport>().mockReturnValueOnce(late.promise);
    const caller = new AbortController();
    const attempt = providerFor(transport).analyze(selection, caller.signal);
    caller.abort();
    expect(await attempt).toEqual(failure);
    late.resolve(response);
    await Promise.resolve();
    expect(response.json).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledOnce();
  });

  it("bounds transport, HTTP, body reading and nested validation errors to a generic failure", async () => {
    const video = await projectedResult("video");
    const cut = video.proposals.find((proposal) => proposal.inference);
    if (!cut?.inference) throw new Error("Expected cut inference");
    const httpError = { ok: false, json: vi.fn().mockResolvedValue(cancelled) };
    const transport = vi.fn<Transport>()
      .mockRejectedValueOnce(new Error("private connection error"))
      .mockResolvedValueOnce(httpError)
      .mockResolvedValueOnce(new Response("bad-json"))
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockRejectedValue(new Error("private body error")) });
    const invalidBodies = [null, { ...cancelled, schemaVersion: 2 }, { ...cancelled, reason: "private-error" }, { ...cancelled, file: "private" },
      { ...video, media: "image" }, { ...video, proposals: [] }, { ...video, proposals: [cut, cut] },
      { ...video, proposals: [{ ...cut, observations: [{}] }] },
      { ...video, proposals: [{ ...cut, draft: { ...cut.draft, originalPath: "private" } }] },
      { ...video, proposals: [{ ...cut, inference: { ...cut.inference, evidenceIds: ["unknown-observation"] } }] },
    ];
    for (const body of invalidBodies) transport.mockResolvedValueOnce(bodyResponse(body));
    const provider = providerFor(transport);
    for (let attempt = 0; attempt < 4 + invalidBodies.length; attempt++) {
      expect(await provider.analyze(selection, new AbortController().signal)).toEqual(failure);
    }
    expect(httpError.json).not.toHaveBeenCalled();
  });

  it("reports only 401/403 denials once, keeps the generic result, and stays silent for others and after cancellation", async () => {
    const denials: number[] = [];
    const make = (status: number | undefined, ok = false) => createStudioRegisteredAnalysisProvider({ materials, uri, timeoutMs: 1_000,
      onDenied: (value) => { denials.push(value); }, transport: vi.fn<Transport>().mockResolvedValue({ ok, status, json: vi.fn() }) });
    for (const status of [401, 403]) expect(await make(status).analyze(selection, new AbortController().signal)).toEqual(failure);
    for (const status of [400, 404, 500, 503, undefined]) expect(await make(status).analyze(selection, new AbortController().signal)).toEqual(failure);
    expect(denials).toEqual([401, 403]);

    // 사용자가 취소한 뒤 도착한 401은 알리지 않는다.
    const late = deferred<TransportResponse>();
    const provider = createStudioRegisteredAnalysisProvider({ materials, uri, timeoutMs: 1_000, onDenied: (value) => { denials.push(value); },
      transport: () => late.promise });
    const caller = new AbortController();
    const pending = provider.analyze(selection, caller.signal);
    caller.abort();
    late.resolve({ ok: false, status: 401, json: vi.fn() });
    expect((await pending).status).toBe("unavailable");
    await Promise.resolve();
    expect(denials).toEqual([401, 403]);

    // onDenied가 없는 기존 호출자는 401도 이전과 같은 일반 실패다.
    expect(await providerFor(vi.fn<Transport>().mockResolvedValue({ ok: false, status: 401, json: vi.fn() })).analyze(selection, new AbortController().signal)).toEqual(failure);
  });
});
