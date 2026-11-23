import { z } from "zod";
import { shortsAnalysisResultSchema, shortsMultiAnalysisResultSchema } from "@/lib/reference-analysis/shorts-analysis-contract";
import { shortsVaultId, shortsVaultProjectDocument } from "@/lib/reference-analysis/shorts-vault-contract";
import { youtubeShortCandidate, youtubeVideoIdSchema } from "@/lib/reference-analysis/youtube-shorts-search-contract";
import { SHORTS_FLOW, type ShortsView } from "./shorts-paths";
import { emptyShortsSession, projectDocument, sessionFromProject, type ShortsSession } from "./shorts-session";
import type { ShortsSourceAnalysis, ShortsSourceMultiAnalysis, ShortsSourcePick, ShortsSourceSnapshot } from "../shorts-source-steps/source-step-data";

// P1-08-SHORTS-RUNTIME-2 F1: 원본 StudioProvider의 탭 저장(sessionStorage 'svs_state_v1')에 해당한다.
// 새로고침, 같은 탭의 API키등록·매뉴얼 이동, 관리자 칸 이동(끼운 작업실이 다시 그려짐) 뒤에도 같은 탭에서 작업을 되살린다.
// - 같은 탭 안에서만 남는다(탭을 닫으면 브라우저가 지운다). 12시간이 지난 값과 다른 계정의 값은 버린다.
// - P1-08-SHORTS-SESSION-RESTORE-OWNER: 글마다 서버가 확인한 로그인 계정(주인)을 반드시 적는다. 주인이 없는(null·누락) 예전 글,
//   다른 계정의 글은 되살리지 않는다(셸이 지운다). 계정을 모르는 화면은 읽지도 쓰지도 않는다(셸이 주인을 넘길 때만 부른다).
// - 작업 상태는 보관함 프로젝트 문서와 같은 엄격한 계약으로 검사해 되살린다(맞지 않으면 통째로 버린다).
// - 생성 동의는 남기지 않는다(되살린 뒤 다시 받는다). 비밀·키는 원래 작업 상태에 없다.
export const shortsTabKey = "dream.shorts.studio.v1";
export const shortsTabMaxAgeMs = 12 * 3_600_000;

const views = ["home", "vault", ...SHORTS_FLOW.map(item => item.id)] as [ShortsView, ...ShortsView[]];
const isoText = z.string().min(1).max(40);
const grades = ["초대박", "대박", "떡상", "양호", "보통", "판정불가"] as const;
const pick = z.strictObject({
  videoId: youtubeVideoIdSchema, url: z.string().url().max(200), title: z.string().max(300), channelTitle: z.string().max(300),
  thumbnailUrl: z.string().max(500).nullable(), publishedAt: isoText, durationSeconds: z.number().int().min(0).nullable(),
  views: z.number().int().min(0).nullable(), subscribers: z.number().int().min(0).nullable(), vsTenths: z.string().regex(/^\d{1,12}$/).nullable(),
  grade: z.enum(grades), vph: z.number().min(0).nullable(), query: z.string().max(200), measuredAt: isoText, credentialVersion: z.number().int().min(0),
});
const snapshot = z.strictObject({
  query: z.string().max(200), order: z.enum(["relevance", "viewCount", "date"]), dateFrom: z.string().max(10), dateTo: z.string().max(10),
  items: z.array(youtubeShortCandidate).max(50), credentialVersion: z.number().int().min(0), measuredAt: z.number().finite(),
});
const analysis = z.strictObject({ videoId: youtubeVideoIdSchema, url: z.string().url().max(200), title: z.string().max(300),
  result: shortsAnalysisResultSchema, analyzedAt: isoText });
const multi = z.strictObject({ videoIds: z.array(youtubeVideoIdSchema).min(2).max(3),
  videos: z.array(z.strictObject({ videoId: youtubeVideoIdSchema, url: z.string().url().max(200), title: z.string().max(300) })).max(3),
  result: shortsMultiAnalysisResultSchema, analyzedAt: isoText });
const project = z.strictObject({ id: shortsVaultId, revision: z.number().int().min(1), expiresAt: isoText });
const stored = z.strictObject({
  version: z.literal(1), savedAt: z.number().finite(), account: z.string().trim().min(3).max(320),
  view: z.enum(views), title: z.string().max(120), document: shortsVaultProjectDocument.nullable(), project: project.nullable(),
  picks: z.array(pick).max(3), snapshot: snapshot.nullable(), analysis: analysis.nullable(), multi: multi.nullable(), multiOver: z.boolean(),
});

export type ShortsTabProject = z.infer<typeof project>;
export type ShortsTabState = {
  view: ShortsView; session: ShortsSession; project: ShortsTabProject | null; picks: ShortsSourcePick[];
  snapshot: ShortsSourceSnapshot | null; analysis: ShortsSourceAnalysis | null; multi: ShortsSourceMultiAnalysis | null;
  /** 묶음 분석이 지금 단건 근거보다 나중이었는지(F6 막힘을 되살린다). */
  multiOver: boolean;
};

/** 탭에 남길 글. 분석 근거가 없으면 작업 문서는 null(검색·고른 영상만 남김). 프로젝트 문서 계약에 맞지 않으면 작업 문서를 남기지 않는다. */
export function writeShortsTab(state: ShortsTabState, account: string, now = Date.now()) {
  const document = projectDocument(state.session);
  return JSON.stringify({
    version: 1, savedAt: now, account, view: state.view, title: state.session.title, document, project: document ? state.project : null,
    picks: state.picks, snapshot: state.snapshot, analysis: state.analysis, multi: state.multi, multiOver: !!document && state.multiOver,
  });
}

/** 탭에 남긴 글 → 되살릴 상태. 형식이 틀리거나, 12시간이 지났거나, 주인이 없거나(예전 null 글), 지금 계정과 다르면 null(버린다). */
export function readShortsTab(raw: string | null, account: string, now = Date.now()): ShortsTabState | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  const checked = stored.safeParse(value);
  if (!checked.success) return null;
  const data = checked.data;
  if (now - data.savedAt > shortsTabMaxAgeMs || data.savedAt - now > 60_000) return null;
  if (!account || data.account !== account) return null;
  const session = data.document ? { ...sessionFromProject(data.document), title: data.title } : null;
  return {
    view: data.view, session: session ?? emptyShortsSession,
    project: session ? data.project : null, picks: data.picks, snapshot: data.snapshot, analysis: data.analysis, multi: data.multi,
    multiOver: !!session && data.multiOver,
  };
}

/** sessionStorage 읽기·쓰기·지우기. 막혀 있거나(사생활 보호 창·저장 공간 부족) 오류가 나면 조용히 넘어간다(작업은 메모리에서 계속). */
export const shortsTabStorage = {
  read(): string | null { try { return window.sessionStorage.getItem(shortsTabKey); } catch { return null; } },
  write(value: string) { try { window.sessionStorage.setItem(shortsTabKey, value); } catch { /* 저장 공간 부족·차단: 메모리에서 계속 */ } },
  clear() { try { window.sessionStorage.removeItem(shortsTabKey); } catch { /* 차단 */ } },
};
