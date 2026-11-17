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
