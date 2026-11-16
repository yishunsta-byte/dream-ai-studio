import "server-only";
import { openDatabase } from "./connection";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compareMigrations, databaseOrigin, journal, productMigrations, verifyMigrations, type Migration } from "./migrate";
import { migrationFailureCopy, prepareNeededCopy, unrecordedCopy, upgradeNeededCopy, type MigrationCopy } from "./migration-copy";
import { databaseFingerprint, keptSnapshot, migrationsFingerprint, readMigrationRecord } from "./migration-record";
import { runtimeRoot } from "@/lib/config/runtime";
import type { DatabaseHandle } from "./connection";

export function withDatabase<T>(operation:(handle:DatabaseHandle)=>T):T {
  const handle=openDatabase(undefined,{fileMustExist:true});
  try {verifyMigrations(handle.sqlite);return operation(handle);}
  finally {handle.close();}
}

export type DatabaseCheck={ok:true}|{ok:false;message:string;detail?:string[];code?:string};
const copyCheck=(copy:MigrationCopy,detail:string[]=[],code?:string):DatabaseCheck=>({ok:false,message:copy.headline,detail:[...detail,copy.next],...(code?{code}:{})});
// F039-3: when the DB check fails, explain why from the DB itself and, only if it belongs to exactly this DB state
// and this app's migration list, from the last db:migrate failure record. The record is never trusted beyond that.
export function checkDatabase(root=runtimeRoot(),list?:readonly Migration[]):DatabaseCheck {
  const file=join(root,"data","app.db");
  if(!existsSync(file))return copyCheck(prepareNeededCopy);
  try {
    const migrations=list??productMigrations(),handle=openDatabase(file,{fileMustExist:true});
    try {
      try { verifyMigrations(handle.sqlite,migrations); return {ok:true as const}; }
      catch(error) {
        const record=readMigrationRecord(root);
        if(record?.result==="failed"&&record.code&&record.database===databaseFingerprint(handle.sqlite)&&record.app===migrationsFingerprint(migrations)){
          const kept=keptSnapshot(root,record.snapshot);
          return copyCheck(migrationFailureCopy(record.code,record.reason,!!kept),kept?[`바꾸기 전 복사본: ${kept}`]:[],record.code);
        }
        const origin=databaseOrigin(handle.sqlite);
        if(origin==="unrecorded")return copyCheck(unrecordedCopy);
        if(origin==="fresh")return copyCheck(prepareNeededCopy);
        if(compareMigrations(journal(handle.sqlite),migrations)==="upgrade")return copyCheck(upgradeNeededCopy);
        const known=error instanceof Error && error.message.startsWith("데이터");
        return {ok:false as const,message:known?(error as Error).message:"데이터베이스를 열 수 없어요. npm.cmd run db:migrate를 실행하고 저장 권한을 확인해 주세요."};
      }
    }
    finally { handle.close(); }
  } catch {
    return {ok:false as const,message:"데이터베이스를 열 수 없어요. npm.cmd run db:migrate를 실행하고 저장 권한을 확인해 주세요."};
  }
}
