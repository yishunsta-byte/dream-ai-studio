import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { mediaToolsFolder, runMedia } from "../../lib/media/tools";
import * as snapshot from "../../lib/reference-analysis/registered-snapshot";
import { analyzeStudioReference } from "../../lib/reference-analysis/studio-analysis-contract";

vi.mock("server-only", () => ({}));

const selection = { projectId: "10000000-0000-4000-8000-000000000010", assetId: "10000000-0000-7000-8000-000000000011" };
const ownerId = "10000000-0000-4000-8000-000000000012";
const otherId = "10000000-0000-4000-8000-000000000013";
const auth: ServerAuthResult = { kind: "verified", userId: ownerId, email: "owner@example.invalid" };
const source = {
  status: "authorized", ownerId, ...selection,
  storeId: "private-store", restoreGeneration: "restore-1", linkGeneration: "link-1", sourceGeneration: "source-1",
  ownerPermissionGeneration: "owner-1", scopePermissionGeneration: "scope-1", sha256: "a".repeat(64),
  path: "private-path", managedRoot: "private-root", name: "private-filename.png", mime: "image/png", sizeBytes: 123,
};
const failure = (reason = "source_unavailable") => ({ schemaVersion: 1, status: "unavailable", reason });
const authFor = () => vi.fn<() => Promise<ServerAuthResult>>().mockResolvedValue(auth);
const bound = {
  status: "bound", proof: { snapshotSha256: source.sha256, sourceGeneration: source.sourceGeneration },
  analysis: { media: "image", image: { status: "not_analyzed" }, inspection: {
    schemaVersion: 1, input: { status: "invalid", reason: "invalid_input" }, findings: [],
  } },
} satisfies Awaited<ReturnType<typeof snapshot.analyzeRegisteredReferenceSnapshot>>;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Studio registered reference analysis contract", () => {
  it("accepts only project and asset IDs and blocks denied and local auth before source lookup", async () => {
    const resolveAuth = authFor();
    const resolveRegisteredSource = vi.fn();
    const options = { resolveAuth, resolveRegisteredSource };
    expect(await analyzeStudioReference({ ...selection, ownerId, path: source.path }, options)).toEqual(failure("invalid_selection"));
    expect(resolveAuth).not.toHaveBeenCalled();

    resolveAuth.mockResolvedValueOnce({ kind: "denied", status: 401, code: "AUTH_REQUIRED" })
      .mockResolvedValueOnce({ kind: "local" }).mockRejectedValueOnce(new Error("private auth details"));
    for (let call = 0; call < 3; call++) expect(await analyzeStudioReference(selection, options)).toEqual(failure());
    expect(resolveRegisteredSource).not.toHaveBeenCalled();
  });

  it.each([
    undefined, { status: "observed", analysisAuthority: "unavailable", registration: { storageGeneration: 1 } },
    { ...source, ownerId: otherId }, { ...source, projectId: otherId }, { ...source, assetId: otherId },
    { ...source, scopePermissionGeneration: undefined }, { ...source, sha256: undefined },
    { ...source, name: "private-filename.mp4" },
  ])("blocks unproved and inconsistent source observations before decoding (case %#)", async (observation) => {
    const analyze = vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot");
    const resolveRegisteredSource = vi.fn().mockResolvedValue(observation);
    expect(await analyzeStudioReference(selection, { resolveAuth: authFor(), resolveRegisteredSource })).toEqual(failure());
    expect(resolveRegisteredSource).toHaveBeenCalledWith(expect.objectContaining({ id: ownerId }), selection, undefined);
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([
    undefined, { ...source, linkGeneration: "link-2" }, { ...source, ownerPermissionGeneration: "owner-2" },
    { ...source, scopePermissionGeneration: "scope-2" }, { ...source, restoreGeneration: "restore-2" },
    { ...source, sourceGeneration: "source-2" }, { ...source, sha256: "b".repeat(64) },
  ])("rejects withdrawal and changes detected after decoding (case %#)", async (current) => {
    vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot").mockResolvedValue(bound);
    const resolveAuth = authFor();
    const resolveRegisteredSource = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(current);
    expect(await analyzeStudioReference(selection, { resolveAuth, resolveRegisteredSource })).toEqual(failure());
    expect(resolveRegisteredSource).toHaveBeenCalledTimes(2);
    expect(resolveAuth).toHaveBeenCalledTimes(2);
  });

  it("discards a completed snapshot when the active account changes", async () => {
    vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot").mockResolvedValue(bound);
    const resolveAuth = authFor().mockResolvedValueOnce(auth).mockResolvedValueOnce({ ...auth, userId: otherId });
    const resolveRegisteredSource = vi.fn().mockResolvedValue(source);
    expect(await analyzeStudioReference(selection, { resolveAuth, resolveRegisteredSource })).toEqual(failure());
    expect(resolveRegisteredSource).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched decoder proof and returns bounded failure reasons", async () => {
    const analyze = vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot")
      .mockResolvedValueOnce({ ...bound, proof: { ...bound.proof, snapshotSha256: "b".repeat(64) } })
      .mockResolvedValueOnce({ ...bound, proof: { ...bound.proof, sourceGeneration: "source-2" } })
      .mockResolvedValueOnce({ status: "unavailable", reason: "unverified_analysis" })
      .mockResolvedValueOnce({ status: "unavailable", reason: "timed_out" })
      .mockRejectedValueOnce(new Error("private decoder details"));
    const options = { resolveAuth: authFor(), resolveRegisteredSource: vi.fn().mockResolvedValue(source) };
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await analyzeStudioReference(selection, options)).toEqual(failure("analysis_unavailable"));
    }
    expect(await analyzeStudioReference(selection, options)).toEqual(failure("timed_out"));
    expect(await analyzeStudioReference(selection, options)).toEqual(failure("analysis_unavailable"));
    expect(options.resolveRegisteredSource).toHaveBeenCalledTimes(5);
    expect(analyze).toHaveBeenCalledTimes(5);
  });

  it("does not release a result when the request is cancelled during decoding", async () => {
    const controller = new AbortController();
    const resolveRegisteredSource = vi.fn().mockResolvedValue(source);
    vi.spyOn(snapshot, "analyzeRegisteredReferenceSnapshot").mockImplementation(async () => {
      controller.abort();
      return bound;
    });
    const options = { resolveAuth: authFor(), resolveRegisteredSource, signal: controller.signal };
    expect(await analyzeStudioReference(selection, options)).toEqual(failure("cancelled"));
    expect(await analyzeStudioReference(selection, options)).toEqual(failure("cancelled"));
    expect(resolveRegisteredSource).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("projects verified image, audio and video bytes into safe proposals", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "dream-rea-studio-")));
    if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith("dream-rea-studio-")) {
      throw new Error("Synthetic cleanup boundary rejected");
    }
    try {
      const suffix = process.platform === "win32" ? ".exe" : "";
      const ffmpeg = join(mediaToolsFolder(), "ffmpeg" + suffix);
      vi.stubEnv("FFMPEG_PATH", ffmpeg);
      vi.stubEnv("FFPROBE_PATH", join(mediaToolsFolder(), "ffprobe" + suffix));
      const generate = (args: string[]) => runMedia(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", ...args],
        { timeout: 10_000, windowsHide: true });
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toFile(join(root, "private.png"));
      await generate(["-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "1", "-c:a", "alac", join(root, "private.m4a")]);
      await generate(["-f", "lavfi", "-i", "color=c=red:s=32x24:r=10:d=1", "-c:v", "mpeg4", join(root, "private.mp4")]);
      for (const [name, mime, media, target] of [
        ["private.png", "image/png", "image", "image"], ["private.m4a", "audio/mp4", "music", "music"],
        ["private.mp4", "video/mp4", "video", "cut"],
      ]) {
        const path = join(root, name);
        const bytes = await readFile(path);
        const registration = { ...source, path, managedRoot: root, name, mime, sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex") };
        const resolveRegisteredSource = vi.fn().mockResolvedValue(registration);
        const resolved = await analyzeStudioReference(selection, { resolveAuth: authFor(), resolveRegisteredSource });
        expect(resolved).toMatchObject({ status: "ready", media, proposals: expect.arrayContaining([expect.objectContaining({
          observations: expect.arrayContaining([expect.objectContaining({ kind: "observation" })]),
          draft: expect.objectContaining({ kind: "creative_proposal", target, prompt: expect.any(String) }),
        })]) });
        const json = JSON.stringify(resolved);
        for (const privateValue of [ownerId, selection.projectId, selection.assetId, registration.sha256, name, root, source.sourceGeneration, "pixels"]) {
          expect(json).not.toContain(privateValue);
        }
        expect(resolveRegisteredSource).toHaveBeenCalledTimes(2);
        const bad = vi.fn().mockResolvedValue({ ...registration, sha256: "a".repeat(64) });
        expect(await analyzeStudioReference(selection, { resolveAuth: authFor(), resolveRegisteredSource: bad })).toEqual(failure("analysis_unavailable"));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 25_000);
});
