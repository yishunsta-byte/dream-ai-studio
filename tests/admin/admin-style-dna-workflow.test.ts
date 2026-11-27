import { afterEach, describe, expect, it, vi } from "vitest";
import { modeText, mutationStage } from "@/components/admin/admin-style-dna-workflow";
import {
  analyzeRequest, analyzeStyleDna, generationText, needsSubject, paletteProximity, readGeneration, readStyleDnaLibrary, readStyleDnaRecord, refineRequest, refineStyleDna,
  isBoundTest, readGenerationEstimate, readStyleDnaGeneration, styleDnaGenerationChoices, testRequest, testStyleDna, testUploadRequest, usdText,
} from "@/components/admin/style-dna-client";
import {
  styleDnaAnalyze, styleDnaAnalyzeSource, styleDnaGeneratedTest, styleDnaGeneratedTestWithReference, styleDnaRefine, styleDnaResultModelLabel, styleDnaTest,
} from "@/lib/reference-analysis/style-dna-contract";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const op = { requestId: "0190b0b0-0000-4000-8000-000000000001", credentialVersion: 3 };
const options = { mode: "mutate" as const, guidance: "조명 집중", mutationLevel: 55, includeImageTag: true, targetModel: "gemini-3.1-flash-lite-image" as const };
const media = { mime: "image/webp", width: 640, height: 400, sha256: "a".repeat(64), palette: [{ hex: "#1f6f6a", share: 1 }], href: "/x" };
const record = (revisions = 1) => ({ id: "0190b0b0-0000-7000-8000-00000000b001", title: "t", revision: revisions, mode: "replicate", original: media,
  createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z", options, result: {}, semantic: {},
  revisions: Array.from({ length: revisions }, (_, index) => ({ revision: index + 1, prompts: { en: "e", ko: "k" }, createdAt: "2026-11-21T00:00:00.000Z" })), tests: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("P1-06 Style DNA 작업실(화면 쪽 통신)", () => {
  it("분석 본문: 파일은 file·options 두 칸 FormData, 주소·기록 재분석은 JSON이고 모두 서버 계약 스키마를 통과한다", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const form = analyzeRequest({ kind: "file", file }, options, op);
    expect(form.json).toBe(false);
    const data = form.body as FormData;
    expect([...data.keys()]).toEqual(["file", "options"]);
    expect(styleDnaAnalyze.safeParse(JSON.parse(String(data.get("options")))).success).toBe(true);
    expect(JSON.parse(String(data.get("options")))).toEqual({ requestId: op.requestId, authorized: true, credentialVersion: 3, ...options });
    const byUrl = analyzeRequest({ kind: "url", url: " https://example.com/a.png " }, options, op);
    expect(JSON.parse(String(byUrl.body)).source).toEqual({ kind: "url", url: "https://example.com/a.png" });
    expect(styleDnaAnalyzeSource.safeParse(JSON.parse(String(byUrl.body))).success).toBe(true);
    const byRecord = analyzeRequest({ kind: "record", id: "0190b0b0-0000-7000-8000-00000000b001" }, options, op);
    expect(styleDnaAnalyzeSource.safeParse(JSON.parse(String(byRecord.body))).success).toBe(true);
    expect(byRecord.size).toBe(new TextEncoder().encode(String(byRecord.body)).length);
  });

  it("보정·시험 본문은 계약 스키마를 통과하고, 비율은 고른 때만 담는다", () => {
    expect(styleDnaRefine.safeParse(JSON.parse(refineRequest({ revision: 2, feedback: " 더 따뜻하게 " }, op)))).toMatchObject({ success: true, data: { feedback: "더 따뜻하게" } });
    const auto = JSON.parse(testRequest({ revision: 1, model: "gemini-nano-banana-2.1", subject: " cat ", attachImage: true }, op));
    expect(Object.keys(auto)).not.toContain("aspectRatio");
    expect(styleDnaTest.safeParse(auto)).toMatchObject({ success: true, data: { subject: "cat" } });
    expect(JSON.parse(testRequest({ revision: 1, model: "gemini-nano-banana-2.1", subject: "", attachImage: false, aspectRatio: "9:16" }, op)).aspectRatio).toBe("9:16");
  });

  it("202는 같은 본문으로 다시 물어보고, 끊김은 lost, 오류 코드는 그대로, 401·403은 로그인·권한으로 나눈다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(202, { code: "in_progress" })).mockResolvedValueOnce(reply(201, { record: record() }));
    vi.stubGlobal("fetch", fetchMock);
    const request = analyzeRequest({ kind: "url", url: "https://example.com/a.png" }, options, op);
    expect(await analyzeStyleDna(request, { wait: 1 })).toMatchObject({ kind: "ok", value: { id: "0190b0b0-0000-7000-8000-00000000b001" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(202, { code: "in_progress" })));
    expect(await analyzeStyleDna(request, { wait: 1, polls: 2 })).toEqual({ kind: "error", code: "in_progress", status: 202 });
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(reply(409, { code: "stale_credential" }))
      .mockResolvedValueOnce(reply(502, { code: "weird" })).mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(403, {}))
      .mockResolvedValueOnce(reply(400, { code: "subject_required" })));
    expect(await analyzeStyleDna(request)).toEqual({ kind: "lost" });
    expect(await analyzeStyleDna(request)).toEqual({ kind: "error", code: "stale_credential", status: 409 });
    expect(await analyzeStyleDna(request)).toEqual({ kind: "error", code: "failed", status: 502 });
    expect(await analyzeStyleDna(request)).toEqual({ kind: "login" });
    expect(await analyzeStyleDna(request)).toEqual({ kind: "forbidden" });
    expect(await testStyleDna("x", "{}", 1)).toEqual({ kind: "error", code: "subject_required", status: 400 });
  });

  it("보정은 기대한 새 버전이 든 기록만, 시험은 고른 버전의 결과만 성공으로 본다", async () => {
    const rid = "0190b0b0-0000-7000-8000-00000000b001";
    const bound = (revision: number) => ({ id: "t", revision, image: { ...media, href: `/api/admin/style-dna/${rid}/media/t` },
      original: { ...media, href: `/api/admin/style-dna/${rid}/media/original` } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(201, { record: record(2) })).mockResolvedValueOnce(reply(201, { record: record(1) }))
      .mockResolvedValueOnce(reply(201, { test: bound(2) }))
      .mockResolvedValueOnce(reply(201, { test: bound(1) })));
    expect(await refineStyleDna("0190b0b0-0000-7000-8000-00000000b001", "{}", 2)).toMatchObject({ kind: "ok" });
    expect(await refineStyleDna("0190b0b0-0000-7000-8000-00000000b001", "{}", 2)).toEqual({ kind: "error", code: "failed", status: 201 });
    expect(await testStyleDna(rid, "{}", 2)).toMatchObject({ kind: "ok", value: { revision: 2 } });
    expect(await testStyleDna(rid, "{}", 2)).toEqual({ kind: "error", code: "failed", status: 201 });
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(() => { controller.abort(); return Promise.reject(new DOMException("aborted", "AbortError")); }));
    await expect(testStyleDna("x", "{}", 1, { signal: controller.signal })).rejects.toThrow();
  });

  it("게이트웨이 504 뒤에는 같은 분석 요청을 확인하고 앱의 시간 초과는 결과가 확정된 오류로 처리한다", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Gateway timeout", { status: 504 }))
      .mockResolvedValueOnce(reply(201, { record: record() }))
      .mockResolvedValueOnce(reply(504, { code: "timed_out" }));
    vi.stubGlobal("fetch", fetchMock);
    const request = analyzeRequest({ kind: "url", url: "https://example.com/a.png" }, options, op);

    await expect(analyzeStyleDna(request)).resolves.toEqual({ kind: "lost" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(analyzeStyleDna(request)).resolves.toMatchObject({ kind: "ok" });
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    await expect(analyzeStyleDna(request)).resolves.toEqual({ kind: "error", code: "timed_out", status: 504 });
  });

  it("보관함·기록 읽기: 설정·로그인·저장소 없음·다른 기록 ID를 나눈다", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply(200, { items: [], settings: { storage: "ready", credentialVersion: 3, analysisModel: "m", testModels: [] } }))
      .mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(503, { code: "storage_unavailable" })).mockResolvedValueOnce(reply(200, { items: [] }))
      .mockResolvedValueOnce(reply(200, { record: record() })).mockResolvedValueOnce(reply(200, { record: { ...record(), id: "other" } }))
      .mockResolvedValueOnce(reply(404, { code: "not_found" })));
    expect(await readStyleDnaLibrary()).toMatchObject({ kind: "ok", settings: { credentialVersion: 3 } });
    expect(await readStyleDnaLibrary()).toEqual({ kind: "login" });
    expect(await readStyleDnaLibrary()).toEqual({ kind: "unavailable" });
    expect(await readStyleDnaLibrary()).toEqual({ kind: "failed" });
    expect(await readStyleDnaRecord("0190b0b0-0000-7000-8000-00000000b001")).toMatchObject({ kind: "ok" });
    expect(await readStyleDnaRecord("0190b0b0-0000-7000-8000-00000000b001")).toEqual({ kind: "error", code: "failed", status: 200 });
    expect(await readStyleDnaRecord("0190b0b0-0000-7000-8000-00000000b001")).toEqual({ kind: "error", code: "not_found", status: 404 });
  });

  it("보관함 설정: 새 대상 목록·엔진 상태 칸을 그대로 받고, 그 칸이 없는 이전 응답도 그대로 읽는다(CMD-20261125-011)", async () => {
    const settings = { storage: "ready", credentialVersion: 3, analysisModel: "m", testModels: [{ id: "gemini-nano-banana-2.1", size: "2K", label: "Nano Banana 2.1" }],
      promptTargets: [{ id: "flux-2", label: "FLUX.2", vendor: "Black Forest Labs", testable: false }],
      analysisEngines: [{ provider: "gemini", configured: true, modelId: "m", version: 3 }, { provider: "openai", configured: false, modelId: null, version: 0 },
        { provider: "anthropic", configured: false, modelId: null, version: 0 }], engineStorage: "ready" };
    const old = { storage: "ready", credentialVersion: 2, analysisModel: null, testModels: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(200, { items: [], settings })).mockResolvedValueOnce(reply(200, { items: [], settings: old })));
    expect(await readStyleDnaLibrary()).toEqual({ kind: "ok", items: [], settings });
    expect(await readStyleDnaLibrary()).toEqual({ kind: "ok", items: [], settings: old });
  });

  it("색 근접도·피사체 자리·변형 단계 표시", () => {
    const palette = [{ hex: "#1f6f6a", share: 0.6 }, { hex: "#e8d5b0", share: 0.4 }];
    expect(paletteProximity(palette, palette)).toBe(100);
    expect(paletteProximity([{ hex: "#000000", share: 1 }], [{ hex: "#ffffff", share: 1 }])).toBe(0);
    expect(paletteProximity([], palette)).toBeNull();
    expect(needsSubject("A portrait of [INSERT SUBJECT HERE]")).toBe(true);
    expect(needsSubject("[피사체 입력]을 도심에서")).toBe(true);
    expect(needsSubject("A city at night")).toBe(false);
    expect([mutationStage(30).label, mutationStage(31).label, mutationStage(71).label]).toEqual(["안정", "조화", "파격"]);
    expect(modeText({ mode: "mutate", options: { ...options, mutationLevel: 80 } })).toBe("스타일 변형 80%(파격)");
    expect(modeText({ mode: "replicate", options })).toBe("스타일 복제");
  });
});

describe("P2-02 Seedream 5.5 시험 생성(화면 쪽 통신, 합성 응답)", () => {
  const row = { id: "seedream-5.5", label: "Seedream 5.5", vendor: "ByteDance", provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024",
    aspectRatio: "1:1", credentialVersion: 7,
    estimate: { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", withoutReference: 20000, withReference: 28000 } };
  const estimate = { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", referenceCount: 1, outputMicros: 20000, referenceMicros: 8000, totalMicros: 28000 };
  const generation = { provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024",
    png: { sha256: "b".repeat(64), width: 1024, height: 1024, byteLength: 1234 }, usage: { generatedImages: 1, outputTokens: 4096 }, estimate, billing: "unconfirmed" };
  const seedreamOp = { requestId: "0190b0b0-0000-4000-8000-000000000002", credentialVersion: 7 };

  it("시험 본문: 생성 모델은 예상 금액·그 공급자 키 버전을 싣고 계약 스키마(JSON·multipart)를 통과한다. Gemini 본문에는 금액 칸이 없다", () => {
    const json = JSON.parse(testRequest({ revision: 2, model: "seedream-5.5", subject: " cat ", attachImage: true, expectedCostMicros: 28000 }, seedreamOp));
    expect(json).toEqual({ requestId: seedreamOp.requestId, authorized: true, credentialVersion: 7, revision: 2, model: "seedream-5.5", subject: "cat",
      attachImage: true, expectedCostMicros: 28000 });
    expect(styleDnaGeneratedTest.safeParse(json).success).toBe(true);
    expect(styleDnaTest.safeParse(json).success).toBe(false);
    const file = new File([new Uint8Array([1, 2, 3])], "ref.png", { type: "image/png" });
    const form = testUploadRequest({ revision: 2, model: "seedream-5.5", subject: "", attachImage: true, customPrompt: "A cat", expectedCostMicros: 28000 },
      seedreamOp, file, "c".repeat(64)).body;
    expect(styleDnaGeneratedTestWithReference.safeParse(JSON.parse(String(form.get("options"))))).toMatchObject({ success: true,
      data: { attachImage: false, expectedCostMicros: 28000, customReferenceSha256: "c".repeat(64) } });
    expect(Object.keys(JSON.parse(testRequest({ revision: 1, model: "gemini-nano-banana-2.1", subject: "", attachImage: false }, op)))).not.toContain("expectedCostMicros");
    // 화면비 1:1 아닌 값은 서버 계약이 거절한다(화면은 생성 모델에서 화면비를 보내지 않는다).
    expect(styleDnaGeneratedTest.safeParse({ ...json, aspectRatio: "16:9" }).success).toBe(false);
  });

  it("목록의 생성 모델: 계약에 있는 모델·모양이 맞는 줄만 고를 수 있고, 칸이 없거나 어긋나면 빈 목록이다(키 원문은 받지 않는다)", () => {
    expect(styleDnaGenerationChoices({ generationModels: [row] })).toEqual([{ ...row }]);
    expect(styleDnaGenerationChoices({})).toEqual([]);
    expect(styleDnaGenerationChoices(null)).toEqual([]);
    expect(styleDnaGenerationChoices({ generationModels: "x" })).toEqual([]);
    for (const bad of [{ ...row, id: "flux-2" }, { ...row, modelId: "other" }, { ...row, credentialVersion: 0 }, { ...row, credentialVersion: 1.5 },
      { ...row, aspectRatio: "16:9" }, { ...row, provider: "fal" }, { ...row, estimate: { ...row.estimate, withReference: -1 } },
      { ...row, estimate: { ...row.estimate, currency: "KRW" } }, { ...row, estimate: undefined }])
      expect(styleDnaGenerationChoices({ generationModels: [bad] })).toEqual([]);
    expect(styleDnaGenerationChoices({ generationModels: [row, { ...row, credentialVersion: 9 }] })).toEqual([row]);
    // 서버가 다른 칸(예: 키 문자열)을 실어 보내도 화면 값에는 남기지 않는다.
    expect(styleDnaGenerationChoices({ generationModels: [{ ...row, apiKey: "secret" }] })[0]).not.toHaveProperty("apiKey");
  });

  it("409 estimate_changed는 서버 새 견적을 함께 돌려주고 다시 보내지 않는다. 생성 모델은 202에도 자동 재전송 없이 멈춘다(polls 0)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(409, { code: "estimate_changed", estimate: { ...estimate, totalMicros: 35000, outputMicros: 27000 } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await testStyleDna("x", "{}", 1, { polls: 0 })).toEqual({ kind: "error", code: "estimate_changed", status: 409,
      estimate: { ...estimate, totalMicros: 35000, outputMicros: 27000 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(409, { code: "estimate_changed", estimate: { totalMicros: "free" } })));
    expect(await testStyleDna("x", "{}", 1, { polls: 0 })).toEqual({ kind: "error", code: "estimate_changed", status: 409 });
    const busy = vi.fn().mockResolvedValue(reply(202, { code: "in_progress" }));
    vi.stubGlobal("fetch", busy);
    expect(await testStyleDna("x", "{}", 1, { polls: 0 })).toEqual({ kind: "error", code: "in_progress", status: 202 });
    expect(busy).toHaveBeenCalledTimes(1);
  });

  it("공급자 실패 코드는 끊김(lost)으로 뭉개지 않고 그대로 나눈다: 보내기 전 실패·전송 불명·결과 유실·거절", async () => {
    const cases = [[503, "generation_not_sent"], [504, "generation_submission_unknown"], [504, "generation_result_lost"], [422, "content_rejected"],
      [429, "provider_busy"], [502, "provider_rejected"], [502, "invalid_model_response"]] as const;
    const fetchMock = vi.fn();
    for (const [status, code] of cases) fetchMock.mockResolvedValueOnce(reply(status, { code }));
    vi.stubGlobal("fetch", fetchMock);
    for (const [status, code] of cases) expect(await testStyleDna("x", "{}", 1, { polls: 0 })).toEqual({ kind: "error", code, status });
    expect(fetchMock).toHaveBeenCalledTimes(cases.length);
    // 코드 없는 504만 예전처럼 같은 요청으로 다시 확인하는 끊김이다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(504, {})));
    expect(await testStyleDna("x", "{}", 1, { polls: 0 })).toEqual({ kind: "lost" });
  });

  it("결과 출처: 공급자·모델 ID·크기·예상 금액·실제 청구 미확정을 적고, 모양이 어긋난 기록은 읽지 못했다고만 적는다. Gemini 결과는 Gemini 모델", async () => {
    expect(usdText(20000)).toBe("$0.020");
    expect(usdText(28000)).toBe("$0.028");
    expect(readGeneration(generation)).toEqual(generation);
    expect(generationText({ model: "seedream-5.5", generation })).toBe(
      "AI 생성 출처 BytePlus · dola-seedream-5-5-261028 · 1024×1024 · 예상 $0.028(참조 1장 포함) · 실제 청구 미확정");
    expect(generationText({ model: "seedream-5.5", generation: { ...generation, billing: "paid" } })).toBe("AI 생성 출처 기록을 읽지 못했어요(실제 청구 미확정).");
    expect(generationText({ model: "seedream-5.5" })).toBe("AI 생성 출처 기록을 읽지 못했어요(실제 청구 미확정).");
    expect(generationText({ model: "gemini-nano-banana-2.1" })).toBe("AI 생성 출처 Google Gemini · Nano Banana 2.1");
    expect([styleDnaResultModelLabel("seedream-5.5"), styleDnaResultModelLabel("gemini-3.1-flash-lite-image"), styleDnaResultModelLabel("unknown")])
      .toEqual(["Seedream 5.5", "Nano Banana 2 Lite", "unknown"]);
    // 다시 연 기록: 생성 출처가 붙은 시험 결과도 기존 기록 확인을 그대로 통과하고 칸을 보존한다.
    const reopened = { ...record(), tests: [{ id: "t", revision: 1, model: "seedream-5.5", createdAt: "2026-11-25T00:00:00.000Z", original: media, image: media,
      basis: { promptMode: "revision", promptSha256: "d".repeat(64), aspectRatio: "1:1", credentialVersion: 7, reference: { kind: "none" } }, generation }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(200, { record: reopened })));
    const outcome = await readStyleDnaRecord("0190b0b0-0000-7000-8000-00000000b001");
    expect(outcome.kind === "ok" && outcome.value.tests[0].generation).toEqual(generation);
  });
});

describe("P2-02 F1 시험 결과 묶음·금액 상한 없음(화면 쪽 통신, 합성 응답)", () => {
  const rid = "0190b0b0-0000-7000-8000-00000000c001";
  const tid = "0190b0b0-0000-7000-8000-00000000c009";
  const otherRecord = "0190b0b0-0000-7000-8000-00000000c777";
  const at = (record: string, name: string) => ({ mime: "image/webp", width: 1024, height: 1024, sha256: "a".repeat(64),
    palette: [{ hex: "#1f6f6a", share: 1 }], href: `/api/admin/style-dna/${record}/media/${name}` });
  const estimate = { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", referenceCount: 0, outputMicros: 20000, referenceMicros: 0, totalMicros: 20000 };
  const seedream = { id: tid, revision: 2, model: "seedream-5.5", createdAt: "2026-11-25T00:00:00.000Z", original: at(rid, "original"), image: at(rid, tid),
    basis: { promptMode: "revision", promptSha256: "d".repeat(64), aspectRatio: "1:1", credentialVersion: 7, reference: { kind: "none" } },
    generation: { provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024",
      png: { sha256: "b".repeat(64), width: 1024, height: 1024, byteLength: 1234 }, usage: { generatedImages: 1 }, estimate, billing: "unconfirmed" } };
  // 예전 Gemini 결과(basis·generation 없음, 서버 1차 계약 모양).
  const legacy = { id: tid, revision: 2, model: "gemini-nano-banana-2.1", createdAt: "2026-11-21T00:00:00.000Z", original: at(rid, "original"), image: at(rid, tid) };

  it("FLUX.2의 확정 영수증에 출처와 견적을 표시하고 시험 모델과 공급자 조합을 검증한다", async () => {
    const generation = { ...seedream.generation, provider: "bfl", modelId: "flux-2-pro",
      estimate: { ...estimate, priceTable: "bfl-flux2-pro-2026-11-26", outputMicros: 30000, totalMicros: 30000 } };
    const test = { ...seedream, model: "flux-2-pro" as const, generation };
    const requestId = op.requestId;
    const model = "flux-2-pro";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test: { ...test, model: "seedream-5.5" } }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test: { ...test, generation: { ...generation, provider: "byteplus" } } }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test: seedream }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, test }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test }))
      .mockResolvedValueOnce(reply(503, { code: "storage_unavailable", requestId, settled: true, model }))
      .mockResolvedValueOnce(reply(503, { code: "storage_unavailable", requestId, settled: true }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model: "gemini-nano-banana-2.1", test }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readStyleDnaGeneration(rid, requestId, undefined, "flux-2-pro")).toEqual({ kind: "settled", test, model });
    expect(await readStyleDnaGeneration(rid, requestId, undefined, "flux-2-pro")).toEqual({ kind: "unavailable" });
    expect(await readStyleDnaGeneration(rid, requestId, undefined, "flux-2-pro")).toEqual({ kind: "unavailable" });
    // 원장은 FLUX.2인데 결과는 Seedream: 결과 모델 불일치
    expect(await readStyleDnaGeneration(rid, requestId, undefined, "flux-2-pro")).toEqual({ kind: "model_unverified", reason: "mismatch" });
    // 이 탭에 묶은 모델(Seedream)과 원장(FLUX.2) 불일치
    expect(await readStyleDnaGeneration(rid, requestId, undefined, "seedream-5.5")).toEqual({ kind: "model_unverified", reason: "mismatch" });
    // 원장 모델이 없는 구형 행은 결과 본문 모델만으로 확정하지 않는다
    expect(await readStyleDnaGeneration(rid, requestId)).toEqual({ kind: "model_unverified", reason: "missing" });
    // 새 탭(로컬 모델 없음): 원장 모델과 결과 모델이 같으면 같은 UUID로 확정한다
    expect(await readStyleDnaGeneration(rid, requestId)).toEqual({ kind: "settled", test, model });
    expect(await readStyleDnaGeneration(rid, requestId)).toEqual({ kind: "settled_error", code: "storage_unavailable", model });
    expect(await readStyleDnaGeneration(rid, requestId)).toEqual({ kind: "model_unverified", reason: "missing" });
    // 생성 모델이 아닌 값은 원장 모델로 받지 않는다
    expect(await readStyleDnaGeneration(rid, requestId)).toEqual({ kind: "model_unverified", reason: "missing" });
    expect(generationText(test)).toBe("AI 생성 출처 Black Forest Labs · flux-2-pro · 1024×1024 · 예상 $0.030(참조 없음) · 실제 청구 미확정");
  });

  it("새 세션은 보호된 GET으로 UUIDv4 보류와 확정 영수증을 읽고 일시적 503과 구분한다", async () => {
    const requestId = op.requestId;
    const model = "seedream-5.5";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, { pending: false }))
      .mockResolvedValueOnce(reply(202, { code: "in_progress", requestId, model }))
      .mockResolvedValueOnce(reply(202, { code: "in_progress", requestId }))
      .mockResolvedValueOnce(reply(202, { code: "in_progress", requestId, model: "flux-2-pro" }))
      .mockResolvedValueOnce(reply(503, { code: "storage_unavailable" }))
      .mockResolvedValueOnce(reply(503, { code: "storage_unavailable", requestId, settled: true, model }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test: seedream }))
      .mockResolvedValueOnce(reply(200, { requestId, settled: true, model, test: { ...seedream, image: at(otherRecord, tid) } }))
      .mockResolvedValueOnce(reply(200, { requestId: tid, settled: true, model, test: seedream }))
      .mockResolvedValueOnce(reply(404, { code: "not_found" }))
      .mockResolvedValueOnce(reply(404, { code: "not_found", requestId, settled: true, model }))
      .mockResolvedValueOnce(reply(404, { code: "not_found", requestId, settled: true }))
      .mockResolvedValueOnce(reply(404, { code: "not_found", requestId: tid, settled: true, model }))
      .mockResolvedValueOnce(reply(401, {}));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readStyleDnaGeneration(rid)).toEqual({ kind: "idle" });
    // 발견 202는 원장 모델을 함께 돌려준다
    expect(await readStyleDnaGeneration(rid)).toEqual({ kind: "pending", requestId, model });
    const outcomes = [];
    for (let i = 0; i < 12; i++) outcomes.push(await readStyleDnaGeneration(rid, requestId, undefined, "seedream-5.5"));
    expect(outcomes).toEqual([
      { kind: "pending", requestId, model: null }, { kind: "pending", requestId, model: "flux-2-pro" }, { kind: "unavailable" },
      { kind: "settled_error", code: "storage_unavailable", model }, { kind: "settled", test: seedream, model }, { kind: "unavailable" }, { kind: "unavailable" },
      // 일반 404는 잠금 유지(missing), 같은 UUID에 묶인 확정 404만 삭제 확정, 모델 없는 확정 404·다른 UUID는 확정하지 않는다
      { kind: "missing" }, { kind: "deleted", model }, { kind: "model_unverified", reason: "missing" }, { kind: "unavailable" }, { kind: "login" },
    ]);
    for (const [path, init] of fetchMock.mock.calls.slice(2)) {
      expect(path).toBe(`/api/admin/style-dna/${rid}/test-image?requestId=${requestId}`);
      expect(init).toEqual({ cache: "no-store", credentials: "same-origin", signal: undefined });
    }
  });

  it("새 Seedream 제출의 409 경합에서 기존 요청 UUID만 받아 확인한다", async () => {
    const code = "generation_in_progress";
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(409, { code, requestId: op.requestId }))
      .mockResolvedValueOnce(reply(409, { code, requestId: "bad", model: "flux-2-pro" }))
      .mockResolvedValueOnce(reply(409, { code, requestId: op.requestId, model: "flux-2-pro" }))
      .mockResolvedValueOnce(reply(202, { code: "in_progress", requestId: op.requestId, model: "seedream-5.5" }))
      .mockResolvedValueOnce(reply(202, { code: "in_progress", requestId: op.requestId, model: "not-a-model" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 409, code, requestId: op.requestId });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 409, code });
    // 원장 모델: 다른 보류 요청의 409와 같은 UUID 재시도 202에만 싣고, 생성 모델이 아닌 값은 버린다
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 409, code, requestId: op.requestId, model: "flux-2-pro" });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 202, code: "in_progress", model: "seedream-5.5" });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 202, code: "in_progress" });
  });

  it("504 접수 미확인·결과 유실에서 서버가 유지한 같은 요청 UUID와 원장 모델을 싣는다(GPT Image·FLUX, Tester 32a2af30 반례)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(504, { code: "generation_submission_unknown", requestId: op.requestId, model: "gpt-image-2.6" }))
      .mockResolvedValueOnce(reply(504, { code: "generation_result_lost", requestId: op.requestId, model: "flux-2-pro" }))
      // Seedream은 예약을 풀고 UUID를 주지 않는다: 예전 모양 그대로
      .mockResolvedValueOnce(reply(504, { code: "generation_submission_unknown" }))
      .mockResolvedValueOnce(reply(504, { code: "generation_submission_unknown", requestId: "bad", model: "gpt-image-2.6" }))
      // 다른 상태의 같은 코드는 예약 유지로 읽지 않는다
      .mockResolvedValueOnce(reply(502, { code: "generation_submission_unknown", requestId: op.requestId }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 504, code: "generation_submission_unknown", requestId: op.requestId, model: "gpt-image-2.6" });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 504, code: "generation_result_lost", requestId: op.requestId, model: "flux-2-pro" });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 504, code: "generation_submission_unknown" });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 504, code: "generation_submission_unknown" });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", status: 502, code: "generation_submission_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("503 결과 미확정 → 일시적 저장소 오류 → 202 → 201은 수동 확인마다 같은 본문을 한 번만 보낸다", async () => {
    const body = JSON.stringify({ requestId: "0190b0b0-0000-4000-8000-000000000002", model: "seedream-5.5" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(503, { code: "result_unconfirmed" }))
      .mockResolvedValueOnce(reply(503, { code: "storage_unavailable" }))
      .mockResolvedValueOnce(reply(202, { code: "in_progress" }))
      .mockResolvedValueOnce(reply(201, { test: seedream }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await testStyleDna(rid, body, 2, { polls: 0 })).toEqual({ kind: "error", code: "result_unconfirmed", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await testStyleDna(rid, body, 2, { polls: 0 })).toEqual({ kind: "error", code: "storage_unavailable", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await testStyleDna(rid, body, 2, { polls: 0 })).toEqual({ kind: "error", code: "in_progress", status: 202 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await testStyleDna(rid, body, 2, { polls: 0 })).toEqual({ kind: "ok", value: seedream });
    expect(fetchMock.mock.calls.map(call => [call[0], call[1].body])).toEqual(Array(4).fill([`/api/admin/style-dna/${rid}/test-image`, body]));
    // 503의 다른 코드(보내기 전 실패·저장소 없음)는 미확정과 섞이지 않는다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(503, { code: "generation_not_sent" })).mockResolvedValueOnce(reply(503, { code: "storage_unavailable" })));
    expect(await testStyleDna(rid, body, 2, { polls: 0 })).toEqual({ kind: "error", code: "generation_not_sent", status: 503 });
    expect(await testStyleDna(rid, body, 2, { polls: 0 })).toEqual({ kind: "error", code: "storage_unavailable", status: 503 });
  });

  it("성공 응답은 고른 버전·문자열 결과 ID이고 원본·결과 이미지가 이 기록의 보호 경로일 때만 받는다(예전 Gemini·새 Seedream 모두)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(201, { test: seedream })).mockResolvedValueOnce(reply(200, { test: legacy }))
      .mockResolvedValueOnce(reply(201, { test: { ...legacy, image: { ...at(rid, tid), href: `/api/admin/style-dna/${rid}/media/${tid}?m=delay%3A4000` } } })));
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "ok", value: seedream });
    expect(await testStyleDna(rid, "{}", 2)).toEqual({ kind: "ok", value: legacy });
    expect(await testStyleDna(rid, "{}", 2)).toMatchObject({ kind: "ok" });
    const bad = [
      { ...seedream, original: at(otherRecord, "original") },                 // 다른 기록의 원본
      { ...seedream, image: at(otherRecord, tid) },                           // 다른 기록의 결과
      { ...seedream, image: at(rid, "original") },                            // 결과 자리에 원본 미디어
      { ...seedream, image: at(rid, "0190b0b0-0000-7000-8000-00000000c002") },// 다른 결과(이전 시험) 미디어
      { ...seedream, original: at(rid, tid) },                                // 원본 자리에 결과 미디어
      { ...seedream, image: { ...seedream.image, href: `https://evil.example/api/admin/style-dna/${rid}/media/${tid}` } }, // 절대 주소
      { ...seedream, image: { ...seedream.image, href: `//evil.example/api/admin/style-dna/${rid}/media/${tid}` } },       // 출처 생략 절대 주소
      { ...seedream, image: { ...seedream.image, href: `api/admin/style-dna/${rid}/media/${tid}` } },                      // 상대 주소
      { ...seedream, image: { ...seedream.image, href: `/api/admin/style-dna/${rid}/media/${tid}/../../${otherRecord}/media/x` } }, // 경로 덧붙임
      { ...seedream, image: { ...seedream.image, href: `/api/admin/style-dna/${rid}/media/${tid}0` } },                    // 다른 ID 앞부분 일치
      { ...seedream, image: { ...seedream.image, href: `/api/admin/style-dna/${rid}/media/${tid}#x` } },                   // 조각
      { ...seedream, image: { ...seedream.image, href: 7 } },                 // 문자 아닌 주소
      { ...seedream, image: undefined },
      { ...seedream, id: 9, image: at(rid, "9") },                            // 문자 아닌 결과 ID
      { ...seedream, id: "original", image: at(rid, "original") },            // 결과 ID가 원본 이름
      { ...seedream, id: "../x", image: at(rid, "../x") },                    // 경로 문자가 든 결과 ID
      { ...seedream, revision: 1 },                                           // 다른 버전
    ];
    const fetchMock = vi.fn();
    for (const test of bad) fetchMock.mockResolvedValueOnce(reply(201, { test }));
    vi.stubGlobal("fetch", fetchMock);
    for (const test of bad) expect(await testStyleDna(rid, "{}", 2, { polls: 0 }), JSON.stringify(test.image?.href ?? test.id)).toEqual({ kind: "error", code: "failed", status: 201 });
    // 같은 응답이라도 다른 기록에 대한 요청이면 받지 않는다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(201, { test: seedream })));
    expect(await testStyleDna(otherRecord, "{}", 2, { polls: 0 })).toEqual({ kind: "error", code: "failed", status: 201 });
    expect(isBoundTest(seedream, `${rid}/x`, 2)).toBe(false);
  });

  it("금액은 고정 상한 없이 비음수 안전 정수만 받고, 개별 금액·합계·통화·단위가 맞아야 한다", async () => {
    const big = { ...estimate, outputMicros: 1_500_000_000_000, totalMicros: 1_500_000_000_000 };
    expect(readGenerationEstimate(big)).toEqual(big);
    expect(usdText(1_000_000_001)).toBe("$1000.000");
    const max = { ...estimate, referenceCount: 1, outputMicros: Number.MAX_SAFE_INTEGER - 8000, referenceMicros: 8000, totalMicros: Number.MAX_SAFE_INTEGER };
    expect(readGenerationEstimate(max)).toEqual(max);
    for (const bad of [
      { ...estimate, totalMicros: 20001 },                                                        // 합계 불일치
      { ...estimate, referenceMicros: 8000, totalMicros: 28000 },                                 // 참조 0장인데 참조 금액
      { ...estimate, outputMicros: Number.MAX_SAFE_INTEGER, referenceCount: 1, referenceMicros: 1, totalMicros: Number.MAX_SAFE_INTEGER }, // 합계가 안전 범위 밖
      { ...estimate, outputMicros: Number.MAX_SAFE_INTEGER + 1, totalMicros: Number.MAX_SAFE_INTEGER + 1 },                              // 안전 정수 밖
      { ...estimate, outputMicros: 20000.5, totalMicros: 20000.5 }, { ...estimate, outputMicros: -1, totalMicros: -1 },
      { ...estimate, totalMicros: "20000" }, { ...estimate, currency: "KRW" }, { ...estimate, unit: "cents" }, { ...estimate, referenceCount: 2 },
    ]) expect(readGenerationEstimate(bad), JSON.stringify(bad)).toBeNull();

    // 409 새 견적: 1,000달러를 넘는 합성 금액도 그대로 보여 줄 수 있고, 어긋난 견적은 버린다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(409, { code: "estimate_changed", estimate: big }))
      .mockResolvedValueOnce(reply(409, { code: "estimate_changed", estimate: { ...big, totalMicros: big.totalMicros + 1 } })));
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", code: "estimate_changed", status: 409, estimate: big });
    expect(await testStyleDna(rid, "{}", 2, { polls: 0 })).toEqual({ kind: "error", code: "estimate_changed", status: 409 });

    // 목록 견적: 상한 없이 안전 정수면 받는다.
    const row = { id: "seedream-5.5", label: "Seedream 5.5", vendor: "ByteDance", provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024",
      aspectRatio: "1:1", credentialVersion: 7,
      estimate: { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", withoutReference: 2_000_000_000, withReference: Number.MAX_SAFE_INTEGER } };
    expect(styleDnaGenerationChoices({ generationModels: [row] })).toEqual([row]);
    for (const value of [Number.MAX_SAFE_INTEGER + 1, 1.5, -1, "1"])
      expect(styleDnaGenerationChoices({ generationModels: [{ ...row, estimate: { ...row.estimate, withReference: value } }] })).toEqual([]);

    // 보낼 금액: 계약 스키마도 상한 없이 안전 정수만 받는다.
    const costOp = { requestId: "0190b0b0-0000-4000-8000-000000000003", credentialVersion: 7 };
    for (const expected of [1_000_000_001, Number.MAX_SAFE_INTEGER])
      expect(styleDnaGeneratedTest.safeParse(JSON.parse(testRequest({ revision: 2, model: "seedream-5.5", subject: "cat", attachImage: false, expectedCostMicros: expected }, costOp))).success).toBe(true);
    for (const expected of [Number.MAX_SAFE_INTEGER + 1, 0.5, -1])
      expect(styleDnaGeneratedTest.safeParse(JSON.parse(testRequest({ revision: 2, model: "seedream-5.5", subject: "cat", attachImage: false, expectedCostMicros: expected }, costOp))).success).toBe(false);
  });
});
