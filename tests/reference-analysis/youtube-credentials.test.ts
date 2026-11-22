import { describe, expect, it, vi } from "vitest";
import { youtubeCredentialMetadata, youtubeCredentialPath } from "@/lib/reference-analysis/youtube-credential-contract";
import { createYouTubeCredentialHttp } from "@/lib/reference-analysis/youtube-credential-http";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "admin@example.invalid" } as const;
const key = "synthetic_test_key_for_youtube";
const stamp = "2026-01-01T12:00:00.000Z";
const req = (input: unknown, origin = site) => new Request(site + youtubeCredentialPath, {
  method: "PUT", headers: { origin, host: "studio.example.invalid", "content-type": "application/json" }, body: JSON.stringify(input),
});

describe("administrator YouTube credentials", () => {
  it("returns only metadata and writes the actor's key using the expected version", async () => {
    const store = { metadata: vi.fn().mockResolvedValue(undefined), open: vi.fn(),
      write: vi.fn().mockResolvedValueOnce({ version: 1, updatedAt: stamp }).mockResolvedValueOnce(undefined) };
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ kind: "youtube#videoCategoryListResponse" }));
    const handler = createYouTubeCredentialHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: site }, store: () => store, send });
    const get = await handler.get();
    expect(get.headers.get("cache-control")).toBe("private, no-store");
    expect(youtubeCredentialMetadata.parse(await get.json())).toEqual({ configured: false, version: 0, updatedAt: null });
    expect(store.metadata).toHaveBeenCalledWith(actor.userId);
    const response = await handler.put(req({ expectedVersion: 0, apiKey: key }));
    expect(response.status).toBe(200);
    expect(youtubeCredentialMetadata.parse(await response.json())).toEqual({ configured: true, version: 1, updatedAt: stamp });
    expect(store.write).toHaveBeenCalledWith(actor.userId, key, 0);
    const [url, options] = send.mock.calls[0];
    expect(String(url)).toBe("https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=KR");
    expect(new Headers(options?.headers).get("x-goog-api-key")).toBe(key);
    expect(store.open).not.toHaveBeenCalled();
    const stale = await handler.put(req({ expectedVersion: 0, apiKey: key }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: "stale" });
  });

  it("does not replace the stored key when YouTube rejects the new key", async () => {
    const store = { metadata: vi.fn().mockResolvedValue({ version: 2, updatedAt: stamp }), open: vi.fn(), write: vi.fn() };
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      error: { errors: [{ reason: "keyInvalid" }], message: key },
    }, { status: 403 }));
    const handler = createYouTubeCredentialHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: site }, store: () => store, send });
    const result = await handler.put(req({ expectedVersion: 2, apiKey: key }));
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ code: "invalid_key" });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("authenticates and rejects cross-origin, malformed, or oversized writes before accessing storage", async () => {
    const store = vi.fn(() => null);
    const handler = createYouTubeCredentialHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: site }, store });
    const anonymous = createYouTubeCredentialHttp({ authenticate: async () => ({ kind: "local" }), store });
    expect((await anonymous.get()).status).toBe(401);
    expect((await handler.put(req({ expectedVersion: 0, apiKey: key }, "https://foreign.example.invalid"))).status).toBe(403);
    expect((await handler.put(req({ expectedVersion: 0, apiKey: "bad" }))).status).toBe(400);
    expect((await handler.put(req({ expectedVersion: 0, apiKey: "a".repeat(8193) }))).status).toBe(413);
    expect(store).not.toHaveBeenCalled();
  });
});
