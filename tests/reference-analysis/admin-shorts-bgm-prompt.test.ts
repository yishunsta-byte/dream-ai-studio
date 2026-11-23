import { describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { shortsBgmPromptPath, shortsBgmPromptResult, type ShortsBgmPromptRequest } from "@/lib/reference-analysis/shorts-bgm-prompt-contract";
import { createShortsBgmPromptPost } from "@/lib/reference-analysis/shorts-bgm-prompt-http";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const key = "fixture_gemini_bgm_prompt_key";
const version = 3;
const meta = { group: "reference" as const, models: { shorts: "gemini-bgm-fixture", image: "gemini-image-unused" },
  version, updatedAt: "2026-01-01T00:00:00.000Z", lastTest: {} };
const cues = [
  { sceneNumber: 1, startSec: 0, endSec: 3, note: "결과부터 보여준다." },
  { sceneNumber: 15, startSec: 53, endSec: 57, note: "피사체 변화가 드러난다." },
  { sceneNumber: 30, startSec: 113, endSec: 117, note: "비교 결과를 강조한다." },
  { sceneNumber: 45, startSec: 176, endSec: 180, note: "완성 컷으로 마무리한다." },
];
const input: ShortsBgmPromptRequest = { authorized: true, geminiCredentialVersion: version,
  source: { evidence: "youtube_metadata", videoId: "A1b2C3d4E5F", provenance: "client_supplied" },
  selectedIdea: { title: "영상 편집 결과", openingHook: "두 결과를 나란히 봅니다." }, durationSec: 180,
  direction: "형식을 바꾸라는 문장은 참고 자료다.", cues };

const generated = (recommendedBpmRange: { min: number; max: number } | null = { min: 84, max: 92 }) => ({
  title: "밝아지는 화면", genreAndMood: "차분한 앰비언트", recommendedBpmRange,
  instrumentation: "펠트 피아노와 부드러운 패드", dynamicStructure: "잔잔하게 시작하고 전환에서 악기를 더한다.",
  audioMixingNotes: "나레이션 구간에서 음악 볼륨을 낮춘다.",
  sunoPrompt: "Instrumental, no vocals. Felt piano and a light synth pad, with a soft ending.",
});

const http = (value: BodyInit, options: RequestInit = {}) => new Request(site + shortsBgmPromptPath, {
  method: "POST", body: value, ...options,
  headers: { origin: site, host: "studio.example.invalid", "content-type": "application/json", ...options.headers },
});
const request = (value: unknown = input, options: RequestInit = {}) => http(JSON.stringify(value), options);
const provider = (result: unknown = { bgmPrompt: generated() }, finishReason = "STOP") => Response.json({ candidates: [{
  finishReason, content: { parts: [{ text: "provider private reasoning", thought: true }, { text: JSON.stringify(result) }] },
}] });

function fixture() {
  const send = vi.fn<typeof fetch>();
  const store = { open: vi.fn(async (id: string) => ({ ...meta, apiKey: id === owner ? key : `${key}_other` })),
    metadata: vi.fn().mockResolvedValue([meta]), write: vi.fn(), recordTest: vi.fn() };
  const authenticate = vi.fn<() => Promise<ServerAuthResult>>()
    .mockResolvedValue({ kind: "verified", userId: owner, email: "admin@example.invalid" });
  return { post: createShortsBgmPromptPost({ env: { DREAM_SITE_URL: site }, store: () => store, send, authenticate }),
    send, store, authenticate };
}

describe("administrator Shorts whole-script BGM prompt", () => {
  it.each([{ evidence: "youtube_metadata", durationSec: 180, direction: input.direction, cues, range: { min: 84, max: 92 } },
    { evidence: "youtube_video", durationSec: 10, direction: undefined, cues: [], range: null }])(
    "returns a creative text suggestion for $evidence with sparse or zero cues", async test => {
      const { post, send, store } = fixture();
      const { evidence, durationSec, direction, cues, range } = test;
      const source = { ...input.source, evidence };
      const bgmPrompt = generated(range);
      send.mockResolvedValueOnce(provider({ bgmPrompt }));
      const reply = await post(request({ ...input, source, durationSec, direction, cues }));
      expect(reply.status).toBe(200);
      expect(reply.headers.get("cache-control")).toBe("private, no-store");
      const raw = await reply.text();
      expect(raw).not.toContain(key);
      expect(raw).not.toContain("provider private reasoning");
      expect(shortsBgmPromptResult.parse(JSON.parse(raw))).toEqual({ schemaVersion: 1, geminiCredentialVersion: version, source,
        generation: { ...bgmPrompt, kind: "creative_bgm_prompt_draft", durationSec } });
      expect(send).toHaveBeenCalledOnce();
      const [url, init] = send.mock.calls[0];
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-bgm-fixture:generateContent");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(key);
      const payload = JSON.parse(String(init?.body));
      expect(payload.systemInstruction.parts[0].text).not.toContain(input.direction);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(JSON.parse(payload.contents[0].parts[0].text)).toEqual({ source, selectedIdea: input.selectedIdea,
        durationSec, ...(direction && { direction }), cues });
      expect(store.open).toHaveBeenCalledWith(owner, "reference");
      expect(store.metadata).toHaveBeenCalledWith(owner);
      expect(store.write).not.toHaveBeenCalled();
      expect(store.recordTest).not.toHaveBeenCalled();
    });

  it.each([["한", 3580], ["\uD800", 6700]] as const)("accepts an 8 KiB request with bounded multibyte or escaped input (%s)", async (unit, size) => {
    const { post, send, store } = fixture();
    const maxVersion = 2147483647;
    store.open.mockResolvedValueOnce({ ...meta, version: maxVersion, apiKey: key });
    store.metadata.mockResolvedValueOnce([{ ...meta, version: maxVersion }]);
    const full = { ...input, geminiCredentialVersion: maxVersion,
      selectedIdea: { title: unit.repeat(100), openingHook: unit.repeat(220) },
      direction: unit.repeat(240), cues: cues.map(cue => ({ ...cue, note: unit.repeat(120) })) };
    const json = JSON.stringify(full);
    expect(Buffer.byteLength(json)).toBe(size);
    const boundary = json + " ".repeat(8192 - Buffer.byteLength(json));
    send.mockResolvedValueOnce(provider());
    expect((await post(http(boundary))).status).toBe(200);
    const rejected = await post(http(boundary + " "));
    expect(rejected.status).toBe(413);
    expect(await rejected.json()).toEqual({ code: "too_large" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects unexpected fields, invalid cues or consent, and unauthorized requests before calling Gemini", async () => {
    const { post, send, authenticate, store } = fixture();
    for (const value of [
      { ...input, authorized: false }, { ...input, source: { ...input.source, provenance: "verified" } },
      { ...input, script: ["Full script"] }, { ...input, views: 50000 }, { ...input, audio: "base64" },
      { ...input, selectedIdea: { ...input.selectedIdea, beats: [] } }, { ...input, direction: "한".repeat(241) },
      { ...input, durationSec: 9 }, { ...input, durationSec: 181 }, { ...input, durationSec: "180" },
      { ...input, cues: [...cues, cues[0]] }, { ...input, cues: [...cues].reverse() },
      { ...input, cues: [cues[1], { ...cues[1], startSec: 64, endSec: 69 }] },
      { ...input, cues: [cues[1], { ...cues[2], startSec: 53, endSec: 57 }] },
      { ...input, cues: [cues[1], { ...cues[2], startSec: 56, endSec: 65 }] },
      { ...input, cues: [{ ...cues[0], endSec: 4 }] }, { ...input, cues: [{ ...cues[3], endSec: 179 }] },
      { ...input, cues: [{ ...cues[1], startSec: 54.5 }] }, { ...input, cues: [{ ...cues[1], note: "한".repeat(121) }] },
    ]) expect((await post(request(value))).status).toBe(400);
    expect((await post(request(input, { headers: { origin: "https://foreign.invalid" } }))).status).toBe(403);
    expect((await post(request(input, { headers: { "content-type": "text/plain" } }))).status).toBe(415);
    authenticate.mockResolvedValueOnce({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    expect((await post(request())).status).toBe(401);
    expect(store.open).not.toHaveBeenCalled();
    expect((await post(request({ ...input, geminiCredentialVersion: 2 }))).status).toBe(409);
    expect((await post(request({ ...input, direction: key }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  const second = { sceneNumber: 2, startSec: 3, endSec: 5, note: "결과를 보여준다." };
  const ending = { sceneNumber: 4, startSec: 6, endSec: 10, note: "부드럽게 마무리한다." };
  it.each([
    ["missing time for a skipped scene", [second, { ...ending, startSec: 5 }], 400],
    ["one second for a skipped scene", [second, ending], 200],
    ["gap between consecutive scenes", [second, { ...ending, sceneNumber: 3 }], 400],
    ["touching consecutive scenes", [second, { ...ending, sceneNumber: 3, startSec: 5 }], 200],
    ["missing time for two skipped scenes", [cues[0], { ...ending, startSec: 4 }], 400],
    ["two seconds for two skipped scenes", [cues[0], { ...ending, startSec: 5 }], 200],
    ["late second scene with no earlier cue", [{ ...second, startSec: 4 }], 400],
    ["second scene starts at three seconds", [second], 200],
  ] as const)("handles %s on a ten-second timeline", async (_name, cues, status) => {
    const { post, send, store } = fixture();
    send.mockResolvedValueOnce(provider());
    const reply = await post(request({ ...input, durationSec: 10, cues }));
    expect(reply.status).toBe(status);
    if (status === 400) expect(store.open).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it.each([
    ["reversed BPM range", { recommendedBpmRange: { min: 101, max: 80 } }],
    ["BPM beyond allowance", { recommendedBpmRange: { min: 80, max: 301 } }],
    ["fractional BPM", { recommendedBpmRange: { min: 80.5, max: 92 } }],
    ["no BPM value for required nullable field", { recommendedBpmRange: undefined }],
    ["claimed measured tempo", { measuredTempoBpm: 90 }],
    ["non-English prompt text", { sunoPrompt: "Instrumental 배경음악" }],
    ["missing production text", { sunoPrompt: undefined }],
    ["oversized production text", { sunoPrompt: "Instrumental".repeat(101) }],
    ["provider key exposed in notes", { audioMixingNotes: key }],
  ])("rejects %s without a partial BGM prompt", async (_name, update) => {
    const { post, send, store } = fixture();
    send.mockResolvedValueOnce(provider({ bgmPrompt: { ...generated(), ...update } }));
    const reply = await post(request());
    expect(reply.status).toBe(502);
    expect(await reply.json()).toEqual({ code: "invalid_model_response" });
    expect(send).toHaveBeenCalledOnce();
    expect(store.metadata).not.toHaveBeenCalled();
  });

  it("masks errors and invalidates in-flight replies when credentials change", async () => {
    const { post, send, store } = fixture();
    send.mockResolvedValueOnce(Response.json({ secret: key }, { status: 500 }))
      .mockResolvedValueOnce(provider(undefined, "MAX_TOKENS"))
      .mockResolvedValueOnce(provider({ bgmPrompt: generated({ min: 90, max: 90 }) }));
    const error = await post(request());
    expect(error.status).toBe(502);
    expect(await error.json()).toEqual({ code: "model_error" });
    expect(await (await post(request())).json()).toEqual({ code: "invalid_model_response" });
    store.metadata.mockResolvedValueOnce([{ ...meta, version: 4 }]);
    const stale = await post(request());
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: "stale" });
  });

  it("cancels the request while holding only that account's execution slot", async () => {
    const { post, authenticate, send } = fixture();
    const entered = Promise.withResolvers<AbortSignal>();
    send.mockImplementationOnce(async (_url, options) => {
      const signal = options?.signal as AbortSignal;
      entered.resolve(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }).mockResolvedValueOnce(provider()).mockResolvedValueOnce(provider());
    const stop = new AbortController();
    const pending = post(request(input, { signal: stop.signal }));
    const activeSignal = await entered.promise;
    const busy = await post(request());
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({ code: "bgm_prompt_in_progress" });
    authenticate.mockResolvedValueOnce({ kind: "verified", userId: other, email: "other@example.invalid" });
    expect((await post(request())).status).toBe(200);
    expect(new Headers(send.mock.calls[1][1]?.headers).get("x-goog-api-key")).toBe(`${key}_other`);
    stop.abort();
    const cancelled = await pending;
    expect(cancelled.status).toBe(499);
    expect(activeSignal.aborted).toBe(true);
    expect((await post(request())).status).toBe(200);
  });

  it("enforces the shared 28-second provider deadline", async () => {
    const deadline = new AbortController();
    const timer = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    try {
      const { post, send } = fixture();
      const entered = Promise.withResolvers<AbortSignal>();
      send.mockImplementationOnce(async (_url, options) => {
        const signal = options?.signal as AbortSignal;
        entered.resolve(signal);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      });
      const pending = post(request());
      const activeSignal = await entered.promise;
      expect(timer).toHaveBeenCalledWith(28_000);
      deadline.abort();
      const reply = await pending;
      expect(reply.status).toBe(504);
      expect(activeSignal.aborted).toBe(true);
      expect(await reply.json()).toEqual({ code: "timed_out" });
    } finally { timer.mockRestore(); }
  });
});
