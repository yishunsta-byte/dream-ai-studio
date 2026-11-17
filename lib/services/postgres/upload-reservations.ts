import "server-only";
import { v7 } from "uuid";
import { z } from "zod";
import { assertPlainData, frozen, id } from "../../storage/uploads/schema";
import { snapshotReservationRequest } from "../../storage/uploads/reservation-client";
import { isVerifiedActor, type VerifiedActor } from "../../db/postgres/types";
import { reservationNotApplied, type ReservationAttemptResult } from "../../db/postgres/reservation-outcome";
import { runReservationAttempt, type ReservationConfiguration } from "../../db/postgres/reservation-attempt";

const oid = z.number().int().min(1).max(4294967295);
const target = z.strictObject({ schemaVersion: z.literal(5), sql5Sha256: z.literal("9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb"), serverMajor: z.literal(18), loginOid: oid, apiRoleOid: oid, apiMembershipGrantorOid: oid, issuerRoleOid: oid, migrationOwnerOid: oid, bootstrapOid: oid, readSeedFunctionOid: oid, reserveUploadFunctionOid: oid, provenanceId: z.string().min(1).max(128), scope: z.enum(["owned-synthetic", "approved-runtime"]) }).refine(v => v.readSeedFunctionOid !== v.reserveUploadFunctionOid && new Set([v.loginOid, v.apiRoleOid, v.issuerRoleOid, v.migrationOwnerOid, v.bootstrapOid]).size === 5);
const limits = z.strictObject({ statementTimeoutMs: z.number().int().positive().max(15000), lockTimeoutMs: z.number().int().positive().max(15000), idleTimeoutMs: z.number().int().positive().max(15000), attemptDeadlineMs: z.number().int().positive().max(120000), cleanupDeadlineMs: z.number().int().positive().max(5000) }).refine(v => v.lockTimeoutMs <= v.statementTimeoutMs);
const connection = z.strictObject({ connectionString: z.string().min(1), ca: z.string().optional(), localTestWithoutTls: z.boolean().optional() });
export type ServerReservationDependencies = Readonly<{ connection: z.input<typeof connection>; target: z.input<typeof target>; limits: z.input<typeof limits>; nextRecordId?: () => string }>;
export function postgresUploadReservations(dependencies: ServerReservationDependencies) {
  let config: ReservationConfiguration | undefined;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(dependencies);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(dependencies))) throw new Error();
    if (Reflect.ownKeys(dependencies).some(k => typeof k !== "string" || !["connection", "target", "limits", "nextRecordId"].includes(k)) || Object.values(descriptors).some(d => !Object.hasOwn(d, "value"))) throw new Error();
    const raw = { connection: descriptors.connection?.value, target: descriptors.target?.value, limits: descriptors.limits?.value };
    assertPlainData(raw);
    const next = descriptors.nextRecordId?.value ?? v7;
    if (typeof next !== "function") throw new Error();
    config = frozen({ connection: connection.parse(raw.connection), target: target.parse(raw.target), limits: limits.parse(raw.limits), nextRecordId: next });
  } catch { /* fixed configuration rejection; never expose causes/secrets */ }
  return Object.freeze({
    async reserve(actor: VerifiedActor, request: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<ReservationAttemptResult> {
      let actorId: string;
      try { if (!isVerifiedActor(actor) || actor.id.length !== 36 || !id.safeParse(actor.id).success) return reservationNotApplied("AUTH_REQUIRED"); actorId = actor.id; }
      catch { return reservationNotApplied("AUTH_REQUIRED"); }
      if (!config) return reservationNotApplied("CONFIGURATION_REJECTED");
      let snapshot;
      try { snapshot = snapshotReservationRequest(request); } catch { return reservationNotApplied("INVALID_REQUEST"); }
      const identity = Object.freeze({ requestId: snapshot.requestId, clientVersion: 1 as const, clientDigest: snapshot.client.clientDigest });
      if (config.target.scope !== "owned-synthetic") return reservationNotApplied("DISABLED", identity);
      let signal: AbortSignal | undefined;
      try {
        if (options) {
          if (![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new Error();
          const d = Object.getOwnPropertyDescriptors(options);
          if (Reflect.ownKeys(options).some(k => k !== "signal") || Object.values(d).some(v => !Object.hasOwn(v, "value"))) throw new Error();
          signal = d.signal?.value;
          if (signal !== undefined && (!(signal instanceof AbortSignal) || typeof signal.aborted !== "boolean")) throw new Error();
        }
      } catch { return reservationNotApplied("INVALID_REQUEST", identity); }
      if (signal?.aborted) return reservationNotApplied("CANCELLED", identity);
      return runReservationAttempt(actorId, snapshot, config, signal);
    },
  });
}
