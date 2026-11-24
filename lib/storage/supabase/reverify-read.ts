import "server-only";
import type { VerifiedActor } from "@/lib/db/postgres/types";
import { requireProtocol as need } from "@/lib/storage/uploads/schema";
import { checkedModel } from "@/lib/storage/uploads/state";
import { StorageReadError, type StorageReadCode } from "./errors";
import type { RegisteredSourceObservation, RegisteredSourceObserver } from "./reader";

// Internal read preparation for a pending registered-object reverify (no worker loop, writes or DB here).
// The registered source comes from the server-checked upload model; the reader verifies it is its configured bucket,
// the owner-checked canonical key and carries no provider version before any request, and returns the source it read
// with the measurement of that one download. The result's `read` is exactly reverifyCommand's request.read.
export type ReverifyRead = Readonly<{
  read: Readonly<{ status: "observed" } & RegisteredSourceObservation> | Readonly<{ status: "unavailable" }>;
  // Why a retry is needed (never a receipt or a permanent failure): storage 404 or a transient read failure.
  transientCode: StorageReadCode | null;
}>;
// A missing object or a failed transfer proves nothing about the registered bytes; configuration, authorization,
// privacy, input, size-bound and caller-abort errors are not retried here and are rethrown to the caller.
const transient: ReadonlySet<StorageReadCode> = new Set(["STORAGE_NOT_FOUND", "STORAGE_UNAVAILABLE", "STORAGE_TIMEOUT", "STORAGE_INTEGRITY", "STORAGE_TEMP"]);

export async function prepareReverifyRead(reader: RegisteredSourceObserver, actor: VerifiedActor, model: unknown, operationId: unknown,
  signal?: AbortSignal): Promise<ReverifyRead> {
  const s = checkedModel(model), o = s.operations.find(x => x.id === operationId);
  // Only a pending reverify of a registered object is read; an ended operation is answered by reverifyCommand without a read.
  need(o && o.kind === "reverify" && o.status === "pending" && s.lifecycle === "registered" && s.identity, "STATE");
  const identity = s.identity;
  const input = { asset: { ownerId: identity.ownerId, id: identity.assetId, kind: identity.kind, mime: identity.mime, objectKey: identity.key,
    sha256: identity.sha256, sizeBytes: identity.sizeBytes }, source: { bucket: identity.bucket, key: identity.key, providerVersion: identity.providerVersion } };
  try {
    const observed = await reader.observeRegisteredSource(actor, input, signal);
    return Object.freeze({ read: Object.freeze({ status: "observed" as const, ...observed }), transientCode: null });
  } catch (error) {
    if (error instanceof StorageReadError && transient.has(error.code))
      return Object.freeze({ read: Object.freeze({ status: "unavailable" as const }), transientCode: error.code });
    throw error;
  }
}
