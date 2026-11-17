import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export class PostgresMigrationError extends Error {
  constructor(readonly code: "MIGRATION_SOURCE" | "MIGRATION_TARGET" | "MIGRATION_PRIVILEGE" | "MIGRATION_STATE" | "MIGRATION_HISTORY" | "MIGRATION_FAILED") {
    super(code); this.name = "PostgresMigrationError";
  }
}
// Published SQL bytes are untouched. Canonical LF hashes allow normal Git CRLF
// checkouts; no other whitespace, BOM, comment or statement changes are accepted.
export const postgresMigrationManifest = Object.freeze([
  Object.freeze({ id: "0001_schema", file: "0001_schema.sql", checksum: "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19" }),
  Object.freeze({ id: "0002_invariants", file: "0002_invariants.sql", checksum: "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100" }),
  Object.freeze({ id: "0003_rls", file: "0003_rls.sql", checksum: "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d" }),
]);
export async function loadPostgresMigrations(root = new URL("./", import.meta.url)) {
  try {
    return await Promise.all(postgresMigrationManifest.map(async entry => {
      const raw = await readFile(new URL(entry.file, root), "utf8");
      const source = raw.replaceAll("\r\n", "\n");
      if (createHash("sha256").update(source, "utf8").digest("hex") !== entry.checksum) throw new PostgresMigrationError("MIGRATION_SOURCE");
      const begin = source.indexOf("\nBEGIN;\n"), commit = source.lastIndexOf("\nCOMMIT;");
      if (begin < 0 || commit < begin || source.slice(commit + 8).trim() !== "") throw new PostgresMigrationError("MIGRATION_SOURCE");
      // Only verified fixed sources reach this extraction. Inner PL/pgSQL BEGIN
      // blocks remain intact. The runner owns the single outer transaction.
      return Object.freeze({ ...entry, sql: source.slice(begin + 8, commit) });
    }));
  } catch { throw new PostgresMigrationError("MIGRATION_SOURCE"); }
}
