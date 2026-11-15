import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import * as schema from "./schema";

export const databasePath = () => join(process.cwd(), "data/app.db");
export function openDatabase(filename = databasePath(), options: Database.Options = {}) {
  const sqlite = new Database(filename, { timeout:5000, ...options });
  try {
    sqlite.pragma("foreign_keys = ON");
    if (!options.readonly) sqlite.pragma("journal_mode = WAL");
    return { sqlite, db:drizzle(sqlite, { schema }), close:()=>sqlite.close() };
  } catch (error) { sqlite.close(); throw error; }
}
export type DatabaseHandle = ReturnType<typeof openDatabase>;
