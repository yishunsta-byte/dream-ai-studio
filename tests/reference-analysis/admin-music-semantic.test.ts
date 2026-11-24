import { describe, expect, it, vi } from "vitest";
import { MUSIC_EXTERNAL_CONSENT_HEADER, MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";
import { createMusicSemanticHttp, geminiMusicProvider } from "@/lib/reference-analysis/music-semantic-server";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "admin@example.invalid" } as const;
const report = { genre: "앰비언트", instruments: ["피아노"], tempoBpm: 96,
  structure: [{ label: "도입", description: "잔잔한 피아노 뒤에 리듬이 들어와요." }], sunoPrompt: "Ambient piano, understated drums, 96 BPM" };
const result = { status: "ready", provider: "gemini", report } as const;

function wav() {
  const bytes = Buffer.alloc(44 + 1600);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(1600, 40);
  return new Uint8Array(bytes);
}

function post(body: BodyInit = wav(), headers: Record<string, string> = {}, consent = true) {
  return new Request(site + MUSIC_SEMANTIC_URI, { method: "POST", body, headers: {
    origin: site, host: "studio.example.invalid", "content-type": "application/octet-stream", "x-dream-filename": "example.wav",
    ...(consent ? { [MUSIC_EXTERNAL_CONSENT_HEADER]: "true" } : {}), ...headers,
  } });
}

describe("music semantic route", () => {
  const env = { NODE_ENV: "test", DREAM_SITE_URL: site } as const;

  it("reports only authenticated configuration status and checks authorization, origin and consent before provider use", async () => {
    const provider = vi.fn(() => vi.fn(async () => result));
    const anonymous = createMusicSemanticHttp({ env, authenticate: async () => ({ kind: "local" }), provider });
    expect((await anonymous.get()).status).toBe(401);
    expect((await anonymous.post(post())).status).toBe(401);
    const admin = createMusicSemanticHttp({ env, authenticate: async () => actor, provider });
    expect((await admin.post(post(wav(), { origin: "https://foreign.example.invalid" }))).status).toBe(403);
    expect((await admin.post(post(wav(), {}, false))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    const availability = await admin.get();
    expect(availability.headers.get("cache-control")).toBe("no-store");
    expect(await availability.json()).toEqual({ semantic: { music: "configured" } });
    expect(provider.mock.results[0].value).not.toHaveBeenCalled();
    const absent = createMusicSemanticHttp({ env, authenticate: async () => actor, provider: () => undefined });
    expect(await (await absent.get()).json()).toEqual({ semantic: { music: "not_configured" } });
    expect(await (await absent.post(post())).json()).toEqual({ semantic: { status: "unavailable", reason: "not_configured" } });
  });

  it("blocks other types, inaccurate filenames and over-limit actual bodies before sending audio", async () => {
    const run = vi.fn(async () => result);
    const admin = createMusicSemanticHttp({ env, authenticate: async () => actor, provider: () => run });
    // 판별되지 않는 입력은 서버 측정으로만 확인한다. 측정 도구가 없는 상태를 고정해 503·전송 0을 확인하고,
    // 알려진 비오디오(GIF)는 측정 없이 바로 422로 닫히는지 확인한다.
    vi.stubEnv("FFPROBE_PATH", "/nonexistent/dream-missing-ffprobe");
    vi.stubEnv("FFMPEG_PATH", "/nonexistent/dream-missing-ffmpeg");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await admin.post(post(new Uint8Array(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]))))).status).toBe(422);
    expect((await admin.post(post("not music"))).status).toBe(503);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    expect((await admin.post(post(wav(), { "x-dream-filename": "image.png" }))).status).toBe(400);
    expect((await admin.post(post(wav(), { "content-length": String(4 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect((await admin.post(post(new Uint8Array(4 * 1024 * 1024 + 1)))).status).toBe(413);
    expect(run).not.toHaveBeenCalled();
    const answer = await admin.post(post());
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ semantic: result });
    expect(run).toHaveBeenCalledExactlyOnceWith({ bytes: Buffer.from(wav()), mime: "audio/wav" });
  });

  it("checks declared and streamed sizes separately and accepts the exact upload limit", async () => {
    const run = vi.fn(async () => result);
    const admin = createMusicSemanticHttp({ env, authenticate: async () => actor, provider: () => run });
    const limit = 4 * 1024 * 1024;
    const encodedWav = new Uint8Array(limit);
    encodedWav.set(wav());
    const view = new DataView(encodedWav.buffer);
    view.setUint32(4, limit - 8, true);
    view.setUint32(40, limit - 44, true);
    const exact = await admin.post(post(encodedWav, { "content-length": String(limit) }));
    expect(exact.status).toBe(200);
    expect(run.mock.calls).toHaveLength(1);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodedWav);
        controller.enqueue(new Uint8Array([0]));
      },
      cancel,
    });
    const request = new Request(post().url, { method: "POST", headers: post().headers, body, ...{ duplex: "half" } });
    const over = await admin.post(request);
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: "too_large" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(run.mock.calls).toHaveLength(1);
  });
});

describe("Gemini music adapter", () => {
  const env = { DREAM_MUSIC_SEMANTIC_GEMINI_API_KEY: "synthetic-key", DREAM_MUSIC_SEMANTIC_GEMINI_MODEL: "gemini-test-model" };
  const output = (value: unknown) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
  const audio = { bytes: Buffer.from(wav()), mime: "audio/wav" };

  it("uses structured audio-only input and distinguishes complete, partial and malformed results", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(output(report)).mockResolvedValueOnce(output({ ...report, tempoBpm: null }))
      .mockResolvedValueOnce(output({ ...report, tempoBpm: "95 BPM" })).mockResolvedValueOnce(new Response("private upstream error", { status: 403 }));
    const run = geminiMusicProvider(env, send)!;
    expect(await run(audio)).toEqual(result);
    expect(await run(audio)).toMatchObject({ status: "partial", report: { tempoBpm: null } });
    expect(await run(audio)).toEqual({ status: "unavailable", reason: "invalid_response" });
    expect(await run(audio)).toEqual({ status: "unavailable", reason: "provider_error" });
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
    expect(init).toMatchObject({ credentials: "omit", redirect: "error", headers: { "x-goog-api-key": "synthetic-key" } });
    const payload = JSON.parse(String(init?.body));
    expect(payload.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "audio/wav", data: audio.bytes.toString("base64") } });
    expect(payload.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
    expect(String(init?.body)).not.toContain("example.wav");
    expect(geminiMusicProvider({ ...env, DREAM_MUSIC_SEMANTIC_GEMINI_MODEL: "gemini-x/../path" }, send)).toBeUndefined();
  });
});
