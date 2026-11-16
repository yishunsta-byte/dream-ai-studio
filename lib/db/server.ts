import "server-only";
import { openDatabase } from "./connection";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compareMigrations, databaseOrigin, journal, productMigrations, verifyMigrations, type Migration } from "./migrate";
import { migrationFailureCopy, prepareNeededCopy, unrecordedCopy, upgradeNeededCopy, type MigrationCopy } from "./migration-copy";
import { databaseFingerprint, keptSnapshot, migrationsFingerprint, readMigrationRecord } from "./migration-record";
import { runtimeRoot } from "@/lib/config/runtime";
import { MigrationSourceError } from "./code-migration";
import type { DatabaseHandle } from "./connection";

export function withDatabase<T>(operation:(handle:DatabaseHandle)=>T):T {
  // F043-2: switch to WAL only after the database is verified as this app's; an unknown one is left byte-for-byte.
  const handle=openDatabase(undefined,{fileMustExist:true},{wal:false});
  try {verifyMigrations(handle.sqlite);handle.sqlite.pragma("journal_mode = WAL");return operation(handle);}
  finally {handle.close();}
}

export type DatabaseCheck={ok:true}|{ok:false;message:string;detail?:string[];code?:string};
const copyCheck=(copy:MigrationCopy,detail:string[]=[],code?:string):DatabaseCheck=>({ok:false,message:copy.headline,detail:[...detail,copy.next],...(code?{code}:{})});
// F039-3: when the DB check fails, explain why from the DB itself and, only if it belongs to exactly this DB state
// and this app's migration list, from the last db:migrate failure record. The record is never trusted beyond that.
// The database is opened read-only (F043-2): the startup check never changes it.
export function checkDatabase(root=runtimeRoot(),list?:readonly Migration[]):DatabaseCheck {
  const file=join(root,"data","app.db");
  // T-061 D8: the code steps' files are read and checked before the database is opened (missing, changed, or the app
  // started outside its folder). This is checked first, with or without a database file.
  let migrations:readonly Migration[];
  try { migrations=list??productMigrations(); }
  catch(error) { if(error instanceof MigrationSourceError){const copy=migrationFailureCopy("MIGRATION_SOURCE",null,false);return copyCheck(copy,[],"MIGRATION_SOURCE");} return {ok:false as const,message:"데이터베이스를 열 수 없어요. npm.cmd run db:migrate를 실행하고 저장 권한을 확인해 주세요."}; }
  if(!existsSync(file))return copyCheck(prepareNeededCopy);
  try {
    const handle=openDatabase(file,{fileMustExist:true,readonly:true});
    try {
      try { verifyMigrations(handle.sqlite,migrations); return {ok:true as const}; }
      catch(error) {
        const record=readMigrationRecord(root);
        if(record?.result==="failed"&&record.code&&record.database===databaseFingerprint(handle.sqlite)&&record.app===migrationsFingerprint(migrations)){
          const kept=keptSnapshot(root,record);
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
