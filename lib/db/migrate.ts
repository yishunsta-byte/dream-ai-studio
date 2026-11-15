import "server-only";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function migrationList() {
  const first = readFileSync(join(process.cwd(), "lib/db/migrations/0001_initial.sql"), "utf8").replace(/\r\n/g,"\n");
  const second = readFileSync(join(process.cwd(), "lib/db/migrations/0002_ownership.sql"), "utf8").replace(/\r\n/g,"\n");
  return [{version:1,name:"0001_initial.sql",sql:first},{version:2,name:"0002_ownership.sql",sql:second}].map((migration)=>({...migration,sha256:createHash("sha256").update(migration.sql).digest("hex")}));
}
type AppliedMigration = { version:number; name:string; sha256:string };
export function verifyMigrations(sqlite: Database.Database) {
  const expected = migrationList();
  const hasJournal = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__schema_migrations'").get();
  if (!hasJournal) throw new Error("데이터베이스 준비가 필요해요. npm.cmd run db:migrate를 실행해 주세요.");
  const applied = sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as AppliedMigration[];
  if (applied.length !== expected.length || applied.some((row,index)=>row.version !== expected[index]?.version || row.name !== expected[index]?.name || row.sha256 !== expected[index]?.sha256)) {
    throw new Error("데이터베이스 버전이나 마이그레이션 기록이 맞지 않아요. 적용 상태를 확인해 주세요.");
  }
  const brokenReferences = sqlite.pragma("foreign_key_check");
  if (!Array.isArray(brokenReferences) || brokenReferences.length) throw new Error("데이터 참조 검사에 실패했어요. 백업과 데이터 상태를 확인해 주세요.");
}
export function migrateDatabase(sqlite: Database.Database) {
  return sqlite.transaction(()=>{
    sqlite.exec("CREATE TABLE IF NOT EXISTS __schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT");
    const expected = migrationList();
    const applied=sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as AppliedMigration[];
    if(applied.some((row,index)=>row.version!==expected[index]?.version || row.name!==expected[index]?.name || row.sha256!==expected[index]?.sha256)) throw new Error("기존 마이그레이션 기록이 달라 적용을 중단했어요.");
    let count=0;
    for (const migration of expected.slice(applied.length)) {
      sqlite.exec(migration.sql);
      sqlite.prepare("INSERT INTO __schema_migrations(version,name,sha256,applied_at) VALUES(?,?,?,?)").run(migration.version,migration.name,migration.sha256,new Date().toISOString());
      count++;
    }
    verifyMigrations(sqlite);
    return count;
  }).immediate();
}
