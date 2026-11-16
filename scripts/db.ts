import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { openDatabase } from "../lib/db/connection";
import { verifyMigrations } from "../lib/db/migrate";
import { LiveMigrationError, migrateLiveDatabase } from "../lib/db/live-migrate";
import { seedDatabase } from "../lib/db/seed";
import { getMenuConfig } from "../lib/menus/server";
import { runtimeRoot } from "../lib/config/runtime";

const command=process.argv[2];
const failure:Record<string,string>={
  SCHEMA_MISMATCH:"데이터 구조 기록이 이 앱과 맞지 않아 바꾸지 않았어요. 더 새 버전의 앱에서 쓰던 데이터인지 확인해 주세요. 지금 데이터는 그대로예요.",
  SNAPSHOT_EXISTS:"바꾸기 전 복사본을 남길 파일 이름이 이미 있어 시작하지 않았어요. 잠시 뒤 다시 실행해 주세요. 지금 데이터는 그대로예요.",
  SNAPSHOT_FAILED:"바꾸기 전 복사본을 만들지 못해 시작하지 않았어요. 저장 공간과 권한을 확인해 주세요. 지금 데이터는 그대로예요.",
  DATABASE_BUSY:"앱이나 작업기가 데이터를 쓰는 중이라 바꾸지 않았어요. 앱과 작업기를 끈 뒤 다시 실행해 주세요. 지금 데이터는 그대로예요.",
  MIGRATION_FAILED:"데이터 구조를 바꾸지 못했어요. 바꾸기 전 데이터는 그대로이고, 따로 복사본도 남겨 두었어요.",
};
if(!["migrate","seed"].includes(command)) { console.error("migrate 또는 seed 명령이 필요해요.");process.exitCode=1; }
else {
  let handle:ReturnType<typeof openDatabase>|undefined;
  try {
    mkdirSync(join(runtimeRoot(),"data"),{recursive:true});
    handle=openDatabase();
    if(command==="migrate"){
      const result=migrateLiveDatabase(handle,{snapshotDirectory:join(runtimeRoot(),"backups","pre-migrate")});
      console.log(`데이터베이스 준비 완료: 새 마이그레이션 ${result.applied}개`);
      if(result.snapshot)console.log(`바꾸기 전 복사본: backups/pre-migrate/${basename(result.snapshot)} (자동으로 지우지 않아요)`);
    }
    else {verifyMigrations(handle.sqlite);console.log(seedDatabase(handle,getMenuConfig()));}
  } catch(error) {
    if(error instanceof LiveMigrationError){console.error(failure[error.code]);if(error.snapshot)console.error(`복사본: backups/pre-migrate/${basename(error.snapshot)}`);}
    else console.error("데이터베이스 작업에 실패했어요. 버전·파일 권한·기존 마이그레이션 상태를 확인해 주세요. 기존 데이터를 초기화하지 않았어요.");
    process.exitCode=1;
  } finally {handle?.close();}
}
