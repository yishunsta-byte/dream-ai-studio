import "server-only";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type DatabaseHandle } from "./connection";
import { journal, productMigrations, type Migration } from "./migrate";
import { LiveMigrationError, migrateLiveDatabase } from "./live-migrate";
import { migrationFailureCopy } from "./migration-copy";
import { databaseFingerprint, migrationsFingerprint, snapshotRelative, writeMigrationRecord, type MigrationRecord } from "./migration-record";

export type MigrateCommandOptions={root:string;migrations?:readonly Migration[];now?:()=>number;log?:(line:string)=>void;error?:(line:string)=>void;writeRecord?:(root:string,record:MigrationRecord)=>void};
const appliedCount=(handle:DatabaseHandle)=>{try{return journal(handle.sqlite)?.length??0;}catch{return 0;}};

// `npm.cmd run db:migrate`. Returns the exit code. The result record (F039-3) is written after the DB work
// is finished; failing to write it never changes the DB or the exit code.
export function runMigrateCommand(options:MigrateCommandOptions):number{
  const {root}=options,migrations=options.migrations??productMigrations(),now=options.now??Date.now,log=options.log??console.log,error=options.error??console.error,write=options.writeRecord??writeMigrationRecord;
  let handle:DatabaseHandle|undefined;
  try{
    mkdirSync(join(root,"data"),{recursive:true});
    handle=openDatabase(join(root,"data","app.db"));
    let exit=0,outcome:Pick<MigrationRecord,"result"|"code"|"reason"|"from"|"to"|"snapshot">;
    try{
      const result=migrateLiveDatabase(handle,{snapshotDirectory:join(root,"backups","pre-migrate"),migrations,now});
      const snapshot=result.snapshot?snapshotRelative(result.snapshot):null;
      log(`데이터베이스 준비 완료: 새 마이그레이션 ${result.applied}개`);
      if(snapshot)log(`바꾸기 전 복사본: ${snapshot} (자동으로 지우지 않아요)`);
      outcome={result:"succeeded",code:null,reason:null,from:result.from,to:result.to,snapshot};
    }catch(failure){
      if(!(failure instanceof LiveMigrationError))throw failure;
      // A snapshot that failed its own check is not a usable copy, even though the file is kept.
      const kept=failure.snapshot&&failure.code!=="SNAPSHOT_FAILED"?snapshotRelative(failure.snapshot):null,copy=migrationFailureCopy(failure.code,failure.reason,!!kept);
      error(copy.headline);error(copy.next);
      if(kept)error(`바꾸기 전 복사본: ${kept} (자동으로 지우지 않아요)`);
      else if(failure.snapshot){const name=snapshotRelative(failure.snapshot);if(name)error(`확인하지 못한 복사본 파일이 남아 있어요: ${name} (지우지 않았어요)`);}
      outcome={result:"failed",code:failure.code,reason:failure.reason,from:appliedCount(handle),to:migrations.length,snapshot:kept};
      exit=1;
    }
    try{write(root,{schema:1,...outcome,at:new Date(now()).toISOString(),database:databaseFingerprint(handle.sqlite),app:migrationsFingerprint(migrations)});}
    catch{error(outcome.result==="failed"?"실패 기록을 남기지 못했어요. 위 안내를 그대로 따라 주세요.":"결과 기록을 남기지 못했어요. 데이터 구조 변경 결과는 위와 같아요.");}
    return exit;
  }catch{
    error("데이터베이스 작업에 실패했어요. 버전·파일 권한·기존 마이그레이션 상태를 확인해 주세요. 기존 데이터를 초기화하지 않았어요.");
    return 1;
  }finally{handle?.close();}
}
