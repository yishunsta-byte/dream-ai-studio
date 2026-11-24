import "server-only";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, realpath, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { resolveServerAuth } from "../auth/resolve";
import type { VerifiedActor } from "../db/postgres/types";
import { privateStorageConfig, type PrivateStorageOptions } from "../storage/supabase/config";
import { ownedStorageAsset, storageFormats, type OwnedStorageAsset } from "../storage/supabase/object-key";
import { createPrivateObjectReader } from "../storage/supabase/reader";
import { referenceFileByteLimit } from "./input";
import { analyzeStudioReference } from "./studio-analysis-contract";

type Selection = Readonly<{ projectId: string; assetId: string }>;
type Options = {
  storage: PrivateStorageOptions & { profile: "synthetic" };
  resolveAuth: typeof resolveServerAuth;
  /** One snapshot of the active link, T281 grants and current verified registration. Honor the request signal. */
  readAuthority: (actor: VerifiedActor, selection: Selection, signal: AbortSignal) => Promise<unknown>;
  /** Isolated, cancellable byte source. Its stream must match the private reader and registration. */
  openBytes: (actor: VerifiedActor, asset: OwnedStorageAsset, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
};

const id = z.guid();
const token = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const generation = z.string().refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);
const positiveGeneration = generation.refine(value => value !== "0");
const authoritySchema = z.strictObject({
  status: z.literal("authorized"), ownerId: id, projectId: id, assetId: id,
  linkActive: z.literal(true), ownerEnabled: z.literal(true), scopeEnabled: z.literal(true),
  storeId: token, restoreGeneration: token, linkGeneration: generation,
  scopePermissionGeneration: positiveGeneration, ownerPermissionGeneration: positiveGeneration,
  sourceGeneration: token, storageGeneration: positiveGeneration, verifiedStorageGeneration: positiveGeneration,
  asset: z.unknown(),
});

type Result = Awaited<ReturnType<typeof analyzeStudioReference>>;
function unavailable(reason: "source_unavailable" | "cancelled" | "timed_out"): Result {
  return { schemaVersion: 1, status: "unavailable", reason };
}

async function materialize(bytes: ReadableStream<Uint8Array>, asset: OwnedStorageAsset, path: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  let size = 0;
  const verify = new Transform({ transform(chunk: Uint8Array, _encoding, done) {
    size += chunk.byteLength;
    if (size > asset.sizeBytes) return done(new Error("STUDIO_SOURCE_SIZE"));
    hash.update(chunk);
    done(null, chunk);
  } });
  await pipeline(bytes, verify, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
  if (size !== asset.sizeBytes || hash.digest("hex") !== asset.sha256) throw new Error("STUDIO_SOURCE_INTEGRITY");
}

async function cleanup(work: string, path?: string) {
  if (await realpath(work) !== work) throw new Error("STUDIO_SOURCE_TEMP");
  if (path) await rm(path, { force: true });
  await rmdir(work);
}

async function resolveAuthWithinRequest(resolveAuth: typeof resolveServerAuth, signal: AbortSignal) {
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => aborted.reject(signal.reason));
  try {
    // Auth may lack a cancellation API. Observe both settlements and abandon only this request's wait.
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return resolveAuth();
    });
    const result = await Promise.race([pending, aborted.promise]);
    signal.throwIfAborted();
    return result;
  } finally {
    listener[Symbol.dispose]();
  }
}

/** Isolated integration only. A synthetic profile can connect the existing reader only to loopback. */
export function createIsolatedStudioAnalysis({ storage, resolveAuth, readAuthority, openBytes }: Options) {
  const config = privateStorageConfig(storage);
  if (config.profile !== "synthetic") throw new Error("STUDIO_SOURCE_ISOLATION_REQUIRED");
  const maxBytes = Math.min(referenceFileByteLimit, config.maxBytes);
  let active = 0;

  return async (input: unknown, callerSignal?: AbortSignal): Promise<Result> => {
    if (callerSignal?.aborted) return unavailable("cancelled");
    if (active >= config.maxConcurrent) return unavailable("source_unavailable");
    active++;
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    const resolveRequestAuth = () => resolveAuthWithinRequest(resolveAuth, signal);

    async function observe(actor: VerifiedActor, selection: Selection) {
      signal.throwIfAborted();
      const parsed = authoritySchema.safeParse(await readAuthority(actor, selection, signal));
      signal.throwIfAborted();
      if (!parsed.success) return;
      const { asset: inputAsset, ...scope } = parsed.data;
      if (scope.ownerId !== actor.id || scope.projectId !== selection.projectId || scope.assetId !== selection.assetId ||
        scope.storageGeneration !== scope.verifiedStorageGeneration) return;
      const asset = ownedStorageAsset(actor, inputAsset, maxBytes);
      if (asset.id !== scope.assetId) return;
      return { scope, asset };
    }

    async function run() {
      let work: string | undefined;
      let path: string | undefined;
      let staged: { identity: string; source: object } | undefined;
      try {
        return await analyzeStudioReference(input, { resolveAuth: resolveRequestAuth, signal, async resolveRegisteredSource(actor, selection) {
          const observed = await observe(actor, selection);
          if (!observed) return;
          const identity = JSON.stringify(observed);
          if (staged) return staged.identity === identity ? staged.source : undefined;
          const { scope, asset } = observed;
          const root = await realpath(config.workRoot);
          const reader = createPrivateObjectReader({ ...config, workRoot: root });
          const verified = await reader.verify(actor, asset, signal);
          if (verified.sha256 !== asset.sha256 || verified.sizeBytes !== asset.sizeBytes ||
            verified.mime !== asset.mime || verified.kind !== asset.kind) return;

          signal.throwIfAborted();
          work = await mkdtemp(join(root, "dream-studio-source-"));
          const name = `reference.${storageFormats[asset.mime].extension}`;
          path = join(work, name);
          signal.throwIfAborted();
          await materialize(await openBytes(actor, asset, signal), asset, path, signal);
          signal.throwIfAborted();
          const auth = await resolveRequestAuth();
          if (auth?.kind !== "verified" || !auth.email || auth.userId.toLowerCase() !== actor.id) return;
          const current = await observe(actor, selection);
          if (!current || JSON.stringify(current) !== identity) return;

          const sourceGeneration = createHash("sha256").update(JSON.stringify([scope.sourceGeneration, scope.storageGeneration])).digest("hex");
          const source = {
            status: "authorized", ownerId: scope.ownerId, projectId: scope.projectId, assetId: scope.assetId,
            storeId: scope.storeId, restoreGeneration: scope.restoreGeneration, linkGeneration: scope.linkGeneration,
            scopePermissionGeneration: scope.scopePermissionGeneration, ownerPermissionGeneration: scope.ownerPermissionGeneration,
            sourceGeneration, sha256: asset.sha256, sizeBytes: asset.sizeBytes, mime: asset.mime, name, path, managedRoot: work,
          };
          staged = { identity, source };
          return source;
        } });
      } finally {
        // Remove only this request's file and directory. Never recursively delete the work root.
        if (work) await cleanup(work, path);
      }
    }

    try {
      const result = await run();
      if (callerSignal?.aborted) return unavailable("cancelled");
      return deadline.aborted ? unavailable("timed_out") : result;
    } catch {
      return unavailable(callerSignal?.aborted ? "cancelled" : deadline.aborted ? "timed_out" : "source_unavailable");
    } finally { active--; }
  };
}
