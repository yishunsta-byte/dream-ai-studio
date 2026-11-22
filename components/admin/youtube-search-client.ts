"use client";

import {
  youtubeShortsSearchPath, youtubeShortsSearchRequest, youtubeShortsSearchResult, type YouTubeShortCandidate, type YouTubeShortsSearchRequest,
} from "@/lib/reference-analysis/youtube-shorts-search-contract";
import { call } from "./youtube-key-client";

// P1-08 관리자 공개 쇼츠 검색의 화면 쪽 통신(Backend 3404b8f 계약: POST {query, order, credentialVersion, dateFrom?, dateTo?}).
// 요청은 계약 형식으로 다시 검사한 뒤에만 보내고, 응답은 계약 형식(최대 50개 공개 메타데이터)일 때만 쓴다.
export type { YouTubeShortCandidate, YouTubeShortsSearchRequest };
export type SearchCode = "invalid_input" | "stale" | "storage_unavailable" | "not_configured" | "invalid_key" | "search_in_progress"
  | "quota_exceeded" | "provider_error" | "timed_out" | "request_cancelled";
export type SearchOutcome = { kind: "ok"; credentialVersion: number; items: YouTubeShortCandidate[] }
  | { kind: "error"; code: SearchCode } | { kind: "login" } | { kind: "forbidden" } | { kind: "failed" };

const searchCodes = new Set<string>(["invalid_input", "stale", "storage_unavailable", "not_configured", "invalid_key", "search_in_progress",
  "quota_exceeded", "provider_error", "timed_out", "request_cancelled"]);

/** 명시 검색(POST). 요청은 계약 형식으로 다시 검사한 뒤에만 보낸다. */
export async function searchYouTubeShorts(input: YouTubeShortsSearchRequest, signal?: AbortSignal): Promise<SearchOutcome> {
  const checked = youtubeShortsSearchRequest.safeParse(input);
  if (!checked.success) return { kind: "error", code: "invalid_input" };
  try {
    const reply = await call(youtubeShortsSearchPath, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(checked.data) });
    if (reply.ok) {
      const parsed = youtubeShortsSearchResult.safeParse(reply.body);
      return parsed.success ? { kind: "ok", credentialVersion: parsed.data.credentialVersion, items: parsed.data.items } : { kind: "error", code: "provider_error" };
    }
    if (reply.status === 401) return { kind: "login" };
    if (reply.status === 403) return { kind: "forbidden" };
    return searchCodes.has(reply.code) ? { kind: "error", code: reply.code as SearchCode } : { kind: "failed" };
  } catch (error) { if (signal?.aborted) throw error; return { kind: "failed" }; }
}
