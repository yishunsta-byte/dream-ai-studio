import { afterEach, describe, expect, it, vi } from "vitest";
import { modeText, mutationStage } from "@/components/admin/admin-style-dna-workflow";
import {
  analyzeRequest, analyzeStyleDna, needsSubject, paletteProximity, readStyleDnaLibrary, readStyleDnaRecord, refineRequest, refineStyleDna, testRequest, testStyleDna,
} from "@/components/admin/style-dna-client";
import { styleDnaAnalyze, styleDnaAnalyzeSource, styleDnaRefine, styleDnaTest } from "@/lib/reference-analysis/style-dna-contract";

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(201, { record: record(2) })).mockResolvedValueOnce(reply(201, { record: record(1) }))
      .mockResolvedValueOnce(reply(201, { test: { id: "t", revision: 2, image: media, original: media } }))
      .mockResolvedValueOnce(reply(201, { test: { id: "t", revision: 1, image: media, original: media } })));
    expect(await refineStyleDna("0190b0b0-0000-7000-8000-00000000b001", "{}", 2)).toMatchObject({ kind: "ok" });
    expect(await refineStyleDna("0190b0b0-0000-7000-8000-00000000b001", "{}", 2)).toEqual({ kind: "error", code: "failed", status: 201 });
    expect(await testStyleDna("x", "{}", 2)).toMatchObject({ kind: "ok", value: { revision: 2 } });
    expect(await testStyleDna("x", "{}", 2)).toEqual({ kind: "error", code: "failed", status: 201 });
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
