import "server-only";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeMigration, isCertifiedCodeMigration, MigrationSourceError } from "./code-migration";
import { checkTimelineRows, verifyTimelineMigration } from "./timeline-data";
import { checkRenderRows } from "./render-data";

// `verify` is the data check a step defines for itself (K-6 ③); it runs after the step is applied.
// A code step (T-048, see code-migration.ts) also has `run`, the data transform bound to `sha256` with its `sources`;
// it is executed only for migration objects created by `codeMigration`. SQL steps are unchanged.
export type Migration = { version:number; name:string; sql:string; sha256:string; verify?:(sqlite:Database.Database)=>void; kind?:"sql"|"code"; run?:(sqlite:Database.Database)=>void; sources?:readonly string[] };
export type AppliedMigration = { version:number; name:string; sha256:string };
const productFiles=["0001_initial.sql","0002_ownership.sql","0003_edit_snapshots.sql","0004_audit_backups.sql"];
export function migrationEntry(version:number,name:string,sql:string):Migration{const text=sql.replace(/\r\n/g,"\n");return {version,name,sql:text,sha256:createHash("sha256").update(text).digest("hex")};}
// Product code steps (T-061): the closed list of reviewed .cjs files (entry first) and the hash of that exact text.
// The files are read from the app folder (cwd) on every use and must match this hash before anything runs.
export const PRODUCT_CODE_STEPS=[{version:5,name:"0005_timeline_revisions.cjs",files:["lib/db/migrations/0005_timeline_revisions.cjs","lib/db/migrations/0005_timeline_shared.cjs"],sha256:"6a012009fd045439d6d3af8ad2021043fec475aadf10fd942b6585c9e88f0061"}] as const;
export const productSqlMigrations=()=>productFiles.map((name,index)=>migrationEntry(index+1,name,readFileSync(join(process.cwd(),"lib/db/migrations",name),"utf8")));
// SQL steps after the code step (T-105): explicit versions, appended after PRODUCT_CODE_STEPS in this order.
// 0007 (T-109) also checks every render row written under 0006 (read-only, after it is applied): a row that breaks the
// new guards stops the whole run with its id and reason, and nothing is recorded.
// 0008 (T-132) is the timeline v2 feature gate (no column change); its data check reads every timeline row.
export const LATER_SQL_STEPS=[{version:6,name:"0006_renders.sql"},{version:7,name:"0007_render_guards.sql"},{version:8,name:"0008_timeline_audio.sql"}] as const;
const LATER_SQL_VERIFY:Partial<Record<number,(sqlite:Database.Database)=>void>>={7:checkRenderRows,8:checkTimelineRows};
export const productLaterSqlMigrations=()=>LATER_SQL_STEPS.map(({version,name})=>{const entry=migrationEntry(version,name,readFileSync(join(process.cwd(),"lib/db/migrations",name),"utf8"));const verify=LATER_SQL_VERIFY[version];return verify?{...entry,verify}:entry;});
// The product list. Tests may pass an isolated list (e.g. product + a test-only step); the product never adds one at runtime.
// A product file that cannot be read (missing, or the app started outside its folder) is a source error (T-061 D8).
export function productMigrations():Migration[]{let sql:Migration[],later:Migration[];try{sql=productSqlMigrations();later=productLaterSqlMigrations();}catch{throw new MigrationSourceError("lib/db/migrations: 제품 마이그레이션 파일을 읽지 못했어요");}
  const list=[...sql,...PRODUCT_CODE_STEPS.map(step=>codeMigration({...step,verify:verifyTimelineMigration})),...later];
  // K-6 ①: the product list is 1..n without gaps, so a recorded journal can only be its exact prefix.
  if(list.some((step,index)=>step.version!==index+1))throw new MigrationSourceError("lib/db/migrations: 제품 마이그레이션 순서가 맞지 않아요");
  return list;}
export function journal(sqlite:Database.Database):AppliedMigration[]|null{
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__schema_migrations'").get())return null;
  return sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as AppliedMigration[];
}
// F039-2 / F043-1: a database may be initialised from nothing only when it holds no user objects at all. The one
// allowed leftover is an EMPTY journal table whose stored definition is exactly the one this file creates (same
// SQL text, the same four visible columns with no hidden/generated ones, STRICT, no defaults or checks). Any other
// object, a nonzero user_version/application_id, a journal that cannot be read, or any other journal definition
// means "unrecorded": its origin is unknown, so it is never relabelled as a product database.
export type DatabaseOrigin="fresh"|"recorded"|"unrecorded";
const JOURNAL_COLUMNS="version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL";
const JOURNAL_STORED=`CREATE TABLE __schema_migrations (${JOURNAL_COLUMNS}) STRICT`;
const journalShape=JSON.stringify([["version","INTEGER",0,null,1,0],["name","TEXT",1,null,0,0],["sha256","TEXT",1,null,0,0],["applied_at","TEXT",1,null,0,0]]);
function canonicalEmptyJournal(sqlite:Database.Database){
  const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='__schema_migrations'").get() as {sql:string}|undefined;
  if(stored?.sql!==JOURNAL_STORED)return false;
  const columns=(sqlite.pragma("table_xinfo(__schema_migrations)") as {name:string;type:string;notnull:number;dflt_value:unknown;pk:number;hidden:number}[]).map(column=>[column.name,column.type,column.notnull,column.dflt_value,column.pk,column.hidden]);
  const table=(sqlite.pragma("table_list(__schema_migrations)") as {schema:string;type:string;strict:number;wr:number}[]).filter(row=>row.schema==="main");
  return JSON.stringify(columns)===journalShape&&table.length===1&&table[0].type==="table"&&table[0].strict===1&&table[0].wr===0;
}
export function databaseOrigin(sqlite:Database.Database):DatabaseOrigin{
  let applied:AppliedMigration[]|null;
  try{applied=journal(sqlite);}catch{return "unrecorded";}
  if(applied?.length)return "recorded";
  const objects=sqlite.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all() as {type:string;name:string}[];
  if(objects.some(object=>!(object.type==="table"&&object.name==="__schema_migrations")))return "unrecorded";
  if(sqlite.pragma("user_version",{simple:true})!==0||sqlite.pragma("application_id",{simple:true})!==0)return "unrecorded";
  if(applied&&!canonicalEmptyJournal(sqlite))return "unrecorded";
  return "fresh";
}
export class UnrecordedDatabaseError extends Error{constructor(){super("마이그레이션 기록이 없는 기존 데이터베이스라 적용을 중단했어요.");this.name="UnrecordedDatabaseError";}}
export type MigrationCompat="same"|"upgrade"|"too_new"|"mismatch";
// K-6 ①②: accept only an exact prefix of the current list. Gaps, duplicates, renamed or
// re-hashed steps are a mismatch; a longer list whose prefix is the current list is too new.
export function compareMigrations(recorded:readonly AppliedMigration[]|null,current:readonly AppliedMigration[]):MigrationCompat{
  if(!recorded||!recorded.length)return "mismatch";
  if(recorded.some((row,index)=>row.version!==index+1))return "mismatch";
  const common=Math.min(recorded.length,current.length);
  for(let index=0;index<common;index++){const a=recorded[index],b=current[index];if(a.version!==b.version||a.name!==b.name||a.sha256!==b.sha256)return "mismatch";}
  return recorded.length===current.length?"same":recorded.length<current.length?"upgrade":"too_new";
}
export function verifyMigrations(sqlite: Database.Database,expected:readonly Migration[]=productMigrations()) {
  const applied=journal(sqlite);
  if (!applied) throw new Error("데이터베이스 준비가 필요해요. npm.cmd run db:migrate를 실행해 주세요.");
  if (compareMigrations(applied,expected)!=="same") throw new Error("데이터베이스 버전이나 마이그레이션 기록이 맞지 않아요. 적용 상태를 확인해 주세요.");
  const brokenReferences = sqlite.pragma("foreign_key_check");
  if (!Array.isArray(brokenReferences) || brokenReferences.length) throw new Error("데이터 참조 검사에 실패했어요. 백업과 데이터 상태를 확인해 주세요.");
}
export type MigrateOptions={ migrations?:readonly Migration[]; now?:()=>number };
// Runs `check` with PRAGMA query_only on and always restores the caller's previous value.
function readOnly(sqlite:Database.Database,check:()=>void){
  const previous=sqlite.pragma("query_only",{simple:true}) as number;
  sqlite.pragma("query_only = ON");
  try{check();}finally{sqlite.pragma(`query_only = ${previous?"ON":"OFF"}`);}
}
// Applies the remaining steps in one transaction (a savepoint when the caller already holds one).
export function migrateDatabase(sqlite: Database.Database,options:MigrateOptions={}) {
  const expected=options.migrations??productMigrations(),now=options.now??Date.now;
  return sqlite.transaction(()=>{
    if(databaseOrigin(sqlite)==="unrecorded")throw new UnrecordedDatabaseError();
    sqlite.exec(`CREATE TABLE IF NOT EXISTS __schema_migrations (${JOURNAL_COLUMNS}) STRICT`);
    const applied=journal(sqlite)!;
    if(applied.length&&compareMigrations(applied,expected)!=="same"&&compareMigrations(applied,expected)!=="upgrade") throw new Error("기존 마이그레이션 기록이 달라 적용을 중단했어요.");
    let count=0;
    // A transform not created by codeMigration is not covered by its recorded hash: refuse before any step runs.
    for (const migration of expected.slice(applied.length)) if ((migration.run || migration.kind === "code") && !isCertifiedCodeMigration(migration)) throw new MigrationSourceError(`${migration.version} ${migration.name}: 해시에 묶이지 않은 실행 코드`);
    for (const migration of expected.slice(applied.length)) {
      if (migration.sql) sqlite.exec(migration.sql);
      migration.run?.(sqlite);
      sqlite.prepare("INSERT INTO __schema_migrations(version,name,sha256,applied_at) VALUES(?,?,?,?)").run(migration.version,migration.name,migration.sha256,new Date(now()).toISOString());
      count++;
    }
    // `verify` is a check, not a transform (a code step's hash does not cover it): it runs with writes refused.
    for(const migration of expected.slice(applied.length))if(migration.verify)readOnly(sqlite,()=>migration.verify!(sqlite));
    verifyMigrations(sqlite,expected);
    return count;
  }).immediate();
}
