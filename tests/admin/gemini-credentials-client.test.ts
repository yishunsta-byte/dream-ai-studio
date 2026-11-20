import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDENTIALS_URI, TEST_URI, isKeyFormat, isModelId, readCredentialSettings, saveCredentialSettings, testCredential } from "@/components/admin/gemini-credentials-client";

// Backend 계약(msg_bb18c2ae5fd0)에 맞춘 화면 쪽 통신: 상태 분류, 요청 모양, 키 비노출.
const settings = {
  storage: "ready",
  groups: { reference: { version: 1, updatedAt: "2026-11-21T04:00:00.000Z" }, music: { version: 0, updatedAt: null } },
  programs: {
    image: { configured: true, source: "stored", modelId: "gemini-image-test" },
    shorts: { configured: true, source: "stored", modelId: "gemini-shorts-test" },
    music: { configured: true, source: "environment", modelId: null },
  },
};
const KEY = "SYNTHETIC-ONLY-KEY-0000000000";
function reply(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("Gemini 설정 통신", () => {
  it("GET은 같은 출처·캐시 없음으로 읽고 계약 모양만 받는다", async () => {
    const fetch = reply(200, settings);
    expect(await readCredentialSettings(new AbortController().signal)).toEqual({ kind: "ok", value: settings });
    expect(fetch).toHaveBeenCalledWith(CREDENTIALS_URI, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }));
    reply(200, { ...settings, programs: { ...settings.programs, image: { ...settings.programs.image, source: "browser" } } });
    expect((await readCredentialSettings(new AbortController().signal)).kind).toBe("failed");
  });

  it("PUT은 묶음·예상 버전·모델을 보내고, 키는 넣었을 때만 싣는다", async () => {
    const fetch = reply(200, settings);
    await saveCredentialSettings({ group: "reference", expectedVersion: 1, models: { image: "a", shorts: "b" } }, new AbortController().signal);
    const [, first] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(first).toMatchObject({ method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(first.body))).toEqual({ group: "reference", expectedVersion: 1, models: { image: "a", shorts: "b" } });
    await saveCredentialSettings({ group: "music", expectedVersion: 0, apiKey: KEY, models: { music: "m" } }, new AbortController().signal);
    const [, second] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(second.body))).toEqual({ group: "music", expectedVersion: 0, apiKey: KEY, models: { music: "m" } });
  });

  it("성공 응답에 키가 섞여 와도 화면 상태에는 남기지 않는다", async () => {
    reply(200, { ...settings, apiKey: KEY, programs: { ...settings.programs, music: { ...settings.programs.music, hint: "0000" } } });
    const outcome = await readCredentialSettings(new AbortController().signal);
    expect(outcome.kind).toBe("ok");
    expect(JSON.stringify(outcome)).not.toMatch(/SYNTHETIC|hint/);
  });

  it.each([
    [401, { code: "AUTH_REQUIRED", error: "x" }, { kind: "login" }],
    [403, { code: "AUTH_ORIGIN_REJECTED", error: "x" }, { kind: "forbidden" }],
    [409, { code: "stale", error: "x" }, { kind: "stale" }],
    [400, { code: "invalid_input", error: "x", field: "models.image" }, { kind: "field", field: "models.image", code: "invalid_input" }],
    [422, { code: "invalid_key", error: "x", field: "apiKey" }, { kind: "field", field: "apiKey", code: "invalid_key" }],
    [422, { code: "model_not_found", error: "x", field: "models.music" }, { kind: "field", field: "models.music", code: "model_not_found" }],
    [503, { code: "storage_unavailable", error: "x" }, { kind: "storage" }],
    [503, { code: "provider_error", error: "x" }, { kind: "provider" }],
    [503, { code: "AUTH_UNAVAILABLE", error: "x" }, { kind: "failed" }],
    [504, { code: "timed_out", error: "x" }, { kind: "timeout" }],
    [415, { code: "UNSUPPORTED_MEDIA_TYPE", error: "x" }, { kind: "failed" }],
    [400, { code: "invalid_input", error: "x" }, { kind: "failed" }],
    [400, { code: "invalid_input", error: "x", field: "expectedVersion" }, { kind: "failed" }],
  ])("HTTP %i %j → %j", async (status, body, expected) => {
    reply(status, body);
    expect(await saveCredentialSettings({ group: "reference", expectedVersion: 0, apiKey: KEY, models: { image: "a", shorts: "b" } }, new AbortController().signal)).toEqual(expected);
  });

  it("연결 실패는 failed, 사용자가 떠나 취소한 요청은 그대로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await readCredentialSettings(new AbortController().signal)).toEqual({ kind: "failed" });
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); throw new DOMException("aborted", "AbortError"); }));
    await expect(readCredentialSettings(controller.signal)).rejects.toThrow();
  });

  it("연결 시험은 분석기·묶음·저장 버전을 보내고 결과를 그대로 받는다", async () => {
    const result = { program: "music", version: 2, status: "failed", code: "timed_out", checkedAt: "2026-11-21T04:00:00.000Z" };
    const fetch = reply(200, result);
    expect(await testCredential({ program: "music", group: "music", version: 2 }, new AbortController().signal)).toEqual({ kind: "ok", value: result });
    const [uri, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(uri).toBe(TEST_URI);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init.body))).toEqual({ program: "music", group: "music", version: 2 });
    reply(200, { ...result, status: "verified" });
    expect((await testCredential({ program: "music", group: "music", version: 2 }, new AbortController().signal)).kind).toBe("failed");
    reply(200, { ...result, version: 0 });
    expect((await testCredential({ program: "music", group: "music", version: 2 }, new AbortController().signal)).kind).toBe("failed");
    reply(409, { code: "stale", error: "x" });
    expect(await testCredential({ program: "image", group: "reference", version: 1 }, new AbortController().signal)).toEqual({ kind: "stale" });
  });

  it("GET의 최근 시험 기록을 받는다", async () => {
    const lastTest = { version: 1, status: "verified", code: null, checkedAt: "2026-11-21T04:00:00.000Z" };
    reply(200, { ...settings, programs: { ...settings.programs, image: { ...settings.programs.image, lastTest } } });
    const outcome = await readCredentialSettings(new AbortController().signal);
    expect(outcome.kind === "ok" && outcome.value.programs.image.lastTest).toEqual(lastTest);
  });

  it("키 형식 규칙은 서버 계약과 같다", () => {
    for (const ok of ["a".repeat(16), "AIza_SYNTHETIC-123456", "x".repeat(256)]) expect(isKeyFormat(ok), ok).toBe(true);
    for (const bad of ["short", "a".repeat(15), "x".repeat(257), "has space 1234567890", "slash/1234567890123"]) expect(isKeyFormat(bad), bad).toBe(false);
  });

  it("모델 ID 규칙은 계약과 같다", () => {
    for (const ok of ["gemini-2", "a", "A.b_c-d", "x".repeat(128)]) expect(isModelId(ok), ok).toBe(true);
    for (const bad of ["", " ", "models/gemini", "-gemini", ".x", "x".repeat(129), "gemini 2", "gemini/2"]) expect(isModelId(bad), bad).toBe(false);
  });
});
