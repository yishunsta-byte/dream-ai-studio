import "server-only";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { dirname } from "node:path";
import { z } from "zod";
import type { ServerAuthResult } from "../auth/resolve";
import { actorFromVerifiedUserId, isVerifiedActor, type VerifiedActor } from "../db/postgres/types";
import { privateStorageConfig, type PrivateStorageOptions } from "../storage/supabase/config";
import { StorageReadError } from "../storage/supabase/errors";
import { ownedStorageAsset, storageFormats } from "../storage/supabase/object-key";
import { createPrivateObjectReader } from "../storage/supabase/reader";
import { referenceFileByteLimit } from "./input";
import { analyzeStudioReference } from "./studio-analysis-contract";

const id = z.guid().transform(value => value.toLowerCase());
const selectionSchema = z.strictObject({ projectId: id, assetId: id });
const token = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const generation = z.string().refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);
const positiveGeneration = generation.refine(value => value !== "0");
const authoritySchema = z.strictObject({
  status: z.literal("authorized"), ownerId: id, ...selectionSchema.shape,
  linkActive: z.literal(true), ownerEnabled: z.literal(true), scopeEnabled: z.literal(true),
  storeId: token, restoreGeneration: token, linkGeneration: generation,
  ownerPermissionGeneration: positiveGeneration, scopePermissionGeneration: positiveGeneration,
  sourceGeneration: token, storageGeneration: positiveGeneration, verifiedStorageGeneration: positiveGeneration,
  asset: z.unknown(),
});

type Selection = Readonly<z.infer<typeof selectionSchema>>;
type Result = Awaited<ReturnType<typeof analyzeStudioReference>>;
type Failure = Extract<Result, { status: "unavailable" }>["reason"];
type Analyze = (input: unknown, callerSignal?: AbortSignal, requestActor?: VerifiedActor) => Promise<Result>;

type Options = Readonly<{
  storage: PrivateStorageOptions & { profile: "synthetic" };
  resolveAuth: (signal: AbortSignal) => Promise<ServerAuthResult>;
  /** Read the current ownership and registration proof together. The source is server-owned. */
  readAuthority: (actor: VerifiedActor, selection: Selection, signal: AbortSignal) => Promise<unknown>;
}>;

const unavailable = (reason: Failure): Result => ({ schemaVersion: 1, status: "unavailable", reason });

async function whileActive<T>(signal: AbortSignal, run: () => Promise<T>) {
  signal.throwIfAborted();
  const stopped = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => stopped.reject(signal.reason));
  try {
    const result = await Promise.race([stopped.promise, Promise.resolve().then(() => { signal.throwIfAborted(); return run(); })]);
    signal.throwIfAborted();
    return result;
  } finally { listener[Symbol.dispose](); }
}

/** Only the owned synthetic loopback profile can supply this operation. The path never leaves the reader callback. */
export function createIsolatedVerifiedStorageAnalysis({ storage, resolveAuth, readAuthority }: Options): Analyze {
  const config = privateStorageConfig(storage);
  if (config.profile !== "synthetic") return async () => unavailable("source_unavailable");
  const reader = createPrivateObjectReader(config);
  const maxBytes = Math.min(referenceFileByteLimit, config.maxBytes);
  let active = 0;

  async function currentAuth(signal: AbortSignal) {
    return whileActive(signal, () => resolveAuth(signal));
  }

  async function observe(actor: VerifiedActor, selection: Selection, signal: AbortSignal) {
    const parsed = authoritySchema.safeParse(await whileActive(signal, () => readAuthority(actor, selection, signal)));
    if (!parsed.success) return;
    const { asset: input, ...scope } = parsed.data;
    if (scope.ownerId !== actor.id || scope.projectId !== selection.projectId || scope.assetId !== selection.assetId ||
      scope.storageGeneration !== scope.verifiedStorageGeneration) return;
    const asset = ownedStorageAsset(actor, input, maxBytes);
    if (asset.id !== scope.assetId) return;
    return { scope, asset };
  }

  return async (input, callerSignal, requestActor) => {
    const selected = selectionSchema.safeParse(input);
    if (!selected.success) return unavailable("invalid_selection");
    let deadline: AbortSignal;
    let signal: AbortSignal;
    try {
      if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) return unavailable("source_unavailable");
      if (callerSignal?.aborted) return unavailable("cancelled");
      deadline = AbortSignal.timeout(config.timeoutMs);
      signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    } catch { return unavailable("source_unavailable"); }

    if (active >= config.maxConcurrent) return unavailable("source_unavailable");
    active++;
    try {
      const auth = await currentAuth(signal);
      if (auth?.kind !== "verified" || !auth.email) return unavailable("source_unavailable");
      const actor = actorFromVerifiedUserId(auth.userId);
      if (requestActor !== undefined && (!isVerifiedActor(requestActor) || requestActor.id !== actor.id)) {
        return unavailable("source_unavailable");
      }
      const registration = await observe(actor, selected.data, signal);
      if (!registration) return unavailable("source_unavailable");
      const registeredIdentity = JSON.stringify(registration);
      const { scope, asset } = registration;
      const sourceGeneration = createHash("sha256").update(JSON.stringify([scope.sourceGeneration, scope.storageGeneration])).digest("hex");
      const analyzed: { value?: Result } = {};

      await reader.useVerifiedFile(actor, asset, async file => {
        const { metadata } = file;
        if (metadata.sha256 !== asset.sha256 || metadata.sizeBytes !== asset.sizeBytes ||
          metadata.kind !== asset.kind || metadata.mime !== asset.mime) return;
        const leaseSignal = AbortSignal.any([signal, file.signal]);
        const value = await analyzeStudioReference(selected.data, {
          signal: leaseSignal,
          resolveAuth: () => currentAuth(leaseSignal),
          async resolveRegisteredSource(viewer, selection) {
            if (viewer.id !== actor.id) return;
            const current = await observe(viewer, selection, leaseSignal);
            if (!current || JSON.stringify(current) !== registeredIdentity) return;
            const path = file.path;
            return {
              status: "authorized", ownerId: scope.ownerId, projectId: scope.projectId, assetId: scope.assetId,
              storeId: scope.storeId, restoreGeneration: scope.restoreGeneration, linkGeneration: scope.linkGeneration,
              ownerPermissionGeneration: scope.ownerPermissionGeneration, scopePermissionGeneration: scope.scopePermissionGeneration,
              sourceGeneration, sha256: metadata.sha256, sizeBytes: metadata.sizeBytes, mime: metadata.mime,
              name: `reference.${storageFormats[metadata.mime].extension}`, path, managedRoot: dirname(path),
            };
          },
        });
        leaseSignal.throwIfAborted();
        analyzed.value = value;
      }, signal);

      signal.throwIfAborted();
      if (analyzed.value?.status !== "ready") return analyzed.value ?? unavailable("source_unavailable");
      const current = await currentAuth(signal);
      if (current?.kind !== "verified" || !current.email || actorFromVerifiedUserId(current.userId).id !== actor.id) {
        return unavailable("source_unavailable");
      }
      const latest = await observe(actor, selected.data, signal);
      signal.throwIfAborted();
      return latest && JSON.stringify(latest) === registeredIdentity ? analyzed.value : unavailable("source_unavailable");
    } catch (error) {
      if (callerSignal?.aborted) return unavailable("cancelled");
      if (deadline.aborted || (error instanceof StorageReadError && error.code === "STORAGE_TIMEOUT")) return unavailable("timed_out");
      return unavailable("source_unavailable");
    } finally { active--; }
  };
}
