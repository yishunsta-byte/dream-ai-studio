import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rename, rm, stat, symlink, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import * as schema from "@/lib/db/schema";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { jobsService } from "@/lib/services/jobs";
import { restoreService } from "@/lib/services/restore";
import { historyService } from "@/lib/services/history";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { restoreStateSchema } from "@/lib/backup/schema";
import { rejectForeignDataRoot, validateInheritedBoundaries } from "@/lib/backup/paths";

// OS temp fixtures only: source instance → backups B1, B2 → restore B2 into a copy.
let root:string,source:string,copyRoot:string,handle:DatabaseHandle,copy:DatabaseHandle|null,time:number,b1:string,b2:string;
const now=()=>time,sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const listing=async(path:string)=>(await readdir(path,{recursive:true})).map(String).sort();
async function backup(db:DatabaseHandle){const request=backupService(db,now).request()!;const claimed=jobsService(db,now).claim()!;await runClaimedBackup(db,claimed,now);time+=3600000;return request.id;}
async function restore(db:DatabaseHandle,backupId:string,destination:string){const service=restoreService(db,now);const checked=await service.inspect({backupId,destination});return service.finish(checked.ticketId);}
async function failure(work:Promise<unknown>){try{await work;}catch(error){return error as {code?:string;status?:number;message:string};}throw new Error("expected failure");}
function openCopy(){handle.close();vi.stubEnv("DREAM_DATA_ROOT",copyRoot);copy=openDatabase(join(copyRoot,"data/app.db"),{fileMustExist:true});return copy;}
const row=(db:DatabaseHandle,id:string)=>backupService(db,now).list().rows.find(item=>item.id===id)!;
beforeEach(async()=>{
 root=await realpath(await mkdtemp(join(tmpdir(),"dream-origin-test-")));source=join(root,"source");copyRoot=join(root,"restored");copy=null;
 for(const path of ["data","storage/library","backups"])await mkdir(join(source,path),{recursive:true});
 vi.stubEnv("DREAM_DATA_ROOT",source);time=Date.parse("2026-11-16T03:00:00Z");handle=openDatabase(join(source,"data/app.db"));migrateDatabase(handle.sqlite);
 const bytes=Buffer.from("origin fixture");await writeFile(join(source,"storage/library/a.txt"),bytes);
 handle.db.insert(schema.assets).values({id:v7(),kind:"text",title:"fixture",role:"original",origin:"upload",filePath:"library/a.txt",mime:"text/plain",sizeBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}).run();
 b1=await backup(handle);b2=await backup(handle);await restore(handle,b2,copyRoot);
});
afterEach(async()=>{vi.unstubAllEnvs();try{copy?.close();}catch{/* closed */}try{handle.close();}catch{/* closed */}if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("fixture boundary");await rm(root,{recursive:true,force:true});});

describe("backup origin in a restored instance",()=>{
 it("records the exact inherited IDs and source boundaries privately and counts only local rows",async()=>{
  const db=openCopy(),list=backupService(db,now).list();
  expect(row(db,b1)).toMatchObject({status:"succeeded",origin:"inherited",inherited:true,originUnconfirmed:false,available:true,restorable:true});
  expect(row(db,b2)).toMatchObject({status:"failed",interruptedByRestore:true,origin:"inherited",available:null,restorable:false});
  expect(list.lastSuccess).toBeNull();expect(list.lastFailure).toBeNull();
  const state=restoreStateSchema.parse(JSON.parse(maintenanceRepository(db).setting("restore.info")!.valueJson));
  expect(new Set(state.inheritedBackupIds)).toEqual(new Set([b1,b2]));
  expect(state.protectedRoots).toEqual(expect.arrayContaining([source,join(source,"data"),join(source,"storage"),join(source,"backups")]));
  expect(JSON.stringify(list)).not.toContain(root);
  expect(Object.keys(historyService(db).restoreInformation()!).sort()).toEqual(["backupCreatedAt","restoredAt"]);
 });
 // Source hashes are taken after openCopy() closes the source handle so the WAL checkpoint is not mistaken for a change.
 it("marks backups requested in the copy as local even when this PC's clock is behind the source",async()=>{
  const db=openCopy();time=Date.parse("2020-01-01T00:00:00Z");const local=await backup(db);
  const list=backupService(db,now).list();
  expect(row(db,local)).toMatchObject({status:"succeeded",origin:"local",inherited:false,originUnconfirmed:false,available:true,restorable:true});
  expect(list.lastSuccess?.id).toBe(local);
  expect(maintenanceRepository(db).backup(local)!.path).toBe(join(copyRoot,"backups",`${local}.zip`));
 });
 it("re-restores an inherited ZIP on the same PC by reading it only",async()=>{
  const db=openCopy(),zip=join(source,"backups",`${b1}.zip`),before={zip:sha(zip),mtime:(await stat(zip)).mtimeMs,db:sha(join(source,"data/app.db")),storage:await listing(join(source,"storage"))};
  await restore(db,b1,join(root,"again"));
  expect({zip:sha(zip),mtime:(await stat(zip)).mtimeMs,db:sha(join(source,"data/app.db")),storage:await listing(join(source,"storage"))}).toEqual(before);
  expect(maintenanceRepository(db).backup(b1)!.status).toBe("succeeded");
 });
 it("keeps verified history but reports a missing file as not available and BACKUP_NOT_FOUND",async()=>{
  const db=openCopy(),historyBefore=row(db,b1);await rename(join(source,"backups"),join(root,"moved-away"));
  expect(row(db,b1)).toMatchObject({status:"succeeded",verifiedAt:historyBefore.verifiedAt,fileCount:historyBefore.fileCount,available:false,restorable:false});
  const error=await failure(restoreService(db,now).inspect({backupId:b1,destination:join(root,"x")}));
  expect(error).toMatchObject({code:"BACKUP_NOT_FOUND",status:404});expect(error.message).toContain("이 PC");
  expect(maintenanceRepository(db).backup(b1)!.status).toBe("succeeded");
 });
 it("still rejects a same-path file with other bytes as tampered",async()=>{
  const db=openCopy();await copyFile(join(source,"backups",`${b2}.zip`),join(source,"backups",`${b1}.zip`));
  expect(await failure(restoreService(db,now).inspect({backupId:b1,destination:join(root,"y")}))).toMatchObject({code:"RESTORE_INVALID"});
 });
 it("refuses destinations inside the source data, storage or backups without touching them",async()=>{
  const db=openCopy(),before={db:sha(join(source,"data/app.db")),storage:await listing(join(source,"storage")),data:await listing(join(source,"data"))};
  for(const destination of [join(source,"storage","inside"),join(source,"data","inside"),join(source,"inside")])expect(await failure(restoreService(db,now).inspect({backupId:b1,destination}))).toMatchObject({code:"INVALID_INPUT"});
  expect({db:sha(join(source,"data/app.db")),storage:await listing(join(source,"storage")),data:await listing(join(source,"data"))}).toEqual(before);
 });
 it("carries source boundaries to a copy of a copy",async()=>{
  const db=openCopy();const second=join(root,"second"),local=await backup(db);await restore(db,local,second);db.close();copy=null;
  vi.stubEnv("DREAM_DATA_ROOT",second);copy=openDatabase(join(second,"data/app.db"),{fileMustExist:true});
  const state=restoreStateSchema.parse(JSON.parse(maintenanceRepository(copy).setting("restore.info")!.valueJson));
  expect(state.protectedRoots).toEqual(expect.arrayContaining([source,copyRoot,join(copyRoot,"storage")]));
  await rm(join(source,"data","app.db"));// boundary must not depend on the data-root heuristic
  expect(await failure(restoreService(copy,now).inspect({backupId:b1,destination:join(source,"storage","nested")}))).toMatchObject({code:"INVALID_INPUT"});
 });
 it("resolves a junction alias before the boundary check",async(context)=>{
  const link=join(root,"alias");try{await symlink(source,link,"junction");}catch{context.skip();}
  const db=openCopy();expect(await failure(restoreService(db,now).inspect({backupId:b1,destination:join(link,"storage","via-junction")}))).toMatchObject({code:"INVALID_INPUT"});
 });
});

describe("legacy restored copies without recorded origin",()=>{
 async function legacy(){const db=openCopy(),repo=maintenanceRepository(db),state=restoreStateSchema.parse(JSON.parse(repo.setting("restore.info")!.valueJson));
  repo.setSetting("restore.info",{ticketId:state.ticketId,backupId:state.backupId,destination:state.destination,backupCreatedAt:state.backupCreatedAt,restoredAt:state.restoredAt});return db;}
 it("keeps rows without a matching marker unconfirmed regardless of clock and excludes them from totals",async()=>{
  const db=await legacy();time=Date.parse("2030-01-01T00:00:00Z");
  const unmarked=v7();maintenanceRepository(db).insertBackup({id:unmarked,kind:"manual",path:join(copyRoot,"backups",`${unmarked}.zip`),status:"failed",createdAt:new Date(time).toISOString()});
  expect(row(db,b1)).toMatchObject({origin:"unconfirmed",originUnconfirmed:true,inherited:false,available:true,restorable:true});
  expect(row(db,b2)).toMatchObject({origin:"inherited",interruptedByRestore:true});
  expect(row(db,unmarked)).toMatchObject({origin:"unconfirmed"});
  let list=backupService(db,now).list();expect(list.lastSuccess).toBeNull();expect(list.lastFailure).toBeNull();
  const local=await backup(db);list=backupService(db,now).list();
  expect(row(db,local)).toMatchObject({origin:"local"});expect(list.lastSuccess?.id).toBe(local);
 });
 it("refuses the source data folder by the stat-only data-root guard",async()=>{
  const db=await legacy();
  for(const destination of [join(source,"storage","inside"),join(source,"data","inside")])expect(await failure(restoreService(db,now).inspect({backupId:b1,destination}))).toMatchObject({code:"INVALID_INPUT"});
  await restore(db,b1,join(root,"outside"));
 });
 it("treats an unreadable restore record conservatively",async()=>{
  const db=openCopy();maintenanceRepository(db).setSetting("restore.info",{broken:true});
  expect(row(db,b1)).toMatchObject({origin:"unconfirmed"});expect(row(db,b2)).toMatchObject({origin:"inherited"});
  const local=await backup(db);expect(row(db,local)).toMatchObject({origin:"unconfirmed"});expect(backupService(db,now).list().lastSuccess).toBeNull();
 });
});

describe("boundary helpers",()=>{
 it("compares stored roots lexically when they are missing on this PC and fails closed otherwise",async()=>{
  const gone=join(root,"gone","source");
  await expect(validateInheritedBoundaries(join(gone,"storage","x"),[gone])).rejects.toMatchObject({code:"INVALID_INPUT"});
  await expect(validateInheritedBoundaries(join(root,"elsewhere"),[gone,"Q:\\missing-drive\\dream"])).resolves.toBeUndefined();
 });
 it("detects another data folder by an ancestor data/app.db only",async()=>{
  const other=join(root,"other-instance");await mkdir(join(other,"data"),{recursive:true});await writeFile(join(other,"data","app.db"),"");
  await expect(rejectForeignDataRoot(join(other,"storage","x"))).rejects.toMatchObject({code:"INVALID_INPUT"});
  await expect(rejectForeignDataRoot(join(root,"plain","x"))).resolves.toBeUndefined();
 });
 it("never exposes a never-restored instance's rows as inherited",async()=>{
  const list=backupService(handle,now).list();expect(list.rows.every(item=>item.origin==="local")).toBe(true);expect(list.lastSuccess?.id).toBe(b2);
 });
});
