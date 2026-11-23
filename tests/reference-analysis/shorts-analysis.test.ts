import { describe, expect, it, vi } from "vitest";
import {
  SHORTS_ANALYSIS_URI, shortsAnalysisResultSchema, shortsMultiAnalysisResultSchema, youtubeVideoId,
} from "@/lib/reference-analysis/shorts-analysis-contract";
import { allowsMultipleYoutubeVideos, createShortsAnalysisHttp } from "@/lib/reference-analysis/shorts-analysis-http";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.com";
const id = "A1b2C3d4E5_";
const input = { url: `https://www.youtube.com/shorts/${id}?si=removed#excluded`, authorized: true };
const settings = {
  DREAM_SITE_URL: site,
  DREAM_REFERENCE_GEMINI_API_KEY: "test-key",
  DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "gemini-test",
};
const authenticate = async () => ({
  kind: "verified", userId: "10000000-0000-4000-8000-000000000011", email: "admin@example.com",
} as const);

function request(body: unknown = input, origin = site, type = "application/json") {
  return new Request(site + SHORTS_ANALYSIS_URI, {
    method: "POST",
    headers: { host: "studio.example.com", origin, "content-type": type },
    body: JSON.stringify(body),
  });
}

const findings = {
  summary: "컵을 책상에 놓는 장면",
  hook: "처음에 컵을 크게 보여 줌",
  composition: "한 사람과 컵이 보임",
  sound: null,
  segments: [{ timestamp: "00:03", evidence: "컵이 책상에 닿는 장면" }],
  draftPrompt: "컵을 들어 올리는 동작을 측면에서 찍는다.",
};

function modelResponse(output: unknown, finishReason = "STOP") {
  return Response.json({ candidates: [{ finishReason, content: {
    parts: [{ thought: true, text: "ignored" }, { text: JSON.stringify(output) }],
  } }] });
}

describe("Shorts video URLs", () => {
  it.each([
    input.url,
    `https://youtu.be/${id}`,
    `https://m.youtube.com/watch?v=${id}&feature=share`,
  ])("extracts the exact video identifier from %s", url => expect(youtubeVideoId(url)).toBe(id));

  it.each([
    `https://youtube.com.example.net/shorts/${id}`,
    `http://youtube.com/shorts/${id}`,
    `https://user@youtube.com/shorts/${id}`,
    `https://youtube.com/watch?v=${id}&v=A1b2C3d4E50`,
    `https://youtube.com/shorts/${id}/extra`,
  ])("rejects unsupported URL %s", url => expect(youtubeVideoId(url)).toBeNull());
});

describe("Shorts admin analysis route", () => {
  it("reads only configuration status for verified administrators without calling the provider", async () => {
    const provider = vi.fn<typeof fetch>();
    const withConfig = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider });
    const noConfig = createShortsAnalysisHttp({
      authenticate, env: { ...settings, DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "invalid" }, fetch: provider,
    });
    const anonymous = createShortsAnalysisHttp({ authenticate: async () => ({ kind: "local" }), env: settings, fetch: provider });
    const available = await withConfig.get();
    expect(available.status).toBe(200);
    expect(available.headers.get("cache-control")).toBe("no-store");
    expect(await available.json()).toEqual({ semantic: { shorts: "configured" } });
    expect(await (await noConfig.get()).json()).toEqual({ semantic: { shorts: "not_configured" } });
    expect((await anonymous.get()).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it("checks authentication, same origin, request type, rights and URL before calling the provider", async () => {
    const provider = vi.fn<typeof fetch>();
    const anonymous = createShortsAnalysisHttp({ authenticate: async () => ({ kind: "local" }), env: settings, fetch: provider }).post;
    const analyze = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post;
    expect((await anonymous(request())).status).toBe(401);
    expect((await analyze(request(input, "https://other.example.com"))).status).toBe(403);
    expect((await analyze(request(input, site, "text/plain"))).status).toBe(415);
    expect((await analyze(request({ ...input, authorized: false }))).status).toBe(400);
    expect((await analyze(request({ ...input, url: "https://example.com/video" }))).status).toBe(400);
    expect((await analyze(request({ ...input, url: "x".repeat(9_000) }))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports unavailable configuration without fetching the video or a provider", async () => {
    const provider = vi.fn<typeof fetch>();
    const analyze = createShortsAnalysisHttp({ authenticate, env: { DREAM_SITE_URL: site }, fetch: provider }).post;
    const response = await analyze(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("sends only the canonical video reference and validates the returned evidence", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse({ ...findings, privateField: "discard" }));
    const analyze = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post;
    const response = await analyze(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ result: { evidence: "youtube_video", findings } });
    expect(provider).toHaveBeenCalledTimes(1);
    const [endpoint, options] = provider.mock.calls[0];
    expect(endpoint).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body.contents[0].parts[0]).toEqual({ fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } });
    expect(String(options?.body)).not.toContain("removed");
    expect(String(options?.body)).not.toContain("test-key");
  });

  it("keeps provider errors private and rejects incomplete or invalid findings", async () => {
    const provider = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private error details", { status: 400 }))
      .mockResolvedValueOnce(modelResponse(findings, "MAX_TOKENS"))
      .mockResolvedValueOnce(modelResponse({ ...findings, segments: [{ timestamp: "00:99", evidence: "invalid" }] }));
    const analyze = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post;
    for (const error of ["provider_error", "invalid_response", "invalid_response"]) {
      const response = await analyze(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error });
    }
  });
});

// Tester D3: Gemini 거절을 키·권한, 사용 한도, 그 밖의 실패로 나눈다.
// 키 거절은 앱 로그인 거절(401·403)과 섞이지 않게 422로 내리고, 400은 API_KEY_INVALID일 때만 키 거절로 본다. 원문·키는 내보내지 않는다.
describe("Shorts admin analysis provider failure kinds (Tester D3)", () => {
  const keyInvalid = { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. secret-detail",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }] } };
  it.each([
    ["401", () => new Response("denied secret-detail", { status: 401 }), "invalid_key", 422],
    ["403", () => new Response("permission secret-detail", { status: 403 }), "invalid_key", 422],
    ["400 + API_KEY_INVALID", () => Response.json(keyInvalid, { status: 400 }), "invalid_key", 422],
    ["400 그 밖(영상 접근 등)", () => Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "secret-detail" } }, { status: 400 }), "provider_error", 502],
    ["400 JSON 아님", () => new Response("secret-detail", { status: 400 }), "provider_error", 502],
    ["429", () => new Response("quota secret-detail", { status: 429 }), "quota_exceeded", 429],
    ["500", () => new Response("secret-detail", { status: 500 }), "provider_error", 502],
    ["503", () => new Response("secret-detail", { status: 503 }), "provider_error", 502],
  ] as const)("%s → %s", async (_label, reply, error, status) => {
    const provider = vi.fn<typeof fetch>().mockResolvedValueOnce(reply());
    const response = await createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post(request());
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toBe(JSON.stringify({ error }));
    expect(text).not.toContain("secret-detail");
    expect(text).not.toContain("test-key");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

// P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-API: {urls} 1~3개 묶음 분석. 기존 {url} 단건은 위 시험과 아래 보존 시험으로 고정한다.
describe("Shorts admin multi-video analysis", () => {
  const ids = ["A1b2C3d4E5_", "B2c3D4e5F6-", "C3d4E5f6G7h"] as const;
  // 영상마다 다른 별칭 주소 형식을 쓴다(si·feature 같은 추적 값은 Gemini로 가지 않아야 한다).
  const urlsFor = (count: number) => [
    `https://www.youtube.com/shorts/${ids[0]}?si=removed`,
    `https://youtu.be/${ids[1]}`,
    `https://m.youtube.com/watch?v=${ids[2]}&feature=share`,
  ].slice(0, count);
  const multiFindings = (count: number) => ({
    ...findings,
    segments: Array.from({ length: count }, (_, index) => ({ video: index + 1, timestamp: `00:0${index + 1}`, evidence: `영상 ${index + 1}의 첫 동작` })),
  });
  const create = (provider: typeof fetch, model = "gemini-2.5-flash") =>
    createShortsAnalysisHttp({ authenticate, env: { ...settings, DREAM_REFERENCE_SHORTS_GEMINI_MODEL: model }, fetch: provider }).post;
  const sentBody = (provider: ReturnType<typeof vi.fn<typeof fetch>>) => JSON.parse(String(provider.mock.calls[0][1]?.body));

  it.each([1, 2, 3])("sends %i videos in one ordered Gemini request and returns their ids with 1-based sources", async count => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse({
      ...multiFindings(count), privateField: "discard",
      segments: multiFindings(count).segments.map(segment => ({ ...segment, extra: "discard" })),
    }));
    const response = await create(provider)(request({ urls: urlsFor(count), authorized: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ result: { evidence: "youtube_video", videoIds: ids.slice(0, count), findings: multiFindings(count) } });
    expect(shortsMultiAnalysisResultSchema.safeParse(body.result).success).toBe(true);
    // 기존 화면 검사 모양으로 읽어도 깨지지 않는다(새 키만 빠짐).
    const legacy = shortsAnalysisResultSchema.safeParse(body.result);
    expect(legacy.success).toBe(true);
    expect(legacy.data?.findings.segments[0]).toEqual({ timestamp: "00:01", evidence: "영상 1의 첫 동작" });

    expect(provider).toHaveBeenCalledTimes(1);
    const sent = sentBody(provider);
    expect(sent.contents).toHaveLength(1);
    expect(sent.contents[0].parts).toEqual([
      ...ids.slice(0, count).flatMap((id, index) => [
        { text: `[영상 ${index + 1}]` }, { fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } },
      ]),
      { text: `이 영상 ${count}개의 공통 패턴과 영상별 시간대 근거를 분석해 주세요.` },
    ]);
    expect(sent.systemInstruction.parts[0].text).toContain(`공개 YouTube 쇼츠 ${count}개를 함께 분석`);
    expect(sent.systemInstruction.parts[0].text).toContain(`video: 영상 번호(1~${count})`);
    expect(sent.generationConfig).toEqual({ responseMimeType: "application/json", maxOutputTokens: 4096 });
    for (const hidden of ["removed", "feature=share", "youtu.be", "test-key"]) expect(JSON.stringify(sent)).not.toContain(hidden);
  });

  it("keeps the single {url} request, Gemini body and response exactly as before, even on older models", async () => {
    for (const model of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
      const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse({
        ...findings, segments: [{ video: 1, timestamp: "00:03", evidence: "컵이 책상에 닿는 장면" }],
      }));
      const response = await create(provider, model)(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: { evidence: "youtube_video", findings } });
      const sent = sentBody(provider);
      expect(sent.contents).toEqual([{ role: "user", parts: [
        { fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } },
        { text: "이 영상의 내용과 시간대별 근거를 분석해 주세요." },
      ] }]);
      expect(sent.systemInstruction.parts[0].text.startsWith("공개 YouTube 쇼츠를 분석하고 한국어 JSON만 반환하세요.\n")).toBe(true);
      expect(sent.systemInstruction.parts[0].text).not.toContain("video:");
    }
  });

  it.each([
    ["empty list", { urls: [], authorized: true }],
    ["four videos", { urls: [...urlsFor(3), "https://youtu.be/D4e5F6g7H8i"], authorized: true }],
    ["the same video through an alias URL", { urls: [`https://youtu.be/${ids[0]}`, `https://www.youtube.com/watch?v=${ids[0]}`], authorized: true }],
    ["one unsupported URL", { urls: [urlsFor(1)[0], "https://example.com/video"], authorized: true }],
    ["both url and urls", { url: input.url, urls: urlsFor(1), authorized: true }],
    ["missing urls and url", { authorized: true }],
    ["urls as a string", { urls: input.url, authorized: true }],
    ["a number entry", { urls: [urlsFor(1)[0], 7], authorized: true }],
    ["a blank entry", { urls: [urlsFor(1)[0], "  "], authorized: true }],
    ["an entry over 2048 characters", { urls: [`https://youtu.be/${ids[1]}?x=${"a".repeat(2040)}`], authorized: true }],
    ["missing consent", { urls: urlsFor(2) }],
    ["refused consent", { urls: urlsFor(2), authorized: false }],
    ["an extra key", { urls: urlsFor(2), authorized: true, model: "gemini-1.5-pro" }],
    ["an array body", [{ urls: urlsFor(2), authorized: true }]],
  ])("rejects %s with 400 before calling the provider", async (_label, body) => {
    const provider = vi.fn<typeof fetch>();
    const response = await create(provider)(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("checks authentication, origin, content type and size before reading multi-video input", async () => {
    const provider = vi.fn<typeof fetch>();
    const body = { urls: urlsFor(3), authorized: true };
    const anonymous = createShortsAnalysisHttp({ authenticate: async () => ({ kind: "local" }), env: settings, fetch: provider }).post;
    const denied = createShortsAnalysisHttp({
      authenticate: async () => ({ kind: "denied", code: "forbidden", status: 403 }), env: settings, fetch: provider,
    } as unknown as Parameters<typeof createShortsAnalysisHttp>[0]).post;
    expect((await anonymous(request(body))).status).toBe(401);
    expect((await denied(request(body))).status).toBe(403);
    expect((await create(provider)(request(body, "https://other.example.com"))).status).toBe(403);
    expect((await create(provider)(request(body, site, "text/plain"))).status).toBe(415);
    expect((await create(provider)(request({ urls: ["x".repeat(3000), "x".repeat(3000), "x".repeat(3000)], authorized: true }))).status).toBe(413);
    const unconfigured = createShortsAnalysisHttp({ authenticate, env: { DREAM_SITE_URL: site }, fetch: provider }).post;
    const response = await unconfigured(request(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("accepts three maximum-length URLs inside the existing 8 KiB body limit", async () => {
    const long = ids.map(videoId => `https://www.youtube.com/watch?v=${videoId}&x=${"a".repeat(2048 - 46)}`);
    expect(long.every(url => url.length === 2048)).toBe(true);
    const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse(multiFindings(3)));
    const response = await create(provider)(request({ urls: long, authorized: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).result.videoIds).toEqual([...ids]);
    expect(JSON.stringify(sentBody(provider))).not.toContain("aaaa");
  });

  it.each([
    ["video 0", (segments: object[]) => [{ ...segments[0], video: 0 }]],
    ["a video number beyond the request", (segments: object[]) => [...segments, { video: 3, timestamp: "00:04", evidence: "없는 영상" }]],
    ["a missing video number", (segments: object[]) => [{ timestamp: "00:01", evidence: "출처 없음" }, ...segments.slice(1)]],
    ["a string video number", (segments: object[]) => [{ ...segments[0], video: "1" }]],
    ["a fractional video number", (segments: object[]) => [{ ...segments[0], video: 1.5 }]],
    ["more than 12 segments", () => Array.from({ length: 13 }, () => ({ video: 1, timestamp: "00:01", evidence: "많음" }))],
  ])("rejects model output with %s", async (_label, mutate) => {
    const output = multiFindings(2);
    const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse({ ...output, segments: mutate(output.segments) }));
    const response = await create(provider)(request({ urls: urlsFor(2), authorized: true }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "invalid_response" });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["gemini-2.0-flash", "gemini-1.5-pro-002", "gemini-pro", "gemini-2.0-flash-lite"])(
    "returns 422 without calling %s for two or more videos, but still analyzes one", async model => {
      const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse(multiFindings(1)));
      const analyze = create(provider, model);
      for (const count of [2, 3]) {
        const response = await analyze(request({ urls: urlsFor(count), authorized: true }));
        expect(response.status).toBe(422);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ error: "multi_video_unsupported" });
      }
      expect(provider).not.toHaveBeenCalled();
      const single = await analyze(request({ urls: urlsFor(1), authorized: true }));
      expect(single.status).toBe(200);
      expect((await single.json()).result.videoIds).toEqual([ids[0]]);
      expect(provider).toHaveBeenCalledTimes(1);
    });

  it("applies the same model limit to per-owner saved settings", async () => {
    const provider = vi.fn<typeof fetch>();
    const loadSettings = vi.fn(async () => ({ key: "saved-key", model: "gemini-2.0-flash" }));
    const analyze = createShortsAnalysisHttp({ authenticate, env: { DREAM_SITE_URL: site }, fetch: provider, loadSettings }).post;
    const response = await analyze(request({ urls: urlsFor(2), authorized: true }));
    expect(response.status).toBe(422);
    expect(loadSettings).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000011");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ["gemini-2.5-flash", true], ["gemini-2.5-pro-preview-06-05", true], ["gemini-3-pro", true], ["gemini-3.0-flash", true],
    ["models/gemini-2.5-flash", true], ["GEMINI-2.5-FLASH", true], ["gemini-exp-1206", true], ["gemini-10-ultra", true],
    ["gemini-2.0-flash", false], ["gemini-2-flash", false], ["gemini-1.5-flash-002", false], ["gemini-1.0-pro", false],
    ["gemini-pro", false], ["gemini-pro-vision", false], ["gemini-ultra", false],
  ])("judges %s multi-video support as %s", (model, expected) => {
    expect(allowsMultipleYoutubeVideos(model)).toBe(expected);
  });

  it("keeps provider failures private, does not retry, and reports timeouts", async () => {
    const provider = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private quota details for B2c3D4e5F6-", { status: 429 }))
      .mockRejectedValueOnce(new TypeError("socket closed with private details"))
      .mockResolvedValueOnce(modelResponse(multiFindings(2), "MAX_TOKENS"))
      .mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }] }));
    const analyze = create(provider);
    // Tester D3: 공급자 429는 사용 한도(quota_exceeded, 429)로 나눈다. 원문은 여전히 내보내지 않는다.
    for (const [error, status] of [["quota_exceeded", 429], ["provider_error", 502], ["invalid_response", 502], ["invalid_response", 502]] as const) {
      const response = await analyze(request({ urls: urlsFor(2), authorized: true }));
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(JSON.stringify({ error }));
    }
    expect(provider).toHaveBeenCalledTimes(4);

    const expired = AbortSignal.abort(new DOMException("time limit", "TimeoutError"));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(expired);
    try {
      const slow = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
      const response = await create(slow)(request({ urls: urlsFor(3), authorized: true }));
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: "timed_out" });
      expect(timeoutSpy).toHaveBeenCalledWith(110_000);
      expect(slow).toHaveBeenCalledTimes(1);
      // 요청 취소 신호와 묶인 신호가 넘어가므로 같은 객체가 아니라 끊긴 상태인지 본다.
      expect(slow.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(slow.mock.calls[0][1]?.signal?.reason).toBe(expired.reason);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});

// P1-08-SHORTS-DIRECT-TIMEOUT-CANCEL: 화면 취소(영상 변경·이탈)는 공급자 호출과 본문 읽기를 멈추고 499 request_cancelled로 시간 초과(504)와 구분한다.
describe("Shorts admin analysis request cancellation", () => {
  const multiUrls = [`https://www.youtube.com/shorts/${id}`, "https://youtu.be/B2c3D4e5F6-"];
  const multiFindings = { ...findings, segments: [1, 2].map(video => ({ video, timestamp: `00:0${video}`, evidence: `영상 ${video}의 첫 동작` })) };
  const create = (provider: typeof fetch) =>
    createShortsAnalysisHttp({ authenticate, env: { ...settings, DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "gemini-2.5-flash" }, fetch: provider }).post;
  const cancellable = (body: unknown, signal: AbortSignal) => new Request(request(body), { signal });
  const cancelled = JSON.stringify({ error: "request_cancelled" });

  it("does not call Gemini when the request was already cancelled", async () => {
    const provider = vi.fn<typeof fetch>();
    for (const body of [input, { urls: multiUrls, authorized: true }]) {
      const response = await create(provider)(cancellable(body, AbortSignal.abort()));
      expect(response.status).toBe(499);
      expect(await response.text()).toBe(cancelled);
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ["single", input],
    ["multi", { urls: multiUrls, authorized: true }],
  ] as const)("stops the %s Gemini connection when the request is cancelled mid-flight and reports 499, not a timeout", async (_kind, body) => {
    const started = Promise.withResolvers<AbortSignal>();
    const provider = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const signal = init!.signal!;
      started.resolve(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      const controller = new AbortController();
      const pending = create(provider)(cancellable(body, controller.signal));
      const sent = await started.promise;
      expect(sent.aborted).toBe(false);
      controller.abort();
      const response = await pending;
      expect(sent.aborted).toBe(true);
      expect(response.status).toBe(499);
      expect(await response.text()).toBe(cancelled);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(110_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("stops reading the Gemini body when the request is cancelled after the headers arrived", async () => {
    const reading = Promise.withResolvers<void>();
    const encoder = new TextEncoder();
    const stalled = new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(encoder.encode('{"candidates":[')); },
      pull() { reading.resolve(); return new Promise(() => {}); },
    });
    const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response(stalled, { headers: { "content-type": "application/json" } }));
    const controller = new AbortController();
    const pending = create(provider)(cancellable(input, controller.signal));
    await reading.promise;
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(await response.text()).toBe(cancelled);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("never reports success after the request was cancelled, even if Gemini ignores the signal", async () => {
    for (const [body, output] of [[input, findings], [{ urls: multiUrls, authorized: true }, multiFindings]] as const) {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const provider = vi.fn<typeof fetch>().mockImplementation(async () => {
        started.resolve();
        await release.promise;
        return modelResponse(output);
      });
      const controller = new AbortController();
      const pending = create(provider)(cancellable(body, controller.signal));
      await started.promise;
      controller.abort();
      release.resolve();
      const response = await pending;
      expect(response.status).toBe(499);
      const text = await response.text();
      expect(text).toBe(cancelled);
      expect(text).not.toContain("result");
      expect(provider).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps normal single and multi results, and provider failures, unchanged when the request stays open", async () => {
    const provider = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelResponse(findings))
      .mockResolvedValueOnce(modelResponse(multiFindings))
      .mockRejectedValueOnce(new TypeError("socket closed"));
    const controller = new AbortController();
    const single = await create(provider)(cancellable(input, controller.signal));
    expect(single.status).toBe(200);
    expect(await single.json()).toEqual({ result: { evidence: "youtube_video", findings } });
    const multi = await create(provider)(cancellable({ urls: multiUrls, authorized: true }, controller.signal));
    expect(multi.status).toBe(200);
    expect(await multi.json()).toEqual({ result: { evidence: "youtube_video", videoIds: [id, "B2c3D4e5F6-"], findings: multiFindings } });
    const failed = await create(provider)(cancellable(input, controller.signal));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "provider_error" });
    expect(provider).toHaveBeenCalledTimes(3);
    for (const [, init] of provider.mock.calls) expect(init?.signal?.aborted).toBe(false);
  });
});
