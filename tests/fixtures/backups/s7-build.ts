// Fixed virtual backup s7 (T-109): the s6 runtime (six steps, five render rows, two MP4s) upgraded with the product
// list, which adds 0007_render_guards.sql at a fixed time, then archived the way a real backup is. No row is added:
// s7 shows the 0006 data kept as it was under the new guards. Test-side only; s4/s5/s6 are never changed here.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { inventoryHash, storageInventory } from "@/lib/backup/archive";
import { APP_VERSION, backupManifestSchema, type BackupManifest } from "@/lib/backup/schema";
import { at, labelId } from "./s4-build";
import { buildS6Runtime } from "./s6-build";

export const S7_DIR=fileURLToPath(new URL(".",import.meta.url));
export const S7_ZIP=join(S7_DIR,"s7.zip"),S7_RECORD=join(S7_DIR,"s7.json");
export const S7_GENERATOR_VERSION=1;
export const S7_BACKUP_ID=labelId("backup.s7",990);
export const S7_UPGRADED_AT=Date.parse(at(980));
export const s7Migrations=()=>productMigrations().slice(0,7);

export async function buildS7Runtime(runtime:string){
  await buildS6Runtime(runtime);
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});
  try{migrateDatabase(handle.sqlite,{migrations:s7Migrations(),now:()=>S7_UPGRADED_AT});if(handle.sqlite.pragma("integrity_check",{simple:true})!=="ok")throw new Error("s7 fixture integrity failed");}finally{handle.close();}
}
export async function assembleS7Zip(runtime:string,workdir:string,out:string){
  const snapshot=join(workdir,"app.db");await mkdir(workdir,{recursive:true});
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});try{await handle.sqlite.backup(snapshot);}finally{handle.close();}
  const files=await storageInventory(join(runtime,"storage"));
  const captured=openDatabase(snapshot,{readonly:true,fileMustExist:true});let migrations:BackupManifest["migrations"];try{migrations=captured.sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as BackupManifest["migrations"];}finally{captured.close();}
  const manifest=backupManifestSchema.parse({schemaVersion:1,backupId:S7_BACKUP_ID,appVersion:APP_VERSION,createdAt:at(990),database:{path:"data/app.db",...await fileDigest(snapshot)},files,inventorySha256:inventoryHash(files),migrations});
  await writeArchive(out,[{path:manifest.database.path,filename:snapshot},...files.map(file=>({path:file.path,filename:join(runtime,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
  return manifest;
}
