// T-160 (F159-1): a manifest 2 whose sound source is a sample must be a sample bundle. One way only. Every database is
// a copy of the fixed s4 backup in an OS temp folder; the sound is a short synthetic PCM WAV (virtual data).
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
// Only for the finish case: lets one inspect run under the rule as it was before T-160 (a ticket checked by 2c79ee9).
const before=vi.hoisted(()=>({on:false}));
vi.mock("@/lib/export/schema",async(importOriginal)=>{
  const real=await importOriginal<typeof import("@/lib/export/schema")>();
  const loose=(value:unknown)=>before.on&&value&&typeof value==="object"&&(value as {manifestVersion?:unknown}).manifestVersion===2?{...value,isMock:true}:value;
  const back=<T,>(data:T,value:unknown)=>before.on&&data&&typeof data==="object"&&value&&typeof value==="object"&&"isMock" in value?{...data,isMock:(value as {isMock:unknown}).isMock}:data;
  const manifestSchema={...real.manifestSchema,
    parse:(value:unknown)=>back(real.manifestSchema.parse(loose(value)),value),
    safeParse:(value:unknown)=>{const result=real.manifestSchema.safeParse(loose(value));return result.success?{...result,data:back(result.data,value)}:result;}};
  return {...real,manifestSchema};
});
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { journal, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkExportRows, ExportRowError } from "@/lib/db/export-data";
import { inventoryHash, readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { backupMetaSchema } from "@/lib/backup/schema";
import { manifestSchema, manifestV1Schema, manifestV2Schema } from "@/lib/export/schema";
import { fileDigest, verifyZip, writeArchive, writeZip } from "@/lib/export/zip";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { exportDownload, exportService } from "@/lib/services/exports";
import { jobsService } from "@/lib/services/jobs";
import { restoreService } from "@/lib/services/restore";
import { S4_ZIP, exportManifest, s4Ids } from "./fixtures/backups/s4-build";
import { writeExportFixture, type ExportFixture } from "./export-row-helpers";

const ids=s4Ids(),now=()=>Date.parse("2026-11-17T09:00:00Z");
let root:string;const handles:DatabaseHandle[]=[];
beforeEach(()=>{before.on=false;root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t160-")));});
afterEach(()=>{before.on=false;for(const handle of handles.splice(0))handle.close();vi.unstubAllEnvs();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
async function runtime(migrations=productMigrations(),name="rt"){
  const folder=join(root,name);await verifyBackupArchive(S4_ZIP,await readBackupManifest(S4_ZIP),folder);mkdirSync(join(folder,"backups"),{recursive:true});
  const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");migrateDatabase(sqlite,{migrations,now});}finally{sqlite.close();}
  vi.stubEnv("DREAM_DATA_ROOT",folder);return folder;
}
const open=(folder:string)=>{const handle=openDatabase(join(folder,"data/app.db"),{fileMustExist:true});handles.push(handle);return handle;};
const revisionOf=(sqlite:Database.Database)=>(sqlite.prepare("SELECT content_revision AS r FROM projects WHERE id=?").get(ids.main) as {r:number}).r;
const insertRow=(sqlite:Database.Database,row:{id:string;relPath:string;manifestJson:string;sha256:string},version=2)=>sqlite.prepare("INSERT INTO exports(id,project_id,content_revision,status,file_path,manifest_version,manifest_json,sha256,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(row.id,ids.main,revisionOf(sqlite),"succeeded",row.relPath,version,row.manifestJson,row.sha256,"2026-11-17T00:00:00Z","2026-11-17T00:00:01Z");
// The F159-1 shape: a valid sample manifest 2 with only the bundle flag turned off, packed into a new real ZIP whose
// file hashes, manifest and outer hash all agree (so only the meaning is wrong).
async function contradiction(storage:string,revision:number,id=v7()){
  const good=await writeExportFixture(storage,{id,projectId:ids.main,contentRevision:revision,version:2});
  const manifest={...good.manifest,isMock:false},file=join(storage,...good.relPath.split("/"));await rm(file);
  await writeZip(file,good.sources,manifest as never);const digest=await fileDigest(file);
  return {...good,manifest,manifestJson:JSON.stringify(manifest),sha256:digest.sha256,sizeBytes:digest.sizeBytes} as ExportFixture;
}
function prepareJobs(handle:DatabaseHandle){handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status='running'").run();handle.sqlite.prepare("UPDATE jobs SET next_run_at='2099-01-01T00:00:00Z' WHERE status='queued'").run();handle.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();}

describe("manifest 2 샘플 표시 (schema)",()=>{
  it("샘플 소리가 하나라도 있으면 묶음도 샘플이어야 하고, 반대 방향은 강제하지 않는다 · v1은 그대로",async()=>{
    const sample=(await writeExportFixture(join(root,"a"),{projectId:ids.main,contentRevision:1,version:2})).manifest;
    const real=(await writeExportFixture(join(root,"b"),{projectId:ids.main,contentRevision:1,version:2,audioMock:false})).manifest;
    expect(manifestSchema.safeParse({...sample,isMock:false}).success).toBe(false);expect(manifestV2Schema.safeParse({...sample,isMock:false}).success).toBe(false);
    expect(manifestSchema.safeParse(sample).success).toBe(true);
    expect(manifestSchema.safeParse(real).success).toBe(true);expect(manifestSchema.safeParse({...real,isMock:false}).success).toBe(true);
    // two sounds, one sample: still needs a sample bundle
    const second={...real.files[1],path:"audio/02_second.wav",audio:{assetId:v7(),roles:["voice"],isMock:false}};
    const mixed={...sample,files:[...sample.files,second]};expect(manifestSchema.safeParse(mixed).success).toBe(true);expect(manifestSchema.safeParse({...mixed,isMock:false}).success).toBe(false);
    const v1=exportManifest(ids);for(const isMock of [true,false])expect(JSON.stringify(manifestV1Schema.parse({...v1,isMock}))).toBe(JSON.stringify({...v1,isMock}));
  });
});

describe("행 검사 · 목록 · 다운로드 · 9→10",()=>{
  it("0010 트리거는 이 뜻을 못 보지만 코드 행 검사가 거절하고, 목록은 샘플 아님으로 보이지 않고 다운로드는 거절",async()=>{
    const folder=await runtime(),handle=open(folder),bad=await contradiction(join(folder,"storage"),revisionOf(handle.sqlite));
    insertRow(handle.sqlite,bad);// the published 0010 SQL stays as it is: it checks structure, not this meaning
    expect(()=>checkExportRows(handle.sqlite)).toThrow(ExportRowError);
    await expect(verifyZip(join(folder,"storage",bad.relPath),bad.manifest)).rejects.toThrow();
    const listed=exportService(handle).list(ids.main).rows.find(row=>row.id===bad.id)!;expect(listed.isMock).toBeNull();expect(listed.fileName).toBeNull();expect(listed.isMock).not.toBe(false);
    await expect(exportDownload(bad.id)).rejects.toThrow();
    // a trigger-free copy changes nothing: the code check does not rely on SQL
    handle.sqlite.exec("DROP TRIGGER export_manifest_insert_guard; DROP TRIGGER export_manifest_update_guard;");expect(()=>checkExportRows(handle.sqlite)).toThrow(/not a known version/);
  },120000);
  it("9단계에 쓰인 모순 v2 행이 있으면 9→10 승격이 멈추고 행·기록·트리거가 그대로",async()=>{
    const folder=await runtime(productMigrations().slice(0,9),"nine"),file=join(folder,"data/app.db");
    {const sqlite=new Database(file);try{insertRow(sqlite,await contradiction(join(folder,"storage"),revisionOf(sqlite)));}finally{sqlite.close();}}
    const read=()=>{const db=new Database(file,{readonly:true});try{return {rows:db.prepare("SELECT * FROM exports ORDER BY id").all(),journal:journal(db)!.map(row=>row.version),triggers:db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'export_manifest%'").all()};}finally{db.close();}};
    const was=read();expect(was.journal).toEqual([1,2,3,4,5,6,7,8,9]);
    {const db=new Database(file);try{db.pragma("foreign_keys = ON");expect(()=>migrateDatabase(db,{now})).toThrow(ExportRowError);}finally{db.close();}}
    expect(read()).toEqual(was);expect(was.triggers).toEqual([]);
  },120000);
});

describe("실제 백업 · 복원 검사 · 확정",()=>{
  it("모순 행이 있는 DB는 백업 작업이 실패하고, 정상 샘플 v2는 _SAMPLE 이름으로 목록·다운로드된다",async()=>{
    const folder=await runtime(),handle=open(folder),good=await writeExportFixture(join(folder,"storage"),{projectId:ids.main,contentRevision:revisionOf(handle.sqlite),version:2});
    insertRow(handle.sqlite,good);expect(()=>checkExportRows(handle.sqlite)).not.toThrow();
    expect(exportService(handle).list(ids.main).rows.find(row=>row.id===good.id)).toMatchObject({isMock:true,fileName:`editing-${good.id}_SAMPLE.zip`});
    expect((await exportDownload(good.id)).title).toBe(`editing-${good.id}_SAMPLE.zip`);
    // an old v1 export of s4 still reads the same
    const old=exportService(handle).list(ids.main).rows.find(row=>row.status==="succeeded"&&row.id!==good.id)!;expect(old.isMock).toBe(true);expect((await exportDownload(old.id)).sizeBytes).toBeGreaterThan(0);
    const bad=await contradiction(join(folder,"storage"),revisionOf(handle.sqlite));insertRow(handle.sqlite,bad);prepareJobs(handle);
    backupService(handle,now).request();const claimed=jobsService(handle,now).claim()!;expect(claimed.kind).toBe("backup");await expect(runClaimedBackup(handle,claimed,now)).rejects.toThrow();
  },180000);

  // A backup ZIP repacked from a snapshot whose sample v2 row became the F159-1 row, with its new export ZIP, and every
  // digest (export row, storage inventory, database, outer ZIP, registered metadata) matched again.
  async function forged(){
    const folder=await runtime(),handle=open(folder),repo=maintenanceRepository(handle),revision=revisionOf(handle.sqlite);
    const good=await writeExportFixture(join(folder,"storage"),{projectId:ids.main,contentRevision:revision,version:2});insertRow(handle.sqlite,good);prepareJobs(handle);
    const request=backupService(handle,now).request()!,claimed=jobsService(handle,now).claim()!;await runClaimedBackup(handle,claimed,now);
    const badZip=join(root,"bad-export.zip"),manifest={...good.manifest,isMock:false};await writeZip(badZip,good.sources,manifest as never);const badDigest=await fileDigest(badZip);
    const id=v7(),snapshot=join(root,`${id}.db`);await handle.sqlite.backup(snapshot);
    {const db=new Database(snapshot);try{
      const saved=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='completed_export_immutable'").get() as {sql:string};db.exec("DROP TRIGGER completed_export_immutable");
      try{db.prepare("UPDATE exports SET manifest_json=?,sha256=? WHERE id=?").run(JSON.stringify(manifest),badDigest.sha256,good.id);}finally{db.exec(saved.sql);}
      db.pragma("journal_mode=DELETE");}finally{db.close();}}
    const original=await readBackupManifest(repo.backup(request.id)!.path),key=`storage/${good.relPath}`;
    const files=original.files.map(file=>file.path===key?{...file,sha256:badDigest.sha256,sizeBytes:badDigest.sizeBytes}:file);expect(files.some(file=>file.path===key)).toBe(true);
    const backup={...original,backupId:id,files,database:{path:"data/app.db",...await fileDigest(snapshot)},inventorySha256:inventoryHash(files)};
    const path=join(folder,"backups",`${id}.zip`);
    await writeArchive(path,[{path:"data/app.db",filename:snapshot},...files.map(file=>({path:file.path,filename:file.path===key?badZip:join(folder,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(backup))}]);
    repo.insertBackup({id,kind:"manual",path,status:"succeeded",dbSha256:backup.database.sha256,fileInventorySha256:backup.inventorySha256});const digest=await fileDigest(path);
    repo.insertSetting(`backup.${id}.meta`,backupMetaSchema.parse({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:files.length+1,verifiedAt:new Date(now()).toISOString()}));
    return {handle,backupId:id};
  }
  it("모든 해시를 다시 맞춘 모순 백업: 복원 검사가 거절하고 목적지를 만들지 않는다",async()=>{
    const {handle,backupId}=await forged(),destination=join(root,"restored");
    await expect(restoreService(handle,now).inspect({backupId,destination})).rejects.toThrow();expect(existsSync(destination)).toBe(false);
  },180000);
  it("T-160 이전 규칙으로 검사된 표가 있어도 확정 단계가 다시 판독해 거절하고 목적지를 만들지 않는다",async()=>{
    const {handle,backupId}=await forged(),destination=join(root,"restored");
    before.on=true;const checked=await restoreService(handle,now).inspect({backupId,destination});before.on=false;expect(checked).toMatchObject({compat:"same"});
    await expect(restoreService(handle,now).finish(checked.ticketId)).rejects.toThrow();expect(existsSync(destination)).toBe(false);
  },180000);
});
