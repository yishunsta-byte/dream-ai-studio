import "server-only";
import type { z } from "zod";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import {
  hasShortsVaultSecret, shortsVaultId, shortsVaultProjectBodyLimit, shortsVaultProjectCreate, shortsVaultProjectReplace,
  shortsVaultPromptSearch, shortsVaultPromptSetBodyLimit, shortsVaultPromptSetCreate, shortsVaultSearchBodyLimit,
} from "./shorts-vault-contract";
import { openShortsVaultStore, type ShortsVaultOutcome, type ShortsVaultStore } from "./shorts-vault-store";
import { createYouTubeAdminAccess, youtubeHttpDefaults, youtubeJson } from "./youtube-credential-http";

const defaults = { authenticate: youtubeHttpDefaults.authenticate, env: youtubeHttpDefaults.env,
  store: (): ShortsVaultStore | null => openShortsVaultStore() };
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

  const withStore = (handle: (owner: string, store: ShortsVaultStore) => Promise<Response>) =>
    access.withAdmin(async owner => {
      const store = deps.store();
      if (!store) return problem("storage_unavailable", 503);
      try { return await handle(owner, store); } catch { return problem("storage_unavailable", 503); }
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
    listPromptSets: () => withStore(async (owner, store) => youtubeJson({ promptSets: await store.listPromptSets(owner) })),

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

    listProjects: () => withStore(async (owner, store) => youtubeJson({ projects: await store.listProjects(owner) })),

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
