import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminMusicSemantic } from "@/components/admin/admin-music-semantic";
import { createAdminMusicSemanticClient } from "@/components/admin/admin-music-semantic-client";
import { MUSIC_EXTERNAL_CONSENT_HEADER, MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";
import { createMusicSemanticHttp, geminiMusicProvider } from "@/lib/reference-analysis/music-semantic-server";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "admin@example.invalid" } as const;
const report = { genre: "앰비언트", instruments: ["피아노"], tempoBpm: 96,
  structure: [{ label: "도입", description: "잔잔한 피아노 뒤에 리듬이 들어와요." }], sunoPrompt: "Ambient piano, understated drums, 96 BPM" };
const result = { status: "ready", provider: "gemini", report } as const;

function wav() {
  const bytes = Buffer.alloc(44 + 1600);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(1600, 40);
  return new Uint8Array(bytes);
}

function post(body: BodyInit = wav(), headers: Record<string, string> = {}, consent = true) {
  return new Request(site + MUSIC_SEMANTIC_URI, { method: "POST", body, headers: {
    origin: site, host: "studio.example.invalid", "content-type": "application/octet-stream", "x-dream-filename": "example.wav",
    ...(consent ? { [MUSIC_EXTERNAL_CONSENT_HEADER]: "true" } : {}), ...headers,
  } });
}

describe("music semantic route", () => {
  const env = { NODE_ENV: "test", DREAM_SITE_URL: site } as const;

  it("reports only authenticated configuration status and checks authorization, origin and consent before provider use", async () => {
    const provider = vi.fn(() => vi.fn(async () => result));
    const anonymous = createMusicSemanticHttp({ env, authenticate: async () => ({ kind: "local" }), provider });
    expect((await anonymous.get()).status).toBe(401);
    expect((await anonymous.post(post())).status).toBe(401);
    const admin = createMusicSemanticHttp({ env, authenticate: async () => actor, provider });
    expect((await admin.post(post(wav(), { origin: "https://foreign.example.invalid" }))).status).toBe(403);
    expect((await admin.post(post(wav(), {}, false))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    const availability = await admin.get();
    expect(availability.headers.get("cache-control")).toBe("no-store");
    expect(await availability.json()).toEqual({ semantic: { music: "configured" } });
    expect(provider.mock.results[0].value).not.toHaveBeenCalled();
    const absent = createMusicSemanticHttp({ env, authenticate: async () => actor, provider: () => undefined });
    expect(await (await absent.get()).json()).toEqual({ semantic: { music: "not_configured" } });
  });

  it("blocks other types, inaccurate filenames and over-limit actual bodies before sending audio", async () => {
    const run = vi.fn(async () => result);
    const admin = createMusicSemanticHttp({ env, authenticate: async () => actor, provider: () => run });
    expect((await admin.post(post("not music"))).status).toBe(422);
    expect((await admin.post(post(wav(), { "x-dream-filename": "image.png" }))).status).toBe(400);
    expect((await admin.post(post(wav(), { "content-length": String(4 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect((await admin.post(post(new Uint8Array(4 * 1024 * 1024 + 1)))).status).toBe(413);
    expect(run).not.toHaveBeenCalled();
    const answer = await admin.post(post());
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ semantic: result });
    expect(run).toHaveBeenCalledExactlyOnceWith({ bytes: Buffer.from(wav()), mime: "audio/wav" });
  });
});

describe("Gemini music adapter", () => {
  const env = { DREAM_MUSIC_SEMANTIC_GEMINI_API_KEY: "synthetic-key", DREAM_MUSIC_SEMANTIC_GEMINI_MODEL: "gemini-test-model" };
  const output = (value: unknown) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
  const audio = { bytes: Buffer.from(wav()), mime: "audio/wav" };

  it("uses structured audio-only input and distinguishes complete, partial and malformed results", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(output(report)).mockResolvedValueOnce(output({ ...report, tempoBpm: null }))
      .mockResolvedValueOnce(output({ ...report, tempoBpm: "95 BPM" })).mockResolvedValueOnce(new Response("private upstream error", { status: 403 }));
    const run = geminiMusicProvider(env, send)!;
    expect(await run(audio)).toEqual(result);
    expect(await run(audio)).toMatchObject({ status: "partial", report: { tempoBpm: null } });
    expect(await run(audio)).toEqual({ status: "unavailable", reason: "invalid_response" });
    expect(await run(audio)).toEqual({ status: "unavailable", reason: "provider_error" });
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
    expect(init).toMatchObject({ credentials: "omit", redirect: "error", headers: { "x-goog-api-key": "synthetic-key" } });
    const payload = JSON.parse(String(init?.body));
    expect(payload.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "audio/wav", data: audio.bytes.toString("base64") } });
    expect(payload.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
    expect(String(init?.body)).not.toContain("example.wav");
    expect(geminiMusicProvider({ ...env, DREAM_MUSIC_SEMANTIC_GEMINI_MODEL: "gemini-x/../path" }, send)).toBeUndefined();
  });
});

describe("music semantic integration client", () => {
  it("does not upload without consent and sends only the selected file to the dedicated same-origin path", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ semantic: { music: "configured" } }))
      .mockResolvedValueOnce(Response.json({ semantic: result }));
    const client = createAdminMusicSemanticClient(send);
    const file = new File([wav()], "검수.wav");
    expect((await client.analyze(file, false)).kind).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(await client.availability()).toEqual({ kind: "ok", configured: true });
    expect(await client.analyze(file, true)).toEqual({ kind: "ok", result });
    expect(send.mock.calls[1]).toMatchObject([MUSIC_SEMANTIC_URI, { method: "POST", body: file, credentials: "same-origin",
      headers: { "x-dream-filename": encodeURIComponent(file.name), [MUSIC_EXTERNAL_CONSENT_HEADER]: "true" } }]);
    expect(renderToStaticMarkup(createElement(AdminMusicSemantic))).toContain("음악 파일을 선택하면 의미 분석을 실행할 수 있어요.");
  });
});

describe("P1-07-AUDIO-ORIGINAL-PARITY-UI G2 바로 분석 진행 안내", () => {
  it("모드별 기존 진행 문장 뒤에 '수십 초' 안내를 붙이고, 경로 한도(75·90초)를 넘는 '몇 분'은 쓰지 않는다", async () => {
    const { analyzingStatus } = await import("@/components/admin/admin-music-semantic");
    expect(analyzingStatus("music")).toBe("장르, 악기, 템포와 구간 구조를 분석하는 중이에요. 파일 길이에 따라 수십 초 걸릴 수 있어요.");
    expect(analyzingStatus("auto")).toBe("음악인지 음성인지 판별한 뒤 분석하는 중이에요. 파일 길이에 따라 수십 초 걸릴 수 있어요.");
    expect(analyzingStatus("speech")).toBe("요약, 주제, 할 일과 화자별 전사를 분석하는 중이에요. 파일 길이에 따라 수십 초 걸릴 수 있어요.");
    for (const mode of ["music", "auto", "speech"] as const) expect(analyzingStatus(mode)).not.toMatch(/몇 ?분|\d+ ?분/);
  });
  it("진행 안내는 분석 중(busy)에만 role=status 한 줄로 그리고, 단추 쪽 진행 표시는 aria-busy만 쓴다", () => {
    const source = readFileSync("components/admin/admin-music-semantic.tsx", "utf8");
    expect(source.match(/analyzingStatus\(mode\)/g)).toHaveLength(1);
    expect(source).toContain("{busy && <p role=\"status\">{analyzingStatus(mode)}</p>}");
    expect(readFileSync("components/ui/primitives.tsx", "utf8")).not.toMatch(/loading[^\n]*role="status"/);
  });
});
