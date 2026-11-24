import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveServerAuth } from "../auth/resolve";
import { actorFromVerifiedUserId, type VerifiedActor } from "../db/postgres/types";
import { classifyReferenceInput } from "./input";
import { registeredReferenceSnapshotSchema } from "./local-file";
import { createPrivateReferencePreviewRecord, previewReferenceProject } from "./project-preview";
import { analyzeRegisteredReferenceSnapshot } from "./registered-snapshot";

const id = z.guid().transform(value => value.toLowerCase());
const selectionSchema = z.strictObject({ projectId: id, assetId: id });
const generation = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const authorizedSource = z.strictObject({
  status: z.literal("authorized"), ownerId: id, ...selectionSchema.shape,
  storeId: generation, restoreGeneration: generation, linkGeneration: generation,
  scopePermissionGeneration: generation, ownerPermissionGeneration: generation,
  ...registeredReferenceSnapshotSchema.shape,
  path: z.string().min(1), managedRoot: z.string().min(1),
  name: z.string(), mime: z.string().min(1), sizeBytes: z.number().int().positive(),
});
type Selection = Readonly<z.infer<typeof selectionSchema>>;
type Source = z.infer<typeof authorizedSource>;
type Preview = ReturnType<typeof previewReferenceProject>;
type Proposal = Extract<Preview, { status: "ready" }>["proposals"][number];

type Options = {
  /** Server-owned resolver. Issue authorization only for an active link, current grants and verified decoder input. */
  resolveRegisteredSource: (actor: VerifiedActor, selection: Selection, signal?: AbortSignal) => Promise<unknown>;
  resolveAuth?: typeof resolveServerAuth;
  signal?: AbortSignal;
};

type Result =
  | { schemaVersion: 1; status: "ready"; media: Proposal["media"]; proposals: Proposal[] }
  | { schemaVersion: 1; status: "unavailable"; reason: "invalid_selection" | "source_unavailable" |
      "analysis_unavailable" | "cancelled" | "timed_out" };

function unavailable(reason: Extract<Result, { status: "unavailable" }>["reason"]): Result {
  return { schemaVersion: 1, status: "unavailable", reason };
}

async function verifiedActor(resolveAuth: typeof resolveServerAuth) {
  const auth = await resolveAuth();
  if (auth?.kind === "verified" && auth.email) return actorFromVerifiedUserId(auth.userId);
}

async function resolveSource(options: Options, actor: VerifiedActor, selection: Selection) {
  const parsed = authorizedSource.safeParse(await options.resolveRegisteredSource(actor, selection, options.signal));
  if (parsed.success && parsed.data.ownerId === actor.id && parsed.data.projectId === selection.projectId &&
    parsed.data.assetId === selection.assetId) return parsed.data;
}

function sameSource(before: Source, after: Source) {
  // The strict schema emits primitive fields in a fixed order. Compare the complete authorization and file identity.
  return JSON.stringify(before) === JSON.stringify(after);
}

/** Owner-only, read-only orchestration. The caller supplies a trusted registration adapter, never request data. */
export async function analyzeStudioReference(input: unknown, options: Options): Promise<Result> {
  const selection = selectionSchema.safeParse(input);
  if (!selection.success) return unavailable("invalid_selection");
  const { signal, resolveAuth = resolveServerAuth } = options;
  if (signal?.aborted) return unavailable("cancelled");

  try {
    const actor = await verifiedActor(resolveAuth);
    if (signal?.aborted) return unavailable("cancelled");
    if (!actor) return unavailable("source_unavailable");
    const source = await resolveSource(options, actor, selection.data);
    if (signal?.aborted) return unavailable("cancelled");
    if (!source) return unavailable("source_unavailable");

    const submission = { kind: "file", permission: "authorized", name: source.name, mime: source.mime, sizeBytes: source.sizeBytes };
    const classified = classifyReferenceInput(submission);
    if (classified.status !== "ready" || classified.source.kind !== "file") return unavailable("source_unavailable");
    const registration = { sha256: source.sha256, sourceGeneration: source.sourceGeneration };
    const analyzed = await analyzeRegisteredReferenceSnapshot(source.path, submission, registration,
      { managedRoot: source.managedRoot, signal }).catch(() => null);
    if (signal?.aborted) return unavailable("cancelled");
    if (!analyzed) return unavailable("analysis_unavailable");
    if (analyzed.status !== "bound") {
      return unavailable(analyzed.reason === "cancelled" || analyzed.reason === "timed_out" ? analyzed.reason : "analysis_unavailable");
    }
    if (analyzed.proof.snapshotSha256 !== source.sha256 || analyzed.proof.sourceGeneration !== source.sourceGeneration ||
      analyzed.analysis.media !== classified.source.media) return unavailable("analysis_unavailable");

    const currentActor = await verifiedActor(resolveAuth);
    if (signal?.aborted) return unavailable("cancelled");
    if (currentActor?.id !== actor.id) return unavailable("source_unavailable");
    const current = await resolveSource(options, currentActor, selection.data);
    if (signal?.aborted) return unavailable("cancelled");
    if (!current || !sameSource(source, current)) return unavailable("source_unavailable");

    const scope = { projectId: source.projectId, sourceId: source.assetId,
      sourceRevision: source.sourceGeneration, analysisRevision: randomUUID() };
    const nowMs = Date.now();
    const record = createPrivateReferencePreviewRecord(actor, scope, nowMs, analyzed.analysis);
    const context = { scope, nowMs, maxAgeMs: 0 };
    const proposals: Proposal[] = [];
    for (const finding of analyzed.analysis.inspection.findings) {
      if (finding.kind !== "observation" && finding.kind !== "inference") continue;
      const preview = previewReferenceProject(record, actor, context, [finding.id]);
      if (preview.status === "ready") proposals.push(...preview.proposals);
    }
    return proposals.length ? { schemaVersion: 1, status: "ready", media: analyzed.analysis.media, proposals }
      : unavailable("analysis_unavailable");
  } catch {
    return unavailable(signal?.aborted ? "cancelled" : "source_unavailable");
  }
}
