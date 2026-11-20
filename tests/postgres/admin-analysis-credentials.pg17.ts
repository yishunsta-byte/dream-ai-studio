import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type Client, type PoolConfig } from "pg";
import sharp from "sharp";
import { createGeminiCredentialHttp } from "../../lib/reference-analysis/analysis-credential-http";
import { createGeminiCredentialStore, readGeminiCredentialKeyRing } from "../../lib/reference-analysis/analysis-credential-store";
import { currentGeminiSettings } from "../../lib/reference-analysis/analysis-gemini-settings";
import { createAdminReferenceHttp } from "../../lib/reference-analysis/admin-reference-http";
import { geminiImageAnalyzer } from "../../lib/reference-analysis/image-semantic-gemini";
import { analyzeLocalMediaUpload } from "../../lib/reference-analysis/local-media-url";
import { createMusicSemanticHttp, musicProviderFromSettings } from "../../lib/reference-analysis/music-semantic-server";
import { createShortsAnalysisHttp } from "../../lib/reference-analysis/shorts-analysis-http";

const origin = "http://127.0.0.1:41417";
const fakeRef = "synthetic_reference_key_00000001";
const fakeMusic = "synthetic_music_key_000000001";
const rotatedRef = "synthetic_reference_key_00000002";
const badKey = "synthetic_rejected_key_00000001";
const key1 = randomBytes(32).toString("base64url");
const key2 = randomBytes(32).toString("base64url");
const ring = (primary: string) => readGeminiCredentialKeyRing(JSON.stringify({ primary, keys: { key1, key2 } }));
const env = { DREAM_SITE_URL: origin, DREAM_REFERENCE_GEMINI_API_KEY: "synthetic_environment_key",
  DREAM_REFERENCE_GEMINI_MODEL: "gemini-environment", DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "gemini-shorts-environment" };
const selected = { image: "gemini-image-2.5", shorts: "gemini-shorts-2.5", music: "gemini-music-2.5" };
const modelOutput = {
  [selected.image]: { findings: { composition: { description: "장면 구성", basis: "보이는 단서" } }, ko: "이미지 창작 프롬프트", en: "Image creation prompt" },
  [selected.music]: { genre: "앰비언트", instruments: null, tempoBpm: null, structure: null, sunoPrompt: "새 음악 생성 프롬프트" },
  [selected.shorts]: { summary: "장면 요약", hook: null, composition: null, sound: null, segments: [], draftPrompt: "새 영상 생성 프롬프트" },
};
const calls: { method: string; model: string; key: string }[] = [];
let probeUnavailable = false;
const provider: typeof fetch = async (input, options) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://generativelanguage.googleapis.com");
  assert.equal(url.search, "");
  assert.equal(options?.redirect, "error");
  const key = new Headers(options?.headers).get("x-goog-api-key");
  assert.ok(key);
  const match = url.pathname.match(/^\/v1beta\/models\/([^:]+)(?::generateContent)?$/);
  assert.ok(match && options?.method);
  const model = match[1];
  calls.push({ method: options.method, model, key });
  if (key === badKey) return Response.json({ error: { details: [{ reason: "API_KEY_INVALID" }] } }, { status: 400 });
  if (model === "gemini-unknown") return Response.json({ error: { message: "fixture unknown" } }, { status: 404 });
  if (probeUnavailable && options.method === "GET") return Response.json({}, { status: 429 });
  if (options.method === "GET") return Response.json({ name: `models/${model}`, supportedGenerationMethods: ["generateContent"] });
  assert.equal(options.method, "POST");
  return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(modelOutput[model]) }] } }] });
};

function request(body: unknown | Buffer | Uint8Array, options: { method?: string; headers?: Record<string, string> } = {}) {
  const binary = ArrayBuffer.isView(body);
  const bytes = binary ? Uint8Array.from(body as Uint8Array).buffer : JSON.stringify(body);
  return new Request(origin + "/api/admin/analysis-credentials", {
    method: options.method ?? "PUT", headers: { host: new URL(origin).host, origin, "sec-fetch-site": "same-origin",
      "content-type": binary ? "application/octet-stream" : "application/json", ...options.headers },
    body: bytes,
  });
}

function wav() {
  const bytes = Buffer.alloc(300);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(292, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(256, 40);
  return bytes;
}

export async function verifyAdminGeminiCredentialStore(admin: Client, config: PoolConfig, ownerA: string, ownerB: string) {
  assert.deepEqual((await admin.query("SELECT current_database() AS db, current_user AS actor")).rows,
    [{ db: "dream_test_t358", actor: "t358_bootstrap" }]);
  const install = await readFile(new URL("../../lib/db/postgres/analysis-credentials/0001_install.sql", import.meta.url), "utf8");
  await admin.query(install);
  const password = randomBytes(20).toString("hex");
  await admin.query(`ALTER ROLE dream_gemini_app LOGIN PASSWORD '${password}'`);
  const poolOptions = { ...config, user: "dream_gemini_app", password, max: 2 };
  const first = new Pool(poolOptions);
  const second = new Pool(poolOptions);
  try {
    const store = createGeminiCredentialStore(first, ring("key1"));
    const auth = (userId: string) => async () => ({ kind: "verified" as const, userId, email: "synthetic@example.invalid" });
    const a = createGeminiCredentialHttp({ authenticate: auth(ownerA), env, store: () => store, send: provider });
    const b = createGeminiCredentialHttp({ authenticate: auth(ownerB), env, store: () => store, send: provider });
    const anonymous = createGeminiCredentialHttp({ authenticate: async () => ({ kind: "local" }), env, store: () => store, send: provider });
    assert.equal((await anonymous.put(request({}))).status, 401);
    const initial = await (await a.get()).json();
    assert.equal(initial.programs.image.source, "environment");
    assert.equal(initial.groups.reference.version, 0);
    const refWrite = { group: "reference", expectedVersion: 0, apiKey: fakeRef, models: { image: selected.image, shorts: selected.shorts } };
    assert.equal((await a.put(request(refWrite, { headers: { origin: "https://outside.example.invalid" } }))).status, 403);
    assert.equal(calls.length, 0);
    const missing = await a.put(request({ ...refWrite, apiKey: undefined }));
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).field, "apiKey");
    const rejected = await a.put(request({ ...refWrite, apiKey: badKey }));
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).code, "invalid_key");
    const unknown = await a.put(request({ ...refWrite, models: { image: "gemini-unknown", shorts: selected.shorts } }));
    assert.equal(unknown.status, 422);
    assert.equal((await unknown.json()).field, "models.image");
    assert.deepEqual(await store.metadata(ownerA), []);

    const firstSaved = await a.put(request(refWrite));
    assert.equal(firstSaved.status, 200);
    const content = await firstSaved.text();
    assert.ok(!content.includes(fakeRef) && !content.includes(fakeRef.slice(-5)));
    assert.equal(JSON.parse(content).groups.reference.version, 1);
    const music = await a.put(request({ group: "music", expectedVersion: 0, apiKey: fakeMusic, models: { music: selected.music } }));
    assert.equal(music.status, 200);
    const imageTest = request({ program: "image", group: "reference", version: 1 }, { method: "POST" });
    const test = await a.test(imageTest);
    assert.equal(test.status, 200);
    const verified = await test.json();
    assert.equal(verified.program, "image");
    assert.equal(verified.status, "verified");
    assert.equal(verified.version, 1);
    probeUnavailable = true;
    try {
      const unavailable = await a.test(request({ program: "music", group: "music", version: 1 }, { method: "POST" }));
      assert.equal(unavailable.status, 200);
      assert.equal((await unavailable.json()).code, "provider_error");
    } finally { probeUnavailable = false; }
    assert.equal(calls.filter(call => call.method === "POST").length, 0);
    assert.equal((await b.get().then(r => r.json())).groups.reference.version, 0);
    assert.equal(await store.open(ownerB, "reference"), undefined);

    const cipherRows = (await admin.query("SELECT ciphertext,nonce,tag,key_id FROM dream_gemini_credentials.credentials ORDER BY provider_group")).rows;
    assert.equal(cipherRows.length, 2);
    assert.ok(cipherRows.every(row => Buffer.isBuffer(row.ciphertext) && row.nonce.length === 12 && row.tag.length === 16));
    const persisted = JSON.stringify(cipherRows);
    assert.ok(!persisted.includes(fakeRef) && !persisted.includes(fakeMusic));
    assert.deepEqual((await first.query("SELECT provider_group FROM dream_gemini_credentials.credentials")).rows, []);
    assert.equal((await admin.query("SELECT has_schema_privilege('authenticated','dream_gemini_credentials','USAGE') AS allowed")).rows[0].allowed, false);

    await first.end();
    const restarted = createGeminiCredentialStore(second, ring("key2"));
    const next = createGeminiCredentialHttp({ authenticate: auth(ownerA), env, store: () => restarted, send: provider });
    const durable = await next.get().then(r => r.json());
    assert.equal(durable.groups.reference.version, 1);
    assert.equal(durable.programs.image.lastTest.checkedAt, verified.checkedAt);
    assert.equal(durable.programs.music.lastTest.code, "provider_error");
    const replace = { ...refWrite, expectedVersion: 1, apiKey: rotatedRef };
    const competing = await Promise.all([next.put(request(replace)), next.put(request(replace))]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    const changed = (await admin.query("SELECT key_id FROM dream_gemini_credentials.credentials WHERE provider_group='reference'")).rows[0];
    assert.equal(changed.key_id, "key2");
    const saved = await next.put(request({ ...replace, expectedVersion: 2, apiKey: undefined }));
    assert.equal(saved.status, 200);
    const metadata = await saved.json();
    assert.equal(metadata.groups.reference.version, 3);
    assert.equal(metadata.programs.image.lastTest, null);
    assert.equal(metadata.programs.music.lastTest.version, 1);
    assert.equal(await restarted.recordTest(ownerA, "reference", 2, "image", null), undefined);
    const stale = await next.test(request({ program: "image", group: "reference", version: 1 }, { method: "POST" }));
    assert.equal(stale.status, 409);

    const read = (owner: string, program: "image" | "music" | "shorts") => currentGeminiSettings(owner, program, restarted, env);
    const image = createAdminReferenceHttp({ authenticate: auth(ownerA), env, analyzeUpload: analyzeLocalMediaUpload,
      async loadImageSemantics(owner) { const choice = await read(owner, "image"); return choice && geminiImageAnalyzer(choice, provider); } });
    const musicAnalysis = createMusicSemanticHttp({ authenticate: auth(ownerA), env,
      async provider(owner) { const choice = await read(owner, "music"); return choice && musicProviderFromSettings(choice, provider); } });
    const shorts = createShortsAnalysisHttp({ authenticate: auth(ownerA), env, fetch: provider, loadSettings: owner => read(owner, "shorts") });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    const imageRequest = request(png, { method: "POST", headers: { "x-dream-media": "image", "x-dream-filename": "fixture.png", "x-dream-semantic": "image" } });
    const audioRequest = request(wav(), { method: "POST", headers: { "x-dream-filename": "fixture.wav", "x-dream-music-external-consent": "true" } });
    const shortsRequest = request({ url: "https://www.youtube.com/shorts/aBcDeFgHiJ0", authorized: true }, { method: "POST" });
    const results = await Promise.all([image.analyze(imageRequest), musicAnalysis.post(audioRequest), shorts.post(shortsRequest)]);
    assert.deepEqual(results.map(r => r.status), [200, 200, 200]);
    const [im, mu, sh] = await Promise.all(results.map(r => r.json()));
    assert.equal(im.semantic.prompts.ko, "이미지 창작 프롬프트");
    assert.equal(mu.semantic.report.sunoPrompt, "새 음악 생성 프롬프트");
    assert.equal(sh.result.findings.draftPrompt, "새 영상 생성 프롬프트");
    const generated = calls.filter(call => call.method === "POST").map(call => [call.model, call.key]);
    assert.deepEqual(new Map(generated as [string, string][]), new Map([
      [selected.image, rotatedRef], [selected.music, fakeMusic], [selected.shorts, rotatedRef],
    ]));
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
  }
  console.log("Gemini credentials PG17: auth/origin, encrypted restart/rotation/CAS, owner isolation, provider validation and three fake analysis outputs passed");
}
