import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeedreamAdapter, seedreamEndpoint, seedreamEstimate, seedreamFailureStatus, seedreamModelId,
  SeedreamGenerationError } from "@/lib/reference-analysis/style-dna-seedream-provider";

vi.mock("server-only", () => ({}));

const key = "seedream-fixture-key";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
};
// IHDR 바로 뒤에 청크를 끼운다(CRC는 올바르게 계산).
const insertAfterHeader = (png: Buffer, extra: Buffer) => Buffer.concat([png.subarray(0, 33), extra, png.subarray(33)]);
const solidPng = (width = 1024, height = 1024) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 90, b: 40 } } }).png().toBuffer();
const body = (b64: string, overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => JSON.stringify({
  model: seedreamModelId, created: 1_784_696_685, usage: { generated_images: 1, output_tokens: 4096, total_tokens: 4096 },
  data: [{ b64_json: b64, size: "1024x1024", output_format: "png", ...item }], ...overrides,
});
const ok = (text: string, headers: Record<string, string> = {}) => new Response(text, { status: 200, headers: { "content-type": "application/json", ...headers } });
type Call = { url: string; init: RequestInit };
function provider(respond: (call: Call) => Promise<Response> | Response, deadlineMs?: number) {
  const calls: Call[] = [];
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { adapter: createSeedreamAdapter(send, { deadlineMs }), calls };
}
async function failure(run: Promise<unknown>) {
  const error = await run.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SeedreamGenerationError);
  const { code, submission, providerStatus } = error as SeedreamGenerationError;
  return { code, submission, providerStatus };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Seedream 5.5 견적", () => {
  it("1024×1024 PNG 한 장은 참조 0장 20000, 1장 28000 USD micros이고 상한이 없다", () => {
    expect(seedreamEstimate(0)).toEqual({ priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", referenceCount: 0,
      outputMicros: 20_000, referenceMicros: 0, totalMicros: 20_000 });
    expect(seedreamEstimate(1)).toMatchObject({ referenceCount: 1, outputMicros: 20_000, referenceMicros: 8_000, totalMicros: 28_000 });
    // 가격표 경계: 2048×2048(4,194,304 픽셀)은 두 번째 구간 35000, 문서 범위 밖 크기는 견적 자체를 거절한다.
    expect(seedreamEstimate(1, { width: 2048, height: 2048 }).totalMicros).toBe(43_000);
    expect(() => seedreamEstimate(0, { width: 512, height: 512 })).toThrow();
    expect(() => seedreamEstimate(0, { width: 2304, height: 2304 })).toThrow();
    expect(Number.isInteger(seedreamEstimate(1).totalMicros)).toBe(true);
  });
});

describe("Seedream 5.5 합성 공급자 요청과 응답", () => {
  it("공식 모델 ID와 고정 규격으로 한 번만 보내고, PNG를 검증해 정규화 WebP를 돌려준다", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("대역 밖 연결 금지"); });
    const png = await solidPng();
    const { adapter, calls } = provider(() => ok(body(png.toString("base64"))));
    const reference = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#123456" } }).webp().toBuffer();
    const result = await adapter.generate({ apiKey: key, prompt: "A red bicycle on a quiet street.", reference });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(seedreamEndpoint);
    expect(calls[0].url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations");
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
    expect(calls[0].init.headers).toEqual({ "content-type": "application/json", authorization: `Bearer ${key}` });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "dola-seedream-5-5-261028", prompt: "A red bicycle on a quiet street.", size: "1024x1024", output_format: "png",
      response_format: "b64_json", background: "opaque", watermark: false, stream: false,
      image: `data:image/webp;base64,${reference.toString("base64")}`,
    });
    expect(result.png).toEqual({ sha256: sha(png), width: 1024, height: 1024, byteLength: png.length });
    expect(result.image).toMatchObject({ mime: "image/webp", width: 1024, height: 1024 });
    expect(result.image.bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(result.image.sha256).toBe(sha(result.image.bytes));
    expect(result.image.sha256).not.toBe(result.png.sha256);
    expect(result.usage).toEqual({ generatedImages: 1, outputTokens: 4096 });
  });

  it("참조가 없으면 image 필드를 보내지 않는다", async () => {
    const png = await solidPng();
    const { adapter, calls } = provider(() => ok(body(png.toString("base64"))));
    await adapter.generate({ apiKey: key, prompt: "Plain prompt" });
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("image");
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("sequential_image_generation");
  });

  it("잘못된 응답은 모두 제출된 상태의 invalid_model_response로 거절한다", async () => {
    const png = await solidPng();
    const b64 = png.toString("base64");
    const jpeg = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const small = await solidPng(512, 512);
    const wide = await solidPng(1280, 800);
    const badCrc = Buffer.from(png); badCrc[40] ^= 0xff;
    const animated = insertAfterHeader(png, chunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])));
    // tEXt 청크로 길이를 맞춰 패딩이 생기게 한 뒤 패딩 앞 글자의 남는 비트를 바꾼다(디코드 결과는 같고 표기만 비정규).
    let padded = png;
    for (let size = 1; size < 4 && Buffer.from(padded).toString("base64").endsWith("=") === false; size++) {
      padded = insertAfterHeader(png, chunk("tEXt", Buffer.from("k\0" + "v".repeat(size))));
    }
    const paddedB64 = padded.toString("base64");
    expect(paddedB64.endsWith("=")).toBe(true);
    const cut = paddedB64.indexOf("=");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const flipped = alphabet[alphabet.indexOf(paddedB64[cut - 1]) ^ 1];
    const nonCanonical = paddedB64.slice(0, cut - 1) + flipped + paddedB64.slice(cut);
    expect(nonCanonical).not.toBe(paddedB64);
    expect(Buffer.from(nonCanonical, "base64").equals(padded)).toBe(true);
    const cases: [string, string][] = [
      ["JSON 아님", "not json"],
      ["다른 모델", body(b64, { model: "seedream-4-0-250828" })],
      ["이미지 두 장", JSON.stringify({ ...JSON.parse(body(b64)), data: [{ b64_json: b64, size: "1024x1024" }, { b64_json: b64, size: "1024x1024" }] })],
      ["이미지 없음", JSON.stringify({ ...JSON.parse(body(b64)), data: [] })],
      ["URL 응답", body(b64, {}, { url: "https://example.invalid/image.png" })],
      ["장별 오류", body(b64, {}, { error: { code: "OutputImageSensitiveContentDetected", message: "x" } })],
      ["요청 오류 동반", body(b64, { error: { code: "InternalServiceError", message: "x" } })],
      ["생성 수 2", body(b64, { usage: { generated_images: 2 } })],
      ["빈 Base64", body("")],
      ["잘린 Base64", body(b64.slice(0, -1))],
      ["개행 포함 Base64", body(b64.slice(0, 76) + "\n" + b64.slice(76))],
      ["비정규 Base64 패딩", body(nonCanonical)],
      ["PNG 아님(JPEG)", body(jpeg.toString("base64"))],
      ["형식 속임(jpeg 표기)", body(b64, {}, { output_format: "jpeg" })],
      ["크기 표기 속임", body(small.toString("base64"))],
      ["크기 필드 다름", body(b64, {}, { size: "2048x2048" })],
      ["실제 크기 다름(1280×800)", body(wide.toString("base64"))],
      ["잘린 PNG", body(png.subarray(0, png.length - 20).toString("base64"))],
      ["IEND 뒤 남는 바이트", body(Buffer.concat([png, Buffer.from([0])]).toString("base64"))],
      ["CRC 오류", body(badCrc.toString("base64"))],
      ["애니메이션 PNG(acTL)", body(animated.toString("base64"))],
    ];
    for (const [name, text] of cases) {
      const { adapter, calls } = provider(() => ok(text));
      expect({ name, ...await failure(adapter.generate({ apiKey: key, prompt: "p" })) })
        .toEqual({ name, code: "invalid_model_response", submission: "submitted", providerStatus: 200 });
      expect(calls).toHaveLength(1);
    }
  });

  it("본문 길이 상한을 선언 길이와 실제 스트림 모두에서 지킨다", async () => {
    const limit = 4 * Math.ceil(6 * 1024 * 1024 / 3) + 64 * 1024;
    const declared = provider(() => ok("{}", { "content-length": String(limit + 1) }));
    expect(await failure(declared.adapter.generate({ apiKey: key, prompt: "p" }))).toMatchObject({ code: "invalid_model_response", submission: "submitted" });
    const streamed = provider(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(limit)); controller.enqueue(new Uint8Array(1)); controller.close(); },
    }), { status: 200 }));
    expect(await failure(streamed.adapter.generate({ apiKey: key, prompt: "p" }))).toMatchObject({ code: "invalid_model_response", submission: "submitted" });
  });
});

describe("Seedream 5.5 제출 상태 구분", () => {
  it("보내기 전 실패는 공급자 요청 없이 not_sent로 남는다", async () => {
    const reference = Buffer.alloc(30 * 1024 * 1024 + 1);
    const aborted = new AbortController(); aborted.abort();
    for (const [input, signal] of [
      [{ apiKey: "", prompt: "p" }, undefined],
      [{ apiKey: "bad key", prompt: "p" }, undefined],
      [{ apiKey: key, prompt: "  " }, undefined],
      [{ apiKey: key, prompt: "p", reference }, undefined],
      [{ apiKey: key, prompt: "p", reference: Buffer.alloc(0) }, undefined],
      [{ apiKey: key, prompt: "p" }, aborted.signal],
    ] as const) {
      const { adapter, calls } = provider(() => { throw new Error("호출되면 안 됨"); });
      expect(await failure(adapter.generate(input, signal))).toEqual({ code: "generation_not_sent", submission: "not_sent", providerStatus: undefined });
      expect(calls).toHaveLength(0);
    }
  });

  it("연결 오류와 응답 전 시간 초과는 제출 불명, 응답 뒤 본문 유실은 결과 유실로 구분한다", async () => {
    const refused = provider(() => { throw new TypeError("fetch failed"); });
    expect(await failure(refused.adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "generation_submission_unknown", submission: "unknown", providerStatus: undefined });

    const hung = provider(({ init }) => new Promise<Response>((_, reject) =>
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })), 50);
    expect(await failure(hung.adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "generation_submission_unknown", submission: "unknown", providerStatus: undefined });
    expect(hung.calls).toHaveLength(1);

    const broken = provider(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("{\"model\":")); controller.error(new Error("reset")); },
    }), { status: 200 }));
    expect(await failure(broken.adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "generation_result_lost", submission: "submitted", providerStatus: 200 });

    const stalled = provider(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([123])); } }),
      { status: 200 }), 50);
    expect(await failure(stalled.adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "generation_result_lost", submission: "submitted", providerStatus: 200 });
  });

  it("공급자 오류 응답은 제출된 실패로 분류하고 본문을 짧게만 읽는다", async () => {
    const reply = (status: number, code?: string) => provider(() => new Response(code ? JSON.stringify({ error: { code, message: "m" } }) : "",
      { status, headers: { "content-type": "application/json" } }));
    expect(await failure(reply(400, "OutputImageSensitiveContentDetected.PolicyViolation").adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "content_rejected", submission: "submitted", providerStatus: 400 });
    expect(await failure(reply(400, "InputTextSensitiveContentDetected").adapter.generate({ apiKey: key, prompt: "p" })))
      .toMatchObject({ code: "content_rejected" });
    expect(await failure(reply(400, "InvalidParameter").adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "provider_rejected", submission: "submitted", providerStatus: 400 });
    expect(await failure(reply(429, "RateLimitExceeded.EndpointRPMExceeded").adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "provider_busy", submission: "submitted", providerStatus: 429 });
    expect(await failure(reply(500).adapter.generate({ apiKey: key, prompt: "p" })))
      .toEqual({ code: "provider_rejected", submission: "submitted", providerStatus: 500 });
    expect(await failure(reply(401, "AuthenticationError").adapter.generate({ apiKey: key, prompt: "p" })))
      .toMatchObject({ code: "provider_rejected", providerStatus: 401 });
    expect(seedreamFailureStatus).toEqual({ generation_not_sent: 503, generation_submission_unknown: 504, generation_result_lost: 504,
      content_rejected: 422, provider_busy: 429, provider_rejected: 502, invalid_model_response: 502 });
  });
});
