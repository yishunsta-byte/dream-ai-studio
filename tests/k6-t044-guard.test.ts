// T-044: the T-043 reproductions, run as written (no WAL precondition on inputs).
// F043-1 only the exact empty journal counts as fresh; F043-2 the startup check and a refused db:migrate leave an
// unknown DELETE- or WAL-mode database byte-for-byte; F043-3 a pre-migration copy is claimed only when it opens as an
// intact SQLite copy of the recorded database state. Temporary roots only.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase } from "@/lib/db/connection";
import { databaseOrigin, migrateDatabase, productSqlMigrations, UnrecordedDatabaseError } from "@/lib/db/migrate";
import { migrateLiveDatabase } from "@/lib/db/live-migrate";
import { runMigrateCommand } from "@/lib/db/migrate-command";
import { migrationFailureCopy, unrecordedCopy } from "@/lib/db/migration-copy";
import { keptSnapshot, migrationRecordPath, readMigrationRecord } from "@/lib/db/migration-record";
import { checkDatabase } from "@/lib/db/server";

let root:string,time:number;
const now=()=>time;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t044-")));time=Date.parse("2026-11-16T06:00:00Z");});
afterEach(()=>{vi.unstubAllEnvs();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});

const dbFile=()=>join(root,"data","app.db"),snapshots=()=>join(root,"backups","pre-migrate");
const digest=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
const header=(file:string)=>{const bytes=readFileSync(file);return [bytes[18],bytes[19]];};
type Mode="delete"|"wal";
// Raw better-sqlite3 as in T-043: "delete" is SQLite's default rollback mode, "wal" is switched explicitly.
function build(file:string,mode:Mode,sql:string,pragmas:string[]=[]){
  mkdirSync(dirname(file),{recursive:true});const sqlite=new Database(file);
  try{if(mode==="wal")sqlite.pragma("journal_mode = WAL");for(const pragma of pragmas)sqlite.pragma(pragma);if(sql)sqlite.exec(sql);if(mode==="wal")sqlite.pragma("wal_checkpoint(TRUNCATE)");}finally{sqlite.close();}
  return digest(file);
}
// Every schema object and every row of every table, read through a read-only connection.
function logical(file:string){
  const sqlite=new Database(file,{readonly:true,fileMustExist:true});
  try{
    const objects=sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all() as {type:string;name:string}[];
    const rows=Object.fromEntries(objects.filter(object=>object.type==="table"&&!object.name.startsWith("sqlite_")).map(object=>[object.name,sqlite.prepare(`SELECT * FROM "${object.name.replaceAll('"','""')}"`).raw().all()]));
    return JSON.stringify({objects,rows,user:sqlite.pragma("user_version",{simple:true}),app:sqlite.pragma("application_id",{simple:true})});
  }finally{sqlite.close();}
}
function command(options:Partial<Parameters<typeof runMigrateCommand>[0]>={}){const out:string[]=[],err:string[]=[];const exit=runMigrateCommand({root,now,migrations:productSqlMigrations(),log:line=>out.push(line),error:line=>err.push(line),...options});return {exit,out,err};}
// A product database of the first `steps` migrations, built without the app's WAL switch (like a restored copy).
function productDb(file:string,steps:number,mode:Mode="delete"){
  mkdirSync(dirname(file),{recursive:true});const sqlite=new Database(file);
  try{if(mode==="wal")sqlite.pragma("journal_mode = WAL");sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");migrateDatabase(sqlite,{migrations:productSqlMigrations().slice(0,steps),now});}finally{sqlite.close();}
  return digest(file);
}
const CANONICAL="version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL";

describe("F043-1 정확한 빈 기록 표만 새 DB로 본다",()=>{
  const journals:[string,string][]=[
    ["DEFAULT가 있는 칸","CREATE TABLE __schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'spoof', sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;"],
    ["CHECK 제약",`CREATE TABLE __schema_migrations (${CANONICAL}, CHECK(version>0)) STRICT;`],
    ["숨은 생성 칸",`CREATE TABLE __schema_migrations (${CANONICAL}, hidden TEXT GENERATED ALWAYS AS (name) VIRTUAL) STRICT;`],
    ["네 칸 모두 TEXT","CREATE TABLE __schema_migrations (version TEXT, name TEXT, sha256 TEXT, applied_at TEXT);"],
    ["STRICT 없음",`CREATE TABLE __schema_migrations (${CANONICAL});`],
    ["WITHOUT ROWID",`CREATE TABLE __schema_migrations (${CANONICAL}) STRICT, WITHOUT ROWID;`],
    ["띄어쓰기만 다름","CREATE TABLE __schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT;"],
  ];
  it.each(journals)("%s: 지금 DB 이관·직접 migrate·CLI 모두 거부, 스냅샷 없음, 바이트·내용 그대로",(_name,sql)=>{
    const before=build(dbFile(),"delete",sql),meaning=logical(dbFile());
    const raw=new Database(dbFile(),{fileMustExist:true});
    try{expect(databaseOrigin(raw)).toBe("unrecorded");expect(()=>migrateDatabase(raw,{now})).toThrow(UnrecordedDatabaseError);}finally{raw.close();}
    const handle=openDatabase(dbFile(),{fileMustExist:true},{wal:false});
    try{expect(()=>migrateLiveDatabase(handle,{snapshotDirectory:snapshots(),now})).toThrow(expect.objectContaining({code:"SCHEMA_MISMATCH",reason:"unrecorded"}));}finally{handle.close();}
    expect(command()).toMatchObject({exit:1,err:[unrecordedCopy.headline,unrecordedCopy.next]});
    expect(digest(dbFile())).toBe(before);expect(logical(dbFile())).toBe(meaning);expect(existsSync(snapshots())).toBe(false);
  });
  it("진짜 빈 DB와 이 앱이 만드는 그대로의 빈 기록 표는 DELETE 모드에서도 CLI로 4단계 준비",()=>{
    build(dbFile(),"delete",`CREATE TABLE IF NOT EXISTS __schema_migrations (${CANONICAL}) STRICT;`);
    expect(command()).toMatchObject({exit:0,out:["데이터베이스 준비 완료: 새 마이그레이션 4개"]});expect(checkDatabase(root,productSqlMigrations())).toEqual({ok:true});
    rmSync(join(root,"data"),{recursive:true});build(dbFile(),"delete","");
    expect(command()).toMatchObject({exit:0,out:["데이터베이스 준비 완료: 새 마이그레이션 4개"]});expect(existsSync(snapshots())).toBe(false);
  });
});

describe("F043-2 시작 점검과 거부되는 CLI는 모르는 DB를 바꾸지 않는다",()=>{
  const unknown:[string,string,string[]?][]=[
    ["알 수 없는 표와 값 (T-043 그대로)","CREATE TABLE survivor(id TEXT); INSERT INTO survivor VALUES('keep');"],
    ["빈 기록 표 + 알 수 없는 표",`CREATE TABLE __schema_migrations (${CANONICAL}) STRICT; CREATE TABLE survivor(id TEXT); INSERT INTO survivor VALUES('keep');`],
    ["읽을 수 없는 기록 표","CREATE TABLE __schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO __schema_migrations VALUES (1);"],
    ["DEFAULT가 있는 빈 기록 표","CREATE TABLE __schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'spoof', sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;"],
    ["user_version만","",["user_version = 7"]],
    ["application_id만","",["application_id = 1234"]],
  ];
  const cases=unknown.flatMap(([name,sql,pragmas])=>(["delete","wal"] as const).map(mode=>[`${name} · ${mode}`,mode,sql,pragmas] as const));
  it.each(cases)("%s: 시작 점검·CLI 거부 뒤 바이트·내용·모드 그대로, 스냅샷 없음",(_name,mode,sql,pragmas)=>{
    const before=build(dbFile(),mode,sql,pragmas),meaning=logical(dbFile()),mode0=header(dbFile());
    const check=checkDatabase(root,productSqlMigrations());expect(check.ok).toBe(false);expect(digest(dbFile())).toBe(before);
    const result=command();expect(result.exit).toBe(1);expect(result.err).toEqual([unrecordedCopy.headline,unrecordedCopy.next]);
    expect(checkDatabase(root,productSqlMigrations())).toMatchObject({ok:false,message:unrecordedCopy.headline,code:"SCHEMA_MISMATCH"});
    expect(digest(dbFile())).toBe(before);expect(header(dbFile())).toEqual(mode0);expect(logical(dbFile())).toBe(meaning);
    if(mode==="delete")expect(existsSync(`${dbFile()}-wal`)).toBe(false);
    expect(existsSync(snapshots())).toBe(false);
  });
  it("DELETE 모드 제품 DB: 시작 점검·같은 구조 CLI는 바이트 그대로, 앞부분 DB는 사본을 남기고 올린다",()=>{
    const s4=productDb(dbFile(),4);
    expect(checkDatabase(root,productSqlMigrations())).toEqual({ok:true});expect(command()).toMatchObject({exit:0,out:["데이터베이스 준비 완료: 새 마이그레이션 0개"]});
    expect(digest(dbFile())).toBe(s4);expect(header(dbFile())).toEqual([1,1]);expect(readMigrationRecord(root)).toMatchObject({result:"succeeded",from:4,to:4});
    rmSync(join(root,"data"),{recursive:true});const s3=productDb(dbFile(),3);
    expect(checkDatabase(root,productSqlMigrations())).toMatchObject({ok:false});expect(digest(dbFile())).toBe(s3);
    const result=command();expect(result.exit).toBe(0);const [name]=readdirSync(snapshots());expect(name).toMatch(/_s3-s4\.db$/);
    expect(readMigrationRecord(root)).toMatchObject({result:"succeeded",from:3,to:4,snapshot:`backups/pre-migrate/${name}`,snapshotSha256:digest(join(snapshots(),name))});
    expect(checkDatabase(root,productSqlMigrations())).toEqual({ok:true});
  });
  it("읽기 확인과 쓰기 연결 사이에 기록이 사라지면 쓰는 쪽이 다시 확인해 거부하고 사본도 만들지 않는다",()=>{
    productDb(dbFile(),3);let changed="";
    const result=command({afterProbe:()=>{const raw=new Database(dbFile());try{raw.exec("DELETE FROM __schema_migrations");}finally{raw.close();}changed=digest(dbFile());}});
    expect(result).toMatchObject({exit:1,err:[unrecordedCopy.headline,unrecordedCopy.next]});expect(digest(dbFile())).toBe(changed);expect(existsSync(snapshots())).toBe(false);
  });
  it("F045-1 읽기 확인 때 없던 경로에 모르는 DELETE DB가 생겨도 쓰기 연결이 모드를 바꾸지 않고 거부한다",()=>{
    mkdirSync(join(root,"data"),{recursive:true});let created="",meaning="";
    const result=command({afterProbe:()=>{created=build(dbFile(),"delete","CREATE TABLE survivor(id TEXT); INSERT INTO survivor VALUES('keep');");meaning=logical(dbFile());}});
    expect(created).toBe(digest(dbFile()));expect(result).toMatchObject({exit:1,err:[unrecordedCopy.headline,unrecordedCopy.next]});
    expect(header(dbFile())).toEqual([1,1]);expect(logical(dbFile())).toBe(meaning);expect(existsSync(`${dbFile()}-wal`)).toBe(false);expect(existsSync(snapshots())).toBe(false);
  });
  it("F045-1 없던 경로의 진짜 새 준비와 정상 올리기·최신 no-op은 그대로 된다",()=>{
    expect(command()).toMatchObject({exit:0,out:["데이터베이스 준비 완료: 새 마이그레이션 4개"]});expect(checkDatabase(root,productSqlMigrations())).toEqual({ok:true});
    const ready=digest(dbFile());expect(command()).toMatchObject({exit:0,out:["데이터베이스 준비 완료: 새 마이그레이션 0개"]});expect(digest(dbFile())).toBe(ready);
    rmSync(join(root,"data"),{recursive:true});productDb(dbFile(),3);expect(command().exit).toBe(0);expect(readdirSync(snapshots())).toHaveLength(1);expect(checkDatabase(root,productSqlMigrations())).toEqual({ok:true});
  });
});

describe("F043-3 복사본은 열어서 확인될 때만 남았다고 말한다",()=>{
  // Real CLI failure as in T-043: product s3 plus the first 0004 trigger name already taken.
  function failedRun(){
    productDb(dbFile(),3);const raw=new Database(dbFile());try{raw.exec("CREATE TRIGGER activity_update_guard BEFORE UPDATE ON settings BEGIN SELECT 1; END;");}finally{raw.close();}
    const before=digest(dbFile()),result=command();const [name]=readdirSync(snapshots());const file=join(snapshots(),name),relative=`backups/pre-migrate/${name}`;
    expect(result.exit).toBe(1);expect(result.err[2]).toBe(`바꾸기 전 복사본: ${relative} (자동으로 지우지 않아요)`);expect(digest(dbFile())).toBe(before);
    return {file,relative,before,record:readMigrationRecord(root)!};
  }
  const kept=migrationFailureCopy("MIGRATION_FAILED",null,true),notKept=migrationFailureCopy("MIGRATION_FAILED",null,false);
  const message=()=>{const check=checkDatabase(root,productSqlMigrations());return check.ok?null:check.message;};
  it("올바른 사본은 확인되고, 확인해도 사본 바이트와 곁 파일이 생기지 않는다",()=>{
    const {file,relative,record}=failedRun(),bytes=digest(file);
    expect(record).toMatchObject({code:"MIGRATION_FAILED",snapshot:relative,snapshotSha256:bytes});
    expect(checkDatabase(root,productSqlMigrations())).toMatchObject({message:kept.headline,detail:[`바꾸기 전 복사본: ${relative}`,kept.next]});
    expect(digest(file)).toBe(bytes);expect(readdirSync(snapshots())).toEqual([relative.split("/").at(-1)]);
  });
  it("머리글만 맞는 512바이트 가짜 (T-043 그대로)·반으로 자른 사본·중간이 깨진 사본·다른 정상 DB는 사본이라 하지 않는다",()=>{
    const {file}=failedRun(),original=readFileSync(file);
    const fake=Buffer.alloc(512);fake.write("SQLite format 3\0","latin1");fake[18]=1;fake[19]=1;
    writeFileSync(file,fake);expect(message()).toBe(notKept.headline);
    writeFileSync(file,original);truncateSync(file,Math.floor(original.length/2));expect(message()).toBe(notKept.headline);
    const damaged=Buffer.from(original);for(let index=original.length-4096;index<original.length-2048;index++)damaged[index]^=0xff;writeFileSync(file,damaged);expect(message()).toBe(notKept.headline);
    const other=join(root,"other.db");productDb(other,4);copyFileSync(other,file);expect(message()).toBe(notKept.headline);
    writeFileSync(file,original);expect(message()).toBe(kept.headline);
  });
  it("F045-2 지문 없는 이전 기록은 진짜 사본이어도 확인된 사본이라 하지 않고, 같은 구조·기록에 업무 값만 다른 사본은 지문으로 거부",()=>{
    const {file,record}=failedRun(),original=readFileSync(file),bytes=digest(file);
    // T-045 as written: an ordinary copy of the real snapshot with only a business row changed (schema, journal, integrity unchanged).
    const alternate=join(root,"alternate.db");copyFileSync(file,alternate);const raw=new Database(alternate);try{raw.prepare("INSERT INTO settings(key,value_json) VALUES('review.sentinel','\"REPLACEMENT\"')").run();}finally{raw.close();}
    const check=new Database(alternate,{readonly:true});try{expect(check.pragma("integrity_check",{simple:true})).toBe("ok");}finally{check.close();}
    copyFileSync(alternate,file);expect(message()).toBe(notKept.headline);expect(keptSnapshot(root,record)).toBeNull();
    const {snapshotSha256:_omit,...older}=record;void _omit;writeFileSync(migrationRecordPath(root),JSON.stringify(older));
    expect(readMigrationRecord(root)?.snapshotSha256).toBeUndefined();
    // Legacy record: still parsed and still explains the failure, but never with confirmed-copy wording.
    expect(checkDatabase(root,productSqlMigrations())).toMatchObject({ok:false,message:notKept.headline,detail:[notKept.next],code:"MIGRATION_FAILED"});
    writeFileSync(file,original);expect(digest(file)).toBe(bytes);expect(message()).toBe(notKept.headline);expect(keptSnapshot(root,older)).toBeNull();
    // New records: the right digest confirms, a wrong one does not.
    writeFileSync(migrationRecordPath(root),JSON.stringify(record));expect(message()).toBe(kept.headline);
    expect(keptSnapshot(root,{...record,snapshotSha256:"0".repeat(64)})).toBeNull();expect(keptSnapshot(root,record)).toBe(record.snapshot);expect(digest(file)).toBe(bytes);
  });
});
