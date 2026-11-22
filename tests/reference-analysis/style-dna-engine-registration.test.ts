import { describe, expect, it, vi } from "vitest";
import { createStyleDnaEngineCredentialHttp } from "@/lib/reference-analysis/style-dna-engine-credential-http";
import { styleDnaEngineCredentialPath } from "@/lib/reference-analysis/style-dna-engine-credential-contract";

vi.mock("server-only", () => ({}));

const origin = "https://studio.example.invalid";
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "admin@example.invalid" } as const;
const key = "synthetic_provider_private_key";
const updatedAt = "2026-01-01T00:00:00.000Z";
const req = (value: unknown) => new Request(origin + styleDnaEngineCredentialPath, {
  method: "PUT", headers: { origin, host: "studio.example.invalid", "content-type": "application/json" }, body: JSON.stringify(value),
});

describe("image engine registration", () => {
  it("checks a model with the provider before saving and returns only the metadata", async () => {
    const modelId = "gpt-fixture";
    const metadata = { configured: true, version: 1, modelId, updatedAt } as const;
    const store = { metadata: vi.fn().mockResolvedValue({}), open: vi.fn(), write: vi.fn().mockResolvedValue(metadata) };
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: modelId }));
    const http = createStyleDnaEngineCredentialHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, store: () => store, send });
    const body = { provider: "openai", apiKey: key, modelId, expectedVersion: 0 };
    const result = await http.put(req(body));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ provider: "openai", setting: metadata });
    expect(send.mock.calls[0][0]).toBe("https://api.openai.com/v1/models/gpt-fixture");
    expect(new Headers(send.mock.calls[0][1]?.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(store.open).not.toHaveBeenCalled();
    expect(store.write).toHaveBeenCalledWith(actor.userId, body);
  });

  it("reuses the owner's existing credential and leaves it intact if the model is unavailable", async () => {
    const existing = { configured: true, version: 2, modelId: "claude-old", updatedAt, apiKey: key } as const;
    const store = { metadata: vi.fn().mockResolvedValue({ anthropic: existing }), open: vi.fn().mockResolvedValue(existing), write: vi.fn() };
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: key }, { status: 404 }));
    const http = createStyleDnaEngineCredentialHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, store: () => store, send });
    const result = await http.put(req({ provider: "anthropic", modelId: "claude-next", expectedVersion: 2 }));
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ code: "model_not_found" });
    expect(store.open).toHaveBeenCalledWith(actor.userId, "anthropic");
    expect(send.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/models/claude-next");
    expect(store.write).not.toHaveBeenCalled();
  });
});
