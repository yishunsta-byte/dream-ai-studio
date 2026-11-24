import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverStore } from "../../lib/public-showcase/cover-source";
import { openIsolatedPublicationPublicReader } from "../../lib/public-showcase/publication-public-reader";

vi.mock("server-only", () => ({}));

type Lease = ReturnType<typeof lease>;
type FakePool = { config: { user: string; database: string; port: number }; connect: ReturnType<typeof vi.fn<() => Promise<Lease>>>;
  end: ReturnType<typeof vi.fn<() => Promise<void>>> };
const fake = vi.hoisted(() => ({ pools: [] as FakePool[], legacy: false, fileRows: [] as object[] }));

function lease(rows: object[] = [], status = "I") {
  return { getTransactionStatus: vi.fn(() => status), query: vi.fn<() => Promise<{ rows: object[] }>>().mockResolvedValue({ rows }),
    release: vi.fn<(destroy: boolean) => void>(), end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
}

vi.mock("pg", () => ({ Pool: class {
  config: FakePool["config"];
  end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  connect = vi.fn(async () => {
    const { user, database, port } = this.config;
    const client = lease();
    client.query = vi.fn(async (sql = "") => {
      if (sql.includes("current_user")) return { rows: [{ role: user, login: user, db: database, port, host: "127.0.0.1",
        version: "170012", list: user === "t295_read_list", cover: user === "t295_read_file", legacy: fake.legacy }] };
      if (sql.includes("find_cover")) return { rows: fake.fileRows };
      return { rows: [{ value: { nowMs: "1700000000000", rows: [] } }] };
    });
    return client;
  });
  constructor(config: FakePool["config"]) { this.config = config; fake.pools.push(this); }
  on() { return this; }
} }));

const data = Uint8Array.of(1, 2, 3);
const address = { slug: "work", generation: "1" };
const sha = "a".repeat(64);
const key = `work/1/${sha}.webp`;
const row = { object_key: key, mime: "image/webp", size_bytes: data.length, sha };
const signal = () => new AbortController().signal;
const options = () => ({ profile: "t295-loopback-fixture" as const, database: `t253_${"a".repeat(32)}`, port: 51000,
  listPassword: "synthetic-list-password", filePassword: "synthetic-file-password", timeoutMs: 1000,
  readPrivateCover: vi.fn<CoverStore["readObject"]>().mockResolvedValue(data) });

async function active(config = options()) {
  const readers = await openIsolatedPublicationPublicReader(config);
  if (readers.showcaseSource.mode !== "active" || !readers.showcaseSource.store || readers.coverSource.mode !== "active" ||
    !readers.coverSource.store) throw new Error("Fixture did not activate");
  return { list: readers.showcaseSource.store, cover: readers.coverSource.store, close: readers.close };
}

beforeEach(() => { fake.pools.length = 0; fake.legacy = false; fake.fileRows = []; });

describe("publication public reader lease and byte boundaries", () => {
  it("leaves both sources disabled without verified separate read roles", async () => {
    expect((await openIsolatedPublicationPublicReader()).coverSource.mode).toBe("inactive");
    expect((await openIsolatedPublicationPublicReader({ ...options(), database: "other" })).showcaseSource.mode).toBe("sample");
    expect(fake.pools).toHaveLength(0);
    fake.legacy = true;
    const failed = await openIsolatedPublicationPublicReader(options());
    expect(failed.coverSource.mode).toBe("inactive");
    expect(failed.showcaseSource.mode).toBe("sample");
    expect(fake.pools).toHaveLength(2);
    for (const pool of fake.pools) expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("rejects a dirty transaction without querying or returning it to the pool", async () => {
    const reader = await active();
    try {
      const dirty = lease([], "T");
      fake.pools[0].connect.mockResolvedValueOnce(dirty);
      await expect(reader.list.listApproved(signal())).rejects.toMatchObject({ code: "query" });
      expect(dirty.query).not.toHaveBeenCalled();
      expect(dirty.release).toHaveBeenCalledExactlyOnceWith(true);
      const healthy = lease([{ value: { nowMs: "1700000000000", rows: [] } }]);
      fake.pools[0].connect.mockResolvedValueOnce(healthy);
      await expect(reader.list.listApproved(signal())).resolves.toMatchObject({ rows: [] });
      expect(healthy.query).toHaveBeenCalledExactlyOnceWith("SELECT t295.list_approved() AS value", []);
      expect(healthy.release).toHaveBeenCalledExactlyOnceWith(false);
    } finally { await reader.close(); }
  });

  it("does not query a late checkout after cancellation and retires an in-flight query once", async () => {
    const reader = await active();
    try {
      const pool = fake.pools[0];
      const ctrl = new AbortController();
      const late = Promise.withResolvers<Lease>();
      const initial = pool.connect.mock.calls.length;
      pool.connect.mockReturnValueOnce(late.promise);
      const rejected = expect(reader.list.listApproved(ctrl.signal)).rejects.toMatchObject({ code: "timeout" });
      await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(initial + 1));
      ctrl.abort();
      await rejected;
      const arrived = lease();
      late.resolve(arrived);
      await vi.waitFor(() => expect(arrived.release).toHaveBeenCalledExactlyOnceWith(true));
      expect(arrived.query).not.toHaveBeenCalled();

      const reading = lease();
      const pending = Promise.withResolvers<{ rows: object[] }>();
      reading.query.mockReturnValueOnce(pending.promise);
      pool.connect.mockResolvedValueOnce(reading);
      const later = new AbortController();
      const second = expect(reader.list.listApproved(later.signal)).rejects.toMatchObject({ code: "timeout" });
      await vi.waitFor(() => expect(reading.query).toHaveBeenCalledTimes(1));
      later.abort();
      await second;
      pending.reject(new Error("connection ended during the cancelled read"));
      await Promise.resolve();
      expect(reading.release).toHaveBeenCalledExactlyOnceWith(true);

      const count = pool.connect.mock.calls.length;
      await expect(reader.list.listApproved(AbortSignal.abort())).rejects.toMatchObject({ code: "timeout" });
      expect(pool.connect).toHaveBeenCalledTimes(count);
    } finally { await reader.close(); }
  });

  it("rechecks active generation before private bytes and enforces key and length", async () => {
    const config = options();
    const reader = await active(config);
    try {
      fake.fileRows = [row];
      expect(await reader.cover.findCover(address, signal())).toEqual({ objectKey: key, mime: "image/webp", sizeBytes: 3, sha });
      await expect(reader.cover.readObject(key, { maxBytes: 2, signal: signal() })).rejects.toMatchObject({ code: "permission" });
      await expect(reader.cover.readObject("private/path", { maxBytes: 3, signal: signal() })).rejects.toMatchObject({ code: "contract" });
      fake.fileRows = [];
      await expect(reader.cover.readObject(key, { maxBytes: 3, signal: signal() })).rejects.toMatchObject({ code: "permission" });
      expect(config.readPrivateCover).not.toHaveBeenCalled();
      fake.fileRows = [{ ...row, object_key: `work/2/${sha}.webp` }];
      await expect(reader.cover.findCover(address, signal())).rejects.toMatchObject({ code: "contract" });
      fake.fileRows = [row];
      config.readPrivateCover.mockResolvedValueOnce(Uint8Array.of(1));
      await expect(reader.cover.readObject(key, { maxBytes: 3, signal: signal() })).rejects.toMatchObject({ code: "contract" });
      const copied = await reader.cover.readObject(key, { maxBytes: 100, signal: signal() });
      expect(copied).toEqual(data);
      expect(copied).not.toBe(data);
      expect(config.readPrivateCover).toHaveBeenLastCalledWith(key, { maxBytes: 3, signal: expect.any(AbortSignal) });
    } finally { await reader.close(); }
  });

  it("does not publish a late result from cancelled private storage", async () => {
    const config = options();
    const reader = await active(config);
    try {
      fake.fileRows = [row];
      const storage = Promise.withResolvers<Uint8Array>();
      config.readPrivateCover.mockReturnValueOnce(storage.promise);
      const controller = new AbortController();
      const pending = expect(reader.cover.readObject(key, { maxBytes: 3, signal: controller.signal })).rejects.toMatchObject({ code: "timeout" });
      await vi.waitFor(() => expect(config.readPrivateCover).toHaveBeenCalledTimes(1));
      controller.abort();
      await pending;
      storage.resolve(data);
      await expect(reader.cover.readObject(key, { maxBytes: 3, signal: signal() })).resolves.toEqual(data);
    } finally { await reader.close(); }
  });

  it("confirms only the exact active metadata and closes missing, changed, or malformed rows", async () => {
    const config = options();
    const reader = await active(config);
    try {
      fake.fileRows = [row];
      const expected = await reader.cover.findCover(address, signal());
      expect(expected).not.toBeNull();
      expect(await reader.cover.confirmCover!(address, expected!, signal())).toBe(true);
      fake.fileRows = [{ ...row, size_bytes: row.size_bytes + 1 }];
      expect(await reader.cover.confirmCover!(address, expected!, signal())).toBe(false);
      fake.fileRows = [];
      expect(await reader.cover.confirmCover!(address, expected!, signal())).toBe(false);
      fake.fileRows = [{ ...row, object_key: `work/2/${sha}.webp` }];
      await expect(reader.cover.confirmCover!(address, expected!, signal())).rejects.toMatchObject({ code: "contract" });
      expect(config.readPrivateCover).not.toHaveBeenCalled();
    } finally { await reader.close(); }
  });
});
