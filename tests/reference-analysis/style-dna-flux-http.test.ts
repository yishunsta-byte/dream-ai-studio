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
import { createFluxAdapter, fluxEndpoint } from "@/lib/reference-analysis/style-dna-flux-provider";
import { createStyleDnaHttp } from "@/lib/reference-analysis/style-dna-http";
import { createSeedreamAdapter, seedreamEstimate } from "@/lib/reference-analysis/style-dna-seedream-provider";
import { createStyleDnaStore, type StyleDnaStore } from "@/lib/reference-analysis/style-dna-store";

vi.mock("server-only", () => ({}));

const bin = process.env.FLUX_TEST_PG_BIN;
const origin = "https://studio.example.invalid";
const id = "5e193754-7ac0-4466-9dfe-aae4f6ac718c";
const poll = "https://api.bfl.ai/v1/get_result?id=" + id;
const delivery = "https://delivery.us1.bfl.ai/file.png?signature=synthetic";
const key = "synthetic-flux-api-key";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const appRole = "dream_style_dna_app";
let cluster: string | undefined, root: string | undefined, started = false, admin: pg.Client | undefined, pool: pg.Pool | undefined;
let real: ReturnType<typeof createStyleDnaStore>;
let png: Buffer, reference: Buffer;
const legacyOwner = randomUUID(), legacyRecord = v7(), legacyRequest = v7();

const pgBin = (name: string) => join(bin!, name + (process.platform === "win32" ? ".exe" : ""));
const pgExec = (name: string, args: string[]) => promisify(execFile)(pgBin(name), args, { windowsHide: true, timeout: 40_000 });
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("Missing isolated port");
  return address.port;
}

async function seed(owner: string, recordId: string) {
  const stamp = "2026-11-26T00:00:00.000Z";
  const record: StyleDnaRecord = {
    id: recordId, title: "Synthetic FLUX record", revision: 1, mode: "replicate", createdAt: stamp, updatedAt: stamp,
    original: { href: styleDnaPath + "/" + recordId + "/media/original", mime: "image/webp", width: 1200, height: 1024,
      sha256: sha(reference), palette: [] },
    options: { mode: "replicate", guidance: "", mutationLevel: 30, includeImageTag: false, targetModel: "flux-2" },
    result: { schemaVersion: 1, status: "ready", media: "image", proposals: [] },
    semantic: { status: "partial", provider: "gemini", findings: [], prompts: { en: "A quiet street." } },
    revisions: [{ revision: 1, prompts: { en: "A quiet street." }, createdAt: stamp }], tests: [],
  };
  const requestId = v7();
  expect(await real.reserve(owner, requestId, sha(Buffer.from(requestId)))).toBeUndefined();
  expect((await real.finish(owner, requestId, { kind: "analysis", record, original: reference })).status).toBe(201);
}

function provider(sample = delivery) {
  return vi.fn<typeof fetch>(async url => {
    switch (String(url)) {
      case fluxEndpoint: return Response.json({ id, polling_url: poll });
      case poll: return Response.json({ id, status: "Ready", result: { sample } });
      case delivery: return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      default: throw new Error("Unexpected destination");
    }
  });
}

function harness(owner: string, record: string, send: typeof fetch, overrides: {
  store?: StyleDnaStore; inject?: boolean; deadlineMs?: number; seedream?: typeof fetch;
} = {}) {
  const credentials = {
    metadata: async () => ({ version: 7 }), open: async () => ({ version: 7, apiKey: key }),
    whileCurrent: async <T>(_owner: string, version: number, run: () => Promise<T>) => version === 7 ? run() : undefined,
  };
  const http = createStyleDnaHttp({
    authenticate: async () => ({ kind: "verified", userId: owner, email: "local@example.invalid" }),
    store: () => overrides.store ?? real, env: { DREAM_SITE_URL: origin }, credentials: () => null, engineCredentials: () => null,
    ...(overrides.inject !== false && { imageGenerators: {
      flux: { credentials, adapter: createFluxAdapter(send, { pollDelayMs: 2, deadlineMs: overrides.deadlineMs }) },
      ...(overrides.seedream && { seedream: { credentials, adapter: createSeedreamAdapter(overrides.seedream) } }),
    } }),
  });
  const url = origin + styleDnaPath + "/" + record + "/test-image";
  const route = { params: Promise.resolve({ id: record }) };
  return {
    http,
    async post(requestId: string, overrides: object = {}, file?: Buffer) {
      const input = { model: "flux-2-pro", requestId, revision: 1, credentialVersion: 7, authorized: true, expectedCostMicros: 30_000, ...overrides };
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
    media: (test: string) => http.media({ params: Promise.resolve({ id: record, media: test }) }),
  };
}

describe.skipIf(!bin)("FLUX.2 HTTP handlers with an isolated PostgreSQL 17 request ledger", () => {
  beforeAll(async () => {
    expect((await pgExec("postgres", ["--version"])).stdout).toMatch(/\(PostgreSQL\) 17\./);
    root = await mkdtemp(join(tmpdir(), "dream-flux-style-dna-"));
    cluster = join(root, "db");
    const password = randomBytes(24).toString("hex");
    const passwordFile = join(root, "bootstrap");
    const port = await freePort();
    await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    await pgExec("initdb", ["-D", cluster, "--username=flux_test_admin", "--pwfile=" + passwordFile,
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
    admin = new pg.Client({ ...config, user: "flux_test_admin", password });
    await admin.connect();
    for (const migration of ["0001_install.sql", "0002_library_delete.sql", "0003_generation_recovery.sql"]) {
      await admin.query(await readFile(new URL("../../lib/db/postgres/style-dna/" + migration, import.meta.url), "utf8"));
    }
    const appPassword = randomBytes(24).toString("hex");
    await admin.query("ALTER ROLE " + appRole + " LOGIN PASSWORD '" + appPassword + "'");
    pool = new pg.Pool({ ...config, user: appRole, password: appPassword, max: 3 });
    real = createStyleDnaStore(pool);
    png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#376b6e" } }).png().toBuffer();
    reference = await sharp({ create: { width: 1200, height: 1024, channels: 3, background: "#333333" } }).webp().toBuffer();
    await seed(legacyOwner, legacyRecord);
    await admin.query(
      "INSERT INTO dream_style_dna.requests(owner_id,id,input_hash,generation_record_id,outcome) VALUES($1,$2,$3,$4,$5::jsonb)",
      [legacyOwner, legacyRequest, sha(Buffer.from(legacyRequest)), legacyRecord,
        JSON.stringify({ status: 503, body: { code: "storage_unavailable", model: "seedream-5.5" } })],
    );
    const beforeMigration = await harness(legacyOwner, legacyRecord, provider()).get(legacyRequest);
    expect(await beforeMigration.json()).toEqual({ code: "storage_unavailable", requestId: legacyRequest, settled: true });
    await admin.query(await readFile(new URL("../../lib/db/postgres/style-dna/0004_generation_request_model.sql", import.meta.url), "utf8"));
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

  it("quotes transmitted reference dimensions, saves a private result, and replays the receipt without another submit", async () => {
    const owner = randomUUID(), stranger = randomUUID(), record = v7(), requestId = v7(), send = provider();
    await seed(owner, record);
    const api = harness(owner, record, send);
    const other = harness(stranger, record, send);
    const disabled = harness(owner, record, send, { inject: false });
    expect((await disabled.post(requestId)).status).toBe(400);
    expect(JSON.stringify(await (await disabled.http.list()).json())).not.toContain('"id":"flux-2-pro"');
    const settings = await (await api.http.list()).json();
    expect(settings.settings.generationModels).toEqual([expect.objectContaining({ id: "flux-2-pro", provider: "bfl",
      estimate: expect.objectContaining({ withoutReference: 30_000, withReference: 45_000 }) })]);
    const changed = await api.post(requestId, { attachImage: true, expectedCostMicros: 45_000 });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "estimate_changed", estimate: { totalMicros: 60_000 } });
    expect(send).not.toHaveBeenCalled();
    expect(await real.receipt(owner, requestId)).toBeUndefined();
    const response = await api.post(requestId, { attachImage: true, expectedCostMicros: 60_000 });
    expect(response.status).toBe(201);
    const { test, model } = await response.json();
    expect(model).toBe("flux-2-pro");
    expect(test.generation).toMatchObject({ provider: "bfl", billing: "unconfirmed", png: { sha256: sha(png) },
      estimate: { totalMicros: 60_000 } });
    expect(test.basis.reference).toMatchObject({ kind: "original", sha256: sha(reference) });
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).input_image).toBe(reference.toString("base64"));
    expect(JSON.stringify(test)).not.toContain(key);
    expect(JSON.stringify(test)).not.toContain(delivery);
    const saved = await api.media(test.id);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toContain("no-store");
    const resultBytes = Buffer.from(await saved.arrayBuffer());
    expect(sha(resultBytes)).toBe(test.image.sha256);
    expect((await sharp(resultBytes).metadata()).format).toBe("webp");
    expect((await other.media(test.id)).status).toBe(404);
    expect((await other.get(requestId)).status).toBe(404);
    expect((await api.post(requestId, { attachImage: true, expectedCostMicros: 60_000 })).status).toBe(200);
    const conflict = await api.post(requestId, { attachImage: true, expectedCostMicros: 60_000, customPrompt: "New prompt." });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ code: "request_conflict", model: "flux-2-pro" });
    expect(send).toHaveBeenCalledTimes(3);
    expect((await real.get(owner, record))?.tests).toHaveLength(1);
  });

  it("accepts one uploaded reference after measuring the transmitted WebP", async () => {
    const owner = randomUUID(), record = v7(), send = provider();
    await seed(owner, record);
    const upload = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ccddee" } }).png().toBuffer();
    const found = await harness(owner, record, send).post(v7(), { expectedCostMicros: 45_000 }, upload);
    expect(found.status).toBe(201);
    const { test } = await found.json();
    expect(test.basis.reference).toMatchObject({ kind: "upload", sourceSha256: sha(upload) });
    const reference = Buffer.from(JSON.parse(String(send.mock.calls[0][1]?.body)).input_image, "base64");
    expect(sha(reference)).toBe(test.basis.reference.sha256);
  });

  it("serializes concurrent reservations and lets another owner reuse the request ID on their own record", async () => {
    const owner = randomUUID(), stranger = randomUUID(), record = v7(), otherRecord = v7(), requestId = v7();
    await seed(owner, record);
    await seed(stranger, record);
    await seed(owner, otherRecord);
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const send = provider();
    const seedream = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected Seedream submit"); });
    send.mockImplementationOnce(async () => { entered.resolve(); await resume.promise; return Response.json({ id, polling_url: poll }); });
    const api = harness(owner, record, send, { seedream });
    const running = api.post(requestId);
    try {
      await Promise.race([entered.promise, running.then(response => { throw new Error("Submit did not reach the provider: " + response.status); })]);
      const same = await api.post(requestId);
      expect(same.status).toBe(202);
      expect(await same.json()).toMatchObject({ model: "flux-2-pro" });
      const overlap = await api.post(v7());
      expect(overlap.status).toBe(409);
      expect(await overlap.json()).toEqual({ code: "generation_in_progress", requestId, model: "flux-2-pro" });
      const seedreamOptions = { model: "seedream-5.5", expectedCostMicros: seedreamEstimate(0).totalMicros };
      const otherModel = await api.post(requestId, seedreamOptions);
      expect(otherModel.status).toBe(409);
      expect(await otherModel.json()).toEqual({ code: "request_conflict", model: "flux-2-pro" });
      const otherModelOverlap = await api.post(v7(), seedreamOptions);
      expect(otherModelOverlap.status).toBe(409);
      expect(await otherModelOverlap.json()).toEqual({ code: "generation_in_progress", requestId, model: "flux-2-pro" });
      expect(seedream).not.toHaveBeenCalled();
      for (const status of [await api.get(), await api.get(requestId)]) {
        expect(status.status).toBe(202);
        expect(await status.json()).toEqual({ code: "in_progress", requestId, model: "flux-2-pro" });
      }
      const unrelated = harness(owner, otherRecord, send);
      for (const status of [await unrelated.get(requestId), await api.get(v7()), await harness(stranger, record, send).get(requestId)]) {
        expect(status.status).toBe(404);
        expect(await status.json()).toEqual({ code: "not_found" });
      }
      const unrelatedReplay = await unrelated.post(requestId);
      expect(unrelatedReplay.status).toBe(409);
      expect(await unrelatedReplay.json()).toEqual({ code: "request_conflict" });
      const { rows } = await admin!.query("SELECT generation_model,outcome FROM dream_style_dna.requests WHERE owner_id=$1 AND id=$2", [owner, requestId]);
      expect(rows).toEqual([{ generation_model: "flux-2-pro", outcome: null }]);
      expect((await harness(stranger, record, provider()).post(requestId)).status).toBe(201);
    } finally {
      resume.resolve();
      expect((await running).status).toBe(201);
    }
    expect(send.mock.calls.filter(([url]) => url === fluxEndpoint)).toHaveLength(1);
  });

  it.each(["lost", "timeout", "expired", "save_failed"] as const)("keeps the old reservation after %s without resubmitting", async mode => {
    const owner = randomUUID(), record = v7(), requestId = v7(), send = provider();
    await seed(owner, record);
    if (mode === "lost") send.mockRejectedValueOnce(new Error("Lost submit reply"));
    if (mode === "expired") send.mockImplementationOnce(async () => Response.json({ id, polling_url: poll }))
      .mockImplementationOnce(async () => Response.json({ id, status: "Ready", result: { sample: delivery + "&Expires=1" } }));
    if (mode === "timeout") send.mockImplementation(async (url) => String(url) === fluxEndpoint
      ? Response.json({ id, polling_url: poll }) : Response.json({ id, status: "Pending" }));
    const store = mode === "save_failed" ? { ...real, finish: vi.fn(async () => { throw new Error("Failed before media commit"); }) } : real;
    const api = harness(owner, record, send, { store, ...(mode === "timeout" && { deadlineMs: 15 }) });
    const first = await api.post(requestId);
    expect(first.status).toBe(mode === "save_failed" ? 503 : 504);
    expect((await api.get(requestId)).status).toBe(202);
    expect((await api.post(requestId)).status).toBe(202);
    expect((await api.post(v7())).status).toBe(409);
    expect((await real.get(owner, record))?.tests).toHaveLength(0);
    expect(send.mock.calls.filter(([url]) => url === fluxEndpoint)).toHaveLength(1);
  });

  it("recovers an already committed result when its save reply is lost", async () => {
    const owner = randomUUID(), record = v7(), requestId = v7(), send = provider();
    await seed(owner, record);
    const store = { ...real, finish: vi.fn(async (...args: Parameters<typeof real.finish>) => {
      await real.finish(...args);
      throw new Error("Commit reply lost");
    }) };
    const api = harness(owner, record, send, { store });
    const first = await api.post(requestId);
    expect(first.status).toBe(201);
    const result = await first.json();
    const replay = await api.post(requestId);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect((await real.get(owner, record))?.tests).toHaveLength(1);
    expect(send.mock.calls.filter(([url]) => url === fluxEndpoint)).toHaveLength(1);
  });

  it("keeps the exact model after source deletion and omits an unproven legacy model", async () => {
    const owner = legacyOwner, record = legacyRecord, legacy = legacyRequest, current = v7(), send = provider();
    const api = harness(owner, record, send);
    const legacyStatus = await api.get(legacy);
    expect(legacyStatus.status).toBe(503);
    expect(await legacyStatus.json()).toEqual({ code: "storage_unavailable", requestId: legacy, settled: true });
    send.mockRejectedValueOnce(new Error("Lost submit reply"));
    expect((await api.post(current)).status).toBe(504);
    await expect(admin!.query("UPDATE dream_style_dna.requests SET generation_model='seedream-5.5' WHERE owner_id=$1 AND id=$2", [owner, current])).rejects.toThrow();
    expect(await real.remove(owner, record)).toBe(true);
    const deleted = await api.get(current);
    expect(deleted.status).toBe(404);
    expect(await deleted.json()).toEqual({ code: "not_found", requestId: current, model: "flux-2-pro", settled: true });
    const replay = await api.post(current);
    expect(replay.status).toBe(404);
    expect(await replay.json()).toEqual({ code: "not_found", model: "flux-2-pro" });
    expect(await (await api.get(legacy)).json()).toEqual({ code: "not_found" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("binds a terminal provider rejection to the same request without another submit", async () => {
    const owner = randomUUID(), record = v7(), requestId = v7(), send = provider();
    await seed(owner, record);
    send.mockImplementationOnce(async () => Response.json({ id, polling_url: poll }))
      .mockImplementationOnce(async () => Response.json({ id, status: "Failed" }));
    const api = harness(owner, record, send);
    const first = await api.post(requestId);
    const original = { code: "provider_rejected", model: "flux-2-pro" };
    expect(first.status).toBe(502);
    expect(await first.json()).toEqual(original);
    const status = await api.get(requestId);
    expect(status.status).toBe(502);
    expect(await status.json()).toEqual({ ...original, requestId, settled: true });
    const replay = await api.post(requestId);
    expect(replay.status).toBe(502);
    expect(await replay.json()).toEqual(original);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
