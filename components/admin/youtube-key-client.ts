"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { credentialKey } from "@/lib/reference-analysis/analysis-credential-contract";
import { youtubeCredentialMetadata, youtubeCredentialPath } from "@/lib/reference-analysis/youtube-credential-contract";

// P1-08 관리자 YouTube 키의 화면 쪽 통신(Backend 3404b8f·a9582d5, P1-08-ADMIN-YOUTUBE-SEARCH-API-CONTRACT).
// 경로·키 형식·요청·응답 형식은 서버 계약 파일을 그대로 쓴다. 키 원문은 저장 요청 본문에만 실리고 응답·화면 상태에는 남지 않는다.
// 키 저장(PUT)은 YouTube 검증 응답을 받은 뒤 서버에서 완료한다.
export type YouTubeKeyState = z.infer<typeof youtubeCredentialMetadata>;
export const isYouTubeKeyFormat = (value: string) => credentialKey.safeParse(value).success;

const errorBody = z.object({ code: z.string().max(80) });
type Common = { kind: "login" } | { kind: "forbidden" } | { kind: "storage" } | { kind: "failed" };
export type KeyRead = { kind: "ok"; value: YouTubeKeyState } | Common;
export type KeySave = KeyRead | { kind: "stale" } | { kind: "invalid" } | { kind: "too_large" } |
  { kind: "invalid_key" | "quota_exceeded" | "timed_out" };

export async function call(uri: string, init: RequestInit) {
  const response = await fetch(uri, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" });
  const body: unknown = await response.json().catch(() => null);
  const error = errorBody.safeParse(body);
  return { status: response.status, ok: response.ok, body, code: error.success ? error.data.code : "" };
}

/** 키 상태 조회(GET). 공급자 호출은 없다. */
export async function readYouTubeKey(signal?: AbortSignal): Promise<KeyRead> {
  try {
    const reply = await call(youtubeCredentialPath, { method: "GET", signal });
    if (reply.ok) {
      const parsed = youtubeCredentialMetadata.safeParse(reply.body);
      if (!parsed.success) return { kind: "failed" };
      publishKeyState(parsed.data);
      return { kind: "ok", value: parsed.data };
    }
    if (reply.status === 401) return { kind: "login" };
    if (reply.status === 403) return { kind: "forbidden" };
    if (reply.status === 503) return { kind: "storage" };
    return { kind: "failed" };
  } catch (error) { if (signal?.aborted) throw error; return { kind: "failed" }; }
}

/** 등록·교체(PUT {expectedVersion, apiKey}). 키는 이 요청 본문에만 실린다. */
export async function saveYouTubeKey(expectedVersion: number, apiKey: string, signal?: AbortSignal): Promise<KeySave> {
  try {
    const reply = await call(youtubeCredentialPath, { method: "PUT", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion, apiKey }) });
    if (reply.ok) {
      const parsed = youtubeCredentialMetadata.safeParse(reply.body);
      if (!parsed.success || !parsed.data.configured) return { kind: "failed" };
      publishKeyState(parsed.data);
      return { kind: "ok", value: parsed.data };
    }
    if (reply.status === 401) return { kind: "login" };
    if (reply.status === 403) return { kind: "forbidden" };
    if (reply.status === 409) return { kind: "stale" };
    if (reply.status === 400) return { kind: "invalid" };
    if (reply.status === 413) return { kind: "too_large" };
    if (reply.status === 422 && reply.code === "invalid_key") return { kind: "invalid_key" };
    if (reply.status === 429) return { kind: "quota_exceeded" };
    if (reply.status === 504) return { kind: "timed_out" };
    if (reply.status === 503) return { kind: "storage" };
    return { kind: "failed" };
  } catch (error) { if (signal?.aborted) throw error; return { kind: "failed" }; }
}

// 이 관리 화면(탭)에서 명시 검색으로 확인된 키 상태. 서버에는 '키가 YouTube에서 통하는지' 기록이 없어서,
// 저장 버전별로 마지막 검색 결과(받아들임·거절)만 메모리에 두고 설정 카드와 검색 칸이 함께 읽는다(새로 고치면 사라짐).
export type KeyCheck = { version: number; result: "accepted" | "rejected"; at: string };
let check: KeyCheck | null = null;
const listeners = new Set<() => void>();
export function recordKeyCheck(version: number, result: KeyCheck["result"]) {
  check = { version, result, at: new Date().toISOString() };
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useKeyCheck = () => useSyncExternalStore(subscribe, () => check, () => null);

// 이 관리 화면에서 마지막으로 읽거나 저장한 키 상태(가장 높은 버전). 한 칸(예: 메타데이터 보고서의 409 뒤 다시 읽기)이 새 버전을 알면
// 같은 화면의 다른 칸(검색)도 옛 버전을 계속 보이지 않게 이것을 함께 본다. 서버 응답의 메타데이터(configured·version·updatedAt)만 담는다.
let latest: YouTubeKeyState | null = null;
export function publishKeyState(state: YouTubeKeyState) {
  if (latest && state.version < latest.version) return;
  if (latest && latest.version === state.version && latest.configured === state.configured && latest.updatedAt === state.updatedAt) return;
  latest = state;
  listeners.forEach(listener => listener());
}
export const latestKeyState = () => latest;
export const useLatestKey = () => useSyncExternalStore(subscribe, () => latest, () => null);

/** 저장 상태와 검색 확인을 합친 설명. 같은 버전의 검색 결과만 쓴다. */
export function keyStatusText(state: YouTubeKeyState, seen: KeyCheck | null) {
  if (!state.configured) return { tone: "warning", text: "미등록 · 키를 저장하면 쇼츠 검색을 쓸 수 있어요." } as const;
  const same = seen?.version === state.version ? seen : null;
  if (!same) return { tone: "neutral", text: `저장됨(버전 ${state.version}) · 공개 쇼츠 검색에서 현재 연결을 확인할 수 있어요.` } as const;
  return same.result === "accepted"
    ? { tone: "success", text: `저장됨(버전 ${state.version}) · 이 화면의 검색에서 YouTube가 키를 받아들였어요.`, at: same.at } as const
    : { tone: "danger", text: `저장됨(버전 ${state.version}) · 이 화면의 검색에서 YouTube가 키나 API 사용을 거절했어요. 키를 교체해 주세요.`, at: same.at } as const;
}
