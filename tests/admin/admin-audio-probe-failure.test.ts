// 오디오 422 조치: 측정 도구가 시작하지 못한 실패는 파일 문제(422)가 아니라 서버 도구 문제로 나누고,
// 고정 FFmpeg 묶음의 lib 바로가기는 도구가 찾는 이름의 실제 파일로 바꾼다.
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AudioUploadError, classifyProbeFailure, identifiedAudioFormat, identifyInlineAudio, measureInlineAudio }
  from "@/lib/reference-analysis/admin-audio-media";
// @ts-expect-error 빌드 스크립트(.mjs)라 타입 선언이 없다.
import { flattenLibraryLinks } from "../../scripts/reference-media-libs.mjs";

describe("identifiedAudioFormat", () => {
  it("maps only the four supported containers with their own codecs", () => {
    expect(identifiedAudioFormat("mp3", "mp3")).toBe("mp3");
    expect(identifiedAudioFormat("wav", "pcm_s16le")).toBe("wav");
    expect(identifiedAudioFormat("mov,mp4,m4a,3gp,3g2,mj2", "aac")).toBe("m4a");
    expect(identifiedAudioFormat("mov,mp4,m4a,3gp,3g2,mj2", "alac")).toBe("m4a");
    expect(identifiedAudioFormat("flac", "flac")).toBe("flac");
    for (const [name, codec] of [["aac", "aac"], ["ogg", "opus"], ["matroska,webm", "opus"], ["mp3", "aac"], ["wav", "mp3"],
      ["mov,mp4,m4a,3gp,3g2,mj2", "mp3"], ["flac", "pcm_s16le"], [undefined, undefined]] as const) {
      expect(identifiedAudioFormat(name, codec)).toBeUndefined();
    }
  });

  it("stops as a server tool problem when the measuring tool is missing", async () => {
    vi.stubEnv("FFPROBE_PATH", join(tmpdir(), "missing-ffprobe-for-identify"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(identifyInlineAudio(Buffer.alloc(256, 7), AbortSignal.timeout(5_000)))
      .rejects.toMatchObject({ code: "media_unavailable" });
    vi.unstubAllEnvs();
  });
});

describe("classifyProbeFailure", () => {
  it("treats a missing or unstartable tool as a server tool problem", () => {
    expect(classifyProbeFailure(Object.assign(new Error("x"), { code: "ENOENT" }), "probe").kind).toBe("tool_missing");
    expect(classifyProbeFailure(Object.assign(new Error("x"), { code: "EACCES" }), "probe").kind).toBe("tool_missing");
    expect(classifyProbeFailure(Object.assign(new Error("x"), { code: 127, stderr: "" }), "probe")).toEqual({ stage: "probe", kind: "tool_start", exitCode: 127, signal: null });
    expect(classifyProbeFailure(Object.assign(new Error("x"), { code: 126 }), "decode").kind).toBe("tool_start");
    const loader = Object.assign(new Error("x"), { code: 1, stderr: "ffprobe.bin: error while loading shared libraries: libavcodec.so.62: cannot open shared object file" });
    expect(classifyProbeFailure(loader, "probe")).toEqual({ stage: "probe", kind: "tool_start", exitCode: 1, signal: null });
  });

  it("keeps real media problems as invalid files and never copies the error text", () => {
    expect(classifyProbeFailure(Object.assign(new Error("x"), { code: 1, stderr: "Invalid data found when processing input" }), "decode"))
      .toEqual({ stage: "decode", kind: "media_error", exitCode: 1, signal: null });
    expect(classifyProbeFailure(new SyntaxError("Unexpected token"), "probe_output").kind).toBe("invalid_output");
    expect(classifyProbeFailure(new Error("Unsupported streams"), "streams").kind).toBe("unsupported_streams");
    expect(classifyProbeFailure(Object.assign(new Error("x"), { killed: true, signal: "SIGTERM" }), "probe"))
      .toEqual({ stage: "probe", kind: "tool_stopped", exitCode: null, signal: "SIGTERM" });
    expect(JSON.stringify(classifyProbeFailure(Object.assign(new Error("/tmp/secret.mp3"), { code: 1, stderr: "/tmp/secret.mp3" }), "decode")))
      .not.toContain("secret");
  });
});

describe("flattenLibraryLinks", () => {
  let root = "";
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

  it("leaves one real file per library under the name the tool loads", async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "dream-media-libs-")));
    for (const [name, body] of [["libavcodec.so.62.28.103", "codec"], ["libavutil.so.60.26.103", "util"]]) {
      writeFileSync(join(root, name), body);
      const [soname, dev] = [name.replace(/(\.so\.\d+).*/, "$1"), name.replace(/\.so\..*/, ".so")];
      symlinkSync(name, join(root, soname), "file");
      symlinkSync(name, join(root, dev), "file");
    }
    expect(await flattenLibraryLinks(root)).toEqual(["libavcodec.so.62", "libavutil.so.60"]);
    expect(readdirSync(root).sort()).toEqual(["libavcodec.so.62", "libavutil.so.60"]);
    for (const name of readdirSync(root)) expect(lstatSync(join(root, name)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, "libavcodec.so.62"), "utf8")).toBe("codec");
  });

  it("fails when no library file is present", async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "dream-media-libs-")));
    writeFileSync(join(root, "README"), "x");
    await expect(flattenLibraryLinks(root)).rejects.toThrow();
  });
});

// 오디오 422 2차 보완: 측정 필수(requireProbe)면 도구가 없을 때 측정을 건너뛰지 않고 media_unavailable을 던진다.
describe("measureInlineAudio requireProbe", () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(4), Buffer.from("isommp41"), Buffer.alloc(64)]);
  afterEach(() => { vi.unstubAllEnvs(); });

  it("skips only when the probe is optional", async () => {
    vi.stubEnv("FFPROBE_PATH", join(tmpdir(), "dream-missing-tool", "ffprobe-not-here"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const audio = { bytes: mp4, mime: "audio/mp4" };
    expect(await measureInlineAudio(audio, AbortSignal.timeout(10_000))).toEqual({ source: "unavailable", reason: "probe_unavailable" });
    const required = await measureInlineAudio(audio, AbortSignal.timeout(10_000), true).catch((error: unknown) => error);
    expect(required).toBeInstanceOf(AudioUploadError);
    expect((required as AudioUploadError).code).toBe("media_unavailable");
  });
});
