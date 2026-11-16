// Checks run on the 6-step app (s6Migrations): the product list now adds 0007 (T-109), checked with s7.
// Fixed virtual backup s6 (T-105): s5 + 0006_renders.sql + five virtual render rows and two MP4 files. Generated once
// with S6_WRITE=1 (refuses to overwrite). Checks: kept bytes and record, regeneration, the 0001–0005 journal equals
// s5's, s5 → upgrade has the s6 structure, direct s6 restore keeps finished renders and their files and stops the
// running one, s5 upgrade restore, refusal of a changed render file / input hash, an older app and a changed 0006.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, migrationEntry, productMigrations, type Migration } from "@/lib/db/migrate";
import { inventoryHash, readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { backupManifestSchema } from "@/lib/backup/schema";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { restoreService, type RestoreOptions, type RestoreStage } from "@/lib/services/restore";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { logicalHash, P_REGEN, schemaHash, snapshotDb, type DbSnap } from "./fixtures/backups/s4-compare";
import { S5_RECORD, S5_ZIP, s5Migrations } from "./fixtures/backups/s5-build";
import { assembleS6Zip, buildS6Runtime, S6_GENERATOR_VERSION, S6_INPUTS, s6Migrations, S6_RECORD, S6_ZIP, s6Ids, s6RenderPath } from "./fixtures/backups/s6-build";

type S6Record={fixture:"s6";generatorVersion:number;zip:{sha256:string;sizeBytes:number};backupId:string;migrations:{version:number;name:string;sha256:string}[];logical:{profile:"P_REGEN";all:string;tables:Record<string,string>};schema:string;renders:RenderSummary[];files:{path:string;sha256:string;sizeBytes:number}[]};
type RenderSummary={id:string;status:string;name_seq:number;display_name:string;file_path:string|null;sha256:string|null;size_bytes:number|null;canceled_late:number;error_code:string|null;input_sha256:string};
const plain=(list:readonly Migration[])=>list.map(({version,name,sha256})=>({version,name,sha256}));
let root:string,handle:DatabaseHandle|undefined,committed:{s4:{sha256:string;sizeBytes:number};s5:{sha256:string;sizeBytes:number};s6:{sha256:string;sizeBytes:number}|null};
const now=()=>Date.parse("2026-11-16T10:00:00Z");
beforeAll(async()=>{committed={s4:await fileDigest(S4_ZIP),s5:await fileDigest(S5_ZIP),s6:existsSync(S6_ZIP)?await fileDigest(S6_ZIP):null};});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed.s4);expect(await fileDigest(S5_ZIP)).toEqual(committed.s5);if(committed.s6)expect(await fileDigest(S6_ZIP)).toEqual(committed.s6);});
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-s6-")));});
afterEach(async()=>{vi.unstubAllEnvs();handle?.close();handle=undefined;if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

async function extract(zip:string,into:string){const manifest=await readBackupManifest(zip);await verifyBackupArchive(zip,manifest,into);return {manifest,db:join(into,"data/app.db")};}
const renderRows=(sqlite:Database.Database)=>!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='renders'").get()?[]:sqlite.prepare("SELECT id,status,name_seq,display_name,file_path,sha256,size_bytes,canceled_late,error_code,input_sha256 FROM renders ORDER BY name_seq").all() as RenderSummary[];
function describeDb(path:string){const sqlite=new Database(path,{readonly:true,fileMustExist:true});try{const snap=snapshotDb(sqlite);return {snap,logical:logicalHash(snap,P_REGEN),schema:schemaHash(sqlite),renders:renderRows(sqlite)};}finally{sqlite.close();}}
async function generate(into:string){const runtime=join(into,"runtime");await buildS6Runtime(runtime);const out=join(into,"s6.zip");const manifest=await assembleS6Zip(runtime,join(into,"work"),out);return {out,manifest};}
// A source instance on the given list, with the backup registered like a verified backup row.
async function source(migrations:readonly Migration[],zip:string){const runtime=join(root,"source");for(const path of ["data","storage","backups"])mkdirSync(join(runtime,path),{recursive:true});vi.stubEnv("DREAM_DATA_ROOT",runtime);handle=openDatabase(join(runtime,"data/app.db"));migrateDatabase(handle.sqlite,{migrations,now});
  const manifest=await readBackupManifest(zip),digest=await fileDigest(zip);handle.sqlite.prepare("INSERT INTO backups(id,kind,path,db_sha256,file_inventory_sha256,status,created_at) VALUES(?,?,?,?,?,?,?)").run(manifest.backupId,"manual",zip,manifest.database.sha256,manifest.inventorySha256,"succeeded",manifest.createdAt);
  handle.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`backup.${manifest.backupId}.meta`,JSON.stringify({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:new Date(now()).toISOString()}));return manifest;}
async function copied(zip:string,name:string){const to=join(root,"archive",name);mkdirSync(dirname(to),{recursive:true});cpSync(zip,to);return to;}
// A changed copy of s6: extract, let `change` edit the DB / files, then re-archive with a matching manifest.
async function rewritten(name:string,change:(folder:string,sqlite:Database.Database)=>void){
  const into=join(root,`rw-${name}`),{manifest,db}=await extract(S6_ZIP,into);const sqlite=new Database(db);try{change(into,sqlite);sqlite.pragma("journal_mode = DELETE");}finally{sqlite.close();}
  const files=await Promise.all(manifest.files.map(async file=>({path:file.path,...await fileDigest(join(into,file.path))})));
  const next=backupManifestSchema.parse({...manifest,database:{path:manifest.database.path,...await fileDigest(db)},files,inventorySha256:inventoryHash(files)}),zip=join(root,"archive",`${name}.zip`);mkdirSync(dirname(zip),{recursive:true});
  await writeArchive(zip,[{path:next.database.path,filename:db},...files.map(file=>({path:file.path,filename:join(into,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(next))}]);return zip;
}
async function refused(zip:string,code:string,migrations:readonly Migration[]=s6Migrations()){
  const manifest=await source(migrations,zip),destination=join(root,"restored"),digest=await fileDigest(zip),svc=restoreService(handle!,now,{migrations});
  let error:{code?:string}|null=null;try{const checked=await svc.inspect({backupId:manifest.backupId,destination});await svc.finish(checked.ticketId);}catch(caught){error=caught as {code?:string};}
  expect(error).toMatchObject({code});expect(existsSync(destination)).toBe(false);expect(await fileDigest(zip)).toEqual(digest);
}

describe.runIf(process.env.S6_WRITE==="1")("s6 생성 (한 번만)",()=>{
  it("s6.zip과 기록 파일을 새로 만든다 (있으면 거부)",async()=>{
    if(existsSync(S6_ZIP)||existsSync(S6_RECORD))throw new Error("s6가 이미 있어요. 고정 백업은 덮어쓰지 않아요.");
    const {out,manifest}=await generate(root),described=describeDb((await extract(out,join(root,"check"))).db);
    writeFileSync(S6_ZIP,readFileSync(out),{flag:"wx"});
    const record:S6Record={fixture:"s6",generatorVersion:S6_GENERATOR_VERSION,zip:await fileDigest(S6_ZIP),backupId:manifest.backupId,migrations:manifest.migrations,logical:{profile:"P_REGEN",...described.logical},schema:described.schema,renders:described.renders,files:manifest.files.filter(file=>file.path.includes("/renders/"))};
    writeFileSync(S6_RECORD,`${JSON.stringify(record,null,2)}\n`,{flag:"wx"});
  },120000);
});

describe.skipIf(process.env.S6_WRITE==="1")("고정 백업 s6",()=>{
  const record=()=>JSON.parse(readFileSync(S6_RECORD,"utf8")) as S6Record,ids=s6Ids(),project=s4Ids().main;
  it("보관 원본: ZIP 해시·마이그레이션 6줄(1~5는 s5와 같음)·렌더 5행·파일 2개·논리 내용·스키마가 기록과 같고, 다시 만들어도 같다",async()=>{
    const expected=record();expect(await fileDigest(S6_ZIP)).toEqual(expected.zip);
    const {manifest,db}=await extract(S6_ZIP,join(root,"a1"));expect(manifest.migrations).toEqual(plain(s6Migrations()));expect(plain(productMigrations()).slice(0,6)).toEqual(manifest.migrations);
    const s5=JSON.parse(readFileSync(S5_RECORD,"utf8")) as {migrations:unknown[]};expect(manifest.migrations.slice(0,5)).toEqual(s5.migrations);expect(manifest.migrations[5]).toMatchObject({version:6,name:"0006_renders.sql"});
    const described=describeDb(db);expect(described.logical).toEqual({all:expected.logical.all,tables:expected.logical.tables});expect(described.schema).toBe(expected.schema);expect(described.renders).toEqual(expected.renders);
    expect(described.renders.map(row=>[row.status,row.canceled_late,!!row.file_path])).toEqual([["succeeded",0,true],["canceled",1,true],["failed",0,false],["canceled",0,false],["running",0,false]]);
    for(const [id,input] of [[ids.passed,S6_INPUTS.passed],[ids.late,S6_INPUTS.late]] as const){const path=`storage/${s6RenderPath(project,id)}`,file=manifest.files.find(item=>item.path===path)!;expect(file).toEqual({path,...await fileDigest(input)});expect(described.renders.find(row=>row.id===id)).toMatchObject({sha256:file.sha256,size_bytes:file.sizeBytes});}
    expect(expected.files).toHaveLength(2);
    const regen=describeDb((await extract((await generate(join(root,"regen"))).out,join(root,"regen-x"))).db);expect(regen.logical).toEqual(described.logical);expect(regen.schema).toBe(described.schema);
  },120000);
  it("s5를 제품 목록 앞 6단계로 올리면 s6와 같은 구조이고 renders는 비어 있으며, 렌더와 무관한 표는 그대로다",async()=>{
    const {db}=await extract(S5_ZIP,join(root,"s5"));const before=describeDb(db);const sqlite=new Database(db);try{sqlite.pragma("foreign_keys = ON");migrateDatabase(sqlite,{migrations:s6Migrations(),now});}finally{sqlite.close();}
    const after=describeDb(db);expect(after.schema).toBe(record().schema);expect(after.renders).toEqual([]);
    for(const [name,hash] of Object.entries(before.logical.tables))if(name!=="__schema_migrations")expect(after.logical.tables[name]).toBe(hash);
    const s6=record().logical.tables;for(const name of Object.keys(s6))if(!["__schema_migrations","jobs","renders"].includes(name))expect(after.logical.tables[name]).toBe(s6[name]);
  });
  it("s6 직접 복원(same): 끝난 렌더와 파일은 그대로, 진행 중이던 렌더는 RESTORE_INTERRUPTED, 실패·취소 행은 파일 없이 복원",async()=>{
    const zip=await copied(S6_ZIP,"s6.zip"),manifest=await source(s6Migrations(),zip),destination=join(root,"restored");
    const svc=restoreService(handle!,now,{migrations:s6Migrations()}),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"same",fromVersion:6,toVersion:6,pendingJobs:5}); // s4 queued/running 4 + the running render 1
    await svc.finish(checked.ticketId);
    const sqlite=new Database(join(destination,"data/app.db"),{readonly:true,fileMustExist:true});
    try{
      const rows=renderRows(sqlite),expected=record().renders;
      for(const id of [ids.passed,ids.late,ids.verifyFailed,ids.canceled])expect(rows.find(row=>row.id===id)).toEqual(expected.find(row=>row.id===id));
      expect(rows.find(row=>row.id===ids.running)).toMatchObject({status:"failed",error_code:"RESTORE_INTERRUPTED",file_path:null});
      expect(sqlite.prepare("SELECT status,error_code FROM jobs WHERE id=?").get(ids.jobRunning)).toEqual({status:"canceled",error_code:"RESTORED_NOT_RESUMED"});
      expect(sqlite.prepare("SELECT status FROM jobs WHERE id=?").get(ids.jobPassed)).toEqual({status:"succeeded"});
      expect(sqlite.prepare("SELECT cleanup_left_json FROM renders WHERE id=?").get(ids.canceled)).toEqual({cleanup_left_json:JSON.stringify([`tmp/render-${ids.canceled}-1/out.mp4`])});
    }finally{sqlite.close();}
    for(const [id,input] of [[ids.passed,S6_INPUTS.passed],[ids.late,S6_INPUTS.late]] as const)expect(await fileDigest(join(destination,"storage",...s6RenderPath(project,id).split("/")))).toEqual(await fileDigest(input));
    for(const id of [ids.verifyFailed,ids.canceled,ids.running])expect(existsSync(join(destination,"storage",...s6RenderPath(project,id).split("/")))).toBe(false);
    expect(await fileDigest(zip)).toEqual(record().zip);
  },120000);
  it("s5 올려서 복원: staging에서 올린 직후 구조 = s6, renders 비어 있음, 원본 s5 ZIP 그대로",async()=>{
    const zip=await copied(S5_ZIP,"s5.zip"),manifest=await source(s6Migrations(),zip),destination=join(root,"restored"),upgraded:DbSnap[]=[];let schema="";
    const options:RestoreOptions={migrations:s6Migrations(),onStage:async(stage:RestoreStage,staging:string)=>{if(stage==="upgraded"){const sqlite=new Database(join(staging,"data/app.db"),{readonly:true,fileMustExist:true});try{upgraded.push(snapshotDb(sqlite));schema=schemaHash(sqlite);}finally{sqlite.close();}}}};
    const svc=restoreService(handle!,now,options),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"upgrade",fromVersion:5,toVersion:6});await svc.finish(checked.ticketId);
    expect(upgraded).toHaveLength(1);expect(schema).toBe(record().schema);expect(upgraded[0].get("renders")!.rows.size).toBe(0);
    const sqlite=new Database(join(destination,"data/app.db"),{readonly:true,fileMustExist:true});try{expect(sqlite.prepare("SELECT name FROM __schema_migrations ORDER BY version").all().map(row=>(row as {name:string}).name).at(-1)).toBe("0006_renders.sql");}finally{sqlite.close();}
    expect(await fileDigest(zip)).toEqual(committed.s5);
  },120000);
  it("렌더 파일이 기록과 다른 백업(manifest까지 맞춤)은 RESTORE_INVALID, 목적지 없음",async()=>{
    const zip=await rewritten("swapped-file",folder=>{cpSync(S6_INPUTS.late,join(folder,"storage",...s6RenderPath(project,ids.passed).split("/")));});
    await refused(zip,"RESTORE_INVALID");
  },120000);
  it("입력 기록과 해시가 다른 렌더 행이 있는 백업은 RESTORE_INVALID",async()=>{
    const zip=await rewritten("input-hash",(_folder,sqlite)=>{const trigger=(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='render_input_immutable'").get() as {sql:string}).sql;sqlite.exec("DROP TRIGGER render_input_immutable");sqlite.prepare("UPDATE renders SET input_sha256=? WHERE id=?").run("f".repeat(64),ids.verifyFailed);sqlite.exec(trigger);});
    await refused(zip,"RESTORE_INVALID");
  },120000);
  it("0006 이전 앱(5단계)은 s6를 BACKUP_TOO_NEW로, 0006 원문이 다른 앱은 BACKUP_SCHEMA_MISMATCH로 거부한다",async()=>{
    await refused(await copied(S6_ZIP,"s6-old.zip"),"BACKUP_TOO_NEW",s5Migrations());
    handle?.close();handle=undefined;await rm(join(root,"source"),{recursive:true,force:true});
    const six=productMigrations()[5],changed=[...s5Migrations(),migrationEntry(6,six.name,`${six.sql}\n-- changed\n`)];expect(changed[5].sha256).not.toBe(six.sha256);
    await refused(await copied(S6_ZIP,"s6-changed.zip"),"BACKUP_SCHEMA_MISMATCH",changed);
  },120000);
  it("s4 ZIP 원본은 이 파일에서 읽기만 한다",async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed.s4);});
});
