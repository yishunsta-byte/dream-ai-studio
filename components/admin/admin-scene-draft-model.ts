// P1-06 관리자 이미지 분석 결과 → 작업실 장면 이미지 초안 명시 저장의 판단 부분.
// 서버 계약은 기존 GET·PUT /api/projects/{id}/scenes/{sceneId}/prompts/image 그대로다(새 서버 변경 없음).
// GET의 version·basis를 PUT의 expectedVersion·expectedBasis로 보내고, 카드의 제안 원문(suggested)·편집문(text)·언어를 그대로 보낸다.
// 출처는 서버가 client_supplied로 기록한다(관리자 분석 응답에는 작업실 검증 원본 영수증이 없음).
// P1-07: 같은 판단을 음악 분석의 Suno 프롬프트 → …/prompts/music(program music, language 없음)에도 쓴다.

export const PROMPT_LIMIT = 16000;
export type PromptLanguage = "ko" | "en";
/** 관리자 분석에서 저장하는 장면 초안 종류(이미지 분석 → image, 음악 분석 → music). */
export type DraftKind = "image" | "music";
export type DraftBasis = { planId: string; contentRevision: number };
export type SavedDraft = { version: number; text: string; suggested: string; language?: PromptLanguage; savedAt: string; proof?: string };
export type SceneDraftState = { projectId: string; sceneId: string; basis: DraftBasis; version: number; draft: SavedDraft | null };
/** language는 이미지 카드에만 있다(음악 초안은 언어를 보내지 않는다). */
export type DraftInput = { language?: PromptLanguage; suggested: string; text: string };
export type SceneRef = { projectId: string; sceneId: string };

export const sceneDraftPath = ({ projectId, sceneId }: SceneRef, kind: DraftKind = "image") =>
  `/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/prompts/${kind}`;

const whole = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** 응답이 지금 장면의 그 종류 초안 상태일 때만 읽는다(이전 장면·다른 매체·모양이 다른 응답은 버림). */
export function readSceneDraftState(value: unknown, scene: SceneRef, kind: DraftKind = "image"): SceneDraftState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const basis = row.basis as Record<string, unknown> | undefined;
  if (row.projectId !== scene.projectId || row.sceneId !== scene.sceneId || row.kind !== kind || !whole(row.version) ||
      !basis || typeof basis.planId !== "string" || !whole(basis.contentRevision)) return undefined;
  let draft: SavedDraft | null = null;
  if (row.draft !== null) {
    const item = row.draft as Record<string, unknown> | undefined;
    if (!item || !whole(item.version) || typeof item.text !== "string" || typeof item.suggested !== "string" || typeof item.savedAt !== "string" ||
        (item.language !== undefined && item.language !== "ko" && item.language !== "en")) return undefined;
    const analysis = item.analysis as Record<string, unknown> | undefined;
    draft = { version: item.version as number, text: item.text, suggested: item.suggested, savedAt: item.savedAt,
      ...(item.language !== undefined && { language: item.language as PromptLanguage }),
      ...(typeof analysis?.proof === "string" && { proof: analysis.proof }) };
  }
  return { projectId: scene.projectId, sceneId: scene.sceneId, basis: { planId: basis.planId, contentRevision: basis.contentRevision as number },
    version: row.version as number, draft };
}

/** 서버 규칙(1~16,000자, 공백만·NUL 금지)과 같은 판정. 문제가 있으면 사용자 안내 문구. */
export function promptProblem({ suggested, text }: Pick<DraftInput, "suggested" | "text">) {
  if (!suggested.trim()) return "제안 원문이 없어 저장할 수 없어요.";
  if (!text.trim()) return "빈 프롬프트는 저장할 수 없어요.";
  if (text.includes("\0") || suggested.includes("\0")) return "저장할 수 없는 문자가 있어요.";
  if (text.length > PROMPT_LIMIT) return `프롬프트가 ${PROMPT_LIMIT.toLocaleString("ko-KR")}자를 넘어 저장할 수 없어요(지금 ${text.length.toLocaleString("ko-KR")}자).`;
  if (suggested.length > PROMPT_LIMIT) return `제안 원문이 ${PROMPT_LIMIT.toLocaleString("ko-KR")}자를 넘어 저장할 수 없어요.`;
  return undefined;
}

export function saveBody(state: Pick<SceneDraftState, "version" | "basis">, input: DraftInput, kind: DraftKind = "image") {
  const base = { expectedVersion: state.version, expectedBasis: { planId: state.basis.planId, contentRevision: state.basis.contentRevision },
    text: input.text, suggested: input.suggested };
  // 음악 초안은 서버 계약상 language를 받지 않는다(보내면 400).
  return kind === "music" ? { ...base, analysis: { program: "music" as const } }
    : { ...base, language: input.language, analysis: { program: "image" as const } };
}

/** 저장된 초안이 이 카드의 값과 같은지(원문·편집문·언어). */
export const sameDraft = (draft: SavedDraft | null, input: DraftInput) =>
  !!draft && draft.text === input.text && draft.suggested === input.suggested && draft.language === input.language;

/**
 * 응답이 끊긴 저장 뒤 최신 상태로 판정한다.
 * saved: 보낸 기준 바로 다음 버전이 이 카드 값과 같음 / not_saved: 기준·버전 그대로 / changed: 다른 곳에서 바뀜(사용자가 다시 고른다).
 */
export function lostSaveOutcome(latest: SceneDraftState, sent: Pick<SceneDraftState, "version" | "basis">, input: DraftInput) {
  const sameBasis = latest.basis.planId === sent.basis.planId && latest.basis.contentRevision === sent.basis.contentRevision;
  if (sameBasis && latest.version === sent.version + 1 && sameDraft(latest.draft, input)) return "saved" as const;
  if (sameBasis && latest.version === sent.version) return "not_saved" as const;
  return "changed" as const;
}

export const languageName = (language?: PromptLanguage) => language === "en" ? "영어" : language === "ko" ? "한국어" : "언어 없음";
