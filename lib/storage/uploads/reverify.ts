import { z } from "zod";
import { observationFailure } from "./observation";
import { protocolDigest } from "./receipt";
import { contextSchema, counter, digestSchema, frozen, mediaSchema, observationSchema, parse, recordId, requireProtocol as need, sourceSchema,
  type Observation, type UploadCommand } from "./schema";
import { checkedModel, operationResult, transition } from "./state";

// Registered-object reverify command preparation (pure; no network, storage options, DB writes or worker calls).
// Input is one trusted read of the registered final key: either the measured observation (bytes/format/media from a
// single download, the source it actually read) or a transient read failure. The answer is a finalize or a
// rejectVerification command only when the existing transition would accept it now, nothing for a transient failure,
// or the stored terminal result for an operation that already ended.
const same = (a: unknown, b: unknown) => protocolDigest("tuple", a) === protocolDigest("tuple", b);
const readSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("observed"), source: sourceSchema, bytes: z.strictObject({ sha256: digestSchema, sizeBytes: counter }),
    format: observationSchema.shape.format, media: mediaSchema.nullable() }),
  // Network, timeout, abort, auth or availability failures prove nothing about the bytes.
  z.strictObject({ status: z.literal("unavailable") }),
]);
const requestSchema = z.strictObject({ operationId: recordId, fingerprint: digestSchema, expectedFence: counter.min(1), receiptId: recordId,
  notAfter: counter, verifierVersion: z.string().min(1).max(128), toolVersion: z.string().min(1).max(128), read: readSchema });
type Finalize = Extract<UploadCommand, { type: "finalize" }>;
type Reject = Extract<UploadCommand, { type: "rejectVerification" }>;
export type ReverifyDecision =
  | Readonly<{ action: "finalize"; command: Finalize }>
  | Readonly<{ action: "rejectVerification"; command: Reject }>
  | Readonly<{ action: "none"; reason: "TRANSIENT_READ" }>
  | Readonly<{ action: "terminal"; result: ReturnType<typeof operationResult> }>;

export function reverifyCommand(model: unknown, request: unknown, context: unknown): ReverifyDecision {
  const s = checkedModel(model), r = parse(requestSchema, request), c = parse(contextSchema, context);
  need(s.verifiers.includes(c.principalId), "AUTHORITY");
  const o = s.operations.find(x => x.id === r.operationId);
  need(o && o.fingerprint === r.fingerprint, "CONFLICT");
  need(o.kind === "reverify", "STATE");
  // An ended operation (succeeded, failed or canceled) is answered from what the model stored; no new command.
  if (o.status !== "pending") return frozen({ action: "terminal" as const, result: operationResult(s, o.id, o.fingerprint, c) });
  if (r.read.status === "unavailable") return frozen({ action: "none" as const, reason: "TRANSIENT_READ" as const });
  need(s.identity, "STATE");
  // The registered source the receipt would name. The reader proves no provider object version, so a registered source
  // that names one is never bound to this read (and the read's own source must be exactly the registered one).
  const source = { bucket: s.identity.bucket, key: s.identity.key, providerVersion: s.identity.providerVersion };
  need(source.providerVersion === null && same(r.read.source, source), "OBSERVATION");
  const observation: Observation = parse(observationSchema, { v: 1, kind: "reverify", source, bytes: r.read.bytes, format: r.read.format,
    media: r.read.media, published: null, tools: { verifierVersion: r.verifierVersion, toolVersion: r.toolVersion } });
  const failure = observationFailure(s.identity, s.media, observation);
  const command: Finalize | Reject = failure === null
    ? { type: "finalize", operationId: o.id, fingerprint: o.fingerprint, expectedFence: r.expectedFence, receiptId: r.receiptId, identity: s.identity, source,
        media: observation.media!, notAfter: r.notAfter, verifierVersion: r.verifierVersion, toolVersion: r.toolVersion, observation }
    : { type: "rejectVerification", operationId: o.id, fingerprint: o.fingerprint, expectedFence: r.expectedFence, failureCode: failure, observation };
  // The existing transition is the acceptance check: worker, lease window, fence, generation, policy, authorization expiry,
  // state revision, receipt id and observation binding. It throws its own code; the model passed in is not changed.
  transition(s, command, c);
  return frozen(command.type === "finalize" ? { action: "finalize" as const, command } : { action: "rejectVerification" as const, command });
}
