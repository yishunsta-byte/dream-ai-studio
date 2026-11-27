import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdminPlatformIntegrations } from "@/components/admin/admin-platform-integrations";
import {
  generationInvalidKeyNotice, generationKeyFormatHint, generationKeyPasteHint, generationSaveNotices,
} from "@/components/admin/admin-style-dna-generation-settings";
import { credentialKey } from "@/lib/reference-analysis/analysis-credential-contract";
import {
  acceptsGenerationKey, readStyleDnaGenerationSettings, saveStyleDnaGenerationSetting, styleDnaGenerationCredentialPath, styleDnaGenerationKeyLimits,
} from "@/components/admin/style-dna-generation-credentials-client";

// P2-02-STYLE-DNA-SEEDREAM-CREDENTIAL-UI: 생성 키(BytePlus) 등록 화면의 요청 계약. 서버는 합성 응답(대역)이고 키는 합성 값만 쓴다.
const key = "synthetic_generation_key_0001";
const signal = new AbortController().signal;
const byteplus = { configured: true, version: 3, updatedAt: "2026-11-25T09:00:00.000Z" } as const;
const empty = { configured: false, version: 0, updatedAt: null } as const;
const request = { provider: "byteplus", expectedVersion: 2, apiKey: key } as const;

function stub(status: number, body: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("FLUX.2 pro(BFL) 키 칸 선택 수용(P2-02-STYLE-DNA-FLUX2-CREDENTIAL-PREFLIGHT)", () => {
  it("서버가 bfl을 내기 전·후 모두 읽고, bfl 칸에도 비밀·추가 필드는 거절한다", async () => {
    stub(200, { providers: { byteplus } });
    expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "ok", value: { providers: { byteplus } } });
    stub(200, { providers: { byteplus, bfl: empty } });
    expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "ok", value: { providers: { byteplus, bfl: empty } } });
    stub(200, { providers: { byteplus: empty, bfl: byteplus } });
    expect((await readStyleDnaGenerationSettings(signal)).kind).toBe("ok");
    for (const bfl of [{ ...byteplus, apiKey: key }, { configured: true, version: 0, updatedAt: byteplus.updatedAt }, null]) {
      stub(200, { providers: { byteplus, bfl } });
      expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "failed" });
    }
    // bfl만 있고 byteplus가 없으면 거절(기존 카드 계약 유지)
    stub(200, { providers: { bfl: empty } });
    expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "failed" });
  });

  it("bfl 저장은 같은 공급자·버전+1 응답만 받는다", async () => {
    const fetch = stub(200, { provider: "bfl", setting: byteplus });
    expect(await saveStyleDnaGenerationSetting({ provider: "bfl", expectedVersion: 2, apiKey: key }, signal)).toEqual({ kind: "ok", value: { provider: "bfl", setting: byteplus } });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ provider: "bfl", expectedVersion: 2, apiKey: key });
    stub(200, { provider: "byteplus", setting: byteplus });
    expect(await saveStyleDnaGenerationSetting({ provider: "bfl", expectedVersion: 2, apiKey: key }, signal)).toEqual({ kind: "failed" });
  });

  it("형식 거절 안내는 발급처를 공급자별로 말한다", () => {
    expect(generationInvalidKeyNotice("byteplus")).toBe(generationSaveNotices.invalid_key);
    expect(generationInvalidKeyNotice("byteplus")).toContain("BytePlus ModelArk에서 발급한 키");
    expect(generationInvalidKeyNotice("bfl")).toContain("Black Forest Labs에서 발급한 키");
  });
});

describe("image generation key registration", () => {
  it("places the BytePlus card in the generation section without keys, inputs or analysis engine changes", () => {
    const html = renderToStaticMarkup(createElement(AdminPlatformIntegrations, { email: "fixture@example.invalid" }));
    const section = html.indexOf(">이미지·음악·영상 생성 API</h3>");
    const card = html.indexOf("BytePlus ModelArk 생성 키");
    const youtube = html.indexOf(">YouTube Data API v3 등록</h3>");
    expect(section).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(section);
    expect(youtube).toBeGreaterThan(card);
    expect(html).toContain('aria-label="이미지 생성 플랫폼"');
    expect(html).toContain("https://docs.byteplus.com/en/docs/ModelArk/seedream-5-5");
    // 분석 엔진 카드 세 개는 그대로 'AI 분석 엔진' 절에 있다.
    const analysis = html.indexOf(">AI 분석 엔진</h3>");
    for (const name of ["OpenAI 키·모델", "Anthropic Claude 키·모델", "Gemini 키·모델"]) {
      expect(html.indexOf(name)).toBeGreaterThan(analysis);
      expect(html.indexOf(name)).toBeLessThan(section);
    }
    expect(html).toContain("생성 키를 등록한 Seedream 5.5, FLUX.2 pro, GPT Image 2.6");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain(key);
  });

  it("loads only same-origin registration metadata and rejects any extra or secret field", async () => {
    const settings = { providers: { byteplus } };
    const fetch = stub(200, settings);
    expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "ok", value: settings });
    expect(fetch).toHaveBeenCalledWith(styleDnaGenerationCredentialPath, { credentials: "same-origin", cache: "no-store", method: "GET", signal });
    expect(styleDnaGenerationCredentialPath).toBe("/api/admin/style-dna/generation-credentials");
    stub(200, { providers: { byteplus: empty } });
    expect((await readStyleDnaGenerationSettings(signal)).kind).toBe("ok");
    for (const bad of [
      { providers: { byteplus: { ...byteplus, apiKey: key } } },
      { providers: { byteplus: { ...byteplus, keyHint: key.slice(-4) } } },
      { providers: { byteplus, kling: empty } }, // openai는 GPT Image 계약(4ba5eecc)에서 정상 칸이 됐다. 모르는 공급자 칸 예시를 바꿈
      { providers: { byteplus: { ...byteplus, modelId: "dola-seedream-5-5-261028" } } },
      { providers: { byteplus: { configured: true, version: 0, updatedAt: byteplus.updatedAt } } },
      { providers: { byteplus: { configured: false, version: 2, updatedAt: null } } },
      { providers: {} },
    ]) {
      stub(200, bad);
      expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "failed" });
    }
  });

  it("sends exactly provider, expected version and the new key once, and accepts only the next version", async () => {
    const reply = { provider: "byteplus", setting: byteplus };
    const fetch = stub(200, reply);
    expect(await saveStyleDnaGenerationSetting(request, signal)).toEqual({ kind: "ok", value: reply });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(styleDnaGenerationCredentialPath, expect.objectContaining({
      method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
    }));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(request);
    // 저장은 생성 키 경로 하나만 부른다(이미지 분석기 목록 /api/admin/style-dna 조회 없음).
    expect(fetch.mock.calls.every(([path]) => path === styleDnaGenerationCredentialPath)).toBe(true);
    for (const bad of [
      { provider: "byteplus", setting: { ...byteplus, version: 2 } },
      { provider: "byteplus", setting: { ...byteplus, version: 4 } },
      { provider: "openai", setting: byteplus },
      { provider: "byteplus", setting: empty },
      { provider: "byteplus", setting: { ...byteplus, apiKey: key } },
      { ...reply, apiKey: key },
    ]) {
      stub(200, bad);
      expect(await saveStyleDnaGenerationSetting(request, signal)).toEqual({ kind: "failed" });
    }
  });

  it.each([
    [401, "AUTH_REQUIRED", "login"], [403, "FORBIDDEN", "forbidden"], [400, "invalid_input", "invalid"], [413, "too_large", "invalid"],
    [409, "stale", "stale"], [422, "invalid_key", "invalid_key"], [422, "model_not_found", "failed"], [429, "quota_exceeded", "quota_exceeded"],
    [503, "storage_unavailable", "storage"], [503, "AUTH_UNAVAILABLE", "failed"], [504, "timed_out", "timed_out"], [500, "boom", "failed"],
  ] as const)("keeps response %i (%s) detail out of the interface", async (status, code, kind) => {
    stub(status, { code, error: key });
    const result = await saveStyleDnaGenerationSetting(request, signal);
    expect(result).toEqual({ kind });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("treats a network failure as an unknown result", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("offline")));
    expect(await saveStyleDnaGenerationSetting(request, signal)).toEqual({ kind: "failed" });
    expect(await readStyleDnaGenerationSettings(signal)).toEqual({ kind: "failed" });
  });

  it("words save failures as local format checks and unknown results, never as a provider check", () => {
    // 배정 2: 등록 API는 서버에서 형식만 확인하고 저장한다. 422가 BytePlus에 보내 확인한 것처럼 읽히면 안 된다.
    expect(generationSaveNotices.invalid_key).toMatch(/^서버가 API 키 형식을 받아들이지 않았어요\./);
    for (const text of Object.values(generationSaveNotices)) {
      expect(text).not.toMatch(/BytePlus ModelArk가|플랫폼이|플랫폼 키 확인|권한을 확인/);
    }
    expect(generationSaveNotices.quota_exceeded).toContain("이번 저장을 처리하지 않았어요");
    // 504는 결과가 불명확하다: 다시 저장하기 전에 등록 상태(GET)부터 확인하게 한다.
    expect(generationSaveNotices.timed_out).toContain("다시 저장하기 전에 최신 등록 상태를 불러와 확인해 주세요");
  });

  it("uses the shared server key check: new and old shapes, padding, and no trimming or truncation", () => {
    // 신형(UUID형·ark)·구형(영숫자·기호)·합성 Bearer 패딩 키는 받는다.
    for (const accepted of [key, "0f3c2a1e-9b7d-4c55-8e21-6a0b9c8d7e6f", "ark-6f1d0c9e-2b7a-4c3e-9d58-0a1b2c3d4e5f-synthetic",
      "c3ludGhldGljLWtleS0wMDAx==", "x".repeat(256)]) expect(acceptsGenerationKey(accepted)).toBe(true);
    // 다듬거나 잘라서 받지 않는다: 앞뒤 공백·개행·쉼표·중간 패딩·한도 초과는 그대로 거절.
    for (const rejected of ["short", "has space inside the key 123", "x".repeat(257), ` ${key}`, `${key} `, `${key}\n`, `${key}\r\n`,
      "synthetic-key-0001,synthetic-key-0002", "c3ludGhldGlj=LWtleS0wMDAx", `${key}é`]) expect(acceptsGenerationKey(rejected)).toBe(false);
    expect(styleDnaGenerationKeyLimits).toEqual({ min: 16, max: 256 });
    expect(generationKeyFormatHint).toBe("API 키의 형식을 확인해 주세요.");
    expect(generationKeyPasteHint).toMatch(/공백·줄바꿈·쉼표.*넣지 않았어요/);
    // 분석 엔진 키 검사는 그대로다(생성 키 규칙 변경이 분석 엔진 카드에 번지지 않음).
    expect(credentialKey.safeParse("c3ludGhldGljLWtleS0wMDAx==").success).toBe(false);
    expect(credentialKey.safeParse(key).success).toBe(true);
  });



});
