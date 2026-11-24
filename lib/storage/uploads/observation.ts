import { protocolDigest } from "./receipt";
import { requireProtocol as need, uploadFormatKind, type ObjectIdentity, type Observation, type UploadModel } from "./schema";

// Observation v1 contract between a verifier's byte/media reads and the upload state model.
// The model still cannot prove bytes; it refuses to issue a receipt unless the verifier's own
// observation matches the registered identity, source, media and tool versions exactly.
type Media = NonNullable<UploadModel["media"]>;
type Source = UploadModel["incoming"];
type FailureCode = NonNullable<UploadModel["operations"][number]["failureCode"]>;
const same = (a: unknown, b: unknown) => protocolDigest("tuple", a) === protocolDigest("tuple", b);

// Fixed precedence: INVALID_BYTES -> SIZE_MISMATCH -> HASH_MISMATCH -> MIME_MISMATCH -> MEDIA_INVALID,
// then the published final copy of an initial upload (SIZE_MISMATCH -> HASH_MISMATCH). Size and hash need
// no decoding, so a verifier can stop before decoding untrusted bytes. null means "matches".
export function observationFailure(identity: ObjectIdentity | null, expectedMedia: Media | null, observation: Observation): FailureCode | null {
  const o = observation;
  if (!o.format) return "INVALID_BYTES";
  if (identity) {
    if (o.bytes.sizeBytes !== identity.sizeBytes) return "SIZE_MISMATCH";
    if (o.bytes.sha256 !== identity.sha256) return "HASH_MISMATCH";
    if (o.format.mime !== identity.mime || o.format.kind !== identity.kind) return "MIME_MISMATCH";
  } else if (uploadFormatKind(o.format.mime) === null || uploadFormatKind(o.format.mime) !== o.format.kind) return "MIME_MISMATCH";
  const kind = identity?.kind ?? o.format.kind;
  if (!o.media || (kind === "image") !== (o.media.durationMs === null) || (expectedMedia && !same(expectedMedia, o.media))) return "MEDIA_INVALID";
  if (identity && o.published) {
    if (o.published.sizeBytes !== identity.sizeBytes) return "SIZE_MISMATCH";
    if (o.published.sha256 !== identity.sha256) return "HASH_MISMATCH";
  }
  return null;
}

// The observation must describe this operation's read: same kind and the exact source the receipt will name.
function requireBinding(o: Observation, operationKind: Observation["kind"], expectedSource: Source | null) {
  need(expectedSource && o.kind === operationKind && same(o.source, expectedSource), "OBSERVATION");
}

// New receipt issuance (initial or reverify finalize). Every field the receipt states must have been observed.
export function requireIssuableObservation(input: { observation: Observation | undefined; operationKind: Observation["kind"]; identity: ObjectIdentity;
  expectedSource: Source; expectedMedia: Media | null; media: Media; versions: { verifierVersion: string; toolVersion: string } }) {
  const o = input.observation;
  need(o, "OBSERVATION");
  requireBinding(o, input.operationKind, input.expectedSource);
  need((o.kind === "initial") === (o.published !== null), "OBSERVATION");
  need(same(o.tools, input.versions) && o.media !== null && same(o.media, input.media), "OBSERVATION");
  need(observationFailure(input.identity, input.expectedMedia, o) === null, "OBSERVATION");
}

// A rejection may carry the observation that caused it; when it does, the stated code must be exactly the
// first mismatch under the fixed precedence. Without one, the pre-observation rejection contract is unchanged.
export function requireRejectionObservation(input: { observation: Observation | undefined; operationKind: Observation["kind"]; identity: ObjectIdentity | null;
  expectedSource: Source | null; expectedMedia: Media | null; failureCode: FailureCode }) {
  const o = input.observation;
  if (!o) return;
  requireBinding(o, input.operationKind, input.expectedSource);
  need(o.kind === "initial" || o.published === null, "OBSERVATION");
  need(observationFailure(input.identity, input.expectedMedia, o) === input.failureCode, "OBSERVATION");
}
