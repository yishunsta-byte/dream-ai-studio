import "server-only";
import { createHash } from "node:crypto";
import { PostgresMigrationError } from "./migration-manifest";

export type MigrationTarget = Readonly<{
  connectionString: string;
  profile: "synthetic" | "managed-staging" | "managed-session-staging" | "managed-session-live";
  projectRef?: string;
  // Independently supplied approval binding; never inferred from the URL.
  sessionHost?: string;
  sessionPort?: string;
  sessionDatabase?: string;
  sessionUsername?: string;
  sessionRole?: string;
}>;
export function isSessionMigrationProfile(profile: MigrationTarget["profile"]) {
  return profile === "managed-session-staging" || profile === "managed-session-live";
}
export function inspectMigrationTarget(target: MigrationTarget) {
  try {
    const url = new URL(target.connectionString);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || !url.port || !url.username || !url.password ||
      url.pathname.length < 2 || url.search || url.hash || Number(url.port) < 1) throw new Error();
    const database = decodeURIComponent(url.pathname.slice(1)), connectionUsername = decodeURIComponent(url.username);
    let username = connectionUsername;
    const session = isSessionMigrationProfile(target.profile);
    if (!session && [target.sessionHost, target.sessionPort, target.sessionDatabase, target.sessionUsername, target.sessionRole].some(value => value !== undefined)) throw new Error();
    if (target.profile === "synthetic") {
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^dream_test_[a-z0-9_]+$/.test(database)) throw new Error();
    } else if (target.profile === "managed-staging") {
      if (!target.projectRef || !/^[a-z0-9]{20}$/.test(target.projectRef) || url.hostname !== `db.${target.projectRef}.supabase.co`) throw new Error();
    } else if (session) {
      if (!target.projectRef || !/^[a-z0-9]{20}$/.test(target.projectRef) ||
        !target.sessionRole || !/^[a-z_][a-z0-9_]{0,62}$/.test(target.sessionRole) ||
        !/^aws-[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/.test(url.hostname) ||
        url.port !== "5432" || target.sessionPort !== url.port || target.sessionHost !== url.hostname ||
        target.sessionDatabase !== database || target.sessionUsername !== connectionUsername ||
        connectionUsername !== `${target.sessionRole}.${target.projectRef}`) throw new Error();
      // Supavisor routes role.ref to the actual PostgreSQL role. Never compare
      // session_user to the provider routing username or silently strip a suffix.
      username = target.sessionRole;
    } else throw new Error();
    const identity = [target.profile, url.hostname.toLowerCase(), url.port, database, connectionUsername];
    if (session) identity.push(target.projectRef!, username);
    const targetHash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    return Object.freeze({ targetHash, database, username, port: Number(url.port) });
  } catch { throw new PostgresMigrationError("MIGRATION_TARGET"); }
}
