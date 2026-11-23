import { z } from "zod";
import { shortsBgmPromptResult } from "./shorts-bgm-prompt-contract";
import { shortsIdeaSelection, shortsIdeaSource, shortsIdeasContext, shortsIdeasResult } from "./shorts-ideas-contract";
import { shortsScenePromptsBatchResult } from "./shorts-scene-prompt-contract";
import { shortsScriptRequest, shortsScriptResult } from "./shorts-script-contract";
import { youtubeVideoIdSchema } from "./youtube-shorts-search-contract";

// P1-08-SHORTS-VAULT: 원본 v2.01의 프롬프트 보관함(svs_saved_prompts)과 30일 탐색 프로젝트(svs_projects).
// 문서는 YouTube 영상 ID와 이 제품이 만든 결과만 담는다. 댓글 원문·지표 스냅샷·비밀은 받지 않는다(strict 스키마 + 비밀 모양 거절).
export const shortsVaultPath = "/api/admin/shorts-vault";
export const shortsVaultPromptSetLimit = 200;
export const shortsVaultProjectLimit = 100;
export const shortsVaultRetentionDays = 30;
export const shortsVaultPromptSetBodyLimit = 256 * 1024;
export const shortsVaultProjectBodyLimit = 512 * 1024;
export const shortsVaultMaxVideos = 3;
const sceneLimit = 45;

const text = (limit: number) => z.string().trim().min(1).max(limit);
const optionalText = (limit: number) => z.string().trim().max(limit);
export const shortsVaultId = z.guid();
const videoIds = z.array(youtubeVideoIdSchema).max(shortsVaultMaxVideos)
  .refine(ids => new Set(ids).size === ids.length, { message: "duplicate video" });

// Google API 키·OpenAI·Anthropic 키 모양, 비밀 헤더 이름이 들어 있으면 저장하지 않는다.
const secretShapes = [/AIza[0-9A-Za-z_-]{35}/, /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, /x-goog-api-key/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
export const hasShortsVaultSecret = (document: unknown) => {
  const raw = JSON.stringify(document);
  return secretShapes.some(shape => shape.test(raw));
};

const timedPrompt = shortsScenePromptsBatchResult.shape.generation.shape.prompts.element;
const bgmPrompt = shortsBgmPromptResult.shape.generation.omit({ kind: true, durationSec: true });

export const shortsVaultPromptSetDocument = z.strictObject({
  title: text(120), ideaTitle: text(100), hook: optionalText(220), keyword: optionalText(100),
  videoIds, durationSec: shortsScriptResult.shape.generation.shape.durationSec.optional(),
  prompts: z.array(timedPrompt).min(1).max(sceneLimit), bgmPrompt: bgmPrompt.nullable(),
}).refine(({ prompts }) => prompts.every((prompt, index) => index === 0 || prompt.sceneNumber > prompts[index - 1].sceneNumber),
  { path: ["prompts"] });
export type ShortsVaultPromptSetDocument = z.infer<typeof shortsVaultPromptSetDocument>;

export const shortsVaultProjectDocument = z.strictObject({
  title: text(120), keyword: optionalText(100), step: z.number().int().min(1).max(6), videoIds,
  source: shortsIdeaSource.optional(),
  context: shortsIdeasContext.optional(),
  ideas: shortsIdeasResult.shape.generation.shape.ideas.optional(),
  selectedIdea: shortsIdeaSelection.optional(),
  direction: text(1000).optional(),
  scriptConfig: shortsScriptRequest.shape.config.optional(),
  script: shortsScriptResult.shape.generation.optional(),
  scenePrompts: shortsScenePromptsBatchResult.shape.generation.optional(),
  bgmPrompt: shortsBgmPromptResult.shape.generation.optional(),
});
export type ShortsVaultProjectDocument = z.infer<typeof shortsVaultProjectDocument>;

const requestId = shortsVaultId;
export const shortsVaultPromptSetCreate = z.strictObject({ requestId, document: shortsVaultPromptSetDocument });
export const shortsVaultProjectCreate = z.strictObject({ requestId, document: shortsVaultProjectDocument });
export const shortsVaultProjectReplace = z.strictObject({
  expectedRevision: z.number().int().min(1).max(999_999), document: shortsVaultProjectDocument,
});

// P1-08-SHORTS-VAULT-CONTENT-SEARCH-API: 저장한 프롬프트 세트의 내용 검색(POST, 같은 출처, 관리자).
// 검색어는 앞뒤 공백을 뺀 1~120자(코드 포인트)이고 NUL 문자는 받지 않는다(PostgreSQL text에 넣을 수 없음).
// 검색어는 어디에도 저장·기록하지 않고, 결과는 목록과 같은 요약({ promptSets })만 돌려준다.
export const shortsVaultPromptSearchPath = `${shortsVaultPath}/prompts/search`;
export const shortsVaultSearchQueryLimit = 120;
export const shortsVaultSearchBodyLimit = 2048;
export const shortsVaultPromptSearch = z.strictObject({
  query: z.string().trim().min(1)
    .refine(value => Array.from(value).length <= shortsVaultSearchQueryLimit && !value.includes("\u0000")),
});

export type ShortsVaultPromptSetSummary = { id: string; title: string; ideaTitle: string; keyword: string;
  sceneCount: number; hasBgm: boolean; createdAt: string };
export type ShortsVaultPromptSet = { id: string; createdAt: string; document: ShortsVaultPromptSetDocument };
export type ShortsVaultProjectSummary = { id: string; title: string; keyword: string; step: number; revision: number;
  createdAt: string; updatedAt: string; expiresAt: string };
export type ShortsVaultProject = ShortsVaultProjectSummary & { document: ShortsVaultProjectDocument };
