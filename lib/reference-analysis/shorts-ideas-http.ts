import "server-only";

import { openRuntimeGeminiCredentialStore } from "./analysis-credential-store";
import { shortsIdeasRequest } from "./shorts-ideas-contract";
import { generateShortsIdeas } from "./shorts-ideas";
import { createYouTubeAdminAccess, youtubeHttpDefaults, youtubeJson } from "./youtube-credential-http";

const defaults = { authenticate: youtubeHttpDefaults.authenticate, env: youtubeHttpDefaults.env,
  store: openRuntimeGeminiCredentialStore, send: globalThis.fetch };

export function createShortsIdeasPost(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createYouTubeAdminAccess(deps);
  const inFlight = new Set<string>();
  return (request: Request) => access.withJson(request, async (owner, input) => {
    const checked = shortsIdeasRequest.safeParse(input);
    if (!checked.success) return youtubeJson({ code: "invalid_input" }, 400);
    if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
    if (inFlight.has(owner)) return youtubeJson({ code: "ideas_in_progress" }, 429);
    const store = deps.store();
    if (!store) return youtubeJson({ code: "storage_unavailable" }, 503);

    inFlight.add(owner);
    try {
      const { keyword, context, geminiCredentialVersion } = checked.data;
      const saved = await store.open(owner, "reference");
      const model = saved?.models.shorts;
      if (!saved || !model) return youtubeJson({ code: "not_configured" }, 503);
      if (saved.version !== geminiCredentialVersion) return youtubeJson({ code: "stale" }, 409);

      const source = { keyword, context };
      if (JSON.stringify(source).includes(saved.apiKey)) return youtubeJson({ code: "invalid_input" }, 400);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(28_000)]);
      const result = await generateShortsIdeas({ source, settings: { key: saved.apiKey, model }, signal, send: deps.send });
      if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
      if ("code" in result) return youtubeJson({ code: result.code }, result.code === "timed_out" ? 504 : 502);
      const current = (await store.metadata(owner)).some(group => group.group === "reference" && group.version === geminiCredentialVersion);
      if (request.signal.aborted) return youtubeJson({ code: "request_cancelled" }, 499);
      if (signal.aborted) return youtubeJson({ code: "timed_out" }, 504);
      if (!current) return youtubeJson({ code: "stale" }, 409);

      return youtubeJson({
        schemaVersion: 1, geminiCredentialVersion,
        source: { evidence: context.evidence, videoId: context.videoId, provenance: "client_supplied" },
        generation: { kind: "creative_suggestions", ideas: result.generated.ideas.map(idea => ({
          ...idea, assessment: idea.assessment && { ...idea.assessment, kind: "model_estimate" },
        })) },
      });
    } finally { inFlight.delete(owner); }
  });
}
