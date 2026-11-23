import "server-only";

import { openRuntimeGeminiCredentialStore } from "./analysis-credential-store";
import { shortsMetadataRequest } from "./shorts-metadata-contract";
import { inferShortsMetadata, readShortsMetadata, ShortsMetadataError } from "./shorts-metadata";
import { createYouTubeAdminAccess, youtubeHttpDefaults, youtubeJson } from "./youtube-credential-http";
import { YouTubeDataError } from "./youtube-data";

const defaults = { ...youtubeHttpDefaults, geminiStore: openRuntimeGeminiCredentialStore, send: globalThis.fetch };
const errorStatus = {
  quota_exceeded: 429, invalid_key: 422, stale: 409, timed_out: 504, provider_error: 502, comments_unavailable: 502,
  video_unavailable: 404, model_error: 502, invalid_model_response: 502,
};

export function createShortsMetadataPost(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createYouTubeAdminAccess(deps);
  const inFlight = new Set<string>();
  return (request: Request) => access.withJson(request, async (owner, input) => {
    const checked = shortsMetadataRequest.safeParse(input);
    if (!checked.success) return youtubeJson({ code: "invalid_input" }, 400);
    if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
    if (inFlight.has(owner)) return youtubeJson({ code: "analysis_in_progress" }, 429);
    const youtube = deps.store(), gemini = deps.geminiStore();
    if (!youtube || !gemini) return youtubeJson({ code: "storage_unavailable" }, 503);
    inFlight.add(owner);
    try {
      const { videoId, youtubeCredentialVersion, geminiCredentialVersion } = checked.data;
      const [yt, modelSettings] = await Promise.all([youtube.open(owner), gemini.open(owner, "reference")]);
      const model = modelSettings?.models.shorts;
      if (!yt || !modelSettings || !model) return youtubeJson({ code: "not_configured" }, 503);
      if (yt.version !== youtubeCredentialVersion || modelSettings.version !== geminiCredentialVersion) {
        return youtubeJson({ code: "stale" }, 409);
      }

      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(28_000)]);
      const stillCurrent = async () => {
        const [key, groups] = await Promise.all([youtube.metadata(owner), gemini.metadata(owner)]);
        return key?.version === youtubeCredentialVersion && groups.some(group =>
          group.group === "reference" && group.version === geminiCredentialVersion);
      };
      const source = await readShortsMetadata(videoId, { key: yt.apiKey, signal, stillCurrent, send: deps.send });
      if (!await stillCurrent()) return youtubeJson({ code: "stale" }, 409);
      const inference = await inferShortsMetadata({
        source, settings: { key: modelSettings.apiKey, model }, youtubeKey: yt.apiKey, signal, send: deps.send,
      });
      const current = await stillCurrent();
      if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
      if (signal.aborted) return youtubeJson({ code: "timed_out" }, 504);
      if (!current) return youtubeJson({ code: "stale" }, 409);
      return youtubeJson({ schemaVersion: 1, evidence: "youtube_metadata", youtubeCredentialVersion, geminiCredentialVersion,
        publicData: source.facts, inference: { kind: "model_inference", ...inference } });
    } catch (error) {
      if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
      if (error instanceof YouTubeDataError || error instanceof ShortsMetadataError) {
        return youtubeJson({ code: error.code }, errorStatus[error.code]);
      }
      throw error;
    } finally { inFlight.delete(owner); }
  });
}
