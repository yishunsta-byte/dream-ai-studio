import { z } from "zod";
import { youtubeCredentialVersion } from "./youtube-credential-contract";
import { youtubeVideoIdSchema } from "./youtube-shorts-search-contract";

export const shortsMetadataPath = "/api/admin/shorts-metadata-analysis";
export const shortsMetadataCommentLimit = 8;
export const shortsMetadataRequest = z.strictObject({
  videoId: youtubeVideoIdSchema, authorized: z.literal(true),
  youtubeCredentialVersion, geminiCredentialVersion: youtubeCredentialVersion,
});

const metric = z.number().int().nonnegative().nullable();
const text = (limit: number) => z.string().trim().min(1).max(limit);
const sample = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("sampled"), count: z.number().int().min(1).max(shortsMetadataCommentLimit) }),
  z.strictObject({ status: z.literal("empty"), count: z.literal(0) }),
  z.strictObject({ status: z.literal("unavailable"), count: z.null() }),
]);
export const shortsMetadataPublic = z.strictObject({
  videoId: youtubeVideoIdSchema,
  title: text(300), channelTitle: text(200), publishedAt: z.iso.datetime({ offset: true }),
  descriptionAvailable: z.boolean(), durationSeconds: metric,
  metrics: z.strictObject({ views: metric, likes: metric, comments: metric }),
  commentSample: sample,
});
export type ShortsMetadataPublic = z.infer<typeof shortsMetadataPublic>;

export const shortsMetadataEvidence = z.enum(["title", "description", "public_metrics", "comment_sample"]);
export type ShortsMetadataEvidence = z.infer<typeof shortsMetadataEvidence>;
const observation = z.strictObject({
  text: text(520), basedOn: z.array(shortsMetadataEvidence).min(1).max(4),
});
export const shortsMetadataInference = z.strictObject({
  summary: observation,
  topics: z.array(observation).max(6),
  productionHypotheses: z.array(observation).max(5),
});
export type ShortsMetadataInference = z.infer<typeof shortsMetadataInference>;

export const shortsMetadataResult = z.strictObject({
  schemaVersion: z.literal(1), evidence: z.literal("youtube_metadata"),
  youtubeCredentialVersion, geminiCredentialVersion: youtubeCredentialVersion,
  publicData: shortsMetadataPublic,
  inference: shortsMetadataInference.extend({ kind: z.literal("model_inference") }),
});
