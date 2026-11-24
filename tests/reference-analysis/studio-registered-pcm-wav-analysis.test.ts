import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import * as contract from "../../lib/reference-analysis/studio-analysis-contract";
import { createIsolatedRegisteredPcmWavAnalysis } from "../../lib/reference-analysis/studio-registered-pcm-wav-analysis";

vi.mock("server-only", () => ({}));

const actor = actorFromVerifiedUserId("10000000-0000-4000-8000-000000000001");
const otherOwner = "10000000-0000-4000-8000-000000000002";
const selection = { projectId: "10000000-0000-4000-8000-000000000003", assetId: "10000000-0000-7000-8000-000000000004" };
const verified: ServerAuthResult = { kind: "verified", userId: actor.id, email: "synthetic@example.invalid" };
const unavailable = { schemaVersion: 1, status: "unavailable", reason: "source_unavailable" };
const freshSignal = () => new AbortController().signal;
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const bytes = Buffer.alloc(52);
bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
bytes.write("data", 36); bytes.writeUInt32LE(8, 40);
const evidence = {
  status: "authorized", ownerId: actor.id, ...selection, purpose: "rea-reference",
  storeId: "owned-wav", restoreGeneration: "restore-1", linkGeneration: "1",
  ownerPermissionGeneration: "1", scopePermissionGeneration: "3", registrationGeneration: "source-2",
  authorizedRegistrationGeneration: "source-2", mime: "audio/wav", sizeBytes: bytes.length, sha256: digest(bytes), bytes,
};

describe("isolated registered PCM analysis adapter", () => {
  let workRoot: string;
  beforeAll(async () => { workRoot = await realpath(await mkdtemp(join(tmpdir(), "dream-pcm-adapter-"))); });
  afterEach(async () => {
    vi.restoreAllMocks();
    expect(await readdir(workRoot)).toEqual([]);
  });
  afterAll(async () => { if (workRoot) await rmdir(workRoot); });

  const options = (readRegistration: () => Promise<unknown>, auth: ServerAuthResult = verified) => ({
    profile: "isolated-registered-pcm-wav" as const, workRoot, resolveAuth: async () => auth, readRegistration,
  });

  it("requires explicit isolated dependencies and a private local path", () => {
    const read = vi.fn();
    expect(createIsolatedRegisteredPcmWavAnalysis()).toBeUndefined();
    expect(createIsolatedRegisteredPcmWavAnalysis({ ...options(read), workRoot: "relative" })).toBeUndefined();
    expect(createIsolatedRegisteredPcmWavAnalysis({ ...options(read), workRoot: join(workRoot, "public") })).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects unconfirmed or changed accounts before reading registration", async () => {
    const read = vi.fn();
    for (const auth of [{ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" },
      { ...verified, userId: otherOwner }] as const) {
      const adapter = createIsolatedRegisteredPcmWavAnalysis(options(read, auth))!;
      expect(await adapter.analyzeRegisteredSource(actor, selection, freshSignal())).toEqual(unavailable);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses unknown, mismatched, revoked and invalid registrations without staging any file", async () => {
    const invalidPcm = Buffer.from(bytes);
    invalidPcm.writeUInt32LE(7, 40);
    const read = vi.fn();
    const adapter = createIsolatedRegisteredPcmWavAnalysis(options(read))!;
    for (const row of [undefined, { ...evidence, status: "revoked" }, { ...evidence, ownerId: otherOwner },
      { ...evidence, projectId: otherOwner }, { ...evidence, assetId: otherOwner }, { ...evidence, purpose: "productionAudio" },
      { ...evidence, scopePermissionGeneration: "0" }, { ...evidence, authorizedRegistrationGeneration: "old" },
      { ...evidence, sizeBytes: 1048577 }, { ...evidence, sha256: "0".repeat(64) },
      { ...evidence, bytes: invalidPcm, sha256: digest(invalidPcm) }]) {
      read.mockResolvedValueOnce(row);
      expect(await adapter.analyzeRegisteredSource(actor, selection, freshSignal())).toEqual(unavailable);
      expect(await readdir(workRoot)).toEqual([]);
    }
    read.mockRejectedValueOnce(new Error("private fixture failure"));
    expect(await adapter.analyzeRegisteredSource(actor, selection, freshSignal())).toEqual(unavailable);
  });

  it("removes the verified staged file even if the final provider read stalls during abort", async () => {
    const stop = new AbortController();
    const stalled = Promise.withResolvers<unknown>();
    const waiting = Promise.withResolvers<void>();
    const read = vi.fn().mockResolvedValueOnce(evidence).mockImplementationOnce(() => {
      waiting.resolve();
      return stalled.promise;
    });
    const adapter = createIsolatedRegisteredPcmWavAnalysis(options(read))!;
    vi.spyOn(contract, "analyzeStudioReference").mockImplementation(async (_, dependencies) => {
      const source = await dependencies.resolveRegisteredSource(actor, selection, stop.signal) as { path: string };
      expect(await readFile(source.path)).toEqual(bytes);
      const recheck = dependencies.resolveRegisteredSource(actor, selection, stop.signal);
      const cancelled = expect(recheck).rejects.toMatchObject({ name: "AbortError" });
      await waiting.promise;
      stop.abort();
      await cancelled;
      return { schemaVersion: 1, status: "unavailable", reason: "cancelled" };
    });
    expect(await adapter.analyzeRegisteredSource(actor, selection, stop.signal)).toEqual({ ...unavailable, reason: "cancelled" });
    expect(read).toHaveBeenCalledTimes(2);
    for (const [, , signal] of read.mock.calls) expect(signal).toBe(stop.signal);
    stalled.resolve(evidence);
  });
});
