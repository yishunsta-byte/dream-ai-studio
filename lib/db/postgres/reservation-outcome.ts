import "server-only";
import { frozen } from "../../storage/uploads/schema";

export type RetryIdentity = Readonly<{ requestId: string; clientVersion: 1; clientDigest: string }>;
export type ReservationSnapshotDto = Readonly<{ requestId: string; objectId: string; assetId: string; intentId: string; reservedAt: number; authorizationUntil: number; issueEnvelopeUntil: number; maxBytes: number; policyEpoch: number; policyDigest: string }>;
export type CurrentReservationInfo = Readonly<{ lifecycle: "reserved" | "publication_reserved" | "registered" | "cleanup_claimed" | "tombstoned"; revision: number; intentStatus: "open" | "completion_requested" | "succeeded" | "canceled" | "expired" | "failed"; intentRevision: number; initialClosed: boolean }>;
export type ReservationRecord = Readonly<{ origin: "created" | "replayed"; reservation: ReservationSnapshotDto; current: CurrentReservationInfo; fingerprint: string; rawSha: string; issuanceAuthorized: false }>;
export type ClosedReason = "AUTH_REQUIRED" | "INVALID_REQUEST" | "DISABLED" | "CONFIGURATION_REJECTED" | "CLIENT_CONFLICT" | "ADMISSION_STALE" | "ADMISSION_REJECTED" | "IDENTITY_CONFLICT" | "REPLY_INVALID" | "SERVICE_UNAVAILABLE" | "CANCELLED";
export type ReservationAttemptResult =
  | Readonly<{ kind: "success"; commit: "confirmed"; cleanup: "ok"; record: ReservationRecord }>
  | Readonly<{ kind: "failure"; commit: "not-applied"; cleanup: "ok" | "failed"; reason: ClosedReason; identity: RetryIdentity | null }>
  | Readonly<{ kind: "failure"; commit: "unknown"; cleanup: "ok" | "failed"; reason: "OUTCOME_UNKNOWN"; identity: RetryIdentity }>
  | Readonly<{ kind: "failure"; commit: "confirmed"; cleanup: "failed"; reason: "CLEANUP_FAILED"; identity: RetryIdentity; record: ReservationRecord }>;
export const reservationNotApplied = (reason: ClosedReason, identity: RetryIdentity | null = null, cleanup: "ok" | "failed" = "ok"): ReservationAttemptResult => frozen({ kind: "failure", commit: "not-applied", cleanup, reason, identity });
export const reservationUnknown = (identity: RetryIdentity, cleanup: "ok" | "failed"): ReservationAttemptResult => frozen({ kind: "failure", commit: "unknown", cleanup, reason: "OUTCOME_UNKNOWN", identity });
export const reservationCommitted = (record: ReservationRecord, identity: RetryIdentity, cleanup: "ok" | "failed"): ReservationAttemptResult => cleanup === "ok"
  ? frozen({ kind: "success", commit: "confirmed", cleanup, record })
  : frozen({ kind: "failure", commit: "confirmed", cleanup, reason: "CLEANUP_FAILED", identity, record });
