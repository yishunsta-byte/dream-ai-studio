import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import sharp from "sharp";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { styleDnaPath, type StyleDnaRecord } from "@/lib/reference-analysis/style-dna-contract";
import { createFluxAdapter } from "@/lib/reference-analysis/style-dna-flux-provider";
import { createGptImageAdapter, gptImageEditEndpoint, gptImageGenerationEndpoint } from "@/lib/reference-analysis/style-dna-gpt-image-provider";
import { createStyleDnaHttp } from "@/lib/reference-analysis/style-dna-http";
import { createSeedreamAdapter } from "@/lib/reference-analysis/style-dna-seedream-provider";
import { createStyleDnaStore, type StyleDnaStore } from "@/lib/reference-analysis/style-dna-store";

vi.mock("server-only", () => ({}));

// P2-02 GPT Image 2.6: 실제 HTTP 처리기 + 격리 PostgreSQL 17 요청 원장(0001~0004 → 0005 GPT Image).
// 공급자는 합성 send만 쓴다(실제 OpenAI 호출 0). 키는 합성 값이다.
const bin = process.env.GPT_IMAGE_TEST_PG_BIN ?? process.env.FLUX_TEST_PG_BIN;
const origin = "https://studio.example.invalid";
const key = "sk-synthetic_GptImageHttpKey0123456789";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const appRole = "dream_style_dna_app";
const usage = { input_tokens: 120, input_tokens_details: { text_tokens: 100, image_tokens: 20 }, output_tokens: 1000, total_tokens: 1120 };
const cost = 100 * 5 + 20 * 8 + 1000 * 30;
let cluster: string | undefined, root: string | undefined, started = false, admin: pg.Client | undefined, pool: pg.Pool | undefined;
let real: ReturnType<typeof createStyleDnaStore>;
let png: Buffer, reference: Buffer;
let migration: string, rollback: string;

const pgBin = (name: string) => join(bin!, name + (process.platform === "win32" ? ".exe" : ""));
const pgExec = (name: string, args: string[]) => promisify(execFile)(pgBin(name), args, { windowsHide: true, timeout: 40_000 });
const sqlFile = (name: string) => readFile(new URL("../../lib/db/postgres/style-dna/" + name, import.meta.url), "utf8");
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("Missing isolated port");
  return address.port;
}
const checks = async () => (await admin!.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid='dream_style_dna.requests'::regclass AND contype='c' ORDER BY conname`)).rows.map(row => `${row.conname}=${row.def}`);

async function seed(owner: string, recordId: string) {
  const stamp = "2026-11-27T00:00:00.000Z";
  const record: StyleDnaRecord = {
    id: recordId, title: "Synthetic GPT Image record", revision: 1, mode: "replicate", createdAt: stamp, updatedAt: stamp,
    original: { href: styleDnaPath + "/" + recordId + "/media/original", mime: "image/webp", width: 1200, height: 1024,
      sha256: sha(reference), palette: [] },
    options: { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel: "gpt-image-2.6" },
    result: { schemaVersion: 1, status: "ready", media: "image", proposals: [] },
    semantic: { status: "partial", provider: "gemini", findings: [], prompts: { en: "A quiet harbor." } },
    revisions: [{ revision: 1, prompts: { en: "A quiet harbor." }, createdAt: stamp }], tests: [],
  };
  const requestId = v7();
  expect(await real.reserve(owner, requestId, sha(Buffer.from(requestId)))).toBeUndefined();
  expect((await real.finish(owner, requestId, { kind: "analysis", record, original: reference })).status).toBe(201);
}

const ok = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function provider() {
  return vi.fn<typeof fetch>(async url => {
    if (String(url) === gptImageGenerationEndpoint || String(url) === gptImageEditEndpoint) {
      return ok({ created: 1_795_000_000, data: [{ b64_json: png.toString("base64") }], usage });
    }
    throw new Error("Unexpected destination");
  });
}

function harness(owner: string, record: string, send: typeof fetch, overrides: { store?: StyleDnaStore; inject?: boolean; others?: boolean;
  version?: number } = {}) {
  const version = overrides.version ?? 4;
  const credentials = {
    metadata: async () => ({ version }), open: async () => ({ version, apiKey: key }),
    whileCurrent: async <T>(_owner: string, current: number, run: () => Promise<T>) => current === version ? run() : undefined,
  };
  const never = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected fixed-price submit"); });
  const http = createStyleDnaHttp({
    authenticate: async () => ({ kind: "verified", userId: owner, email: "local@example.invalid" }),
    store: () => overrides.store ?? real, env: { DREAM_SITE_URL: origin }, credentials: () => null, engineCredentials: () => null,
    ...(overrides.inject !== false && { imageGenerators: {
      gptImage: { credentials, adapter: createGptImageAdapter(send) },
      ...(overrides.others && { seedream: { credentials, adapter: createSeedreamAdapter(never) },
        flux: { credentials, adapter: createFluxAdapter(never, { pollDelayMs: 2 }) } }),
    } }),
  });
  const url = origin + styleDnaPath + "/" + record + "/test-image";
  const route = { params: Promise.resolve({ id: record }) };
  return {
    http, never,
    async post(requestId: string, extra: object = {}, file?: Buffer) {
      const input = { model: "gpt-image-2.6", requestId, revision: 1, credentialVersion: version, authorized: true, billing: "usage_based", ...extra };
      const headers = new Headers({ origin, host: new URL(origin).host });
      let body: string | FormData;
      if (file) {
        body = new FormData();
        body.set("options", JSON.stringify({ ...input, customReferenceSha256: sha(file) }));
        body.set("customReference", new Blob([new Uint8Array(file)], { type: "image/png" }), "reference.png");
      } else {
        body = JSON.stringify(input);
        headers.set("content-type", "application/json");
      }
      return http.test(new Request(url, { method: "POST", body, headers }), route);
    },
    get: (requestId?: string) => http.generationStatus(new Request(requestId ? url + "?requestId=" + requestId : url), route),
  };
}

describe.skipIf(!bin)("GPT Image 2.6 HTTP handlers with an isolated PostgreSQL 17 request ledger", () => {
  beforeAll(async () => {
    expect((await pgExec("postgres", ["--version"])).stdout).toMatch(/\(PostgreSQL\) 17\./);
    root = await mkdtemp(join(tmpdir(), "dream-gpt-image-style-dna-"));
    cluster = join(root, "db");
    const password = randomBytes(24).toString("hex");
    const passwordFile = join(root, "bootstrap");
    const port = await freePort();
    await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    await pgExec("initdb", ["-D", cluster, "--username=gpt_image_test_admin", "--pwfile=" + passwordFile,
      "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-sync"]);
    await rm(passwordFile);
    const output = await open(join(root, "launch.log"), "wx");
    try {
      await new Promise<void>((resolve, reject) => {
        const command = spawn(pgBin("pg_ctl"), ["-D", cluster!, "-l", join(root!, "postgres.log"), "-o", "-h 127.0.0.1 -p " + port,
          "-w", "-t", "20", "start"], { windowsHide: true, stdio: ["ignore", output.fd, output.fd], timeout: 25_000 });
        command.once("error", reject);
        command.once("exit", code => code === 0 ? resolve() : reject(new Error("Isolated PostgreSQL startup failed")));
      });
      started = true;
    } finally { await output.close(); }
    const config = { host: "127.0.0.1", port, database: "postgres", connectionTimeoutMillis: 3_000 };
    admin = new pg.Client({ ...config, user: "gpt_image_test_admin", password });
    await admin.connect();
    for (const name of ["0001_install.sql", "0002_library_delete.sql", "0003_generation_recovery.sql", "0004_generation_request_model.sql"]) {
      await admin.query(await sqlFile(name));
    }
    const appPassword = randomBytes(24).toString("hex");
    await admin.query("ALTER ROLE " + appRole + " LOGIN PASSWORD '" + appPassword + "'");
    pool = new pg.Pool({ ...config, user: appRole, password: appPassword, max: 3 });
    real = createStyleDnaStore(pool);
    png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#4a7b6e" } }).png().toBuffer();
    reference = await sharp({ create: { width: 1200, height: 1024, channels: 3, background: "#333333" } }).webp().toBuffer();
    migration = await sqlFile("0005_gpt_image_request_model.sql");
    rollback = await sqlFile("rollback_0005_gpt_image_request_model.sql");
  }, 60_000);

  afterAll(async () => {
    try {
      await pool?.end();
      await admin?.end();
      if (started && cluster) await pgExec("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "-t", "20", "stop"]);
    } finally {
      if (root) await rm(root, { recursive: true, force: true, maxRetries: 2 });
    }
  }, 45_000);

  it("0005 전에는 원장이 gpt-image-2.6을 거절하고(공급자 호출 0), 0005는 자기 제약만 바꾼다", async () => {
    const owner = randomUUID(), record = v7(), send = provider();
    await seed(owner, record);
    await expect(real.reserve(owner, v7(), "a".repeat(64), record, "gpt-image-2.6")).rejects.toThrow();
    const blocked = await harness(owner, record, send).post(v7());
    expect(blocked.status).toBeGreaterThanOrEqual(500);
    expect(send).not.toHaveBeenCalled();
    // provider·version을 함께 보는 무관한 CHECK(시험용)는 설치·재설치·롤백 뒤에도 원래 정의 그대로여야 한다.
    await admin!.query("ALTER TABLE dream_style_dna.requests ADD CONSTRAINT p202_model_probe CHECK (generation_model IS DISTINCT FROM 'probe')");
    const before = await checks();
    await admin!.query(migration);
    await admin!.query(migration);
    const after = await checks();
    expect(after.filter(row => !row.startsWith("style_dna_generation_model_bound="))).toEqual(before.filter(row => !row.startsWith("style_dna_generation_model_bound=")));
    expect(after.find(row => row.startsWith("style_dna_generation_model_bound="))).toContain("'gpt-image-2.6'::text");
    expect(before.find(row => row.startsWith("style_dna_generation_model_bound="))).not.toContain("gpt-image-2.6");
    // 롤백(기록 없음) → 0004 목록 복원, 설치 전 롤백은 멈춤, 다시 설치.
    await admin!.query(rollback);
    expect(await checks()).toEqual(before);
    await expect(admin!.query(rollback)).rejects.toThrow(/STYLE_DNA_GPT_IMAGE_ROLLBACK_NOT_INSTALLED/);
    await admin!.query("ROLLBACK").catch(() => undefined);
    expect(await checks()).toEqual(before);
    await admin!.query(migration);
    expect(await checks()).toEqual(after);
  });

  it("목록은 usage 기반 줄을 싣고, 생성은 금액 재확인 없이 201·출처·실제 금액, 같은 요청은 공급자 재호출 없이 200", async () => {
    const owner = randomUUID(), record = v7(), requestId = v7(), send = provider();
    await seed(owner, record);
    const api = harness(owner, record, send);
    const disabled = harness(owner, record, send, { inject: false });
    expect((await disabled.post(requestId)).status).toBe(400);
    expect((await (await disabled.http.list()).json()).settings).not.toHaveProperty("generationModels");
    const listed = await (await api.http.list()).json();
    expect(listed.settings.generationModels).toEqual([{ id: "gpt-image-2.6", label: "GPT Image 2.6", vendor: "OpenAI", provider: "openai",
      modelId: "gpt-image-2.6-sunburst", size: "1024x1024", aspectRatio: "1:1", credentialVersion: 4,
      estimate: { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11-27", currency: "USD", unit: "micros" } }]);
    const response = await api.post(requestId);
    expect(response.status).toBe(201);
    const { test, model } = await response.json();
    expect(model).toBe("gpt-image-2.6");
    expect(test.model).toBe("gpt-image-2.6");
    expect(test.generation).toEqual({ provider: "openai", modelId: "gpt-image-2.6-sunburst", size: "1024x1024",
      png: { sha256: sha(png), width: 1024, height: 1024, byteLength: png.length },
      usage: { generatedImages: 1, inputTokens: 100, inputImageTokens: 20, outputTokens: 1000 },
      estimate: { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11-27", currency: "USD", unit: "micros", referenceCount: 0 },
      actualCostMicros: cost, billing: "unconfirmed" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(gptImageGenerationEndpoint);
    expect(new Headers(send.mock.calls[0][1]?.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(JSON.stringify(test)).not.toContain(key);
    const replay = await api.post(requestId);
    expect(replay.status).toBe(200);
    expect((await replay.json()).test).toEqual(test);
    expect(send).toHaveBeenCalledTimes(1);
    const { rows } = await admin!.query("SELECT generation_model FROM dream_style_dna.requests WHERE owner_id=$1 AND id=$2", [owner, requestId]);
    expect(rows).toEqual([{ generation_model: "gpt-image-2.6" }]);
    expect((await real.get(owner, record))?.tests).toHaveLength(1);
  });

  it("원본 참조는 edits로 보내고 referenceCount 1, 업로드 참조도 받는다", async () => {
    const owner = randomUUID(), record = v7(), send = provider();
    await seed(owner, record);
    const api = harness(owner, record, send);
    const attached = await api.post(v7(), { attachImage: true });
    expect(attached.status).toBe(201);
    const { test } = await attached.json();
    expect(test.generation.estimate.referenceCount).toBe(1);
    expect(test.basis.reference).toMatchObject({ kind: "original", sha256: sha(reference) });
    expect(send.mock.calls[0][0]).toBe(gptImageEditEndpoint);
    const sent = JSON.parse(String(send.mock.calls[0][1]?.body)).images[0].image_url as string;
    expect(sent.startsWith("data:image/webp;base64,")).toBe(true);
    const upload = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ccddee" } }).png().toBuffer();
    const uploaded = await api.post(v7(), {}, upload);
    expect(uploaded.status).toBe(201);
    const second = await uploaded.json();
    expect(second.test.basis.reference).toMatchObject({ kind: "upload", sourceSha256: sha(upload) });
    expect(second.test.generation.estimate.referenceCount).toBe(1);
  });

  it("금액 칸·고정가 모델 혼용은 400(호출 0), 옛 키 버전은 409 stale_credential(호출 0)", async () => {
    const owner = randomUUID(), record = v7(), send = provider();
    await seed(owner, record);
    const api = harness(owner, record, send, { others: true });
    for (const extra of [{ expectedCostMicros: 0 }, { billing: "fixed" }, { model: "seedream-5.5" }, { model: "flux-2-pro" },
      { model: "seedream-5.5", expectedCostMicros: 20_000, billing: "usage_based" }, { aspectRatio: "16:9" }]) {
      const response = await api.post(v7(), extra);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "invalid_input" });
    }
    const listed = (await (await api.http.list()).json()).settings.generationModels.map((row: { id: string }) => row.id);
    expect(listed).toEqual(["seedream-5.5", "flux-2-pro", "gpt-image-2.6"]);
    const stale = await api.post(v7(), { credentialVersion: 3 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_credential" });
    expect(send).not.toHaveBeenCalled();
    expect(api.never).not.toHaveBeenCalled();
  });

  it("usage가 불완전하면 금액 없이 확인된 칸만 기록한다", async () => {
    const owner = randomUUID(), record = v7();
    await seed(owner, record);
    const send = vi.fn<typeof fetch>(async () => ok({ data: [{ b64_json: png.toString("base64") }], usage: { ...usage, total_tokens: 1 } }));
    const response = await harness(owner, record, send).post(v7());
    expect(response.status).toBe(201);
    const { test } = await response.json();
    expect(test.generation.usage).toEqual({ generatedImages: 1 });
    expect(test.generation).not.toHaveProperty("actualCostMicros");
    expect(test.generation.billing).toBe("unconfirmed");
  });

  it("거절은 기록하고 다시 시도할 수 있지만, 응답을 잃으면 같은 기록의 예약을 막아 두고 다시 보내지 않는다", async () => {
    const owner = randomUUID(), record = v7();
    await seed(owner, record);
    const busy = vi.fn<typeof fetch>(async () => new Response("{}", { status: 429 }));
    const first = await harness(owner, record, busy).post(v7());
    expect(first.status).toBe(429);
    expect(await first.json()).toMatchObject({ code: "provider_busy" });
    const lostRequest = v7();
    const lost = vi.fn<typeof fetch>(async () => { throw new TypeError("socket hang up"); });
    const api = harness(owner, record, lost);
    const unknown = await api.post(lostRequest);
    expect(unknown.status).toBe(504);
    expect(await unknown.json()).toEqual({ code: "generation_submission_unknown", requestId: lostRequest, model: "gpt-image-2.6" });
    expect((await api.get(lostRequest)).status).toBe(202);
    const again = await api.post(v7());
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "generation_in_progress", requestId: lostRequest, model: "gpt-image-2.6" });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("공급자가 처리 뒤 5xx를 돌려주면 예약을 막아 두고 같은 기록의 새 요청도 다시 보내지 않는다", async () => {
    // Tester 반례(msg_72ac1a5869e5): 첫 제출을 처리한 뒤 504 → 예전에는 실패로 기록돼 새 요청이 POST를 한 번 더 보냈다.
    for (const status of [500, 502, 503, 504]) {
      const owner = randomUUID(), record = v7(), requestId = v7();
      await seed(owner, record);
      const send = vi.fn<typeof fetch>(async () => new Response("upstream", { status }));
      const api = harness(owner, record, send);
      const first = await api.post(requestId);
      expect(first.status).toBe(504);
      expect(await first.json()).toEqual({ code: "generation_submission_unknown", requestId, model: "gpt-image-2.6" });
      const again = await api.post(v7());
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ code: "generation_in_progress", requestId, model: "gpt-image-2.6" });
      expect((await api.post(requestId)).status).toBe(202);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("출력 상세가 불완전하면({}·한 칸만) 금액 없이 기록한다", async () => {
    for (const output_tokens_details of [{}, { text_tokens: 0 }, { image_tokens: 1000 }]) {
      const owner = randomUUID(), record = v7();
      await seed(owner, record);
      const send = vi.fn<typeof fetch>(async () => ok({ data: [{ b64_json: png.toString("base64") }], usage: { ...usage, output_tokens_details } }));
      const response = await harness(owner, record, send).post(v7());
      expect(response.status).toBe(201);
      const { test } = await response.json();
      expect(test.generation).not.toHaveProperty("actualCostMicros");
      expect(test.generation.usage).toEqual({ generatedImages: 1, inputTokens: 100, inputImageTokens: 20, outputTokens: 1000 });
    }
  });

  it("롤백은 gpt-image-2.6 기록이 있으면 아무것도 바꾸지 않고 멈춘다", async () => {
    const before = await checks();
    await expect(admin!.query(rollback)).rejects.toThrow(/STYLE_DNA_GPT_IMAGE_HAS_HISTORY/);
    await admin!.query("ROLLBACK").catch(() => undefined);
    expect(await checks()).toEqual(before);
    const { rows } = await admin!.query("SELECT relforcerowsecurity FROM pg_class WHERE oid='dream_style_dna.requests'::regclass");
    expect(rows).toEqual([{ relforcerowsecurity: true }]);
  });
});
