import { z } from "zod";

export const SHORTS_ANALYSIS_URI = "/api/admin/shorts-analysis";

export const shortsAnalysisAvailabilitySchema = z.strictObject({
  semantic: z.strictObject({ shorts: z.enum(["configured", "not_configured"]) }),
});

const videoId = /^[A-Za-z0-9_-]{11}$/;

export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    let id: string | null = null;
    if (url.hostname === "youtu.be") {
      id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      const ids = url.searchParams.getAll("v");
      if (url.pathname === "/watch" && ids.length === 1) id = ids[0];
      else id = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    }
    return id && videoId.test(id) ? id : null;
  } catch {
    return null;
  }
}

const description = z.string().trim().min(1).max(600);
export const shortsFindingsSchema = z.object({
  summary: description,
  hook: description.nullable(),
  composition: description.nullable(),
  sound: description.nullable(),
  segments: z.array(z.object({
    timestamp: z.string().regex(/^\d{2,3}:[0-5]\d$/),
    evidence: description,
  })).max(12),
  draftPrompt: z.string().trim().min(1).max(1400).nullable(),
});

export const shortsAnalysisResultSchema = z.object({
  evidence: z.literal("youtube_video"),
  findings: shortsFindingsSchema,
});

export type ShortsAnalysisResult = z.infer<typeof shortsAnalysisResultSchema>;
