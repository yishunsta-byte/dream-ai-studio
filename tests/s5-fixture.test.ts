// Fixed virtual backup s5 (T-061): s4 + product code step 0005. Generated once with S5_WRITE=1 (refuses to overwrite).
// Checks: kept bytes and record, regeneration, s4 → upgrade equals s5, direct restore is "same", a changed 0005 source
// is a schema mismatch, and an upgrade restore of s4 equals s5 right after the staging upgrade.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { codeMigration, codeMigrationSha256 } from "@/lib/db/code-migration";
import { migrateDatabase, PRODUCT_CODE_STEPS, productMigrations, productSqlMigrations, type Migration } from "@/lib/db/migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { fileDigest } from "@/lib/export/zip";
import { restoreService, type RestoreOptions, type RestoreStage } from "@/lib/services/restore";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { logicalHash, P_REGEN, schemaHash, snapshotDb, type DbSnap } from "./fixtures/backups/s4-compare";
import { assembleS5Zip, buildS5Runtime, s5Migrations, S5_GENERATOR_VERSION, S5_RECORD, S5_ZIP } from "./fixtures/backups/s5-build";

type S5Record={fixture:"s5";generatorVersion:number;zip:{sha256:string;sizeBytes:number};backupId:string;migrations:{version:number;name:string;sha256:string}[];logical:{profile:"P_REGEN";all:string;tables:Record<string,string>};schema:string;timeline:{id:string;sha256:string}[]};
const plain=(list:readonly Migration[])=>list.map(({version,name,sha256})=>({version,name,sha256}));
let root:string,handle:DatabaseHandle|undefined,committed:{s4:{sha256:string;sizeBytes:number};s5:{sha256:string;sizeBytes:number}|null};
const now=()=>Date.parse("2026-11-16T10:00:00Z");
beforeAll(async()=>{committed={s4:await fileDigest(S4_ZIP),s5:existsSync(S5_ZIP)?await fileDigest(S5_ZIP):null};});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed.s4);if(committed.s5)expect(await fileDigest(S5_ZIP)).toEqual(committed.s5);});
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-s5-")));});
afterEach(async()=>{vi.unstubAllEnvs();handle?.close();handle=undefined;if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

async function extract(zip:string,into:string){const manifest=await readBackupManifest(zip);await verifyBackupArchive(zip,manifest,into);return {manifest,db:join(into,"data/app.db")};}
function describeDb(path:string){const sqlite=new Database(path,{readonly:true,fileMustExist:true});try{const snap=snapshotDb(sqlite);return {snap,logical:logicalHash(snap,P_REGEN),schema:schemaHash(sqlite),timeline:sqlite.prepare("SELECT id,timeline_sha256 AS sha256 FROM timeline_revisions ORDER BY id").all() as {id:string;sha256:string}[]};}finally{sqlite.close();}}
async function generate(into:string){const runtime=join(into,"runtime");await buildS5Runtime(runtime);const out=join(into,"s5.zip");const manifest=await assembleS5Zip(runtime,join(into,"work"),out);return {out,manifest};}
// A source instance on the given list, with the backup registered like a verified backup row.
async function source(migrations:readonly Migration[],zip:string){const runtime=join(root,"source");for(const path of ["data","storage","backups"])mkdirSync(join(runtime,path),{recursive:true});vi.stubEnv("DREAM_DATA_ROOT",runtime);handle=openDatabase(join(runtime,"data/app.db"));migrateDatabase(handle.sqlite,{migrations,now});
  const manifest=await readBackupManifest(zip),digest=await fileDigest(zip);handle.sqlite.prepare("INSERT INTO backups(id,kind,path,db_sha256,file_inventory_sha256,status,created_at) VALUES(?,?,?,?,?,?,?)").run(manifest.backupId,"manual",zip,manifest.database.sha256,manifest.inventorySha256,"succeeded",manifest.createdAt);
  handle.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`backup.${manifest.backupId}.meta`,JSON.stringify({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:new Date(now()).toISOString()}));return manifest;}
async function copied(zip:string,name:string){const to=join(root,"archive",name);mkdirSync(dirname(to),{recursive:true});cpSync(zip,to);return to;}

describe.runIf(process.env.S5_WRITE==="1")("s5 생성 (한 번만)",()=>{
  it("s5.zip과 기록 파일을 새로 만든다 (있으면 거부)",async()=>{
    if(existsSync(S5_ZIP)||existsSync(S5_RECORD))throw new Error("s5가 이미 있어요. 고정 백업은 덮어쓰지 않아요.");
    const {out,manifest}=await generate(root),described=describeDb((await extract(out,join(root,"check"))).db);
    writeFileSync(S5_ZIP,readFileSync(out),{flag:"wx"});
    const record:S5Record={fixture:"s5",generatorVersion:S5_GENERATOR_VERSION,zip:await fileDigest(S5_ZIP),backupId:manifest.backupId,migrations:manifest.migrations,logical:{profile:"P_REGEN",...described.logical},schema:described.schema,timeline:described.timeline};
    writeFileSync(S5_RECORD,`${JSON.stringify(record,null,2)}\n`,{flag:"wx"});
  },60000);
});

describe.skipIf(process.env.S5_WRITE==="1")("고정 백업 s5",()=>{
  const record=()=>JSON.parse(readFileSync(S5_RECORD,"utf8")) as S5Record;
  it("보관 원본: ZIP 해시·마이그레이션 5줄(0005 코드 해시)·논리 내용·스키마가 기록과 같고, 다시 만들어도 같다",async()=>{
    const expected=record();expect(await fileDigest(S5_ZIP)).toEqual(expected.zip);
    const {manifest,db}=await extract(S5_ZIP,join(root,"a1"));expect(manifest.migrations).toEqual(plain(s5Migrations()));expect(plain(productMigrations()).slice(0,5)).toEqual(manifest.migrations);expect(manifest.migrations[4]).toEqual({version:5,name:"0005_timeline_revisions.cjs",sha256:PRODUCT_CODE_STEPS[0].sha256});
    const described=describeDb(db);expect(described.logical).toEqual({all:expected.logical.all,tables:expected.logical.tables});expect(described.schema).toBe(expected.schema);expect(described.timeline).toEqual(expected.timeline);expect(described.timeline).toHaveLength(1);
    const regen=describeDb((await extract((await generate(join(root,"regen"))).out,join(root,"regen-x"))).db);expect(regen.logical).toEqual(described.logical);expect(regen.schema).toBe(described.schema);
  },60000);
  it("s4를 제품 목록 앞 5단계로 직접 올린 결과 = s5 (적용 시각 칸만 제외)",async()=>{
    const {db}=await extract(S4_ZIP,join(root,"s4"));const sqlite=new Database(db);try{sqlite.pragma("foreign_keys = ON");migrateDatabase(sqlite,{migrations:s5Migrations(),now});}finally{sqlite.close();}
    const expected=record();expect(describeDb(db)).toMatchObject({logical:{all:expected.logical.all},schema:expected.schema,timeline:expected.timeline});
  });
  it("s5 직접 복원(5단계 앱)은 같은 버전(same)이고 타임라인 행이 그대로다",async()=>{
    const zip=await copied(S5_ZIP,"s5.zip"),manifest=await source(s5Migrations(),zip),destination=join(root,"restored");
    const svc=restoreService(handle!,now,{migrations:s5Migrations()}),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"same",fromVersion:5,toVersion:5});
    await svc.finish(checked.ticketId);expect(describeDb(join(destination,"data/app.db")).timeline).toEqual(record().timeline);expect(await fileDigest(zip)).toEqual(record().zip);
  },60000);
  it("0005 원문이 바뀐 앱은 s5를 BACKUP_SCHEMA_MISMATCH로 거부한다(staging·목적지 없음)",async()=>{
    const step=PRODUCT_CODE_STEPS[0],base=join(root,"changed-app");for(const path of step.files){const to=join(base,...path.split("/"));mkdirSync(dirname(to),{recursive:true});writeFileSync(to,readFileSync(join(process.cwd(),...path.split("/")),"utf8").replace("Product step 0005","Product step 0005 (changed)"));}
    const files=[...step.files],changed=codeMigration({version:5,name:step.name,files,sha256:codeMigrationSha256(files.map(path=>({path,text:readFileSync(join(base,...path.split("/")),"utf8")}))),root:base});expect(changed.sha256).not.toBe(step.sha256);
    const list=[...productSqlMigrations(),changed],zip=await copied(S5_ZIP,"s5.zip"),manifest=await source(list,zip),destination=join(root,"restored");
    await expect(restoreService(handle!,now,{migrations:list}).inspect({backupId:manifest.backupId,destination})).rejects.toMatchObject({code:"BACKUP_SCHEMA_MISMATCH"});expect(existsSync(destination)).toBe(false);
  },60000);
  it("s4 올려서 복원: staging에서 올린 직후 DB = s5, 원본 s4 ZIP 그대로",async()=>{
    const zip=await copied(S4_ZIP,"s4.zip"),manifest=await source(s5Migrations(),zip),destination=join(root,"restored"),upgraded:DbSnap[]=[];
    const options:RestoreOptions={migrations:s5Migrations(),onStage:async(stage:RestoreStage,staging:string)=>{if(stage==="upgraded"){const sqlite=new Database(join(staging,"data/app.db"),{readonly:true,fileMustExist:true});try{upgraded.push(snapshotDb(sqlite));}finally{sqlite.close();}}}};
    const svc=restoreService(handle!,now,options),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"upgrade",fromVersion:4,toVersion:5});await svc.finish(checked.ticketId);
    expect(upgraded).toHaveLength(1);expect(logicalHash(upgraded[0],P_REGEN).all).toBe(record().logical.all);
    const restored=describeDb(join(destination,"data/app.db"));expect(restored.timeline).toEqual(record().timeline);expect(restored.snap.get("projects")!.rows.size).toBe(3);
    expect(await fileDigest(zip)).toEqual(committed.s4);expect(realpathSync(root)).toBeTruthy();expect(s4Ids().main).toBeTruthy();
  },60000);
});
