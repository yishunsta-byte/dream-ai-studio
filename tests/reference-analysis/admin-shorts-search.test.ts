import { describe, expect, it, vi } from "vitest";
import { youtubeShortsSearchPath, youtubeShortsSearchResult } from "@/lib/reference-analysis/youtube-shorts-search-contract";
import { createYouTubeShortsSearchPost } from "@/lib/reference-analysis/youtube-shorts-search-http";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const owner = "10000000-0000-4000-8000-000000000001";
const key = "synthetic_Youtube_Key_D6Y7";
const id = "A1b2C3d4E5F";
const channelId = "UC1234567890123456789012";
const updatedAt = "2026-01-01T00:00:00.000Z";
const body = { query: "demo", order: "date", credentialVersion: 1 };
const request = (input: unknown = body, signal?: AbortSignal) => new Request(site + youtubeShortsSearchPath, {
  method: "POST", headers: { origin: site, host: "studio.example.invalid", "content-type": "application/json" },
  body: JSON.stringify(input), signal,
});
const find = (videoId = id) => Response.json({ items: [{ id: { videoId } }, { id: { videoId } }] });
const details = (privacyStatus = "public") => Response.json({ items: [{
  id, status: { privacyStatus }, snippet: { channelId, channelTitle: "Example", title: "Demo",
    publishedAt: updatedAt, thumbnails: { medium: { url: "https://i.ytimg.com/vi/example/mqdefault.jpg?tracking=fixture" } } },
  statistics: { viewCount: "120", commentCount: "0" }, contentDetails: { duration: "PT1M4S" },
}] });
const channels = () => Response.json({ items: [{ id: channelId,
  statistics: { subscriberCount: "50", hiddenSubscriberCount: true },
}] });

function harness(...responses: Response[]) {
  const send = vi.fn<typeof fetch>();
  for (const response of responses) send.mockResolvedValueOnce(response);
  const store = { metadata: vi.fn().mockResolvedValue({ version: 1, updatedAt }),
    open: vi.fn().mockResolvedValue({ apiKey: key, version: 1, updatedAt }), write: vi.fn() };
  const post = createYouTubeShortsSearchPost({ authenticate: async () => ({ kind: "verified", userId: owner, email: "a@example.invalid" }),
    env: { DREAM_SITE_URL: site }, store: () => store, send });
  return { post, store, send };
}

describe("administrator public Shorts search", () => {
  it("loads public metadata in search order, deduplicates IDs and uses the owner's versioned header key", async () => {
    const { post, send, store } = harness(find(), details(), channels());
    const response = await post(request({ ...body, dateFrom: "2026-01-01", dateTo: "2026-01-31" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(youtubeShortsSearchResult.parse(await response.json())).toEqual({
      schemaVersion: 1, evidence: "youtube_metadata", credentialVersion: 1, items: [{
        id, title: "Demo", channelTitle: "Example", channelId, publishedAt: updatedAt,
        url: "https://www.youtube.com/watch?v=" + id, thumbnailUrl: "https://i.ytimg.com/vi/example/mqdefault.jpg",
        durationSeconds: 64, views: 120, likes: null, comments: 0, subscribers: null,
      }],
    });
    expect(store.open).toHaveBeenCalledExactlyOnceWith(owner);
    expect(store.write).not.toHaveBeenCalled();
    const urls = send.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map(url => url.pathname)).toEqual(["/youtube/v3/search", "/youtube/v3/videos", "/youtube/v3/channels"]);
    expect(urls[0].searchParams.get("publishedBefore")).toEqual("2026-01-31T23:59:59.999Z");
    expect(urls[0].searchParams.get("maxResults")).toBe("50");
    expect(urls[1].searchParams.get("id")).toBe(id);
    for (const [url, init] of send.mock.calls) {
      expect(String(url)).not.toContain(key);
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(key);
      expect(init?.signal).toBe(send.mock.calls[0][1]?.signal);
    }
  });

  it.each([[false, 1], [true, 2]] as const)("skips unnecessary detail calls (private: %s)", async (privateVideo, calls) => {
    const { post, send } = harness(...(privateVideo ? [find(), details("unlisted")] :
      [Response.json({ kind: "youtube#searchListResponse" })]));
    expect(await (await post(request())).json()).toMatchObject({ items: [] });
    expect(send).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ["quotaExceeded", 429, "quota_exceeded"], ["API_KEY_INVALID", 422, "invalid_key"], ["other", 502, "provider_error"],
  ])("maps provider failure %s, even when the diagnostic contains a key", async (reason, status, code) => {
    const { post, send } = harness(Response.json({ error: { message: key, details: [{ reason }] } }, { status: 403 }));
    const response = await post(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects invalid dates, missing key and stale versions without sending upstream", async () => {
    const { post, send, store } = harness();
    expect((await post(request({ ...body, dateFrom: "2026-02-30" }))).status).toBe(400);
    expect((await post(request({ ...body, dateFrom: "2026-02-01", dateTo: "2026-01-31" }))).status).toBe(400);
    expect((await post(request({ ...body, credentialVersion: 2 }))).status).toBe(409);
    store.open.mockResolvedValueOnce(undefined);
    expect(await (await post(request())).json()).toEqual({ code: "not_configured" });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps one in-process search per owner, cancels pending fetch and releases the next search", async () => {
    const { post, send } = harness();
    const entered = Promise.withResolvers();
    send.mockImplementationOnce(async (_url, init) => {
      entered.resolve(undefined);
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    });
    const controller = new AbortController();
    const pending = post(request(body, controller.signal));
    await entered.promise;
    const duplicate = await post(request());
    expect(duplicate.status).toBe(429);
    expect(await duplicate.json()).toEqual({ code: "search_in_progress" });
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(send).toHaveBeenCalledOnce();
    send.mockResolvedValueOnce(Response.json({ items: [] }));
    expect((await post(request())).status).toBe(200);
  });

  it("does not send the next detail call after an in-flight key rotation", async () => {
    const { post, send, store } = harness(find());
    store.metadata.mockResolvedValueOnce({ version: 1, updatedAt }).mockResolvedValueOnce({ version: 2, updatedAt });
    const response = await post(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "stale" });
    expect(send).toHaveBeenCalledOnce();
  });
});
