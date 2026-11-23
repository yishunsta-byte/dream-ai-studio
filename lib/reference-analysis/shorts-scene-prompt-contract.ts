import { z } from "zod";
import { hasEnglishPromptText, shortsCreativeSelectedIdea } from "./shorts-creative-text";
import { shortsIdeaSource } from "./shorts-ideas-contract";
import { hasShortsBgmPromptDetails, shortsBgmPromptModelOutput } from "./shorts-bgm-prompt-contract";
import {
  hasPossibleShortsScriptSceneTiming, hasShortsScriptTimeline, shortsScriptDuration, shortsScriptModelOutput, shortsScriptScene,
  shortsScriptSceneTiming,
} from "./shorts-script-contract";
import { youtubeCredentialVersion } from "./youtube-credential-contract";

export const shortsScenePromptPath = "/api/admin/shorts-scene-prompt";

export const shortsScenePromptRequest = z.strictObject({
  authorized: z.literal(true), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  selectedIdea: shortsCreativeSelectedIdea,
  durationSec: shortsScriptDuration, selectedScene: shortsScriptScene,
}).refine(({ durationSec, selectedScene }) => hasPossibleShortsScriptSceneTiming(durationSec, selectedScene), { path: ["selectedScene"] });
export type ShortsScenePromptRequest = z.infer<typeof shortsScenePromptRequest>;

const promptText = z.string().trim().min(1).max(1200);
const generatedPrompt = shortsScriptSceneTiming.pick({ sceneNumber: true }).extend({
  sceneSummary: z.string().trim().min(1).max(240), imagePrompt: promptText, videoPrompt: promptText,
});
export const shortsScenePromptModelOutput = z.strictObject({ prompts: z.array(generatedPrompt).length(1) });

export const hasShortsScenePromptLanguages = ({ sceneSummary, imagePrompt, videoPrompt }: z.infer<typeof generatedPrompt>) =>
  /\p{Script=Hangul}/u.test(sceneSummary) && hasEnglishPromptText(imagePrompt) && hasEnglishPromptText(videoPrompt);

export const shortsScenePromptResult = z.strictObject({
  schemaVersion: z.literal(1), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  generation: generatedPrompt.extend({
    kind: z.literal("creative_scene_prompt_draft"), durationSec: shortsScriptDuration,
    startSec: shortsScriptSceneTiming.shape.startSec, endSec: shortsScriptSceneTiming.shape.endSec,
  }),
}).refine(({ generation }) => hasPossibleShortsScriptSceneTiming(generation.durationSec, generation) && hasShortsScenePromptLanguages(generation),
  { path: ["generation"] });
export type ShortsScenePromptResult = z.infer<typeof shortsScenePromptResult>;

// 원본 v2.01 generatePromptsAction: 대본 전 장면의 이미지·영상 프롬프트와 전체 BGM 프롬프트를 한 번에 만든다.
// 같은 POST 경로에서 단건(selectedScene)과 묶음(scenes)을 받는다. 두 모양 모두 strictObject라 키를 섞은 요청은 어느 쪽에도 맞지 않는다.
// P1-08-SHORTS-SCENE-CHUNKS: 선택 range가 있으면 전체 scenes는 맥락으로만 보내고, from~to 장면(최대 9개)의 프롬프트만 받는다.
// 구간 요청은 BGM을 만들지 않으므로 bgmDirection을 함께 보낼 수 없다(BGM은 /api/admin/shorts-bgm-prompt). range가 없으면 기존 전체 묶음 그대로.
export const shortsScenePromptsRangeMax = 9;
const sceneNumber = shortsScriptSceneTiming.shape.sceneNumber;
export const shortsScenePromptsRange = z.strictObject({ from: sceneNumber, to: sceneNumber })
  .refine(({ from, to }) => from <= to && to - from + 1 <= shortsScenePromptsRangeMax);
export type ShortsScenePromptsRange = z.infer<typeof shortsScenePromptsRange>;
export const shortsScenePromptsBatchRequest = z.strictObject({
  authorized: z.literal(true), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  selectedIdea: shortsCreativeSelectedIdea, durationSec: shortsScriptDuration,
  scenes: shortsScriptModelOutput.shape.scenes, bgmDirection: z.string().trim().min(1).max(240).optional(),
  range: shortsScenePromptsRange.optional(),
}).refine(({ durationSec, scenes }) => hasShortsScriptTimeline(durationSec, scenes), { path: ["scenes"] })
  .refine(({ scenes, range, bgmDirection }) => !range || (range.to <= scenes.length && bgmDirection === undefined), { path: ["range"] });
export type ShortsScenePromptsBatchRequest = z.infer<typeof shortsScenePromptsBatchRequest>;
export const shortsScenePromptRouteRequest = z.union([shortsScenePromptRequest, shortsScenePromptsBatchRequest]);
export type ShortsScenePromptRouteRequest = z.infer<typeof shortsScenePromptRouteRequest>;
export const isShortsScenePromptsBatch = <T extends object>(input: T): input is Extract<T, { scenes: unknown }> => "scenes" in input;
export const rangeSize = ({ from, to }: ShortsScenePromptsRange) => to - from + 1;

const bgmPrompt = shortsBgmPromptModelOutput.shape.bgmPrompt;
export const shortsScenePromptsBatchModelOutput = z.strictObject({ prompts: z.array(generatedPrompt).min(1), bgmPrompt });
export type ShortsScenePromptsBatchOutput = z.infer<typeof shortsScenePromptsBatchModelOutput>;

/** 모델 출력이 입력 장면과 같은 수·순서·언어 규칙을 지키고 BGM 세부가 맞는지. 하나라도 어긋나면 묶음 전체를 버린다.
 * P1-08-SHORTS-RUNTIME-2 F2: 결과(화면이 모은 묶음·보관 문서)는 BGM 없음(null)을 받는다(원본 pipeline: BGM 실패여도 장면 결과는 성공).
 * 모델 출력 계약(shortsScenePromptsBatchModelOutput)은 그대로 BGM 필수라 모델 응답에서 null은 오지 않는다. */
export function hasShortsScenePromptsBatch(scenes: readonly { sceneNumber: number }[],
  { prompts, bgmPrompt }: { prompts: ShortsScenePromptsBatchOutput["prompts"]; bgmPrompt: ShortsScenePromptsBatchOutput["bgmPrompt"] | null }) {
  return prompts.length === scenes.length && prompts.every((prompt, index) =>
    prompt.sceneNumber === scenes[index].sceneNumber && hasShortsScenePromptLanguages(prompt)) && (bgmPrompt === null || hasShortsBgmPromptDetails(bgmPrompt));
}

const timedPrompt = generatedPrompt.extend({
  startSec: shortsScriptSceneTiming.shape.startSec, endSec: shortsScriptSceneTiming.shape.endSec,
});
export const shortsScenePromptsBatchResult = z.strictObject({
  schemaVersion: z.literal(1), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  generation: z.strictObject({
    kind: z.literal("creative_scene_prompts_draft"), durationSec: shortsScriptDuration,
    // F2: BGM만 실패한 결과도 장면 프롬프트는 살린다(BGM 없음 = null). 예전 기록(BGM 있음)은 그대로 통과한다.
    prompts: z.array(timedPrompt).min(1), bgmPrompt: bgmPrompt.nullable(),
  }),
}).refine(({ generation }) => hasShortsScriptTimeline(generation.durationSec, generation.prompts.map(prompt => ({
  ...prompt, narration: "-", visual: "-", caption: null, sfx: null,
}))) && hasShortsScenePromptsBatch(generation.prompts, generation), { path: ["generation"] });
export type ShortsScenePromptsBatchResult = z.infer<typeof shortsScenePromptsBatchResult>;

// 구간 모델 출력: 장면 프롬프트만(BGM 없음). 개수 상한은 구간 최대값, 정확한 개수·번호는 hasShortsScenePromptsRange가 본다.
export const shortsScenePromptsRangeModelOutput = z.strictObject({ prompts: z.array(generatedPrompt).min(1).max(shortsScenePromptsRangeMax) });
export type ShortsScenePromptsRangeOutput = z.infer<typeof shortsScenePromptsRangeModelOutput>;

/** 구간 출력이 from~to를 빠짐없이 순서대로 담고 언어 규칙을 지키는지. 하나라도 어긋나면 그 구간 전체를 버린다. */
export function hasShortsScenePromptsRange(range: ShortsScenePromptsRange, prompts: readonly z.infer<typeof generatedPrompt>[]) {
  return prompts.length === rangeSize(range) && prompts.every((prompt, index) =>
    prompt.sceneNumber === range.from + index && hasShortsScenePromptLanguages(prompt));
}

export const shortsScenePromptsRangeResult = z.strictObject({
  schemaVersion: z.literal(1), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  generation: z.strictObject({
    kind: z.literal("creative_scene_prompts_range_draft"), durationSec: shortsScriptDuration, range: shortsScenePromptsRange,
    prompts: z.array(timedPrompt).min(1).max(shortsScenePromptsRangeMax),
  }),
}).refine(({ generation }) => hasShortsScenePromptsRange(generation.range, generation.prompts) &&
  generation.prompts.every(prompt => hasPossibleShortsScriptSceneTiming(generation.durationSec, prompt)) &&
  generation.prompts.every((prompt, index) => index === 0 || prompt.startSec === generation.prompts[index - 1].endSec), { path: ["generation"] });
export type ShortsScenePromptsRangeResult = z.infer<typeof shortsScenePromptsRangeResult>;
