// T-042: F039-2 (an unrecorded nonempty DB is never initialised) and F039-3 (the startup check explains the
// last db:migrate failure only when the record belongs to exactly this DB and app). Temporary roots only.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase } from "@/lib/db/connection";
import { databaseOrigin, migrateDatabase, migrationEntry, productMigrations, UnrecordedDatabaseError, type Migration } from "@/lib/db/migrate";
import { LiveMigrationError, migrateLiveDatabase } from "@/lib/db/live-migrate";
import { runMigrateCommand } from "@/lib/db/migrate-command";
import { migrationFailureCopy, prepareNeededCopy, unrecordedCopy, upgradeNeededCopy } from "@/lib/db/migration-copy";
import { migrationRecordPath, readMigrationRecord } from "@/lib/db/migration-record";
import { checkDatabase } from "@/lib/db/server";

let root:string,time:number;
const now=()=>time;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t042-")));time=Date.parse("2026-11-16T05:00:00Z");});
afterEach(()=>{vi.unstubAllEnvs();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});

const dbFile=()=>join(root,"data","app.db"),snapshots=()=>join(root,"backups","pre-migrate");
const digest=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
// A database built outside the app, in WAL mode so opening it with the app's settings does not rewrite its header.
function build(file:string,sql:string,pragmas:string[]=[]){mkdirSync(dirname(file),{recursive:true});const sqlite=new Database(file);try{sqlite.pragma("journal_mode = WAL");for(const pragma of pragmas)sqlite.pragma(pragma);if(sql)sqlite.exec(sql);sqlite.pragma("wal_checkpoint(TRUNCATE)");}finally{sqlite.close();}return digest(file);}
function productDb(file=dbFile()){mkdirSync(dirname(file),{recursive:true});const handle=openDatabase(file);try{migrateDatabase(handle.sqlite,{now});}finally{handle.close();}return digest(file);}
const failing5=():Migration=>({...migrationEntry(5,"0005_test_only_t042.sql","CREATE TABLE test_t042 (id TEXT PRIMARY KEY) STRICT;"),verify:()=>{throw new Error("injected");}});
const other5=():Migration=>migrationEntry(5,"0005_test_only_t042.sql","CREATE TABLE test_t042_other (id TEXT PRIMARY KEY) STRICT;");
const JOURNAL="CREATE TABLE __schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;";
function command(options:Partial<Parameters<typeof runMigrateCommand>[0]>={}){const out:string[]=[],err:string[]=[];const exit=runMigrateCommand({root,now,log:line=>out.push(line),error:line=>err.push(line),...options});return {exit,out,err};}

describe("F039-2 기록 없는 기존 DB는 신규로 취급하지 않는다",()=>{
  const unrecorded:[string,string,string[]?][]=[
    ["알 수 없는 표와 값","CREATE TABLE survivor(id TEXT PRIMARY KEY); INSERT INTO survivor VALUES('do-not-relabel');"],
    ["빈 기록 표 + 알 수 없는 표",`${JOURNAL} CREATE TABLE survivor(id TEXT PRIMARY KEY); INSERT INTO survivor VALUES('do-not-relabel');`],
    ["기록 없는 제품 표",productMigrations()[0].sql],
    ["보기(view)만","CREATE VIEW only_view AS SELECT 1 AS one;"],
    ["표와 트리거","CREATE TABLE t(x); CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN SELECT 1; END;"],
    ["빈 기록 표 + 색인",`${JOURNAL} CREATE INDEX journal_name ON __schema_migrations(name);`],
    ["읽을 수 없는 기록 표(칸 모자람)","CREATE TABLE __schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO __schema_migrations VALUES (1);"],
    ["칸이 다른 빈 기록 표","CREATE TABLE __schema_migrations (version INTEGER PRIMARY KEY, name TEXT, sha256 TEXT, applied_at TEXT, extra TEXT);"],
    ["user_version만 있음","",["user_version = 7"]],
  ];
  it.each(unrecorded)("%s: 지금 DB 이관·직접 migrate 모두 거부, 스냅샷 없음, 원본 그대로",(_name,sql,pragmas)=>{
    const before=build(dbFile(),sql,pragmas);
    const handle=openDatabase(dbFile(),{fileMustExist:true});
    try{
      expect(databaseOrigin(handle.sqlite)).toBe("unrecorded");
      let error:unknown;try{migrateLiveDatabase(handle,{snapshotDirectory:snapshots(),now});}catch(caught){error=caught;}
      expect(error).toBeInstanceOf(LiveMigrationError);expect(error).toMatchObject({code:"SCHEMA_MISMATCH",reason:"unrecorded",snapshot:null});
      expect(()=>migrateDatabase(handle.sqlite,{now})).toThrow(UnrecordedDatabaseError);
    }finally{handle.close();}
    expect(existsSync(snapshots())).toBe(false);expect(digest(dbFile())).toBe(before);
  });
  it("진짜 빈 DB와 정확한 빈 기록 표만 있는 DB는 처음부터 4단계를 적용한다",()=>{
    for(const [name,sql] of [["empty",""],["journal-only",JOURNAL]] as const){
      const file=join(root,`${name}.db`);build(file,sql);const handle=openDatabase(file,{fileMustExist:true});
      try{expect(databaseOrigin(handle.sqlite)).toBe("fresh");expect(migrateLiveDatabase(handle,{snapshotDirectory:snapshots(),now})).toEqual({applied:4,from:0,to:4,snapshot:null});expect(databaseOrigin(handle.sqlite)).toBe("recorded");}finally{handle.close();}
    }
    expect(existsSync(snapshots())).toBe(false);
  });
  it("정상 제품 DB는 같으면 그대로, 더 긴 목록이면 스냅샷을 남기고 올린다",()=>{
    productDb();const result=command({migrations:[...productMigrations(),other5()]});
    expect(result.exit).toBe(0);expect(readdirSync(snapshots())).toHaveLength(1);expect(command({migrations:[...productMigrations(),other5()]}).out[0]).toBe("데이터베이스 준비 완료: 새 마이그레이션 0개");
  });
});

describe("F039-3 시작 점검의 이관 실패 안내",()=>{
  const copyOf=(check:ReturnType<typeof checkDatabase>)=>check.ok?null:{message:check.message,detail:check.detail??[],code:check.code};
  const UPGRADE=()=>[...productMigrations(),failing5()];
  it("기록 없음: DB 없음은 준비 안내, 성공하면 결과 기록을 남기고 통과",()=>{
    expect(copyOf(checkDatabase(root))).toEqual({message:prepareNeededCopy.headline,detail:[prepareNeededCopy.next],code:undefined});
    const result=command();expect(result).toMatchObject({exit:0,err:[]});
    expect(readMigrationRecord(root)).toMatchObject({result:"succeeded",code:null,from:0,to:4,snapshot:null});expect(checkDatabase(root)).toEqual({ok:true});
  });
  it("이관 실패: CLI와 시작 점검이 같은 문장, 확인된 복사본 상대 경로, 다음 행동, 코드 줄. DB는 그대로",()=>{
    const before=productDb(),list=UPGRADE();const result=command({migrations:list});
    const copy=migrationFailureCopy("MIGRATION_FAILED",null,true),[name]=readdirSync(snapshots()),relative=`backups/pre-migrate/${name}`;
    expect(result.exit).toBe(1);expect(result.err).toEqual([copy.headline,copy.next,`바꾸기 전 복사본: ${relative} (자동으로 지우지 않아요)`]);
    expect(digest(dbFile())).toBe(before);
    const raw=readFileSync(migrationRecordPath(root),"utf8");expect(raw).not.toContain(root);expect(raw).not.toMatch(/[A-Za-z]:[\\/]|\\\\/);
    expect(readMigrationRecord(root)).toMatchObject({result:"failed",code:"MIGRATION_FAILED",reason:null,from:4,to:5,snapshot:relative});
    expect(copyOf(checkDatabase(root,list))).toEqual({message:copy.headline,detail:[`바꾸기 전 복사본: ${relative}`,copy.next],code:"MIGRATION_FAILED"});
    // The copy is claimed only while a real SQLite file is there.
    writeFileSync(join(snapshots(),name),"not a database".padEnd(600,"."));
    const withoutCopy=migrationFailureCopy("MIGRATION_FAILED",null,false);
    expect(copyOf(checkDatabase(root,list))).toEqual({message:withoutCopy.headline,detail:[withoutCopy.next],code:"MIGRATION_FAILED"});
    unlinkSync(join(snapshots(),name));expect(copyOf(checkDatabase(root,list))?.message).toBe(withoutCopy.headline);
    expect(digest(dbFile())).toBe(before);
  });
  it("복사본 폴더가 연결(junction)로 바뀌면 복사본이 남았다고 하지 않는다",()=>{
    productDb();const list=UPGRADE();command({migrations:list});const [name]=readdirSync(snapshots());
    const elsewhere=join(root,"elsewhere");mkdirSync(elsewhere);copyFileSync(join(snapshots(),name),join(elsewhere,name));rmSync(snapshots(),{recursive:true});symlinkSync(elsewhere,snapshots(),"junction");
    expect(copyOf(checkDatabase(root,list))?.message).toBe(migrationFailureCopy("MIGRATION_FAILED",null,false).headline);
  });
  it("기록을 쓰지 못해도 종료 코드·DB는 같고, 시작 점검은 기본 안내",()=>{
    const before=productDb(),list=UPGRADE();const result=command({migrations:list,writeRecord:()=>{throw new Error("disk full");}});
    expect(result.exit).toBe(1);expect(result.err.at(-1)).toBe("실패 기록을 남기지 못했어요. 위 안내를 그대로 따라 주세요.");expect(digest(dbFile())).toBe(before);expect(existsSync(migrationRecordPath(root))).toBe(false);
    expect(copyOf(checkDatabase(root,list))).toEqual({message:upgradeNeededCopy.headline,detail:[upgradeNeededCopy.next],code:undefined});
    const ok=command({writeRecord:()=>{throw new Error("disk full");}});expect(ok.exit).toBe(0);expect(ok.err).toEqual(["결과 기록을 남기지 못했어요. 데이터 구조 변경 결과는 위와 같아요."]);
  });
  it("옛 기록은 무시: 다른 앱 목록·같은 개수 다른 DB·성공 뒤 늦게 쓴 실패 기록·이후 no-op 성공",()=>{
    productDb();const list=UPGRADE();command({migrations:list});const failed=readMigrationRecord(root)!;
    // Same counts (4 → 5) but a different step 5: not this app's list.
    expect(copyOf(checkDatabase(root,[...productMigrations(),other5()]))?.message).toBe(upgradeNeededCopy.headline);
    // Same counts but another DB (different applied times): not this DB.
    rmSync(join(root,"data"),{recursive:true});time+=1000;productDb();writeFileSync(migrationRecordPath(root),JSON.stringify(failed));
    expect(copyOf(checkDatabase(root,list))?.message).toBe(upgradeNeededCopy.headline);
    // A failed record written after a successful run (concurrent CLI) cannot hide a passing check.
    expect(command({migrations:[...productMigrations(),other5()]}).exit).toBe(0);writeFileSync(migrationRecordPath(root),JSON.stringify(failed));
    expect(checkDatabase(root,[...productMigrations(),other5()])).toEqual({ok:true});
    // A no-op success replaces the failed record.
    expect(command({migrations:[...productMigrations(),other5()]}).exit).toBe(0);expect(readMigrationRecord(root)).toMatchObject({result:"succeeded",from:5,to:5});
  });
  it("깨진·너무 큰·형식 밖·경로 탈출 기록과 폴더로 바뀐 기록은 무시하고 멈추지 않는다",()=>{
    productDb();const list=UPGRADE();command({migrations:list});const failed=readMigrationRecord(root)!;const path=migrationRecordPath(root);
    const variants:string[]=["{not json",JSON.stringify({...failed,extra:1}),JSON.stringify(failed).padEnd(5000," "),JSON.stringify({...failed,snapshot:"backups/pre-migrate/../../data/app.db"}),JSON.stringify({...failed,snapshot:"C:/elsewhere/20261116T050000Z_s4-s5.db"}),JSON.stringify({...failed,code:"EVIL"})];
    for(const value of variants){writeFileSync(path,value);expect(readMigrationRecord(root)).toBeNull();expect(copyOf(checkDatabase(root,list))?.message).toBe(upgradeNeededCopy.headline);}
    rmSync(path);mkdirSync(path);expect(readMigrationRecord(root)).toBeNull();expect(copyOf(checkDatabase(root,list))?.message).toBe(upgradeNeededCopy.headline);
  });
  it("기록 없는 DB(F039-2): CLI는 거부하고 시작 점검은 같은 문장과 코드. 기록이 없어도 같은 첫 문장",()=>{
    const before=build(dbFile(),"CREATE TABLE survivor(id TEXT PRIMARY KEY); INSERT INTO survivor VALUES('x');");
    expect(copyOf(checkDatabase(root))).toEqual({message:unrecordedCopy.headline,detail:[unrecordedCopy.next],code:undefined});
    const result=command();expect(result.exit).toBe(1);expect(result.err).toEqual([unrecordedCopy.headline,unrecordedCopy.next]);
    expect(readMigrationRecord(root)).toMatchObject({result:"failed",code:"SCHEMA_MISMATCH",reason:"unrecorded",from:0,snapshot:null});
    expect(copyOf(checkDatabase(root))).toEqual({message:unrecordedCopy.headline,detail:[unrecordedCopy.next],code:"SCHEMA_MISMATCH"});
    expect(digest(dbFile())).toBe(before);expect(existsSync(snapshots())).toBe(false);
  });
  it("스냅샷 단계 실패(SNAPSHOT_FAILED·SNAPSHOT_EXISTS)는 복사본을 말하지 않고, 외부 DREAM_DATA_ROOT에서도 같은 기록을 읽는다",()=>{
    const before=productDb(),list=UPGRADE();mkdirSync(join(root,"backups"));writeFileSync(snapshots(),"a file, not a folder");
    const result=command({migrations:list});const copy=migrationFailureCopy("SNAPSHOT_FAILED",null,false);
    expect(result.err).toEqual([copy.headline,copy.next]);expect(readMigrationRecord(root)).toMatchObject({code:"SNAPSHOT_FAILED",snapshot:null});
    vi.stubEnv("DREAM_DATA_ROOT",root);expect(copyOf(checkDatabase(undefined,list))).toEqual({message:copy.headline,detail:[copy.next],code:"SNAPSHOT_FAILED"});
    rmSync(snapshots());mkdirSync(snapshots());const name=`${new Date(time).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}_s4-s5.db`;writeFileSync(join(snapshots(),name),"keep");
    const exists=command({migrations:list});const copy2=migrationFailureCopy("SNAPSHOT_EXISTS",null,false);expect(exists.err).toEqual([copy2.headline,copy2.next]);
    expect(readFileSync(join(snapshots(),name),"utf8")).toBe("keep");expect(copyOf(checkDatabase(undefined,list))?.code).toBe("SNAPSHOT_EXISTS");expect(digest(dbFile())).toBe(before);
  });
});
