import "server-only";
import type { z } from "zod";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import {
  hasShortsVaultSecret, shortsVaultId, shortsVaultProjectBodyLimit, shortsVaultProjectCreate, shortsVaultProjectReplace,
  shortsVaultPromptSearch, shortsVaultPromptSetBodyLimit, shortsVaultPromptSetCreate, shortsVaultSearchBodyLimit,
} from "./shorts-vault-contract";
import {
  classifyShortsVaultFailure, inspectShortsVaultConfig, openShortsVaultStore, type ShortsVaultOutcome, type ShortsVaultStore,
} from "./shorts-vault-store";
import { createYouTubeAdminAccess, youtubeHttpDefaults, youtubeJson } from "./youtube-credential-http";

/**
 * P1-08-SHORTS-VAULT-STORAGE-DIAGNOSTICS: 503 원인을 서버 기록에만 고정 이름으로 남긴다.
 * 관측 지점인 목록 조회(listProjects·listPromptSets)에서만 남기고, 검색·열기·쓰기·삭제는 예전처럼 기록하지 않는다.
 * 기록 항목은 stage·reason(·설정 단계의 ca 상태)뿐이고 URL·비밀번호·사용자 ID·호스트·CA·오류 메시지·스택·본문은 넣지 않는다.
 * 외부 응답은 그대로 503 {code:"storage_unavailable"}이다.
 */
export type ShortsVaultDiagnostic = { stage: string; reason: string; ca?: "absent" | "parsed" | "unparseable" };
const defaults = { authenticate: youtubeHttpDefaults.authenticate, env: youtubeHttpDefaults.env,
  store: (): ShortsVaultStore | null => openShortsVaultStore(),
  inspect: () => inspectShortsVaultConfig(),
  report: (entry: ShortsVaultDiagnostic) => { console.warn("shorts_vault_storage_unavailable", entry); } };
export type ShortsVaultOverrides = Partial<typeof defaults>;
type Route = { params: Promise<{ id: string }> };
const problem = (code: string, status: number) => youtubeJson({ code }, status);
const reply = ({ status, body }: ShortsVaultOutcome) => youtubeJson(body, status);

/**
 * 관리자 쇼츠 보관함. 모든 메서드는 관리자 로그인 확인이 먼저다(본문·경로 값은 그 뒤에 읽는다).
 * 쓰기는 같은 출처만, 본문 상한(프롬프트 256 KiB, 프로젝트 512 KiB) 안에서 strict 스키마와 비밀 모양 검사를 통과해야 저장한다.
 */
export function createShortsVaultHttp(overrides: ShortsVaultOverrides = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createYouTubeAdminAccess(deps);
  // 진단 기록이 실패해도 응답 계약은 그대로 둔다.
  const diagnose = (entry: ShortsVaultDiagnostic) => { try { deps.report(entry); } catch { /* ignore */ } };

  const withStore = (handle: (owner: string, store: ShortsVaultStore) => Promise<Response>, diagnostic = false) =>
    access.withAdmin(async owner => {
      const store = deps.store();
      if (!store) {
        if (diagnostic) {
          const { issue, ca } = deps.inspect();
          diagnose({ stage: "config", reason: issue ?? "store_unavailable", ca });
        }
        return problem("storage_unavailable", 503);
      }
      try { return await handle(owner, store); } catch (error) {
        if (diagnostic) {
          const failure = classifyShortsVaultFailure(error);
          diagnose(failure.stage === "tls" ? { ...failure, ca: deps.inspect().ca } : failure);
        }
        return problem("storage_unavailable", 503);
      }
    });

  const withId = async (route: Route) => {
    const parsed = shortsVaultId.safeParse((await route.params).id);
    return parsed.success ? parsed.data.toLowerCase() : null;
  };

  async function body<S extends z.ZodType>(request: Request, schema: S, limit: number):
    Promise<{ response: Response } | { value: z.output<S> }> {
    const blocked = rejectForeignWrite(request, deps.env);
    if (blocked) return { response: blocked };
    const raw = await readLimitedText(request, limit);
    if (raw === "too-large") return { response: problem("too_large", 413) };
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return { response: problem("invalid_input", 400) }; }
    const checked = schema.safeParse(input);
    if (!checked.success) return { response: problem("invalid_input", 400) };
    if (hasShortsVaultSecret(checked.data)) return { response: problem("secret_rejected", 400) };
    return { value: checked.data as z.output<S> };
  }

  return {
    listPromptSets: () => withStore(async (owner, store) => youtubeJson({ promptSets: await store.listPromptSets(owner) }), true),

    createPromptSet: (request: Request) => withStore(async (owner, store) => {
      const input = await body(request, shortsVaultPromptSetCreate, shortsVaultPromptSetBodyLimit);
      if ("response" in input) return input.response;
      return reply(await store.createPromptSet(owner, input.value.requestId, input.value.document));
    }),

    /** 내용 검색: 관리자 확인 → 같은 출처 → 2 KiB 안의 strict {query}. 검색어는 기록하지 않고 요약 목록만 돌려준다. */
    searchPromptSets: (request: Request) => withStore(async (owner, store) => {
      const input = await body(request, shortsVaultPromptSearch, shortsVaultSearchBodyLimit);
      if ("response" in input) return input.response;
      return youtubeJson({ promptSets: await store.searchPromptSets(owner, input.value.query) });
    }),

    getPromptSet: (route: Route) => withStore(async (owner, store) => {
      const id = await withId(route);
      if (!id) return problem("not_found", 404);
      const promptSet = await store.getPromptSet(owner, id);
      return promptSet ? youtubeJson({ promptSet }) : problem("not_found", 404);
    }),

    deletePromptSet: (request: Request, route: Route) => withStore(async (owner, store) => {
      const blocked = rejectForeignWrite(request, deps.env);
      if (blocked) return blocked;
      const id = await withId(route);
      if (!id) return problem("not_found", 404);
      return await store.deletePromptSet(owner, id) ? new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } })
        : problem("not_found", 404);
    }),

    listProjects: () => withStore(async (owner, store) => youtubeJson({ projects: await store.listProjects(owner) }), true),

    createProject: (request: Request) => withStore(async (owner, store) => {
      const input = await body(request, shortsVaultProjectCreate, shortsVaultProjectBodyLimit);
      if ("response" in input) return input.response;
      return reply(await store.createProject(owner, input.value.requestId, input.value.document));
    }),

    getProject: (route: Route) => withStore(async (owner, store) => {
      const id = await withId(route);
      if (!id) return problem("not_found", 404);
      const project = await store.getProject(owner, id);
      return project ? youtubeJson({ project }) : problem("not_found", 404);
    }),

    replaceProject: (request: Request, route: Route) => withStore(async (owner, store) => {
      const input = await body(request, shortsVaultProjectReplace, shortsVaultProjectBodyLimit);
      if ("response" in input) return input.response;
      const id = await withId(route);
      if (!id) return problem("not_found", 404);
      return reply(await store.replaceProject(owner, id, input.value.expectedRevision, input.value.document));
    }),

    deleteProject: (request: Request, route: Route) => withStore(async (owner, store) => {
      const blocked = rejectForeignWrite(request, deps.env);
      if (blocked) return blocked;
      const id = await withId(route);
      if (!id) return problem("not_found", 404);
      return await store.deleteProject(owner, id) ? new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } })
        : problem("not_found", 404);
    }),
  };
}

export const shortsVaultHttp = createShortsVaultHttp();
