import "server-only";
import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v7 } from "uuid";
import Database from "better-sqlite3";
import { editSnapshotSchema } from "@/lib/edit/schema";
import type { DatabaseHandle } from "./connection";
import { compareMigrations, databaseOrigin, journal, migrateDatabase, productMigrations, verifyMigrations, type Migration } from "./migrate";

export const liveMigrationCodes=["SCHEMA_MISMATCH","SNAPSHOT_EXISTS","SNAPSHOT_FAILED","DATABASE_BUSY","MIGRATION_FAILED"] as const;
export type LiveMigrationCode=typeof liveMigrationCodes[number];
// reason "unrecorded": SCHEMA_MISMATCH because a nonempty database has no readable journal (F039-2).
export class LiveMigrationError extends Error{constructor(readonly code:LiveMigrationCode,readonly snapshot:string|null=null,readonly reason:"unrecorded"|null=null){super(code);this.name="LiveMigrationError";}}
export type LiveMigrationResult={applied:number;from:number;to:number;snapshot:string|null};
export type LiveMigrationOptions={snapshotDirectory:string;migrations?:readonly Migration[];now?:()=>number;afterSnapshot?:(path:string)=>void};
const stampOf=(time:number)=>new Date(time).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");

// Same post-step checks as a restored upgrade, minus the file inventory (a live DB has no manifest).
export function checkMigratedData(sqlite:Database.Database,migrations:readonly Migration[]){
  verifyMigrations(sqlite,migrations);
  if(sqlite.pragma("integrity_check",{simple:true})!=="ok")throw new Error("Database integrity failed");
  for(const row of sqlite.prepare("SELECT value_json FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").all() as {value_json:string}[])editSnapshotSchema.parse(JSON.parse(row.value_json));
}

// K-6 ⑥ / T-017 3.5: before changing the DB the app is using, keep a consistent copy as a NEW file.
// - The copy is taken with VACUUM INTO (a read snapshot that includes committed WAL frames).
// - The file name is reserved with an exclusive create first; an existing file is never replaced.
// - Then the write lock is taken and `data_version` must be unchanged, so no other connection
//   committed between the copy and the migration. Otherwise nothing is migrated.
// - The copy is never deleted automatically. A failed migration rolls back and leaves the copy.
export function migrateLiveDatabase(handle:DatabaseHandle,options:LiveMigrationOptions):LiveMigrationResult{
  const sqlite=handle.sqlite,migrations=options.migrations??productMigrations(),now=options.now??Date.now;
  // F039-2: only a truly empty database is initialised without a snapshot; an unrecorded one is left untouched.
  if(databaseOrigin(sqlite)==="unrecorded")throw new LiveMigrationError("SCHEMA_MISMATCH",null,"unrecorded");
  const applied=journal(sqlite)??[];
  if(!applied.length){const count=migrateDatabase(sqlite,{migrations,now});return {applied:count,from:0,to:migrations.length,snapshot:null};}
  const compat=compareMigrations(applied,migrations);
  if(compat==="same"){verifyMigrations(sqlite,migrations);return {applied:0,from:applied.length,to:applied.length,snapshot:null};}
  if(compat!=="upgrade")throw new LiveMigrationError("SCHEMA_MISMATCH");
  const from=applied.length,to=migrations.length,name=`${stampOf(now())}_s${from}-s${to}.db`,path=join(options.snapshotDirectory,name);
  const before=sqlite.pragma("data_version",{simple:true});
  try{mkdirSync(options.snapshotDirectory,{recursive:true});}catch{throw new LiveMigrationError("SNAPSHOT_FAILED");}
  try{writeFileSync(path,"",{flag:"wx",mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")throw new LiveMigrationError("SNAPSHOT_EXISTS");throw new LiveMigrationError("SNAPSHOT_FAILED");}
  try{sqlite.prepare("VACUUM INTO ?").run(path);}
  catch{try{if(lstatSync(path).size===0)unlinkSync(path);}catch{/* Keep whatever we cannot inspect. */}throw new LiveMigrationError("SNAPSHOT_FAILED");}
  try{const copy=new Database(path,{readonly:true,fileMustExist:true});try{if(copy.pragma("integrity_check",{simple:true})!=="ok"||JSON.stringify(journal(copy))!==JSON.stringify(applied))throw new Error("Snapshot differs");}finally{copy.close();}}
  catch{throw new LiveMigrationError("SNAPSHOT_FAILED",path);}
  try{
    options.afterSnapshot?.(path);
    let count=0;
    sqlite.transaction(()=>{
      if(sqlite.pragma("data_version",{simple:true})!==before)throw new LiveMigrationError("DATABASE_BUSY",path);
      count=migrateDatabase(sqlite,{migrations,now});
      checkMigratedData(sqlite,migrations);
      sqlite.prepare("INSERT INTO activity_log(id,project_id,actor,action,detail_json,created_at) VALUES(?,NULL,'local-user','db.migrated',?,?)").run(v7(),JSON.stringify({from,to,snapshot:name}),new Date(now()).toISOString());
    }).immediate();
    return {applied:count,from,to,snapshot:path};
  }catch(error){
    if(error instanceof LiveMigrationError)throw error;
    if((error as {code?:string})?.code==="SQLITE_BUSY")throw new LiveMigrationError("DATABASE_BUSY",path);
    throw new LiveMigrationError("MIGRATION_FAILED",path);
  }
}
