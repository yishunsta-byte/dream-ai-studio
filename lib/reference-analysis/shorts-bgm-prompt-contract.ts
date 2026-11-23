import { z } from "zod";
import { hasEnglishPromptText, shortsCreativeSelectedIdea } from "./shorts-creative-text";
import { shortsIdeaSource } from "./shorts-ideas-contract";
import { hasPossibleShortsScriptSceneTiming, shortsScriptDuration, shortsScriptSceneTiming } from "./shorts-script-contract";
import { youtubeCredentialVersion } from "./youtube-credential-contract";

export const shortsBgmPromptPath = "/api/admin/shorts-bgm-prompt";
const text = (limit: number) => z.string().trim().min(1).max(limit);
const cue = shortsScriptSceneTiming.extend({ note: text(120) });

export const shortsBgmPromptBasis = z.strictObject({ direction: text(240).optional(), cues: z.array(cue).max(4) });
export const shortsBgmPromptRequest = z.strictObject({
  authorized: z.literal(true), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  selectedIdea: shortsCreativeSelectedIdea, durationSec: shortsScriptDuration, ...shortsBgmPromptBasis.shape,
}).refine(({ durationSec, cues }) => cues.every((item, index) => {
  if (!hasPossibleShortsScriptSceneTiming(durationSec, item)) return false;
  const previous = cues[index - 1];
  if (!previous) return true;
  const skippedScenes = item.sceneNumber - previous.sceneNumber - 1;
  const gapSec = item.startSec - previous.endSec;
  return skippedScenes === 0 ? gapSec === 0 : skippedScenes > 0 && gapSec >= skippedScenes;
}), { path: ["cues"] });
export type ShortsBgmPromptRequest = z.infer<typeof shortsBgmPromptRequest>;

const bpm = z.number().int().min(20).max(300);
const bgmPrompt = z.strictObject({
  title: text(100), genreAndMood: text(240), recommendedBpmRange: z.strictObject({ min: bpm, max: bpm }).nullable(),
  instrumentation: text(240), dynamicStructure: text(520), audioMixingNotes: text(400), sunoPrompt: text(1200),
});
export const shortsBgmPromptModelOutput = z.strictObject({ bgmPrompt });

export function hasShortsBgmPromptDetails({ recommendedBpmRange, sunoPrompt }: z.infer<typeof bgmPrompt>) {
  return hasEnglishPromptText(sunoPrompt) && (!recommendedBpmRange || recommendedBpmRange.min <= recommendedBpmRange.max);
}

export const shortsBgmPromptResult = z.strictObject({
  schemaVersion: z.literal(1), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  generation: bgmPrompt.extend({ kind: z.literal("creative_bgm_prompt_draft"), durationSec: shortsScriptDuration }),
}).refine(({ generation }) => hasShortsBgmPromptDetails(generation), { path: ["generation"] });
export type ShortsBgmPromptResult = z.infer<typeof shortsBgmPromptResult>;
