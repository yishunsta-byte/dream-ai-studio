import "server-only";
import { z } from "zod";
import { isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";
import { StorageReadError } from "./errors";
export const storageFormats = Object.freeze({
  "image/png": { kind: "image", extension: "png" }, "image/jpeg": { kind: "image", extension: "jpg" }, "image/webp": { kind: "image", extension: "webp" },
  "video/mp4": { kind: "video", extension: "mp4" }, "video/quicktime": { kind: "video", extension: "mov" }, "video/webm": { kind: "video", extension: "webm" },
} as const);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const schema = z.strictObject({ ownerId: uuid, id: z.uuidv7().refine(v => v === v.toLowerCase()), kind: z.enum(["image", "video"]),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "video/webm"]),
  objectKey: z.string().max(256), sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().safe() });
export type OwnedStorageAsset = Readonly<z.infer<typeof schema>>;
export function privateObjectKey(input: Pick<OwnedStorageAsset, "ownerId" | "id" | "sha256" | "mime">) {
  if (!uuid.safeParse(input.ownerId).success || !z.uuidv7().safeParse(input.id).success || input.id !== input.id.toLowerCase() ||
    !/^[a-f0-9]{64}$/.test(input.sha256) || !Object.hasOwn(storageFormats, input.mime)) throw new StorageReadError("STORAGE_INPUT");
  return `${input.ownerId}/assets/${input.id}/${input.sha256}.${storageFormats[input.mime].extension}`;
}
export function ownedStorageAsset(actor: VerifiedActor, input: unknown, maxBytes: number): OwnedStorageAsset {
  try {
  if (!isVerifiedActor(actor)) throw new StorageReadError("STORAGE_OWNER");
  const parsed = schema.safeParse(input); if (!parsed.success) throw new StorageReadError("STORAGE_INPUT");
  const asset = parsed.data;
  if (asset.ownerId !== actor.id) throw new StorageReadError("STORAGE_OWNER");
  if (asset.sizeBytes > maxBytes) throw new StorageReadError("STORAGE_LIMIT");
  if (storageFormats[asset.mime].kind !== asset.kind || asset.objectKey !== privateObjectKey(asset)) throw new StorageReadError("STORAGE_INPUT");
  // Exact generated-key equality rejects percent encoding, URLs, traversal,
  // Unicode, alternate buckets/owners/ids/hashes, extra separators and suffixes.
  return Object.freeze(asset);
  } catch (error) { if (error instanceof StorageReadError) throw error; throw new StorageReadError("STORAGE_INPUT"); }
}

// Reserved-upload original (0005 keyRule "owner/incoming/object/intent:v1"): the server-checked owner and the exact key
// reserve_upload_v1 generated, in the one configured private bucket. Supabase Storage exposes no object version this reader
// can prove, so only providerVersion null (what 0005 records) is accepted; any claimed version is refused, never assumed.
const incomingSchema = z.strictObject({ ownerId: uuid, objectId: z.uuidv7().refine(v => v === v.toLowerCase()),
  intentId: z.uuidv7().refine(v => v === v.toLowerCase()), maxBytes: z.number().int().positive().safe(),
  source: z.strictObject({ bucket: z.string().max(63), key: z.string().max(256), providerVersion: z.null() }) });
export type OwnedIncomingSource = Readonly<{ ownerId: string; objectId: string; intentId: string; objectKey: string; maxBytes: number;
  source: Readonly<{ bucket: string; key: string; providerVersion: null }> }>;
export function incomingObjectKey(input: Pick<OwnedIncomingSource, "ownerId" | "objectId" | "intentId">) {
  if (!uuid.safeParse(input.ownerId).success || [input.objectId, input.intentId].some(id => !z.uuidv7().safeParse(id).success || id !== id.toLowerCase()))
    throw new StorageReadError("STORAGE_INPUT");
  return `${input.ownerId}/incoming/${input.objectId}/${input.intentId}`;
}
// bucket/maxBytes are the reader's configured values; the effective download bound is the smaller of the reservation's and the configuration's.
export function ownedIncomingSource(actor: VerifiedActor, input: unknown, bucket: string, maxBytes: number): OwnedIncomingSource {
  try {
  if (!isVerifiedActor(actor)) throw new StorageReadError("STORAGE_OWNER");
  const parsed = incomingSchema.safeParse(input); if (!parsed.success) throw new StorageReadError("STORAGE_INPUT");
  const value = parsed.data;
  if (value.ownerId !== actor.id) throw new StorageReadError("STORAGE_OWNER");
  if (value.source.bucket !== bucket || value.source.key !== incomingObjectKey(value)) throw new StorageReadError("STORAGE_INPUT");
  return Object.freeze({ ownerId: value.ownerId, objectId: value.objectId, intentId: value.intentId, objectKey: value.source.key,
    maxBytes: Math.min(value.maxBytes, maxBytes), source: Object.freeze({ bucket: value.source.bucket, key: value.source.key, providerVersion: null }) });
  } catch (error) { if (error instanceof StorageReadError) throw error; throw new StorageReadError("STORAGE_INPUT"); }
}
