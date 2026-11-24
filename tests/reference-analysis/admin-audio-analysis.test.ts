import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_AUDIO_ANALYSIS_URI, ADMIN_AUDIO_MODE_HEADER, adminAudioResponseSchema,
} from "@/lib/reference-analysis/admin-audio-contract";
import { createAdminAudioAnalysisPost } from "@/lib/reference-analysis/admin-audio-analysis-server";
import { audioUploadStart, adminAudioUploadLimit } from "@/lib/reference-analysis/admin-audio-upload-contract";
import { MUSIC_EXTERNAL_CONSENT_HEADER } from "@/lib/reference-analysis/music-semantic-contract";

vi.mock("server-only", () => ({}));

const site = "https://studio.example.invalid";
const env = { NODE_ENV: "test", DREAM_SITE_URL: site };
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "admin@example.invalid" } as const;
const music = { genre: "Ambient", instruments: ["Piano"], tempoBpm: 96,
  structure: null, sunoPrompt: "Ambient piano at 96 BPM" };
const speech = { summary: "A decision to prepare a demo.",
  topicsAndKeywords: [{ topic: "Demo", keywords: null }],
  actionItems: [{ task: "Prepare a demo", assignee: null, dueDate: null }],
  fullTranscription: [{ speaker: null, timestamp: "00:02", text: "Let's prepare a demo." }] };

function request(mode: string, override: Record<string, string> = {}, body: BodyInit = "RIFF\0\0\0\0WAVE", signal?: AbortSignal) {
  return new Request(site + ADMIN_AUDIO_ANALYSIS_URI, { method: "POST", body, signal, headers: {
    origin: site, host: "studio.example.invalid", "content-type": "application/octet-stream",
    "x-dream-filename": "example.wav", [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", [ADMIN_AUDIO_MODE_HEADER]: mode, ...override,
  } });
}

const providerReply = (value: unknown) => Response.json({
  candidates: [{ finishReason: "STOP", content: { parts: [
    { text: "omit this thought", thought: true }, { text: JSON.stringify(value) },
  ] } }],
});

function fixture(...responses: Response[]) {
  const send = vi.fn<typeof fetch>();
  for (const response of responses) send.mockResolvedValueOnce(response);
  const settings = vi.fn(async () => ({ key: "synthetic", model: "gemini-audio-test" }));
  return { send, settings, post: createAdminAudioAnalysisPost({ authenticate: async () => actor, env, settings, send }) };
}

async function result(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return adminAudioResponseSchema.parse(await response.json());
}

describe("versioned administrator audio analysis", () => {
  it("skips detection for explicit speech and music and keeps unknown speech details null", async () => {
    const { post, settings, send } = fixture(providerReply(speech), providerReply(music));
    expect(await result(await post(request("speech")))).toEqual({
      schemaVersion: 1, requestedMode: "speech", kind: "speech", status: "ready", provider: "gemini", report: speech,
    });
    expect(await result(await post(request("music")))).toEqual({
      schemaVersion: 1, requestedMode: "music", kind: "music", status: "partial", provider: "gemini", report: music,
    });
    expect(settings).toHaveBeenNthCalledWith(1, actor.userId);
    expect(settings).toHaveBeenNthCalledWith(2, actor.userId);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).generationConfig.responseJsonSchema.properties).toHaveProperty("fullTranscription");
    expect(JSON.parse(String(send.mock.calls[1][1]?.body)).generationConfig.responseJsonSchema.properties).toHaveProperty("sunoPrompt");
  });

  it.each([["speech", speech], ["music", music]] as const)("uses one shared deadline for auto classification and %s", async (kind, report) => {
    const { post, send } = fixture(providerReply({ kind }), providerReply(report));
    expect(await result(await post(request("auto")))).toMatchObject({ schemaVersion: 1, requestedMode: "auto", kind, report });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]?.signal).toBe(send.mock.calls[1][1]?.signal);
  });

  it.each([
    [() => providerReply({ kind: "undetermined" }), "undetermined"],
    [() => providerReply({ kind: "ambiguous prose" }), "invalid_response"],
    [() => Response.json({ error: "private detail" }, { status: 429 }), "provider_error"],
  ] as const)("does not submit audio again after unsuccessful detection (%s)", async (response, reason) => {
    const { post, send } = fixture(response());
    expect(await result(await post(request("auto")))).toEqual({
      schemaVersion: 1, requestedMode: "auto", kind: "undetermined", status: "unavailable", reason,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not start a report when the request is aborted during classification", async () => {
    const client = new AbortController();
    const { post, send } = fixture();
    send.mockImplementationOnce(async (_url, init) => {
      client.abort();
      expect(init?.signal?.aborted).toBe(true);
      return providerReply({ kind: "speech" });
    });
    expect(await result(await post(request("auto", {}, "RIFF\0\0\0\0WAVE", client.signal)))).toMatchObject({
      status: "unavailable", reason: "timed_out",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps request and account rejections outside the provider boundary", async () => {
    const { post, settings, send } = fixture();
    expect((await post(request("auto", { [MUSIC_EXTERNAL_CONSENT_HEADER]: "false" }))).status).toBe(400);
    expect((await post(request("auto", { origin: "https://foreign.example.invalid" }))).status).toBe(403);
    expect((await post(request("unknown"))).status).toBe(400);
    expect(settings).not.toHaveBeenCalled();
    // 판별되지 않는 입력은 서버 측정으로만 확인한다. 측정 도구가 없는 상태를 고정해 503·전송 0을 확인하고,
    // 알려진 비오디오(GIF)는 측정 없이 바로 422로 닫히는지 확인한다.
    vi.stubEnv("FFPROBE_PATH", "/nonexistent/dream-missing-ffprobe");
    vi.stubEnv("FFMPEG_PATH", "/nonexistent/dream-missing-ffmpeg");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await post(request("auto", {}, new Uint8Array(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]))))).status).toBe(422);
    expect((await post(request("auto", {}, "not audio"))).status).toBe(503);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    expect(send).not.toHaveBeenCalled();

    const unconfigured = createAdminAudioAnalysisPost({ authenticate: async () => actor, env, settings: async () => undefined, send });
    expect(await result(await unconfigured(request("auto")))).toMatchObject({ kind: "undetermined", reason: "not_configured" });
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts FLAC names at the protected upload boundary and never sends mismatched bytes unconfirmed", async () => {
    const { post, send } = fixture();
    const input = { filename: "analysis.FLAC", sizeBytes: adminAudioUploadLimit, credentialVersion: 1,
      requestId: "10000000-0000-4000-8000-000000000002", authorized: true };
    expect(audioUploadStart.safeParse(input).success).toBe(true);
    expect(audioUploadStart.safeParse({ ...input, sizeBytes: input.sizeBytes + 1 }).success).toBe(false);
    expect(audioUploadStart.safeParse({ ...input, filename: "../analysis.flac" }).success).toBe(false);
    // 판별되지 않는 입력은 서버 측정으로만 확인한다. 측정 도구가 없는 상태를 고정해 503·전송 0을 확인하고,
    // 알려진 비오디오(GIF)는 측정 없이 바로 422로 닫히는지 확인한다.
    vi.stubEnv("FFPROBE_PATH", "/nonexistent/dream-missing-ffprobe");
    vi.stubEnv("FFMPEG_PATH", "/nonexistent/dream-missing-ffmpeg");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unconfirmed = await post(request("music", { "x-dream-filename": input.filename }));
    expect(unconfirmed.status).toBe(503);
    expect(await unconfirmed.json()).toEqual({ error: "media_unavailable" });
    const mismatch = await post(request("music", { "x-dream-filename": input.filename }, new Uint8Array(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]))));
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toEqual({ error: "invalid_file" });
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
