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

// P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-API: 원본처럼 영상 최대 3개를 한 번에 분석한다.
// 요청이 {urls}일 때만 이 모양을 쓴다. 기존 {url} 요청의 응답은 위 모양 그대로다.
// 이 모양은 위 shortsAnalysisResultSchema로 읽어도 통과한다(videoIds·video 키만 빠짐).
export const shortsAnalysisMaxVideos = 3;
export const shortsMultiFindingsSchema = shortsFindingsSchema.extend({
  segments: z.array(z.object({
    video: z.number().int().min(1).max(shortsAnalysisMaxVideos),
    timestamp: z.string().regex(/^\d{2,3}:[0-5]\d$/),
    evidence: description,
  })).max(12),
});

export const shortsMultiAnalysisResultSchema = z.object({
  evidence: z.literal("youtube_video"),
  videoIds: z.array(z.string().regex(videoId)).min(1).max(shortsAnalysisMaxVideos),
  findings: shortsMultiFindingsSchema,
}).refine(({ videoIds, findings }) => new Set(videoIds).size === videoIds.length
  && findings.segments.every(segment => segment.video <= videoIds.length));

export type ShortsMultiAnalysisResult = z.infer<typeof shortsMultiAnalysisResultSchema>;
