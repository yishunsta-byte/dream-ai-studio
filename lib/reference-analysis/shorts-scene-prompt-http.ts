import "server-only";

import { createShortsCreativePost, type ShortsCreativeOverrides } from "./shorts-creative-http";
import {
  isShortsScenePromptsBatch, shortsScenePromptRouteRequest, type ShortsScenePromptResult, type ShortsScenePromptsBatchOutput,
  type ShortsScenePromptsBatchResult, type ShortsScenePromptsRangeOutput, type ShortsScenePromptsRangeResult,
} from "./shorts-scene-prompt-contract";
import { generateShortsScenePrompt, generateShortsScenePrompts, generateShortsScenePromptsRange } from "./shorts-scene-prompt";
import { shortsScriptBodyByteLimit } from "./shorts-script-contract";

type SinglePrompt = ShortsScenePromptResult["generation"] extends infer G ?
  Omit<G, "kind" | "durationSec" | "startSec" | "endSec"> : never;
type BatchInput = Parameters<typeof generateShortsScenePrompts>[0]["input"];
type SingleInput = Parameters<typeof generateShortsScenePrompt>[0]["input"];
type Generated = { batch: false; prompt: SinglePrompt } | { batch: true; output: ShortsScenePromptsBatchOutput } |
  { batch: "range"; output: ShortsScenePromptsRangeOutput };

/**
 * 한 POST 경로에서 두 모양을 받는다.
 * - 단건(selectedScene): 기존 요청·응답 그대로, 본문 8 KiB.
 * - 묶음(scenes): 원본 v2.01 전 장면+BGM, 본문 160 KiB, 응답 kind는 creative_scene_prompts_draft.
 * - 구간 묶음(scenes+range, P1-08-SHORTS-SCENE-CHUNKS): from~to 장면(최대 9)만, BGM 없음, 응답 kind는 creative_scene_prompts_range_draft.
 *   인증·출처·본문 상한·스키마(구간 범위 포함) 검사는 모두 공급자 호출 전에 끝난다.
 */
export function createShortsScenePromptPost(overrides: ShortsCreativeOverrides = {}) {
  return createShortsCreativePost({
    schema: shortsScenePromptRouteRequest,
    progressCode: "scene_prompt_in_progress",
    largeBody: { limit: shortsScriptBodyByteLimit, allows: isShortsScenePromptsBatch },
    // 공통 처리의 Omit<합집합>은 두 모양의 고유 키를 지우므로, 이미 strict 스키마로 가른 입력을 각 모양으로 되돌려 넘긴다.
    generate: async ({ input: common, ...rest }) => {
      const input = common as BatchInput | SingleInput;
      if (isShortsScenePromptsBatch(input) && input.range) {
        const result = await generateShortsScenePromptsRange({ input: { ...input, range: input.range }, ...rest });
        return "code" in result ? result : { generated: { batch: "range", output: result.generated } as Generated };
      }
      if (isShortsScenePromptsBatch(input)) {
        const result = await generateShortsScenePrompts({ input, ...rest });
        return "code" in result ? result : { generated: { batch: true, output: result.generated } as Generated };
      }
      const result = await generateShortsScenePrompt({ input, ...rest });
      return "code" in result ? result : { generated: { batch: false, prompt: result.generated } as Generated };
    },
    format: (request, generated): ShortsScenePromptResult | ShortsScenePromptsBatchResult | ShortsScenePromptsRangeResult => {
      const { source, durationSec, geminiCredentialVersion } = request;
      if (generated.batch === "range" && isShortsScenePromptsBatch(request) && request.range) {
        const range = request.range;
        return { schemaVersion: 1, geminiCredentialVersion, source, generation: {
          kind: "creative_scene_prompts_range_draft", durationSec, range,
          prompts: generated.output.prompts.map(prompt => ({ ...prompt,
            startSec: request.scenes[prompt.sceneNumber - 1].startSec, endSec: request.scenes[prompt.sceneNumber - 1].endSec })),
        } };
      }
      if (generated.batch === true && isShortsScenePromptsBatch(request) && !request.range) {
        const { prompts, bgmPrompt } = generated.output;
        return { schemaVersion: 1, geminiCredentialVersion, source, generation: {
          kind: "creative_scene_prompts_draft", durationSec, bgmPrompt,
          prompts: prompts.map((prompt, index) => ({ ...prompt,
            startSec: request.scenes[index].startSec, endSec: request.scenes[index].endSec })),
        } };
      }
      if (generated.batch || isShortsScenePromptsBatch(request)) throw new Error("scene prompt mode mismatch");
      return { schemaVersion: 1, geminiCredentialVersion, source,
        generation: { ...generated.prompt, kind: "creative_scene_prompt_draft", durationSec,
          startSec: request.selectedScene.startSec, endSec: request.selectedScene.endSec } };
    },
  }, overrides);
}
