import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import { journal, type Migration } from "./migrate";
import { liveMigrationCodes } from "./live-migrate";

// F039-3: the last db:migrate result, kept next to the DB (never inside it: a failed migration rolls the DB back).
// Paths in it are relative to the runtime root (DREAM_DATA_ROOT or the app folder), never absolute.
// The file is untrusted input when read: bounded size, strict schema, regular file only.
export const migrationRecordPath=(root:string)=>join(root,"data","migration-last.json");
const MAX_BYTES=4096;
const snapshotName=/^\d{8}T\d{6}Z_s\d{1,4}-s\d{1,4}\.db$/;
const hex=z.string().regex(/^[0-9a-f]{64}$/);
export const migrationRecordSchema=z.strictObject({
  schema:z.literal(1),result:z.enum(["failed","succeeded"]),code:z.enum(liveMigrationCodes).nullable(),reason:z.literal("unrecorded").nullable(),
  at:z.iso.datetime(),from:z.number().int().min(0).max(9999),to:z.number().int().min(0).max(9999),
  // Identify the exact database state and app migration list the result belongs to (not just counts).
  database:hex,app:hex,
  snapshot:z.string().max(200).regex(/^backups\/pre-migrate\/[^/\\]+$/).refine(path=>snapshotName.test(path.slice("backups/pre-migrate/".length))).nullable(),
});
export type MigrationRecord=z.infer<typeof migrationRecordSchema>;
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

// The journal (with applied times) plus every user object's definition. Never throws.
export function databaseFingerprint(sqlite:Database.Database){
  let rows:unknown;
  try{rows=journal(sqlite)?(sqlite.prepare("SELECT version,name,sha256,applied_at FROM __schema_migrations ORDER BY version").all()):null;}catch{rows="unreadable";}
  let objects:unknown;
  try{objects=sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type,name").all();}catch{objects="unreadable";}
  return sha({journal:rows,objects});
}
export const migrationsFingerprint=(migrations:readonly Migration[])=>sha(migrations.map(({version,name,sha256})=>[version,name,sha256]));
export const snapshotRelative=(file:string)=>{const name=file.split(/[\\/]/).at(-1)??"";return snapshotName.test(name)?`backups/pre-migrate/${name}`:null;};

// New temporary file, then rename over the previous record. Throws on failure; callers must not let it affect the DB.
export function writeMigrationRecord(root:string,record:MigrationRecord){
  const value=JSON.stringify(migrationRecordSchema.parse(record)),final=migrationRecordPath(root),temporary=join(root,"data",`.migration-last-${randomUUID()}.tmp`);
  try{writeFileSync(temporary,value,{flag:"wx",mode:0o600});renameSync(temporary,final);}
  catch(error){try{unlinkSync(temporary);}catch{/* Nothing was written. */}throw error;}
}
export function readMigrationRecord(root:string):MigrationRecord|null{
  try{
    const path=migrationRecordPath(root),stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)return null;
    const parsed=migrationRecordSchema.safeParse(JSON.parse(readFileSync(path,"utf8")));
    return parsed.success?parsed.data:null;
  }catch{return null;}
}
// A copy is reported as kept only when it is a real SQLite file directly inside <root>/backups/pre-migrate
// (no links on the way, no escape through the name).
export function keptSnapshot(root:string,relative:string|null):string|null{
  if(!relative)return null;
  const name=relative.slice("backups/pre-migrate/".length);
  if(!relative.startsWith("backups/pre-migrate/")||!snapshotName.test(name))return null;
  try{
    const backups=join(root,"backups"),folder=join(backups,"pre-migrate"),file=join(folder,name);
    for(const directory of [backups,folder]){const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return null;}
    const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<512)return null;
    if(realpathSync.native(file)!==join(realpathSync.native(folder),name))return null;
    const header=Buffer.alloc(16),handle=openSync(file,"r");
    try{if(readSync(handle,header,0,16,0)!==16)return null;}finally{closeSync(handle);}
    return header.toString("latin1")==="SQLite format 3\0"?relative:null;
  }catch{return null;}
}
