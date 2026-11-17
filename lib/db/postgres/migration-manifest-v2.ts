import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PostgresMigrationError } from "./migration-manifest";

export type PostgresSchemaVersionV2 = 3 | 4;
export function requirePostgresSchemaVersionV2(value: unknown): PostgresSchemaVersionV2 {
  if (value !== 3 && value !== 4) throw new PostgresMigrationError("MIGRATION_SOURCE");
  return value;
}
const sql4 = Object.freeze({ id: "0004_storage_verification", file: "0004_storage_verification.sql",
  checksum: "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c" });
const sql3 = Object.freeze([
  Object.freeze({ id: "0001_schema", file: "0001_schema.sql", checksum: "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19" }),
  Object.freeze({ id: "0002_invariants", file: "0002_invariants.sql", checksum: "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100" }),
  Object.freeze({ id: "0003_rls", file: "0003_rls.sql", checksum: "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d" }),
]);
// Isolated opt-in source registry, not an extension of the v1 manifest/import graph.
export const postgresMigrationManifestsV2 = Object.freeze({
  3: sql3,
  4: Object.freeze([...sql3, sql4]),
});
export async function loadPostgresMigrationsV2(version: unknown, root = new URL("./", import.meta.url)) {
  const selected = requirePostgresSchemaVersionV2(version);
  try {
    return Object.freeze(await Promise.all(postgresMigrationManifestsV2[selected].map(async entry => {
      const source = (await readFile(new URL(entry.file, root), "utf8")).replaceAll("\r\n", "\n");
      if (createHash("sha256").update(source, "utf8").digest("hex") !== entry.checksum) throw new Error();
      const begin = source.indexOf("\nBEGIN;\n"), commit = source.lastIndexOf("\nCOMMIT;");
      if (begin < 0 || commit < begin || source.slice(commit + 8).trim() !== "") throw new Error();
      return Object.freeze({ ...entry, sql: source.slice(begin + 8, commit) });
    })));
  } catch { throw new PostgresMigrationError("MIGRATION_SOURCE"); }
}
