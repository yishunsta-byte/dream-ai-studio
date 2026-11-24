import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createAdminReferenceHttp } from "../../lib/reference-analysis/admin-reference-http";
import { createGeminiImageAnalysis, geminiImageAnalyzer } from "../../lib/reference-analysis/image-semantic-gemini";
import { imageSemanticCategories } from "../../lib/reference-analysis/image-semantic-result";
import { referenceUploadByteLimit } from "../../lib/reference-analysis/input";
import { analyzeLocalMediaUpload, analyzeLocalMediaUrl } from "../../lib/reference-analysis/local-media-url";
import { createStyleDnaProvider } from "../../lib/reference-analysis/style-dna-provider";

vi.mock("server-only", () => ({}));

const origin = "https://studio.example.com";
const endpoint = `${origin}/api/admin/reference-analysis`;
const publicImage = "https://mdn.github.io/synthetic.png";
const privateKey = "synthetic-key-only";
const versionedModel = "gemini-3.8-flash";
const environment = {
  DREAM_SITE_URL: origin,
  DREAM_REFERENCE_GEMINI_API_KEY: privateKey,
  DREAM_REFERENCE_GEMINI_MODEL: versionedModel,
};
const adminOptions = {
  authenticate: async () => ({ kind: "verified", userId: "10000000-0000-4000-8000-000000000011", email: "admin@example.com" } as const),
  analyze: analyzeLocalMediaUrl, analyzeUpload: analyzeLocalMediaUpload,
};

async function syntheticImage() {
  return new Uint8Array(await sharp({ create: { width: 1920, height: 16, channels: 3, background: "#2867ac" } })
    .withExif({ IFD0: { Artist: "Synthetic metadata" } }).png().toBuffer());
}

function upload(bytes: Uint8Array<ArrayBuffer>, options: { media?: string; semantic?: string; origin?: string } = {}) {
  const headers = new Headers({
    host: new URL(origin).host, origin: options.origin ?? origin, "content-type": "application/octet-stream",
    "x-dream-filename": "synthetic.png", "x-dream-media": options.media ?? "image",
  });
  if (options.semantic) headers.set("x-dream-semantic", options.semantic);
  return new Request(endpoint, { method: "POST", headers, body: bytes });
}

function directJson(options: Record<string, unknown>) {
  return new Request(endpoint, {
    method: "POST", headers: { host: new URL(origin).host, origin, "content-type": "application/json" },
    body: JSON.stringify({ url: publicImage, authorized: true, media: "image", ...options }),
  });
}

function candidate(value: unknown) {
  return Response.json({ candidates: [{
    finishReason: "STOP",
    content: { parts: [{ thought: true, text: "private model reasoning" }, { text: JSON.stringify(value) }] },
  }] });
}

describe("관리자 Style DNA 이미지 의미 분석", () => {
  it("Style DNA 최초 분석은 원본처럼 전체 280초 기한만 쓰고 일반 이미지 분석은 15초를 유지한다", async () => {
    const bytes = Buffer.from(await syntheticImage());
    const send = vi.fn<typeof fetch>(async () => candidate({
      findings: Object.fromEntries(imageSemanticCategories.map(category =>
        [category, { description: `${category} 분석`, basis: "가운데 위치" }])),
      ko: "중앙에 배치한 사진", en: "A photograph with centered composition",
    }));
    const config = { key: privateKey, model: versionedModel };
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      await expect(geminiImageAnalyzer(config, send)(bytes, new AbortController().signal)).resolves.toMatchObject({ status: "ready" });
      expect(timeout).toHaveBeenCalledWith(15_000);
      timeout.mockClear();

      await expect(createStyleDnaProvider(send).analyze({ kind: "file", name: "synthetic.png", bytes }, {
        mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel: "gemini-nano-banana-2.1",
      }, config)).resolves.toMatchObject({ semantic: { status: "ready" } });
      expect(timeout).toHaveBeenCalledWith(280_000);
      // 옛 짧은 제한(Gemini 15초·45초, 전체 60초)은 Style DNA 최초 분석에서 쓰지 않는다.
      expect(timeout.mock.calls.map(([ms]) => ms)).not.toEqual(expect.arrayContaining([15_000]));
      expect(timeout.mock.calls.map(([ms]) => ms)).not.toEqual(expect.arrayContaining([45_000]));
      expect(timeout.mock.calls.map(([ms]) => ms)).not.toEqual(expect.arrayContaining([60_000]));
    } finally {
      timeout.mockRestore();
    }
  });

  it("기존 파일 응답은 외부 호출 없이 유지하고 요청한 파일만 리사이즈해 전송한다", async () => {
    const modelResult = {
      findings: Object.fromEntries(imageSemanticCategories.map(category =>
        [category, { description: `${category} 분석`, basis: "왼쪽 위", certainty: "observed" }])),
      ko: "파란 조명과 여백을 강조한 사진",
      en: "A photograph with blue lighting and negative space",
    };
    const send = vi.fn<typeof fetch>(async () => candidate(modelResult));
    const admin = createAdminReferenceHttp({ ...adminOptions, env: environment, analyzeImageSemantics: createGeminiImageAnalysis(environment, send) });
    const bytes = await syntheticImage();
    const baseline = await (await admin.analyze(upload(bytes))).json();
    expect(Object.keys(baseline)).toEqual(["result"]);
    expect(send).not.toHaveBeenCalled();
    const capabilities = await admin.capabilities(new Request(endpoint));
    expect(await capabilities.json()).toEqual({ semantic: { image: "configured" } });
    expect(capabilities.headers.get("cache-control")).toBe("no-store");
    expect(send).not.toHaveBeenCalled();

    const response = await admin.analyze(upload(bytes, { semantic: "image" }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result).toEqual(baseline.result);
    expect(payload.semantic).toEqual({
      status: "ready", provider: "gemini", findings: imageSemanticCategories.map(category =>
        ({ category, certainty: "estimated", description: `${category} 분석`, basis: "왼쪽 위" })),
      prompts: { ko: modelResult.ko, en: modelResult.en },
    });
    expect(JSON.stringify(payload)).not.toContain(privateKey);
    expect(send).toHaveBeenCalledOnce();
    const [destination, request] = send.mock.calls[0];
    expect(destination).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${versionedModel}:generateContent`);
    expect(request).toMatchObject({ redirect: "error", headers: { "x-goog-api-key": privateKey } });
    const body = JSON.parse(String(request?.body));
    const { inlineData } = body.contents[0].parts[1];
    expect(inlineData.mimeType).toBe("image/webp");
    const metadata = await sharp(Buffer.from(inlineData.data, "base64")).metadata();
    expect(metadata).toMatchObject({ width: 1600, format: "webp" });
    expect(metadata.exif).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(privateKey);
  });

  it("검증된 URL의 부분 응답과 제공자 오류에도 관찰값을 보존한다", async () => {
    const bytes = await syntheticImage();
    const send = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => candidate({
        findings: { objects: { description: "파란 소품", basis: "중앙" }, actions: { description: "불완전" } },
        ko: "파란색 소품 사진",
      }))
      .mockImplementationOnce(async () => new Response(`provider detail ${privateKey}`, { status: 401 }))
      .mockImplementationOnce(async () => Response.json({ candidates: [{ finishReason: "SAFETY" }] }));
    const admin = createAdminReferenceHttp({ ...adminOptions, env: environment, analyzeImageSemantics: createGeminiImageAnalysis(environment, send) });
    const download = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", download);
    try {
      const baseline = await (await admin.analyze(directJson({}))).json();
      expect(send).not.toHaveBeenCalled();
      const partial = await (await admin.analyze(directJson({ semantic: "image" }))).json();
      expect(partial.result).toEqual(baseline.result);
      expect(partial.semantic).toMatchObject({ status: "partial", provider: "gemini", prompts: { ko: "파란색 소품 사진" } });
      expect(Object.keys(partial.semantic.prompts)).toEqual(["ko"]);
      expect(partial.semantic.findings).toContainEqual({ category: "actions", certainty: "unconfirmed" });
      expect(partial.semantic.findings).toContainEqual({ category: "objects", certainty: "estimated", description: "파란 소품", basis: "중앙" });
      for (const reason of ["provider_error", "invalid_response"]) {
        const failed = await admin.analyze(directJson({ semantic: "image" }));
        expect(failed.status).toBe(200);
        expect(await failed.json()).toEqual({ ...baseline, semantic: { status: "unavailable", reason } });
      }
      expect(download).toHaveBeenCalledTimes(4);
      expect(send).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("권한·출처·파일 검증·크기·키 설정에서 막힌 요청은 외부 모델을 호출하지 않는다", async () => {
    const bytes = await syntheticImage();
    const send = vi.fn<typeof fetch>();
    const options = { ...adminOptions, env: environment, analyzeImageSemantics: createGeminiImageAnalysis(environment, send) };
    const anonymous = createAdminReferenceHttp({ ...options, authenticate: async () => ({ kind: "local" }) });
    const admin = createAdminReferenceHttp(options);
    expect((await anonymous.capabilities(new Request(endpoint))).status).toBe(401);
    expect((await anonymous.analyze(upload(bytes, { semantic: "image" }))).status).toBe(401);
    expect((await admin.analyze(upload(bytes, { semantic: "image", origin: "https://other.example.com" }))).status).toBe(403);
    expect((await admin.analyze(directJson({ semantic: "image", authorized: false }))).status).toBe(400);
    expect((await admin.analyze(directJson({ semantic: "image", url: "https://other.example.com/image.png" }))).status).toBe(422);
    expect((await admin.analyze(directJson({ semantic: "image", media: "video" }))).status).toBe(400);
    expect((await admin.analyze(upload(bytes, { semantic: "other" }))).status).toBe(400);
    expect((await admin.analyze(upload(bytes, { semantic: "image", media: "music" }))).status).toBe(400);
    expect((await admin.analyze(upload(new Uint8Array([0]), { semantic: "image" }))).status).toBe(422);
    expect((await admin.analyze(upload(new Uint8Array(referenceUploadByteLimit + 1), { semantic: "image" }))).status).toBe(413);
    const missing = createAdminReferenceHttp({
      ...options, env: { DREAM_SITE_URL: origin },
      analyzeImageSemantics: createGeminiImageAnalysis({ DREAM_REFERENCE_GEMINI_MODEL: environment.DREAM_REFERENCE_GEMINI_MODEL }, send),
    });
    const response = await missing.analyze(upload(bytes, { semantic: "image" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { status: "ready", media: "image" },
      semantic: { status: "unavailable", reason: "not_configured" },
    });
    expect(await (await missing.capabilities(new Request(endpoint))).json()).toEqual({ semantic: { image: "not_configured" } });
    const invalidEnv = { ...environment, DREAM_REFERENCE_GEMINI_MODEL: "gemini-3.8-flash/other" };
    const invalid = createAdminReferenceHttp({ ...options, env: invalidEnv, analyzeImageSemantics: createGeminiImageAnalysis(invalidEnv, send) });
    expect(await (await invalid.capabilities(new Request(endpoint))).json()).toEqual({ semantic: { image: "not_configured" } });
    expect(await (await invalid.analyze(upload(bytes, { semantic: "image" }))).json()).toMatchObject({
      semantic: { status: "unavailable", reason: "not_configured" },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("모델 호출 제한 시간이 끝나면 관찰 결과와 재시도 가능한 상태를 돌려준다", async () => {
    const attempt = new AbortController();
    const builtInTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockImplementation(ms => ms === 15_000 ? attempt.signal : builtInTimeout(ms));
    const send = vi.fn<typeof fetch>(async (_url, options) => {
      attempt.abort(new DOMException("Fixture deadline", "TimeoutError"));
      options?.signal?.throwIfAborted();
      throw new Error("Missing provider deadline");
    });
    const admin = createAdminReferenceHttp({ ...adminOptions, env: environment, analyzeImageSemantics: createGeminiImageAnalysis(environment, send) });
    try {
      const response = await admin.analyze(upload(await syntheticImage(), { semantic: "image" }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: { status: "ready", media: "image" },
        semantic: { status: "unavailable", reason: "timed_out" },
      });
      expect(send).toHaveBeenCalledOnce();
    } finally {
      timeout.mockRestore();
    }
  });
});

describe("Style DNA 렌즈·초점 거리 시각 추정", () => {
  const options = { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel: "gemini-nano-banana-2.1" } as const;
  const lens = { description: "광각(약 24~35mm 상당) 추정", basis: "가장자리 원근 왜곡이 크고 배경이 넓게 보임" };
  const focusDistance = { description: "근거리(약 1m 이내) 추정", basis: "인물 상반신이 화면을 채우고 배경이 강하게 흐림" };
  const angle = { description: "눈높이", basis: "수평선이 화면 가운데" };
  const output = (camera: Record<string, unknown>) => ({
    findings: Object.fromEntries(imageSemanticCategories.map(category => [category, { description: `${category} 분석`, basis: "가운데 위치" }])),
    ko: "중앙에 배치한 사진", en: "A photograph with centered composition",
    styleDna: { titles: { ko: "근접 광각 인물", en: "Close wide portrait" }, camera },
  });
  const external = (provider: "openai" | "anthropic") => ({ key: privateKey, model: `${provider}-fixture`, provider, isCurrent: async () => true });
  const engines = [
    ["gemini", (value: unknown) => candidate(value), { key: privateKey, model: versionedModel }],
    ["openai", (value: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }), external("openai")],
    ["anthropic", (value: unknown) => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] }), external("anthropic")],
  ] as const;
  type Settings = Parameters<ReturnType<typeof createStyleDnaProvider>["analyze"]>[2];
  const analyze = async ([, reply, settings]: readonly [string, (value: unknown) => Response, Settings], camera: Record<string, unknown>) => {
    const send = vi.fn<typeof fetch>(async () => reply(output(camera)));
    const result = await createStyleDnaProvider(send).analyze({ kind: "file", name: "synthetic.png", bytes: Buffer.from(await syntheticImage()) }, options, settings);
    return { result, request: String(send.mock.calls[0][1]?.body) };
  };

  it.each(engines)("%s 완료 응답의 두 칸을 근거 있는 추정으로 저장하고 그대로 다시 읽는다", async (name, reply, settings) => {
    const { result, request } = await analyze([name, reply, settings], { angle, lens, focusDistance });
    expect(result.styleDna?.camera).toEqual({ angle: { certainty: "estimated", ...angle }, lens: { certainty: "estimated", ...lens },
      focusDistance: { certainty: "estimated", ...focusDistance } });
    // 공통 지시와 출력 계약: 화각·환산 초점거리와 피사체 초점 거리를 구분하고 범위·정성 추정과 근거를 요구한다.
    for (const phrase of ["35mm 환산 초점거리", "렌즈 초점거리(mm)가 아니라 카메라에서 초점이 맞은 피사체까지의 거리", "단일 수치를 실측값처럼 쓰지 말고",
      "실제 렌즈를 알 수 없는 경우", "렌즈 화각과 35mm 환산 초점거리의 범위 또는 정성 추정", "카메라에서 초점이 맞은 피사체까지 거리의 범위 또는 정성 추정"]) expect(request).toContain(phrase);
    expect(request).not.toContain(privateKey);
    // 저장(jsonb)과 재조회는 기록 문서를 그대로 돌려준다.
    expect(JSON.parse(JSON.stringify({ styleDna: result.styleDna }))).toEqual({ styleDna: result.styleDna });
    expect(result.original).toMatchObject({ width: 1600, mime: "image/webp" });
  });

  it.each([
    ["실측처럼 쓴 단일 수치", { description: "50mm", basis: "인물 비율" }, { description: "1.2m", basis: "인물 크기" }],
    ["메타데이터를 근거로 든 값", { description: "EXIF 기준 약 35mm", basis: "촬영 정보" }, { description: "약 2m", basis: "메타데이터에 따르면 2m" }],
    ["근거 없는 값", { description: "광각 추정" }, { description: "근거리 추정", basis: "" }],
  ])("%s는 추정으로 표시하지 않는다", async (_label, badLens, badFocus) => {
    for (const engine of engines) {
      const { result } = await analyze(engine, { angle, lens: badLens, focusDistance: badFocus });
      expect(result.styleDna?.camera).toEqual({ angle: { certainty: "estimated", ...angle }, lens: { certainty: "unconfirmed" }, focusDistance: { certainty: "unconfirmed" } });
    }
  });

  it("범위·정성 표현은 그대로 두고, 단서가 없어 생략한 칸은 만들지 않으며 다른 칸의 기존 해석은 바꾸지 않는다", async () => {
    const qualitative = { lens: { description: "표준 화각 정도", basis: "원근 왜곡이 거의 없음" }, focusDistance: { description: "중거리, 2~5m 사이", basis: "전신이 화면에 들어옴" } };
    const { result } = await analyze(engines[0], { angle, shotType: { description: "50mm 렌즈 느낌의 미디엄 샷", basis: "허리 위 구도" }, ...qualitative });
    expect(result.styleDna?.camera).toEqual({ angle: { certainty: "estimated", ...angle },
      shotType: { certainty: "estimated", description: "50mm 렌즈 느낌의 미디엄 샷", basis: "허리 위 구도" },
      lens: { certainty: "estimated", ...qualitative.lens }, focusDistance: { certainty: "estimated", ...qualitative.focusDistance } });
  });

  it.each(engines)("%s: 단서가 부족하거나 실제 렌즈를 알 수 없어 모델이 생략한 두 칸은 빈칸(미확인)으로 남는다", async (name, reply, settings) => {
    const { result } = await analyze([name, reply, settings], { angle });
    expect(result.styleDna?.camera).toEqual({ angle: { certainty: "estimated", ...angle } });
    expect(result.styleDna?.camera).not.toHaveProperty("lens");expect(result.styleDna?.camera).not.toHaveProperty("focusDistance");
  });
});
