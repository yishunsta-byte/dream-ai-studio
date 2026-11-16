import "server-only";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDatabase, type DatabaseHandle } from "./connection";
import { compareMigrations, databaseOrigin, journal, productMigrations, verifyMigrations, type Migration } from "./migrate";
import { LiveMigrationError, migrateLiveDatabase, type LiveMigrationResult } from "./live-migrate";
import { migrationFailureCopy } from "./migration-copy";
import { databaseFingerprint, fileSha256, migrationsFingerprint, snapshotRelative, writeMigrationRecord, type MigrationRecord } from "./migration-record";

// afterProbe: test-only hook between the read-only look and the writing connection (race regression).
export type MigrateCommandOptions={root:string;migrations?:readonly Migration[];now?:()=>number;log?:(line:string)=>void;error?:(line:string)=>void;writeRecord?:(root:string,record:MigrationRecord)=>void;afterProbe?:()=>void};
const appliedCount=(sqlite:Database.Database)=>{try{return journal(sqlite)?.length??0;}catch{return 0;}};
const digestOf=(file:string)=>{try{return fileSha256(file);}catch{return null;}};

// `npm.cmd run db:migrate`. Returns the exit code.
// F043-2: an existing database is first read through a read-only connection. Only a fresh database or an allowed
// upgrade is opened for writing, and then without the persistent switch to WAL, so nothing about the file changes
// before the pre-migration copy (the upgrade re-checks origin and journal on the writing connection, inside its
// lock). A refused or already-current database is never opened for writing.
// The result record (F039-3) is written after the DB work; failing to write it never changes the DB or the exit code.
export function runMigrateCommand(options:MigrateCommandOptions):number{
  const {root}=options,migrations=options.migrations??productMigrations(),now=options.now??Date.now,log=options.log??console.log,error=options.error??console.error,write=options.writeRecord??writeMigrationRecord;
  const file=join(root,"data","app.db");
  let probe:Database.Database|undefined,handle:DatabaseHandle|undefined;
  try{
    mkdirSync(join(root,"data"),{recursive:true});
    const existed=existsSync(file);
    let refusal:LiveMigrationError|null=null,current=false;
    if(existed){
      probe=new Database(file,{readonly:true,fileMustExist:true,timeout:5000});
      const origin=databaseOrigin(probe);
      if(origin==="unrecorded")refusal=new LiveMigrationError("SCHEMA_MISMATCH",null,"unrecorded");
      else if(origin==="recorded"){const compat=compareMigrations(journal(probe),migrations);if(compat==="same"){verifyMigrations(probe,migrations);current=true;}else if(compat!=="upgrade")refusal=new LiveMigrationError("SCHEMA_MISMATCH");}
    }
    let exit=0,outcome:Pick<MigrationRecord,"result"|"code"|"reason"|"from"|"to"|"snapshot"|"snapshotSha256">;
    try{
      if(refusal)throw refusal;
      let result:LiveMigrationResult;
      if(current)result={applied:0,from:migrations.length,to:migrations.length,snapshot:null};
      else{probe?.close();probe=undefined;options.afterProbe?.();handle=openDatabase(file,{},{wal:!existed});result=migrateLiveDatabase(handle,{snapshotDirectory:join(root,"backups","pre-migrate"),migrations,now});}
      const snapshot=result.snapshot?snapshotRelative(result.snapshot):null;
      log(`데이터베이스 준비 완료: 새 마이그레이션 ${result.applied}개`);
      if(snapshot)log(`바꾸기 전 복사본: ${snapshot} (자동으로 지우지 않아요)`);
      outcome={result:"succeeded",code:null,reason:null,from:result.from,to:result.to,snapshot,snapshotSha256:snapshot&&result.snapshot?digestOf(result.snapshot):null};
    }catch(failure){
      if(!(failure instanceof LiveMigrationError))throw failure;
      // A snapshot that failed its own check is not a usable copy, even though the file is kept.
      const kept=failure.snapshot&&failure.code!=="SNAPSHOT_FAILED"?snapshotRelative(failure.snapshot):null,copy=migrationFailureCopy(failure.code,failure.reason,!!kept);
      error(copy.headline);error(copy.next);
      if(kept)error(`바꾸기 전 복사본: ${kept} (자동으로 지우지 않아요)`);
      else if(failure.snapshot){const name=snapshotRelative(failure.snapshot);if(name)error(`확인하지 못한 복사본 파일이 남아 있어요: ${name} (지우지 않았어요)`);}
      outcome={result:"failed",code:failure.code,reason:failure.reason,from:appliedCount((handle?.sqlite??probe)!),to:migrations.length,snapshot:kept,snapshotSha256:kept&&failure.snapshot?digestOf(failure.snapshot):null};
      exit=1;
    }
    try{write(root,{schema:1,...outcome,at:new Date(now()).toISOString(),database:databaseFingerprint((handle?.sqlite??probe)!),app:migrationsFingerprint(migrations)});}
    catch{error(outcome.result==="failed"?"실패 기록을 남기지 못했어요. 위 안내를 그대로 따라 주세요.":"결과 기록을 남기지 못했어요. 데이터 구조 변경 결과는 위와 같아요.");}
    return exit;
  }catch{
    error("데이터베이스 작업에 실패했어요. 버전·파일 권한·기존 마이그레이션 상태를 확인해 주세요. 기존 데이터를 초기화하지 않았어요.");
    return 1;
  }finally{probe?.close();handle?.close();}
}
