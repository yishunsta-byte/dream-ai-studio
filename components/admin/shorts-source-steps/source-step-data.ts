// P1-08-ORIGINAL-SEARCH-ANALYZE: 원본 Shorts Viral Studio v2.01 SearchStep·AnalyzeStep을 옮긴 화면 부품이 주고받는 값과 계산(지시어 없음).
// 셸(shorts-original)과 나중에 이을 때 쓰는 넘겨주는 값의 모양을 여기 둔다. 모두 화면 메모리 값이며 저장하지 않는다.
// 원본과 다르게 둔 것: 지금 검색 API에 없는 값(채널평균 대비·참여율·떡상점수·종교 영상 거르기)은 지어내지 않고 빼며,
// 원본 '하루 조회'는 운영 지표 VPH(시간당 조회수, af3a65d)로, 원본 등급은 같은 기준의 V/S 정수 계산(vsTenths)으로 보인다.
import { shortsAnalysisMaxVideos, type ShortsAnalysisResult, type ShortsMultiAnalysisResult } from "@/lib/reference-analysis/shorts-analysis-contract";
import type { YouTubeShortCandidate } from "@/lib/reference-analysis/youtube-shorts-search-contract";
import { viewsPerHour, vsGrade, vsTenths, type ViralGrade } from "../shorts-metrics";

export type SearchOrder = "relevance" | "viewCount" | "date";
/** 원본 검색 조건(검색어·정렬·게시 기간은 서버 요청, 나머지는 받은 결과의 화면 거르기). */
export type SourceQuery = { query: string; order: SearchOrder; dateFrom: string; dateTo: string };
export type SourceFilters = { maxDuration: "60" | "180" | "all"; minViews: string; maxSubs: string };

/** 검색 결과 한 벌. 셸이 단계를 옮겨도 다시 검색하지 않도록 이 값을 들고 있다가 initialSnapshot으로 되돌려 줄 수 있다. */
export type ShortsSourceSnapshot = SourceQuery & { items: YouTubeShortCandidate[]; credentialVersion: number; measuredAt: number };

/** ① 검색에서 고른 영상(셸에 넘기는 값). vsTenths는 직렬화를 위해 정수 문자열(예: "123" = 12.3배)이다. */
export type ShortsSourcePick = {
  videoId: string; url: string; title: string; channelTitle: string; thumbnailUrl: string | null; publishedAt: string;
  durationSeconds: number | null; views: number | null; subscribers: number | null;
  vsTenths: string | null; grade: ViralGrade; vph: number | null; query: string; measuredAt: string; credentialVersion: number;
};

/** ② 분석이 성공했을 때 셸에 넘기는 값. result는 서버 검사 형식(shortsAnalysisResultSchema)을 통과한 값 그대로다. */
export type ShortsSourceAnalysis = { videoId: string; url: string; title: string; result: ShortsAnalysisResult; analyzedAt: string };

/**
 * P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: ② 묶음 분석(영상 2~3개)이 성공했을 때 셸에 넘기는 값. 화면 메모리에만 두고,
 * ③ 소재·프로젝트·보관함은 영상 하나 계약이라 넘기지 않는다(단건으로 줄이지 않음). videos는 보낸 순서 그대로이고 segments[].video는 그 순서의 1부터 번호다.
 */
export type ShortsSourceMultiAnalysis = {
  videoIds: string[]; videos: { videoId: string; url: string; title: string }[]; result: ShortsMultiAnalysisResult; analyzedAt: string;
};

export const SOURCE_MAX_SELECT = shortsAnalysisMaxVideos; // 원본처럼 3개(2개 이상은 서버 묶음 분석 {urls}, 881b367)
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** 고른 영상 묶음의 이름(순서까지 같아야 같은 묶음). */
export const picksKey = (picks: readonly { videoId: string }[]) => picks.map(pick => pick.videoId).join(",");
export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** 고른 순서를 지키며 고르기·해제한다. 이미 SOURCE_MAX_SELECT개면 바꾸지 않고 full을 알린다(4번째 차단). */
export function togglePick(picks: readonly ShortsSourcePick[], next: ShortsSourcePick): { picks: ShortsSourcePick[]; full: boolean } {
  if (picks.some(pick => pick.videoId === next.videoId)) return { picks: picks.filter(pick => pick.videoId !== next.videoId), full: false };
  if (picks.length >= SOURCE_MAX_SELECT) return { picks: [...picks], full: true };
  return { picks: [...picks, next], full: false };
}

export function toPick(item: YouTubeShortCandidate, snapshot: Pick<ShortsSourceSnapshot, "query" | "measuredAt" | "credentialVersion">): ShortsSourcePick {
  const tenths = vsTenths(item);
  return {
    videoId: item.id, url: watchUrl(item.id), title: item.title, channelTitle: item.channelTitle, thumbnailUrl: item.thumbnailUrl,
    publishedAt: item.publishedAt, durationSeconds: item.durationSeconds, views: item.views, subscribers: item.subscribers,
    vsTenths: tenths === null ? null : tenths.toString(), grade: vsGrade(tenths), vph: viewsPerHour(item, snapshot.measuredAt),
    query: snapshot.query, measuredAt: new Date(snapshot.measuredAt).toISOString(), credentialVersion: snapshot.credentialVersion,
  };
}

/** 원본 filtered: 길이·최소 조회수·최대 구독자로 받은 결과만 거른다(요청 없음). 값이 비공개(null)라 조건을 확인할 수 없으면 뺀다. */
export function filterShorts<T extends Pick<YouTubeShortCandidate, "durationSeconds" | "views" | "subscribers">>(items: readonly T[], filters: SourceFilters): T[] {
  const maxDuration = filters.maxDuration === "all" ? null : Number(filters.maxDuration);
  const minViews = filters.minViews.trim() ? Number(filters.minViews) : null;
  const maxSubs = filters.maxSubs.trim() ? Number(filters.maxSubs) : null;
  return items.filter(item => {
    if (maxDuration !== null && (item.durationSeconds === null || item.durationSeconds > maxDuration)) return false;
    if (minViews !== null && Number.isFinite(minViews) && (item.views === null || item.views < minViews)) return false;
    if (maxSubs !== null && Number.isFinite(maxSubs) && (item.subscribers === null || item.subscribers > maxSubs)) return false;
    return true;
  });
}

/** UTC 날짜(검색 API 기간은 UTC 날짜 기준). */
export function isoDay(now: number, offsetDays: number) {
  return new Date(now + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
export type PresetKind = "viral" | "small" | "trending" | "reset";
/** 원본 applyPreset 값 그대로(기간은 오늘 기준 UTC 날짜). 프리셋은 조건만 바꾸고 검색은 사용자가 누를 때만 한다. */
export function presetValues(kind: PresetKind, now: number): { dateFrom: string; dateTo: string; filters: SourceFilters } {
  const to = isoDay(now, 0);
  if (kind === "viral") return { dateFrom: isoDay(now, -7), dateTo: to, filters: { maxDuration: "180", minViews: "50000", maxSubs: "" } };
  if (kind === "small") return { dateFrom: isoDay(now, -30), dateTo: to, filters: { maxDuration: "180", minViews: "10000", maxSubs: "50000" } };
  if (kind === "trending") return { dateFrom: isoDay(now, -1), dateTo: to, filters: { maxDuration: "180", minViews: "5000", maxSubs: "" } };
  return { dateFrom: isoDay(now, -30), dateTo: to, filters: { maxDuration: "180", minViews: "", maxSubs: "" } };
}

/** 원본 exportCsv의 표(받은 공개 값만). 셀은 큰따옴표로 감싸고, 표 계산식으로 읽힐 수 있는 첫 글자(= + - @ 탭 CR)는 작은따옴표를 앞에 붙인다. */
export function shortsCsv(items: readonly YouTubeShortCandidate[], measuredAt: number) {
  const cell = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  const header = ["제목", "채널", "게시일", "길이(초)", "조회수", "좋아요", "댓글", "구독자", "조회수÷구독자", "등급", "시간당 조회수(VPH)", "링크"];
  const rows = items.map(item => {
    const tenths = vsTenths(item);
    const vph = viewsPerHour(item, measuredAt);
    return [item.title, item.channelTitle, item.publishedAt.slice(0, 10), item.durationSeconds, item.views, item.likes, item.comments, item.subscribers,
      tenths === null ? null : `${tenths / 10n}.${tenths % 10n}`, vsGrade(tenths), vph === null ? null : Math.floor(vph), `https://www.youtube.com/shorts/${item.id}`];
  });
  return "﻿" + [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
}
