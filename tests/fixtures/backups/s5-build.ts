// Fixed virtual backup s5 (T-060 6.2-6, T-061): the s4 runtime (P1 steps 1–4, same generator) upgraded with the
// product list including code step 0005, then archived the way a real backup is. Test-side only (vitest, `server-only`
// mocked), writes only into the temporary root it is given. s4.zip / s4.json are never changed by this file.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { inventoryHash, storageInventory } from "@/lib/backup/archive";
import { APP_VERSION, backupManifestSchema, type BackupManifest } from "@/lib/backup/schema";
import { at, buildS4Runtime, exportBundleBytes, labelId } from "./s4-build";

export const S5_DIR=fileURLToPath(new URL(".",import.meta.url));
export const S5_ZIP=join(S5_DIR,"s5.zip"),S5_RECORD=join(S5_DIR,"s5.json");
export const S5_GENERATOR_VERSION=1;
export const S5_BACKUP_ID=labelId("backup.s5",950);
export const S5_UPGRADED_AT=Date.parse(at(940));

// s4 runtime → the first five product steps (step 5 applied at a fixed time) under `runtime`. Later steps (0006, T-105)
// belong to s6; s5 stays the 5-step backup it was recorded as.
export const s5Migrations=()=>productMigrations().slice(0,5);
export async function buildS5Runtime(runtime:string){
  await buildS4Runtime(runtime,await exportBundleBytes(false));
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});
  try{migrateDatabase(handle.sqlite,{migrations:s5Migrations(),now:()=>S5_UPGRADED_AT});if(handle.sqlite.pragma("integrity_check",{simple:true})!=="ok")throw new Error("s5 fixture integrity failed");}finally{handle.close();}
}
// Same steps as assembleS4Zip (snapshot → inventory → manifest → writeArchive) with the s5 id and time.
export async function assembleS5Zip(runtime:string,workdir:string,out:string){
  const snapshot=join(workdir,"app.db");await mkdir(workdir,{recursive:true});
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});try{await handle.sqlite.backup(snapshot);}finally{handle.close();}
  const files=await storageInventory(join(runtime,"storage"));
  const captured=openDatabase(snapshot,{readonly:true,fileMustExist:true});let migrations:BackupManifest["migrations"];try{migrations=captured.sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as BackupManifest["migrations"];}finally{captured.close();}
  const manifest=backupManifestSchema.parse({schemaVersion:1,backupId:S5_BACKUP_ID,appVersion:APP_VERSION,createdAt:at(950),database:{path:"data/app.db",...await fileDigest(snapshot)},files,inventorySha256:inventoryHash(files),migrations});
  await writeArchive(out,[{path:manifest.database.path,filename:snapshot},...files.map(file=>({path:file.path,filename:join(runtime,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
  return manifest;
}
