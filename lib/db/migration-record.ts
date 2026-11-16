import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import Database from "better-sqlite3";
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
  // F043-3: digest of the copy taken right after it was made and checked. Absent in records written before T-044.
  snapshotSha256:hex.nullable().optional(),
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
// File digest without loading the whole copy into memory.
export function fileSha256(file:string){
  const hash=createHash("sha256"),buffer=Buffer.alloc(1<<20),handle=openSync(file,"r");
  try{for(let read=readSync(handle,buffer,0,buffer.length,null);read>0;read=readSync(handle,buffer,0,buffer.length,null))hash.update(buffer.subarray(0,read));}finally{closeSync(handle);}
  return hash.digest("hex");
}
// F043-3: a copy is reported as kept only when it is a real file directly inside <root>/backups/pre-migrate (no links
// on the way, no escape through the name), still has the digest taken right after it was made (a record without one
// is never confirmed), opens read-only as an intact SQLite database in
// rollback mode (so reading it creates no side files), and has exactly the journal and schema of the database
// state the record belongs to. Anything else (a fake header, a truncated or damaged file, another database) is not
// called a copy. The file is only read.
export function keptSnapshot(root:string,record:Pick<MigrationRecord,"snapshot"|"snapshotSha256"|"database">):string|null{
  const relative=record.snapshot;
  if(!relative)return null;
  const name=relative.slice("backups/pre-migrate/".length);
  if(!relative.startsWith("backups/pre-migrate/")||!snapshotName.test(name))return null;
  try{
    const backups=join(root,"backups"),folder=join(backups,"pre-migrate"),file=join(folder,name);
    for(const directory of [backups,folder]){const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return null;}
    const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<512)return null;
    if(realpathSync.native(file)!==join(realpathSync.native(folder),name))return null;
    const header=Buffer.alloc(20),handle=openSync(file,"r");
    try{if(readSync(handle,header,0,20,0)!==20)return null;}finally{closeSync(handle);}
    if(header.subarray(0,16).toString("latin1")!=="SQLite format 3\0"||header[18]!==1||header[19]!==1)return null;
    for(const side of ["-wal","-shm","-journal"])if(existsSync(/*turbopackIgnore: true*/`${file}${side}`))return null;
    // F045-2: without the digest taken when the copy was made (records from before T-044), schema and journal
    // equality cannot show the business data is the pre-migration data, so such a copy is never called confirmed.
    if(!record.snapshotSha256||fileSha256(file)!==record.snapshotSha256)return null;
    const copy=new Database(file,{readonly:true,fileMustExist:true});
    try{
      if(copy.pragma("integrity_check",{simple:true})!=="ok")return null;
      return databaseFingerprint(copy)===record.database?relative:null;
    }finally{copy.close();}
  }catch{return null;}
}
