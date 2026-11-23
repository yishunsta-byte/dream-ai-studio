import { z } from "zod";
import { hasOrderedShortsIdeaBeats, shortsIdeaSelection, shortsIdeaSource } from "./shorts-ideas-contract";
import { youtubeCredentialVersion } from "./youtube-credential-contract";

export const shortsScriptPath = "/api/admin/shorts-script";
export const shortsScriptDurationSec = { min: 10, max: 180 } as const;
export const shortsScriptDuration = z.number().int().min(shortsScriptDurationSec.min).max(shortsScriptDurationSec.max);
const text = (limit: number) => z.string().trim().min(1).max(limit);

export function shortsScriptSceneRange(durationSec: number) {
  const min = Math.max(3, Math.floor(durationSec / 6));
  return { min, max: Math.max(min + 1, Math.ceil(durationSec / 4)) };
}

const maxScenes = shortsScriptSceneRange(shortsScriptDurationSec.max).max;
const second = z.number().int().min(0).max(shortsScriptDurationSec.max);
export const shortsScriptSceneTiming = z.strictObject({
  sceneNumber: z.number().int().min(1).max(maxScenes),
  startSec: second, endSec: second,
});

export function hasPossibleShortsScriptSceneTiming(durationSec: number, { sceneNumber, startSec, endSec }: z.infer<typeof shortsScriptSceneTiming>) {
  const { min, max } = shortsScriptSceneRange(durationSec);
  if (sceneNumber === 1) return startSec === 0 && endSec === 3;
  if (sceneNumber === 2 && startSec !== 3) return false;
  // All preceding scenes need at least one second each, after the three-second first scene.
  return sceneNumber <= max && startSec >= sceneNumber + 1 && startSec < endSec &&
    endSec + Math.max(0, min - sceneNumber) <= durationSec && (sceneNumber < max || endSec === durationSec);
}

export const shortsScriptScene = shortsScriptSceneTiming.extend({
  narration: text(180), visual: text(400), caption: text(120).nullable(), sfx: text(120).nullable(),
});
const scenes = z.array(shortsScriptScene).min(shortsScriptSceneRange(shortsScriptDurationSec.min).min).max(maxScenes);
export const shortsScriptModelOutput = z.strictObject({ scenes });

// 원본 v2.01 generateScriptAction의 수정 요청 재생성: 이전 초안과 수정 요청을 함께 보내 새 초안을 받는다.
// 이전 초안은 자기 길이(previousDurationSec)로 다시 검사한 타임라인만 받는다. 새 길이는 config.durationSec를 따른다.
export const shortsScriptRevision = z.strictObject({
  feedback: text(1000), previousDurationSec: shortsScriptDuration, previousScenes: scenes,
}).refine(({ previousDurationSec, previousScenes }) => hasShortsScriptTimeline(previousDurationSec, previousScenes),
  { path: ["previousScenes"] });
// 45장면 이전 초안(장면당 필드 상한 820자, 한글 3바이트)과 소재·설정을 싣는 본문 상한.
export const shortsScriptBodyByteLimit = 160 * 1024;

export const shortsScriptRequest = z.strictObject({
  authorized: z.literal(true), geminiCredentialVersion: youtubeCredentialVersion,
  source: shortsIdeaSource,
  selectedIdea: shortsIdeaSelection.refine(hasOrderedShortsIdeaBeats, { path: ["beats"] }),
  config: z.strictObject({ durationSec: shortsScriptDuration, tone: text(100), target: text(100).optional(), direction: text(1000).optional() }),
  revision: shortsScriptRevision.optional(),
});
export type ShortsScriptRequest = z.infer<typeof shortsScriptRequest>;

export function hasShortsScriptTimeline(durationSec: number, timeline: z.infer<typeof scenes>) {
  const { min, max } = shortsScriptSceneRange(durationSec);
  return timeline.length >= min && timeline.length <= max && timeline[0]?.endSec === 3 &&
    timeline.at(-1)?.endSec === durationSec && timeline.every((scene, index) =>
      scene.sceneNumber === index + 1 && scene.startSec === (timeline[index - 1]?.endSec ?? 0) && scene.endSec > scene.startSec);
}

export const shortsScriptResult = z.strictObject({
  schemaVersion: z.literal(1), geminiCredentialVersion: youtubeCredentialVersion, source: shortsIdeaSource,
  generation: z.strictObject({ kind: z.literal("creative_script_draft"), durationSec: shortsScriptDuration, scenes }),
}).refine(({ generation }) => hasShortsScriptTimeline(generation.durationSec, generation.scenes), { path: ["generation", "scenes"] });

export type ShortsScriptResult = z.infer<typeof shortsScriptResult>;
