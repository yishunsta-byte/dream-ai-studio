// 오디오 422 2차: 일반 MP4 표시(isom)라 mp4로 판별되는 M4A는 보고서 버전과 관계없이 측정(오디오 전용 스트림·디코딩)을
// 통과해야만 공급자로 보낸다. 측정 도구를 쓸 수 없으면 보내지 않고 503. 검사 전 거절은 고정 목록 값의 기록 한 줄만 남긴다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_AUDIO_ANALYSIS_URI, ADMIN_AUDIO_MODE_HEADER } from "@/lib/reference-analysis/admin-audio-contract";
import { createAdminAudioAnalysisPost } from "@/lib/reference-analysis/admin-audio-analysis-server";
import { audioContentMatches, audioInputRejected } from "@/lib/reference-analysis/admin-audio-http";
import { AudioUploadError } from "@/lib/reference-analysis/admin-audio-media";
import { MUSIC_EXTERNAL_CONSENT_HEADER } from "@/lib/reference-analysis/music-semantic-contract";

vi.mock("server-only", () => ({}));
const probe = vi.hoisted(() => ({ measure: vi.fn() }));
vi.mock("@/lib/reference-analysis/admin-audio-media", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/reference-analysis/admin-audio-media")>(),
  measureInlineAudio: probe.measure,
}));

const site = "https://studio.example.invalid";
const env = { NODE_ENV: "test", DREAM_SITE_URL: site };
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "admin@example.invalid" } as const;
const mp4 = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(4),
  Buffer.from(`${brand}mp41`), Buffer.alloc(64)]);
const measured = { source: "server_probe", durationSeconds: 30, sampleRateHz: 44100, channels: 2 } as const;

function run(body: Buffer, filename: string) {
  const send = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));
  const post = createAdminAudioAnalysisPost({ authenticate: async () => actor, env,
    settings: async () => ({ key: "synthetic", model: "gemini-audio-test" }), send });
  const request = new Request(site + ADMIN_AUDIO_ANALYSIS_URI, { method: "POST", body: new Uint8Array(body), headers: {
    origin: site, host: "studio.example.invalid", "content-type": "application/octet-stream",
    "x-dream-filename": encodeURIComponent(filename), [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", [ADMIN_AUDIO_MODE_HEADER]: "speech" } });
  return { send, response: post(request) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { probe.measure.mockReset(); warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe("ambiguous M4A (generic MP4 brand)", () => {
  it("is sent only after the required measurement passes, even for the basic report", async () => {
    expect(audioContentMatches("m4a", "mp4")).toBe(true);
    expect(audioContentMatches("mp3", "mp4")).toBe(false);
    probe.measure.mockResolvedValue(measured);
    const { send, response } = run(mp4("isom"), "노래.m4a");
    expect((await response).status).toBe(200);
    expect(probe.measure).toHaveBeenCalledTimes(1);
    expect(probe.measure.mock.calls[0][2]).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is rejected without sending when the measurement finds no playable audio-only stream", async () => {
    probe.measure.mockRejectedValue(new AudioUploadError("invalid_file"));
    const { send, response } = run(mp4("isom"), "노래.m4a");
    const rejected = await response;
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({ error: "invalid_file" });
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("admin_audio_input_rejected", { stage: "probe", expected: "m4a", detected: "mp4", error: null });
  });

  it("stops with 503 and sends nothing when the measuring tool is unavailable", async () => {
    probe.measure.mockRejectedValue(new AudioUploadError("media_unavailable"));
    const { send, response } = run(mp4("isom"), "노래.m4a");
    const stopped = await response;
    expect(stopped.status).toBe(503);
    expect(await stopped.json()).toEqual({ error: "media_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the existing path for an M4A-branded file", async () => {
    const { send, response } = run(mp4("M4A "), "노래.m4a");
    expect((await response).status).toBe(200);
    expect(probe.measure).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("pre-check rejection record", () => {
  it("keeps name and content mismatches rejected with one fixed record and no file details", async () => {
    const { send, response } = run(mp4("isom"), "비밀 노래 제목.mp3");
    const rejected = await response;
    expect(rejected.status).toBe(422);
    expect(send).not.toHaveBeenCalled();
    expect(probe.measure).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("admin_audio_input_rejected", { stage: "file_type", expected: "mp3", detected: "mp4", error: null });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("비밀");
  });

  it("records only values from the fixed lists", () => {
    const named = Object.assign(new Error("/tmp/secret.mp3"), { name: "SecretPathError" });
    audioInputRejected("analysis", { expected: "mp3", detected: "secret-format", error: named });
    audioInputRejected("analysis", { expected: "m4a", error: new SyntaxError("bad") });
    audioInputRejected("probe", { expected: "m4a", error: new AudioUploadError("invalid_file") });
    expect(warn.mock.calls).toEqual([
      ["admin_audio_input_rejected", { stage: "analysis", expected: "mp3", detected: "other", error: "other" }],
      ["admin_audio_input_rejected", { stage: "analysis", expected: "m4a", detected: null, error: "SyntaxError" }],
      ["admin_audio_input_rejected", { stage: "probe", expected: "m4a", detected: null, error: "AudioUploadError" }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });
});
