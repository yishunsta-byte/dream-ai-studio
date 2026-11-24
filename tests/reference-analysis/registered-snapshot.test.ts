import { createHash } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { access, link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import * as tools from "../../lib/media/tools";
import { referenceFileByteLimit } from "../../lib/reference-analysis/input";
import { createPrivateReferenceResult, projectReferenceOwnerScreen, projectReferenceShareSummary } from "../../lib/reference-analysis/projection";
import { analyzeRegisteredReferenceSnapshot } from "../../lib/reference-analysis/registered-snapshot";

vi.mock("server-only", () => ({}));

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const proofGeneration = "server-source-generation";
const unavailable = { status: "unavailable", reason: "unverified_analysis" };
const owner = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000050");

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("registered REA snapshots on local synthetic files", () => {
  let root: string;
  let ffprobe: string;
  let videoBytes: Buffer;
  let pngSha: string;
  let audioSha: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "dream-rea-bind-")));
    const suffix = process.platform === "win32" ? ".exe" : "";
    const ffmpeg = join(tools.mediaToolsFolder(), "ffmpeg" + suffix);
    ffprobe = join(tools.mediaToolsFolder(), "ffprobe" + suffix);
    await Promise.all([access(ffmpeg), access(ffprobe)]);
    vi.stubEnv("FFMPEG_PATH", ffmpeg);
    vi.stubEnv("FFPROBE_PATH", ffprobe);
    const generate = (args: string[]) => tools.runMedia(ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], { timeout: 15_000, windowsHide: true });

    const under = join(root, "original");
    await mkdir(under);
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toFile(join(under, "secret.png"));
    await generate(["-f", "lavfi", "-i", "color=c=red:s=32x24:r=10:d=0.5", "-c:v", "mpeg4", join(root, "sample.mp4")]);
    await generate(["-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "1", "-c:a", "alac", join(root, "silent.m4a")]);
    videoBytes = await readFile(join(root, "sample.mp4"));
    pngSha = digest(await readFile(join(under, "secret.png")));
    audioSha = digest(await readFile(join(root, "silent.m4a")));
    const different = Buffer.from(videoBytes);
    different[different.length - 1] ^= 1;
    await Promise.all([
      writeFile(join(root, "mismatch.mp4"), different),
      writeFile(join(root, "replace.mp4"), videoBytes),
      writeFile(join(root, "replacement.mp4"), videoBytes),
      writeFile(join(root, "oversize.mp4"), ""),
      writeFile(join(root, "hard-original.mp4"), videoBytes),
    ]);
    await truncate(join(root, "oversize.mp4"), referenceFileByteLimit + 1);
    await link(join(root, "hard-original.mp4"), join(root, "hard-alias.mp4"));
    await symlink(under, join(root, "directory-alias"), process.platform === "win32" ? "junction" : "dir");
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!root) return;
    const actual = await realpath(root);
    if (dirname(actual) !== await realpath(tmpdir()) || !basename(actual).startsWith("dream-rea-bind-")) {
      throw new Error("Synthetic cleanup boundary rejected");
    }
    await rm(actual, { recursive: true, force: true });
  });

  function analyze(name: string, sizeBytes: number, sha256: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    return analyzeRegisteredReferenceSnapshot(join(root, name), {
      kind: "file", name: basename(name), sizeBytes, permission: "synthetic",
    }, { sha256, sourceGeneration: proofGeneration }, { managedRoot: root, ...options });
  }

  it("validates the bytes in the exact decoder snapshot and keeps internal proof out of sharing", async () => {
    let copy: string | undefined;
    const actual = tools.runMedia;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (args[0] === ffprobe) copy = args[1]?.at(-1);
      else if (copy && args[0] === process.env.FFMPEG_PATH) {
        expect(args[1]?.[args[1].indexOf("-i") + 1]).toBe(copy);
        expect(digest(readFileSync(copy))).toBe(digest(videoBytes));
      }
      return actual(...args);
    });
    try {
      const result = await analyze("sample.mp4", videoBytes.length, digest(videoBytes));
      expect(result).toMatchObject({
        status: "bound", proof: { snapshotSha256: digest(videoBytes), sourceGeneration: proofGeneration },
        analysis: { media: "video", video: { status: "completed", coverage: { framesRead: 5 } } },
      });
      if (result.status !== "bound" || !copy) throw new Error("Missing registered analysis");
      expect(copy).not.toBe(join(root, "sample.mp4"));
      await expect(access(dirname(copy))).rejects.toMatchObject({ code: "ENOENT" });

      const privateResult = createPrivateReferenceResult(owner, result.analysis.inspection);
      for (const dto of [projectReferenceOwnerScreen(privateResult, owner),
        projectReferenceShareSummary(privateResult, owner, ["file-metadata", "video-frame-1"])]) {
        expect(JSON.stringify(dto)).not.toMatch(/sha256|server-source-generation|sample.mp4|dream-rea-inspect|pixels|imageBytes/);
      }
    } finally { spy.mockRestore(); }
  });

  it("binds the same registered stream for audio and image analysis", async () => {
    const png = join("original", "secret.png");
    expect(await analyze(png, (await stat(join(root, png))).size, pngSha)).toMatchObject({
      status: "bound", proof: { snapshotSha256: pngSha },
      analysis: { media: "image", image: { status: "completed", distribution: { palette: [{ bucket: "#e02020" }] } } },
    });
    expect(await analyze("silent.m4a", (await stat(join(root, "silent.m4a"))).size, audioSha)).toMatchObject({
      status: "bound", proof: { snapshotSha256: audioSha },
      analysis: { media: "music", audio: { status: "completed", coverage: { samplesRead: 8_000 } } },
    });
  });

  it("blocks mismatched bytes, file or directory aliases and oversized input before probing", async () => {
    const spy = vi.spyOn(tools, "runMedia");
    try {
      for (const file of ["mismatch.mp4", "hard-original.mp4", "hard-alias.mp4", "oversize.mp4"]) {
        expect(await analyze(file, videoBytes.length, digest(videoBytes))).toEqual(unavailable);
      }
      const alias = join("directory-alias", "secret.png");
      expect(await analyze(alias, (await stat(join(root, alias))).size, pngSha)).toEqual(unavailable);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("withholds proof and findings if the source is replaced during decoding with identical bytes", async () => {
    let copy: string | undefined;
    const actual = tools.runMedia;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (args[0] === ffprobe) {
        copy = args[1]?.at(-1);
        renameSync(join(root, "replace.mp4"), join(root, "previous.mp4"));
        renameSync(join(root, "replacement.mp4"), join(root, "replace.mp4"));
      }
      return actual(...args);
    });
    try {
      expect(await analyze("replace.mp4", videoBytes.length, digest(videoBytes))).toEqual(unavailable);
      expect(copy).toBeDefined();
      await expect(access(dirname(copy!))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(root, "replace.mp4"))).toEqual(videoBytes);
    } finally { spy.mockRestore(); }
  });

  it.each(["cancelled", "timed_out"] as const)("withholds evidence and cleans the bound copy after %s", async reason => {
    const actual = tools.runMedia;
    const ready = Promise.withResolvers<void>();
    const controller = new AbortController();
    let copy: string | undefined;
    let closed = false;
    const spy = vi.spyOn(tools, "runMedia").mockImplementation((...args) => {
      if (args[0] !== ffprobe) return actual(...args);
      copy = args[1]?.at(-1);
      const child = actual(process.execPath, ["-e", "setInterval(() => {}, 100)"], args[2]);
      child.child.once("close", () => { closed = true; });
      ready.resolve();
      return child;
    });
    try {
      const pending = analyze("sample.mp4", videoBytes.length, digest(videoBytes), {
        signal: controller.signal, timeoutMs: reason === "timed_out" ? 800 : 5_000,
      });
      if (reason === "cancelled") {
        await ready.promise;
        controller.abort();
      }
      expect(await pending).toEqual({ status: "unavailable", reason });
      expect(closed).toBe(true);
      expect(copy).toBeDefined();
      await expect(access(dirname(copy!))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { spy.mockRestore(); }
  });
});

it("requires the registered digest and source generation from the server", async () => {
  for (const authority of [undefined, { sha256: "bad", sourceGeneration: proofGeneration },
    { sha256: "a".repeat(64) }, { sha256: "a".repeat(64), sourceGeneration: "" }]) {
    expect(await analyzeRegisteredReferenceSnapshot("", {}, authority, { managedRoot: "" }))
      .toEqual({ status: "unavailable", reason: "invalid_registration" });
  }
});
