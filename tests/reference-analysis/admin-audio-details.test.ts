import { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMedia } from "@/lib/media/tools";
import { ADMIN_AUDIO_ANALYSIS_URI, ADMIN_AUDIO_MODE_HEADER, adminAudioResponseSchema } from "@/lib/reference-analysis/admin-audio-contract";
import {
  ADMIN_AUDIO_REPORT_PROFILE_HEADER, ADMIN_AUDIO_REPORT_VERSION_HEADER, detailedAudioResponseLimit, detailedAudioResponseSchema, detailedAudioSegmentLimit,
} from "@/lib/reference-analysis/admin-audio-details-contract";
import { createAdminAudioAnalysisPost } from "@/lib/reference-analysis/admin-audio-analysis-server";
import { audioUploadCommand } from "@/lib/reference-analysis/admin-audio-upload-contract";
import { audioUploadDto, type AudioUploadRow } from "@/lib/reference-analysis/admin-audio-upload-store";
import { MUSIC_EXTERNAL_CONSENT_HEADER, MUSIC_MODEL_VERSION_HEADER } from "@/lib/reference-analysis/music-semantic-contract";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/tools", () => ({ mediaBinary: (name: string) => name, runMedia: vi.fn() }));

const owner = { kind: "verified", userId: "10000000-0000-4000-8000-000000000001", email: "fixture@example.invalid" } as const;
const origin = "https://studio.example.invalid";
const env = { NODE_ENV: "test", DREAM_SITE_URL: origin };
const key = "synthetic-private-key";
const probe = { streams: [{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "48000", channels: 1 }],
  format: { duration: "1.25" } };
const measurement = { source: "server_probe", durationSeconds: 1.25, sampleRateHz: 48000, channels: 1 };
const metadata = { schemaVersion: 2, status: "partial", evidence: "model_estimate", unknownValueReason: "not_established_from_audio", measurement };
const speech = {
  summary: "A proposed release review.", topicsAndKeywords: null, actionItems: null,
  speakers: [{ name: "Speaker 1", role: "Facilitator", manner: "Measured delivery", contribution: "Proposed a review" }],
  questions: [{ text: "Can we review today?", speaker: "Speaker 1", context: null }],
  delivery: { tone: null, pace: "Measured", pauses: "A short pause before the question", fillers: null },
  acousticQuality: { clarity: "Clear voice", background: null, issues: null },
  segments: [
    { speaker: "Speaker 1", text: "Can we review today?", startSec: 0.1, endSec: 0.9 },
    { speaker: null, text: "Today?", startSec: 1, endSec: 1.4 },
    { speaker: null, text: "Review?", startSec: 2.5, endSec: 2.6 },
    { speaker: null, text: "When?", startSec: 0.03, endSec: 0.09 },
  ],
};
const coreMusic = { genre: "Ambient", instruments: ["Piano"], tempoBpm: 96, structure: [{ label: "Intro", description: "Piano enters" }],
  sunoPrompt: "Ambient piano with a close, soft texture" };
const music = { ...coreMusic, mood: "Quiet",
  rhythm: { timeSignature: "4/4", feel: "Steady pulses" }, harmony: { key: "C major", scale: "Major", chordProgression: "C to Am" },
  lyrics: { status: "instrumental", text: null }, stems: { vocals: null, bass: "Sustained tone", drums: null, others: "Piano" },
  qualityEstimates: { suspectedUpscale: null, compression: "Possible artifacts", editTraces: null, basis: "Ringing around stronger notes" },
};
const pack = (value: unknown, modelVersion?: string) => JSON.stringify({ modelVersion, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
const provider = (value: unknown) => new Response(pack(value));
const expanded = { [ADMIN_AUDIO_REPORT_PROFILE_HEADER]: "expanded" };

function request(mode: string, version: string | null = "2", overrides: Record<string, string> = {}, body: BodyInit = "RIFF\0\0\0\0WAVE") {
  return new Request(origin + ADMIN_AUDIO_ANALYSIS_URI, { method: "POST", body, headers: {
    origin, host: new URL(origin).host, "content-type": "application/octet-stream",
    "x-dream-filename": "fixture.wav", [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", [ADMIN_AUDIO_MODE_HEADER]: mode,
    ...(version !== null && { [ADMIN_AUDIO_REPORT_VERSION_HEADER]: version }), ...overrides,
  } });
}

function fixture(...responses: Response[]) {
  const send = vi.fn<typeof fetch>();
  for (const response of responses) send.mockResolvedValueOnce(response);
  const settings = vi.fn(async () => ({ key, model: "gemini-fixture" }));
  return { send, settings, post: createAdminAudioAnalysisPost({ authenticate: async () => owner, env, settings, send }) };
}

async function result(response: Promise<Response>) {
  const reply = await response;
  expect(reply.status).toBe(200);
  return detailedAudioResponseSchema.parse(await reply.json());
}

beforeEach(() => {
  vi.mocked(runMedia).mockReset().mockImplementation(name => Object.assign(Promise.resolve({
    stdout: name === "ffprobe" ? JSON.stringify(probe) : "", stderr: "",
  }), { child: new ChildProcess() }));
});

describe("administrator audio detailed report v2", () => {
  it("returns model speaker and question findings with a bounded transcript and independently measured values", async () => {
    const { post, send, settings } = fixture(provider(speech));
    const detail = await result(post(request("speech")));
    expect(detail).toMatchObject({ ...metadata, kind: "speech", report: { speakers: speech.speakers,
      questions: speech.questions, delivery: speech.delivery, transcription: { status: "sampled", reason: "model_sample",
        range: { fromSec: 0.1, throughSec: 1 }, segments: [
          speech.segments[0], { ...speech.segments[1], endSec: null },
          { ...speech.segments[2], startSec: null, endSec: null }, { ...speech.segments[3], startSec: null, endSec: null },
        ] } } });
    expect(JSON.stringify(detail)).not.toContain("fullTranscription");
    const requestBody = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(requestBody.generationConfig.maxOutputTokens).toBe(10_000);
    expect(requestBody.contents[0].parts[1]).toHaveProperty("inlineData.mimeType", "audio/wav");
    expect(settings).toHaveBeenCalledExactlyOnceWith(owner.userId);
  });

  it("returns a four-part textual music report that keeps the existing Suno field", async () => {
    const { post, send } = fixture(provider(music));
    expect(await result(post(request("music")))).toMatchObject({ ...metadata, kind: "music", report: music });
    expect(send).toHaveBeenCalledOnce();
    const versionOne = fixture(provider(coreMusic));
    const reply = await versionOne.post(request("music", "1"));
    expect(reply.status).toBe(200);
    expect(adminAudioResponseSchema.parse(await reply.json())).toEqual({
      schemaVersion: 1, requestedMode: "music", kind: "music", status: "ready", provider: "gemini", report: coreMusic,
    });
    expect(runMedia).toHaveBeenCalledTimes(2);
  });

  it("preserves v2 music model metadata on opted-in upload readback", async () => {
    const modelVersion = "gemini-detailed-resolved";
    const modelReply = () => new Response(pack(music, modelVersion));
    const { post } = fixture(modelReply(), modelReply());
    const report = await result(post(request("music", "2", { [MUSIC_MODEL_VERSION_HEADER]: "1" })));
    expect(report).toMatchObject({ kind: "music", modelVersion });
    expect(await result(post(request("music")))).not.toHaveProperty("modelVersion");

    const row: AudioUploadRow = {
      id: owner.userId, filename: "fixture.wav", status: "completed", request_hash: "fixture",
      size_bytes: 12, received_bytes: 12, expires_at: new Date("2026-11-25T00:00:00Z"), credential_version: 1,
      analysis_id: null, analysis_hash: null, report, code: null, provider_file: null, cleanup: "done",
    };
    expect(audioUploadDto(row, false, true).report).toMatchObject({ modelVersion });
    expect(audioUploadDto(row).report).not.toHaveProperty("modelVersion");
    expect(row.report).toMatchObject({ modelVersion });
  });

  it("opts into bounded music findings and keeps ready when individual optional values are invalid", async () => {
    const ready = { ...music, stems: { vocals: "Light voice", bass: "Sustained tone", drums: "Soft percussion", others: "Piano" },
      qualityEstimates: { suspectedUpscale: false, compression: "Unclear ringing", editTraces: "Quiet join", basis: "Audible transient" } };
    const additionalFindings = {
      style: { vocalStyle: "a".repeat(481), instrumentalTechniques: "Light touch", soundTexture: "Close piano", arrangementDetails: "Sparse opening" },
      composition: { notation: { format: "abc", text: "K:C\nC D E" }, beatGrid: "Fairly even beats" },
      suspectedSource: { description: "A description without evidence" },
    };
    const { post, send } = fixture(provider({ ...ready, additionalFindings }), provider(ready), provider({ ...ready,
      additionalFindings: { style: { soundTexture: key } } }));
    expect(await result(post(request("music", "2", expanded)))).toMatchObject({ status: "ready", report: { ...ready,
      additionalFindings: { style: { instrumentalTechniques: "Light touch", soundTexture: "Close piano", arrangementDetails: "Sparse opening" },
        composition: additionalFindings.composition } } });
    const absent = await result(post(request("music", "2", expanded)));
    const secret = await result(post(request("music", "2", expanded)));
    for (const value of [absent, secret]) {
      expect(value).toMatchObject({ status: "ready", report: ready });
      expect(JSON.stringify(value)).not.toContain("additionalFindings");
    }
    const configuration = JSON.parse(String(send.mock.calls[0][1]?.body)).generationConfig;
    expect(configuration.maxOutputTokens).toBe(10_000);
    expect(configuration.responseJsonSchema.properties).toHaveProperty("additionalFindings");
  });

  it("preserves 80 sampled speech segments with expanded insights and keeps the base provider schema unchanged", async () => {
    const segments = Array.from({ length: detailedAudioSegmentLimit }, (_, index) =>
      ({ speaker: null, text: "Segment " + index, startSec: index / 100, endSec: null }));
    const core = { ...speech, segments };
    const additionalFindings = { overallInsights: "Budget priorities were discussed.", speakerTransitionTone: "Calm question and answer." };
    const { post, send } = fixture(provider(core), provider({ ...core, additionalFindings }));
    const base = await result(post(request("speech")));
    const extended = await result(post(request("speech", "2", expanded)));
    expect(extended).toMatchObject({ status: "partial", report: { additionalFindings,
      transcription: { status: "sampled", reason: "segment_limit", segments } } });
    expect(JSON.stringify(base)).not.toContain("additionalFindings");
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).generationConfig.responseJsonSchema.properties)
      .not.toHaveProperty("additionalFindings");
  });

  it("requires v2 and a recognized profile before resolving settings or sending a request", async () => {
    const { post, send, settings } = fixture();
    for (const [version, profile] of [["1", "expanded"], [null, "expanded"], ["2", "other"]] as const) {
      const response = await post(request("music", version, { [ADMIN_AUDIO_REPORT_PROFILE_HEADER]: profile }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_report_profile" });
    }
    expect(settings).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps unavailable auto detection to one model call", async () => {
    const { post, send } = fixture(provider({ kind: "undetermined" }));
    expect(await result(post(request("auto")))).toEqual({
      schemaVersion: 2, requestedMode: "auto", kind: "undetermined", status: "unavailable", reason: "undetermined",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("returns sampled time boundaries and a segment-limit reason without claiming complete transcription", async () => {
    const segments = Array.from({ length: detailedAudioSegmentLimit },
      (_, index) => ({ speaker: null, text: "Segment " + index, startSec: index / 100, endSec: null }));
    const { post } = fixture(provider({ ...speech, segments }), provider({ ...speech, segments: null }));
    expect(await result(post(request("speech")))).toMatchObject({ status: "partial", report: {
      transcription: { status: "sampled", reason: "segment_limit", range: { fromSec: 0, throughSec: 0.79 }, segments },
    } });
    expect(await result(post(request("speech")))).toMatchObject({ status: "partial", report: {
      transcription: { status: "unavailable", reason: "no_reported_segments" },
    } });
  });

  it("validates physical provider size, lyrics consistency, server-owned evidence and key redaction", async () => {
    const body = pack(music);
    const limit = detailedAudioResponseLimit;
    const exact = body.padEnd(limit, " ");
    const { post, send } = fixture(new Response(exact), new Response(exact + " "),
      provider({ ...music, lyrics: { status: "undetermined", text: "fabricated" } }),
      provider({ ...music, measurement }), provider({ ...music, sunoPrompt: key }));
    expect(await result(post(request("music")))).toMatchObject({ ...metadata, report: music });
    for (let index = 0; index < 4; index++) {
      expect(await result(post(request("music")))).toMatchObject({ status: "unavailable", reason: "invalid_response" });
    }
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("fails before provider dispatch for invalid version, auth scope, consent and corrupt input", async () => {
    const { post, send, settings } = fixture();
    expect((await post(request("music", "3"))).status).toBe(400);
    expect((await post(request("music", "2", { [MUSIC_EXTERNAL_CONSENT_HEADER]: "false" }))).status).toBe(400);
    expect((await post(request("music", "2", { origin: "https://foreign.example.invalid" }))).status).toBe(403);
    expect(settings).not.toHaveBeenCalled();
    expect((await post(request("speech", "2", {}, "not audio"))).status).toBe(422);
    vi.mocked(runMedia).mockRejectedValueOnce(new Error("Probe could not decode source"));
    expect((await post(request("speech"))).status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks missing runtime measurement unavailable and still distinguishes model findings", async () => {
    vi.mocked(runMedia).mockRejectedValueOnce(Object.assign(new Error("Missing FFprobe"), { code: "ENOENT" }));
    const { post } = fixture(provider(music));
    expect(await result(post(request("music")))).toMatchObject({ evidence: "model_estimate",
      measurement: { source: "unavailable", reason: "probe_unavailable" }, report: music });
  });

  it("uses an explicit numeric v2 upload selector while keeping a v1 input shape unchanged", () => {
    const v1 = { action: "analyze", mode: "music", authorized: true, credentialVersion: 4,
      requestId: "10000000-0000-4000-8000-000000000011" };
    expect(audioUploadCommand.parse(v1)).toEqual(v1);
    expect(audioUploadCommand.parse({ ...v1, reportVersion: 2 })).toEqual({ ...v1, reportVersion: 2 });
    expect(audioUploadCommand.safeParse({ ...v1, reportVersion: "2" }).success).toBe(false);
  });
});
