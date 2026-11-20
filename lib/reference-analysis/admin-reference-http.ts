import "server-only";

import { z } from "zod";
import { resolveServerAuth } from "../auth/resolve";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { openReferencePublicationStore, publishReferenceAnalysisSchema, revokeReferenceAnalysisSchema } from "./admin-reference-publications";
import type { analyzeLocalMediaUrl } from "./local-media-url";
import { AnalysisStageError, MediaUrlError, errorKind } from "./media-url-error";
import { studioAnalysisResultSchema } from "./studio-analysis-result-dto";

const inputSchema = z.strictObject({ url: z.string().trim().min(1).max(4096), authorized: z.literal(true) });
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
  openStore: openReferencePublicationStore,
  env: process.env as Readonly<Record<string, string | undefined>>,
};

export function createAdminReferenceHttp(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  let analyzing = false;

  async function withAdmin(request: Request, handle: (ownerId: string) => Promise<Response>) {
    try {
      const auth = await deps.authenticate();
      if (auth.kind === "local") return json({ error: "authentication_required" }, 401);
      if (auth.kind === "denied") return json({ error: auth.code }, auth.status);
      if (request.method !== "GET") {
        const rejected = rejectForeignWrite(request, deps.env);
        if (rejected) return rejected;
      }
      return await handle(auth.userId);
    } catch { return json({ error: "unavailable" }, 503); }
  }

  async function analyze(request: Request) {
    return withAdmin(request, async () => {
      const input = await payload(request);
      if (input.error) return input.error;
      const parsed = inputSchema.safeParse(input.value);
      if (!parsed.success) {
        const authorized = (input.value as { authorized?: unknown } | null)?.authorized;
        return json({ error: authorized === true ? "invalid_url" : "rights_required" }, 400);
      }
      if (analyzing) return json({ error: "analysis_busy" }, 429);
      analyzing = true;
      try {
        if (!deps.analyze) return json({ error: "unavailable" }, 503);
        // 요청 취소 신호(request.signal)는 넘기지 않는다. 운영 라우트에서 본문을 읽은 뒤 일찍 끝나 정상 분석까지 끊을 수 있다.
        // 분석은 자체 30초 시한과 라우트 maxDuration으로 제한된다.
        const { schemaVersion, status, media, proposals } = await deps.analyze(parsed.data.url, undefined, undefined);
        const ready = json({ result: studioAnalysisResultSchema.parse({ schemaVersion, status, media, proposals }) });
        // 진단 헤더: 분석이 끝난 시점에 요청 신호가 이미 끝나 있었는지(원인 실측용, 값은 aborted|live만).
        ready.headers.set("x-dream-request-signal", request.signal.aborted ? "aborted" : "live");
        return ready;
      } catch (error) {
        if (error instanceof MediaUrlError) return json({ error: error.code }, 422);
        // 진단: 단계·오류 이름과 그 순간 요청 신호 상태만 남긴다(URL·경로·서버 메시지 없음).
        const stage = error instanceof AnalysisStageError ? error.stage : "result";
        const detail = error instanceof AnalysisStageError ? error.detail : errorKind(error);
        const requestAborted = request.signal.aborted;
        console.error("[admin-reference-analysis] analysis_failed", JSON.stringify({ stage, detail, requestAborted }));
        const failed = json({ error: "analysis_failed", stage, detail, requestAborted }, 422);
        failed.headers.set("x-dream-request-signal", requestAborted ? "aborted" : "live");
        return failed;
      } finally { analyzing = false; }
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

  return { analyze, publications };
}
