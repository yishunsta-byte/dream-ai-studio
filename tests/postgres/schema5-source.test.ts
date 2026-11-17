import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ read: vi.fn(), pool: vi.fn(() => { throw new Error("B37 native I/O forbidden"); }) }));
vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({ Pool: io.pool }));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>(), readFile: io.read }));
const files = ["0001_schema.sql", "0002_invariants.sql", "0003_rls.sql", "0004_storage_verification.sql", "0005_upload_reservation.sql"];
const root = new URL("../../lib/db/postgres/", import.meta.url);
const originals = new Map<string, string>();
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const fuse = "DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;";
const name = (path: URL) => decodeURIComponent(path.pathname.split("/").at(-1)!);
const api = () => import("@/lib/db/postgres/migration-manifest-v3");
let draft: string, experimental: string;
beforeAll(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  for (const file of files) originals.set(file, (await actual.readFile(new URL(file, root), "utf8")).replaceAll("\r\n", "\n"));
  draft = (await actual.readFile(new URL("drafts/0005_upload_reservation.sql", root), "utf8")).replaceAll("\r\n", "\n");
  experimental = draft.replace(fuse, "");
});
beforeEach(() => {
  vi.resetModules(); io.read.mockReset(); io.pool.mockClear();
  io.read.mockImplementation(async (path: URL, encoding: string) => {
    expect(encoding).toBe("utf8"); expect(path.href).toBe(new URL(name(path), root).href);
    const value = originals.get(name(path)); if (value === undefined) throw new Error("unexpected fixed path"); return value;
  });
});
function deferred() { let resolve!: (value: string) => void; const promise = new Promise<string>(r => { resolve = r; }); return { promise, resolve }; }

describe("B37 isolated schema5 source publication; no database execution", () => {
  it("imports without I/O and exposes only immutable schema5 source metadata", async () => {
    const m = await api(); expect(io.read).not.toHaveBeenCalled(); expect(io.pool).not.toHaveBeenCalled();
    expect(Object.keys(m).sort()).toEqual(["loadPostgresMigrationsV3", "postgresMigrationManifestsV3", "postgresSchema5SourcePublicationV3", "requirePostgresSchemaVersionV3"].sort());
    expect(Object.keys(m.postgresMigrationManifestsV3)).toEqual(["5"]);
    const rows = m.postgresMigrationManifestsV3[5];
    expect(rows.map(r => r.ordinal)).toEqual([1, 2, 3, 4, 5]); expect(rows.map(r => r.file)).toEqual(files);
    expect(new Set(rows.map(r => r.id)).size).toBe(5);
    for (const object of [m.postgresMigrationManifestsV3, rows, ...rows, m.postgresSchema5SourcePublicationV3,
      m.postgresSchema5SourcePublicationV3.draft, m.postgresSchema5SourcePublicationV3.experimental]) expect(Object.isFrozen(object)).toBe(true);
    expect(Reflect.set(rows[4], "checksum", "0".repeat(64))).toBe(false);
    expect(() => Reflect.apply(Array.prototype.reverse, rows, [])).toThrow();
  });
  it("binds exact D/E/P and allows only header change plus one removed fuse", async () => {
    const m = await api(), published = originals.get(files[4])!, mapping = m.postgresSchema5SourcePublicationV3;
    expect(sha(draft)).toBe(mapping.draft.checksum); expect(sha(experimental)).toBe(mapping.experimental.checksum);
    expect(draft.indexOf(fuse)).toBe(252); expect(fuse.length).toBe(87); expect(draft.split(fuse)).toHaveLength(2);
    const oldPrefix = draft.slice(0, draft.indexOf("\nBEGIN;\n"));
    const newPrefix = "-- Schema5 local source publication: B37. Isolated v3 source validation only.\n-- No runner, descriptor, target authorization or runtime activation is supplied.\n-- Execution requires a separately approved schema5 migration action.";
    expect(published).toBe(newPrefix + experimental.slice(oldPrefix.length)); expect(published.includes(fuse)).toBe(false);
    expect(sha(published)).toBe("f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339");
    expect(mapping.published.checksum).toBe(sha(published));
    const rows = await m.loadPostgresMigrationsV3(5), body = rows[4].sql;
    expect(Buffer.from(body).equals(Buffer.from(experimental.slice(252, experimental.lastIndexOf("\nCOMMIT;"))))).toBe(true);
    expect(sha(body)).toBe(mapping.experimental.bodyChecksum); expect(body.startsWith("\n")).toBe(true);
    expect(body).toContain("BEGIN\n"); expect(body).toContain("$inventory$");
    expect(io.read).toHaveBeenCalledTimes(5); expect(io.pool).not.toHaveBeenCalled();
  });
  it("verifies every complete source before fixed outer wrapper/body mapping", async () => {
    const m = await api(), rows = await m.loadPostgresMigrationsV3(5);
    for (const [i, row] of rows.entries()) {
      const source = originals.get(files[i])!;
      expect(row).toEqual({ ...m.postgresMigrationManifestsV3[5][i], sql: source.slice(row.bodyStart, row.bodyEnd) });
      expect(sha(source)).toBe(row.checksum); expect(source.length).toBe(row.sourceCharacters);
      expect(sha(source.slice(0, row.bodyStart))).toBe(row.prefixChecksum); expect(sha(row.sql)).toBe(row.bodyChecksum);
      expect(source.slice(0, row.bodyStart).endsWith("\nBEGIN;\n")).toBe(true);
      expect(source.slice(row.bodyEnd)).toBe("\nCOMMIT;\n"); expect(Object.isFrozen(row)).toBe(true);
      expect(row).not.toBe(m.postgresMigrationManifestsV3[5][i]);
    }
    expect(Object.isFrozen(rows)).toBe(true);
  });
  it("accepts only CRLF-to-LF normalization without trimming body bytes", async () => {
    io.read.mockImplementation(async (path: URL) => originals.get(name(path))!.replaceAll("\n", "\r\n"));
    const rows = await (await api()).loadPostgresMigrationsV3(5);
    expect(rows.every(r => !r.sql.includes("\r"))).toBe(true); expect(rows[4].sql.startsWith("\n")).toBe(true);
  });
  it.each([undefined, null, 0, 3, 4, 6, "5", "latest", "05", 5.1, NaN, Infinity, {}, [], new Number(5)])("rejects unknown schema %s before reads", async version => {
    const m = await api(); await expect(m.loadPostgresMigrationsV3(version)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(io.read).not.toHaveBeenCalled(); expect(io.pool).not.toHaveBeenCalled();
  });
  it("rejects missing/extra root, manifest, catalog or hook arguments without reading getters", async () => {
    const m = await api(); let reads = 0;
    const overrides = { get sourceRoot() { reads++; return root; }, get manifest() { reads++; return [1, 1, 3, 4, 5]; } };
    for (const args of [[], [5, undefined], [5, root], [5, overrides], [5, { manifest: files.toReversed() }], [5, { catalog: {} }]])
      await expect(Reflect.apply(m.loadPostgresMigrationsV3, null, args)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    await expect(m.loadPostgresMigrationsV3({ get version() { reads++; return 5; } })).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(reads).toBe(0); expect(io.read).not.toHaveBeenCalled();
  });
  it.each(files)("rejects any full-source drift in %s", async file => {
    io.read.mockImplementation(async (path: URL) => originals.get(name(path))! + (name(path) === file ? "-- changed\n" : ""));
    await expect((await api()).loadPostgresMigrationsV3(5)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
  });
  it.each(["BOM", "trailing-space", "trailing-SQL", "missing-BEGIN", "missing-COMMIT", "prepend-SQL", "CR-only", "trim", "header", "body", "duplicate-wrapper", "draft-D", "experimental-E", "zero-placeholder", "unset-placeholder"])("rejects SQL5 %s", async mutation => {
    const p = originals.get(files[4])!;
    const changed: Record<string, string> = { BOM: "\uFEFF" + p, "trailing-space": p + " ", "trailing-SQL": p + "SELECT 1;\n",
      "missing-BEGIN": p.replace("\nBEGIN;\n", "\n"), "missing-COMMIT": p.replace("\nCOMMIT;\n", "\n"),
      "prepend-SQL": "SELECT 1;\n" + p, "CR-only": p.replaceAll("\n", "\r"), trim: p.trim(),
      header: p.replace("B37", "B38"), body: p.replace("VOLATILE", "STABLE"), "duplicate-wrapper": p.replace("\nBEGIN;\n", "\nBEGIN;\nBEGIN;\n"),
      "draft-D": draft, "experimental-E": experimental, "zero-placeholder": "0".repeat(p.length), "unset-placeholder": "PUBLICATION_PENDING" };
    io.read.mockImplementation(async (path: URL) => name(path) === files[4] ? changed[mutation] : originals.get(name(path))!);
    await expect((await api()).loadPostgresMigrationsV3(5)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
  });
  it.each(["swapped", "duplicated"])("rejects %s source contents rather than learning a manifest", async mutation => {
    io.read.mockImplementation(async (path: URL) => {
      const file = name(path), index = files.indexOf(file);
      return originals.get(index === 0 ? files[1] : mutation === "swapped" && index === 1 ? files[0] : file)!;
    });
    await expect((await api()).loadPostgresMigrationsV3(5)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
  });
  it("read failure is closed with no secret cause or partial result", async () => {
    const canary = "B37_SOURCE_SECRET"; io.read.mockRejectedValue(new Error(canary));
    const error = await (await api()).loadPostgresMigrationsV3(5).catch(e => e);
    expect(error).toMatchObject({ code: "MIGRATION_SOURCE", message: "MIGRATION_SOURCE" });
    expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain(canary); expect(io.pool).not.toHaveBeenCalled();
  });
  it("rejects non-text read values without invoking coercion getters", async () => {
    let reads = 0;
    io.read.mockResolvedValue({ get toString() { reads++; throw new Error("B37_COERCION_SECRET"); } });
    await expect((await api()).loadPostgresMigrationsV3(5)).rejects.toMatchObject({ code: "MIGRATION_SOURCE" });
    expect(reads).toBe(0);
  });
  it("snapshots metadata before reads and preserves manifest order across reversed completion", async () => {
    const gates = files.map(() => deferred()); io.read.mockImplementation((path: URL) => gates[files.indexOf(name(path))].promise);
    const m = await api(), pending = m.loadPostgresMigrationsV3(5);
    expect(io.read).toHaveBeenCalledTimes(5);
    expect(Reflect.set(m.postgresMigrationManifestsV3[5][0], "file", "evil.sql")).toBe(false);
    for (let i = 4; i >= 0; i--) gates[i].resolve(originals.get(files[i])!);
    const rows = await pending; expect(rows.map(r => r.ordinal)).toEqual([1, 2, 3, 4, 5]); expect(rows.map(r => r.file)).toEqual(files);
  });
});
