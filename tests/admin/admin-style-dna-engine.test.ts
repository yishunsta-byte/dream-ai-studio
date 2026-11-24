import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeRequest, engineBasisText, engineLabel, readEngineCredentials, refineRequest, testRequest } from "@/components/admin/style-dna-client";
import sharp from "sharp";
import { imageSemanticCategories } from "@/lib/reference-analysis/image-semantic-result";
import { styleDnaAnalyze, styleDnaAnalyzeSource, styleDnaImageModels, styleDnaPromptOnlyTargets, styleDnaPromptTargets, styleDnaRefine,
  styleDnaTest, styleDnaTestWithReference } from "@/lib/reference-analysis/style-dna-contract";
import { createStyleDnaHttp } from "@/lib/reference-analysis/style-dna-http";
import { createStyleDnaProvider } from "@/lib/reference-analysis/style-dna-provider";
import { styleDnaEngineCredentialPath } from "@/lib/reference-analysis/style-dna-engine-credential-contract";

// P1-06 이미지 분석·보정 엔진 선택(서버 f2d7e63 계약): 화면이 보내는 본문과 설정 읽기, 실제 실행 엔진 표시.
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const options = { mode: "replicate" as const, guidance: "", mutationLevel: 30, includeImageTag: true, targetModel: "gemini-nano-banana-2.1" as const };
const gemini = { requestId: "0190b0b0-0000-4000-8000-000000000001", credentialVersion: 3 };
const openai = { requestId: "0190b0b0-0000-4000-8000-000000000002", credentialVersion: 2, engine: { provider: "openai" as const, modelId: "gpt-4.1-mini" } };
const claude = { requestId: "0190b0b0-0000-4000-8000-000000000003", credentialVersion: 5, engine: { provider: "anthropic" as const, modelId: "claude-sonnet-4-5" } };
vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllGlobals(); });

describe("P1-06 Style DNA 엔진 선택(화면 쪽)", () => {
  it("Gemini는 engine 없이 이전 본문 그대로, OpenAI·Anthropic은 engine과 그 공급자의 등록 버전을 싣고 서버 스키마를 통과한다", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const plain = JSON.parse(String((analyzeRequest({ kind: "file", file }, options, gemini).body as FormData).get("options")));
    expect(Object.keys(plain)).not.toContain("engine");
    expect(plain.credentialVersion).toBe(3);
    const withEngine = JSON.parse(String((analyzeRequest({ kind: "file", file }, options, openai).body as FormData).get("options")));
    expect(withEngine).toMatchObject({ credentialVersion: 2, engine: { provider: "openai", modelId: "gpt-4.1-mini" } });
    expect(styleDnaAnalyze.safeParse(withEngine).success).toBe(true);
    const byUrl = JSON.parse(String(analyzeRequest({ kind: "url", url: "https://example.com/a.png" }, options, claude).body));
    expect(byUrl).toMatchObject({ credentialVersion: 5, engine: { provider: "anthropic", modelId: "claude-sonnet-4-5" } });
    expect(styleDnaAnalyzeSource.safeParse(byUrl).success).toBe(true);

    expect(Object.keys(JSON.parse(refineRequest({ revision: 1, feedback: "따뜻하게" }, gemini)))).not.toContain("engine");
    const refined = JSON.parse(refineRequest({ revision: 2, feedback: "따뜻하게" }, claude));
    expect(refined).toMatchObject({ revision: 2, credentialVersion: 5, engine: { provider: "anthropic", modelId: "claude-sonnet-4-5" } });
    expect(styleDnaRefine.safeParse(refined).success).toBe(true);
    // 시험 생성은 엔진과 상관없이 Gemini 계약 그대로(engine 칸 없음)
    expect(Object.keys(JSON.parse(testRequest({ revision: 1, model: "gemini-nano-banana-2.1", subject: "", attachImage: true }, gemini)))).not.toContain("engine");
  });

  it("엔진 설정 읽기: 두 공급자 형식이 맞을 때만 쓰고, 실패·형식 오류·끊김은 null(화면은 Gemini만)", async () => {
    const ok = { openai: { configured: true, modelId: "gpt-4.1-mini", version: 2, updatedAt: "2026-11-22T00:00:00.000Z" },
      anthropic: { configured: false, modelId: null, version: 0, updatedAt: null } };
    const fetch = vi.fn(async () => reply(200, { providers: ok }));
    vi.stubGlobal("fetch", fetch);
    await expect(readEngineCredentials()).resolves.toEqual(ok);
    expect(fetch).toHaveBeenCalledWith(styleDnaEngineCredentialPath, expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { providers: { openai: ok.openai } })));
    await expect(readEngineCredentials()).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => reply(503, { code: "storage_unavailable" })));
    await expect(readEngineCredentials()).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(readEngineCredentials()).resolves.toBeNull();
  });

  it("실제 실행 엔진 표시: 기록된 엔진은 공급자·모델·버전, 엔진 칸 없는 이전 기록은 공급자만", () => {
    expect(engineBasisText({ provider: "openai", modelId: "gpt-4.1-mini", credentialVersion: 2 })).toBe("OpenAI · gpt-4.1-mini · 등록 버전 2");
    expect(engineBasisText(undefined)).toBe("Google Gemini · 모델 기록 없음(이전 방식)");
    expect(engineBasisText(undefined, "anthropic")).toBe("Anthropic Claude · 모델 기록 없음(이전 방식)");
    expect([engineLabel("gemini"), engineLabel("openai"), engineLabel("anthropic")]).toEqual(["Google Gemini", "OpenAI", "Anthropic Claude"]);
  });
});

// P1-06-STYLE-DNA-MODEL-OPTIONS-BACKEND(CMD-20261125-011): 분석 프롬프트 대상 목록과 시험 생성(Gemini) 목록 분리.
describe("P1-06 Style DNA 분석 대상 모델 선택지(서버 계약)", () => {
  const promptOnly = ["gpt-image-2.6", "flux-2", "mai-image-2.7", "seedream-5.5", "kling-image-4.0"] as const;
  const testable = ["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image"] as const;
  const origin = "https://studio.example.com";
  const owner = "10000000-0000-4000-8000-000000000011";
  const recordId = "0190b0b0-0000-7000-8000-00000000c001";
  const admin = async () => ({ kind: "verified", userId: owner, email: "admin@example.invalid" } as const);

  it("일곱 개 대상을 한 목록으로 고정하고, 시험 생성 목록은 기존 Gemini 두 개 그대로다", () => {
    expect(styleDnaPromptTargets.map(item => [item.id, item.label, item.vendor, item.testable])).toEqual([
      ["gemini-nano-banana-2.1", "Nano Banana 2.1", "Google", true], ["gemini-3.1-flash-lite-image", "Nano Banana 2 Lite", "Google", true],
      ["gpt-image-2.6", "GPT Image 2.6", "OpenAI", false], ["flux-2", "FLUX.2", "Black Forest Labs", false],
      ["mai-image-2.7", "MAI-Image-2.7", "Microsoft", false], ["seedream-5.5", "Seedream 5.5", "ByteDance", false],
      ["kling-image-4.0", "Kling Image 4.0", "Kuaishou", false],
    ]);
    expect(Object.keys(styleDnaImageModels)).toEqual(testable);
    expect(styleDnaImageModels).toEqual({ "gemini-nano-banana-2.1": { size: "2K", label: "Nano Banana 2.1" },
      "gemini-3.1-flash-lite-image": { size: "1K", label: "Nano Banana 2 Lite" } });
    expect(Object.keys(styleDnaPromptOnlyTargets)).toEqual(promptOnly);
    expect(Object.isFrozen(styleDnaPromptTargets) && styleDnaPromptTargets.every(Object.isFrozen)).toBe(true);
  });

  it("분석·URL 분석 입력은 일곱 대상을 받고, 대상이 없던 이전 본문은 기본 Nano Banana 2.1로 읽는다", () => {
    const base = { requestId: "0190b0b0-0000-4000-8000-000000000011", authorized: true, credentialVersion: 3, mode: "replicate" };
    for (const targetModel of [...testable, ...promptOnly]) {
      expect(styleDnaAnalyze.parse({ ...base, targetModel }).targetModel).toBe(targetModel);
      expect(styleDnaAnalyzeSource.parse({ ...base, targetModel, source: { kind: "url", url: "https://example.com/a.png" },
        engine: { provider: "openai", modelId: "gpt-4.1-mini" } }).targetModel).toBe(targetModel);
    }
    expect(styleDnaAnalyze.parse(base).targetModel).toBe("gemini-nano-banana-2.1");
    // FLUX 3(동영상 모델)은 대상에서 빠졌다(주인님 2026-11-25 FLUX.2로 교체).
    for (const targetModel of ["midjourney-7", "flux-3", "FLUX 3", "FLUX.2", "flux-2 ", "gemini-3-pro-image", ""]) {
      expect(styleDnaAnalyze.safeParse({ ...base, targetModel }).success).toBe(false);
    }
  });

  it("프롬프트 대상 이름은 시험 생성 입력(첨부·직접 참고 이미지 포함)에서 거부한다", () => {
    const test = { requestId: "0190b0b0-0000-4000-8000-000000000012", authorized: true, credentialVersion: 3, revision: 1 };
    for (const model of testable) {
      expect(styleDnaTest.safeParse({ ...test, model }).success).toBe(true);
      expect(styleDnaTestWithReference.safeParse({ ...test, model, customReferenceSha256: "a".repeat(64) }).success).toBe(true);
    }
    for (const model of promptOnly) {
      expect(styleDnaTest.safeParse({ ...test, model }).success).toBe(false);
      expect(styleDnaTestWithReference.safeParse({ ...test, model, customReferenceSha256: "a".repeat(64) }).success).toBe(false);
    }
  });

  it.each(promptOnly)("%s 대상 분석은 지정한 분석 엔진(Gemini) 한 번만 부르고 그 대상의 문법 안내를 지시에 넣는다", async targetModel => {
    const output = { findings: Object.fromEntries(imageSemanticCategories.map(category => [category, { description: `${category} 분석`, basis: "가운데" }])),
      ko: "중앙 배치 사진", en: "A centered photograph", styleDna: { titles: { ko: "중앙 사진", en: "Centered photo" } } };
    const send = vi.fn<typeof fetch>(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(output) }] } }] }));
    const image = Buffer.from(await sharp({ create: { width: 320, height: 240, channels: 3, background: "#336699" } }).png().toBuffer());
    const result = await createStyleDnaProvider(send).analyze({ kind: "file", name: "synthetic.png", bytes: image },
      { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel }, { key: "synthetic-key-only", model: "gemini-3.8-flash" });
    expect([result.semantic.status, result.styleDna?.titles]).toEqual(["ready", { ko: "중앙 사진", en: "Centered photo" }]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0])).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    const request = String(send.mock.calls[0][1]?.body);
    expect(request).toContain(`${styleDnaPromptOnlyTargets[targetModel].label}(${targetModel})용 자연어 프롬프트입니다.`);
    expect(request).toContain("다른 플랫폼 명령행 옵션을 붙이지 마세요.");
    expect(request).not.toContain("synthetic-key-only");
  });

  it("기존 Gemini 대상의 지시 문장은 바뀌지 않는다", async () => {
    const sent: string[] = [];
    const send = vi.fn<typeof fetch>(async (_url, init) => { sent.push(String(init?.body)); return Response.json({}, { status: 500 }); });
    const image = Buffer.from(await sharp({ create: { width: 320, height: 240, channels: 3, background: "#336699" } }).png().toBuffer());
    for (const targetModel of testable) {
      await createStyleDnaProvider(send).analyze({ kind: "file", name: "synthetic.png", bytes: image },
        { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel }, { key: "k", model: "gemini-3.8-flash" }).catch(() => undefined);
    }
    expect(sent[0]).toContain("gemini-nano-banana-2.1용 자연어 프롬프트입니다. 한 문단에서 구도, 재질, 세부 조명과 시각적 요소의 관계를 구체적으로 묘사하세요.");
    expect(sent.at(-1)).toContain("gemini-3.1-flash-lite-image용 자연어 프롬프트입니다. 짧고 직접적인 한 문단에 피사체, 구도, 조명과 스타일의 우선순위를 분명히 하세요.");
  });

  function http(engineStore: unknown, list = vi.fn(async () => [])) {
    const store = { list, get: vi.fn(async () => undefined) };
    const credentials = { metadata: vi.fn(async () => [{ group: "reference", version: 3, models: { image: "gemini-3.8-flash" } }]) };
    return { store, http: createStyleDnaHttp({ authenticate: admin, env: { DREAM_SITE_URL: origin }, store: () => store as never,
      credentials: () => credentials as never, engineCredentials: () => engineStore as never }) };
  }

  it("설정 응답에 같은 대상 목록과 세 분석 엔진의 정확한 설정 상태를 키 없이 준다", async () => {
    const openai = { configured: true, modelId: "gpt-4.1-mini", version: 2, updatedAt: "2026-11-25T00:00:00.000Z" };
    const ready = await (await http({ metadata: vi.fn(async () => ({ openai })) }).http.list()).json();
    expect(ready.settings).toEqual({ storage: "ready", credentialVersion: 3, analysisModel: "gemini-3.8-flash",
      testModels: Object.entries(styleDnaImageModels).map(([id, info]) => ({ id, ...info })),
      promptTargets: JSON.parse(JSON.stringify(styleDnaPromptTargets)),
      analysisEngines: [{ provider: "gemini", configured: true, modelId: "gemini-3.8-flash", version: 3 },
        { provider: "openai", configured: true, modelId: "gpt-4.1-mini", version: 2 },
        { provider: "anthropic", configured: false, modelId: null, version: 0 }],
      engineStorage: "ready" });
    expect(JSON.stringify(ready)).not.toMatch(/apiKey|ciphertext|updatedAt/);

    const none = await (await http(null).http.list()).json();
    expect([none.settings.engineStorage, none.settings.analysisEngines.map((item: { configured: boolean }) => item.configured)])
      .toEqual(["not_configured", [true, false, false]]);
    const failing = await http({ metadata: vi.fn(async () => { throw new Error("engine storage down"); }) }).http.list();
    expect(failing.status).toBe(200);
    expect((await failing.json()).settings.engineStorage).toBe("unavailable");
  });

  it.each(promptOnly)("시험 생성 경로는 %s를 입력 단계에서 거부하고 기록·공급자를 열지 않는다", async model => {
    const harness = http(null);
    const request = new Request(`${origin}/api/admin/style-dna/${recordId}/test`, { method: "POST",
      headers: { origin, host: new URL(origin).host, "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ requestId: "0190b0b0-0000-4000-8000-000000000013", authorized: true, credentialVersion: 3, revision: 1, model }) });
    const response = await harness.http.test(request, { params: Promise.resolve({ id: recordId }) });
    expect(response.status).toBe(400);
    expect(harness.store.get).not.toHaveBeenCalled();
  });
});
