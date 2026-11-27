import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiCredentialStore } from "@/lib/reference-analysis/analysis-credential-store";
import { isBoundTest } from "@/components/admin/style-dna-client";
import { styleDnaGeneratedTest, styleDnaPath, type StyleDnaRecord, type StyleDnaTestResult } from "@/lib/reference-analysis/style-dna-contract";
import { createStyleDnaHttp } from "@/lib/reference-analysis/style-dna-http";
import type { StyleDnaProvider } from "@/lib/reference-analysis/style-dna-provider";
import { createSeedreamAdapter, seedreamModelId, type SeedreamCredentials } from "@/lib/reference-analysis/style-dna-seedream-provider";
import type { StyleDnaStore } from "@/lib/reference-analysis/style-dna-store";

vi.mock("server-only", () => ({}));

const origin = "https://studio.example.invalid";
const owner = "10000000-0000-4000-8000-000000000011";
const other = "10000000-0000-4000-8000-000000000022";
const recordId = "0190b0b0-0000-7000-8000-00000000c001";
const previousTestId = "0190b0b0-0000-7000-8000-00000000c002";
const apiKey = "seedream-fixture-key";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const route = { params: Promise.resolve({ id: recordId }) };
type Outcome = Awaited<ReturnType<StyleDnaStore["finish"]>>;
type Change = Parameters<StyleDnaStore["finish"]>[2];
type SeedreamTest = StyleDnaTestResult & { generation: Record<string, unknown> } & { model: string };

let png: Buffer;
let originalWebp: Buffer;
let previousWebp: Buffer;
beforeEach(async () => {
  png ??= await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
  originalWebp ??= await sharp({ create: { width: 96, height: 64, channels: 3, background: "#aa5500" } }).webp().toBuffer();
  previousWebp ??= await sharp({ create: { width: 64, height: 64, channels: 3, background: "#00aa55" } }).webp().toBuffer();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const media = (bytes: Buffer, href: string) => ({ mime: "image/webp" as const, width: 1, height: 1, sha256: sha(bytes), palette: [], href });

// 실제 style-dna-store.ts의 reserve/finish 규칙(같은 키·입력 재응답과 201→200, 다른 입력 409, 결과 전 202, 결과가 있으면 finish 거절,
// 레코드가 없으면 404)을 그대로 옮긴 메모리 저장소. 소유자별로 기록·미디어를 나눈다.
function memoryStore() {
  const records = new Map<string, StyleDnaRecord>();
  const mediaRows = new Map<string, Buffer>();
  const requests = new Map<string, { hash: string; outcome?: Outcome }>();
  const hooks = { rejectTestSave: 0, rejectFailureSave: 0, finishCalls: [] as Change[] };
  const k = (...parts: string[]) => parts.join("|");
  const fail = (code: string, status: number): Outcome => ({ status, body: { code } });
  const record: StyleDnaRecord = {
    id: recordId, title: "해 질 녘 골목", revision: 2, mode: "replicate", original: media(originalWebp, `${styleDnaPath}/${recordId}/media/original`),
    createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z",
    options: { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel: "seedream-5.5" },
    result: { schemaVersion: 1, status: "ready", media: "image", proposals: [] },
    semantic: { status: "partial", provider: "gemini", findings: [], prompts: { en: "A warm alley at dusk with [INSERT SUBJECT HERE]." } },
    revisions: [
      { revision: 1, prompts: { en: "An old prompt with [INSERT SUBJECT HERE]." }, createdAt: "2026-11-25T00:00:00.000Z" },
      { revision: 2, prompts: { en: "A warm alley at dusk with [INSERT SUBJECT HERE]." }, createdAt: "2026-11-25T00:00:01.000Z" },
    ],
    tests: [{ id: previousTestId, revision: 1, model: "gemini-nano-banana-2.1", createdAt: "2026-11-25T00:00:02.000Z",
      original: media(originalWebp, `${styleDnaPath}/${recordId}/media/original`), image: media(previousWebp, `${styleDnaPath}/${recordId}/media/${previousTestId}`) }],
  };
  records.set(k(owner, recordId), record);
  mediaRows.set(k(owner, recordId, recordId), originalWebp);
  mediaRows.set(k(owner, recordId, previousTestId), previousWebp);
  const store = {
    reserve: vi.fn(async (actor: string, id: string, inputHash: string, required?: string) => {
      const available = !required || records.has(k(actor, required));
      const row = requests.get(k(actor, id));
      if (!row) {
        requests.set(k(actor, id), { hash: inputHash, ...(!available && { outcome: fail("not_found", 404) }) });
        return available ? undefined : fail("not_found", 404);
      }
      if (row.hash !== inputHash) return fail("request_conflict", 409);
      if (!available) return fail("not_found", 404);
      if (!row.outcome) return fail("in_progress", 202);
      return { ...row.outcome, status: row.outcome.status === 201 ? 200 : row.outcome.status };
    }),
    finish: vi.fn(async (actor: string, id: string, change: Change, required?: string) => {
      hooks.finishCalls.push(change);
      const row = requests.get(k(actor, id));
      if (!row || row.outcome) throw new Error("Invalid Style DNA request state");
      if (change.kind === "test" && hooks.rejectTestSave > 0) { hooks.rejectTestSave--; throw new Error("save rejected"); }
      if (change.kind === "failure" && hooks.rejectFailureSave > 0) { hooks.rejectFailureSave--; throw new Error("save rejected"); }
      const current = required ? records.get(k(actor, required)) : undefined;
      let outcome: Outcome;
      if (required && !current) outcome = fail("not_found", 404);
      else if (change.kind === "failure") outcome = change.outcome;
      else if (change.kind === "test" && current) {
        current.tests = [...current.tests, change.test];
        current.updatedAt = change.test.createdAt;
        mediaRows.set(k(actor, current.id, change.test.id), change.image);
        outcome = { status: 201, body: { test: change.test } };
      } else throw new Error("Unexpected change");
      row.outcome = structuredClone(outcome);
      return outcome;
    }),
    get: vi.fn(async (actor: string, id: string) => structuredClone(records.get(k(actor, id)))),
    media: vi.fn(async (actor: string, id: string, key: string) => mediaRows.get(k(actor, id, key))),
    list: vi.fn(async () => []), remove: vi.fn(), compare: vi.fn(),
  };
  return { store: store as unknown as StyleDnaStore, records, mediaRows, requests, hooks, record: () => records.get(k(owner, recordId))! };
}

function seedreamProvider() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let respond: () => Promise<Response> | Response = () => new Response(JSON.stringify({
    model: seedreamModelId, created: 1_784_696_685, usage: { generated_images: 1, output_tokens: 4096, total_tokens: 4096 },
    data: [{ b64_json: png.toString("base64"), size: "1024x1024", output_format: "png" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, adapter: createSeedreamAdapter(send, { deadlineMs: 2000 }), setResponse: (next: typeof respond) => { respond = next; } };
}

function harness(options: { auth?: string; seedream?: boolean } = {}) {
  const memory = memoryStore();
  const provider = seedreamProvider();
  const credential = { version: 5 };
  const credentials: SeedreamCredentials = {
    open: vi.fn(async (actor: string) => actor === owner || actor === other ? { apiKey, version: credential.version } : undefined),
    whileCurrent: vi.fn(async (_actor, version, run) => version === credential.version ? run() : undefined),
  };
  const geminiTest: StyleDnaProvider["test"] = vi.fn(async () => ({ bytes: previousWebp, mime: "image/webp" as const, width: 64, height: 64,
    sha256: sha(previousWebp), palette: [] }));
  const gemini = { group: "reference" as const, models: { image: "gemini-fixture-image" }, version: 3, updatedAt: "2026-11-25T00:00:00Z", lastTest: {} };
  const http = createStyleDnaHttp({
    authenticate: async () => ({ kind: "verified", userId: options.auth ?? owner, email: "owner@example.invalid" }),
    env: { DREAM_SITE_URL: origin },
    store: () => memory.store,
    credentials: (): GeminiCredentialStore => ({ open: async () => ({ ...gemini, apiKey: "gemini-fixture-key" }), metadata: async () => [gemini],
      write: vi.fn(), recordTest: vi.fn() }),
    engineCredentials: () => null,
    provider: { analyze: vi.fn(), refine: vi.fn(), test: geminiTest },
    ...(options.seedream !== false && { imageGenerators: { seedream: { credentials, adapter: provider.adapter } } }),
  });
  return { http, memory, provider, credential, credentials, geminiTest };
}

// 실제 제품 경로는 POST /api/admin/style-dna/{id}/test-image(app/api/admin/style-dna/[id]/test-image/route.ts)다.
const json = (body: object) => new Request(`${origin}${styleDnaPath}/${recordId}/test-image`, {
  method: "POST", headers: { origin, host: new URL(origin).host, "content-type": "application/json" }, body: JSON.stringify(body),
});
const seedreamBody = (extra: Record<string, unknown> = {}) => ({ requestId: "0190b0b0-0000-4000-8000-0000000000a1", authorized: true,
  credentialVersion: 5, revision: 2, model: "seedream-5.5", subject: "a red bicycle", expectedCostMicros: 20_000, ...extra });
async function read(response: Response) { return { status: response.status, body: await response.json() as Record<string, unknown> }; }

describe("Seedream 5.5 시험 생성 HTTP(합성 공급자)", () => {
  it("주입이 없으면 기본 앱은 Gemini 두 모델과 프롬프트 대상 그대로이고 Seedream 요청을 받지 않는다", async () => {
    const { http, provider, memory } = harness({ seedream: false });
    const listed = await read(await http.list());
    const settings = listed.body.settings as { testModels: { id: string }[]; promptTargets: { id: string; testable: boolean }[] };
    expect(settings.testModels.map(item => item.id)).toEqual(["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image"]);
    expect(settings.promptTargets.map(item => [item.id, item.testable])).toEqual([
      ["gemini-nano-banana-2.1", true], ["gemini-3.1-flash-lite-image", true], ["gpt-image-2.6", false], ["flux-2", false],
      ["mai-image-2.7", false], ["seedream-5.5", false], ["kling-image-4.0", false]]);
    expect(settings).not.toHaveProperty("generationModels");
    expect(await read(await http.test(json(seedreamBody()), route))).toEqual({ status: 400, body: { code: "invalid_input" } });
    expect(provider.calls).toHaveLength(0);
    expect(memory.store.reserve).not.toHaveBeenCalled();
  });

  it("목록: 주입된 서버에서 소유자 키가 준비된 경우에만 Seedream을 생성 모델로 싣고, 키 원문 없이 등록 버전·참조 0/1장 견적만 낸다", async () => {
    const ready = harness();
    const listed = await read(await ready.http.list());
    const settings = listed.body.settings as Record<string, unknown> & { testModels: { id: string }[]; promptTargets: { id: string; testable: boolean }[] };
    expect(settings.generationModels).toEqual([{ id: "seedream-5.5", label: "Seedream 5.5", vendor: "ByteDance", provider: "byteplus",
      modelId: "dola-seedream-5-5-261028", size: "1024x1024", aspectRatio: "1:1", credentialVersion: 5,
      estimate: { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", withoutReference: 20_000, withReference: 28_000 } }]);
    // 기존 Gemini 시험 모델·프롬프트 전용 대상(testable false)은 그대로다.
    expect(settings.testModels.map(item => item.id)).toEqual(["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image"]);
    expect(settings.promptTargets.find(item => item.id === "seedream-5.5")?.testable).toBe(false);
    expect(JSON.stringify(listed.body)).not.toContain(apiKey);
    expect(ready.provider.calls).toHaveLength(0);
    const missing = harness();
    missing.credentials.open = vi.fn(async () => undefined);
    expect((await read(await missing.http.list())).body.settings).toMatchObject({ generationModels: [] });
    const broken = harness();
    broken.credentials.open = vi.fn(async () => { throw new Error("credential store down"); });
    expect((await read(await broken.http.list())).body.settings).toMatchObject({ generationModels: [] });
    const stranger = harness({ auth: "10000000-0000-4000-8000-000000000033" });
    expect((await read(await stranger.http.list())).body.settings).toMatchObject({ generationModels: [] });
  });

  it("참조 없이 성공하면 기록·리비전·키 버전·견적을 남기고 WebP를 보호 미디어로만 낸다", async () => {
    const { http, provider, memory } = harness();
    const response = await read(await http.test(json(seedreamBody()), route));
    expect(response.status).toBe(201);
    const test = response.body.test as SeedreamTest;
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].body).not.toHaveProperty("image");
    expect(provider.calls[0].body.prompt).toBe("A warm alley at dusk with a red bicycle.\nSubject: a red bicycle");
    expect(test).toMatchObject({ revision: 2, model: "seedream-5.5", basis: { promptMode: "revision", aspectRatio: "1:1", credentialVersion: 5,
      reference: { kind: "none" }, promptSha256: sha(String(provider.calls[0].body.prompt)) } });
    expect(test.generation).toEqual({ provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024",
      png: { sha256: sha(png), width: 1024, height: 1024, byteLength: png.length }, usage: { generatedImages: 1, outputTokens: 4096 },
      estimate: { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", referenceCount: 0, outputMicros: 20_000,
        referenceMicros: 0, totalMicros: 20_000 }, billing: "unconfirmed" });
    expect(test.image).toMatchObject({ mime: "image/webp", width: 1024, height: 1024, href: `${styleDnaPath}/${recordId}/media/${test.id}` });
    // 화면 결과 검사(F1): 실제 처리기 응답은 이 기록·이 결과 ID에 묶여 통과하고, 다른 기록으로 읽으면 거절한다.
    expect(isBoundTest(test, recordId, 2)).toBe(true);
    expect(isBoundTest(test, previousTestId, 2)).toBe(false);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toMatch(/https?:\/\/|b64_json|bytepluses/);
    expect(memory.record().tests.map(item => item.id)).toEqual([previousTestId, test.id]);

    const streamed = await http.media({ params: Promise.resolve({ id: recordId, media: test.id }) });
    expect(streamed.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await streamed.arrayBuffer());
    expect(sha(bytes)).toBe(test.image.sha256);
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    const stranger = harness({ auth: other });
    stranger.memory.mediaRows.set(`${owner}|${recordId}|${test.id}`, bytes);
    expect((await stranger.http.media({ params: Promise.resolve({ id: recordId, media: test.id }) })).status).toBe(404);
  });

  it("원본 첨부와 업로드 참조는 한 장으로 28000 micros이고 정규화 WebP를 data URI로 보낸다", async () => {
    const attached = harness();
    const response = await read(await attached.http.test(json(seedreamBody({ attachImage: true, expectedCostMicros: 28_000 })), route));
    expect(response.status).toBe(201);
    expect(attached.provider.calls[0].body.image).toBe(`data:image/webp;base64,${originalWebp.toString("base64")}`);
    expect((response.body.test as SeedreamTest).basis?.reference).toEqual({ kind: "original", sha256: sha(originalWebp) });
    expect((response.body.test as SeedreamTest).generation.estimate).toMatchObject({ referenceCount: 1, totalMicros: 28_000 });

    const uploaded = harness();
    const file = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#334455" } }).png().toBuffer();
    const form = new FormData();
    form.set("customReference", new File([new Uint8Array(file)], "style.png", { type: "image/png" }));
    form.set("options", JSON.stringify({ ...seedreamBody({ requestId: "0190b0b0-0000-4000-8000-0000000000a2", expectedCostMicros: 28_000 }),
      customReferenceSha256: sha(file) }));
    const multipart = await read(await uploaded.http.test(new Request(`${origin}${styleDnaPath}/${recordId}/test-image`, {
      method: "POST", headers: { origin, host: new URL(origin).host }, body: form }), route));
    expect(multipart.status).toBe(201);
    const reference = (multipart.body.test as SeedreamTest).basis?.reference;
    expect(reference).toMatchObject({ kind: "upload", sourceSha256: sha(file) });
    expect(String(uploaded.provider.calls[0].body.image)).toMatch(/^data:image\/webp;base64,/);
    expect(sha(Buffer.from(String(uploaded.provider.calls[0].body.image).split(",")[1], "base64"))).toBe((reference as { sha256: string }).sha256);
  });

  it("누르기 전 금액과 다르면 예약 전에 409로 멈추고, 장당 상한으로 막지는 않는다", async () => {
    const { http, provider, memory } = harness();
    expect(await read(await http.test(json(seedreamBody({ expectedCostMicros: 28_000 })), route))).toEqual({ status: 409,
      body: { code: "estimate_changed", estimate: { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros",
        referenceCount: 0, outputMicros: 20_000, referenceMicros: 0, totalMicros: 20_000 } } });
    expect(await read(await http.test(json(seedreamBody({ aspectRatio: "16:9" })), route))).toEqual({ status: 400, body: { code: "invalid_input" } });
    // F1: 고정 1,000달러 상한 없음 — 그보다 큰 안전 정수도 형식은 통과하고, 서버 산정액과 다르므로 같은 409로 돌려준다.
    for (const expected of [1_000_000_001, Number.MAX_SAFE_INTEGER]) {
      expect(styleDnaGeneratedTest.safeParse(seedreamBody({ expectedCostMicros: expected })).success).toBe(true);
      expect(await read(await http.test(json(seedreamBody({ requestId: `0190b0b0-0000-4000-8000-${String(expected).slice(-12).padStart(12, "0")}`,
        expectedCostMicros: expected })), route))).toMatchObject({ status: 409, body: { code: "estimate_changed", estimate: { totalMicros: 20_000 } } });
    }
    // 안전 정수 밖·분수·음수·문자는 형식 오류(400)다.
    for (const bad of [Number.MAX_SAFE_INTEGER + 1, 2 ** 60, 20_000.5, -1, "20000", null]) {
      expect(styleDnaGeneratedTest.safeParse(seedreamBody({ expectedCostMicros: bad })).success).toBe(false);
      expect(await read(await http.test(json(seedreamBody({ expectedCostMicros: bad })), route))).toEqual({ status: 400, body: { code: "invalid_input" } });
    }
    expect(provider.calls).toHaveLength(0);
    expect(memory.store.reserve).not.toHaveBeenCalled();
  });

  it("같은 키 재접수와 동시 실행에서 공급자 POST는 한 번이고, 같은 키 다른 입력은 409다", async () => {
    const { http, provider } = harness();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    provider.setResponse(async () => {
      await gate;
      return new Response(JSON.stringify({ model: seedreamModelId, created: 1, usage: { generated_images: 1 },
        data: [{ b64_json: png.toString("base64"), size: "1024x1024" }] }), { status: 200 });
    });
    const first = http.test(json(seedreamBody()), route);
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    const concurrent = await read(await http.test(json(seedreamBody()), route));
    expect(concurrent).toEqual({ status: 202, body: { code: "in_progress" } });
    release();
    const created = await read(await first);
    expect(created.status).toBe(201);
    const replay = await read(await http.test(json(seedreamBody()), route));
    expect(replay).toEqual({ status: 200, body: created.body });
    expect(await read(await http.test(json(seedreamBody({ subject: "a blue kite" })), route)))
      .toEqual({ status: 409, body: { code: "request_conflict" } });
    expect(provider.calls).toHaveLength(1);
  });

  it("응답 유실은 제출 불명으로 기록되고, 같은 키 재접수에도 자동 POST가 없다", async () => {
    const { http, provider, memory } = harness();
    provider.setResponse(() => { throw new TypeError("socket hang up"); });
    const lost = await read(await http.test(json(seedreamBody()), route));
    expect(lost).toEqual({ status: 504, body: { code: "generation_submission_unknown" } });
    expect(await read(await http.test(json(seedreamBody()), route))).toEqual(lost);
    expect(provider.calls).toHaveLength(1);
    expect(memory.record().tests.map(item => item.id)).toEqual([previousTestId]);
    expect(console.warn).toHaveBeenCalledWith("style_dna_generation_failed",
      { code: "generation_submission_unknown", submission: "unknown", providerStatus: undefined });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(apiKey);

    // 보내기 전 실패(여기서는 저장된 키 형식 오류)는 공급자 요청 없이 다른 코드로 기록된다.
    const notSent = harness();
    notSent.credentials.open = vi.fn(async () => ({ apiKey: "bad key", version: 5 }));
    const refused = await read(await notSent.http.test(json(seedreamBody()), route));
    expect(refused).toEqual({ status: 503, body: { code: "generation_not_sent" } });
    expect(await read(await notSent.http.test(json(seedreamBody()), route))).toEqual(refused);
    expect(notSent.provider.calls).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith("style_dna_generation_failed",
      { code: "generation_not_sent", submission: "not_sent", providerStatus: undefined });
  });

  it("키 없음·키 버전 다름·타 계정·없는 리비전은 공급자 요청이 없다", async () => {
    const stranger = harness({ auth: other });
    expect(await read(await stranger.http.test(json(seedreamBody()), route))).toEqual({ status: 404, body: { code: "not_found" } });
    const stale = harness();
    expect(await read(await stale.http.test(json(seedreamBody({ credentialVersion: 4 })), route))).toEqual({ status: 409, body: { code: "stale_credential" } });
    const revision = harness();
    expect(await read(await revision.http.test(json(seedreamBody({ revision: 3 })), route))).toEqual({ status: 409, body: { code: "stale_revision" } });
    const missing = harness();
    missing.credentials.open = vi.fn(async () => undefined);
    expect(await read(await missing.http.test(json(seedreamBody()), route))).toEqual({ status: 503, body: { code: "not_configured" } });
    for (const item of [stranger, stale, revision, missing]) {
      expect(item.provider.calls).toHaveLength(0);
      expect(item.memory.record().tests).toHaveLength(1);
    }
  });

  it("잘못된 응답·생성 중 키 교체·저장 거절은 이전 성공본을 그대로 두고, 같은 키 재접수에 POST가 없다", async () => {
    const invalid = harness();
    invalid.provider.setResponse(() => new Response(JSON.stringify({ model: seedreamModelId, created: 1, usage: { generated_images: 1 },
      data: [{ b64_json: png.subarray(0, 100).toString("base64"), size: "1024x1024" }] }), { status: 200 }));
    expect(await read(await invalid.http.test(json(seedreamBody()), route))).toEqual({ status: 502, body: { code: "invalid_model_response" } });

    const rotated = harness();
    const base = JSON.stringify({ model: seedreamModelId, created: 1, usage: { generated_images: 1 },
      data: [{ b64_json: png.toString("base64"), size: "1024x1024" }] });
    rotated.provider.setResponse(() => { rotated.credential.version = 6; return new Response(base, { status: 200 }); });
    expect(await read(await rotated.http.test(json(seedreamBody()), route))).toEqual({ status: 409, body: { code: "stale_credential" } });

    const rejected = harness();
    rejected.memory.hooks.rejectTestSave = 1;
    expect(await read(await rejected.http.test(json(seedreamBody()), route))).toEqual({ status: 503, body: { code: "storage_unavailable" } });
    expect(await read(await rejected.http.test(json(seedreamBody()), route))).toEqual({ status: 503, body: { code: "storage_unavailable" } });

    const stuck = harness();
    stuck.memory.hooks.rejectTestSave = 1;
    stuck.memory.hooks.rejectFailureSave = 1;
    expect((await stuck.http.test(json(seedreamBody()), route)).status).toBe(503);
    // 결과도 실패도 저장하지 못하면 요청은 미확정(202)으로 남고, 임대·회수가 없어 다시 보내지 않는다.
    expect(await read(await stuck.http.test(json(seedreamBody()), route))).toEqual({ status: 202, body: { code: "in_progress" } });

    for (const item of [invalid, rotated, rejected, stuck]) {
      expect(item.provider.calls).toHaveLength(1);
      expect(item.memory.record().tests.map(test => test.id)).toEqual([previousTestId]);
      expect([...item.memory.mediaRows.keys()]).toEqual([`${owner}|${recordId}|${recordId}`, `${owner}|${recordId}|${previousTestId}`]);
    }
  });

  it("생성기가 주입돼도 Gemini 시험은 기존 경로와 자격을 그대로 쓴다", async () => {
    const { http, provider, geminiTest } = harness();
    const response = await read(await http.test(json({ requestId: "0190b0b0-0000-4000-8000-0000000000b1", authorized: true, credentialVersion: 3,
      revision: 2, model: "gemini-nano-banana-2.1", subject: "a red bicycle" }), route));
    expect(response.status).toBe(201);
    expect((response.body.test as StyleDnaTestResult).model).toBe("gemini-nano-banana-2.1");
    expect(response.body.test).not.toHaveProperty("generation");
    expect(isBoundTest(response.body.test, recordId, 2)).toBe(true);
    expect(geminiTest).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("운영 연결: 목록 복호화 없음과 두 DB 확정 경계(같은 요청 영수증 재조회)", () => {
  // 메모리 저장소에 실제 store.receipt와 같은 규칙(영수증 결과만 읽음, 쓰기 없음)을 붙인다.
  function withReceipt(item: ReturnType<typeof harness>, fail = false) {
    const receipt = vi.fn(async (actor: string, id: string) => {
      if (fail) throw new Error("receipt read failed");
      const row = item.memory.requests.get(`${actor}|${id}`);
      return row ? { outcome: row.outcome ? structuredClone(row.outcome) : null } : undefined;
    });
    Object.assign(item.memory.store, { receipt });
    return receipt;
  }

  it("목록은 metadata가 있으면 그것만 읽고 키를 열지 않는다", async () => {
    const item = harness();
    item.credentials.metadata = vi.fn(async () => ({ version: 7 }));
    const listed = await read(await item.http.list());
    expect((listed.body.settings as { generationModels: { credentialVersion: number }[] }).generationModels.map(row => row.credentialVersion)).toEqual([7]);
    expect(item.credentials.open).not.toHaveBeenCalled();
    item.credentials.metadata = vi.fn(async () => undefined);
    expect((await read(await item.http.list())).body.settings).toMatchObject({ generationModels: [] });
    item.credentials.metadata = vi.fn(async () => { throw new Error("credential store down"); });
    expect((await read(await item.http.list())).body.settings).toMatchObject({ generationModels: [] });
    expect(item.credentials.open).not.toHaveBeenCalled();
    expect(item.provider.calls).toHaveLength(0);
  });

  it("결과가 저장된 뒤 키 거래만 실패하면 영수증의 확정 결과를 돌려주고, 다시 쓰거나 공급자를 다시 부르지 않는다", async () => {
    const item = harness();
    const receipt = withReceipt(item);
    item.credentials.whileCurrent = vi.fn(async (_actor, _version, run) => { await run(); throw new Error("credential commit failed"); });
    const first = await read(await item.http.test(json(seedreamBody()), route));
    expect(first.status).toBe(201);
    const test = first.body.test as SeedreamTest;
    expect(item.memory.record().tests.map(row => row.id)).toEqual([previousTestId, test.id]);
    // 실패 기록 시도는 확정 영수증이라 거절되고(결과 그대로), 영수증을 한 번 읽는다.
    expect(item.memory.hooks.finishCalls.map(change => change.kind)).toEqual(["test", "failure"]);
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(await read(await item.http.test(json(seedreamBody()), route))).toEqual({ status: 200, body: first.body });
    expect(item.provider.calls).toHaveLength(1);
    expect(item.memory.record().tests).toHaveLength(2);
  });

  it("결과 저장 전에 키 거래가 실패하면 명확한 실패(storage_unavailable)로 기록하고 같은 번호도 같은 답이다", async () => {
    const item = harness();
    withReceipt(item);
    item.credentials.whileCurrent = vi.fn(async () => { throw new Error("credential lock failed"); });
    const failed = await read(await item.http.test(json(seedreamBody()), route));
    expect(failed).toEqual({ status: 503, body: { code: "storage_unavailable" } });
    expect(await read(await item.http.test(json(seedreamBody()), route))).toEqual(failed);
    expect(item.provider.calls).toHaveLength(1);
    expect(item.memory.record().tests.map(row => row.id)).toEqual([previousTestId]);
  });

  it("실패 기록도 영수증 조회도 안 되면 result_unconfirmed(503)이고, 영수증은 처리 중(202)으로 남아 다시 보내지 않는다", async () => {
    const item = harness();
    withReceipt(item, true);
    item.credentials.whileCurrent = vi.fn(async () => { throw new Error("credential lock failed"); });
    item.memory.hooks.rejectFailureSave = 1;
    expect(await read(await item.http.test(json(seedreamBody()), route))).toEqual({ status: 503, body: { code: "result_unconfirmed" } });
    expect(await read(await item.http.test(json(seedreamBody()), route))).toEqual({ status: 202, body: { code: "in_progress" } });
    expect(item.provider.calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith("style_dna_generation_unconfirmed", { stage: "finish" });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(apiKey);
  });
});
