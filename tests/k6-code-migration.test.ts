// T-048/T-051: the code data migration contract (K-6 ⑤ / T-017 3.4) proven with a test-only step 5; no product 0005.
// The executed `run`/`sql` are loaded from the very text whose hash matched the declaration (contract v2).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { checkSqlText, codeMigration, codeMigrationSha256, CODE_MIGRATION_FORMAT, isCertifiedCodeMigration, MigrationSourceError, type CodeStepDefinition } from "@/lib/db/code-migration";
import { journal, migrateDatabase, migrationEntry, productMigrations, type Migration } from "@/lib/db/migrate";
import { migrateLiveDatabase } from "@/lib/db/live-migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import type { BackupManifest } from "@/lib/backup/schema";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { restoreService, type RestoreOptions, type RestoreStage } from "@/lib/services/restore";
import { S4_ZIP } from "./fixtures/backups/s4-build";
import { P_JOURNAL_AFTER_4, snapshotDb } from "./fixtures/backups/s4-compare";
import { TEST5_CODE_FILES, TEST5_CODE_SHA256, test5Code } from "./fixtures/migrations/test5-registry";

let root:string,time:number,committed:{sha256:string;sizeBytes:number},handle:DatabaseHandle|undefined;
const now=()=>time;
beforeEach(async()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t051-")));time=Date.parse("2026-11-16T07:00:00Z");committed=await fileDigest(S4_ZIP);});
afterEach(async()=>{vi.unstubAllEnvs();handle?.close();handle=undefined;expect(await fileDigest(S4_ZIP)).toEqual(committed);if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});

const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const lf=(text:string)=>text.replace(/\r\n/g,"\n");
const CODE_LIST=()=>[...productMigrations(),test5Code()];
async function s4(name:string){const into=join(root,name);const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,into);return join(into,"data/app.db");}
const snap=(file:string)=>{const sqlite=new Database(file,{readonly:true,fileMustExist:true});try{return snapshotDb(sqlite);}finally{sqlite.close();}};
const without=(snapshot:ReturnType<typeof snapshotDb>,...names:string[])=>{const copy=new Map(snapshot);for(const name of names)copy.delete(name);return copy;};
function migrateFile(file:string,migrations:readonly Migration[]){const sqlite=new Database(file);try{sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");return migrateDatabase(sqlite,{migrations,now});}finally{sqlite.close();}}
const thrown=(fn:()=>unknown)=>{try{fn();}catch(error){return error as Error;}throw new Error("expected a throw");};
// A copy of the step's files under another root, to change them without touching the repository.
function copySources(target:string){for(const path of TEST5_CODE_FILES){const to=join(target,...path.split("/"));mkdirSync(dirname(to),{recursive:true});cpSync(join(process.cwd(),...path.split("/")),to);}}
const readAll=(base:string,files:readonly string[])=>files.map(path=>({path,text:readFileSync(join(base,...path.split("/")),"utf8")}));
// A probe step written under its own root, declared with the hash of exactly what was written.
function probe(name:string,files:Record<string,string>,extra:Partial<CodeStepDefinition>={}){
  const base=join(root,name);for(const [path,text] of Object.entries(files)){const to=join(base,...path.split("/"));mkdirSync(dirname(to),{recursive:true});writeFileSync(to,text);}
  const list=Object.keys(files);return ()=>codeMigration({version:5,name:"0005_probe.cjs",files:list,sha256:codeMigrationSha256(readAll(base,list)),root:base,...extra});
}
const PROOF="module.exports.sql='CREATE TABLE proof (value TEXT) STRICT;';\n";
const proofRows=(file:string)=>{const sqlite=new Database(file,{readonly:true});try{return sqlite.prepare("SELECT value FROM proof").all();}catch{return null;}finally{sqlite.close();}};

describe("계약: 원문 해시, 실행은 해시한 원문에서만",()=>{
  it("SQL 단계 해시는 그대로(파일 원문 sha256, 고정 백업 s4 기록과 같음)",async()=>{
    const product=productMigrations();
    for(const migration of product){expect(migration.kind).toBeUndefined();expect(migration.run).toBeUndefined();expect(migration.sha256).toBe(sha(lf(readFileSync(join(process.cwd(),"lib/db/migrations",migration.name),"utf8"))));}
    expect((await readBackupManifest(S4_ZIP)).migrations).toEqual(product.map(({version,name,sha256})=>({version,name,sha256})));
    expect(migrationEntry(1,product[0].name,product[0].sql).sha256).toBe(product[0].sha256);
  });
  it("v2 해시는 형식·실행 파일(entry)·경로·내용(LF)에 묶이고, 줄바꿈(LF/CRLF)이나 entry 뒤 도우미 순서만 다르면 같다",()=>{
    const files=readAll(process.cwd(),TEST5_CODE_FILES),normalized=files.map(file=>({...file,text:lf(file.text)}));
    expect(CODE_MIGRATION_FORMAT).toBe("dream-code-migration/v2");
    expect(codeMigrationSha256(files)).toBe(TEST5_CODE_SHA256);
    expect(codeMigrationSha256(normalized.map(file=>({...file,text:file.text.replace(/\n/g,"\r\n")})))).toBe(TEST5_CODE_SHA256);
    expect(codeMigrationSha256(normalized)).toBe(TEST5_CODE_SHA256);expect(codeMigrationSha256([...files].reverse())).not.toBe(TEST5_CODE_SHA256);
    const helpers=[{path:"p/a.cjs",text:"a"},{path:"p/b.cjs",text:"b"}],entry={path:"p/entry.cjs",text:"e"};
    expect(codeMigrationSha256([entry,...helpers])).toBe(codeMigrationSha256([entry,...[...helpers].reverse()]));expect(codeMigrationSha256([helpers[0],entry,helpers[1]])).not.toBe(codeMigrationSha256([entry,...helpers]));
    expect(codeMigrationSha256(normalized.map(file=>({...file,text:`${file.text}\n`})))).not.toBe(TEST5_CODE_SHA256);
    expect(codeMigrationSha256(normalized.map((file,index)=>index?{...file,path:"tests/fixtures/migrations/ids.cjs"}:file))).not.toBe(TEST5_CODE_SHA256);
    // A checkout with CRLF (core.autocrlf) and one with LF both register with the same declaration.
    for(const eol of ["\r\n","\n"]){const other=join(root,`eol-${eol.length}`);copySources(other);for(const path of TEST5_CODE_FILES){const full=join(other,path);writeFileSync(full,lf(readFileSync(full,"utf8")).replace(/\n/g,eol));}expect(test5Code({root:other}).sha256).toBe(TEST5_CODE_SHA256);}
    // Independent vector: the hash input written out by hand.
    const vector=sha(["dream-code-migration/v2",`entry\0${TEST5_CODE_FILES[0]}`,...[...normalized].sort((a,b)=>a.path<b.path?-1:1).map(file=>`file\0${file.path}\0${sha(file.text)}`)].join("\n"));
    expect(vector).toBe(TEST5_CODE_SHA256);
  });
  it("정상 등록: run·sql은 원문에서 읽혀 실제로 실행된다",async()=>{
    const migration=test5Code(),entry=lf(readFileSync(join(process.cwd(),TEST5_CODE_FILES[0]),"utf8"));
    expect(migration).toMatchObject({version:5,name:"0005_test_only_code.cjs",kind:"code",sha256:TEST5_CODE_SHA256,sources:[...TEST5_CODE_FILES]});
    expect(Object.isFrozen(migration)).toBe(true);expect(isCertifiedCodeMigration(migration)).toBe(true);
    expect(entry).toContain(JSON.stringify(migration.sql));
    // A copy whose entry really changes: its new text is what runs (rows carry the new source label).
    const other=join(root,"edited");copySources(other);const path=join(other,TEST5_CODE_FILES[0]);writeFileSync(path,readFileSync(path,"utf8").replace('"p1-migration"','"p1-edited"'));
    const edited=test5Code({root:other,sha256:codeMigrationSha256(readAll(other,TEST5_CODE_FILES))});expect(edited.sha256).not.toBe(TEST5_CODE_SHA256);
    const file=await s4("edited-run");migrateFile(file,[...productMigrations(),edited]);
    const sqlite=new Database(file,{readonly:true});try{expect(sqlite.prepare("SELECT DISTINCT source FROM test_k6_timeline").all()).toEqual([{source:"p1-edited"}]);}finally{sqlite.close();}
  });
  it("실행 파일 식별: 같은 두 원문을 [A,B]/[B,A]로 주면 해시가 다르고, A 선언으로 B를 실행할 수 없다",async()=>{
    const files={"p/a.cjs":`${PROOF}module.exports.run=function(db){db.exec("INSERT INTO proof VALUES ('1')");};`,"p/b.cjs":`${PROOF}module.exports.run=function(db){db.exec("INSERT INTO proof VALUES ('2')");};`};
    const base=join(root,"entries");for(const [path,text] of Object.entries(files)){const to=join(base,path);mkdirSync(dirname(to),{recursive:true});writeFileSync(to,text);}
    const ab=["p/a.cjs","p/b.cjs"],ba=["p/b.cjs","p/a.cjs"],hashAB=codeMigrationSha256(readAll(base,ab)),hashBA=codeMigrationSha256(readAll(base,ba));expect(hashAB).not.toBe(hashBA);
    const define=(list:string[],sha256:string)=>codeMigration({version:5,name:"0005_probe.cjs",files:list,sha256,root:base});
    expect(()=>define(ba,hashAB)).toThrow(/원문 해시/);expect(()=>define(ab,hashBA)).toThrow(/원문 해시/);
    const results:unknown[]=[];for(const [list,sha256] of [[ab,hashAB],[ba,hashBA]] as const){const file=await s4(`entry-${list[0].slice(2,3)}`);migrateFile(file,[...productMigrations(),define([...list],sha256)]);results.push({journal:(()=>{const d=new Database(file,{readonly:true});try{return journal(d)?.at(-1);}finally{d.close();}})(),rows:proofRows(file)});}
    expect(results).toEqual([{journal:{version:5,name:"0005_probe.cjs",sha256:hashAB},rows:[{value:"1"}]},{journal:{version:5,name:"0005_probe.cjs",sha256:hashBA},rows:[{value:"2"}]}]);
  });
  it("F050-1: 실행 함수·모듈을 넘길 수 없다(module·run·sql·entry 항목 거부)",()=>{
    const base={version:5,name:"x",files:TEST5_CODE_FILES,sha256:TEST5_CODE_SHA256};
    for(const extra of [{module:{entry:TEST5_CODE_FILES[0],run:()=>{}}},{run:()=>{}},{sql:"CREATE TABLE x(a)"},{entry:TEST5_CODE_FILES[0]}])
      expect(()=>codeMigration({...base,...extra} as CodeStepDefinition)).toThrow(/알 수 없는 항목/);
  });
  it("선언 해시와 다르면 원문을 한 줄도 실행하지 않고 거부(도우미 한 글자, 실행 모듈 변경, 파일 없음)",()=>{
    const other=join(root,"src");copySources(other);expect(test5Code({root:other}).sha256).toBe(TEST5_CODE_SHA256);
    const helper=join(other,TEST5_CODE_FILES[1]);writeFileSync(helper,readFileSync(helper,"utf8").replace("test5:","test6:"));
    expect(()=>test5Code({root:other})).toThrow(/원문 해시/);
    copySources(other);const entry=join(other,TEST5_CODE_FILES[0]);writeFileSync(entry,`throw new Error("EXECUTED");\n${readFileSync(entry,"utf8")}`);
    expect(thrown(()=>test5Code({root:other})).message).toMatch(/원문 해시/);
    const declared=codeMigrationSha256(readAll(other,TEST5_CODE_FILES));expect(thrown(()=>test5Code({root:other,sha256:declared})).message).toMatch(/EXECUTED/);
    rmSync(entry);expect(()=>test5Code({root:other})).toThrow(/파일을 읽지 못했어요/);
  });
  it("목록 모양이 다르면 거부(첫 파일에 run 없음, 중복, 절대·상위 경로, .ts, 빈 목록, 시간 제한 범위)",()=>{
    const base={version:5,name:"x",files:TEST5_CODE_FILES,sha256:TEST5_CODE_SHA256};
    const reversed=[...TEST5_CODE_FILES].reverse();
    expect(()=>codeMigration({...base,files:reversed,sha256:codeMigrationSha256(readAll(process.cwd(),reversed))})).toThrow(/run이 없어요/);
    for(const change of [{files:[TEST5_CODE_FILES[0],TEST5_CODE_FILES[0]]},{files:["D:/abs/test5-code.cjs"]},{files:["tests/../tests/fixtures/migrations/test5-code.cjs"]},{files:["tests/fixtures/migrations/test5-registry.ts"]},{files:[]},{runTimeoutMs:0},{runTimeoutMs:10**9}])
      expect(()=>codeMigration({...base,...change})).toThrow(MigrationSourceError);
  });
  it("codeMigration이 만들지 않은 실행 코드는 어떤 단계도 적용하기 전에 거부한다",async()=>{
    const file=await s4("forged"),before=snap(file),real=test5Code();
    const forged:Migration[]=[{...real},{...migrationEntry(5,"0005_test_only_code.cjs",real.sql),run:real.run},{...migrationEntry(5,"0005_x.sql",real.sql),kind:"code"}];
    for(const five of forged)expect(()=>migrateFile(file,[...productMigrations(),five])).toThrow(MigrationSourceError);
    expect(snap(file)).toEqual(before);
  });
});

describe("로더: 목록 안 원문만, 정해진 형식만 (F050-2)",()=>{
  const outside={"p/outside.cjs":"module.exports.value=10;\n"};
  it("import·export 문법(주석 끼움, type 이름 기본 바인딩 포함)은 실행 graph를 만들 수 없어 거부",()=>{
    for(const text of ["import/* module dependency */ { value } from './outside.cjs';\nmodule.exports.run=function(db){};","export/* c */ { value } from './outside.cjs';","import type from './outside.cjs';\nmodule.exports.run=function(db){};","import './outside.cjs';","export const run=function(db){};"]){
      const make=probe(`imp-${sha(text).slice(0,8)}`,{"p/entry.cjs":text,...outside});expect(()=>make(),text).toThrow(/정해진 .cjs 형식이 아니에요/);
    }
  });
  it("require는 목록 안 정확한 상대 경로와 node:crypto sha256 창구만",()=>{
    const ok=probe("req-ok",{"p/entry.cjs":"const {value}=require('./helper.cjs');const {createHash}=require('node:crypto');module.exports.v=value+createHash('sha256').update('a').digest('hex').length;module.exports.run=function(db){};","p/helper.cjs":"module.exports.value=1;"});
    expect(ok().kind).toBe("code");
    const cases:Record<string,string>={unlisted:"require('./outside.cjs');",noExtension:"require('./helper');",escape:"require('../outside.cjs');",alias:"require('@/p/helper.cjs');",fs:"require('node:fs');",pkg:"require('better-sqlite3');",bare:"require('crypto');",md5:"require('node:crypto').createHash('md5');",random:"require('node:crypto').randomUUID();"};
    for(const [name,line] of Object.entries(cases)){const make=probe(`req-${name}`,{"p/entry.cjs":`${line}\nmodule.exports.run=function(db){};`,"p/helper.cjs":"module.exports.value=1;"});expect(()=>make(),name).toThrow(MigrationSourceError);}
    // `../p/helper.cjs` normalizes to a listed path and is the same module; only escaping the list fails.
  });
  it("run 안에서 늦게 부르는 목록 밖 require도 실패하고 전부 되돌린다",async()=>{
    const make=probe("lazy",{"p/entry.cjs":`${PROOF}module.exports.run=function(db){db.exec("INSERT INTO proof VALUES ('x')");require('./outside.cjs');};`});
    const file=await s4("lazy-db"),before=snap(file);expect(()=>migrateFile(file,[...productMigrations(),make()])).toThrow(/목록 밖 의존/);expect(snap(file)).toEqual(before);
  });
  it("모듈은 한 번만 불러오고 순환은 CommonJS처럼 부분 exports를 본다",()=>{
    const make=probe("cycle",{"p/entry.cjs":"const a=require('./a.cjs');const again=require('./a.cjs');if(a!==again)throw new Error('not cached');if(a.loads!==1)throw new Error('loaded twice');if(a.sawPartial!==true)throw new Error('cycle');module.exports.run=function(db){};","p/a.cjs":"module.exports.loads=(module.exports.loads||0)+1;module.exports.early=true;require('./b.cjs');module.exports.sawPartial=require('./b.cjs').saw;","p/b.cjs":"module.exports.saw=require('./a.cjs').early===true;"});
    expect(make().kind).toBe("code");
  });
  it("시각·난수·코드 생성·호스트 전역은 실행 중에 막힌다",()=>{
    for(const line of ["Date.now();","new Date(0);","Math.random();","new Intl.DateTimeFormat().format();","Temporal.Now.instant();","eval('1');","(function(){}).constructor('return 1')();","process.env.X;","setTimeout(()=>{},1);","performance.now();","new WeakRef({});","globalThis.require('node:fs');"]){
      const make=probe(`rt-${sha(line).slice(0,8)}`,{"p/entry.cjs":`${line}\nmodule.exports.run=function(db){};`});expect(()=>make(),line).toThrow(MigrationSourceError);
    }
  });
  it("시간 제한: 최상위 무한 반복은 불러오기에서, run 무한 반복은 실행에서 끊고 되돌린다",async()=>{
    expect(()=>probe("loop-load",{"p/entry.cjs":"for(;;){}\nmodule.exports.run=function(db){};"})()).toThrow(/불러오는 중 실패/);
    const make=probe("loop-run",{"p/entry.cjs":`${PROOF}module.exports.run=function(db){db.exec("INSERT INTO proof VALUES ('x')");for(;;){}};`},{runTimeoutMs:200});
    const file=await s4("loop-db"),before=snap(file);expect(()=>migrateFile(file,[...productMigrations(),make()])).toThrow(/시간 제한 200ms/);expect(snap(file)).toEqual(before);
  });
  it("비동기: async run은 등록 거부, Promise를 돌려주면 대기 작업까지 트랜잭션 안에서 끝낸 뒤 거부하고 되돌린다(늦은 쓰기 없음)",async()=>{
    expect(()=>probe("async",{"p/entry.cjs":"module.exports.run=async function(db){};"})()).toThrow(/동기 함수/);
    // The queued write targets an existing table and the connection stays open, so a write after rollback would land.
    const make=probe("thenable",{"p/entry.cjs":`${PROOF}module.exports.run=function(db){return Promise.resolve().then(()=>db.exec("INSERT INTO settings(key,value_json) VALUES ('late.write','1')"));};`});
    const file=await s4("thenable-db"),before=snap(file),sqlite=new Database(file);
    try{expect(()=>migrateDatabase(sqlite,{migrations:[...productMigrations(),make()],now})).toThrow(/Promise/);await new Promise(resolve=>setTimeout(resolve,50));expect(sqlite.prepare("SELECT key FROM settings WHERE key='late.write'").all()).toEqual([]);}finally{sqlite.close();}
    expect(snap(file)).toEqual(before);expect(proofRows(file)).toBeNull();
  });
});

describe("반환값 경계: run은 undefined만, 늦은 쓰기 없음 (F052-1·2)",()=>{
  const BASE=migrationEntry(1,"0001_base.sql","CREATE TABLE proof (value INTEGER) STRICT;");
  // Two open in-memory databases with the base step, like T-052 late.mts.
  const opened=()=>[new Database(":memory:"),new Database(":memory:")].map(db=>{migrateDatabase(db,{migrations:[BASE],now});return db;});
  const state=(db:Database.Database)=>({rows:db.prepare("SELECT value FROM proof").all(),journal:db.prepare("SELECT version FROM __schema_migrations ORDER BY version").all(),inTransaction:db.inTransaction});
  const STEP2=(name:string,run:string)=>probe(name,{"p/entry.cjs":`module.exports.run=function(db){${run}};`},{version:2,name:"0002_probe.cjs"});
  const settle=()=>new Promise(resolve=>setTimeout(resolve,50));
  const cases:Record<string,string>={
    "T052 원문: then이 microtask를 예약하는 일반 thenable":"return {then(resolve){Promise.resolve().then(()=>db.exec('INSERT INTO proof VALUES(7)'));resolve();}};",
    "getter가 microtask를 예약하는 then":"return {get then(){Promise.resolve().then(()=>db.exec('INSERT INTO proof VALUES(8)'));return undefined;}};",
    "native Promise":"return Promise.resolve().then(()=>db.exec('INSERT INTO proof VALUES(9)'));",
    "일반 객체":"db.exec('INSERT INTO proof VALUES(10)');return {};",
    "null":"db.exec('INSERT INTO proof VALUES(11)');return null;",
  };
  for(const [label,run] of Object.entries(cases))it(`${label}: 같은 migration 객체를 열린 A·B에 3번씩 번갈아 써도 행·기록 없음, 뒤의 정상 단계는 성공`,async()=>{
    const step=STEP2(`ret-${sha(label).slice(0,8)}`,run)(),[a,b]=opened();
    try{
      for(let round=0;round<3;round++)for(const db of [a,b]){
        expect(()=>migrateDatabase(db,{migrations:[BASE,step],now})).toThrow(/undefined만 돌려줄 수 있어요/);
        expect(state(a)).toEqual({rows:[],journal:[{version:1}],inTransaction:false});expect(state(b)).toEqual({rows:[],journal:[{version:1}],inTransaction:false});
      }
      await settle();expect(state(a).rows).toEqual([]);expect(state(b).rows).toEqual([]);
      const good=STEP2(`good-${sha(label).slice(0,8)}`,"db.exec('INSERT INTO proof VALUES(1)');")();
      for(const db of [a,b]){expect(migrateDatabase(db,{migrations:[BASE,good],now})).toBe(1);}
      await settle();for(const db of [a,b])expect(state(db)).toEqual({rows:[{value:1}],journal:[{version:1},{version:2}],inTransaction:false});
    }finally{a.close();b.close();}
  });
  it("undefined 반환(return 없음·return undefined)은 정상 적용",()=>{
    for(const run of ["db.exec('INSERT INTO proof VALUES(1)');","db.exec('INSERT INTO proof VALUES(1)');return undefined;"]){
      const [a,b]=opened();try{expect(migrateDatabase(a,{migrations:[BASE,STEP2(`undef-${sha(run).slice(0,8)}`,run)()],now})).toBe(1);expect(state(a).rows).toEqual([{value:1}]);}finally{a.close();b.close();}
    }
  });
  it("판정 도우미는 사용자 코드 전에 잡아 둔다: 전역·내장 함수를 바꿔도 async run 거부, 호스트 연결은 보이지 않음",()=>{
    const tamper="try{globalThis.__dream={load(){return 'ok\\\\0'},run(){return 'ok\\\\0'}};}catch(e){}Object.prototype.toString=function(){return '[object Function]'};Reflect.apply=function(){return undefined};";
    expect(()=>STEP2("tamper-async",`};${tamper}module.exports.run=async function(db){`)()).toThrow(/동기 함수/);
    const make=probe("tamper-return",{"p/entry.cjs":`${tamper}module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(3)');return {};};`},{version:2,name:"0002_probe.cjs"});
    const [a,b]=opened();try{expect(()=>migrateDatabase(a,{migrations:[BASE,make()],now})).toThrow(/undefined만/);expect(state(a).rows).toEqual([]);}finally{a.close();b.close();}
    expect(()=>STEP2("bridge",`};if(typeof __dreamHost!=="undefined"||typeof globalThis.__dreamHost!=="undefined")throw new Error("bridge visible");module.exports.run=function(db){`)()).not.toThrow();
  });
  it("목록 밖 require 오류를 사용자 코드가 삼켜도 거부(등록·실행 모두), 실행은 되돌린다",()=>{
    expect(()=>probe("swallow-top",{"p/entry.cjs":"try{require('./outside.cjs');}catch(e){}module.exports.run=function(db){};"})()).toThrow(/목록 밖 의존/);
    const make=STEP2("swallow-run","db.exec('INSERT INTO proof VALUES(4)');try{require('node:fs');}catch(e){}");
    const [a,b]=opened();try{expect(()=>migrateDatabase(a,{migrations:[BASE,make()],now})).toThrow(/목록 밖 의존/);expect(state(a)).toEqual({rows:[],journal:[{version:1}],inTransaction:false});}finally{a.close();b.close();}
  });
  it("실행마다 새 실행 공간: 최상위 상태가 다음 실행으로 넘어가지 않고 sql은 등록 값과 같다",()=>{
    const step=probe("fresh",{"p/entry.cjs":"let count=0;module.exports.run=function(db){count++;db.prepare('INSERT INTO proof VALUES (?)').run(count);};"},{version:2,name:"0002_probe.cjs"})();
    const [a,b]=opened();try{migrateDatabase(a,{migrations:[BASE,step],now});migrateDatabase(b,{migrations:[BASE,step],now});expect(state(a).rows).toEqual([{value:1}]);expect(state(b).rows).toEqual([{value:1}]);}finally{a.close();b.close();}
  });
  // Endless loops run in a child process with an external deadline; a PASS needs the internal limit to end it first.
  const child=join(process.cwd(),"tests/fixtures/migrations/deadline-child.mts");
  const LOAD_LIMIT=/불러오는 중 실패 \(코드 마이그레이션이 시간 제한 1000ms 안에 끝나지 않았어요 \(ERR_SCRIPT_EXECUTION_TIMEOUT\)\)/;
  const RUN_LIMIT=/시간 제한 200ms 안에 끝나지 않았어요 \(ERR_SCRIPT_EXECUTION_TIMEOUT\)/;
  const MODES:Record<string,{phase:string;message:RegExp}>={
    "module-loop":{phase:"register",message:LOAD_LIMIT},
    "entry-run-getter":{phase:"register",message:LOAD_LIMIT},
    "entry-sql-getter":{phase:"register",message:LOAD_LIMIT},
    "run-loop":{phase:"run",message:RUN_LIMIT},
    "then-loop":{phase:"run",message:/undefined만 돌려줄 수 있어요/},
    "then-getter-loop":{phase:"run",message:/undefined만 돌려줄 수 있어요/},
    "error-getter-loop":{phase:"run",message:RUN_LIMIT},
    "microtask-loop":{phase:"run",message:RUN_LIMIT},
  };
  for(const [mode,expected] of Object.entries(MODES))it(`끝나지 않는 ${mode}: 외부 마감(10초) 전에 내부 제한이나 거부로 스스로 끝나고 기록 그대로`,()=>{
    const folder=join(root,`deadline-${mode}`);mkdirSync(folder,{recursive:true});
    const result=spawnSync(process.execPath,["--conditions=react-server","--import","tsx",child,process.cwd(),folder,mode],{cwd:process.cwd(),timeout:10000,encoding:"utf8",windowsHide:true});
    expect(result.error).toBeUndefined();expect(result.signal).toBeNull();expect(result.status).toBe(0);
    const out=JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {phase:string;message:string;elapsedMs:number;journal?:{version:number}[];result?:string};
    expect(out.result).toBeUndefined();expect(out.phase).toBe(expected.phase);expect(out.message).toMatch(expected.message);expect(out.elapsedMs).toBeLessThan(5000);
    if(expected.phase==="run")expect(out.journal).toEqual([1]);
  },20000);
});

describe("SQL 시각·난수 검출 규칙과 단계별 결정성 확인 (F050-3)",()=>{
  it("검출 규칙: 인자 생략 시각 함수·'now'·CURRENT_*·random을 거부하고 시각 값이 있으면 허용",()=>{
    for(const sql of ["strftime('%Y-%m-%dT%H:%M:%fZ')","datetime()","date( )","time()","julianday()","unixepoch()","datetime('now')","date(\"now\",'+1 day')","CURRENT_TIMESTAMP","current_date","random()","randomblob(4)"])
      expect(()=>checkSqlText("x",`SELECT ${sql}`),sql).toThrow(MigrationSourceError);
    for(const sql of ["strftime('%Y', created_at)","datetime(created_at)","date('2026-01-01')","julianday(value_json->>'$.at')"])expect(()=>checkSqlText("x",`SELECT ${sql}`),sql).not.toThrow();
  });
  it("T050 재현 문구(strftime 인자 생략)와 조립한 sql export는 해시가 맞아도 등록 거부",()=>{
    expect(()=>probe("clock-run",{"p/entry.cjs":`${PROOF}module.exports.run=function(db){db.exec("INSERT INTO proof VALUES(strftime('%Y-%m-%dT%H:%M:%fZ'))");};`})()).toThrow(/SQL clock/);
    expect(()=>probe("clock-sql",{"p/entry.cjs":"module.exports.sql='CREATE TABLE proof AS SELECT date'+'time() AS at;';module.exports.run=function(db){};"})()).toThrow(/SQL clock/);
  });
  // Determinism is proved per step: same input, two runs at different real times, identical result except the journal time.
  async function sameAcrossClocks(name:string,list:()=>readonly Migration[]){
    const one=await s4(`${name}-1`),two=await s4(`${name}-2`);migrateFile(one,list());await new Promise(resolve=>setTimeout(resolve,1100));migrateFile(two,list());
    return isDeepStrictEqual(without(snap(one),"__schema_migrations"),without(snap(two),"__schema_migrations"));
  }
  it("시험 5단계는 같은 입력·다른 시각에서 같은 결과",async()=>{expect(await sameAcrossClocks("t5",CODE_LIST)).toBe(true);},20000);
  it("규칙이 못 잡는 시각 표현은 등록되지만 단계별 동등성 확인이 잡는다(규칙은 증명이 아님)",async()=>{
    const make=probe("hidden-clock",{"p/entry.cjs":`${PROOF}module.exports.run=function(db){db.exec("INSERT INTO proof VALUES (strftime('%s', 'n' || 'ow'))");};`});
    expect(make().kind).toBe("code");expect(await sameAcrossClocks("hidden",()=>[...productMigrations(),make()])).toBe(false);
  },20000);
});

describe("verify는 읽기 전용 검사",()=>{
  it("verify가 쓰려 하면 거부되고 전부 되돌리며, 끝나면 query_only를 원래 값으로 돌린다",async()=>{
    const file=await s4("verify-write"),before=snap(file);
    expect(()=>migrateFile(file,[...productMigrations(),test5Code({verify:sqlite=>{sqlite.exec("DELETE FROM test_k6_timeline");}})])).toThrow(/readonly/);expect(snap(file)).toEqual(before);
    const ok=await s4("verify-ok"),sqlite=new Database(ok);
    try{let inside:unknown;migrateDatabase(sqlite,{migrations:[...productMigrations(),test5Code({verify:db=>{inside=db.pragma("query_only",{simple:true});}})],now});expect(inside).toBe(1);expect(sqlite.pragma("query_only",{simple:true})).toBe(0);sqlite.prepare("INSERT INTO settings(key,value_json) VALUES('after.verify','1')").run();}finally{sqlite.close();}
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
      expect(journal(sqlite)?.at(-1)).toEqual({version:5,name:"0005_test_only_code.cjs",sha256:TEST5_CODE_SHA256});
      const rows=sqlite.prepare("SELECT id,project_id,revision,source,created_at FROM test_k6_timeline ORDER BY id").all() as {id:string;source:string}[];
      const snapshots=(sqlite.prepare("SELECT COUNT(*) n FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").get() as {n:number}).n;
      expect(rows).toHaveLength(snapshots);expect(rows.length).toBeGreaterThan(0);expect(new Set(rows.map(row=>row.source))).toEqual(new Set(["p1-migration"]));
      for(const row of rows)expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }finally{sqlite.close();}
  });
  it("변환 중 실패·데이터 검사 실패는 SQL 단계까지 전부 되돌린다",async()=>{
    const file=await s4("broken"),raw=new Database(file);try{raw.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`project.${"0".repeat(8)}-0000-7000-8000-${"0".repeat(12)}.edit.zz`,"{\"content_revision\":1,\"created_at\":\"2026-01-01T00:00:00.000Z\"}");}finally{raw.close();}
    const before=snap(file);expect(thrown(()=>migrateFile(file,CODE_LIST())).name).toBe("TypeError");expect(snap(file)).toEqual(before);
    const clean=await s4("verify"),cleanBefore=snap(clean);
    expect(()=>migrateFile(clean,[...productMigrations(),test5Code({verify:()=>{throw new Error("injected");}})])).toThrow("injected");expect(snap(clean)).toEqual(cleanBefore);
  });
  it("지금 DB 올리기: 바꾸기 전 사본을 남기고 같은 결과, 실패하면 DB 그대로·사본 남음",async()=>{
    const direct=await s4("direct");migrateFile(direct,CODE_LIST());
    const file=await s4("live"),before=snap(file),live=openDatabase(file,{fileMustExist:true},{wal:false});
    try{
      const result=migrateLiveDatabase(live,{snapshotDirectory:join(root,"pre"),migrations:CODE_LIST(),now});expect(result).toMatchObject({applied:1,from:4,to:5});
      expect(snap(result.snapshot!)).toEqual(before);
    }finally{live.close();}
    const strip=(value:ReturnType<typeof snapshotDb>)=>without(without(value,"__schema_migrations"),"activity_log");
    expect(strip(snap(file))).toEqual(strip(snap(direct)));
    const failing=await s4("live-fail"),failingBefore=snap(failing),other=openDatabase(failing,{fileMustExist:true},{wal:false});
    try{expect(()=>migrateLiveDatabase(other,{snapshotDirectory:join(root,"pre-fail"),migrations:[...productMigrations(),test5Code({verify:()=>{throw new Error("injected");}})],now})).toThrow(expect.objectContaining({code:"MIGRATION_FAILED"}));}finally{other.close();}
    expect(snap(failing)).toEqual(failingBefore);expect(readdirSync(join(root,"pre-fail"))).toHaveLength(1);expect(existsSync(join(root,"pre"))).toBe(true);
  });
});

// A changed step 5 whose source really differs (helper text) and whose declaration matches that source.
function changedStep(){
  const other=join(root,"changed-src");copySources(other);const helper=join(other,TEST5_CODE_FILES[1]);writeFileSync(helper,readFileSync(helper,"utf8").replace("test5:","test5b:"));
  const sha256=codeMigrationSha256(readAll(other,TEST5_CODE_FILES));expect(sha256).not.toBe(TEST5_CODE_SHA256);return test5Code({root:other,sha256});
}

describe("기록 일치: DB·백업 기록 해시와 지금 코드 원문",()=>{
  it("지금 DB 기록의 코드 해시가 지금 원문과 다르면 아무 단계도 적용하지 않고 거부, 바뀐 원문은 실제로 다른 결과를 낸다",async()=>{
    const file=await s4("recorded");migrateFile(file,CODE_LIST());const before=snap(file);
    expect(()=>migrateFile(file,[...productMigrations(),changedStep()])).toThrow();expect(snap(file)).toEqual(before);
    expect(migrateFile(file,CODE_LIST())).toBe(0);expect(snap(file)).toEqual(before);
    const fresh=await s4("changed-run");migrateFile(fresh,[...productMigrations(),changedStep()]);
    expect(snap(fresh).get("test_k6_timeline")).not.toEqual(before.get("test_k6_timeline"));
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
    const restored=new Database(join(destination,"data/app.db"),{readonly:true});try{expect(journal(restored)?.at(-1)).toEqual({version:5,name:"0005_test_only_code.cjs",sha256:TEST5_CODE_SHA256});expect((restored.prepare("SELECT COUNT(*) n FROM test_k6_timeline").get() as {n:number}).n).toBeGreaterThan(0);}finally{restored.close();}
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
