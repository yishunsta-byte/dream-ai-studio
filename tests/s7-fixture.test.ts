// Fixed virtual backup s7 (T-109): s6 + 0007_render_guards.sql. Generated once with S7_WRITE=1 (refuses to overwrite).
// Checks: kept bytes and record, regeneration, s6 → 0007 keeps every row, direct s7 restore, s6 (6→7) and s5 (5→7)
// upgrade restores, and refusal of repacked backups whose rows break F107-1/2/3 (on s7, and on s6 at both the 6-step
// app and the 7-step app), an older app and a changed 0007. s4/s5/s6 bytes are checked unchanged.
// T-132: the product list is longer now (0008); these checks keep s7's own 7-step app (s7Migrations) as the app under
// test, so their meaning is unchanged. Product (8-step) restores of s7 are checked in p2-5a-audio-db.test.ts.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, migrationEntry, type Migration } from "@/lib/db/migrate";
import { renderInputSha256 } from "@/lib/db/render-data";
import { inventoryHash, readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { backupManifestSchema } from "@/lib/backup/schema";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { restoreService, type RestoreOptions, type RestoreStage } from "@/lib/services/restore";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { logicalHash, P_REGEN, schemaHash, snapshotDb } from "./fixtures/backups/s4-compare";
import { S5_ZIP } from "./fixtures/backups/s5-build";
import { S6_INPUTS, s6Migrations, S6_RECORD, S6_ZIP, s6Ids, s6RenderPath } from "./fixtures/backups/s6-build";
import { assembleS7Zip, buildS7Runtime, S7_GENERATOR_VERSION, s7Migrations, S7_RECORD, S7_ZIP } from "./fixtures/backups/s7-build";

type Digest={sha256:string;sizeBytes:number};
type RenderSummary={id:string;status:string;name_seq:number;display_name:string;file_path:string|null;sha256:string|null;size_bytes:number|null;canceled_late:number;error_code:string|null;input_sha256:string};
type S7Record={fixture:"s7";generatorVersion:number;zip:Digest;backupId:string;migrations:{version:number;name:string;sha256:string}[];logical:{profile:"P_REGEN";all:string;tables:Record<string,string>};schema:string;renders:RenderSummary[]};
const plain=(list:readonly Migration[])=>list.map(({version,name,sha256})=>({version,name,sha256}));
let root:string,handle:DatabaseHandle|undefined,committed:{s4:Digest;s5:Digest;s6:Digest;s7:Digest|null};
const now=()=>Date.parse("2026-11-16T10:00:00Z");
beforeAll(async()=>{committed={s4:await fileDigest(S4_ZIP),s5:await fileDigest(S5_ZIP),s6:await fileDigest(S6_ZIP),s7:existsSync(S7_ZIP)?await fileDigest(S7_ZIP):null};});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed.s4);expect(await fileDigest(S5_ZIP)).toEqual(committed.s5);expect(await fileDigest(S6_ZIP)).toEqual(committed.s6);if(committed.s7)expect(await fileDigest(S7_ZIP)).toEqual(committed.s7);});
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-s7-")));});
afterEach(async()=>{vi.unstubAllEnvs();handle?.close();handle=undefined;if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

async function extract(zip:string,into:string){const manifest=await readBackupManifest(zip);await verifyBackupArchive(zip,manifest,into);return {manifest,db:join(into,"data/app.db")};}
const renderRows=(sqlite:Database.Database)=>!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='renders'").get()?[]:sqlite.prepare("SELECT id,status,name_seq,display_name,file_path,sha256,size_bytes,canceled_late,error_code,input_sha256 FROM renders ORDER BY name_seq").all() as RenderSummary[];
function describeDb(path:string){const sqlite=new Database(path,{readonly:true,fileMustExist:true});try{const snap=snapshotDb(sqlite);return {snap,logical:logicalHash(snap,P_REGEN),schema:schemaHash(sqlite),renders:renderRows(sqlite)};}finally{sqlite.close();}}
async function generate(into:string){const runtime=join(into,"runtime");await buildS7Runtime(runtime);const out=join(into,"s7.zip");const manifest=await assembleS7Zip(runtime,join(into,"work"),out);return {out,manifest};}
async function source(migrations:readonly Migration[],zip:string){const runtime=join(root,"source");for(const path of ["data","storage","backups"])mkdirSync(join(runtime,path),{recursive:true});vi.stubEnv("DREAM_DATA_ROOT",runtime);handle=openDatabase(join(runtime,"data/app.db"));migrateDatabase(handle.sqlite,{migrations,now});
  const manifest=await readBackupManifest(zip),digest=await fileDigest(zip);handle.sqlite.prepare("INSERT INTO backups(id,kind,path,db_sha256,file_inventory_sha256,status,created_at) VALUES(?,?,?,?,?,?,?)").run(manifest.backupId,"manual",zip,manifest.database.sha256,manifest.inventorySha256,"succeeded",manifest.createdAt);
  handle.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`backup.${manifest.backupId}.meta`,JSON.stringify({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:new Date(now()).toISOString()}));return manifest;}
async function copied(zip:string,name:string){const to=join(root,"archives",name);mkdirSync(dirname(to),{recursive:true});cpSync(zip,to);return to;}
// A repacked copy: every trigger dropped and CHECKs ignored while `change` runs (a backup can hold rows no trigger
// saw), the same trigger SQL put back, then re-archived with matching database and inventory hashes.
async function forged(zip:string,name:string,change:(sqlite:Database.Database)=>void){
  const into=join(root,`forge-${name}`),{manifest,db}=await extract(zip,into);const sqlite=new Database(db);
  try{const saved=sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all() as {name:string;sql:string}[];for(const trigger of saved)sqlite.exec(`DROP TRIGGER "${trigger.name}"`);
    sqlite.pragma("ignore_check_constraints = ON");change(sqlite);sqlite.pragma("ignore_check_constraints = OFF");for(const trigger of saved)sqlite.exec(trigger.sql);sqlite.pragma("journal_mode = DELETE");}finally{sqlite.close();}
  const files=await Promise.all(manifest.files.map(async file=>({path:file.path,...await fileDigest(join(into,file.path))})));
  const next=backupManifestSchema.parse({...manifest,database:{path:manifest.database.path,...await fileDigest(db)},files,inventorySha256:inventoryHash(files)}),out=join(root,"archives",`${name}.zip`);mkdirSync(dirname(out),{recursive:true});
  await writeArchive(out,[{path:next.database.path,filename:db},...files.map(file=>({path:file.path,filename:join(into,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(next))}]);return out;
}
async function refused(zip:string,code:string,migrations:readonly Migration[]){
  const manifest=await source(migrations,zip),destination=join(root,"restored"),digest=await fileDigest(zip),svc=restoreService(handle!,now,{migrations});
  let error:{code?:string}|null=null;try{const checked=await svc.inspect({backupId:manifest.backupId,destination});await svc.finish(checked.ticketId);}catch(caught){error=caught as {code?:string};}
  expect(error).toMatchObject({code});expect(existsSync(destination)).toBe(false);expect(await fileDigest(zip)).toEqual(digest);
  handle?.close();handle=undefined;await rm(join(root,"source"),{recursive:true,force:true});
}
const ids=s6Ids(),project=s4Ids().main;
// F107-3: a succeeded render rebound to revision 999 with input and its hash recomputed (timeline_rev_id unchanged).
function falseBinding(sqlite:Database.Database){const row=sqlite.prepare("SELECT input_json FROM renders WHERE id=?").get(ids.passed) as {input_json:string};const input=JSON.parse(row.input_json) as Record<string,unknown>;input.timelineRevision=999;
  // canonical text: keys sorted at every level, as the generator wrote it
  const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value!==null&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`:JSON.stringify(value);
  const text=canonical(input);sqlite.prepare("UPDATE renders SET timeline_revision=999,input_json=?,input_sha256=? WHERE id=?").run(text,renderInputSha256(text),ids.passed);}

describe.runIf(process.env.S7_WRITE==="1")("s7 생성 (한 번만)",()=>{
  it("s7.zip과 기록 파일을 새로 만든다 (있으면 거부)",async()=>{
    if(existsSync(S7_ZIP)||existsSync(S7_RECORD))throw new Error("s7이 이미 있어요. 고정 백업은 덮어쓰지 않아요.");
    const {out,manifest}=await generate(root),described=describeDb((await extract(out,join(root,"check"))).db);
    writeFileSync(S7_ZIP,readFileSync(out),{flag:"wx"});
    const record:S7Record={fixture:"s7",generatorVersion:S7_GENERATOR_VERSION,zip:await fileDigest(S7_ZIP),backupId:manifest.backupId,migrations:manifest.migrations,logical:{profile:"P_REGEN",...described.logical},schema:described.schema,renders:described.renders};
    writeFileSync(S7_RECORD,`${JSON.stringify(record,null,2)}\n`,{flag:"wx"});
  },120000);
});

describe.skipIf(process.env.S7_WRITE==="1")("고정 백업 s7",()=>{
  const record=()=>JSON.parse(readFileSync(S7_RECORD,"utf8")) as S7Record,s6=()=>JSON.parse(readFileSync(S6_RECORD,"utf8")) as {migrations:unknown[];renders:RenderSummary[];logical:{tables:Record<string,string>}};
  it("보관 원본: ZIP 해시·마이그레이션 7줄(1~6은 s6과 같음)·렌더 5행(s6과 같음)·논리 내용·스키마가 기록과 같고, 다시 만들어도 같다",async()=>{
    const expected=record();expect(await fileDigest(S7_ZIP)).toEqual(expected.zip);
    const {manifest,db}=await extract(S7_ZIP,join(root,"a1"));expect(manifest.migrations).toEqual(plain(s7Migrations()));expect(manifest.migrations).toEqual(plain(s7Migrations()));
    expect(manifest.migrations.slice(0,6)).toEqual(s6().migrations);expect(manifest.migrations[6]).toMatchObject({version:7,name:"0007_render_guards.sql"});
    const described=describeDb(db);expect(described.logical).toEqual({all:expected.logical.all,tables:expected.logical.tables});expect(described.schema).toBe(expected.schema);
    expect(described.renders).toEqual(expected.renders);expect(described.renders).toEqual(s6().renders);
    for(const [name,hash] of Object.entries(s6().logical.tables))if(name!=="__schema_migrations")expect(described.logical.tables[name],name).toBe(hash);
    const regen=describeDb((await extract((await generate(join(root,"regen"))).out,join(root,"regen-x"))).db);expect(regen.logical).toEqual(described.logical);expect(regen.schema).toBe(described.schema);
  },180000);
  it("s6를 7단계 목록으로 올리면(0007, 행 검사 통과) s7과 같다 — 0006 행은 바뀌지 않는다",async()=>{
    const {db}=await extract(S6_ZIP,join(root,"s6"));const sqlite=openDatabase(db,{fileMustExist:true});try{expect(migrateDatabase(sqlite.sqlite,{migrations:s7Migrations(),now})).toBe(1);}finally{sqlite.close();}
    const after=describeDb(db);expect(after.schema).toBe(record().schema);expect(after.logical.all).toBe(record().logical.all);
  });
  it("s7 직접 복원(same 7→7): 끝난 렌더·파일 그대로, 진행 중 렌더는 RESTORE_INTERRUPTED, 0007 트리거가 복원본에서도 동작",async()=>{
    const zip=await copied(S7_ZIP,"s7.zip"),manifest=await source(s7Migrations(),zip),destination=join(root,"restored");
    const svc=restoreService(handle!,now,{migrations:s7Migrations()}),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"same",fromVersion:7,toVersion:7});await svc.finish(checked.ticketId);
    const restored=openDatabase(join(destination,"data/app.db"),{fileMustExist:true});
    try{const rows=renderRows(restored.sqlite);for(const id of [ids.passed,ids.late,ids.verifyFailed,ids.canceled])expect(rows.find(row=>row.id===id)).toEqual(record().renders.find(row=>row.id===id));
      expect(rows.find(row=>row.id===ids.running)).toMatchObject({status:"failed",error_code:"RESTORE_INTERRUPTED"});
      expect(()=>restored.sqlite.prepare("UPDATE jobs SET kind='export' WHERE id=?").run(ids.jobPassed)).toThrow(/identity is immutable/);}finally{restored.close();}
    for(const [id,input] of [[ids.passed,S6_INPUTS.passed],[ids.late,S6_INPUTS.late]] as const)expect(await fileDigest(join(destination,"storage",...s6RenderPath(project,id).split("/")))).toEqual(await fileDigest(input));
    expect(await fileDigest(zip)).toEqual(record().zip);
  },120000);
  it("s6 올려서 복원(upgrade 6→7)과 s5 올려서 복원(5→7): staging에서 올린 직후 구조 = s7, 원본 ZIP 그대로",async()=>{
    for(const [zipFile,name,from,rows] of [[S6_ZIP,"s6.zip",6,5],[S5_ZIP,"s5.zip",5,0]] as const){
      const zip=await copied(zipFile,name),manifest=await source(s7Migrations(),zip),destination=join(root,`restored-${from}`);let schema="",count=-1;
      const options:RestoreOptions={onStage:async(stage:RestoreStage,staging:string)=>{if(stage==="upgraded"){const sqlite=new Database(join(staging,"data/app.db"),{readonly:true,fileMustExist:true});try{schema=schemaHash(sqlite);count=renderRows(sqlite).length;}finally{sqlite.close();}}}};
      const svc=restoreService(handle!,now,{...options,migrations:s7Migrations()}),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"upgrade",fromVersion:from,toVersion:7});await svc.finish(checked.ticketId);
      expect(schema).toBe(record().schema);expect(count).toBe(rows);expect(await fileDigest(zip)).toEqual(await fileDigest(zipFile));
      handle?.close();handle=undefined;await rm(join(root,"source"),{recursive:true,force:true});
    }
  },180000);
  it("F107-1/2/3: 해시·manifest까지 맞춘 위조 s7은 실제 inspect·finish에서 RESTORE_INVALID, 목적지 없음, ZIP 그대로",async()=>{
    await refused(await forged(S7_ZIP,"timeline-999",falseBinding),"RESTORE_INVALID",s7Migrations());
    await refused(await forged(S7_ZIP,"job-kind",sqlite=>{sqlite.prepare("UPDATE jobs SET kind='export' WHERE id=?").run(ids.jobPassed);}),"RESTORE_INVALID",s7Migrations());
    await refused(await forged(S7_ZIP,"job-project",sqlite=>{sqlite.prepare("UPDATE jobs SET project_id=? WHERE id=?").run(s4Ids().draft,ids.jobLate);}),"RESTORE_INVALID",s7Migrations());
    await refused(await forged(S7_ZIP,"null-sha",sqlite=>{sqlite.prepare("UPDATE renders SET sha256=NULL WHERE id=?").run(ids.passed);}),"RESTORE_INVALID",s7Migrations());
  },240000);
  it("같은 위조 s6: 6단계 앱(same)은 RESTORE_INVALID, 7단계 앱(올려서)은 0007 행 검사에서 BACKUP_UPGRADE_FAILED",async()=>{
    const zip=await forged(S6_ZIP,"s6-timeline-999",falseBinding);
    await refused(zip,"RESTORE_INVALID",s6Migrations());
    await refused(zip,"BACKUP_UPGRADE_FAILED",s7Migrations());
  },180000);
  it("6단계 앱은 s7을 BACKUP_TOO_NEW로, 0007 원문이 다른 앱은 BACKUP_SCHEMA_MISMATCH로 거부한다",async()=>{
    await refused(await copied(S7_ZIP,"s7-old.zip"),"BACKUP_TOO_NEW",s6Migrations());
    const seven=s7Migrations()[6],changed=[...s6Migrations(),{...migrationEntry(7,seven.name,`${seven.sql}\n-- changed\n`),verify:seven.verify}];expect(changed[6].sha256).not.toBe(seven.sha256);
    await refused(await copied(S7_ZIP,"s7-changed.zip"),"BACKUP_SCHEMA_MISMATCH",changed);
  },120000);
});
