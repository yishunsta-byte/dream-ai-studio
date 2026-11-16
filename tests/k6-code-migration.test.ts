// T-048: the code data migration contract (K-6 ⑤ / T-017 3.4) proven with a test-only step 5; no product 0005.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { checkCodeStepSource, codeMigration, codeMigrationSha256, CODE_MIGRATION_FORMAT, isCertifiedCodeMigration, MigrationSourceError } from "@/lib/db/code-migration";
import { journal, migrateDatabase, migrationEntry, productMigrations, type Migration } from "@/lib/db/migrate";
import { migrateLiveDatabase } from "@/lib/db/live-migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import type { BackupManifest } from "@/lib/backup/schema";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { restoreService, type RestoreOptions, type RestoreStage } from "@/lib/services/restore";
import { S4_ZIP } from "./fixtures/backups/s4-build";
import { P_JOURNAL_AFTER_4, snapshotDb } from "./fixtures/backups/s4-compare";
import * as step from "./fixtures/migrations/test5-code";
import { TEST5_CODE_FILES, TEST5_CODE_SHA256, test5Code } from "./fixtures/migrations/test5-registry";

let root:string,time:number,committed:{sha256:string;sizeBytes:number},handle:DatabaseHandle|undefined;
const now=()=>time;
beforeEach(async()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t048-")));time=Date.parse("2026-11-16T07:00:00Z");committed=await fileDigest(S4_ZIP);});
afterEach(async()=>{vi.unstubAllEnvs();handle?.close();handle=undefined;expect(await fileDigest(S4_ZIP)).toEqual(committed);if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});

const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const CODE_LIST=()=>[...productMigrations(),test5Code()];
async function s4(name:string){const into=join(root,name);const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,into);return join(into,"data/app.db");}
const snap=(file:string)=>{const sqlite=new Database(file,{readonly:true,fileMustExist:true});try{return snapshotDb(sqlite);}finally{sqlite.close();}};
const without=(snapshot:ReturnType<typeof snapshotDb>,...names:string[])=>{const copy=new Map(snapshot);for(const name of names)copy.delete(name);return copy;};
function migrateFile(file:string,migrations:readonly Migration[]){const sqlite=new Database(file);try{sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");return migrateDatabase(sqlite,{migrations,now});}finally{sqlite.close();}}
// A copy of the step's files under another root, to change them without touching the repository.
function copySources(target:string){for(const path of TEST5_CODE_FILES){const to=join(target,...path.split("/"));mkdirSync(dirname(to),{recursive:true});cpSync(join(process.cwd(),...path.split("/")),to);}}

describe("계약: 원문 해시와 SQL 단계 호환",()=>{
  it("SQL 단계 해시는 그대로(파일 원문 sha256, 고정 백업 s4 기록과 같음)",async()=>{
    const product=productMigrations();
    for(const migration of product){expect(migration.kind).toBeUndefined();expect(migration.run).toBeUndefined();expect(migration.sha256).toBe(sha(readFileSync(join(process.cwd(),"lib/db/migrations",migration.name),"utf8").replace(/\r\n/g,"\n")));}
    expect((await readBackupManifest(S4_ZIP)).migrations).toEqual(product.map(({version,name,sha256})=>({version,name,sha256})));
    expect(migrationEntry(1,product[0].name,product[0].sql).sha256).toBe(product[0].sha256);
  });
  it("코드 단계 해시는 형식·SQL·파일 경로·내용에 묶이고 줄바꿈만 다르면 같다",()=>{
    const migration=test5Code(),files=TEST5_CODE_FILES.map(path=>({path,text:readFileSync(join(process.cwd(),...path.split("/")),"utf8")}));
    expect(migration).toMatchObject({version:5,name:"0005_test_only_code.ts",kind:"code",sha256:TEST5_CODE_SHA256,sources:[...TEST5_CODE_FILES]});
    expect(Object.isFrozen(migration)).toBe(true);expect(isCertifiedCodeMigration(migration)).toBe(true);expect(migration.run).toBe(step.run);
    const base=codeMigrationSha256({sql:step.sql,files});expect(base).toBe(TEST5_CODE_SHA256);
    expect(codeMigrationSha256({sql:step.sql,files:files.map(file=>({...file,text:file.text.replace(/\n/g,"\r\n")}))})).toBe(base);
    expect(codeMigrationSha256({sql:step.sql,files:[...files].reverse()})).toBe(base);
    expect(codeMigrationSha256({sql:`${step.sql} `,files})).not.toBe(base);
    expect(codeMigrationSha256({sql:step.sql,files:files.map((file,index)=>index?{...file,text:`${file.text}\n`}:file)})).not.toBe(base);
    expect(codeMigrationSha256({sql:step.sql,files:files.map((file,index)=>index?{...file,path:"tests/fixtures/migrations/ids.ts"}:file)})).not.toBe(base);
    expect(CODE_MIGRATION_FORMAT).toBe("dream-code-migration/v1");
  });
  it("원문이 선언 해시와 다르면(도우미 한 글자, 실행 모듈 변경) 목록을 만들지 않는다",()=>{
    const other=join(root,"src");copySources(other);expect(test5Code({root:other}).sha256).toBe(TEST5_CODE_SHA256);
    const helper=join(other,"tests/fixtures/migrations/test5-ids.ts");writeFileSync(helper,readFileSync(helper,"utf8").replace("test5:","test6:"));
    expect(()=>test5Code({root:other})).toThrow(MigrationSourceError);
    copySources(other);const entry=join(other,"tests/fixtures/migrations/test5-code.ts");writeFileSync(entry,readFileSync(entry,"utf8").replace('"p1-migration"','"p1-moved"'));
    expect(()=>test5Code({root:other})).toThrow(/원문 해시/);
    rmSync(entry);expect(()=>test5Code({root:other})).toThrow(/파일을 읽지 못했어요/);
  });
  it("목록·모듈 모양이 다르면 거부(첫 파일≠실행 모듈, 중복, 절대·상위 경로, run 없음, 빈 목록)",()=>{
    const base={version:5,name:"x",module:step,files:TEST5_CODE_FILES,sql:step.sql,sha256:TEST5_CODE_SHA256};
    for(const change of [{files:[...TEST5_CODE_FILES].reverse()},{files:[TEST5_CODE_FILES[0],TEST5_CODE_FILES[0]]},{files:["D:/abs/test5-code.ts"]},{files:["tests/../tests/fixtures/migrations/test5-code.ts"]},{files:[]},{module:{entry:step.entry,run:undefined as never}},{module:{entry:"tests/other.ts",run:step.run}}])
      expect(()=>codeMigration({...base,...change})).toThrow(MigrationSourceError);
  });
  it("숨은 의존·비결정 요소를 거부한다",()=>{
    const listed=new Set(["lib/a.ts","lib/b.ts"]);
    expect(()=>checkCodeStepSource("lib/a.ts",'import { x } from "./b";\nimport type Database from "better-sqlite3";\nimport { createHash } from "node:crypto";\nexport type { Y } from "zod";',listed)).not.toThrow();
    for(const text of ['import { x } from "./c";','import { x } from "@/lib/c";','import { z } from "zod";','import fs from "node:fs";','export { x } from "../lib/c";','import "./side-effect";','const m=require("./b");','const m=await import("./b");','const t=Date.now();','const t=new Date();','const r=Math.random();','import { randomUUID } from "node:crypto"; randomUUID();','const k=process.env.KEY;','globalThis.x=1;','eval("1");','new Function("return 1");','const u=import.meta.url;',`sqlite.exec("UPDATE t SET at=datetime('now')");`,'sqlite.exec("INSERT INTO t VALUES (CURRENT_TIMESTAMP)");','sqlite.exec("SELECT random()");','sqlite.exec("SELECT randomblob(16)");'])
      expect(()=>checkCodeStepSource("lib/a.ts",text,listed),text).toThrow(MigrationSourceError);
  });
  it("목록 파일·SQL에 숨은 비결정 요소가 있으면 해시가 맞아도 만들지 않는다",()=>{
    const other=join(root,"nd");copySources(other);const helper=join(other,"tests/fixtures/migrations/test5-ids.ts");writeFileSync(helper,`${readFileSync(helper,"utf8")}\nexport const stamp=()=>Date.now();\n`);
    const texts=()=>TEST5_CODE_FILES.map(path=>({path,text:readFileSync(join(other,...path.split("/")),"utf8")}));
    expect(()=>test5Code({root:other,sha256:codeMigrationSha256({sql:step.sql,files:texts()})})).toThrow(/clock/);
    copySources(other);const sql=`${step.sql}\nINSERT INTO test_k6_timeline SELECT 'x','p',1,1,'{}','s',datetime('now') WHERE 0;`;
    expect(()=>codeMigration({version:5,name:"x",module:step,files:TEST5_CODE_FILES,sql,sha256:codeMigrationSha256({sql,files:texts()}),root:other})).toThrow(/SQL clock/);
  });
  it("codeMigration이 만들지 않은 실행 코드는 어떤 단계도 적용하기 전에 거부한다",async()=>{
    const file=await s4("forged"),before=snap(file);
    const forged:Migration[]=[{...test5Code()},{...migrationEntry(5,"0005_test_only_code.ts",step.sql),run:step.run},{...migrationEntry(5,"0005_x.sql",step.sql),kind:"code"}];
    for(const five of forged)expect(()=>migrateFile(file,[...productMigrations(),five])).toThrow(MigrationSourceError);
    expect(snap(file)).toEqual(before);
  });
});

describe("실행: 같은 트랜잭션·결정적·옛 행 보존·실패 시 전부 되돌림",()=>{
  it("같은 입력 두 번이면 같은 결과, 옛 행은 그대로, 새 표만 생긴다",async()=>{
    const one=await s4("one"),two=await s4("two"),before=snap(one);
    expect(migrateFile(one,CODE_LIST())).toBe(1);time+=3600000;expect(migrateFile(two,CODE_LIST())).toBe(1);
    const a=snap(one),b=snap(two);
    expect(without(a,"__schema_migrations")).toEqual(without(b,"__schema_migrations"));
    expect(without(a,"__schema_migrations","test_k6_timeline")).toEqual(without(before,"__schema_migrations"));
    const sqlite=new Database(one,{readonly:true});
    try{
      expect(journal(sqlite)?.at(-1)).toEqual({version:5,name:"0005_test_only_code.ts",sha256:TEST5_CODE_SHA256});
      const rows=sqlite.prepare("SELECT id,project_id,revision,source,created_at FROM test_k6_timeline ORDER BY id").all() as {id:string;source:string}[];
      const snapshots=(sqlite.prepare("SELECT COUNT(*) n FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").get() as {n:number}).n;
      expect(rows).toHaveLength(snapshots);expect(rows.length).toBeGreaterThan(0);expect(new Set(rows.map(row=>row.source))).toEqual(new Set(["p1-migration"]));
      for(const row of rows)expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }finally{sqlite.close();}
  });
  it("변환 중 실패·데이터 검사 실패는 SQL 단계까지 전부 되돌린다",async()=>{
    const file=await s4("broken"),raw=new Database(file);try{raw.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`project.${"0".repeat(8)}-0000-7000-8000-${"0".repeat(12)}.edit.zz`,"{\"content_revision\":1,\"created_at\":\"2026-01-01T00:00:00.000Z\"}");}finally{raw.close();}
    const before=snap(file);expect(()=>migrateFile(file,CODE_LIST())).toThrow(TypeError);expect(snap(file)).toEqual(before);
    const clean=await s4("verify"),cleanBefore=snap(clean);
    expect(()=>migrateFile(clean,[...productMigrations(),test5Code({verify:()=>{throw new Error("injected");}})])).toThrow("injected");expect(snap(clean)).toEqual(cleanBefore);
  });
  it("지금 DB 올리기: 바꾸기 전 사본을 남기고 같은 결과, 실패하면 DB 그대로·사본 남음",async()=>{
    const direct=await s4("direct");migrateFile(direct,CODE_LIST());
    const file=await s4("live"),before=snap(file),handle=openDatabase(file,{fileMustExist:true},{wal:false});
    try{
      const result=migrateLiveDatabase(handle,{snapshotDirectory:join(root,"pre"),migrations:CODE_LIST(),now});expect(result).toMatchObject({applied:1,from:4,to:5});
      expect(snap(result.snapshot!)).toEqual(before);
    }finally{handle.close();}
    const strip=(value:ReturnType<typeof snapshotDb>)=>without(without(value,"__schema_migrations"),"activity_log");
    expect(strip(snap(file))).toEqual(strip(snap(direct)));
    const failing=await s4("live-fail"),failingBefore=snap(failing),other=openDatabase(failing,{fileMustExist:true},{wal:false});
    try{expect(()=>migrateLiveDatabase(other,{snapshotDirectory:join(root,"pre-fail"),migrations:[...productMigrations(),test5Code({verify:()=>{throw new Error("injected");}})],now})).toThrow(expect.objectContaining({code:"MIGRATION_FAILED"}));}finally{other.close();}
    expect(snap(failing)).toEqual(failingBefore);expect(readdirSync(join(root,"pre-fail"))).toHaveLength(1);expect(existsSync(join(root,"pre"))).toBe(true);
  });
});

// A changed step 5 whose source really differs (helper text) and whose declaration matches that source.
function changedStep(){
  const other=join(root,"changed-src");copySources(other);const helper=join(other,"tests/fixtures/migrations/test5-ids.ts");writeFileSync(helper,readFileSync(helper,"utf8").replace("test5:","test5b:"));
  const sha256=codeMigrationSha256({sql:step.sql,files:TEST5_CODE_FILES.map(path=>({path,text:readFileSync(join(other,...path.split("/")),"utf8")}))});
  expect(sha256).not.toBe(TEST5_CODE_SHA256);return test5Code({root:other,sha256});
}

describe("기록 일치: DB·백업 기록 해시와 지금 코드 원문",()=>{
  it("지금 DB 기록의 코드 해시가 지금 원문과 다르면 아무 단계도 적용하지 않고 거부",async()=>{
    const file=await s4("recorded");migrateFile(file,CODE_LIST());const before=snap(file);
    expect(()=>migrateFile(file,[...productMigrations(),changedStep()])).toThrow();expect(snap(file)).toEqual(before);
    expect(migrateFile(file,CODE_LIST())).toBe(0);expect(snap(file)).toEqual(before);
  });
});

describe("백업 복원: staging에서 코드 단계로 올리기와 기록 불일치 거부",()=>{
  const stamp=()=>new Date(time).toISOString();
  async function source(migrations:readonly Migration[],name="source"){handle?.close();handle=undefined;const runtime=join(root,name);for(const path of ["data","storage","backups"])mkdirSync(join(runtime,path),{recursive:true});vi.stubEnv("DREAM_DATA_ROOT",runtime);handle=openDatabase(join(runtime,"data/app.db"));migrateDatabase(handle.sqlite,{migrations,now});}
  async function register(zip:string,manifest:BackupManifest){const digest=await fileDigest(zip);handle!.sqlite.prepare("INSERT INTO backups(id,kind,path,db_sha256,file_inventory_sha256,status,created_at) VALUES(?,?,?,?,?,?,?)").run(manifest.backupId,"manual",zip,manifest.database.sha256,manifest.inventorySha256,"succeeded",manifest.createdAt);handle!.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`backup.${manifest.backupId}.meta`,JSON.stringify({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:stamp()}));}
  async function archived(){const zip=join(root,"archive","s4.zip");mkdirSync(dirname(zip),{recursive:true});cpSync(S4_ZIP,zip);const manifest=await readBackupManifest(zip);await register(zip,manifest);return {zip,manifest};}
  // s4 already upgraded with the test code step, rebuilt as a ZIP whose manifest carries the code step's record.
  async function upgradedBackup(){const folder=join(root,"v5");const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,folder);const db=join(folder,"data/app.db");migrateFile(db,CODE_LIST());const raw=new Database(db);try{raw.pragma("journal_mode = DELETE");}finally{raw.close();}
    const final={...manifest,database:{path:"data/app.db",...await fileDigest(db)},migrations:CODE_LIST().map(({version,name,sha256})=>({version,name,sha256}))} as BackupManifest;
    const zip=join(root,"archive","v5.zip");mkdirSync(dirname(zip),{recursive:true});await writeArchive(zip,[{path:"data/app.db",filename:db},...manifest.files.map(file=>({path:file.path,filename:join(folder,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(final))}]);await register(zip,final);return {zip,manifest:final};}
  const service=(options?:RestoreOptions)=>restoreService(handle!,now,options);
  const strip=(snapshot:ReturnType<typeof snapshotDb>)=>{const copy:Record<string,unknown>={};for(const [name,table] of snapshot)copy[name]=[...table.rows].map(([key,row])=>[key,Object.fromEntries(table.columns.map(column=>[column,P_JOURNAL_AFTER_4(name,column,row)?"<x>":row[column]]))]);return copy;};

  it("올려서 복원: staging에서 올린 결과 = 직접 migrate 결과, 원본 ZIP 해시 그대로",async()=>{
    const list=CODE_LIST();await source(list);const {zip,manifest}=await archived();const before=await fileDigest(zip),upgraded:ReturnType<typeof snapshotDb>[]=[];
    const svc=service({migrations:list,onStage:async(stage:RestoreStage,staging:string)=>{if(stage==="upgraded")upgraded.push(snap(join(staging,"data/app.db")));}});
    const destination=join(root,"restored"),checked=await svc.inspect({backupId:manifest.backupId,destination});expect(checked).toMatchObject({compat:"upgrade",fromVersion:4,toVersion:5});
    await svc.finish(checked.ticketId);expect(upgraded).toHaveLength(1);
    const direct=await s4("direct");migrateFile(direct,list);expect(strip(upgraded[0])).toEqual(strip(snap(direct)));
    const restored=new Database(join(destination,"data/app.db"),{readonly:true});try{expect(journal(restored)?.at(-1)).toEqual({version:5,name:"0005_test_only_code.ts",sha256:TEST5_CODE_SHA256});expect((restored.prepare("SELECT COUNT(*) n FROM test_k6_timeline").get() as {n:number}).n).toBeGreaterThan(0);}finally{restored.close();}
    expect(await fileDigest(zip)).toEqual(before);
  },60000);
  it("코드 단계로 만든 백업: 같은 원문이면 같은 버전, 원문이 바뀌면 BACKUP_SCHEMA_MISMATCH, 코드 단계가 없으면 BACKUP_TOO_NEW",async()=>{
    // Each case runs in an app whose own DB was prepared with that case's list (the service refuses otherwise).
    const list=CODE_LIST();await source(list);const {zip,manifest}=await upgradedBackup();const before=await fileDigest(zip);
    expect(await service({migrations:list}).inspect({backupId:manifest.backupId,destination:join(root,"same")})).toMatchObject({compat:"same",fromVersion:5,toVersion:5});
    const changed=[...productMigrations(),changedStep()];await source(changed,"source-changed");await register(zip,manifest);
    await expect(service({migrations:changed}).inspect({backupId:manifest.backupId,destination:join(root,"changed")})).rejects.toMatchObject({code:"BACKUP_SCHEMA_MISMATCH"});
    await source(productMigrations(),"source-older");await register(zip,manifest);
    await expect(service({migrations:productMigrations()}).inspect({backupId:manifest.backupId,destination:join(root,"older")})).rejects.toMatchObject({code:"BACKUP_TOO_NEW"});
    expect(existsSync(join(root,"changed"))).toBe(false);expect(existsSync(join(root,"older"))).toBe(false);expect(await fileDigest(zip)).toEqual(before);
  },60000);
});
