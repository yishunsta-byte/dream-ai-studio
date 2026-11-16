import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import * as schema from "./schema";
import { runtimeRoot } from "@/lib/config/runtime";

export const databasePath = () => join(runtimeRoot(), "data/app.db");
// `wal:false` (F043-2) opens a writable connection without the persistent switch to WAL, for callers that must not
// change a database before its origin is checked. Every other caller keeps the default.
export function openDatabase(filename = databasePath(), options: Database.Options = {}, { wal = true }: { wal?: boolean } = {}) {
  const sqlite = new Database(filename, { timeout:5000, ...options });
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("recursive_triggers = ON");
    if(sqlite.pragma("recursive_triggers",{simple:true})!==1)throw new Error("Recursive triggers are required for immutable history");
    if (!options.readonly && wal) sqlite.pragma("journal_mode = WAL");
    return { sqlite, db:drizzle(sqlite, { schema }), close:()=>sqlite.close() };
  } catch (error) { sqlite.close(); throw error; }
}
export type DatabaseHandle = ReturnType<typeof openDatabase>;
