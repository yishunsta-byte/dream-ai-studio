import "server-only";
import { createHash } from "node:crypto";
import { PostgresMigrationError } from "./migration-manifest";

export type MigrationTarget = Readonly<{
  connectionString: string;
  profile: "synthetic" | "managed-staging";
  projectRef?: string;
}>;
export function inspectMigrationTarget(target: MigrationTarget) {
  try {
    const url = new URL(target.connectionString);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || !url.port || !url.username || !url.password ||
      url.pathname.length < 2 || url.search || url.hash || Number(url.port) < 1) throw new Error();
    const database = decodeURIComponent(url.pathname.slice(1)), username = decodeURIComponent(url.username);
    if (target.profile === "synthetic") {
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^dream_test_[a-z0-9_]+$/.test(database)) throw new Error();
    } else if (target.profile === "managed-staging") {
      if (!target.projectRef || !/^[a-z0-9]{20}$/.test(target.projectRef) || url.hostname !== `db.${target.projectRef}.supabase.co`) throw new Error();
    } else throw new Error();
    const targetHash = createHash("sha256").update(JSON.stringify([target.profile, url.hostname.toLowerCase(), url.port, database, username])).digest("hex");
    return Object.freeze({ targetHash, database, username, port: Number(url.port) });
  } catch { throw new PostgresMigrationError("MIGRATION_TARGET"); }
}
