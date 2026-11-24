import { describe, expect, it, vi } from "vitest";
import { createAdminPublicationHttp } from "../../lib/public-showcase/admin-publication-http";
import { findActivePublicationCover, projectApprovedPublications } from "../../lib/public-showcase/admin-publication-service";
import { serveCover, type CoverStore } from "../../lib/public-showcase/cover-source";
import { assemblePublicationProviders } from "../../lib/public-showcase/publication-provider-assembly";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import { ACTOR_A, evidence, post, requestId, syntheticCover, syntheticStore, verified, work } from "../admin/publication-http-fixture";

vi.mock("server-only", () => ({}));

const target = "synthetic-cluster/publications";
const slug = "neon-alley";
const now = 1_790_000_000_000;
const inactive = { mode: "inactive", adminStore: null, showcaseSource: { mode: "sample" }, coverSource: { mode: "inactive" } };

function handles() {
  const admin = { verifiedTarget: target, store: { transaction: vi.fn() }, close: vi.fn(async () => {}) };
  const readers = {
    verifiedListTarget: target,
    verifiedCoverTarget: target,
    showcaseSource: { mode: "active", store: { listApproved: vi.fn() } },
    coverSource: { mode: "active", store: { findCover: vi.fn(), readObject: vi.fn(), confirmCover: vi.fn() } },
    close: vi.fn(async () => {}),
  } as const;
  return { admin, readers, openAdmin: vi.fn(async () => admin), openPublic: vi.fn(async () => readers) };
}

describe("publication provider assembly", () => {
  it("keeps all providers inactive before opening anything when configuration or a supplier is absent", async () => {
    const { openAdmin, openPublic } = handles();
    expect(await assemblePublicationProviders()).toEqual(inactive);
    expect(await assemblePublicationProviders({ approvedTarget: "", openAdmin, openPublic })).toEqual(inactive);
    expect(await assemblePublicationProviders({ approvedTarget: " target ", openAdmin, openPublic })).toEqual(inactive);
    // @ts-expect-error Runtime startup must also fail closed when an opener is missing.
    expect(await assemblePublicationProviders({ approvedTarget: target, openAdmin })).toEqual(inactive);
    expect(openAdmin).not.toHaveBeenCalled();
    expect(openPublic).not.toHaveBeenCalled();
  });

  it("closes a writer on the wrong database before opening public readers", async () => {
    const { admin, openAdmin, openPublic } = handles();
    admin.verifiedTarget = "other-cluster/publications";
    expect(await assemblePublicationProviders({ approvedTarget: target, openAdmin, openPublic })).toEqual(inactive);
    expect(admin.close).toHaveBeenCalledOnce();
    expect(openPublic).not.toHaveBeenCalled();
  });

  it.each(["verifiedListTarget", "verifiedCoverTarget"] as const)("closes all providers on %s mismatch", async (role) => {
    const { admin, readers, openAdmin } = handles();
    const openPublic = async () => ({ ...readers, [role]: "synthetic-cluster/other-db" });
    expect(await assemblePublicationProviders({ approvedTarget: target, openAdmin, openPublic })).toEqual(inactive);
    expect(admin.close).toHaveBeenCalledOnce();
    expect(readers.close).toHaveBeenCalledOnce();
  });

  it("rejects a public pair missing its final cover check and closes both handles", async () => {
    const { admin, readers, openAdmin } = handles();
    const { findCover, readObject } = readers.coverSource.store;
    const openPublic = async () => ({ ...readers, coverSource: { mode: "active", store: { findCover, readObject } } } as const);
    expect(await assemblePublicationProviders({ approvedTarget: target, openAdmin, openPublic })).toEqual(inactive);
    expect(admin.close).toHaveBeenCalledOnce();
    expect(readers.close).toHaveBeenCalledOnce();
  });

  it("keeps all providers inactive on startup rejection and attempts acquired handle cleanup", async () => {
    const { admin, openAdmin, openPublic } = handles();
    openAdmin.mockRejectedValueOnce(new Error("admin startup"));
    expect(await assemblePublicationProviders({ approvedTarget: target, openAdmin, openPublic })).toEqual(inactive);
    expect(openPublic).not.toHaveBeenCalled();
    openPublic.mockRejectedValueOnce(new Error("public startup"));
    admin.close.mockRejectedValueOnce(new Error("admin cleanup"));
    expect(await assemblePublicationProviders({ approvedTarget: target, openAdmin, openPublic })).toEqual(inactive);
    expect(admin.close).toHaveBeenCalledOnce();
  });

  it("shares shutdown across callers and waits for both closes when one rejects", async () => {
    const { admin, readers, openAdmin, openPublic } = handles();
    const pending = Promise.withResolvers<void>();
    admin.close.mockRejectedValueOnce(new Error("admin cleanup"));
    readers.close.mockReturnValueOnce(pending.promise);
    const assembly = await assemblePublicationProviders({ approvedTarget: target, openAdmin, openPublic });
    if (assembly.mode !== "active") throw new Error("Expected an active assembly");
    const close = assembly.close();
    const done = vi.fn();
    void close.catch(done);
    expect(assembly.close()).toBe(close);
    await Promise.resolve();
    expect(admin.close).toHaveBeenCalledOnce();
    expect(readers.close).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled();
    pending.resolve();
    await expect(close).rejects.toThrow("Publication provider shutdown failed");
  });

  it("reflects committed publish, revoke, republish, and expiry in the list and both cover methods", async () => {
    const bytes = await syntheticCover();
    const item = work(ACTOR_A, slug, 1);
    const fixture = syntheticStore(bytes, [item]);
    const expiry = now + 1_000;
    let clock = now;
    let expireDuringRead = false;
    const currentCover: CoverStore["findCover"] = async (address) => {
      const committed = fixture.snapshot().works[0];
      return findActivePublicationCover(committed, address, clock);
    };
    const readObject = vi.fn<CoverStore["readObject"]>(async () => {
      if (expireDuringRead) clock = expiry;
      return bytes.bytes;
    });
    const assembly = await assemblePublicationProviders({
      approvedTarget: target,
      openAdmin: async () => ({ verifiedTarget: target, store: fixture.store, close: async () => {} }),
      openPublic: async () => ({
        verifiedListTarget: target,
        verifiedCoverTarget: target,
        close: async () => {},
        showcaseSource: { mode: "active", store: { listApproved: async () => projectApprovedPublications(fixture.snapshot().works, clock) } },
        coverSource: { mode: "active", store: {
          findCover: currentCover,
          readObject,
          async confirmCover(address, expected, signal) {
            const current = await currentCover(address, signal);
            return current?.objectKey === expected.objectKey && current.sha === expected.sha;
          },
        } },
      }),
    });
    if (assembly.mode !== "active") throw new Error("Expected an active assembly");

    const path = (generation: string) => `/media/public/${slug}/${generation}/cover.webp`;
    const cover = (generation: string, method: "GET" | "HEAD") =>
      serveCover(new Request(`https://test.invalid${path(generation)}`, { method }), assembly.coverSource);
    const checkHidden = async (generation: string) => {
      for (const method of ["GET", "HEAD"] as const) expect((await cover(generation, method)).status).toBe(404);
    };
    const feed = () => loadShowcaseFeed(assembly.showcaseSource);
    const command = async (index: number, command: "prepare" | "complete" | "revoke", expectedVersion: string, generation: string | null) => {
      const http = createAdminPublicationHttp({ store: () => assembly.adminStore, resolveAuth: async () => verified(ACTOR_A), now: () => clock, env: {} });
      const response = await http.handlePost(post(JSON.stringify({ requestId: requestId(index), slug, command, expectedVersion,
        generation, rightsConfirmed: command !== "revoke" })));
      expect(response.status).toBe(200);
      return response.json();
    };

    try {
      expect(await command(1, "prepare", "0", null)).toEqual({ status: "prepared", version: "1", generation: "1" });
      expect((await feed()).state).toBe("empty");
      await checkHidden("1");
      expect(readObject).not.toHaveBeenCalled();
      expect(await command(2, "complete", "1", "1")).toEqual({ status: "published", version: "2", generation: "1" });
      expect((await feed()).works.map(entry => entry.image?.src)).toEqual([path("1")]);
      const get = await cover("1", "GET");
      expect(get.status).toBe(200);
      expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes.bytes);
      const head = await cover("1", "HEAD");
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");

      expect(await command(3, "revoke", "2", "1")).toEqual({ status: "revoked", version: "3", generation: "1" });
      expect((await feed()).state).toBe("empty");
      await checkHidden("1");
      const timed = evidence(item, "4", bytes);
      fixture.setEvidence(slug, { ...timed, rights: { ...timed.rights, expiresAtMs: expiry } });
      expect(await command(4, "prepare", "3", null)).toEqual({ status: "prepared", version: "4", generation: "4" });
      expect(await command(5, "complete", "4", "4")).toEqual({ status: "published", version: "5", generation: "4" });
      expect((await feed()).works.map(entry => entry.image?.src)).toEqual([path("4")]);
      await checkHidden("1");

      expireDuringRead = true;
      expect((await cover("4", "GET")).status).toBe(404);
      expect((await feed()).state).toBe("empty");
      await checkHidden("4");
    } finally {
      await assembly.close();
    }
  });
});
