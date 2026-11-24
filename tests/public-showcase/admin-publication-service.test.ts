import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { isPublicationItem, isPublicationOutcome } from "../../components/admin/publication-model";
import type { PublicationProvider } from "../../components/admin/publication-provider";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import {
  createAdminPublicationService, findActivePublicationCover, projectApprovedPublications,
  type AdminPublicationStore, type AdminPublicationTransaction, type AdminPublicationWork,
} from "../../lib/public-showcase/admin-publication-service";
import { coverPath } from "../../lib/public-showcase/cover-path";
import * as coverSource from "../../lib/public-showcase/cover-source";
import { toPublishedWorks } from "../../lib/public-showcase/published-works";
import { readApprovedSnapshot } from "../../lib/public-showcase/showcase-source";

vi.mock("server-only", () => ({}));

const actorA = "10000000-0000-4000-8000-000000000010";
const actorB = "10000000-0000-4000-8000-000000000020";
const slug = "first-work";
const clock = 1_790_000_000_000;
const auth = (userId: string): ServerAuthResult => ({ kind: "verified", userId, email: "private@example.invalid" });
const requestId = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const status = (value: string) => ({ status: value });
let bytes: Buffer;
let coverSha: string;

beforeAll(async () => {
  bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#e02020" } }).webp().toBuffer();
  coverSha = createHash("sha256").update(bytes).digest("hex");
});

function workFor(ownerId = actorA, name = slug, index = 1): AdminPublicationWork {
  return { id: requestId(300 + index), ownerId, slug: name, revision: "0", media: "image",
    artifact: { id: requestId(400 + index), revision: "11", sha: "a".repeat(64), status: "complete" },
    display: { kind: "광고", title: "완성 작품", subtitle: "한 장면", creator: "작업실", genre: "디자인",
      format: "이미지", description: "작업실의 완성 이미지입니다.", width: 8, height: 6 }, review: null, active: null };
}

function evidenceFor(work: AdminPublicationWork, generation: string, expiresAtMs: number | null = null) {
  const proof = { ownerId: work.ownerId, workId: work.id, artifactId: work.artifact.id,
    artifactRevision: work.artifact.revision, sourceSha: work.artifact.sha };
  return {
    source: { ...proof, status: "complete" },
    rights: { ...proof, status: "confirmed", scope: "public_showcase", reference: "private-rights-reference", expiresAtMs },
    cover: { ...proof, status: "verified", sha: coverSha, sizeBytes: bytes.length, mime: "image/webp", width: 8, height: 6,
      objectKey: `${work.slug}/${generation}/${coverSha}.webp` },
  };
}

function command(command: "prepare" | "complete" | "revoke", version: string, seq: number, generation: string | null = null, target = slug) {
  return { requestId: requestId(seq), command, slug: target, expectedVersion: version, generation, rightsConfirmed: command !== "revoke" };
}

type Change = Parameters<AdminPublicationTransaction["save"]>[0];
type Ledger = NonNullable<Awaited<ReturnType<AdminPublicationTransaction["findRequest"]>>>;
function isolatedStore(initial = [workFor(), workFor(actorB, "second-work", 2)]) {
  let snapshot = { works: initial, ledger: new Map<string, Ledger>(), audit: [] as Change["audit"][] };
  const publishers = new Set([actorA, actorB]);
  const proof = new Map(initial.map(work => [work.slug, evidenceFor(work, "1") as unknown]));
  const resolveAuth = vi.fn<() => Promise<ServerAuthResult>>().mockResolvedValue(auth(actorA));
  const readCover = vi.fn<AdminPublicationTransaction["readCover"]>().mockResolvedValue(bytes);
  const readEvidence = vi.fn<AdminPublicationTransaction["readEvidence"]>().mockImplementation(async (_actor, work) => proof.get(work.slug));
  const afterSave = vi.fn<() => void>();
  const afterCommit = vi.fn<() => void>();
  let now = clock;
  let tail: Promise<unknown> = Promise.resolve();

  function serialize<T>(action: () => Promise<T>) {
    const pending = tail.then(action);
    tail = pending.catch(() => {});
    return pending;
  }

  const store: AdminPublicationStore = {
    transaction: operation => serialize(async () => {
      const draft = structuredClone(snapshot);
      const result = await operation({
        isPublisher: async actor => publishers.has(actor.id),
        findOwnedWork: async (actor, target) => draft.works.find(work => work.slug === target && work.ownerId === actor.id) ?? null,
        listOwnedWorks: async actor => draft.works.filter(work => work.ownerId === actor.id),
        findRequest: async (actor, request) => draft.ledger.get(`${actor.id}/${request}`) ?? null,
        readEvidence,
        readCover,
        saveFailure: async (actor, request, entry) => {
          draft.ledger.set(`${actor.id}/${request}`, entry);
          afterSave();
        },
        save: async change => {
          draft.works = draft.works.map(work => work.id === change.work.id ? change.work : work);
          draft.ledger.set(`${change.audit.actorId}/${change.audit.requestId}`, change.request);
          draft.audit.push(change.audit);
          afterSave();
        },
      });
      snapshot = draft;
      afterCommit();
      return result;
    }),
  };
  return {
    service: createAdminPublicationService(store, resolveAuth, () => now), resolveAuth, publishers, readCover, readEvidence, afterSave, afterCommit,
    snapshot: () => structuredClone(snapshot), setClock(value: number) { now = value; },
    setEvidence(value: unknown, target = slug) { return serialize(async () => { proof.set(target, value); }); },
    changeWork(change: (work: AdminPublicationWork) => AdminPublicationWork) {
      return serialize(async () => { snapshot.works = snapshot.works.map(work => work.slug === slug ? change(work) : work); });
    },
    feed: () => projectApprovedPublications(snapshot.works, now),
    cover: (generation: string) => coverSource.serveCover(new Request(`https://test.invalid${coverPath({ slug, generation })}`), {
      mode: "active", store: {
        findCover: async address => findActivePublicationCover(snapshot.works[0], address, now),
        readObject: async () => bytes,
      },
    }),
  };
}

function expectLedgerOnly(fixture: ReturnType<typeof isolatedStore>, before: ReturnType<typeof fixture.snapshot>, added: number) {
  const current = fixture.snapshot();
  expect(current.works).toEqual(before.works);
  expect(current.audit).toEqual(before.audit);
  expect(current.ledger.size).toBe(before.ledger.size + added);
  for (const [key, value] of before.ledger) expect(current.ledger.get(key)).toEqual(value);
}

describe("admin publication service", () => {
  it("matches the scoped T289 queue, prepares, publishes and revokes one T253 generation", async () => {
    const fixture = isolatedStore();
    const service: PublicationProvider = fixture.service;
    const queue = await service.list();
    expect(queue).toEqual({ kind: "ok", items: [{ slug, title: "완성 작품", kind: "image", version: "0",
      pendingGeneration: null, activeGeneration: null, approvedMs: null, source: { revision: "11", finished: true }, rights: "confirmed" }] });
    expect(queue.kind === "ok" && queue.items.every(isPublicationItem)).toBe(true);
    const prepared = await service.apply(command("prepare", "0", 1));
    expect(prepared).toEqual({ status: "prepared", version: "1", generation: "1" });
    expect(isPublicationOutcome(prepared)).toBe(true);
    expect(fixture.feed().rows).toEqual([]);
    expect((await fixture.cover("1")).status).toBe(404);
    expect(await service.apply(command("complete", "1", 2, "1"))).toEqual({ status: "published", version: "2", generation: "1" });
    const feed = fixture.feed();
    expect(feed.rows).toEqual([{ slug, generation: "1", approvedMs: String(clock), display: workFor().display }]);
    const converted = toPublishedWorks(readApprovedSnapshot(feed).records, { now: new Date(clock) });
    expect(converted.works).toHaveLength(1);
    expect(converted.excluded).toEqual([]);
    const response = await fixture.cover("1");
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(JSON.stringify({ feed, list: await service.list() })).not.toMatch(/private|ownerId|sourceSha|objectKey|rights-reference/);
    expect(await service.apply(command("revoke", "2", 3, "1"))).toEqual({ status: "revoked", version: "3", generation: "1" });
    expect(fixture.feed().rows).toEqual([]);
    expect((await fixture.cover("1")).status).toBe(404);
    expect(fixture.snapshot().audit.map(entry => [entry.command, entry.artifactRevision])).toEqual([
      ["prepare", "11"], ["complete", "11"], ["revoke", "11"],
    ]);
  });

  it("requires current authentication, a publisher grant and the work owner on every action and replay", async () => {
    const fixture = isolatedStore();
    const { service, publishers, resolveAuth } = fixture;
    const initial = fixture.snapshot();
    for (const value of [{ kind: "local" }, { kind: "denied", status: 401, code: "AUTH_REQUIRED" }] as const) {
      resolveAuth.mockResolvedValue(value);
      expect(await service.list()).toEqual({ kind: "closed" });
      expect(await service.apply(command("prepare", "0", 1))).toEqual(status("denied"));
    }
    resolveAuth.mockResolvedValue(auth(actorB));
    expect(await service.apply(command("prepare", "0", 1))).toEqual(status("denied"));
    expect((await service.list())).toMatchObject({ kind: "ok", items: [{ slug: "second-work" }] });
    resolveAuth.mockResolvedValue(auth(actorA));
    publishers.delete(actorA);
    expect(await service.apply(command("prepare", "0", 1))).toEqual(status("denied"));
    expect(fixture.snapshot()).toEqual(initial);
    publishers.add(actorA);
    expect(await service.apply(command("prepare", "0", 1))).toMatchObject({ status: "prepared" });
    publishers.delete(actorA);
    expect(await service.apply(command("prepare", "0", 1))).toEqual(status("denied"));
    expect(fixture.snapshot().audit).toHaveLength(1);
  });

  it("rejects absent, expired or cross-bound provenance and never trusts the UI rights checkbox", async () => {
    const fixture = isolatedStore();
    const { service } = fixture;
    const initial = fixture.snapshot();
    const evidence = evidenceFor(workFor(), "1");
    const invalidEvidence = [
      null, { ...evidence, rights: null }, { ...evidence, rights: { ...evidence.rights, ownerId: actorB } },
      { ...evidence, rights: { ...evidence.rights, expiresAtMs: clock } },
      { ...evidence, source: { ...evidence.source, artifactRevision: "10" } },
      { ...evidence, cover: { ...evidence.cover, width: 9 } },
    ];
    for (const [index, invalid] of invalidEvidence.entries()) {
      await fixture.setEvidence(invalid);
      expect(await service.apply(command("prepare", "0", index + 1))).toEqual(status("source-unavailable"));
      expectLedgerOnly(fixture, initial, index + 1);
    }
    await fixture.setEvidence(evidence);
    expect(await service.apply({ ...command("prepare", "0", 1), rightsConfirmed: false })).toEqual(status("invalid"));
    expect(await service.apply({ ...command("prepare", "0", 1), ownerId: actorA })).toEqual(status("invalid"));
    expect(await service.apply(command("complete", "1", 100, "1"))).toEqual(status("conflict"));
    expectLedgerOnly(fixture, initial, invalidEvidence.length + 1);
  });

  it("fails without mutation when a reviewed artifact, rights grant, or public display changes", async () => {
    const fixture = isolatedStore();
    const { service } = fixture;
    const evidence = evidenceFor(workFor(), "1");
    expect(await service.apply(command("prepare", "0", 1))).toMatchObject({ status: "prepared" });
    await fixture.setEvidence({ ...evidence, rights: { ...evidence.rights, reference: "replacement-rights" } });
    const prepared = fixture.snapshot();
    expect(await service.apply(command("complete", "1", 2, "1"))).toEqual(status("source-unavailable"));
    expectLedgerOnly(fixture, prepared, 1);

    await fixture.changeWork(work => ({ ...work, revision: "2", artifact: { ...work.artifact, revision: "12" },
      display: { ...work.display as object, title: "새 작품" } }));
    const changed = fixture.snapshot();
    await fixture.setEvidence(evidenceFor(changed.works[0], "1"));
    expect(await service.apply(command("complete", "1", 20, "1"))).toEqual(status("source-unavailable"));
    expect(await service.apply(command("prepare", "1", 21))).toEqual(status("conflict"));
    expectLedgerOnly(fixture, changed, 2);
    expect(await service.apply(command("revoke", "2", 3, "1"))).toMatchObject({ status: "revoked" });
    expect(fixture.snapshot().audit.at(-1)?.artifactRevision).toBe("11");
  });

  it("requires a fresh queue version if the candidate changes before a reviewer acts", async () => {
    const fixture = isolatedStore();
    const { service } = fixture;
    await fixture.changeWork(work => ({ ...work, revision: "1", artifact: { ...work.artifact, revision: "12" } }));
    const changed = fixture.snapshot();
    await fixture.setEvidence(evidenceFor(changed.works[0], "2"));
    expect(await service.apply(command("prepare", "0", 1))).toEqual(status("conflict"));
    expectLedgerOnly(fixture, changed, 1);
    expect(await service.apply(command("prepare", "1", 2))).toEqual({ status: "prepared", version: "2", generation: "2" });
    expect(fixture.snapshot().audit[0].artifactRevision).toBe("12");
  });

  it("checks generation-bound immutable objects, WebP bytes and rights time before committing", async () => {
    const fixture = isolatedStore();
    const { service, readCover } = fixture;
    const evidence = evidenceFor(workFor(), "1", clock + 100);
    await fixture.setEvidence(evidence);
    expect(await service.apply(command("prepare", "0", 1))).toMatchObject({ status: "prepared" });
    const prepared = fixture.snapshot();
    await fixture.setEvidence({ ...evidence, cover: { ...evidence.cover, objectKey: evidenceFor(workFor(), "2").cover.objectKey } });
    expect(await service.apply(command("complete", "1", 2, "1"))).toEqual(status("source-unavailable"));
    expect(readCover).not.toHaveBeenCalled();
    await fixture.setEvidence(evidence);
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 1] ^= 1;
    readCover.mockResolvedValueOnce(corrupt);
    expect(await service.apply(command("complete", "1", 20, "1"))).toEqual(status("source-unavailable"));
    readCover.mockImplementationOnce(async () => { fixture.setClock(clock + 100); return bytes; });
    expect(await service.apply(command("complete", "1", 21, "1"))).toEqual(status("source-unavailable"));
    expectLedgerOnly(fixture, prepared, 3);

    fixture.setClock(clock + 99);
    expect(await service.apply(command("complete", "1", 22, "1"))).toMatchObject({ status: "published" });
    fixture.setClock(clock + 100);
    expect(fixture.feed().rows).toEqual([]);
    expect((await fixture.cover("1")).status).toBe(404);
  });

  it("serializes duplicate and competing writes, rolls back audits and preserves historical replay after revoke", async () => {
    const fixture = isolatedStore();
    const { service, afterSave } = fixture;
    const first = command("prepare", "0", 1);
    const prepared = { status: "prepared", version: "1", generation: "1" };
    expect(await Promise.all([service.apply(first), service.apply(first), service.apply(command("prepare", "0", 9))]))
      .toEqual([prepared, prepared, status("conflict")]);
    expect(await service.apply({ ...first, expectedVersion: "1" })).toEqual(status("invalid"));
    const before = fixture.snapshot();
    const publish = command("complete", "1", 2, "1");
    afterSave.mockImplementationOnce(() => { throw new Error("synthetic commit failure"); });
    expect(await service.apply(publish)).toEqual(status("unavailable"));
    expect(fixture.snapshot()).toEqual(before);
    const published = { status: "published", version: "2", generation: "1" };
    expect(await service.apply(publish)).toEqual(published);
    expect(await service.apply(command("revoke", "1", 3, "1"))).toMatchObject({ status: "revoked" });
    const retired = fixture.snapshot();
    expect(await service.apply(publish)).toEqual(published);
    expect(await service.apply(command("complete", "1", 4, "1"))).toEqual(status("conflict"));
    expectLedgerOnly(fixture, retired, 1);
    expect((await fixture.cover("1")).status).toBe(404);
  });

  it("revokes only the observed generation and handles both orders of complete versus revoke", async () => {
    const fixture = isolatedStore();
    const { service } = fixture;
    await service.apply(command("prepare", "0", 1));
    await service.apply(command("complete", "1", 2, "1"));
    await fixture.setEvidence(evidenceFor(workFor(), "3"));
    await service.apply(command("prepare", "2", 3));
    expect(await Promise.all([service.apply(command("revoke", "3", 4, "3")), service.apply(command("complete", "3", 5, "3"))]))
      .toEqual([{ status: "revoked", version: "4", generation: "3" }, status("conflict")]);
    expect((await fixture.cover("1")).status).toBe(200);
    expect((await fixture.cover("3")).status).toBe(404);

    await fixture.setEvidence(evidenceFor(workFor(), "5"));
    await service.apply(command("prepare", "4", 6));
    expect(await Promise.all([service.apply(command("complete", "5", 7, "5")), service.apply(command("revoke", "5", 8, "5"))]))
      .toEqual([{ status: "published", version: "6", generation: "5" }, { status: "revoked", version: "7", generation: "5" }]);
    expect(fixture.feed().rows).toEqual([]);
    expect((await fixture.cover("1")).status).toBe(404);
    expect((await fixture.cover("5")).status).toBe(404);
  });

  it("does not retire a prepared replacement when the old active generation is revoked", async () => {
    const fixture = isolatedStore();
    const { service } = fixture;
    await service.apply(command("prepare", "0", 1));
    await service.apply(command("complete", "1", 2, "1"));
    await fixture.setEvidence(evidenceFor(workFor(), "3"));
    await service.apply(command("prepare", "2", 3));
    expect(await service.apply(command("revoke", "2", 4, "1"))).toEqual({ status: "revoked", version: "4", generation: "1" });
    expect(await service.apply(command("complete", "3", 5, "3"))).toEqual({ status: "published", version: "5", generation: "3" });
    expect((await fixture.cover("1")).status).toBe(404);
    expect((await fixture.cover("3")).status).toBe(200);
  });

  it("replays settled evidence failures unchanged after recovery and still rechecks authorization", async () => {
    const fixture = isolatedStore();
    const { service, readEvidence, publishers, resolveAuth } = fixture;
    const intent = command("prepare", "0", 1);
    const before = fixture.snapshot();
    await fixture.setEvidence(null);
    const failed = status("source-unavailable");
    expect(await Promise.all([service.apply(intent), service.apply(intent)])).toEqual([failed, failed]);
    expectLedgerOnly(fixture, before, 1);
    expect(readEvidence).toHaveBeenCalledTimes(1);

    await fixture.setEvidence(evidenceFor(workFor(), "1"));
    expect(await service.apply(intent)).toEqual(failed);
    expect(await service.apply({ ...intent, expectedVersion: "1" })).toEqual(status("invalid"));
    resolveAuth.mockResolvedValueOnce(auth(actorB));
    expect(await service.apply(intent)).toEqual(status("denied"));
    publishers.delete(actorA);
    expect(await service.apply(intent)).toEqual(status("denied"));
    expectLedgerOnly(fixture, before, 1);
    expect(readEvidence).toHaveBeenCalledTimes(1);

    publishers.add(actorA);
    expect(await service.apply(command("prepare", "0", 2))).toMatchObject({ status: "prepared" });
  });

  it("replays a settled conflict when that version later becomes current, and accepts a fresh intent", async () => {
    const fixture = isolatedStore();
    const { service, readEvidence } = fixture;
    const laterVersion = command("prepare", "1", 1);
    const before = fixture.snapshot();
    expect(await service.apply(laterVersion)).toEqual(status("conflict"));
    expectLedgerOnly(fixture, before, 1);
    await fixture.changeWork(work => ({ ...work, revision: "1" }));
    expect(await service.apply(laterVersion)).toEqual(status("conflict"));
    expect(readEvidence).not.toHaveBeenCalled();
    expect(await service.apply(command("prepare", "1", 2))).toEqual({ status: "prepared", version: "2", generation: "2" });
  });

  it("uses the same UUID after auth, evidence, storage or rollback errors and records confirmed absence", async () => {
    const fixture = isolatedStore();
    const { service, resolveAuth, readEvidence, readCover, afterSave } = fixture;
    const prepare = command("prepare", "0", 1);
    const before = fixture.snapshot();
    resolveAuth.mockResolvedValueOnce({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" });
    expect(await service.apply(prepare)).toEqual(status("unavailable"));
    readEvidence.mockRejectedValueOnce(new Error("evidence connection unavailable"));
    expect(await service.apply(prepare)).toEqual(status("unavailable"));
    expect(fixture.snapshot()).toEqual(before);
    expect(await service.apply(prepare)).toMatchObject({ status: "prepared" });

    const complete = command("complete", "1", 2, "1");
    const prepared = fixture.snapshot();
    readCover.mockRejectedValueOnce(new Error("storage timeout")).mockRejectedValueOnce(new Error("storage credential unavailable"));
    expect(await service.apply(complete)).toEqual(status("unavailable"));
    expect(await service.apply(complete)).toEqual(status("unavailable"));
    expect(fixture.snapshot()).toEqual(prepared);
    readCover.mockResolvedValueOnce(null);
    afterSave.mockImplementationOnce(() => { throw new Error("ledger write rolled back"); });
    expect(await service.apply(complete)).toEqual(status("unavailable"));
    expect(fixture.snapshot()).toEqual(prepared);
    readCover.mockResolvedValueOnce(null);
    expect(await service.apply(complete)).toEqual(status("source-unavailable"));
    expectLedgerOnly(fixture, prepared, 1);
    expect(await service.apply(complete)).toEqual(status("source-unavailable"));
    expect(readCover).toHaveBeenCalledTimes(4);
    expect(await service.apply(command("complete", "1", 3, "1"))).toMatchObject({ status: "published" });
  });

  it("recovers a settled failure when its commit succeeded but the response was lost", async () => {
    const fixture = isolatedStore();
    const { service, afterCommit, readEvidence } = fixture;
    const intent = command("prepare", "0", 1);
    const before = fixture.snapshot();
    await fixture.setEvidence(null);
    afterCommit.mockImplementationOnce(() => { throw new Error("response lost after commit"); });
    expect(await service.apply(intent)).toEqual(status("unavailable"));
    expectLedgerOnly(fixture, before, 1);
    await fixture.setEvidence(evidenceFor(workFor(), "1"));
    expect(await service.apply(intent)).toEqual(status("source-unavailable"));
    expectLedgerOnly(fixture, before, 1);
    expect(readEvidence).toHaveBeenCalledTimes(1);
  });

  it("leaves the intent retryable if byte verification fails inconclusively or the clock regresses", async () => {
    const fixture = isolatedStore();
    const { service, readCover } = fixture;
    expect(await service.apply(command("prepare", "0", 1))).toMatchObject({ status: "prepared" });
    const prepared = fixture.snapshot();
    const intent = command("complete", "1", 2, "1");
    const verify = vi.spyOn(coverSource, "verifyCoverBytes").mockRejectedValueOnce(new Error("decoder resources unavailable"));
    try {
      expect(await service.apply(intent)).toEqual(status("unavailable"));
    } finally { verify.mockRestore(); }
    readCover.mockImplementationOnce(async () => { fixture.setClock(clock - 1); return bytes; });
    expect(await service.apply(intent)).toEqual(status("unavailable"));
    expect(fixture.snapshot()).toEqual(prepared);
    fixture.setClock(clock);
    expect(await service.apply(intent)).toMatchObject({ status: "published" });
  });
});
