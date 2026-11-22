import { z } from "zod";
import { youtubeCredentialVersion } from "./youtube-credential-contract";

export const youtubeShortsSearchPath = "/api/admin/shorts-search";
export const youtubeShortsSearchLimit = 50;
export const youtubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const youtubeChannelIdSchema = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
export const youtubeShortsSearchRequest = z.strictObject({
  query: z.string().trim().min(1).max(100).refine(value => [...value].every(character => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  })),
  order: z.enum(["relevance", "viewCount", "date"]),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  credentialVersion: youtubeCredentialVersion,
}).refine(({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo);
export type YouTubeShortsSearchRequest = z.infer<typeof youtubeShortsSearchRequest>;

const metric = z.number().int().nonnegative().nullable();
export const youtubeShortCandidate = z.strictObject({
  id: youtubeVideoIdSchema,
  url: z.url(),
  title: z.string().min(1).max(300),
  channelId: youtubeChannelIdSchema,
  channelTitle: z.string().min(1).max(200),
  thumbnailUrl: z.url().nullable(),
  publishedAt: z.iso.datetime({ offset: true }),
  durationSeconds: metric,
  views: metric,
  likes: metric,
  comments: metric,
  subscribers: metric,
});
export type YouTubeShortCandidate = z.infer<typeof youtubeShortCandidate>;
export const youtubeShortsSearchResult = z.strictObject({
  schemaVersion: z.literal(1),
  evidence: z.literal("youtube_metadata"),
  credentialVersion: youtubeCredentialVersion,
  items: z.array(youtubeShortCandidate).max(youtubeShortsSearchLimit),
});
