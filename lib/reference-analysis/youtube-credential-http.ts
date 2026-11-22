import "server-only";

import { z } from "zod";
import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth } from "../auth/resolve";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { openRuntimeYouTubeCredentialStore } from "./analysis-credential-store";
import { youtubeCredentialWrite } from "./youtube-credential-contract";
import { createYouTubeDataCaller, YouTubeDataError } from "./youtube-data";

export const youtubeJson = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
});

export const youtubeHttpDefaults = {
  authenticate: resolveServerAuth,
  store: openRuntimeYouTubeCredentialStore,
  send: (...args: Parameters<typeof fetch>) => fetch(...args),
  env: process.env as Readonly<Record<string, string | undefined>>,
};

export function createYouTubeAdminAccess({ authenticate, env }: Pick<typeof youtubeHttpDefaults, "authenticate" | "env">) {
  async function withAdmin(handle: (owner: string) => Promise<Response>) {
    try {
      const auth = await authenticate();
      if (auth.kind === "local") return authDeniedResponse({ kind: "denied", code: "AUTH_REQUIRED", status: 401 });
      if (auth.kind === "denied") return authDeniedResponse(auth);
      return await handle(auth.userId);
    } catch { return youtubeJson({ code: "storage_unavailable" }, 503); }
  }

  const withJson = (request: Request, handle: (owner: string, input: unknown) => Promise<Response>) =>
    withAdmin(async owner => {
      const blocked = rejectForeignWrite(request, env);
      if (blocked) return blocked;
      const raw = await readLimitedText(request, 8192);
      if (raw === "too-large") return youtubeJson({ code: "too_large" }, 413);
      let input: unknown;
      try { input = JSON.parse(raw); } catch { return youtubeJson({ code: "invalid_input" }, 400); }
      return handle(owner, input);
    });

  return { withAdmin, withJson };
}

export function createYouTubeCredentialHttp(overrides: Partial<typeof youtubeHttpDefaults> = {}) {
  const deps = { ...youtubeHttpDefaults, ...overrides };
  const access = createYouTubeAdminAccess(deps);
  return {
    get: () => access.withAdmin(async owner => {
      const store = deps.store();
      if (!store) return youtubeJson({ code: "storage_unavailable" }, 503);
      const saved = await store.metadata(owner);
      return youtubeJson(saved ? { configured: true, ...saved } : { configured: false, version: 0, updatedAt: null });
    }),
    put: (request: Request) => access.withJson(request, async (owner, input) => {
      const checked = youtubeCredentialWrite.safeParse(input);
      if (!checked.success) return youtubeJson({ code: "invalid_input" }, 400);
      const store = deps.store();
      if (!store) return youtubeJson({ code: "storage_unavailable" }, 503);
      const { apiKey, expectedVersion } = checked.data;
      if (((await store.metadata(owner))?.version ?? 0) !== expectedVersion) return youtubeJson({ code: "stale" }, 409);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(6_000)]);
      const call = createYouTubeDataCaller({ key: apiKey, signal, stillCurrent: async () => true, send: deps.send });
      try {
        await call("videoCategories", { part: "snippet", regionCode: "KR" },
          z.object({ kind: z.literal("youtube#videoCategoryListResponse") }));
      } catch (error) {
        const issue = error instanceof YouTubeDataError ? error.code : "provider_error";
        if (issue === "invalid_key") return youtubeJson({ code: issue }, 422);
        if (issue === "quota_exceeded") return youtubeJson({ code: issue }, 429);
        if (issue === "timed_out") return youtubeJson({ code: issue }, 504);
        return youtubeJson({ code: "provider_error" }, 502);
      }
      if (signal.aborted) return youtubeJson({ code: "timed_out" }, 504);
      const saved = await store.write(owner, apiKey, expectedVersion);
      return saved ? youtubeJson({ configured: true, ...saved }) : youtubeJson({ code: "stale" }, 409);
    }),
  };
}
