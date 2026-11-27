import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  styleDnaFluxTest, styleDnaGeneratedTest, styleDnaGenerationRequestModel, styleDnaGptImageTest, styleDnaGptImageTestWithReference,
  styleDnaRequestModel, styleDnaResultModelLabel, styleDnaUsageGeneratedModels,
} from "@/lib/reference-analysis/style-dna-contract";
import { styleDnaGenerationProvider } from "@/lib/reference-analysis/style-dna-generation-credential-contract";
import {
  createGptImageAdapter, gptImageEditEndpoint, gptImageEstimate, gptImageGenerationEndpoint, GptImageGenerationError, gptImageUsage,
} from "@/lib/reference-analysis/style-dna-gpt-image-provider";
import { FluxGenerationError } from "@/lib/reference-analysis/style-dna-flux-provider";

vi.mock("server-only", () => ({}));

// 합성 OpenAI 키(실제 키 아님). 실제 OpenAI 호출은 0이다: 모든 시험은 주입한 send만 쓴다.
const key = "sk-synthetic_GptImageKey0123456789abcdef";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const usage = { input_tokens: 50, input_tokens_details: { text_tokens: 40, image_tokens: 10 }, output_tokens: 823, total_tokens: 873 };
let png: Buffer, wide: Buffer, reference: Buffer;

beforeAll(async () => {
  png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#4a7b6e" } }).png().toBuffer();
  wide = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#4a7b6e" } }).png().toBuffer();
  reference = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#223344" } }).webp().toBuffer();
});

const ok = (body: object, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
const reply = (extra: object = {}) => ok({ created: 1_795_000_000, data: [{ b64_json: png.toString("base64") }], usage, ...extra });

describe("GPT Image 2.6 계약", () => {
  it("생성 모델·원장 목록·키 공급자에 하나씩 더하고, 고정가 판독 목록은 그대로 둔다", () => {
    expect(styleDnaUsageGeneratedModels).toEqual({ "gpt-image-2.6": { label: "GPT Image 2.6", vendor: "OpenAI", provider: "openai",
      providerLabel: "OpenAI", modelId: "gpt-image-2.6-sunburst", size: "1024x1024", aspectRatio: "1:1" } });
    expect(styleDnaGenerationRequestModel.options).toEqual(["seedream-5.5", "flux-2-pro", "gpt-image-2.6"]);
    expect(styleDnaRequestModel.options).toEqual(["seedream-5.5", "flux-2-pro"]);
    expect(styleDnaGenerationProvider.options).toEqual(["byteplus", "bfl", "openai"]);
    expect(styleDnaResultModelLabel("gpt-image-2.6")).toBe("GPT Image 2.6");
    expect(gptImageEstimate()).toEqual({ kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11-27", currency: "USD", unit: "micros" });
  });

  it("요청은 billing usage_based만 받고 금액 칸과 섞이지 않는다(엄격 객체)", () => {
    const base = { requestId: "0190b0b0-0000-7000-8000-00000000a001", authorized: true, credentialVersion: 1, revision: 1 };
    expect(styleDnaGptImageTest.safeParse({ ...base, model: "gpt-image-2.6", billing: "usage_based" }).success).toBe(true);
    expect(styleDnaGptImageTest.safeParse({ ...base, model: "gpt-image-2.6" }).success).toBe(false);
    expect(styleDnaGptImageTest.safeParse({ ...base, model: "gpt-image-2.6", billing: "usage_based", expectedCostMicros: 0 }).success).toBe(false);
    expect(styleDnaGptImageTest.safeParse({ ...base, model: "gpt-image-2.6", billing: "fixed" }).success).toBe(false);
    expect(styleDnaGptImageTest.safeParse({ ...base, model: "gpt-image-2.6", billing: "usage_based", aspectRatio: "16:9" }).success).toBe(false);
    expect(styleDnaGeneratedTest.safeParse({ ...base, model: "seedream-5.5", expectedCostMicros: 20_000, billing: "usage_based" }).success).toBe(false);
    expect(styleDnaFluxTest.safeParse({ ...base, model: "flux-2-pro", expectedCostMicros: 30_000, billing: "usage_based" }).success).toBe(false);
    expect(styleDnaGptImageTestWithReference.safeParse({ ...base, model: "gpt-image-2.6", billing: "usage_based", customReferenceSha256: "a".repeat(64) }).success).toBe(true);
    expect(styleDnaGptImageTestWithReference.safeParse({ ...base, model: "gpt-image-2.6", billing: "usage_based", attachImage: true,
      customReferenceSha256: "a".repeat(64) }).success).toBe(false);
  });
});

describe("GPT Image usage → 실제 금액", () => {
  it("공식 칸이 모두 정수이고 합이 맞으면 단가대로 계산한다(텍스트 5, 이미지 입력 8, 출력 30 micros/토큰)", () => {
    expect(gptImageUsage(usage)).toEqual({ usage: { generatedImages: 1, inputTokens: 40, inputImageTokens: 10, outputTokens: 823 },
      actualCostMicros: 40 * 5 + 10 * 8 + 823 * 30 });
    // 공식 안내서 예: 출력 823토큰 = $0.02469
    expect(gptImageUsage({ ...usage, input_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0 }, total_tokens: 823 }).actualCostMicros).toBe(24_690);
    const detailed = { ...usage, output_tokens_details: { image_tokens: 823, text_tokens: 0 } };
    expect(gptImageUsage(detailed).actualCostMicros).toBe(24_970);
  });

  it("텍스트 출력이 있거나 출력 상세가 어긋나면 토큰만 남기고 금액은 뺀다", () => {
    // 출력 상세가 왔는데 칸이 빠지면({}, 한 칸만) 확인 불충분이다(Tester 반례 msg_72ac1a5869e5).
    for (const output_tokens_details of [{ image_tokens: 800, text_tokens: 23 }, { image_tokens: 800 }, {}, { text_tokens: 0 }, { image_tokens: 823 }]) {
      expect(gptImageUsage({ ...usage, output_tokens_details })).toEqual({ usage: { generatedImages: 1, inputTokens: 40, inputImageTokens: 10, outputTokens: 823 } });
    }
  });

  it("usage가 없거나 칸·합·형식이 다르면 생성 장수만 남긴다(0으로 채우지 않는다)", () => {
    const only = { usage: { generatedImages: 1 } };
    for (const raw of [undefined, null, {}, { ...usage, total_tokens: 900 }, { ...usage, input_tokens: 49 },
      { ...usage, input_tokens_details: { text_tokens: 40 } }, { ...usage, output_tokens: 823.5, total_tokens: 873.5 },
      { ...usage, input_tokens_details: { text_tokens: -1, image_tokens: 51 } }, { input_tokens: 50, output_tokens: 823, total_tokens: 873 }]) {
      expect(gptImageUsage(raw)).toEqual(only);
    }
  });
});

describe("GPT Image 어댑터(합성 전송만)", () => {
  it("참조가 없으면 generations에 Bearer로 한 번 보내고 PNG·usage를 돌려준다", async () => {
    const send = vi.fn<typeof fetch>(async () => reply());
    const result = await createGptImageAdapter(send).generate({ apiKey: key, prompt: "a calm harbor" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe(gptImageGenerationEndpoint);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-image-2.6-sunburst", prompt: "a calm harbor", size: "1024x1024", n: 1, output_format: "png" });
    expect(result.png).toEqual({ sha256: sha(png), width: 1024, height: 1024, byteLength: png.length });
    expect(result.actualCostMicros).toBe(24_970);
    expect(result.usage).toEqual({ generatedImages: 1, inputTokens: 40, inputImageTokens: 10, outputTokens: 823 });
  });

  it("참조 1장은 edits에 base64 data URL 하나로 보낸다", async () => {
    const send = vi.fn<typeof fetch>(async () => reply());
    await createGptImageAdapter(send).generate({ apiKey: key, prompt: "same palette", reference });
    expect(send.mock.calls[0][0]).toBe(gptImageEditEndpoint);
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).images).toEqual([{ image_url: `data:image/webp;base64,${reference.toString("base64")}` }]);
  });

  it("응답에 usage가 없어도 이미지는 받되 금액은 없다", async () => {
    const send = vi.fn<typeof fetch>(async () => ok({ created: 1, data: [{ b64_json: png.toString("base64") }] }));
    const result = await createGptImageAdapter(send).generate({ apiKey: key, prompt: "p" });
    expect(result.usage).toEqual({ generatedImages: 1 });
    expect(result).not.toHaveProperty("actualCostMicros");
  });

  it.each([
    ["429", () => new Response("{}", { status: 429 }), "provider_busy", false],
    ["moderation", () => Response.json({ error: { code: "moderation_blocked", type: "image_generation_user_error" } }, { status: 400 }), "content_rejected", false],
    ["401", () => Response.json({ error: { code: "invalid_api_key" } }, { status: 401 }), "provider_rejected", false],
    ["500", () => new Response("oops", { status: 500 }), "generation_submission_unknown", true],
    ["504", () => new Response("gateway", { status: 504 }), "generation_submission_unknown", true],
    ["408", () => new Response("timeout", { status: 408 }), "generation_submission_unknown", true],
    ["404", () => Response.json({ error: { code: "model_not_found" } }, { status: 404 }), "provider_rejected", false],
    ["url instead of base64", () => ok({ data: [{ url: "https://example.invalid/a.png", b64_json: png.toString("base64") }] }), "invalid_model_response", true],
    ["wrong size", () => ok({ data: [{ b64_json: "" }] }), "invalid_model_response", true],
    ["two images", () => ok({ data: [{ b64_json: png.toString("base64") }, { b64_json: png.toString("base64") }] }), "invalid_model_response", true],
    ["declared size mismatch", () => ok({ size: "1536x1024", data: [{ b64_json: png.toString("base64") }] }), "invalid_model_response", true],
    ["not json", () => new Response(png.toString("base64"), { status: 200, headers: { "content-type": "text/plain" } }), "invalid_model_response", true],
  ] as const)("공급자 응답 %s → %s", async (_name, make, code, keepPending) => {
    const send = vi.fn<typeof fetch>(async () => make());
    const error = await createGptImageAdapter(send).generate({ apiKey: key, prompt: "p" }).catch(caught => caught);
    expect(error).toBeInstanceOf(GptImageGenerationError);
    expect(error).toBeInstanceOf(FluxGenerationError);
    expect(error).toMatchObject({ code, keepPending });
    expect(String(error.message)).not.toContain(key);
  });

  it("1536×1024 PNG는 받지 않는다", async () => {
    const send = vi.fn<typeof fetch>(async () => ok({ data: [{ b64_json: wide.toString("base64") }], usage }));
    await expect(createGptImageAdapter(send).generate({ apiKey: key, prompt: "p" })).rejects.toMatchObject({ code: "invalid_model_response" });
  });

  it("연결 오류·시간 초과는 보냈는지 모르므로 예약을 막아 둔다(다시 보내지 않음)", async () => {
    const lost = vi.fn<typeof fetch>(async () => { throw new TypeError("socket hang up"); });
    await expect(createGptImageAdapter(lost).generate({ apiKey: key, prompt: "p" })).rejects.toMatchObject({ code: "generation_submission_unknown", keepPending: true });
    expect(lost).toHaveBeenCalledTimes(1);
    const slow = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    await expect(createGptImageAdapter(slow, { deadlineMs: 20 }).generate({ apiKey: key, prompt: "p" }))
      .rejects.toMatchObject({ code: "generation_submission_unknown", keepPending: true });
  });

  it("보내기 전 실패는 공급자를 부르지 않는다", async () => {
    const send = vi.fn<typeof fetch>();
    const aborted = AbortSignal.abort();
    for (const input of [{ apiKey: "has space key", prompt: "p" }, { apiKey: key, prompt: "  " }, { apiKey: key, prompt: "x".repeat(32_001) },
      { apiKey: key, prompt: "p", reference: Buffer.alloc(0) }, { apiKey: key, prompt: "p", outerSignal: aborted }]) {
      await expect(createGptImageAdapter(send).generate(input)).rejects.toMatchObject({ code: "generation_not_sent", keepPending: false });
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe("GPT Image 기본 생성기 연결", () => {
  it("생성 키 표의 openai 행만 열고, 다른 공급자 키·버전과 섞지 않는다", async () => {
    const { runtimeImageGenerators } = await import("@/lib/reference-analysis/style-dna-generation-runtime");
    const updatedAt = "2026-11-27T00:00:00.000Z";
    const opened: string[] = [];
    const store = {
      metadata: vi.fn(async () => ({ byteplus: { version: 7, updatedAt }, bfl: { version: 2, updatedAt }, openai: { version: 5, updatedAt } })),
      open: vi.fn(async (_owner: string, provider: string) => { opened.push(provider); return { version: provider === "openai" ? 5 : 1, updatedAt, apiKey: provider + "-key-0123456789" }; }),
      whileCurrent: vi.fn(async (_owner: string, provider: string, version: number, run: () => Promise<unknown>) =>
        provider === "openai" && version === 5 ? run() : undefined),
      write: vi.fn(),
    };
    const send = vi.fn<typeof fetch>();
    const { gptImage } = runtimeImageGenerators({ store: () => store as never, send });
    expect(await gptImage.credentials.metadata?.("owner")).toEqual({ version: 5 });
    expect(await gptImage.credentials.open("owner")).toEqual({ apiKey: "openai-key-0123456789", version: 5 });
    expect(opened).toEqual(["openai"]);
    expect(await gptImage.credentials.whileCurrent("owner", 5, async () => "saved")).toBe("saved");
    expect(await gptImage.credentials.whileCurrent("owner", 7, async () => "saved")).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
