import { describe, expect, it } from "vitest";
import {
  generationCostText, generationModelLabel, generationText, readGeneration, styleDnaGenerationChoices, testRequest, usageBased,
} from "@/components/admin/style-dna-client";
import { styleDnaGenerationCardProviders } from "@/components/admin/style-dna-generation-credentials-client";

// P2-02-STYLE-DNA-GPT-IMAGE-UI F1~F4(서버 4ba5eecc 계약). 서버 응답은 합성 값만 쓴다. 실제 OpenAI 호출 0.
const usageRow = {
  id: "gpt-image-2.6", label: "GPT Image 2.6", vendor: "OpenAI", provider: "openai", modelId: "gpt-image-2.6-sunburst", size: "1024x1024", aspectRatio: "1:1",
  credentialVersion: 2, estimate: { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11", currency: "USD", unit: "micros" },
};
const fixedRow = {
  id: "seedream-5.5", label: "Seedream 5.5", vendor: "ByteDance", provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024", aspectRatio: "1:1",
  credentialVersion: 1, estimate: { priceTable: "byteplus-2026-11", currency: "USD", unit: "micros", withoutReference: 35_000, withReference: 35_000 },
};
const png = { sha256: "a".repeat(64), width: 1024, height: 1024, byteLength: 1_234_567 };
const usageGeneration = {
  provider: "openai", modelId: "gpt-image-2.6-sunburst", size: "1024x1024", png,
  usage: { generatedImages: 1, inputTokens: 120, outputTokens: 1000 },
  estimate: { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11", currency: "USD", unit: "micros", referenceCount: 0 },
  actualCostMicros: 30_600, billing: "unconfirmed",
};

describe("F4 모델 목록: usage 기반 줄", () => {
  it("계약과 같은 GPT Image 줄을 고정가 줄과 함께 받고, usage 기반으로 구분한다", () => {
    const choices = styleDnaGenerationChoices({ generationModels: [fixedRow, usageRow] });
    expect(choices.map(item => item.id)).toEqual(["seedream-5.5", "gpt-image-2.6"]);
    expect(usageBased(choices[1])).toBe(true);
    expect(usageBased(choices[0])).toBe(false);
  });
  it("금액 칸이 섞이거나 계약 값과 다르면 그 줄만 버린다", () => {
    for (const bad of [
      { ...usageRow, estimate: { ...usageRow.estimate, withoutReference: 1 } },
      { ...usageRow, estimate: { ...usageRow.estimate, kind: "fixed" } },
      { ...usageRow, modelId: "gpt-image-2.6-flare" },
      { ...usageRow, provider: "bfl" },
      { ...usageRow, credentialVersion: 0 },
    ]) expect(styleDnaGenerationChoices({ generationModels: [fixedRow, bad] }).map(item => item.id)).toEqual(["seedream-5.5"]);
    // 고정가 모델에 kind가 붙으면(모르는 모양) 그 줄을 버린다
    expect(styleDnaGenerationChoices({ generationModels: [{ ...fixedRow, estimate: { ...fixedRow.estimate, kind: "usage_based" } }] })).toEqual([]);
  });
  it("생성 모델 표기는 프롬프트 전용 대상과 구분해 sunburst까지 적는다", () => {
    expect(generationModelLabel("gpt-image-2.6", "GPT Image 2.6")).toBe("GPT Image 2.6 · sunburst");
    expect(generationModelLabel("seedream-5.5", "Seedream 5.5")).toBe("Seedream 5.5");
  });
});

describe("F1 결과 출처", () => {
  it("OpenAI·sunburst 출처를 받고, 실제 금액이 있으면 실제 사용량 기준 금액을 적는다", () => {
    expect(readGeneration(usageGeneration, "gpt-image-2.6")).toEqual(usageGeneration);
    expect(generationText({ model: "gpt-image-2.6", generation: usageGeneration }))
      .toBe("AI 생성 출처 OpenAI · gpt-image-2.6-sunburst · 1024×1024 · 실제 사용량 기준 $0.031(참조 없음) · 실제 청구 미확정");
  });
  it("금액이 없거나 usage 칸이 빠지면 칸을 채우지 않고 '계산 중'으로 적는다", () => {
    const pending = { ...usageGeneration, usage: { generatedImages: 1 }, estimate: { ...usageGeneration.estimate, referenceCount: 1 } } as Record<string, unknown>;
    delete pending.actualCostMicros;
    const read = readGeneration(pending, "gpt-image-2.6");
    expect(read?.usage).toEqual({ generatedImages: 1 });
    expect(read && generationCostText(read)).toBe("실제 사용량으로 계산 중(금액 미확인)");
    expect(generationText({ model: "gpt-image-2.6", generation: pending })).toContain("실제 사용량으로 계산 중(금액 미확인)(참조 1장 포함)");
  });
  it("모르는 칸·다른 모델·음수 토큰·과금 확정 표시는 받지 않는다(출처 읽지 못함)", () => {
    for (const bad of [
      { ...usageGeneration, usage: { ...usageGeneration.usage, cachedTokens: 3 } },
      { ...usageGeneration, providerUrl: "https://example.invalid" },
      { ...usageGeneration, modelId: "gpt-image-2.6-flare" },
      { ...usageGeneration, usage: { ...usageGeneration.usage, outputTokens: -1 } },
      { ...usageGeneration, billing: "confirmed" },
      { ...usageGeneration, actualCostMicros: 1.5 },
      { ...usageGeneration, estimate: { ...usageGeneration.estimate, referenceCount: 2 } },
      { ...usageGeneration, estimate: { ...usageGeneration.estimate, totalMicros: 1 } },
    ]) expect(readGeneration(bad, "gpt-image-2.6")).toBeNull();
    expect(readGeneration(usageGeneration, "seedream-5.5")).toBeNull();
    expect(generationText({ model: "gpt-image-2.6", generation: { bad: true } })).toBe("AI 생성 출처 기록을 읽지 못했어요(실제 청구 미확정).");
  });
});

describe("F2 요청 본문", () => {
  const op = { requestId: "0194f3a0-0000-7000-8000-0000000000a1", credentialVersion: 2 };
  it("usage 기반은 금액 대신 billing: usage_based만 보낸다", () => {
    const body = JSON.parse(testRequest({ revision: 1, model: "gpt-image-2.6", subject: "", attachImage: false, billing: "usage_based" }, op));
    expect(body).toMatchObject({ model: "gpt-image-2.6", billing: "usage_based", credentialVersion: 2 });
    expect(body).not.toHaveProperty("expectedCostMicros");
  });
  it("고정가 모델은 예전대로 금액만 보낸다", () => {
    const body = JSON.parse(testRequest({ revision: 1, model: "seedream-5.5", subject: "", attachImage: false, expectedCostMicros: 35_000 }, op));
    expect(body).toMatchObject({ expectedCostMicros: 35_000 });
    expect(body).not.toHaveProperty("billing");
  });
});

describe("F3 생성 키 카드", () => {
  it("OpenAI 생성 키 카드가 공급자 목록에 있다", () => {
    expect(styleDnaGenerationCardProviders).toEqual(["byteplus", "bfl", "openai"]);
  });
});
