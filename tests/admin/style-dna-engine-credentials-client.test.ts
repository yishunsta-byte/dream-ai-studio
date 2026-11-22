import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdminPlatformIntegrations } from "@/components/admin/admin-platform-integrations";
import {
  acceptsEngineKey, acceptsEngineModel, readStyleDnaEngineSettings, saveStyleDnaEngineSetting,
} from "@/components/admin/style-dna-engine-credentials-client";
import { styleDnaEngineCredentialPath } from "@/lib/reference-analysis/style-dna-engine-credential-contract";

const key = "synthetic_registration_key";
const signal = new AbortController().signal;
const openai = { configured: true, version: 1, modelId: "gpt-fixture", updatedAt: "2026-01-01T00:00:00.000Z" };
const anthropic = { configured: false, version: 0, modelId: null, updatedAt: null };
const settings = { providers: { openai, anthropic } };
const request = { provider: "openai", expectedVersion: 0, modelId: openai.modelId, apiKey: key } as const;

function stub(status: number, body: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("image analysis engine registration", () => {
  it("renders a protected registration entry without rendering keys or actions to test connections", () => {
    const html = renderToStaticMarkup(createElement(AdminPlatformIntegrations, { email: "fixture@example.invalid" }));
    expect(html).toContain("보안 키 금고");
    expect(html).toContain("OpenAI 키·모델");
    expect(html).toContain("Claude 키·모델");
    expect(html).toContain("Gemini 키·모델");
    expect(html).toContain("YouTube Data API v3 등록");
    expect(html).toContain("Google Drive 설정 가이드");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain(key);
  });

  it("loads only same-origin metadata and rejects unexpected secret fields", async () => {
    const fetch = stub(200, settings);
    expect(await readStyleDnaEngineSettings(signal)).toEqual({ kind: "ok", value: settings });
    expect(fetch).toHaveBeenCalledWith(styleDnaEngineCredentialPath, { credentials: "same-origin", cache: "no-store", method: "GET", signal });
    stub(200, { providers: { ...settings.providers, openai: { ...openai, apiKey: key } } });
    expect(await readStyleDnaEngineSettings(signal)).toEqual({ kind: "failed" });
    stub(200, { providers: { ...settings.providers, openai: { ...openai, modelId: "claude-wrong" } } });
    expect(await readStyleDnaEngineSettings(signal)).toEqual({ kind: "failed" });
  });

  it("uses the expected version and sends a key only if registering or replacing it", async () => {
    const reply = { provider: "openai", setting: openai };
    const fetch = stub(200, reply);
    expect(await saveStyleDnaEngineSetting(request, signal)).toEqual({ kind: "ok", value: reply });
    expect(fetch).toHaveBeenCalledWith(styleDnaEngineCredentialPath, expect.objectContaining({
      method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
    }));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(request);
    const modelOnly = { provider: "openai", expectedVersion: 1, modelId: "o3-fixture" } as const;
    const changed = stub(200, { provider: "openai", setting: { ...openai, version: 2, modelId: modelOnly.modelId } });
    expect((await saveStyleDnaEngineSetting(modelOnly, signal)).kind).toBe("ok");
    expect(JSON.parse(String(changed.mock.calls[0][1]?.body))).toEqual(modelOnly);
    stub(200, { provider: "anthropic", setting: openai });
    expect(await saveStyleDnaEngineSetting(request, signal)).toEqual({ kind: "failed" });
  });

  it.each([
    [401, "AUTH_REQUIRED", "login"], [403, "FORBIDDEN", "forbidden"], [400, "invalid_input", "invalid"],
    [409, "stale", "stale"], [503, "storage_unavailable", "storage"], [503, "AUTH_UNAVAILABLE", "failed"],
  ] as const)("keeps response %i detail out of the interface", async (status, code, kind) => {
    stub(status, { code, error: key });
    expect(await saveStyleDnaEngineSetting(request, signal)).toEqual({ kind });
  });

  it("validates the two model families and key shape", () => {
    expect(acceptsEngineModel("openai", "o3-fixture")).toBe(true);
    expect(acceptsEngineModel("anthropic", "claude-fixture")).toBe(true);
    expect(acceptsEngineModel("openai", "claude-fixture")).toBe(false);
    expect(acceptsEngineKey(key)).toBe(true);
    expect(acceptsEngineKey("")).toBe(false);
  });
});
