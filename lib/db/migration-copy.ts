// One table of sentences for the db:migrate CLI and the startup check (F039-3, design A).
// "복사본도 남겨 두었어요" is said only when the caller has confirmed a valid copy exists.
export type MigrationFailureCode="SCHEMA_MISMATCH"|"SNAPSHOT_EXISTS"|"SNAPSHOT_FAILED"|"DATABASE_BUSY"|"MIGRATION_FAILED";
export type MigrationCopy={headline:string;next:string};
const RUN="npm.cmd run db:migrate";

export function migrationFailureCopy(code:MigrationFailureCode,reason:"unrecorded"|null,snapshotKept:boolean):MigrationCopy{
  switch(code){
    case "MIGRATION_FAILED":return snapshotKept
      ?{headline:"데이터 구조를 바꾸지 못했어요. 바꾸기 전 데이터는 그대로이고, 따로 복사본도 남겨 두었어요.",next:`앱과 작업기를 끈 뒤 ${RUN}를 한 번 더 실행해 주세요. 계속 실패하면 이 안내와 복사본 이름을 알려 주세요.`}
      :{headline:"데이터 구조를 바꾸지 못했어요. 바꾸기 전 데이터는 그대로예요.",next:`바꾸기 전 복사본은 확인하지 못했어요. 앱과 작업기를 끈 뒤 ${RUN}를 한 번 더 실행해 주세요. 계속 실패하면 이 안내를 알려 주세요.`};
    case "DATABASE_BUSY":return {headline:"앱이나 작업기가 데이터를 쓰는 중이라 바꾸지 않았어요. 지금 데이터는 그대로예요.",next:`앱과 작업기를 모두 끈 뒤 ${RUN}를 실행해 주세요.`};
    case "SNAPSHOT_FAILED":return {headline:"바꾸기 전 복사본을 만들지 못해 시작하지 않았어요. 지금 데이터는 그대로예요.",next:"저장 공간과 backups 폴더 쓰기 권한을 확인한 뒤 다시 실행해 주세요."};
    case "SNAPSHOT_EXISTS":return {headline:"바꾸기 전 복사본을 남길 파일 이름이 이미 있어 시작하지 않았어요. 지금 데이터는 그대로예요.",next:"잠시 뒤 다시 실행해 주세요. 있던 복사본은 지우지 않아요."};
    case "SCHEMA_MISMATCH":return reason==="unrecorded"
      ?{headline:"이 데이터베이스가 어느 버전에서 만들어졌는지 확인할 수 없어 바꾸지 않았어요. 지금 데이터는 그대로예요.",next:"설정한 데이터 폴더가 맞는지 확인해 주세요. 새로 시작하려면 빈 데이터 폴더를 지정해 주세요."}
      :{headline:"데이터 구조 기록이 이 앱과 맞지 않아 바꾸지 않았어요. 지금 데이터는 그대로예요.",next:"더 새 버전의 앱에서 쓰던 데이터인지 확인해 주세요."};
  }
}
// Startup sentences when no matching failure record exists (design 3.4).
export const prepareNeededCopy:MigrationCopy={headline:"데이터베이스 준비가 필요해요.",next:`앱과 작업기를 끈 뒤 ${RUN}를 실행해 주세요.`};
export const upgradeNeededCopy:MigrationCopy={headline:"데이터 구조를 새 버전에 맞게 바꿔야 해요. 지금 데이터는 그대로예요.",next:`앱과 작업기를 끈 뒤 ${RUN}를 실행해 주세요. 바꾸기 전에 복사본을 자동으로 남겨요.`};
export const unrecordedCopy=migrationFailureCopy("SCHEMA_MISMATCH","unrecorded",false);
