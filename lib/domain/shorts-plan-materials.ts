import { z } from "zod";
import { shortsBgmPromptBasis, shortsBgmPromptResult } from "@/lib/reference-analysis/shorts-bgm-prompt-contract";
import { shortsCreativeSelectedIdea } from "@/lib/reference-analysis/shorts-creative-text";
import { shortsIdeaSource } from "@/lib/reference-analysis/shorts-ideas-contract";
import { shortsScenePromptResult } from "@/lib/reference-analysis/shorts-scene-prompt-contract";
import { shortsScriptDurationSec, shortsScriptScene, shortsScriptSceneRange, shortsScriptSceneTiming } from "@/lib/reference-analysis/shorts-script-contract";
import type { SceneDraft } from "./planning-draft";

const maxScenes = shortsScriptSceneRange(shortsScriptDurationSec.max).max;
const annotation = z.string().trim().max(120).nullable().transform(value => value || null);
const sceneMaterials = z.strictObject({
  sceneNumber: shortsScriptSceneTiming.shape.sceneNumber,
  caption: annotation,
  sfx: annotation,
  prompt: z.strictObject({ basis: shortsScriptScene, result: shortsScenePromptResult }).optional(),
});
const materials = z.strictObject({
  schemaVersion: z.literal(1),
  source: shortsIdeaSource,
  idea: shortsCreativeSelectedIdea,
  scenes: z.array(sceneMaterials).min(1).max(maxScenes),
  bgm: z.strictObject({ basis: shortsBgmPromptBasis, result: shortsBgmPromptResult }).optional(),
});
export const shortsPlanMaterialsInput = materials.refine(input =>
  input.scenes.every((scene, index) => scene.sceneNumber === index + 1), { path: ["scenes"] });

const sceneKey = z.uuidv7();
export const savedShortsPlanMaterials = materials.extend({
  sceneOrder: z.array(sceneKey).min(1).max(maxScenes),
  scenes: z.array(sceneMaterials.extend({ sceneKey })).min(1).max(maxScenes),
}).refine(({ scenes, sceneOrder }) => scenes.length === sceneOrder.length && new Set(sceneOrder).size === sceneOrder.length &&
  scenes.every((scene, index) => scene.sceneKey === sceneOrder[index] && scene.sceneNumber === index + 1), { path: ["scenes"] });

export type ShortsPlanMaterialsInput = z.infer<typeof shortsPlanMaterialsInput>;
export type SavedShortsPlanMaterials = z.infer<typeof savedShortsPlanMaterials>;

type MaterialsConflict = { item: "timeline" | "scene-prompt" | "bgm"; sceneNumber?: number };

/** Match proposals to the edited plan, using their recorded input and the plan's cumulative time. */
export function shortsPlanMaterialsConflict(input: ShortsPlanMaterialsInput, scenes: SceneDraft[], durationSec: number): MaterialsConflict | null {
  const { min, max } = shortsScriptSceneRange(durationSec);
  if (scenes.length < min || scenes.length > max || scenes[0]?.durationSec !== 3) return { item: "timeline" };
  let endSec = 0;
  const spans = scenes.map(scene => {
    const startSec = endSec;
    endSec += scene.durationSec;
    return { startSec, endSec };
  });
  const sameSource = (source: ShortsPlanMaterialsInput["source"]) =>
    source.evidence === input.source.evidence && source.videoId === input.source.videoId;
  const sameSpan = (span: { startSec: number; endSec: number }, sceneNumber: number) => {
    const expected = spans[sceneNumber - 1];
    return expected?.startSec === span.startSec && expected.endSec === span.endSec;
  };

  for (const { sceneNumber, caption, sfx, prompt } of input.scenes) {
    if (!prompt) continue;
    const { basis, result } = prompt;
    const scene = scenes[sceneNumber - 1];
    if (!scene || basis.sceneNumber !== sceneNumber || !sameSpan(basis, sceneNumber) || !sameSource(result.source) ||
      result.generation.sceneNumber !== sceneNumber || result.generation.durationSec !== durationSec ||
      !sameSpan(result.generation, sceneNumber) || basis.narration !== scene.dialogue || basis.visual !== scene.description ||
      basis.caption !== caption || basis.sfx !== sfx) return { item: "scene-prompt", sceneNumber };
  }

  if (input.bgm) {
    const { basis, result } = input.bgm;
    if (!sameSource(result.source) || result.generation.durationSec !== durationSec || basis.cues.some((cue, index) =>
      !sameSpan(cue, cue.sceneNumber) || (index > 0 && cue.sceneNumber <= basis.cues[index - 1].sceneNumber))) return { item: "bgm" };
  }
  return null;
}
