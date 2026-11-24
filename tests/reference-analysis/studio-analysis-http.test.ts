import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/studio/reference-analysis/route";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { mediaToolsFolder, runMedia } from "../../lib/media/tools";
import { analyzeStudioReference } from "../../lib/reference-analysis/studio-analysis-contract";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/reference-analysis/studio-analysis-contract", { spy: true });

const origin = "http://127.0.0.1:39296";
const url = origin + "/api/studio/reference-analysis";
const selection = { projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012" };
const ownerId = "10000000-0000-4000-8000-000000000010";
const verified = { kind: "verified", userId: ownerId, email: "owner@example.invalid" } as const;
const json = JSON.stringify(selection);
const headers = { host: new URL(origin).host, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };

function request(body: BodyInit | null = json, init: RequestInit = {}) {
  return new Request(url, { method: "POST", body, headers, ...init, duplex: "half" } as RequestInit);
}

async function expectResponse(response: Response, status: number, body: object) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(body);
}

const result = (reason: string) => ({ schemaVersion: 1, status: "unavailable", reason });
type AnalysisResult = Awaited<ReturnType<typeof analyzeStudioReference>>;
const injected = () => {
  const resolveAuth = vi.fn<() => Promise<ServerAuthResult>>().mockResolvedValue(verified);
  const resolveRegisteredSource = vi.fn<NonNullable<NonNullable<Parameters<typeof createStudioAnalysisPost>[0]>["resolveRegisteredSource"]>>();
  return { resolveAuth, resolveRegisteredSource, post: createStudioAnalysisPost({ resolveAuth, resolveRegisteredSource }) };
};

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Studio reference analysis POST", () => {
  it.each(["whole analysis", "legacy resolver"] as const)("validates the public response from %s before serializing", async (branch) => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "private-result-diagnostic-T305";
    const location = { kind: "time", startMs: 125, endMs: 125 };
    const frame = { kind: "observation", measure: "decoded_frame", findingId: "frame-1", location };
    const proposal = { media: "video", selectionId: "result-1", observations: [frame],
      sourceSeek: { kind: "observed_pts", findingId: "frame-1", ptsMs: 125 },
      inference: { kind: "inference", measure: "candidate_cut", findingId: "cut-1", location, evidenceIds: ["frame-1"] },
      draft: { kind: "creative_proposal", target: "cut", prompt: "공개 초안" } };
    const ready = { schemaVersion: 1, status: "ready", media: "video", proposals: [proposal] };
    async function send(output: unknown) {
      // Inject a result that crosses the runtime boundary despite the compile-time producer type.
      const value = output as AnalysisResult;
      const resolveAuth = async () => verified;
      if (branch === "whole analysis") return createStudioAnalysisPost({ resolveAuth, analyzeRegisteredSource: async () => value })(request());
      vi.mocked(analyzeStudioReference).mockResolvedValueOnce(value);
      return createStudioAnalysisPost({ resolveAuth, resolveRegisteredSource: async () => undefined })(request());
    }

    await expectResponse(await send(ready), 200, ready);
    for (const reason of ["invalid_selection", "source_unavailable", "analysis_unavailable", "cancelled", "timed_out"]) {
      await expectResponse(await send(result(reason)), 200, result(reason));
    }
    for (const invalid of [null, { ...result("source_unavailable"), diagnostic: secret }, { ...ready, schemaVersion: 2 },
      { ...ready, proposals: [{ ...proposal, draft: { ...proposal.draft, internalPath: secret } }] },
      { ...ready, proposals: [{ ...proposal, observations: [{ ...frame, location: { ...location, rawPath: secret } }] }] },
      { ...ready, proposals: [{ ...proposal, sourceSeek: { ...proposal.sourceSeek, ptsMs: 126 } }] },
      { ...ready, proposals: [{ ...proposal, inference: { ...proposal.inference, evidenceIds: ["missing-frame"] } }] },
      { ...ready, proposals: [{ ...proposal, observations: [frame, frame] }] },
      { ...ready, proposals: [{ ...proposal, inference: { ...proposal.inference, evidenceIds: ["frame-1", "frame-1"] } }] },
      { ...ready, proposals: [{ ...proposal, inference: { ...proposal.inference, findingId: "frame-1" } }] },
      { ...result("source_unavailable"), toJSON: () => ({ diagnostic: secret }) },
    ]) {
      const response = await send(invalid);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const raw = await response.text();
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw)).toEqual(result("analysis_unavailable"));
    }
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  });

  it.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("passes native PNG, MP4 cut and audio tempo results through both HTTP paths", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const directory = await mkdtemp(join(tmpdir(), "dream-t305-f1-"));
    try {
      const managedRoot = await realpath(directory);
      const suffix = process.platform === "win32" ? ".exe" : "";
      const ffmpeg = join(mediaToolsFolder(), "ffmpeg" + suffix);
      vi.stubEnv("FFMPEG_PATH", ffmpeg);
      vi.stubEnv("FFPROBE_PATH", join(mediaToolsFolder(), "ffprobe" + suffix));
      const generate = (args: string[]) => runMedia(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", ...args],
        { timeout: 10_000, windowsHide: true });
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toFile(join(managedRoot, "private.png"));
      await generate(["-f", "lavfi", "-i", "color=c=red:s=32x24:r=10:d=1", "-f", "lavfi", "-i", "color=c=blue:s=32x24:r=10:d=1",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4", join(managedRoot, "private.mp4")]);
      await generate(["-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,0.5),0.08),0.7*sin(2*PI*440*t),0)':s=8000",
        "-t", "4", "-c:a", "alac", join(managedRoot, "private.m4a")]);
      for (const [name, mime, media, inference] of [
        ["private.png", "image/png", "image", undefined], ["private.mp4", "video/mp4", "video", "candidate_cut"],
        ["private.m4a", "audio/mp4", "music", "estimated_bpm"],
      ] as const) {
        const path = join(managedRoot, name);
        const bytes = await readFile(path);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const resolveRegisteredSource = async () => ({ status: "authorized", ownerId, ...selection, sha256, path, managedRoot, name, mime,
          sizeBytes: bytes.length, storeId: "fixture-store", restoreGeneration: "fixture-restore", linkGeneration: "1",
          sourceGeneration: "fixture-source", ownerPermissionGeneration: "1", scopePermissionGeneration: "1" });
        const resolveAuth = async () => verified;
        const legacy = createStudioAnalysisPost({ resolveAuth, resolveRegisteredSource });
        const full = createStudioAnalysisPost({ resolveAuth, analyzeRegisteredSource: (_actor, selected, signal) =>
          analyzeStudioReference(selected, { resolveAuth, resolveRegisteredSource, signal }) });
        const legacyResponse = await legacy(request());
        expect(legacyResponse.status).toBe(200);
        expect(legacyResponse.headers.get("cache-control")).toBe("no-store");
        const output = await legacyResponse.json();
        expect(output).toMatchObject({ schemaVersion: 1, status: "ready", media });
        if (inference) expect(output.proposals).toContainEqual(expect.objectContaining({ inference: expect.objectContaining({ measure: inference }) }));
        if (!inference) expect(output.proposals).toContainEqual(expect.objectContaining({ draft: expect.objectContaining({ target: "image" }) }));
        for (const privateValue of [path, name, sha256, ownerId, ...Object.values(selection)]) {
          expect(JSON.stringify(output)).not.toContain(privateValue);
        }
        await expectResponse(await full(request()), 200, output);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 25_000);

  it("closes ambiguous direct wiring and refuses invalid input before invoking a full operation", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const resolveAuth = async () => verified;
    const resolveRegisteredSource = vi.fn(async () => undefined);
    const analyzeRegisteredSource = vi.fn(async () => ({ schemaVersion: 1, status: "unavailable", reason: "source_unavailable" }) as const);
    const mixed = createStudioAnalysisPost({ resolveAuth, analyzeRegisteredSource, resolveRegisteredSource });
    await expectResponse(await mixed(request()), 503, result("analysis_unavailable"));
    const full = createStudioAnalysisPost({ resolveAuth, analyzeRegisteredSource });
    await expectResponse(await full(request(JSON.stringify({ ...selection, path: "private" }))), 200, result("invalid_selection"));
    await expectResponse(await full(request(json.padEnd(1025, " "))), 413, result("invalid_selection"));
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
    expect(analyzeRegisteredSource).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "deadline"] as const)("interrupts a full operation and discards its late result on %s", async mode => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const ready = Promise.withResolvers<AbortSignal>();
    const late = Promise.withResolvers<{ schemaVersion: 1; status: "unavailable"; reason: "source_unavailable" }>();
    const post = createStudioAnalysisPost({ resolveAuth: async () => verified,
      analyzeRegisteredSource(_actor, _selection, signal) { ready.resolve(signal); return late.promise; },
    });
    const controller = new AbortController();
    const response = post(request(json, { signal: controller.signal }));
    const signal = await ready.promise;
    if (mode === "disconnect") controller.abort();
    await expectResponse(await response, 200, result(mode === "disconnect" ? "cancelled" : "timed_out"));
    expect(signal.aborted).toBe(true);
    late.reject(new Error("private provider error after cancellation"));
  });

  it("leaves the real route closed in local mode and refuses verified requests without configured supply", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DREAM_AUTH_MODE", "off");
    const local = await POST(request());
    expect(local.status).toBe(401);
    expect(await local.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    const verifiedPost = createStudioAnalysisPost({ resolveAuth: async () => verified });
    await expectResponse(await verifiedPost(request(json.padEnd(1_024, " "))), 503, result("analysis_unavailable"));
  });

  it("checks same-origin and JSON content type after auth and before reading body or invoking the supplier", async () => {
    vi.stubEnv("DREAM_SITE_URL", `${origin},http://localhost:39296,https://127.0.0.1:39296`);
    const { post, resolveRegisteredSource, resolveAuth } = injected();
    const badHeaders = [
      { ...headers, origin: "" }, { ...headers, origin: "https://other.invalid" },
      { ...headers, origin: "http://localhost:39296" }, { ...headers, origin: "https://127.0.0.1:39296" },
      { ...headers, "sec-fetch-site": "same-site" },
    ];
    for (const candidate of badHeaders) {
      const input = request(json, { headers: candidate });
      const readBody = vi.spyOn(input, "body", "get");
      const response = await post(input);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ code: "AUTH_ORIGIN_REJECTED" });
      expect(readBody).not.toHaveBeenCalled();
    }
    const output = await post(request(json, { headers: { ...headers, "content-type": "text/plain" } }));
    expect(output.status).toBe(415);
    expect(output.headers.get("cache-control")).toBe("no-store");
    expect(resolveAuth).toHaveBeenCalledTimes(6);
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
  });

  it("enforces the byte limit for declared and chunked bodies and checks strict selection", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const { post, resolveRegisteredSource } = injected();
    for (const malformed of [null, "{", new Uint8Array([0xff]), "undefined"]) {
      await expectResponse(await post(request(malformed)), 400, result("invalid_selection"));
    }
    for (const invalid of [null, [selection], { ...selection, ownerId }, { ...selection, assetId: "foreign-path" }]) {
      await expectResponse(await post(request(JSON.stringify(invalid))), 200, result("invalid_selection"));
    }
    await expectResponse(await post(request(json, { headers: { ...headers, "content-length": "1025" } })), 413, result("invalid_selection"));
    const stopBody = vi.fn(() => new Promise<void>(() => {}));
    const oversizedBody = new ReadableStream({ start(stream) {
      stream.enqueue(new TextEncoder().encode("가".repeat(300)));
      stream.enqueue(new TextEncoder().encode("나".repeat(50)));
    }, cancel: stopBody });
    await expectResponse(await post(request(oversizedBody)), 413, result("invalid_selection"));
    expect(stopBody).toHaveBeenCalledOnce();
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
  });

  it("retains actual auth statuses and refuses local auth", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const { post, resolveRegisteredSource, resolveAuth } = injected();
    for (const [status, code] of [[401, "AUTH_REQUIRED"], [403, "AUTH_FORBIDDEN"], [503, "AUTH_UNAVAILABLE"]] as const) {
      resolveAuth.mockResolvedValueOnce({ kind: "denied", status, code });
      const input = request("untrusted input", { headers: {} });
      const readBody = vi.spyOn(input, "body", "get");
      const response = await post(input);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ code });
      expect(readBody).not.toHaveBeenCalled();
    }
    resolveAuth.mockResolvedValueOnce({ kind: "local" });
    const local = await post(request());
    expect(local.status).toBe(401);
    expect(await local.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
  });

  it("runs T284 on a current verified registration and fails closed after auth or authority changes", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const directory = await mkdtemp(join(tmpdir(), "dream-t296-"));
    try {
      const managedRoot = await realpath(directory);
      const name = "synthetic-only.png";
      const path = join(managedRoot, name);
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toBuffer();
      await writeFile(path, bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const source = { status: "authorized", ownerId, ...selection, sha256, path, managedRoot, name, mime: "image/png",
        sizeBytes: bytes.length, storeId: "fixture-store", restoreGeneration: "fixture-restore", linkGeneration: "1",
        sourceGeneration: "fixture-source", ownerPermissionGeneration: "1", scopePermissionGeneration: "1" };
      const { post, resolveRegisteredSource, resolveAuth } = injected();
      resolveRegisteredSource.mockResolvedValue(source);
      const response = await post(request());
      expect(response.headers.get("cache-control")).toBe("no-store");
      const output = await response.json();
      expect(output).toMatchObject({ schemaVersion: 1, status: "ready", media: "image" });
      expect(resolveAuth).toHaveBeenCalledTimes(2);
      expect(resolveRegisteredSource.mock.calls).toHaveLength(2);
      for (const [actor, selected, signal] of resolveRegisteredSource.mock.calls) {
        expect(actor.id).toBe(ownerId);
        expect(selected).toEqual(selection);
        expect(signal).toBeInstanceOf(AbortSignal);
      }
      for (const privateValue of [path, name, sha256, ownerId, ...Object.values(selection)]) expect(JSON.stringify(output)).not.toContain(privateValue);

      resolveAuth.mockResolvedValueOnce(verified).mockResolvedValueOnce({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
      await expectResponse(await post(request()), 200, { schemaVersion: 1, status: "unavailable", reason: "source_unavailable" });
      resolveRegisteredSource.mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, scopePermissionGeneration: "2" });
      await expectResponse(await post(request()), 200, { schemaVersion: 1, status: "unavailable", reason: "source_unavailable" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("abandons stalled request bodies on disconnect without waiting for cancellation", async () => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const { post, resolveRegisteredSource, resolveAuth } = injected();
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const read = Promise.withResolvers<void>();
    const body = new ReadableStream({ pull: () => { read.resolve(); }, cancel }, { highWaterMark: 0 });
    const response = post(request(body, { signal: controller.signal }));
    await read.promise;
    controller.abort();
    await expectResponse(await response, 200, result("cancelled"));
    expect(cancel).toHaveBeenCalledOnce();
    expect(resolveAuth).toHaveBeenCalledOnce();
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "deadline"] as const)("signals an unfinished supplier and bounds the response on %s", async (mode) => {
    vi.stubEnv("DREAM_SITE_URL", origin);
    const { post, resolveRegisteredSource } = injected();
    const supplied = Promise.withResolvers<AbortSignal>();
    const held = Promise.withResolvers<unknown>();
    resolveRegisteredSource.mockImplementation(async (_actor, _selection, signal) => { supplied.resolve(signal); return held.promise; });
    const controller = new AbortController();
    const response = post(request(json, { signal: controller.signal }));
    const signal = await supplied.promise;
    if (mode === "disconnect") controller.abort();
    await expectResponse(await response, 200, result(mode === "disconnect" ? "cancelled" : "timed_out"));
    expect(signal.aborted).toBe(true);
    held.reject(new Error("late isolated authority failure"));
    expect(resolveRegisteredSource).toHaveBeenCalledOnce();
  }, 5_000);
});
