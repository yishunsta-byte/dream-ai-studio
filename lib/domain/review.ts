import { z } from "zod";
import type { Timeline } from "@/lib/edit/timeline";
import type { menuSnapshotSchema } from "@/lib/menus/snapshot";

export const reviewInputSchema=z.strictObject({itemId:z.string().min(1).max(120),status:z.enum(["unchecked","pass","hold"]),note:z.string().trim().max(2000)}).refine(input=>input.status!=="hold"||!!input.note,{message:"보류 사유를 적어 주세요."});
// T-132: a saved timeline that really uses music adds the music-rights item even when the project answer said no
// music, so it can never be skipped. Rights written on the timeline are shown as evidence only; the item stays
// unchecked until a person checks it (no automatic pass).
export const musicClips=(timeline:Timeline|null)=>timeline?.schemaVersion===2?timeline.audio.filter(clip=>clip.role==="music"):[];
export function reviewItems(snapshot: z.infer<typeof menuSnapshotSchema>, inputs: Record<string, unknown>, timeline: Timeline | null) {
  const usesMusic = musicClips(timeline).length > 0;
  return [
    ...snapshot.commonReview.map(item => ({ ...item, source: "common" as const })),
    ...snapshot.menu.review.map(item => ({ ...item, source: "menu" as const })),
    ...snapshot.conditionalReview
      .filter(item => inputs[item.when] === true || (item.when === "usesMusic" && usesMusic))
      .map(item => ({ ...item, source: "conditional" as const })),
  ];
}
