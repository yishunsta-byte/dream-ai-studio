import type { z } from "zod";
import type { ShortsAnalysisResult } from "@/lib/reference-analysis/shorts-analysis-contract";
import type { shortsIdeaSelection, shortsIdeaSource, shortsIdeasContext, shortsIdeasResult } from "@/lib/reference-analysis/shorts-ideas-contract";
import type { shortsScenePromptsBatchResult } from "@/lib/reference-analysis/shorts-scene-prompt-contract";
import type { shortsScriptRequest, shortsScriptResult } from "@/lib/reference-analysis/shorts-script-contract";
import {
  shortsVaultMaxVideos, shortsVaultProjectDocument, shortsVaultPromptSetDocument,
  type ShortsVaultProjectDocument, type ShortsVaultPromptSetDocument,
} from "@/lib/reference-analysis/shorts-vault-contract";
import type { ShortsStepId } from "./shorts-paths";

// P1-08 원본 쇼츠 ②~⑥ 사이에서 셸이 들고 다니는 작업 상태(원본 StudioProvider의 ProjectData에 해당).
// 값은 서버 계약 모양 그대로다. 보관함 문서로 바꿀 때도 엄격한 Vault 계약으로 다시 검사한다(영상 ID와 자체 생성 결과만).
export type ShortsContext = z.infer<typeof shortsIdeasContext>;
export type ShortsSource = z.infer<typeof shortsIdeaSource>;
export type ShortsIdea = z.infer<typeof shortsIdeasResult>["generation"]["ideas"][number];
export type ShortsSelection = z.infer<typeof shortsIdeaSelection>;
export type ShortsScriptConfig = z.infer<typeof shortsScriptRequest>["config"];
export type ShortsScript = z.infer<typeof shortsScriptResult>["generation"];
export type ShortsScenePrompts = z.infer<typeof shortsScenePromptsBatchResult>["generation"];

export type ShortsSession = {
  /** 프로젝트 제목. 처음 저장할 때 한 번 정하고(원본 StudioProvider) 그 뒤로는 바꾸지 않는다. 아직 저장 전이면 "". */
  title: string;
  keyword: string;
  videoIds: string[];
  context: ShortsContext | null;
  source: ShortsSource | null;
  ideas: ShortsIdea[];
  selected: ShortsSelection | null;
  direction: string;
  scriptConfig: ShortsScriptConfig | null;
  script: ShortsScript | null;
  scenePrompts: ShortsScenePrompts | null;
};

export const emptyShortsSession: ShortsSession = {
  title: "", keyword: "", videoIds: [], context: null, source: null, ideas: [], selected: null, direction: "",
  scriptConfig: null, script: null, scenePrompts: null,
};

/** 앞 단계가 바뀌면 그 뒤 결과는 근거가 달라지므로 비운다. 대본 설정(길이·톤·타깃)은 근거와 상관없는 내 선택이라 남긴다(원본 AnalyzeStep). */
export const afterContext: Partial<ShortsSession> = { source: null, ideas: [], selected: null, script: null, scenePrompts: null };
export const afterIdeas: Partial<ShortsSession> = { selected: null, script: null, scenePrompts: null };
export const afterSelection: Partial<ShortsSession> = { script: null, scenePrompts: null };

export const clip = (value: string, limit: number) => {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
};

/** ② 영상 분석 결과 → ③ 소재 요청의 근거(youtube_video). 요약·훅·구성과 앞쪽 구간 세 개만 넘긴다. */
export function contextFromAnalysis(videoId: string, { findings }: ShortsAnalysisResult): ShortsContext {
  return {
    evidence: "youtube_video", videoId, summary: clip(findings.summary, 520),
    hook: findings.hook ? clip(findings.hook, 240) : null,
    composition: findings.composition ? clip(findings.composition, 240) : null,
    observations: findings.segments.slice(0, 3).map(segment => clip(`${segment.timestamp} ${segment.evidence}`, 240)),
  };
}

/** 새 분석이 성공하면 근거와 영상 목록을 바꾸고 뒤 단계 결과를 비운다(같은 영상은 앞으로, 최대 3개).
 * 키워드는 이 영상을 찾은 지금 검색어로 바꾼다(원본: 저장할 때마다 지금 검색어). 검색 없이 주소로 분석했으면 앞 영상의 검색어를 남기지 않고 비운다. */
export function withAnalysis(session: ShortsSession, videoId: string, result: ShortsAnalysisResult, keyword?: string): ShortsSession {
  return {
    ...session, ...afterContext, context: contextFromAnalysis(videoId, result),
    keyword: keyword?.trim() ? clip(keyword, 100) : "",
    videoIds: [videoId, ...session.videoIds.filter(id => id !== videoId)].slice(0, shortsVaultMaxVideos),
  };
}

export const selectionOf = ({ title, openingHook, hookStrategy, beats }: ShortsSelection): ShortsSelection =>
  ({ title, openingHook, hookStrategy, beats });

/** 지금 상태가 어느 단계까지 끝났는지(보관함 문서의 step, 다시 열 때 이동할 단계). */
export function progressStep(session: ShortsSession): number {
  if (session.scenePrompts) return 6;
  if (session.script) return 5;
  if (session.selected) return 4;
  if (session.ideas.length) return 3;
  return session.context ? 2 : 1;
}
const stepViews: readonly ShortsStepId[] = ["search", "analyze", "ideate", "select", "script", "prompts"];
export const viewOfStep = (step: number): ShortsStepId => stepViews[Math.min(Math.max(step, 1), 6) - 1];

export type ShortsResume = { step: number; view: ShortsStepId; title: string | null };
/** 홈 '이어서 작업하기'가 갈 곳(P1-08-SHORTS-HOME-RESUME). 분석 근거가 있으면 지금 작업의 마지막 단계(progressStep → viewOfStep, 다시 연 프로젝트와 같은 규칙),
 * 분석 전이면 고른 영상의 ② 분석, 둘 다 없으면 null(단추 없음). 고른 영상이 있어도 이미 진행한 작업이 있으면 그 작업이 먼저다(①에서 고르기만으로는 작업이 바뀌지 않음).
 * 제목은 고른 소재 → 키워드 → (분석 전) 고른 영상 제목 순서로, 없으면 null. 이동만 정하고 요청·초기화는 하지 않는다. */
export function resumeOf(session: ShortsSession, pick: { title: string } | null): ShortsResume | null {
  if (session.context) {
    const step = progressStep(session);
    return { step, view: viewOfStep(step), title: session.selected?.title.trim() || session.keyword.trim() || null };
  }
  return pick ? { step: 2, view: "analyze", title: pick.title.trim() || null } : null;
}

/** 처음 저장할 때 정하는 프로젝트 제목: 고른 소재 → 키워드 → 분석 요약. */
export const firstTitle = (session: ShortsSession) => session.selected?.title || session.keyword || session.context?.summary || "";

/** 30일 탐색 프로젝트 문서. 분석 근거가 없으면 저장할 것이 없다(null). 계약에 맞지 않으면 저장하지 않는다(null).
 * 제목은 이미 정했으면(session.title) 그대로 두고, 처음 저장이면 firstTitle로 정한다. */
export function projectDocument(session: ShortsSession): ShortsVaultProjectDocument | null {
  if (!session.context) return null;
  const title = session.title || firstTitle(session);
  const document = {
    title: clip(title, 120), keyword: clip(session.keyword, 100), step: progressStep(session), videoIds: session.videoIds,
    context: session.context,
    ...(session.source && { source: session.source }),
    ...(session.ideas.length && { ideas: session.ideas }),
    ...(session.selected && { selectedIdea: session.selected }),
    ...(session.direction.trim() && { direction: session.direction.trim() }),
    ...(session.scriptConfig && { scriptConfig: session.scriptConfig }),
    ...(session.script && { script: session.script }),
    ...(session.scenePrompts && { scenePrompts: session.scenePrompts }),
  };
  const checked = shortsVaultProjectDocument.safeParse(document);
  return checked.success ? checked.data : null;
}

export function sessionFromProject(document: ShortsVaultProjectDocument): ShortsSession {
  return {
    title: document.title, keyword: document.keyword, videoIds: document.videoIds, context: document.context ?? null, source: document.source ?? null,
    ideas: document.ideas ?? [], selected: document.selectedIdea ?? null, direction: document.direction ?? "",
    scriptConfig: document.scriptConfig ?? null, script: document.script ?? null, scenePrompts: document.scenePrompts ?? null,
  };
}

/** ⑥ 결과를 프롬프트 보관함 세트로. 고른 소재와 전 장면 프롬프트가 있어야 한다. */
export function promptSetDocument(session: ShortsSession): ShortsVaultPromptSetDocument | null {
  const { selected, scenePrompts } = session;
  if (!selected || !scenePrompts) return null;
  const checked = shortsVaultPromptSetDocument.safeParse({
    title: clip(`${selected.title} · 9:16 프롬프트`, 120), ideaTitle: clip(selected.title, 100), hook: clip(selected.openingHook, 220),
    keyword: clip(session.keyword, 100), videoIds: session.videoIds, durationSec: scenePrompts.durationSec,
    prompts: scenePrompts.prompts, bgmPrompt: scenePrompts.bgmPrompt,
  });
  return checked.success ? checked.data : null;
}

const time = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
export const timecode = ({ startSec, endSec }: { startSec: number; endSec: number }) => `${time(startSec)}–${time(endSec)}`;

export function scriptMarkdown(title: string, script: ShortsScript) {
  return [`# ${title} · ${script.durationSec}초 대본`, "",
    ...script.scenes.flatMap(scene => [`## 씬 ${scene.sceneNumber} (${timecode(scene)})`, `- 나레이션: ${scene.narration}`,
      `- 연출: ${scene.visual}`, ...(scene.caption ? [`- 자막: ${scene.caption}`] : []), ...(scene.sfx ? [`- 효과음: ${scene.sfx}`] : []), ""]),
  ].join("\n");
}

export function promptSetMarkdown(document: ShortsVaultPromptSetDocument) {
  const bgm = document.bgmPrompt;
  return [`# ${document.title}`, "", `- 소재: ${document.ideaTitle}`, ...(document.hook ? [`- 첫 훅: ${document.hook}`] : []),
    ...(document.keyword ? [`- 키워드: ${document.keyword}`] : []), ...(document.durationSec ? [`- 길이: ${document.durationSec}초`] : []), "",
    ...document.prompts.flatMap(prompt => [`## 씬 ${prompt.sceneNumber} (${timecode(prompt)})`, prompt.sceneSummary, "",
      "**Image prompt**", "", prompt.imagePrompt, "", "**Video prompt**", "", prompt.videoPrompt, ""]),
    ...(bgm ? ["## BGM", `- 제목: ${bgm.title}`, `- 장르·분위기: ${bgm.genreAndMood}`,
      ...(bgm.recommendedBpmRange ? [`- BPM: ${bgm.recommendedBpmRange.min}–${bgm.recommendedBpmRange.max}`] : []), `- 악기: ${bgm.instrumentation}`,
      `- 전개: ${bgm.dynamicStructure}`, `- 믹싱: ${bgm.audioMixingNotes}`, "", "**Suno prompt**", "", bgm.sunoPrompt, ""] : []),
  ].join("\n");
}

/** 내려받기 파일 이름: 경로·예약 문자를 빼고 60자까지. */
export const fileName = (title: string, suffix: string) =>
  `${([...title].map(char => char < " " || "\\/:*?\"<>|".includes(char) ? " " : char).join("").trim().slice(0, 60) || "shorts")}-${suffix}.md`;
