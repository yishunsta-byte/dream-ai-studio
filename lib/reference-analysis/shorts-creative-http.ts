import "server-only";

import { addAbortListener } from "node:events";
import type { z } from "zod";
import { openRuntimeGeminiCredentialStore } from "./analysis-credential-store";
import type { GeminiSettings } from "./analysis-gemini-settings";
import type { ShortsGeminiResult } from "./shorts-gemini-json";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { createYouTubeAdminAccess, youtubeHttpDefaults, youtubeJson } from "./youtube-credential-http";

const defaults = { authenticate: youtubeHttpDefaults.authenticate, env: youtubeHttpDefaults.env,
  store: openRuntimeGeminiCredentialStore, send: globalThis.fetch };
const cancelled = () => youtubeJson({ code: "request_cancelled" }, 499);
const timedOut = () => youtubeJson({ code: "timed_out" }, 504);
const stale = () => youtubeJson({ code: "stale" }, 409);

export type ShortsCreativeOverrides = Partial<typeof defaults>;
type CreativeRequest = { authorized: true; geminiCredentialVersion: number };
type CreativePost<RequestData extends CreativeRequest, Output> = {
  schema: z.ZodType<RequestData>;
  progressCode: "script_in_progress" | "scene_prompt_in_progress" | "bgm_prompt_in_progress";
  generate: (options: { input: Omit<RequestData, keyof CreativeRequest>; settings: GeminiSettings;
    signal: AbortSignal; send: typeof fetch }) => Promise<ShortsGeminiResult<Output>>;
  format: (input: RequestData, generated: Output) => object;
  /**
   * 큰 본문 허용(배정 P1-08-SHORTS-SERVER-PARITY v2). 기본은 공용 관리자 JSON과 같은 8 KiB다.
   * 지정하면 limit까지 읽되, 검증을 통과한 요청이 allows를 만족할 때만 8 KiB를 넘을 수 있다
   * (대본 수정 요청·전체 장면 묶음만 160 KiB, 첫 대본·장면 단건은 그대로 8 KiB).
   */
  largeBody?: { limit: number; allows: (input: RequestData) => boolean };
};

export const shortsCreativeBodyByteLimit = 8192;
/** 생성 요청 하나(Gemini 호출 전부 포함)의 시간 상한. 대본의 나레이션 압축 2차 호출도 이 안에서 남은 시간만 쓴다. */
export const shortsCreativeTimeoutMs = 28_000;

export function createShortsCreativePost<RequestData extends CreativeRequest, Output>(
  { schema, progressCode, generate, format, largeBody }: CreativePost<RequestData, Output>, overrides: ShortsCreativeOverrides,
) {
  const deps = { ...defaults, ...overrides };
  const access = createYouTubeAdminAccess(deps);
  const inFlight = new Set<string>();
  const tooLarge = () => youtubeJson({ code: "too_large" }, 413);
  // 공용 withJson과 같은 순서(관리자 인증 → 외부 출처 거절 → 상한 읽기 → JSON)이며 상한만 경로별로 정한다.
  const withJson = (request: Request, handle: (owner: string, input: unknown, bytes: number) => Promise<Response>) =>
    access.withAdmin(async owner => {
      const blocked = rejectForeignWrite(request, deps.env);
      if (blocked) return blocked;
      const raw = await readLimitedText(request, largeBody?.limit ?? shortsCreativeBodyByteLimit);
      if (raw === "too-large") return tooLarge();
      let input: unknown;
      try { input = JSON.parse(raw); } catch { return youtubeJson({ code: "invalid_input" }, 400); }
      // 선언 길이도 본다: 공용 8 KiB 경로처럼 content-length가 상한을 넘으면 실제 본문이 작아도 큰 본문으로 취급한다.
      const declared = Number(request.headers.get("content-length") ?? 0);
      return handle(owner, input, Math.max(Buffer.byteLength(raw, "utf8"), declared));
    });
  return (request: Request) => withJson(request, async (owner, input, bytes) => {
    const checked = schema.safeParse(input);
    if (!checked.success) return youtubeJson({ code: "invalid_input" }, 400);
    if (bytes > shortsCreativeBodyByteLimit && !largeBody?.allows(checked.data)) return tooLarge();
    const { authorized, geminiCredentialVersion, ...modelInput } = checked.data;
    if (!authorized) return youtubeJson({ code: "invalid_input" }, 400);
    if (request.signal.aborted) return cancelled();
    if (inFlight.has(owner)) return youtubeJson({ code: progressCode }, 429);
    const store = deps.store();
    if (!store) return youtubeJson({ code: "storage_unavailable" }, 503);

    inFlight.add(owner);
    try {
      const saved = await store.open(owner, "reference");
      if (request.signal.aborted) return cancelled();
      const model = saved?.models.shorts;
      if (!saved || !model) return youtubeJson({ code: "not_configured" }, 503);
      if (saved.version !== geminiCredentialVersion) return stale();

      if (JSON.stringify(modelInput).includes(saved.apiKey)) return youtubeJson({ code: "invalid_input" }, 400);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(shortsCreativeTimeoutMs)]);
      const stopped = Promise.withResolvers<never>();
      const listener = addAbortListener(signal, () => stopped.reject(signal.reason));
      try {
        const run = async () => {
          const result = await generate({ input: modelInput, settings: { key: saved.apiKey, model }, signal, send: deps.send });
          signal.throwIfAborted();
          if ("code" in result) return youtubeJson({ code: result.code }, result.code === "timed_out" ? 504 : 502);

          const current = (await store.metadata(owner)).some(group => group.group === "reference" && group.version === geminiCredentialVersion);
          signal.throwIfAborted();
          if (!current) return stale();
          return youtubeJson(format(checked.data, result.generated));
        };
        return await Promise.race([stopped.promise, run()]);
      } catch (error) {
        if (request.signal.aborted) return cancelled();
        if (signal.aborted) return timedOut();
        throw error;
      } finally { listener[Symbol.dispose](); }
    } finally { inFlight.delete(owner); }
  });
}
