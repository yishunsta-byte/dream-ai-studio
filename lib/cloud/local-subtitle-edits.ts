import { z } from "zod";
import { requiredDisclosures } from "../edit/schema";
import { newTextLayer } from "../edit/text-ops";
import { canonicalJson, MAX_FRAMES, type Timeline, type TimelineText } from "../edit/timeline";

const subtitleSchema = z.strictObject({
  id: z.uuidv7(),
  content: z.string().max(500).refine(text => text.trim().length > 0 && !text.includes("\u0000") &&
    Buffer.from(text).toString("utf8") === text),
  startFrame: z.number().int().min(0).max(MAX_FRAMES),
  endFrame: z.number().int().min(1).max(MAX_FRAMES),
}).refine(item => item.startFrame < item.endFrame);

export const subtitlesSchema = z.array(subtitleSchema).max(100).refine(
  items => new Set(items.map(item => item.id)).size === items.length,
);
type Subtitle = z.infer<typeof subtitleSchema>;
const editable = (layer: TimelineText) => layer.kind === "subtitle" && !layer.locked;

export function subtitleItems(timeline: Timeline) {
  return timeline.text.filter(editable).map(({ id, content, timing }) => ({ id, content, ...timing }));
}

export function applySubtitles(timeline: Timeline, subtitles: Subtitle[], inputs: Record<string, unknown>,
  plannedFrames: number, videoFrames: number, maxEndFrame: number): { code: string } | { timeline: Timeline } {
  const before = new Map(timeline.text.map(layer => [layer.id, layer]));
  const changes = new Map<string, TimelineText>();
  for (const { id, content, startFrame, endFrame } of subtitles) {
    const previous = before.get(id);
    if (previous && !editable(previous)) return { code: "PROTECTED_TEXT_LAYER" };
    const timing = { startFrame, endFrame };
    const next = previous
      ? { ...previous, content: previous.content === content ? content : content.trim(), timing }
      : { ...newTextLayer("subtitle", { startFrame, videoFrames, plannedFrames, content: content.trim() }), id, timing };
    if (endFrame > maxEndFrame && (!previous || canonicalJson(previous) !== canonicalJson(next))) {
      return { code: "SUBTITLE_TIME_EXCEEDED" };
    }
    changes.set(id, next);
  }

  const text = timeline.text.flatMap(layer => {
    if (!editable(layer)) return [layer];
    const replacement = changes.get(layer.id);
    changes.delete(layer.id);
    return replacement ? [replacement] : [];
  });
  text.push(...changes.values());

  for (const [stack, content] of requiredDisclosures(inputs).entries()) {
    const existing = text.filter(layer => layer.kind === "disclosure" && layer.content === content);
    if (existing.length > 1 || (existing.length === 1 && !existing[0].locked)) {
      return { code: "REQUIRED_DISCLOSURE_INVALID" };
    }
    if (!existing.length) {
      text.push(newTextLayer("disclosure", { startFrame: 0, videoFrames, plannedFrames, content, stack }));
    }
  }
  return { timeline: { ...timeline, text } };
}
