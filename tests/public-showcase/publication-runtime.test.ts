import { describe, expect, it, vi } from "vitest";
import { createAdminPublicationHttp } from "../../lib/public-showcase/admin-publication-http";
import { createPublicationRuntime } from "../../lib/public-showcase/publication-runtime";
import { ACTOR_A, post, verified } from "../admin/publication-http-fixture";

vi.mock("server-only", () => ({}));

const target = "synthetic/approved";
const inactive = { mode: "inactive", adminStore: null, showcaseSource: { mode: "sample" }, coverSource: { mode: "inactive" } };

function providers() {
  const closeAdmin = vi.fn(async () => {});
  const closePublic = vi.fn(async () => {});
  const openAdmin = vi.fn(async () => ({ verifiedTarget: target, store: { transaction: vi.fn() }, close: closeAdmin }));
  const openPublic = vi.fn(async () => ({
    verifiedListTarget: target,
    verifiedCoverTarget: target,
    showcaseSource: { mode: "active", store: { listApproved: vi.fn() } },
    coverSource: { mode: "active", store: { findCover: vi.fn(), readObject: vi.fn(), confirmCover: vi.fn() } },
    close: closePublic,
  } as const));
  return { options: { approvedTarget: target, openAdmin, openPublic }, closeAdmin, closePublic };
}

describe("publication runtime lifecycle", () => {
  it("shares initialization across simultaneous consumers and shuts down the handles once", async () => {
    const { options, closeAdmin, closePublic } = providers();
    const config = Promise.withResolvers<typeof options>();
    const load = vi.fn(() => config.promise);
    const runtime = createPublicationRuntime(load);
    const concurrent = [runtime.get(), runtime.get(), runtime.get()];
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    expect(options.openAdmin).not.toHaveBeenCalled();
    config.resolve(options);
    const [admin, home, cover] = await Promise.all(concurrent);
    expect(admin.mode).toBe("active");
    expect(home).toBe(admin);
    expect(cover).toBe(admin);
    expect(options.openAdmin).toHaveBeenCalledOnce();
    expect(options.openPublic).toHaveBeenCalledOnce();

    const closing = runtime.close();
    expect(runtime.close()).toBe(closing);
    expect(await runtime.get()).toEqual(inactive);
    await closing;
    expect(closeAdmin).toHaveBeenCalledOnce();
    expect(closePublic).toHaveBeenCalledOnce();
  });

  it("stays inactive after missing configuration or an initialization error", async () => {
    const missing = vi.fn(() => undefined);
    const { options, closeAdmin } = providers();
    options.openPublic.mockRejectedValueOnce(new Error("failed to open readers"));
    const afterOpenFailure = vi.fn(() => options);
    const loaderFailure = vi.fn(async () => { throw new Error("failed to load config"); });
    for (const load of [missing, afterOpenFailure, loaderFailure]) {
      const runtime = createPublicationRuntime(load);
      expect(await Promise.all([runtime.get(), runtime.get()])).toEqual([inactive, inactive]);
      expect(await runtime.get()).toEqual(inactive);
      expect(load).toHaveBeenCalledOnce();
      await runtime.close();
    }
    expect(closeAdmin).toHaveBeenCalledOnce();
  });

  it("does not initialize after stopping before the first access", async () => {
    const load = vi.fn(() => undefined);
    const runtime = createPublicationRuntime(load);
    await runtime.close();
    expect(await runtime.get()).toEqual(inactive);
    expect(load).not.toHaveBeenCalled();
  });

  it("closes handles opened during shutdown without exposing them to waiting consumers", async () => {
    const { options, closeAdmin, closePublic } = providers();
    const waitToOpen = Promise.withResolvers<void>();
    const opened = Promise.withResolvers<void>();
    const openAdmin = async () => {
      opened.resolve();
      await waitToOpen.promise;
      return options.openAdmin();
    };
    const runtime = createPublicationRuntime(() => ({ ...options, openAdmin }));
    const first = runtime.get();
    await opened.promise;
    const closing = runtime.close();
    expect(await runtime.get()).toEqual(inactive);
    waitToOpen.resolve();
    expect(await first).toEqual(inactive);
    await closing;
    expect(closeAdmin).toHaveBeenCalledOnce();
    expect(closePublic).toHaveBeenCalledOnce();
  });

  it("keeps authentication and origin checks ahead of opening an async administrator store", async () => {
    const store = vi.fn(async () => { throw new Error("store rejected"); });
    const request = createAdminPublicationHttp({ store, resolveAuth: async () => verified(ACTOR_A), env: {} });
    expect((await request.handlePost(post("{}", { origin: "https://example.invalid" }))).status).toBe(403);
    expect(store).not.toHaveBeenCalled();
    const rejected = await request.handlePost(post("{}"));
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ code: "PUBLICATION_UNLINKED" });
    expect(await request.list()).toEqual({ kind: "closed" });
    expect(store).toHaveBeenCalledOnce();
  });
});
