import "server-only";
import { openDatabase } from "./connection";
import { verifyMigrations } from "./migrate";

export function checkDatabase() {
  try {
    const handle=openDatabase(undefined,{fileMustExist:true});
    try { verifyMigrations(handle.sqlite); return {ok:true as const}; }
    finally { handle.close(); }
  } catch(error) {
    const known=error instanceof Error && (error.message.startsWith("데이터") || error.message.startsWith("데이터베이스"));
    return {ok:false as const,message:known ? (error as Error).message : "데이터베이스를 열 수 없어요. npm.cmd run db:migrate를 실행하고 저장 권한을 확인해 주세요."};
  }
}
