import "server-only";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openPromise } from "yauzl";
import { openDatabase } from "@/lib/db/connection";
import { compareMigrations, journal, productMigrations, type AppliedMigration, type Migration } from "@/lib/db/migrate";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { fileDigest, safeArchivePath } from "@/lib/export/zip";
import { editSnapshotSchema } from "@/lib/edit/schema";
import { checkTimelineRows } from "@/lib/db/timeline-data";
import { backupManifestSchema, SUPPORTED_MANIFEST_VERSIONS, type BackupManifest } from "./schema";
import { BackupCompatError } from "./compat";
import { within } from "./paths";
// K-6 ⑦: an unknown manifest format is a schema mismatch, not a generic invalid file.
export function parseManifest(text:string){const raw=JSON.parse(text) as unknown;const format=raw&&typeof raw==="object"?(raw as {schemaVersion?:unknown}).schemaVersion:undefined;if(!(SUPPORTED_MANIFEST_VERSIONS as readonly unknown[]).includes(format))throw new BackupCompatError("BACKUP_SCHEMA_MISMATCH");return backupManifestSchema.parse(raw);}
const plain=(rows:readonly AppliedMigration[])=>rows.map(({version,name,sha256})=>({version,name,sha256}));
// What the staged DB must hold. Default: exactly the manifest's journal, judged against the product list.
export type DatabaseExpectation={migrations?:readonly Migration[];journal?:readonly AppliedMigration[]};
export function inventoryHash(files:BackupManifest["files"]){return createHash("sha256").update(JSON.stringify(files)).digest("hex");}
export async function storageInventory(base:string,signal?:AbortSignal){const root=await realpath(/*turbopackIgnore: true*/base),files:BackupManifest["files"]=[];async function walk(directory:string,prefix:string){for(const entry of await readdir(/*turbopackIgnore: true*/directory,{withFileTypes:true})){if(entry.name.toLowerCase().startsWith(".env")||(!prefix&&entry.name.toLowerCase()==="tmp"))continue;const filename=join(/*turbopackIgnore: true*/directory,entry.name);if(entry.isSymbolicLink())throw new Error("Storage links cannot be backed up");const actual=await realpath(/*turbopackIgnore: true*/filename);if(!within(root,actual))throw new Error("Storage path escaped");const name=prefix?`${prefix}/${entry.name}`:entry.name;if(entry.isDirectory())await walk(actual,name);else if(entry.isFile()){const path=`storage/${name}`;if(!safeArchivePath(path))throw new Error("Unsafe storage name");if(files.length>=10000)throw new Error("Too many backup files");files.push({path,...await fileDigest(actual,signal)});}}}await walk(root,"");return files.sort((a,b)=>a.path.localeCompare(b.path));}
export async function readBackupManifest(filename:string){const zip=await openPromise(filename,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true,autoClose:false});try{for await(const entry of zip.eachEntry()){if(entry.fileName!=="backup-manifest.json")continue;if(entry.uncompressedSize>16*1024*1024)throw new Error("Backup manifest too large");const stream=await zip.openReadStreamPromise(entry),chunks:Buffer[]=[];let size=0;await pipeline(stream,new Writable({write(chunk:Buffer,_encoding,done){size+=chunk.length;if(size>16*1024*1024){done(new Error("Backup manifest too large"));return;}chunks.push(chunk);done();}}));return parseManifest(Buffer.concat(chunks).toString("utf8"));}throw new Error("Backup manifest missing");}finally{zip.close();}}
// Portable restore names cannot alias Windows devices, trailing-dot names or
// existing 8.3 names. The extraction tree is new and exclusively owned.
function safeRestoreName(name:string){return safeArchivePath(name)&&name.split("/").every(part=>!/[<>"|?*~]/.test(part)&&![...part].some(char=>char.charCodeAt(0)<32)&&!/[. ]$/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));}
async function extractionRoot(destination:string,onCreated?:()=>void){
 const requested=resolve(destination),parent=await realpath(/*turbopackIgnore: true*/dirname(requested)),root=join(parent,basename(requested));
 await mkdir(root,{mode:0o700});onCreated?.(); // EEXIST rejects even empty folders and junctions before any writes.
 const identity=await lstat(root);
 async function check(directory:string){
  if(!within(root,directory))throw new Error("Restore path escaped");
  const paths=[root];let next=root;for(const part of relative(root,directory).split(sep).filter(Boolean)){next=join(next,part);paths.push(next);}
  for(const path of paths){const stat=await lstat(path);const actual=await realpath(/*turbopackIgnore: true*/path);if(stat.isSymbolicLink()||!stat.isDirectory()||relative(path,actual)!==""||(path===root&&(stat.dev!==identity.dev||stat.ino!==identity.ino)))throw new Error("Restore parent link rejected");}
 }
 return {async output(name:string){
  let directory=root;await check(directory);
  for(const part of name.split("/").slice(0,-1)){const child=join(directory,part);try{await mkdir(child,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}await check(child);directory=child;}
  await check(directory);const target=join(directory,name.split("/").at(-1)!);
  // Node/Windows lacks handle-relative openat/reparse-point exclusion. wx and
  // post-open identity checks narrow, but cannot eliminate, parent-swap races.
  const file=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(process.platform==="win32"?0:constants.O_NOFOLLOW),0o600);
  try{await check(directory);const actual=await realpath(/*turbopackIgnore: true*/target),stat=await lstat(target),opened=await file.stat();if(!within(root,actual)||relative(target,actual)!==""||stat.isSymbolicLink()||!stat.isFile()||stat.dev!==opened.dev||stat.ino!==opened.ino)throw new Error("Restore file link rejected");return file;}catch(error){await file.close();throw error;}
 }};
}
export async function verifyBackupArchive(filename:string,expected:BackupManifest,destination?:string,signal?:AbortSignal,onCreated?:()=>void){
 const manifest=backupManifestSchema.parse(expected);if(manifest.database.path!=="data/app.db"||inventoryHash(manifest.files)!==manifest.inventorySha256)throw new Error("Backup inventory differs");const expectedFiles=new Map([manifest.database,...manifest.files].map(file=>[file.path,file]));if(expectedFiles.size!==manifest.files.length+1||manifest.files.some(file=>!file.path.startsWith("storage/")||file.path.toLowerCase().startsWith("storage/tmp/")||file.path.split("/").some(part=>part.toLowerCase().startsWith(".env")))||[...expectedFiles.keys()].some(name=>!safeRestoreName(name)))throw new Error("Invalid backup inventory");
 const folded=new Set<string>();for(const name of expectedFiles.keys()){const key=name.toLowerCase();if(folded.has(key))throw new Error("Aliased backup inventory");folded.add(key);}
 if(destination)await verifyBackupArchive(filename,manifest,undefined,signal);
 const extraction=destination?await extractionRoot(destination,onCreated):undefined;
 const archive=await openPromise(filename,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true,autoClose:false}),seen=new Set<string>();let readManifest=false;
 try{for await(const entry of archive.eachEntry()){
  const name=entry.fileName;if(!safeArchivePath(name)||seen.has(name)||entry.isEncrypted()||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)throw new Error("Unsafe backup entry");seen.add(name);const meta=expectedFiles.get(name);if(!meta&&name!=="backup-manifest.json")throw new Error("Unexpected backup entry");if(seen.size>expectedFiles.size+1)throw new Error("Too many backup entries");const limit=meta?.sizeBytes??16*1024*1024;if(entry.uncompressedSize>limit)throw new Error("Backup entry too large");const stream=await archive.openReadStreamPromise(entry),hash=createHash("sha256"),chunks:Buffer[]=[];let size=0;
  const measure=new Transform({transform(chunk:Buffer,_encoding,done){size+=chunk.length;if(size>limit){done(new Error("Backup size differs"));return;}hash.update(chunk);if(!meta)chunks.push(chunk);done(null,chunk);}});
  if(extraction&&meta){const file=await extraction.output(name);try{await pipeline(stream,measure,new Writable({write(chunk:Buffer,_encoding,done){file.writeFile(chunk).then(()=>done(),done);}}),{signal});}finally{await file.close();}}else await pipeline(stream,measure,new Writable({write(_chunk,_encoding,done){done();}}),{signal});
  if(meta){if(size!==meta.sizeBytes||hash.digest("hex")!==meta.sha256)throw new Error("Backup hash differs");}else{if(JSON.stringify(parseManifest(Buffer.concat(chunks).toString("utf8")))!==JSON.stringify(manifest))throw new Error("Backup manifest differs");readManifest=true;}
 }if(!readManifest||seen.size!==expectedFiles.size+1||[...expectedFiles.keys()].some(name=>!seen.has(name)))throw new Error("Backup file missing");}finally{archive.close();}return manifest;
}
export async function verifyRestoredDatabase(folder:string,manifest:BackupManifest,verifyDatabaseHash=true,signal?:AbortSignal,expectation:DatabaseExpectation={}){
 const filename=join(folder,"data/app.db");if(verifyDatabaseHash){const digest=await fileDigest(filename,signal);if(digest.sha256!==manifest.database.sha256||digest.sizeBytes!==manifest.database.sizeBytes)throw new Error("Database hash differs");}
 const handle=openDatabase(filename,{readonly:true,fileMustExist:true});try{const recorded=journal(handle.sqlite);if(!recorded||JSON.stringify(plain(recorded))!==JSON.stringify(plain(expectation.journal??manifest.migrations)))throw new BackupCompatError("BACKUP_SCHEMA_MISMATCH");const compat=compareMigrations(recorded,expectation.migrations??productMigrations());if(compat==="too_new")throw new BackupCompatError("BACKUP_TOO_NEW");if(compat==="mismatch")throw new BackupCompatError("BACKUP_SCHEMA_MISMATCH");if(handle.sqlite.pragma("integrity_check",{simple:true})!=="ok"||(handle.sqlite.pragma("foreign_key_check") as unknown[]).length)throw new Error("Database integrity failed");
  // An older structure is only hashed, integrity- and FK-checked here; file references and text
  // snapshots are read through the current schema, so they are checked after the staging upgrade.
  if(compat==="same"){const inventory=new Map(manifest.files.map(file=>[file.path,file]));for(const reference of maintenanceRepository(handle).fileReferences()){if(!reference.filePath)continue;const key=`storage/${reference.filePath}`,meta=inventory.get(key);if(!safeArchivePath(key)||!meta||!reference.sha256||meta.sha256!==reference.sha256||(reference.sizeBytes!==null&&meta.sizeBytes!==reference.sizeBytes))throw new Error("Database file reference differs");const actual=join(folder,key);if(!within(folder,actual)||!within(await realpath(/*turbopackIgnore: true*/folder),await realpath(/*turbopackIgnore: true*/actual)))throw new Error("Restored reference escaped");}
  for(const row of handle.sqlite.prepare("SELECT key,value_json FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").all() as {key:string;value_json:string}[])editSnapshotSchema.parse(JSON.parse(row.value_json));
  // T-061: timeline revisions (same structure, or right after the staging upgrade) read back by schema and hash.
  checkTimelineRows(handle.sqlite);}
  return {compat,schemaFrom:recorded.length,projects:(handle.sqlite.prepare("SELECT COUNT(*) AS n FROM projects").get() as {n:number}).n,assets:(handle.sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get() as {n:number}).n,pendingJobs:(handle.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get() as {n:number}).n};
 }finally{handle.close();}
}
export async function verifyStagingFiles(folder:string,manifest:BackupManifest,signal?:AbortSignal,extraFiles:string[]=[],extraDirectories:string[]=[],expectation:DatabaseExpectation={}){
 const root=await realpath(/*turbopackIgnore: true*/folder),rootStat=await lstat(folder);if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw new Error("Restore file link rejected");
 const allowed=new Set([manifest.database.path,...manifest.files.map(file=>file.path),...extraFiles]),directories=new Set(extraDirectories);for(const name of allowed){const parts=name.split("/");for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join("/"));}
 async function scan(directory:string,prefix:string){for(const entry of await readdir(/*turbopackIgnore: true*/directory,{withFileTypes:true})){const path=join(directory,entry.name),name=prefix?`${prefix}/${entry.name}`:entry.name;const stat=await lstat(path);if(stat.isSymbolicLink()||relative(path,await realpath(/*turbopackIgnore: true*/path))!=="")throw new Error("Restore file link rejected");if(stat.isDirectory()){if(!directories.has(name))throw new Error("Unexpected staged directory");await scan(path,name);}else if(!stat.isFile()||!allowed.has(name))throw new Error("Unexpected staged file");}}
 await scan(root,"");
 for(const file of [manifest.database,...manifest.files]){const path=join(root,file.path);if(!within(root,path))throw new Error("Restore file escaped");const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||relative(path,await realpath(/*turbopackIgnore: true*/path))!=="")throw new Error("Restore file link rejected");const digest=await fileDigest(path,signal);if(digest.sha256!==file.sha256||digest.sizeBytes!==file.sizeBytes)throw new Error("Staged file hash differs");}async function clearSidecars(){
  // SQLite may create empty WAL/SHM sidecars even for a read-only WAL snapshot.
  // The scan above rejected all pre-existing sidecars; never accept WAL content.
  for(const suffix of ["-wal","-shm"]){const sidecar=join(root,manifest.database.path)+suffix;try{const stat=await lstat(sidecar);if(!stat.isFile()||stat.isSymbolicLink()||relative(sidecar,await realpath(/*turbopackIgnore: true*/sidecar))!==""||(suffix==="-wal"&&stat.size!==0))throw new Error("Unexpected staged WAL");await unlink(sidecar);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
 }
 try{return await verifyRestoredDatabase(folder,manifest,true,signal,expectation);}finally{await clearSidecars();}
}
