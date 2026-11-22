import "server-only";

import { createYouTubeAdminAccess, youtubeHttpDefaults, youtubeJson } from "./youtube-credential-http";
import { youtubeShortsSearchRequest } from "./youtube-shorts-search-contract";
import { searchYouTubeShorts } from "./youtube-shorts-search";
import { YouTubeDataError } from "./youtube-data";

const failureStatus = { quota_exceeded: 429, invalid_key: 422, provider_error: 502, timed_out: 504, stale: 409, comments_unavailable: 502 } as const;
const defaults = { ...youtubeHttpDefaults, send: globalThis.fetch };

export function createYouTubeShortsSearchPost(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createYouTubeAdminAccess(deps);
  const inFlight = new Set<string>();
  return (request: Request) => access.withJson(request, async (owner, input) => {
    const parsed = youtubeShortsSearchRequest.safeParse(input);
    if (!parsed.success) return youtubeJson({ code: "invalid_input" }, 400);
    if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
    const store = deps.store();
    if (!store) return youtubeJson({ code: "storage_unavailable" }, 503);
    if (inFlight.has(owner)) return youtubeJson({ code: "search_in_progress" }, 429);
    inFlight.add(owner);
    try {
      const credentials = await store.open(owner);
      if (!credentials) return youtubeJson({ code: "not_configured" }, 503);
      if (credentials.version !== parsed.data.credentialVersion) return youtubeJson({ code: "stale" }, 409);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
      const stillCurrent = async () => (await store.metadata(owner))?.version === credentials.version;
      const items = await searchYouTubeShorts({ request: parsed.data, key: credentials.apiKey, signal, stillCurrent, send: deps.send });
      const current = await stillCurrent();
      if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
      if (signal.aborted) return youtubeJson({ code: "timed_out" }, 504);
      if (!current) return youtubeJson({ code: "stale" }, 409);
      return youtubeJson({ schemaVersion: 1, evidence: "youtube_metadata", credentialVersion: credentials.version, items });
    } catch (error) {
      if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
      if (error instanceof YouTubeDataError) return youtubeJson({ code: error.code }, failureStatus[error.code]);
      throw error;
    } finally { inFlight.delete(owner); }
  });
}
