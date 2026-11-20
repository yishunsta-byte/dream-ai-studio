import { describe, expect, it, vi } from "vitest";
import { SHORTS_ANALYSIS_URI, youtubeVideoId } from "@/lib/reference-analysis/shorts-analysis-contract";
import { createShortsAnalysisHttp } from "@/lib/reference-analysis/shorts-analysis-http";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.com";
const id = "A1b2C3d4E5_";
const input = { url: `https://www.youtube.com/shorts/${id}?si=removed#excluded`, authorized: true };
const settings = {
  DREAM_SITE_URL: site,
  DREAM_REFERENCE_GEMINI_API_KEY: "test-key",
  DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "gemini-test",
};
const authenticate = async () => ({
  kind: "verified", userId: "10000000-0000-4000-8000-000000000011", email: "admin@example.com",
} as const);

function request(body: unknown = input, origin = site, type = "application/json") {
  return new Request(site + SHORTS_ANALYSIS_URI, {
    method: "POST",
    headers: { host: "studio.example.com", origin, "content-type": type },
    body: JSON.stringify(body),
  });
}

const findings = {
  summary: "컵을 책상에 놓는 장면",
  hook: "처음에 컵을 크게 보여 줌",
  composition: "한 사람과 컵이 보임",
  sound: null,
  segments: [{ timestamp: "00:03", evidence: "컵이 책상에 닿는 장면" }],
  draftPrompt: "컵을 들어 올리는 동작을 측면에서 찍는다.",
};

function modelResponse(output: unknown, finishReason = "STOP") {
  return Response.json({ candidates: [{ finishReason, content: {
    parts: [{ thought: true, text: "ignored" }, { text: JSON.stringify(output) }],
  } }] });
}

describe("Shorts video URLs", () => {
  it.each([
    input.url,
    `https://youtu.be/${id}`,
    `https://m.youtube.com/watch?v=${id}&feature=share`,
  ])("extracts the exact video identifier from %s", url => expect(youtubeVideoId(url)).toBe(id));

  it.each([
    `https://youtube.com.example.net/shorts/${id}`,
    `http://youtube.com/shorts/${id}`,
    `https://user@youtube.com/shorts/${id}`,
    `https://youtube.com/watch?v=${id}&v=A1b2C3d4E50`,
    `https://youtube.com/shorts/${id}/extra`,
  ])("rejects unsupported URL %s", url => expect(youtubeVideoId(url)).toBeNull());
});

describe("Shorts admin analysis route", () => {
  it("reads only configuration status for verified administrators without calling the provider", async () => {
    const provider = vi.fn<typeof fetch>();
    const withConfig = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider });
    const noConfig = createShortsAnalysisHttp({
      authenticate, env: { ...settings, DREAM_REFERENCE_SHORTS_GEMINI_MODEL: "invalid" }, fetch: provider,
    });
    const anonymous = createShortsAnalysisHttp({ authenticate: async () => ({ kind: "local" }), env: settings, fetch: provider });
    const available = await withConfig.get();
    expect(available.status).toBe(200);
    expect(available.headers.get("cache-control")).toBe("no-store");
    expect(await available.json()).toEqual({ semantic: { shorts: "configured" } });
    expect(await (await noConfig.get()).json()).toEqual({ semantic: { shorts: "not_configured" } });
    expect((await anonymous.get()).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it("checks authentication, same origin, request type, rights and URL before calling the provider", async () => {
    const provider = vi.fn<typeof fetch>();
    const anonymous = createShortsAnalysisHttp({ authenticate: async () => ({ kind: "local" }), env: settings, fetch: provider }).post;
    const analyze = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post;
    expect((await anonymous(request())).status).toBe(401);
    expect((await analyze(request(input, "https://other.example.com"))).status).toBe(403);
    expect((await analyze(request(input, site, "text/plain"))).status).toBe(415);
    expect((await analyze(request({ ...input, authorized: false }))).status).toBe(400);
    expect((await analyze(request({ ...input, url: "https://example.com/video" }))).status).toBe(400);
    expect((await analyze(request({ ...input, url: "x".repeat(9_000) }))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports unavailable configuration without fetching the video or a provider", async () => {
    const provider = vi.fn<typeof fetch>();
    const analyze = createShortsAnalysisHttp({ authenticate, env: { DREAM_SITE_URL: site }, fetch: provider }).post;
    const response = await analyze(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("sends only the canonical video reference and validates the returned evidence", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(modelResponse({ ...findings, privateField: "discard" }));
    const analyze = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post;
    const response = await analyze(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ result: { evidence: "youtube_video", findings } });
    expect(provider).toHaveBeenCalledTimes(1);
    const [endpoint, options] = provider.mock.calls[0];
    expect(endpoint).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body.contents[0].parts[0]).toEqual({ fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } });
    expect(String(options?.body)).not.toContain("removed");
    expect(String(options?.body)).not.toContain("test-key");
  });

  it("keeps provider errors private and rejects incomplete or invalid findings", async () => {
    const provider = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private error details", { status: 400 }))
      .mockResolvedValueOnce(modelResponse(findings, "MAX_TOKENS"))
      .mockResolvedValueOnce(modelResponse({ ...findings, segments: [{ timestamp: "00:99", evidence: "invalid" }] }));
    const analyze = createShortsAnalysisHttp({ authenticate, env: settings, fetch: provider }).post;
    for (const error of ["provider_error", "invalid_response", "invalid_response"]) {
      const response = await analyze(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error });
    }
  });
});
