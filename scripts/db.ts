import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../lib/db/connection";
import { migrateDatabase, verifyMigrations } from "../lib/db/migrate";
import { seedDatabase } from "../lib/db/seed";
import { getMenuConfig } from "../lib/menus/server";

const command=process.argv[2];
if(!["migrate","seed"].includes(command)) { console.error("migrate 또는 seed 명령이 필요해요.");process.exitCode=1; }
else {
  let handle:ReturnType<typeof openDatabase>|undefined;
  try {
    mkdirSync(join(process.cwd(),"data"),{recursive:true});
    handle=openDatabase();
    if(command==="migrate")console.log(`데이터베이스 준비 완료: 새 마이그레이션 ${migrateDatabase(handle.sqlite)}개`);
    else {verifyMigrations(handle.sqlite);console.log(seedDatabase(handle,getMenuConfig()));}
  } catch {
    console.error("데이터베이스 작업에 실패했어요. 버전·파일 권한·기존 마이그레이션 상태를 확인해 주세요. 기존 데이터를 초기화하지 않았어요.");
    process.exitCode=1;
  } finally {handle?.close();}
}
