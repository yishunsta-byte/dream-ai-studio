import "server-only";

import { z } from "zod";
import { resolveServerAuth } from "../auth/resolve";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { openReferencePublicationStore, publishReferenceAnalysisSchema, revokeReferenceAnalysisSchema } from "./admin-reference-publications";
import { imageSemanticConfigured, type AnalyzeImageSemantics } from "./image-semantic-gemini";
import { referenceMedia } from "./input";
import type { analyzeLocalMediaUpload, analyzeLocalMediaUrl } from "./local-media-url";
import { AnalysisStageError, MediaUrlError, errorKind } from "./media-url-error";
import { studioAnalysisResultSchema } from "./studio-analysis-result-dto";

const inputSchema = z.strictObject({
  url: z.string().trim().min(1).max(4096), authorized: z.literal(true), media: referenceMedia.optional(),
  semantic: z.literal("image").optional(),
});
const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

async function payload(request: Request) {
  const text = await readLimitedText(request, 16_384);
  if (text === "too-large") return { error: json({ error: "too_large" }, 413) };
  try { return { value: JSON.parse(text) as unknown }; }
  catch { return { error: json({ error: "invalid_input" }, 400) }; }
}

const defaults = {
  authenticate: resolveServerAuth,
  analyze: undefined as typeof analyzeLocalMediaUrl | undefined,
  analyzeUpload: undefined as typeof analyzeLocalMediaUpload | undefined,
  analyzeImageSemantics: undefined as AnalyzeImageSemantics | undefined,
  loadImageSemantics: undefined as ((ownerId: string) => Promise<AnalyzeImageSemantics | undefined>) | undefined,
  openStore: openReferencePublicationStore,
  env: process.env as Readonly<Record<string, string | undefined>>,
};

export function createAdminReferenceHttp(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  let analyzing = false;
  const imageSemantics = (owner: string) => deps.loadImageSemantics ? deps.loadImageSemantics(owner) : deps.analyzeImageSemantics;

  async function withAdmin(request: Request, handle: (ownerId: string) => Promise<Response>, allowedTypes?: readonly string[]) {
    try {
      const auth = await deps.authenticate();
      if (auth.kind === "local") return json({ error: "authentication_required" }, 401);
      if (auth.kind === "denied") return json({ error: auth.code }, auth.status);
      if (request.method !== "GET") {
        const rejected = rejectForeignWrite(request, deps.env, allowedTypes);
        if (rejected) return rejected;
      }
      return await handle(auth.userId);
    } catch { return json({ error: "unavailable" }, 503); }
  }

  async function analyze(request: Request) {
    return withAdmin(request, async owner => {
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      let wantsSemantics: boolean;
      let run: (analyzer?: AnalyzeImageSemantics) => Promise<Awaited<ReturnType<typeof analyzeLocalMediaUpload>>>;
      if (contentType === "application/octet-stream") {
        const media = referenceMedia.safeParse(request.headers.get("x-dream-media"));
        if (!media.success) return json({ error: "invalid_input" }, 400);
        const semantic = request.headers.get("x-dream-semantic");
        if (semantic !== null && (semantic !== "image" || media.data !== "image")) return json({ error: "invalid_input" }, 400);
        wantsSemantics = semantic === "image";
        const encodedName = request.headers.get("x-dream-filename");
        if (!encodedName || encodedName.length > 255 * 9) return json({ error: "invalid_file" }, 400);
        let name: string;
        try { name = decodeURIComponent(encodedName); }
        catch { return json({ error: "invalid_file" }, 400); }
        const analyzeUpload = deps.analyzeUpload;
        if (!analyzeUpload) return json({ error: "unavailable" }, 503);
        run = analyzer => analyzer ? analyzeUpload(request, name, media.data, analyzer) : analyzeUpload(request, name, media.data);
      } else {
        const input = await payload(request);
        if (input.error) return input.error;
        const parsed = inputSchema.safeParse(input.value);
        if (!parsed.success) {
          const authorized = (input.value as { authorized?: unknown } | null)?.authorized;
          const invalidOption = parsed.error.issues.some(issue => issue.path[0] === "media" || issue.path[0] === "semantic");
          const error = authorized !== true ? "rights_required" : invalidOption ? "invalid_input" : "invalid_url";
          return json({ error }, 400);
        }
        const { url, media, semantic } = parsed.data;
        wantsSemantics = semantic === "image";
        if (wantsSemantics && media !== "image") return json({ error: "invalid_input" }, 400);
        const analyzeUrl = deps.analyze;
        if (!analyzeUrl) return json({ error: "unavailable" }, 503);
        // The transport signal can end after Next reads the request body.
        run = analyzer => {
          if (analyzer) return analyzeUrl(url, undefined, undefined, media, analyzer);
          return media ? analyzeUrl(url, undefined, undefined, media) : analyzeUrl(url, undefined, undefined);
        };
      }
      if (analyzing) return json({ error: "analysis_busy" }, 429);
      analyzing = true;
      try {
        let analyzer: AnalyzeImageSemantics | undefined;
        try { analyzer = wantsSemantics ? await imageSemantics(owner) : undefined; }
        catch { return json({ error: "unavailable" }, 503); }
        const { schemaVersion, status, media, proposals, semantic } = await run(analyzer);
        const result = studioAnalysisResultSchema.parse({ schemaVersion, status, media, proposals });
        const ready = json({ result, ...(wantsSemantics && {
          semantic: semantic ?? { status: "unavailable", reason: "not_configured" },
        }) });
        // 진단 헤더: 분석이 끝난 시점에 요청 신호가 이미 끝나 있었는지(원인 실측용, 값은 aborted|live만).
        ready.headers.set("x-dream-request-signal", request.signal.aborted ? "aborted" : "live");
        return ready;
      } catch (error) {
        if (error instanceof MediaUrlError) return json({ error: error.code }, error.status ?? 422);
        // 진단: 단계·오류 이름과 그 순간 요청 신호 상태만 남긴다(URL·경로·서버 메시지 없음).
        const stage = error instanceof AnalysisStageError ? error.stage : "result";
        const detail = error instanceof AnalysisStageError ? error.detail : errorKind(error);
        const requestAborted = request.signal.aborted;
        console.error("[admin-reference-analysis] analysis_failed", JSON.stringify({ stage, detail, requestAborted }));
        const failed = json({ error: "analysis_failed", stage, detail, requestAborted }, 422);
        failed.headers.set("x-dream-request-signal", requestAborted ? "aborted" : "live");
        return failed;
      } finally { analyzing = false; }
    }, ["application/json", "application/octet-stream"]);
  }

  async function capabilities(request: Request) {
    return withAdmin(request, async owner => {
      const configured = deps.loadImageSemantics ? await imageSemantics(owner) :
        deps.analyzeImageSemantics && imageSemanticConfigured(deps.env);
      return json({ semantic: { image: configured ? "configured" : "not_configured" } });
    });
  }

  async function publications(request: Request) {
    return withAdmin(request, async (ownerId) => {
      const store = await deps.openStore(ownerId);
      if (!store) return json({ error: "unavailable" }, 503);
      if (request.method === "GET") return json({ items: await store.list() });

      const input = await payload(request);
      if (input.error) return input.error;
      if (request.method === "POST") {
        const parsed = publishReferenceAnalysisSchema.safeParse(input.value);
        if (!parsed.success) return json({ error: "invalid_publication" }, 400);
        const item = await store.publish(parsed.data);
        return item ? json({ item }) : json({ error: "publication_conflict" }, 409);
      }
      const parsed = revokeReferenceAnalysisSchema.safeParse(input.value);
      if (!parsed.success) return json({ error: "invalid_publication" }, 400);
      return await store.revoke(parsed.data.id) ? json({ ok: true }) : json({ error: "not_found" }, 404);
    });
  }

  return { analyze, capabilities, publications };
}
