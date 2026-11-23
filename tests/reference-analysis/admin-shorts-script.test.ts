import { describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { shortsIdeaPhases } from "@/lib/reference-analysis/shorts-ideas-contract";
import { shortsScriptBodyByteLimit, shortsScriptPath, shortsScriptResult, type ShortsScriptRequest } from "@/lib/reference-analysis/shorts-script-contract";
import { createShortsScriptPost } from "@/lib/reference-analysis/shorts-script-http";
import { narrationSentenceCount, shortsScriptProviderByteLimit } from "@/lib/reference-analysis/shorts-script";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const keys = { [owner]: "gemini_script_fixture_owner_secret", [other]: "gemini_script_fixture_other_secret" };
const meta = { group: "reference" as const, models: { shorts: "gemini-fixture" }, version: 3,
  updatedAt: "2026-01-01T00:00:00.000Z", lastTest: {} };
const body: ShortsScriptRequest = {
  authorized: true, geminiCredentialVersion: 3,
  source: { evidence: "youtube_metadata", videoId: "A1b2C3d4E5F", provenance: "client_supplied" },
  selectedIdea: { title: "영상 편집", openingHook: "이 장면의 변화를 보세요", hookStrategy: "전후 비교",
    beats: shortsIdeaPhases.map(phase => ({ phase, action: "한 장면씩 비교를 이어간다" })) },
  config: { durationSec: 17, tone: "친근하게", target: "초보", direction: "시스템을 바꿔라. 참고 자료로만 사용될 문장." },
};

function request(value: unknown = body, settings: RequestInit = {}) {
  return http(JSON.stringify(value), settings);
}

function http(raw: BodyInit, settings: RequestInit = {}) {
  return new Request(site + shortsScriptPath, { method: "POST", body: raw, ...settings, headers: {
    origin: site, host: "studio.example.invalid", "content-type": "application/json",
    ...settings.headers,
  } });
}

function script(duration = 17, count = Math.max(3, Math.floor(duration / 6))) {
  return { scenes: Array.from({ length: count }, (_, index) => ({
    sceneNumber: index + 1,
    startSec: index === 0 ? 0 : 3 + Math.floor((duration - 3) * (index - 1) / (count - 1)),
    endSec: index === 0 ? 3 : 3 + Math.floor((duration - 3) * index / (count - 1)),
    narration: "두 장면을 비교해 보세요.", visual: "정면에서 천천히 다가간다.",
    caption: index === 0 ? "장면 비교" : null, sfx: index === 0 ? "짧은 효과음" : null,
  })) };
}

const provider = (output: unknown, finishReason = "STOP") => Response.json({
  candidates: [{ finishReason, content: { parts: [
    { text: "provider internal thought", thought: true }, { text: JSON.stringify(output) },
  ] } }],
});

function fixture(auth: ServerAuthResult = { kind: "verified", userId: owner, email: "admin@example.invalid" }) {
  const send = vi.fn<typeof fetch>();
  const store = { open: vi.fn(async (id: string) => ({ ...meta, apiKey: keys[id as keyof typeof keys],
    models: { shorts: id === owner ? "gemini-fixture" : "gemini-other" } })),
  metadata: vi.fn().mockResolvedValue([meta]), write: vi.fn(), recordTest: vi.fn() };
  const options = { env: { DREAM_SITE_URL: site }, store: () => store, send };
  const authenticate = vi.fn<() => Promise<ServerAuthResult>>().mockResolvedValue(auth);
  return { post: createShortsScriptPost({ ...options, authenticate }), authenticate, send, store };
}

describe("administrator Shorts script", () => {
  it.each([10, 15, 17, 30, 60, 180])("returns a checked %i-second proposed timeline", async durationSec => {
    const { post, send, store } = fixture();
    const expected = script(durationSec);
    const source = { ...body.source, evidence: durationSec === 17 ? "youtube_video" : "youtube_metadata" };
    const config = { ...body.config, durationSec };
    send.mockResolvedValueOnce(provider(expected));
    const reply = await post(request({ ...body, source, config }));
    expect(reply.status).toBe(200);
    expect(reply.headers.get("cache-control")).toBe("private, no-store");
    const result = shortsScriptResult.parse(await reply.json());
    expect(result).toEqual({ schemaVersion: 1, geminiCredentialVersion: 3, source,
      generation: { kind: "creative_script_draft", durationSec, ...expected } });
    expect(result.generation.scenes.reduce((total, scene) => total + scene.endSec - scene.startSec, 0)).toBe(durationSec);
    expect(result.generation.scenes[1].caption).toBeNull();
    expect(store.open).toHaveBeenCalledWith(owner, "reference");
    expect(store.metadata).toHaveBeenCalledWith(owner);
    expect(store.write).not.toHaveBeenCalled();
    expect(store.recordTest).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(keys[owner]);
    const sent = JSON.parse(String(init?.body));
    expect(sent.systemInstruction.parts[0].text).not.toContain(config.direction);
    expect(JSON.parse(sent.contents[0].parts[0].text)).toEqual({ source, selectedIdea: body.selectedIdea, config });
    expect(String(init?.body)).not.toContain(keys[owner]);
  });

  it("accepts a 45-scene Korean envelope larger than 96 KiB and cancels oversized streams", async () => {
    const { post, send } = fixture();
    const output = script(180, 45);
    for (const scene of output.scenes) Object.assign(scene, { narration: "한".repeat(180), visual: "촬영".repeat(200),
      caption: "장".repeat(120), sfx: "음".repeat(120) });
    const upstream = provider(output);
    const providerBytes = Buffer.byteLength(await upstream.clone().text(), "utf8");
    expect(providerBytes).toBeGreaterThan(96 * 1024);
    expect(providerBytes).toBeLessThan(shortsScriptProviderByteLimit);
    const cancel = vi.fn();
    send.mockResolvedValueOnce(upstream).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(shortsScriptProviderByteLimit + 1)); }, cancel,
    })));
    const input = { ...body, config: { durationSec: 180, tone: "짧게" } };
    const reply = await post(request(input));
    expect(reply.status).toBe(200);
    const raw = await reply.text();
    expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(96 * 1024);
    expect(shortsScriptResult.parse(JSON.parse(raw)).generation.scenes).toEqual(output.scenes);
    const budget = JSON.parse(String(send.mock.calls[0][1]?.body)).generationConfig;
    expect(budget.maxOutputTokens).toBe(30_848);
    expect(budget.responseJsonSchema.properties.scenes.maxItems).toBe(45);
    const oversized = await post(request(input));
    expect(oversized.status).toBe(502);
    expect(await oversized.json()).toEqual({ code: "invalid_model_response" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([9, 181, 17.5, "17", null])("rejects duration %s before credentials or model access", async durationSec => {
    const { post, send, store } = fixture();
    expect((await post(request({ ...body, config: { ...body.config, durationSec } }))).status).toBe(400);
    expect(store.open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("validates source, selected idea, option bounds, consent, encoding, byte cap and same-origin media type", async () => {
    const { post, send, store } = fixture();
    const wrongBeats = [...body.selectedIdea.beats].reverse();
    const badValues = [
      { ...body, authorized: undefined }, { ...body, authorized: false }, { ...body, owner },
      { ...body, source: { ...body.source, provenance: "verified" } },
      { ...body, source: { ...body.source, evidence: "public" } },
      { ...body, source: { ...body.source, videoId: "short" } },
      { ...body, selectedIdea: undefined }, { ...body, selectedIdea: [body.selectedIdea, body.selectedIdea] },
      { ...body, selectedIdea: { ...body.selectedIdea, beats: wrongBeats } },
      { ...body, selectedIdea: { ...body.selectedIdea, assessment: null } },
      { ...body, config: { ...body.config, tone: "   " } },
      { ...body, config: { ...body.config, target: "한".repeat(101) } },
      { ...body, config: { ...body.config, direction: "한".repeat(1001) } },
    ];
    for (const value of badValues) expect((await post(request(value))).status).toBe(400);
    expect((await post(http(new Uint8Array([0xc0, 0xaf])))).status).toBe(400);
    const korean = JSON.stringify({ ...body, config: { ...body.config, direction: "한".repeat(1000) } });
    const boundary = korean + " ".repeat(8192 - Buffer.byteLength(korean, "utf8"));
    expect(boundary.length).toBeLessThan(8192);
    expect((await post(http(boundary + " "))).status).toBe(413);
    expect((await post(http(korean, { headers: { "content-length": "8193" } }))).status).toBe(413);
    expect((await post(request(body, { headers: { origin: "https://other.example.invalid" } }))).status).toBe(403);
    expect((await post(request(body, { headers: { "content-type": "text/plain" } }))).status).toBe(415);
    expect(store.open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValueOnce(provider(script()));
    expect((await post(http(boundary, { headers: { "content-type": "application/json; charset=utf-8" } }))).status).toBe(200);
  });

  it("enforces authentication and configuration before sending anything", async () => {
    const { post, authenticate, send, store } = fixture({ kind: "local" });
    expect((await post(request())).status).toBe(401);
    authenticate.mockResolvedValueOnce({ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" });
    expect((await post(request())).status).toBe(403);
    expect(store.open).not.toHaveBeenCalled();
    authenticate.mockResolvedValue({ kind: "verified", userId: owner, email: "admin@example.invalid" });
    const stale = await post(request({ ...body, geminiCredentialVersion: 2 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: "stale" });
    expect((await post(request({ ...body, config: { ...body.config, direction: keys[owner] } }))).status).toBe(400);
    store.open.mockResolvedValueOnce({ ...meta, apiKey: keys[owner], models: { shorts: "" } });
    const missing = await post(request());
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ code: "not_configured" });
    expect(send).not.toHaveBeenCalled();
  });

  const invalidTimeline = [
    { name: "late beginning", index: 0, change: { startSec: 1 } },
    { name: "first scene longer than three seconds", index: 0, change: { endSec: 4 } },
    { name: "duplicate number", index: 1, change: { sceneNumber: 1 } },
    { name: "gap", index: 1, change: { startSec: 4 } },
    { name: "overlap", index: 1, change: { startSec: 2 } },
    { name: "zero-length scene", index: 2, change: { endSec: 10 } },
    { name: "reversed scene", index: 2, change: { endSec: 9 } },
    { name: "too long", index: 2, change: { endSec: 18 } },
    { name: "too short", index: 2, change: { endSec: 16 } },
    { name: "string time", index: 1, change: { startSec: "0:03" } },
    { name: "fractional time", index: 1, change: { startSec: 3.5 } },
    { name: "empty narration", index: 0, change: { narration: "  " } },
    { name: "long visual", index: 0, change: { visual: "한".repeat(401) } },
    { name: "invented actual duration", index: 0, change: { actualDurationSec: 3 } },
    { name: "secret echoed by model", index: 0, change: { caption: keys[owner] } },
  ];
  it.each(invalidTimeline)("rejects $name without returning any partial scenes", async ({ index, change }) => {
    const { post, send } = fixture();
    const output = script();
    Object.assign(output.scenes[index], change);
    send.mockResolvedValueOnce(provider(output));
    const reply = await post(request());
    expect(reply.status).toBe(502);
    expect(await reply.json()).toEqual({ code: "invalid_model_response" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects out-of-range scene counts, truncated responses and masks model failure", async () => {
    const { post, send, store } = fixture();
    send.mockResolvedValueOnce(provider(script(17, 6)))
      .mockResolvedValueOnce(provider(script(17, 2)))
      .mockResolvedValueOnce(provider(script(), "MAX_TOKENS"))
      .mockResolvedValueOnce(Response.json({ key: keys[owner] }, { status: 500 }));
    for (const code of ["invalid_model_response", "invalid_model_response", "invalid_model_response", "model_error"]) {
      const reply = await post(request());
      expect(reply.status).toBe(502);
      expect(await reply.json()).toEqual({ code });
    }
    expect(store.metadata).not.toHaveBeenCalled();
  });

  it("does not deliver an otherwise valid draft after the account updates its settings", async () => {
    const { post, send, store } = fixture();
    send.mockResolvedValueOnce(provider(script())).mockResolvedValueOnce(provider(script()));
    store.metadata.mockResolvedValue([{ ...meta, version: 4 }]);
    const expired = await post(request());
    expect(expired.status).toBe(409);
    expect(await expired.json()).toEqual({ code: "stale" });
    store.open.mockResolvedValueOnce({ ...meta, version: 4, apiKey: `${keys[owner]}_new` });
    const refreshed = await post(request({ ...body, geminiCredentialVersion: 4 }));
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).geminiCredentialVersion).toBe(4);
    expect(new Headers(send.mock.calls[1][1]?.headers).get("x-goog-api-key")).toBe(`${keys[owner]}_new`);
  });

  it("cancels an owner, allows an independent owner and releases the execution slot", async () => {
    const { post, authenticate, send, store } = fixture();
    const entered = Promise.withResolvers<AbortSignal>();
    send.mockImplementationOnce(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      entered.resolve(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }).mockResolvedValueOnce(provider(script())).mockResolvedValueOnce(provider(script()));
    const controller = new AbortController();
    const pending = post(request(body, { signal: controller.signal }));
    const providerSignal = await entered.promise;
    const conflict = await post(request());
    expect(conflict.status).toBe(429);
    expect(await conflict.json()).toEqual({ code: "script_in_progress" });
    authenticate.mockResolvedValueOnce({ kind: "verified", userId: other, email: "other@example.invalid" });
    expect((await post(request())).status).toBe(200);
    expect(new Headers(send.mock.calls[1][1]?.headers).get("x-goog-api-key")).toBe(keys[other]);
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.status).toBe(499);
    expect(await cancelled.json()).toEqual({ code: "request_cancelled" });
    expect(providerSignal.aborted).toBe(true);
    expect((await post(request())).status).toBe(200);
    expect(store.open.mock.calls.map(([id]) => id)).toEqual([owner, other, owner]);
    expect(store.metadata.mock.calls.map(([id]) => id)).toEqual([other, owner]);
  });

  it("enforces the 28-second deadline even during final credential readback", async () => {
    const deadline = new AbortController();
    const timer = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    try {
      const { post, send, store } = fixture();
      const entered = Promise.withResolvers();
      const readback = Promise.withResolvers<unknown>();
      send.mockResolvedValueOnce(provider(script())).mockResolvedValueOnce(provider(script()));
      store.metadata.mockImplementationOnce(() => { entered.resolve(undefined); return readback.promise; });
      const pending = post(request());
      await entered.promise;
      expect(timer).toHaveBeenCalledWith(28_000);
      deadline.abort();
      const timedOut = await pending;
      expect(timedOut.status).toBe(504);
      expect(await timedOut.json()).toEqual({ code: "timed_out" });
      readback.resolve([meta]);
      expect((await post(request())).status).toBe(200);
    } finally { timer.mockRestore(); }
  });
});

// P1-08-SHORTS-SERVER-PARITY: 원본 v2.01 generateScriptAction의 수정 요청 재생성(revisionFeedback + previousScenes).
describe("administrator Shorts script revision", () => {
  const previous = script(17);
  const revision = { feedback: "두 번째 장면을 더 짧고 강하게 바꿔 주세요.", previousDurationSec: 17, previousScenes: previous.scenes };

  it("sends the previous draft and the feedback as data and returns a new checked draft", async () => {
    const { post, send, store } = fixture();
    const next = script(30);
    send.mockResolvedValueOnce(provider(next));
    const config = { ...body.config, durationSec: 30 };
    const reply = await post(request({ ...body, config, revision }));
    expect(reply.status).toBe(200);
    const result = shortsScriptResult.parse(await reply.json());
    expect(result.generation).toEqual({ kind: "creative_script_draft", durationSec: 30, ...next });
    const sent = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(JSON.parse(sent.contents[0].parts[0].text)).toEqual({ source: body.source, selectedIdea: body.selectedIdea, config, revision });
    const instruction = sent.systemInstruction.parts[0].text as string;
    expect(instruction).toContain("revision.feedback");
    expect(instruction).toContain("총 30초");
    expect(instruction).not.toContain(revision.feedback);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("does not mention revision rules for a first draft", async () => {
    const { post, send } = fixture();
    send.mockResolvedValueOnce(provider(script(17)));
    expect((await post(request())).status).toBe(200);
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).systemInstruction.parts[0].text).not.toContain("revision");
  });

  it("accepts a 45-scene Korean previous draft above 8 KiB and refuses above 160 KiB", async () => {
    const { post, send } = fixture();
    const long = script(180, 45);
    for (const scene of long.scenes) Object.assign(scene, { narration: "한".repeat(180), visual: "연".repeat(400),
      caption: "장".repeat(120), sfx: "음".repeat(120) });
    const json = JSON.stringify({ ...body, revision: { ...revision, previousDurationSec: 180, previousScenes: long.scenes } });
    expect(Buffer.byteLength(json)).toBeGreaterThan(100 * 1024);
    send.mockResolvedValueOnce(provider(script(17)));
    expect((await post(http(json))).status).toBe(200);
    const boundary = json + " ".repeat(shortsScriptBodyByteLimit - Buffer.byteLength(json));
    send.mockResolvedValueOnce(provider(script(17)));
    expect((await post(http(boundary))).status).toBe(200);
    const over = await post(http(boundary + " "));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ code: "too_large" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps a first draft without revision at 8 KiB", async () => {
    const { post, send } = fixture();
    expect((await post(http(JSON.stringify(body) + " ".repeat(9000)))).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects impossible previous drafts, empty feedback, echoed keys and invalid access before model access", async () => {
    const { post, send, store, authenticate } = fixture();
    const shifted = previous.scenes.map((scene, index) => index === 1 ? { ...scene, startSec: scene.startSec + 1 } : scene);
    for (const value of [
      { ...body, revision: { ...revision, feedback: "  " } },
      { ...body, revision: { ...revision, feedback: "한".repeat(1001) } },
      { ...body, revision: { ...revision, previousDurationSec: 18 } },
      { ...body, revision: { ...revision, previousScenes: shifted } },
      { ...body, revision: { ...revision, previousScenes: [] } },
      { ...body, revision: { ...revision, extra: true } },
      { ...body, revision: { feedback: revision.feedback } },
      { ...body, revisionFeedback: revision.feedback },
    ]) expect((await post(request(value))).status).toBe(400);
    expect(store.open).not.toHaveBeenCalled();
    expect((await post(request({ ...body, revision }, { headers: { origin: "https://foreign.invalid" } }))).status).toBe(403);
    authenticate.mockResolvedValueOnce({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    expect((await post(request({ ...body, revision }))).status).toBe(401);
    expect((await post(request({ ...body, geminiCredentialVersion: 2, revision }))).status).toBe(409);
    expect((await post(request({ ...body, revision: { ...revision, feedback: keys[owner] } }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("discards a revised draft whose timeline does not match the new duration", async () => {
    const { post, send } = fixture();
    send.mockResolvedValueOnce(provider(script(17)));
    const reply = await post(request({ ...body, config: { ...body.config, durationSec: 30 }, revision }));
    expect(reply.status).toBe(502);
    expect(await reply.json()).toEqual({ code: "invalid_model_response" });
  });
});

// P1-08-SHORTS-SCRIPT-NARRATION-COMPRESS: 원본 v2.01 generateScriptAI의 한 문장 위반 장면 압축 2차 호출.
describe("administrator Shorts script narration compression", () => {
  const twoSentences = ["먼저 컵을 보세요. 그다음 변화가 나와요.", "정말 놀랍죠? 끝까지 보세요!"];
  // 17초 3장면 중 1·3번 나레이션만 두 문장으로 바꾼다.
  const violating = () => {
    const draft = script(17);
    draft.scenes[0].narration = twoSentences[0];
    draft.scenes[2].narration = twoSentences[1];
    return draft;
  };
  const fixed = (...items: [number, string][]) => ({ fixed: items.map(([sceneNumber, narration]) => ({ sceneNumber, narration })) });
  const sentBody = (send: ReturnType<typeof fixture>["send"], call: number) => JSON.parse(String(send.mock.calls[call][1]?.body));
  const narrations = async (reply: Response) => shortsScriptResult.parse(await reply.json()).generation.scenes.map(scene => scene.narration);
  const revision = { feedback: "세 번째 장면을 더 강하게 바꿔 주세요.", previousDurationSec: 17, previousScenes: script(17).scenes };

  it.each([
    ["first draft", body],
    ["revision", { ...body, revision }],
  ])("compresses only violating scenes once for a %s and keeps every other field", async (_label, value) => {
    const { post, send } = fixture();
    const draft = violating();
    send.mockResolvedValueOnce(provider(draft))
      .mockResolvedValueOnce(provider(fixed([1, "컵의 변화를 지금 보세요."], [3, "끝까지 보면 정말 놀라워요!"])));
    const reply = await post(request(value));
    expect(reply.status).toBe(200);
    const result = shortsScriptResult.parse(await reply.json());
    expect(result.generation.scenes).toEqual(draft.scenes.map((scene, index) => index === 0
      ? { ...scene, narration: "컵의 변화를 지금 보세요." }
      : index === 2 ? { ...scene, narration: "끝까지 보면 정말 놀라워요!" } : scene));
    expect(send).toHaveBeenCalledTimes(2);
    const [url, init] = send.mock.calls[1];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(keys[owner]);
    const sent = sentBody(send, 1);
    // 장면 번호와 나레이션만 보낸다(시간·연출·자막·효과음·소재·설정·수정 요청 없음).
    expect(JSON.parse(sent.contents[0].parts[0].text)).toEqual({ scenes: [
      { sceneNumber: 1, narration: twoSentences[0] }, { sceneNumber: 3, narration: twoSentences[1] },
    ] });
    expect(sent.systemInstruction.parts[0].text).toContain("짧은 한 문장으로 압축");
    expect(sent.generationConfig.maxOutputTokens).toBe(512 + 320 * 2);
    for (const hidden of [keys[owner], body.config.direction, body.selectedIdea.title, "정면에서", revision.feedback]) {
      expect(String(init?.body)).not.toContain(hidden);
    }
  });

  it("makes no second call when every narration is one sentence or the first draft is invalid", async () => {
    const { post, send } = fixture();
    const single = script(17);
    single.scenes[1].narration = "3.5배 커졌어요.정말요";
    send.mockResolvedValueOnce(provider(single));
    expect((await post(request())).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);

    const broken = violating();
    broken.scenes[1].startSec += 1;
    send.mockResolvedValueOnce(provider(broken));
    const reply = await post(request());
    expect(reply.status).toBe(502);
    expect(await reply.json()).toEqual({ code: "invalid_model_response" });
    send.mockResolvedValueOnce(provider(violating(), "MAX_TOKENS"));
    expect((await post(request())).status).toBe(502);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["an unrequested scene number", fixed([2, "요청하지 않은 장면이에요."], [3, "끝까지 보면 정말 놀라워요!"]), [twoSentences[0], "두 장면을 비교해 보세요.", "끝까지 보면 정말 놀라워요!"]],
    ["a repeated scene number", fixed([1, "첫 답이에요."], [1, "둘째 답이에요."], [3, "끝까지 보면 정말 놀라워요!"]), [twoSentences[0], "두 장면을 비교해 보세요.", "끝까지 보면 정말 놀라워요!"]],
    ["a still two-sentence answer", fixed([1, "아직 두 문장이에요. 그대로예요."], [3, "끝까지 보면 정말 놀라워요!"]), [twoSentences[0], "두 장면을 비교해 보세요.", "끝까지 보면 정말 놀라워요!"]],
    ["a missing scene", fixed([3, "끝까지 보면 정말 놀라워요!"]), [twoSentences[0], "두 장면을 비교해 보세요.", "끝까지 보면 정말 놀라워요!"]],
    ["a narration over 180 characters", fixed([1, "한".repeat(181)], [3, "끝까지 보면 정말 놀라워요!"]), [twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]],
    ["a scene number beyond 45", fixed([46, "없는 장면이에요."]), [twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]],
    ["an extra key", { ...fixed([1, "컵의 변화를 지금 보세요."]), note: "추가" }, [twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]],
    ["a blank narration", fixed([1, "   "]), [twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]],
    ["an echoed key", fixed([1, keys[owner]]), [twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]],
  ])("keeps the original narration for %s", async (_label, answer, expected) => {
    const { post, send } = fixture();
    send.mockResolvedValueOnce(provider(violating())).mockResolvedValueOnce(provider(answer));
    const reply = await post(request());
    expect(reply.status).toBe(200);
    expect(await narrations(reply)).toEqual(expected);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the valid first draft when the correction fails, without logging provider details", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined));
    try {
      const { post, send } = fixture();
      send.mockResolvedValueOnce(provider(violating())).mockResolvedValueOnce(new Response("private provider failure details", { status: 503 }))
        .mockResolvedValueOnce(provider(violating())).mockRejectedValueOnce(new TypeError("socket closed with private details"))
        .mockResolvedValueOnce(provider(violating())).mockResolvedValueOnce(provider(fixed([1, "한 문장이에요."]), "MAX_TOKENS"))
        .mockResolvedValueOnce(provider(violating())).mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }] }));
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const reply = await post(request());
        expect(reply.status).toBe(200);
        const raw = await reply.text();
        expect(raw).not.toContain("private");
        expect(shortsScriptResult.parse(JSON.parse(raw)).generation.scenes).toEqual(violating().scenes);
      }
      expect(send).toHaveBeenCalledTimes(8);
      for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of logs) spy.mockRestore(); }
  });

  it("measures the remaining budget on the monotonic clock and skips the correction when it is too short", async () => {
    const real = performance.now.bind(performance);
    let shift = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => real() + shift);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const { post, send } = fixture();
      // 1차가 24초 걸린 것처럼: 28 - 24 - 2 = 2초 < 3초 → 건너뜀.
      send.mockImplementationOnce(async () => { shift += 24_000; return provider(violating()); });
      const skipped = await post(request());
      expect(skipped.status).toBe(200);
      expect(await narrations(skipped)).toEqual([twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]);
      expect(send).toHaveBeenCalledTimes(1);

      // 1차가 20초 걸린 것처럼: 28 - 20 - 2 = 6초 서브 마감으로 2차를 보낸다.
      shift = 0;
      timeout.mockClear();
      send.mockImplementationOnce(async () => { shift += 20_000; return provider(violating()); })
        .mockResolvedValueOnce(provider(fixed([1, "컵의 변화를 지금 보세요."])));
      const corrected = await post(request());
      expect(corrected.status).toBe(200);
      expect((await narrations(corrected))[0]).toBe("컵의 변화를 지금 보세요.");
      const budgets = timeout.mock.calls.map(([ms]) => ms);
      expect(budgets[0]).toBe(28_000);
      expect(budgets[1]).toBeGreaterThan(5_900);
      expect(budgets[1]).toBeLessThanOrEqual(6_000);

      // 1차가 빨리 끝나면 자체 상한 8초를 넘지 않는다.
      shift = 0;
      timeout.mockClear();
      send.mockResolvedValueOnce(provider(violating())).mockResolvedValueOnce(provider(fixed([1, "컵의 변화를 지금 보세요."])));
      expect((await post(request())).status).toBe(200);
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([28_000, 8_000]);
    } finally { clock.mockRestore(); timeout.mockRestore(); }
  });

  it("leaves the correction at its sub-deadline even when the provider ignores the abort signal", async () => {
    const original = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => original(ms === 28_000 ? ms : 30));
    try {
      const { post, send } = fixture();
      const ignored = vi.fn();
      send.mockResolvedValueOnce(provider(violating())).mockImplementationOnce(() => { ignored(); return new Promise<Response>(() => undefined); });
      const started = performance.now();
      const reply = await post(request());
      expect(reply.status).toBe(200);
      expect(await narrations(reply)).toEqual([twoSentences[0], "두 장면을 비교해 보세요.", twoSentences[1]]);
      expect(ignored).toHaveBeenCalledOnce();
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally { timeout.mockRestore(); }
  });

  it("keeps the existing cancellation, global deadline and credential replacement checks during the correction", async () => {
    // 상위 요청 중단: 2차 도중 관리자가 요청을 끊으면 499.
    {
      const { post, send } = fixture();
      const controller = new AbortController();
      send.mockResolvedValueOnce(provider(violating()))
        .mockImplementationOnce(() => { controller.abort(); return new Promise<Response>(() => undefined); });
      const reply = await post(request(body, { signal: controller.signal }));
      expect(reply.status).toBe(499);
      expect(await reply.json()).toEqual({ code: "request_cancelled" });
    }
    // 전역 28초 마감: 2차 도중 전체 상한이 지나면 504(1차 결과도 내보내지 않음).
    {
      const deadline = new AbortController();
      const original = AbortSignal.timeout.bind(AbortSignal);
      const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 28_000 ? deadline.signal : original(ms));
      try {
        const { post, send } = fixture();
        send.mockResolvedValueOnce(provider(violating()))
          .mockImplementationOnce(() => { deadline.abort(new DOMException("deadline", "TimeoutError")); return new Promise<Response>(() => undefined); });
        const reply = await post(request());
        expect(reply.status).toBe(504);
        expect(await reply.json()).toEqual({ code: "timed_out" });
      } finally { timeout.mockRestore(); }
    }
    // 최종 키 설정 교체: 2차가 끝난 뒤 버전이 바뀌었으면 409.
    {
      const { post, send, store } = fixture();
      store.metadata.mockResolvedValueOnce([{ ...meta, version: 4 }]);
      send.mockResolvedValueOnce(provider(violating())).mockResolvedValueOnce(provider(fixed([1, "컵의 변화를 지금 보세요."])));
      const reply = await post(request());
      expect(reply.status).toBe(409);
      expect(await reply.json()).toEqual({ code: "stale" });
      expect(send).toHaveBeenCalledTimes(2);
    }
  });

  it.each([
    ["한 문장이에요.", 1], ["먼저 보세요. 그다음이에요.", 2], ["정말? 진짜!", 2], ["와… 대단해", 2], ["3.5배 커졌어요.", 1],
    ["붙어 있어요.공백이 없어요", 1], ["첫째.\n둘째", 2], ["끝。 다음", 2], ["끝！ 다음？ 셋", 3], ["  쉼표, 로 잇기", 1], ["   ", 0],
  ])("counts %j as %i sentence(s) like the original", (text, count) => {
    expect(narrationSentenceCount(text)).toBe(count);
  });
});
