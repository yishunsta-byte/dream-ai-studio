import "server-only";
import Database from "better-sqlite3";
import { z } from "zod";
import type { DatabaseHandle } from "../db/connection";
import { isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { WorkflowError } from "../domain/stages";
import { timelineService } from "../services/timeline";
import { previewReferenceProject } from "./project-preview";

type PreviewRecord = Parameters<typeof previewReferenceProject>[0];
type Scope = Parameters<typeof previewReferenceProject>[2]["scope"];
type TimelineService = ReturnType<typeof timelineService>;

const requestSchema = z.strictObject({
  projectId: z.uuid(),
  sourceId: z.string().min(1).max(128),
  selectionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  expectedRevision: z.number().int().nonnegative(),
  expectedTimelineId: z.uuid(),
  moveSceneId: z.uuid(),
  afterSceneId: z.uuid(),
});

type ApplyRequest = z.infer<typeof requestSchema>;
const confirmationBrand: unique symbol = Symbol("rea-apply-confirmation");
type Confirmation = Readonly<{ [confirmationBrand]: true }>;
type Prepared = { actorId: string; preview: PreviewRecord; request: ApplyRequest };
type Failure = { status: "confirmation_required" | "invalid_request" | "owner_required" | "stale" |
  "selection_unavailable" | "unsupported_proposal" | "timeline_unavailable" | "conflict" | "target_unavailable" | "no_change" };

type Options = {
  /** Server-owned lookup of current project ownership, source access and active analysis revision. */
  resolveOwnedScope: (handle: DatabaseHandle, actor: VerifiedActor, projectId: string, sourceId: string) => Scope | null;
  nowMs: () => number;
  maxAgeMs: number;
};

export function referenceTimelineFailure(error: unknown): Failure {
  if (error instanceof WorkflowError) {
    if (error.code === "CONFLICT") return { status: "conflict" };
    if (error.code === "STAGE_LOCKED" || error.code === "NOT_FOUND") return { status: "timeline_unavailable" };
    if (error.code === "INVALID_TRANSITION") return { status: "target_unavailable" };
  }
  throw error;
}

export function planReferenceSceneMove(
  timelines: TimelineService,
  request: Pick<ApplyRequest, "projectId" | "expectedRevision" | "expectedTimelineId" | "moveSceneId" | "afterSceneId">,
  transition: { type: "cut"; durationFrames: 0 }) {
  const state = timelines.get(request.projectId);
  if (state.project.contentRevision !== request.expectedRevision || state.current?.id !== request.expectedTimelineId || state.stale.length) {
    return { status: "conflict" } as const;
  }
  if (!state.timeline) return { status: "timeline_unavailable" } as const;

  const { timeline } = state;
  const from = timeline.video.findIndex(clip => clip.sceneId === request.moveSceneId);
  const anchor = timeline.video.findIndex(clip => clip.sceneId === request.afterSceneId);
  if (from === -1 || anchor === -1 || from === anchor ||
    !timeline.video[from].assetId || !timeline.video[anchor].assetId) return { status: "target_unavailable" } as const;
  if (from === anchor + 1) return { status: "no_change" } as const;

  const video = [...timeline.video];
  const [clip] = video.splice(from, 1);
  const to = from < anchor ? anchor : anchor + 1;
  video.splice(to, 0, { ...clip, transition });
  return {
    status: "ready",
    timeline: { ...timeline, video },
    change: {
      kind: "move_existing_scene_after" as const, fromPosition: from + 1, toPosition: to + 1, transition,
      fixedTimingTracks: { text: timeline.text.length, audio: timeline.audio.length },
    },
  } as const;
}

/**
 * Server-only adapter. Keep the opaque confirmation in this service instance until the user confirms.
 * The resolver must use current authorized state and return null for revoked or inactive sources.
 */
export function referenceProjectApplyService(handle: DatabaseHandle, options: Options) {
  const timelines = timelineService(handle);
  const confirmations = new WeakMap<Confirmation, Prepared>();

  function currentPlan(actor: VerifiedActor, preview: PreviewRecord, request: ApplyRequest) {
    if (!isVerifiedActor(actor)) return { status: "owner_required" } as const;
    const scope = options.resolveOwnedScope(handle, actor, request.projectId, request.sourceId);
    if (!scope || scope.projectId !== request.projectId || scope.sourceId !== request.sourceId) {
      return { status: "owner_required" } as const;
    }
    const result = previewReferenceProject(preview, actor, { scope, nowMs: options.nowMs(), maxAgeMs: options.maxAgeMs },
      [request.selectionId]);
    if (result.status !== "ready") return { status: result.status };
    const [proposal] = result.proposals;
    if (proposal.media !== "video" || proposal.inference?.measure !== "candidate_cut" ||
      proposal.draft.target !== "cut" || !proposal.draft.transition) {
      return { status: "unsupported_proposal" } as const;
    }
    // Reorder user-selected project scenes. Neither source PTS nor the editing-grid preview determines project placement.
    return planReferenceSceneMove(timelines, request, proposal.draft.transition);
  }

  function prepare(actor: VerifiedActor, preview: PreviewRecord, input: unknown) {
    if (!isVerifiedActor(actor)) return { status: "owner_required" } as const;
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid_request" } as const;
    const request = parsed.data;
    try {
      const plan = handle.sqlite.transaction(() => currentPlan(actor, preview, request)).deferred();
      if (plan.status !== "ready") return plan;
      const confirmation = Object.freeze({ [confirmationBrand]: true as const });
      confirmations.set(confirmation, { actorId: actor.id, preview, request });
      return { status: "ready", confirmation, change: plan.change } as const;
    } catch (error) {
      return referenceTimelineFailure(error);
    }
  }

  function apply(actor: VerifiedActor, confirmation: Confirmation, confirmed: boolean) {
    if (!isVerifiedActor(actor)) return { status: "owner_required" } as const;
    const prepared = confirmations.get(confirmation);
    if (!prepared || confirmed !== true) return { status: "confirmation_required" } as const;
    if (actor.id !== prepared.actorId) return { status: "owner_required" } as const;
    const { request, preview } = prepared;
    const startsOuterTransaction = !handle.sqlite.inTransaction;
    let enteredTransaction = false;
    try {
      return handle.sqlite.transaction(() => {
        enteredTransaction = true;
        const plan = currentPlan(actor, preview, request);
        if (plan.status !== "ready") return plan;
        const saved = timelines.save(request.projectId, request.expectedRevision, request.expectedTimelineId, plan.timeline);
        if (!saved.created) return { status: "no_change" } as const;
        return { status: "applied", revision: saved.revision, timelineId: saved.timelineId, timelineRevision: saved.timelineRevision } as const;
      }).immediate();
    } catch (error) {
      // Only contention while acquiring BEGIN IMMEDIATE proves this attempt never ran the write.
      if (startsOuterTransaction && !enteredTransaction && !handle.sqlite.inTransaction &&
        error instanceof Database.SqliteError && error.code === "SQLITE_BUSY") {
        return { status: "busy", retryable: true } as const;
      }
      return referenceTimelineFailure(error);
    }
  }

  return { prepare, apply };
}
