import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { resolveServerAuth } from "../auth/resolve";
import { actorFromVerifiedUserId, type VerifiedActor } from "../db/postgres/types";
import { isCoverGeneration, isCoverSlug, type CoverAddress } from "./cover-path";
import { COVER_MAX_BYTES, COVER_MAX_DIMENSION, verifyCoverBytes, type CoverRow } from "./cover-source";
import { playbackFormats } from "./playback-path";
import type { PlaybackRow } from "./playback-source";
import { readApprovedSnapshot, SHOWCASE_FETCH_LIMIT } from "./showcase-source";
import { toPublishedWorks } from "./published-works";

const id = z.guid().transform(value => value.toLowerCase());
const generation = z.string().refine(isCoverGeneration);
const versionSchema = z.string().refine(value => value === "0" || isCoverGeneration(value));
const commandBase = { slug: z.string().refine(isCoverSlug), requestId: id, expectedVersion: versionSchema };
const commandSchema = z.discriminatedUnion("command", [
  z.strictObject({ ...commandBase, command: z.literal("prepare"), generation: z.null(), rightsConfirmed: z.literal(true) }),
  z.strictObject({ ...commandBase, command: z.literal("complete"), generation, rightsConfirmed: z.literal(true) }),
  z.strictObject({ ...commandBase, command: z.literal("revoke"), generation, rightsConfirmed: z.literal(false) }),
]);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const epoch = z.number().int().min(0).max(253402300799999);
const displayText = (limit: number) => z.string().refine(value => !/[@\p{Cc}\u2028\u2029]/u.test(value)).pipe(z.string().trim().min(1).max(limit));
const dimension = z.number().int().min(1).max(COVER_MAX_DIMENSION);
const displaySchema = z.strictObject({
  kind: z.enum(["영상", "광고", "여행"]), title: displayText(80), subtitle: displayText(120),
  creator: displayText(60), genre: displayText(40), format: displayText(40), description: displayText(400),
  width: dimension, height: dimension,
});
const target = { ownerId: id, workId: id, artifactId: id, artifactRevision: generation, sourceSha: sha };
// Render evidence is issued with the artifact. The immutable storage version is checked
// again against the complete byte stream before publication.
const mediaEvidence = z.strictObject({ ...target, status: z.literal("verified"), kind: z.enum(["audio", "video"]),
  mime: z.string(), ext: z.enum(["mp4","webm","mp3","m4a"]), sha, sizeBytes: z.number().int().positive(),
  version: z.string().regex(/^"[\x21\x23-\x7e]{1,128}"$/), videoCodec: z.enum(["h264","av1","vp9"]).nullable(),
  audioCodec: z.enum(["aac","mp3","opus"]).nullable(), fastStart: z.boolean(), objectKey: z.string().max(180).nullable(),
}).refine(m => {
  const format = playbackFormats[m.ext];
  if (m.mime !== format.mime || m.kind !== format.kind || m.sha !== m.sourceSha ||
      m.sizeBytes > (format.kind === "video" ? 500 : 50) * 1024 ** 2) return false;
  switch (m.ext) {
    case "mp4": return m.fastStart && m.videoCodec === "h264" && (m.audioCodec === null || m.audioCodec === "aac");
    case "webm": return (m.videoCodec === "vp9" || m.videoCodec === "av1") && (m.audioCodec === null || m.audioCodec === "opus");
    case "mp3": return m.videoCodec === null && m.audioCodec === "mp3";
    case "m4a": return m.videoCodec === null && m.audioCodec === "aac";
  }
});
export type PublicationMediaEvidence = z.infer<typeof mediaEvidence>;
const evidenceSchema = z.strictObject({
  media: mediaEvidence.optional(),
  source: z.strictObject({ ...target, status: z.literal("complete") }),
  rights: z.strictObject({ ...target, status: z.literal("confirmed"), scope: z.literal("public_showcase"),
    reference: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), expiresAtMs: epoch.nullable() }),
  cover: z.strictObject({ ...target, status: z.literal("verified"), mime: z.literal("image/webp"),
    sha, sizeBytes: z.number().int().min(1).max(COVER_MAX_BYTES), width: dimension, height: dimension,
    objectKey: z.string().max(160).nullable() }),
});

type Display = z.infer<typeof displaySchema>;
type Command = z.infer<typeof commandSchema>;
type Review = Readonly<{ generation: string; artifactId: string; artifactRevision: string; rightsReference: string; binding: string }>;
type Active = Review & Readonly<{ approvedMs: number; rightsUntilMs: number | null; display: Display; cover: CoverRow; media?: PlaybackRow & {kind: "audio" | "video"} }>;
export type AdminPublicationWork = Readonly<{
  id: string; ownerId: string; slug: string; revision: string; media: "image" | "music" | "video";
  artifact: Readonly<{ id: string; revision: string; sha: string; status: "complete" | "incomplete" }>;
  display: unknown; review: Review | null; active: Active | null;
}>;

type Success = Readonly<{ status: "prepared" | "published" | "revoked"; version: string; generation: string }>;
type SettledFailure = Readonly<{ status: "conflict" | "source-unavailable" }>;
type Failure = SettledFailure | Readonly<{ status: "denied" | "invalid" | "unavailable" }>;
type QueueItem = Readonly<{
  slug: string; title: string; kind: AdminPublicationWork["media"]; version: string;
  pendingGeneration: string | null; activeGeneration: string | null; approvedMs: string | null;
  source: { revision: string; finished: boolean }; rights: "confirmed" | "unconfirmed";
}>;
type Queue = Readonly<{ kind: "closed" } | { kind: "failed" } | { kind: "ok"; items: readonly QueueItem[] }>;
type Entry<Outcome = Success | SettledFailure> = Readonly<{ fingerprint: string; outcome: Outcome }>;
type Change = Readonly<{
  work: AdminPublicationWork;
  audit: { actorId: string; workId: string; requestId: string; command: Command["command"]; version: string;
    artifactId: string; artifactRevision: string; generation: string; atMs: number; rightsReference: string; evidenceBinding: string };
  request: Entry<Success>;
}>;

export type AdminPublicationTransaction = Readonly<{
  isPublisher(actor: VerifiedActor): Promise<boolean>;
  listOwnedWorks(actor: VerifiedActor): Promise<readonly AdminPublicationWork[]>;
  findOwnedWork(actor: VerifiedActor, slug: string): Promise<AdminPublicationWork | null>;
  findRequest(actor: VerifiedActor, requestId: string): Promise<Entry | null>;
  /** Return current authoritative evidence; throw when its availability or validity could not be determined. */
  readEvidence(actor: VerifiedActor, work: AdminPublicationWork): Promise<unknown>;
  /** Null confirms an absent immutable object. Throw for timeouts, transport errors and uncertain absence. */
  readCover(actor: VerifiedActor, objectKey: string, maxBytes: number): Promise<Uint8Array | null>;
  verifyMedia?(actor: VerifiedActor, row: PlaybackRow): Promise<boolean>;
  saveFailure(actor: VerifiedActor, requestId: string, entry: Entry<SettledFailure>): Promise<void>;
  save(change: Change): Promise<void>;
}>;

export type AdminPublicationStore = Readonly<{
  /** Serialize the checks and commit. Roll back all writes on rejection. Version candidate or display changes too. */
  transaction<T>(operation: (tx: AdminPublicationTransaction) => Promise<T>): Promise<T>;
}>;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isDefinitiveCoverFailure(error: unknown) {
  // These errors come from explicit byte checks. Native decoder failures may also be operational.
  return error instanceof Error && /^cover: (not bytes|length|hash|container|container length|format|dimension)$/.test(error.message);
}

function activeAt(work: AdminPublicationWork, nowMs: number) {
  const active = work.active;
  if (active && active.approvedMs <= nowMs && (active.rightsUntilMs === null || nowMs < active.rightsUntilMs)) return active;
}

/** Project already committed rows for the T253 list-only read interface. */
export function projectApprovedPublications(works: readonly AdminPublicationWork[], nowMs: number) {
  const rows = works.flatMap(work => {
    const active = activeAt(work, nowMs);
    return active ? [{ slug: work.slug, generation: active.generation, approvedMs: String(active.approvedMs), display: { ...active.display },
      ...(active.media ? { media: { kind: active.media.kind, ext: active.media.ext } } : {}) }] : [];
  });
  rows.sort((a, b) => Number(b.approvedMs) - Number(a.approvedMs) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { nowMs: String(epoch.parse(nowMs)), rows: rows.slice(0, SHOWCASE_FETCH_LIMIT) };
}

/** Never pass a private object key through the public feed or return it for an old generation. */
export function findActivePublicationCover(work: AdminPublicationWork, address: CoverAddress, nowMs: number): CoverRow | null {
  const active = activeAt(work, epoch.parse(nowMs));
  return work.slug === address.slug && active?.generation === address.generation ? { ...active.cover } : null;
}

async function bindEvidence(tx: AdminPublicationTransaction, actor: VerifiedActor, work: AdminPublicationWork, nowMs: number) {
  if (work.artifact.status !== "complete" || !["image", "music", "video"].includes(work.media)) return;
  const evidence = evidenceSchema.safeParse(await tx.readEvidence(actor, work));
  const display = displaySchema.safeParse(work.display);
  if (!evidence.success || !display.success) return;
  const { source, rights, cover, media } = evidence.data;
  if (work.media === "image" ? media !== undefined :
    (!tx.verifyMedia || !media || media.kind !== (work.media === "music" ? "audio" : "video"))) return;
  for (const proof of media ? [source, rights, cover, media] : [source, rights, cover]) {
    if (proof.ownerId !== actor.id || proof.workId !== work.id || proof.artifactId !== work.artifact.id ||
      proof.artifactRevision !== work.artifact.revision || proof.sourceSha !== work.artifact.sha) return;
  }
  if ((rights.expiresAtMs !== null && rights.expiresAtMs <= nowMs) ||
    cover.width !== display.data.width || cover.height !== display.data.height) return;
  const candidate = readApprovedSnapshot({ nowMs: String(nowMs), rows: [
    { slug: work.slug, generation: "1", approvedMs: String(nowMs), display: display.data },
  ] });
  if (toPublishedWorks(candidate.records, { now: new Date(nowMs) }).works.length !== 1) return;
  const { objectKey, ...reviewedCover } = cover;
  const { objectKey: mediaObjectKey, ...reviewedMedia } = media ?? {};
  const binding = digest({ source, rights, cover: reviewedCover, ...(media ? { media: reviewedMedia } : {}),
    display: display.data, slug: work.slug });
  return { binding, rightsReference: rights.reference, rightsUntilMs: rights.expiresAtMs,
    cover: reviewedCover, objectKey, media, mediaObjectKey, display: display.data };
}

/** Internal service. A trusted auth resolver and atomic store are required; it has no route or global state. */
export function createAdminPublicationService(store: AdminPublicationStore, resolveAuth: typeof resolveServerAuth, now = Date.now) {
  async function currentActor() {
    const auth = await resolveAuth();
    if (auth?.kind === "local" || (auth?.kind === "denied" && auth.code !== "AUTH_UNAVAILABLE")) return;
    if (auth?.kind !== "verified" || !auth.email || !id.safeParse(auth.userId).success) throw new Error("PUBLICATION_AUTH_UNAVAILABLE");
    return actorFromVerifiedUserId(auth.userId);
  }

  async function list(): Promise<Queue> {
    try {
      const actor = await currentActor();
      if (!actor) return { kind: "closed" };
      return await store.transaction(async tx => {
        if (await tx.isPublisher(actor) !== true) return { kind: "closed" };
        const items: QueueItem[] = [];
        const seen = new Set<string>();
        const atMs = epoch.parse(now());
        for (const work of await tx.listOwnedWorks(actor)) {
          if (work.ownerId !== actor.id) return { kind: "failed" };
          const title = displayText(120).safeParse((work.display as { title?: unknown } | null)?.title);
          if (!title.success || !isCoverSlug(work.slug) || seen.has(work.slug) || !isCoverGeneration(work.artifact.revision) ||
            !versionSchema.safeParse(work.revision).success) return { kind: "failed" };
          seen.add(work.slug);
          const ready = await bindEvidence(tx, actor, work, atMs);
          items.push({ slug: work.slug, title: title.data, kind: work.media, version: work.revision,
            pendingGeneration: work.review?.generation ?? null, activeGeneration: work.active?.generation ?? null,
            approvedMs: work.active ? String(work.active.approvedMs) : null,
            source: { revision: work.artifact.revision, finished: work.artifact.status === "complete" },
            rights: ready ? "confirmed" : "unconfirmed",
          });
        }
        return { kind: "ok", items };
      });
    } catch { return { kind: "failed" }; }
  }

  async function apply(input: unknown): Promise<Success | Failure> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid" };
    const command = parsed.data;
    const expected = BigInt(command.expectedVersion);
    if (command.generation !== null && BigInt(command.generation) > expected) return { status: "invalid" };
    try {
      const actor = await currentActor();
      if (!actor) return { status: "denied" };
      return await store.transaction(async tx => {
        if (await tx.isPublisher(actor) !== true) return { status: "denied" };
        const work = await tx.findOwnedWork(actor, command.slug);
        if (!work || work.ownerId !== actor.id || work.slug !== command.slug) return { status: "denied" };
        const fingerprint = digest(command);
        const prior = await tx.findRequest(actor, command.requestId);
        if (prior) return prior.fingerprint === fingerprint ? { ...prior.outcome } : { status: "invalid" };

        const recordFailure = async (status: SettledFailure["status"]): Promise<SettledFailure> => {
          const outcome = { status };
          await tx.saveFailure(actor, command.requestId, { fingerprint, outcome });
          return outcome;
        };

        if (!versionSchema.safeParse(work.revision).success) return { status: "unavailable" };
        if (expected > BigInt(work.revision)) return recordFailure("conflict");
        if (command.command === "prepare" && (work.revision !== command.expectedVersion || work.review)) return recordFailure("conflict");
        if (command.command === "complete" && (command.expectedVersion !== command.generation ||
          work.review?.generation !== command.generation)) return recordFailure("conflict");
        const revision = String(BigInt(work.revision) + 1n);
        if (!isCoverGeneration(revision)) return { status: "unavailable" };
        let atMs = epoch.parse(now());
        let review = work.review;
        let active = work.active;
        let outcome: Success;
        let decision: Review;

        if (command.command === "revoke") {
          const target = review?.generation === command.generation ? review : active?.generation === command.generation ? active : null;
          if (!target) return recordFailure("conflict");
          decision = target;
          if (review?.generation === command.generation) review = null;
          if (active?.generation === command.generation) active = null;
          outcome = { status: "revoked", version: revision, generation: command.generation };
        } else {
          const evidence = await bindEvidence(tx, actor, work, atMs);
          if (!evidence) return recordFailure("source-unavailable");
          if (command.command === "prepare") {
            decision = { generation: revision, artifactId: work.artifact.id, artifactRevision: work.artifact.revision,
              rightsReference: evidence.rightsReference, binding: evidence.binding };
            review = decision;
            outcome = { status: "prepared", version: revision, generation: revision };
          } else {
            if (!review || review.binding !== evidence.binding) return recordFailure("source-unavailable");
            decision = review;
            const objectKey = `${work.slug}/${command.generation}/${evidence.cover.sha}.webp`;
            if (evidence.objectKey !== objectKey) return recordFailure("source-unavailable");
            const cover = { objectKey, mime: evidence.cover.mime, sizeBytes: evidence.cover.sizeBytes, sha: evidence.cover.sha };
            const supplied = await tx.readCover(actor, objectKey, COVER_MAX_BYTES);
            if (supplied === null) return recordFailure("source-unavailable");
            try {
              const bytes = await verifyCoverBytes(supplied, cover);
              const { width, height } = await sharp(bytes).metadata();
              if (width !== evidence.display.width || height !== evidence.display.height) return recordFailure("source-unavailable");
            } catch (error) {
              if (isDefinitiveCoverFailure(error)) return recordFailure("source-unavailable");
              throw error;
            }
            let media: Active["media"];
            if (evidence.media) {
              const m = evidence.media;
              const key = `${work.slug}/${command.generation}/${m.sha}.${m.ext}`;
              if (evidence.mediaObjectKey !== key || !tx.verifyMedia) return recordFailure("source-unavailable");
              media = { kind: m.kind, objectKey: key, ext: m.ext, mime: m.mime, sha: m.sha, sizeBytes: m.sizeBytes, version: m.version };
              if (!await tx.verifyMedia(actor, media)) return recordFailure("source-unavailable");
            }
            const approvedMs = epoch.parse(now());
            if (approvedMs < atMs) return { status: "unavailable" };
            if (evidence.rightsUntilMs !== null && approvedMs >= evidence.rightsUntilMs) return recordFailure("source-unavailable");
            atMs = approvedMs;
            active = { ...decision, approvedMs, rightsUntilMs: evidence.rightsUntilMs,
              display: evidence.display, cover, ...(media ? { media } : {}) };
            review = null;
            outcome = { status: "published", version: revision, generation: command.generation };
          }
        }

        await tx.save({ work: { ...work, revision, review, active }, request: { fingerprint, outcome }, audit: {
          actorId: actor.id, workId: work.id, requestId: command.requestId, command: command.command, version: revision,
          artifactId: decision.artifactId, artifactRevision: decision.artifactRevision, generation: outcome.generation,
          atMs, rightsReference: decision.rightsReference, evidenceBinding: decision.binding,
        } });
        return { ...outcome };
      });
    } catch { return { status: "unavailable" }; }
  }

  return { list, apply };
}
