import { z } from "zod";
import { youtubeCredentialVersion } from "./youtube-credential-contract";
import { youtubeVideoIdSchema } from "./youtube-shorts-search-contract";

export const shortsIdeasPath = "/api/admin/shorts-ideas";
export const shortsIdeaCount = 6;
const text = (limit: number) => z.string().trim().min(1).max(limit);
const sourceIdentity = { videoId: youtubeVideoIdSchema, summary: text(520) };
const shortlist = z.array(text(240)).max(3);

export const shortsIdeasContext = z.discriminatedUnion("evidence", [
  z.strictObject({
    ...sourceIdentity, evidence: z.literal("youtube_video"),
    hook: text(240).nullable().optional(), composition: text(240).nullable().optional(), observations: shortlist,
  }),
  z.strictObject({
    ...sourceIdentity, evidence: z.literal("youtube_metadata"),
    topics: shortlist, productionHypotheses: shortlist,
  }),
]);
export const shortsIdeasRequest = z.strictObject({
  keyword: text(100), context: shortsIdeasContext, authorized: z.literal(true),
  geminiCredentialVersion: youtubeCredentialVersion,
});
export type ShortsIdeasRequest = z.infer<typeof shortsIdeasRequest>;

export const shortsIdeaPhases = ["opening", "setup", "development", "payoff"] as const;
const modelAssessment = z.strictObject({
  rationale: text(280),
  potentialScore: z.number().int().min(0).max(100).nullable(),
  expectedRetentionPercent: z.number().min(0).max(100).nullable(),
});
export const shortsIdeaSelection = z.strictObject({
  title: text(100), openingHook: text(220), hookStrategy: text(280),
  beats: z.array(z.strictObject({ phase: z.enum(shortsIdeaPhases), action: text(320) })).length(shortsIdeaPhases.length),
});
export const hasOrderedShortsIdeaBeats = ({ beats }: z.infer<typeof shortsIdeaSelection>) =>
  beats.every((beat, index) => beat.phase === shortsIdeaPhases[index]);

const idea = shortsIdeaSelection.extend({
  selectionReason: text(320),
  assessment: modelAssessment.nullable(),
});

export const shortsIdeasModelOutput = z.strictObject({ ideas: z.array(idea).length(shortsIdeaCount) });
export type ShortsIdeasModelOutput = z.infer<typeof shortsIdeasModelOutput>;

export const shortsIdeaSource = z.strictObject({
  evidence: z.enum(["youtube_video", "youtube_metadata"]), videoId: youtubeVideoIdSchema, provenance: z.literal("client_supplied"),
});

export const shortsIdeasResult = z.strictObject({
  schemaVersion: z.literal(1), geminiCredentialVersion: youtubeCredentialVersion,
  source: shortsIdeaSource,
  generation: z.strictObject({
    kind: z.literal("creative_suggestions"),
    ideas: z.array(idea.extend({ assessment: modelAssessment.extend({ kind: z.literal("model_estimate") }).nullable() }))
      .length(shortsIdeaCount),
  }),
});
