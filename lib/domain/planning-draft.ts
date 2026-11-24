import { z } from "zod";

export const sceneDraftSchema = z.strictObject({
  sceneId: z.uuidv7().optional(),
  stepId: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  dialogue: z.string().trim().max(4000),
  durationSec: z.number().int().min(1).max(600),
  characterIds: z.array(z.uuidv7()).max(20),
  assetIds: z.array(z.uuidv7()).max(30),
});

export const planningInputSchema = z.strictObject({
  script: z.string().trim().min(1).max(20000),
  scenes: z.array(sceneDraftSchema).min(1).max(100),
}).refine(input => input.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) <= 7200,
  { message: "전체 기획 길이는 7,200초 이하여야 해요." });

export type SceneDraft = z.infer<typeof sceneDraftSchema>;
