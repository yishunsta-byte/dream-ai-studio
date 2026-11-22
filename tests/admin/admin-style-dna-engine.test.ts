import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeRequest, engineBasisText, engineLabel, readEngineCredentials, refineRequest, testRequest } from "@/components/admin/style-dna-client";
import { styleDnaAnalyze, styleDnaAnalyzeSource, styleDnaRefine } from "@/lib/reference-analysis/style-dna-contract";
import { styleDnaEngineCredentialPath } from "@/lib/reference-analysis/style-dna-engine-credential-contract";

// P1-06 이미지 분석·보정 엔진 선택(서버 f2d7e63 계약): 화면이 보내는 본문과 설정 읽기, 실제 실행 엔진 표시.
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const options = { mode: "replicate" as const, guidance: "", mutationLevel: 30, includeImageTag: true, targetModel: "gemini-nano-banana-2.1" as const };
const gemini = { requestId: "0190b0b0-0000-4000-8000-000000000001", credentialVersion: 3 };
const openai = { requestId: "0190b0b0-0000-4000-8000-000000000002", credentialVersion: 2, engine: { provider: "openai" as const, modelId: "gpt-4.1-mini" } };
const claude = { requestId: "0190b0b0-0000-4000-8000-000000000003", credentialVersion: 5, engine: { provider: "anthropic" as const, modelId: "claude-sonnet-4-5" } };
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
