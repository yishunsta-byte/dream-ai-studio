import { createHash } from "node:crypto";
import { z } from "zod";
import { assertPlainData, frozen, recordId } from "./schema";

export const reservationMimes = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "video/webm"] as const;
export type ReservationMime = typeof reservationMimes[number];
export type ClientSnapshotV1 = Readonly<{ clientVersion: 1; requestedMaxBytes: number; claimedMime: ReservationMime; canonicalJson: string; clientDigest: string }>;
export type ReservationRequestSnapshot = Readonly<{ requestId: string; client: ClientSnapshotV1 }>;
export class ReservationClientError extends Error { constructor() { super("INVALID_REQUEST"); } }
const logical = z.strictObject({ clientVersion: z.literal(1), requestedMaxBytes: z.number().int().safe().positive().max(2147483648).refine(n => !Object.is(n, -0)), claimedMime: z.enum(reservationMimes) });
const textPattern = /^\{"claimedMime":"(image\/png|image\/jpeg|image\/webp|video\/mp4|video\/quicktime|video\/webm)","clientVersion":1,"requestedMaxBytes":[1-9][0-9]{0,9}\}$/;
export function serializeUploadReservationClientV1(input: unknown): ClientSnapshotV1 {
  try {
    assertPlainData(input); const v = logical.parse(input);
    const canonicalJson = `{"claimedMime":"${v.claimedMime}","clientVersion":1,"requestedMaxBytes":${v.requestedMaxBytes}}`;
    return frozen({ ...v, canonicalJson, clientDigest: createHash("sha256").update(`upload-reservation-client:v1\n${canonicalJson}`, "utf8").digest("hex") });
  } catch { throw new ReservationClientError(); }
}
export function parseUploadReservationClientV1(input: unknown): ClientSnapshotV1 {
  try {
    if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > 160 || textPattern.exec(input)?.[0] !== input) throw new ReservationClientError();
    const value = serializeUploadReservationClientV1(JSON.parse(input));
    if (value.canonicalJson !== input) throw new ReservationClientError();
    return value;
  } catch { throw new ReservationClientError(); }
}
export function snapshotReservationRequest(input: unknown): ReservationRequestSnapshot {
  try {
    assertPlainData(input);
    const v = z.strictObject({ requestId: recordId.refine(s => s.length === 36), clientJson: z.string() }).parse(input);
    return frozen({ requestId: v.requestId, client: parseUploadReservationClientV1(v.clientJson) });
  } catch { throw new ReservationClientError(); }
}
