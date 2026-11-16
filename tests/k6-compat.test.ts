// K-6 backup compatibility against the fixed virtual backup s4 (T-034 §4) and the live pre-migration
// snapshot (K-6 ⑥). Upgrades use an isolated test-only step 5 passed as a list; no product migration is added.
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { compareMigrations, migrateDatabase, migrationEntry, productMigrations, type Migration } from "@/lib/db/migrate";
import { LiveMigrationError, migrateLiveDatabase } from "@/lib/db/live-migrate";
import { fileDigest, verifyZip, writeArchive } from "@/lib/export/zip";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { restoreInfoSchema, restoreStateSchema, restoreTicketSchema, type BackupManifest } from "@/lib/backup/schema";
import { backupService } from "@/lib/services/backups";
import { restoreService, type RestoreOptions, type RestoreStage } from "@/lib/services/restore";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { exportManifest, S4_RECORD, S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { checkInputs, isoCell, P_JOURNAL_AFTER_4, schemaHash, snapshotDb, text, type Cell, type DbSnap, type Exclude, type Row } from "./fixtures/backups/s4-compare";

const ids=s4Ids(),record=()=>JSON.parse(readFileSync(S4_RECORD,"utf8")) as {schema:string;inputFiles:Record<string,{sha256:string;sizeBytes:number}>};
const plain=(list:readonly Migration[])=>list.map(({version,name,sha256})=>({version,name,sha256}));
// Test-only step 5: a deterministic data move (edit snapshots → index table) with its own data check.
const TEST5_SQL="CREATE TABLE test_k6_edit_index (settings_key TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, content_revision INTEGER NOT NULL, layer_count INTEGER NOT NULL) STRICT;\nINSERT INTO test_k6_edit_index SELECT key, substr(key, 9, 36), json_extract(value_json,'$.content_revision'), json_array_length(value_json,'$.layers') FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current';\n";
function test5(verify?:Migration["verify"]):Migration{return {...migrationEntry(5,"0005_test_only_k6.sql",TEST5_SQL),verify:verify??(sqlite=>{const expected=(sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").get() as {n:number}).n,moved=(sqlite.prepare("SELECT COUNT(*) AS n FROM test_k6_edit_index i JOIN settings s ON s.key=i.settings_key WHERE i.content_revision=json_extract(s.value_json,'$.content_revision') AND i.layer_count=json_array_length(s.value_json,'$.layers')").get() as {n:number}).n;if(moved!==expected)throw new Error("test step 5 moved data differs");})};}
const UPGRADE=()=>[...productMigrations(),test5()];

let root:string,runtime:string,handle:DatabaseHandle|undefined,time:number,committed:{sha256:string;sizeBytes:number};
const now=()=>time,stamp=()=>new Date(time).toISOString();
beforeAll(async()=>{committed=await fileDigest(S4_ZIP);});
// D2: no test may change the committed fixture.
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed);});
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-k6-")));time=Date.parse("2026-11-16T03:00:00Z");});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();handle?.close();handle=undefined;if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

async function source(migrations?:readonly Migration[]){runtime=join(root,"source");for(const path of ["data","storage","backups"])await mkdir(join(runtime,path),{recursive:true});vi.stubEnv("DREAM_DATA_ROOT",runtime);handle=openDatabase(join(runtime,"data/app.db"));migrateDatabase(handle.sqlite,{migrations,now});return handle;}
// Registers a backup ZIP in the source instance the way a verified backup row looks (path, hashes, meta).
async function register(zip:string,manifest:{backupId:string;createdAt:string;database:{sha256:string};inventorySha256:string;files:unknown[]}){const digest=await fileDigest(zip);handle!.sqlite.prepare("INSERT INTO backups(id,kind,path,db_sha256,file_inventory_sha256,status,created_at) VALUES(?,?,?,?,?,?,?)").run(manifest.backupId,"manual",zip,manifest.database.sha256,manifest.inventorySha256,"succeeded",manifest.createdAt);handle!.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`backup.${manifest.backupId}.meta`,JSON.stringify({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:stamp()}));return manifest.backupId;}
async function archived(){const zip=join(root,"archive","s4.zip");await mkdir(dirname(zip),{recursive:true});await copyFile(S4_ZIP,zip);const manifest=await readBackupManifest(zip);await register(zip,manifest);return {zip,manifest};}
async function extractS4(into:string){const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,into);return {manifest,db:join(into,"data/app.db")};}
function snap(path:string){const db=openDatabase(path,{readonly:true,fileMustExist:true});try{return snapshotDb(db.sqlite);}finally{db.close();}}
async function leftovers(){const names:string[]=[];for(const directory of [root,join(root,"archive")])if(existsSync(directory))names.push(...(await readdir(directory)).filter(name=>name.startsWith(".dream-restore-")));return names;}
const empty=async(path:string)=>!existsSync(path)||(await readdir(path)).length===0;
// A changed copy of s4 rebuilt as a ZIP. The committed file is only read.
async function variant(name:string,change:{db?:(sqlite:Database.Database)=>void;storage?:(folder:string,manifest:BackupManifest)=>Promise<void>;manifest?:(manifest:BackupManifest)=>Record<string,unknown>}){
  const folder=join(root,"variants",name);await mkdir(dirname(folder),{recursive:true});const {manifest,db}=await extractS4(folder);
  if(change.db){const sqlite=new Database(db);try{sqlite.pragma("foreign_keys = OFF");change.db(sqlite);sqlite.pragma("journal_mode = DELETE");}finally{sqlite.close();}}
  if(change.storage)await change.storage(folder,manifest);
  const base={...manifest,database:{path:"data/app.db",...await fileDigest(db)}},final=change.manifest?change.manifest(base):base;
  const zip=join(root,"archive",`${name}.zip`);await mkdir(dirname(zip),{recursive:true});await writeArchive(zip,[{path:"data/app.db",filename:db},...manifest.files.map(file=>({path:file.path,filename:join(folder,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(final))}]);
  return {zip,manifest:final as unknown as BackupManifest};
}
const service=(options?:RestoreOptions)=>restoreService(handle!,now,options);
const ticketOf=(id:string)=>restoreTicketSchema.parse(JSON.parse(maintenanceRepository(handle!).setting(`restore.check.${id}`)!.valueJson));
const business=(snapshot:DbSnap)=>new Map([...snapshot].filter(([name])=>name!=="settings"&&name!=="activity_log"));

// T-034 §2 D_R: rows the normalization touches, by the source row, and the exact new values.
type Rule={when:(row:Row)=>boolean;set:(row:Row)=>Record<string,Cell>};
const t=(value:string):Cell=>({t:value});
const status=(row:Row)=>text(row.status);
const D_R=():Record<string,Rule>=>({
  jobs:{when:row=>["queued","running"].includes(status(row)!),set:()=>({status:t("canceled"),error_code:t("RESTORED_NOT_RESUMED"),error_message:t("복원본에서는 작업을 이어서 하지 않아요."),lease_until:null,heartbeat_at:null,next_run_at:null,finished_at:t(stamp()),updated_at:t(stamp())})},
  scene_versions:{when:row=>["queued","running"].includes(status(row)!),set:()=>({status:t("canceled")})},
  exports:{when:row=>status(row)==="running",set:()=>({status:t("failed"),error:t("RESTORE_INTERRUPTED")})},
  backups:{when:row=>status(row)==="running",set:()=>({status:t("failed"),error:t("RESTORE_INTERRUPTED")})},
});
const deletedSetting=(key:string)=>key==="worker.heartbeat"||key==="backup.auto.lastDay"||key.startsWith("restore.check.");
// Compares every source row to the restored one: untouched rows whole, matched rows on unchanged columns,
// changed columns against D_R. Returns how many rows each rule matched (each must be ≥ 1).
function compareRestored(src:DbSnap,dst:DbSnap,exclude:Exclude,newTables:string[]=[]){
  const rules=D_R(),matched:Record<string,number>={jobs:0,scene_versions:0,exports:0,backups:0,deletedSettings:0},addedActivity:Row[]=[];
  expect([...dst.keys()].sort()).toEqual([...src.keys(),...newTables].sort());
  for(const [name,table] of src){const other=dst.get(name)!;expect(other.columns).toEqual(table.columns);const rule=rules[name];
    for(const [key,row] of table.rows){
      if(name==="settings"&&deletedSetting(text(row.key)!)){expect(other.rows.has(key),`deleted ${key}`).toBe(false);matched.deletedSettings++;continue;}
      if(name==="settings"&&text(row.key)==="backup.directory"){expect(other.rows.has(key)).toBe(true);continue;}
      const restored=other.rows.get(key);expect(restored,`${name} ${key}`).toBeDefined();const changes=rule?.when(row)?rule.set(row):{};if(rule?.when(row))matched[name]++;
      for(const column of table.columns){if(exclude(name,column,restored!))continue;expect(restored![column],`${name}.${column} ${key}`).toEqual(column in changes?changes[column]:row[column]);}
    }
    for(const [key,row] of other.rows)if(!table.rows.has(key)){if(name==="activity_log"){addedActivity.push(row);continue;}if(name==="__schema_migrations"&&newTables.length&&Number((row.version as {i:string}).i)>4)continue;// new steps: asserted by the caller
      expect(name==="settings"&&text(row.key)==="restore.info",`unexpected ${name} ${key}`).toBe(true);}
  }
  return {matched,addedActivity};
}
function expectRestoreRows(dst:DbSnap,checked:{ticketId:string;destination:string},added:Row[],pendingJobs:number){
  const settings=dst.get("settings")!.rows,info=restoreStateSchema.parse(JSON.parse(text(settings.get(JSON.stringify([t("restore.info")]))!.value_json)!));
  expect(info).toMatchObject({ticketId:checked.ticketId,backupId:ids.backup,destination:checked.destination,backupCreatedAt:"2026-01-05T00:15:00.000Z",restoredAt:stamp(),inheritedBackupIds:[ids.b0,ids.backup].sort()});expect(Array.isArray(info.protectedRoots)).toBe(true);
  expect(JSON.parse(text(settings.get(JSON.stringify([t("backup.directory")]))!.value_json)!)).toBe(join(checked.destination,"backups"));
  expect(added).toHaveLength(1);const [row]=added;expect(row.project_id).toBeNull();expect(row.actor).toEqual(t("local-user"));expect(row.action).toEqual(t("restore.completed"));expect(JSON.parse(text(row.detail_json)!)).toEqual({ticketId:checked.ticketId,backupId:ids.backup,pendingJobs});expect(isoCell(row.created_at)).toBe(true);expect(text(row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
}

describe("마이그레이션 기록 판정 (K-6 ①②)",()=>{
  const C=[{version:1,name:"a",sha256:"1".repeat(64)},{version:2,name:"b",sha256:"2".repeat(64)},{version:3,name:"c",sha256:"3".repeat(64)}];
  it("정확한 앞부분만 받고 나머지는 거부한다",()=>{
    expect(compareMigrations(C,C)).toBe("same");expect(compareMigrations(C.slice(0,2),C)).toBe("upgrade");expect(compareMigrations([...C,{version:4,name:"d",sha256:"4".repeat(64)}],C)).toBe("too_new");
    expect(compareMigrations(null,C)).toBe("mismatch");expect(compareMigrations([],C)).toBe("mismatch");
    expect(compareMigrations([C[0],{...C[1],sha256:"9".repeat(64)}],C)).toBe("mismatch");expect(compareMigrations([C[0],{...C[1],name:"x"}],C)).toBe("mismatch");
    expect(compareMigrations([C[0],C[2]],C)).toBe("mismatch");expect(compareMigrations([C[0],C[0]],C)).toBe("mismatch");expect(compareMigrations([C[1],C[2]],C)).toBe("mismatch");
    expect(compareMigrations([{...C[0],sha256:"0".repeat(64)},C[1],C[2],{version:4,name:"d",sha256:"4".repeat(64)}],C)).toBe("mismatch");
  });
});

describe("고정 백업 s4 복원 (A2·A3·A4·A5)",()=>{
  it("A2 같은 구조: P_RESTORE로 조건 밖 행·칸은 그대로, 정규화 칸은 D_R 기대값, 파일·입력값 보존",async()=>{
    await source();const {zip}=await archived();const before=await fileDigest(zip),destination=join(root,"restored");
    const svc=service(),checked=await svc.inspect({backupId:ids.backup,destination});expect(checked).toMatchObject({compat:"same",fromVersion:4,toVersion:4,appVersion:"0.1.0",projects:3,pendingJobs:4});
    await svc.finish(checked.ticketId);const src=snap((await extractS4(join(root,"original"))).db),dst=snap(join(destination,"data/app.db"));
    const {matched,addedActivity}=compareRestored(src,dst,()=>false);
    expect(matched).toEqual({jobs:4,scene_versions:2,exports:1,backups:1,deletedSettings:3});expectRestoreRows(dst,checked,addedActivity,4);
    expect(dst.get("settings")!.rows.has(JSON.stringify([t(`job.${ids.j31}.startedAt`)]))).toBe(true);
    expect(checkInputs(dst,ids)).toEqual([]);const db=openDatabase(join(destination,"data/app.db"),{readonly:true,fileMustExist:true});try{expect(schemaHash(db.sqlite)).toBe(record().schema);}finally{db.close();}
    const manifest=await readBackupManifest(S4_ZIP);for(const file of manifest.files)expect(await fileDigest(join(destination,file.path)),file.path).toEqual({sha256:file.sha256,sizeBytes:file.sizeBytes});
    const bundle=await fileDigest(join(destination,"storage/projects",ids.main,"exports",`${ids.e4}.zip`));expect(bundle).toEqual(record().inputFiles["export-r4.zip"]);expect(text(dst.get("exports")!.rows.get(JSON.stringify([t(ids.e4)]))!.sha256)).toBe(bundle.sha256);await verifyZip(join(destination,"storage/projects",ids.main,"exports",`${ids.e4}.zip`),exportManifest(ids));expect(JSON.parse(text(dst.get("exports")!.rows.get(JSON.stringify([t(ids.e4)]))!.manifest_json)!)).toEqual(exportManifest(ids));// H5 meaning check, in addition to bytes
    const info=restoreInfoSchema.parse(JSON.parse(await readFile(join(destination,"restore-info.json"),"utf8")));expect(info).toMatchObject({schemaFrom:4,schemaTo:4,migrationsApplied:[]});
    const restored=openDatabase(join(destination,"data/app.db"),{fileMustExist:true});try{const rows=backupService(restored,now).list().rows;expect(rows.find(row=>row.id===ids.b0)).toMatchObject({origin:"inherited",available:false,restorable:false});expect(rows.find(row=>row.id===ids.backup)).toMatchObject({status:"failed",interruptedByRestore:true,origin:"inherited"});}finally{restored.close();}
    expect(await fileDigest(zip)).toEqual(before);expect(await leftovers()).toEqual([]);
  },60000);
  it("A3 올려서 복원: 시험 전용 5단계를 staging에만 적용하고 기존 표는 보존, 새 데이터는 독립 검사",async()=>{
    const list=UPGRADE();await source(list);const {zip}=await archived();const before=await fileDigest(zip),destination=join(root,"restored");
    const svc=service({migrations:list}),checked=await svc.inspect({backupId:ids.backup,destination});expect(checked).toMatchObject({compat:"upgrade",fromVersion:4,toVersion:5});
    await svc.finish(checked.ticketId);const src=snap((await extractS4(join(root,"original"))).db),dst=snap(join(destination,"data/app.db"));
    const {matched,addedActivity}=compareRestored(src,dst,P_JOURNAL_AFTER_4,["test_k6_edit_index"]);expect(matched.jobs).toBe(4);expectRestoreRows(dst,checked,addedActivity,4);
    const journal=[...dst.get("__schema_migrations")!.rows.values()];expect(journal.map(row=>[Number((row.version as {i:string}).i),text(row.name),text(row.sha256)])).toEqual(plain(list).map(row=>[row.version,row.name,row.sha256]));expect(isoCell(journal[4].applied_at)).toBe(true);
    const moved=[...dst.get("test_k6_edit_index")!.rows.values()].map(row=>[text(row.settings_key),text(row.project_id),row.content_revision,row.layer_count]).sort();
    expect(moved).toEqual([[`project.${ids.main}.edit.${ids.edit1}`,ids.main,{i:"3"},{i:"1"}],[`project.${ids.main}.edit.${ids.edit2}`,ids.main,{i:"5"},{i:"3"}]].sort());
    expect(checkInputs(dst,ids)).toEqual([]);const info=restoreInfoSchema.parse(JSON.parse(await readFile(join(destination,"restore-info.json"),"utf8")));expect(info).toMatchObject({schemaFrom:4,schemaTo:5,migrationsApplied:plain(list).slice(4)});
    expect(await fileDigest(zip)).toEqual(before);expect(await leftovers()).toEqual([]);
  },60000);
  it("A4·A5 같은 결과: 올린 직후(정규화 전)는 직접 migrate·두 번째 복원과 정확히 같고, 정규화 뒤는 실행별 값만 다르다",async()=>{
    const list=UPGRADE();await source(list);await archived();const upgraded:DbSnap[]=[];const capture:RestoreOptions={migrations:list,onStage:async(stage:RestoreStage,staging:string)=>{if(stage==="upgraded")upgraded.push(snap(join(staging,"data/app.db")));}};
    const results=[];for(const name of ["one","two"]){const svc=service(capture),destination=join(root,`restored-${name}`),checked=await svc.inspect({backupId:ids.backup,destination});await svc.finish(checked.ticketId);results.push({checked,dst:snap(join(destination,"data/app.db"))});time+=60000;}
    const direct=join(root,"direct");const {db}=await extractS4(direct);const sqlite=new Database(db);try{migrateDatabase(sqlite,{migrations:list,now});}finally{sqlite.close();}const directSnap=snap(db);
    const strip=(snapshot:DbSnap)=>{const copy:Record<string,unknown>={};for(const [name,table] of snapshot)copy[name]=[...table.rows].map(([key,row])=>[key,Object.fromEntries(table.columns.map(column=>[column,P_JOURNAL_AFTER_4(name,column,row)?"<x>":row[column]]))]);return copy;};
    expect(upgraded).toHaveLength(2);expect(strip(upgraded[0])).toEqual(strip(directSnap));expect(strip(upgraded[1])).toEqual(strip(directSnap));
    // P_POSTNORM: assert each run's own V_RUN values, then everything else must be identical.
    const runValues=(snapshot:DbSnap,checked:{ticketId:string;destination:string})=>{const settings=snapshot.get("settings")!.rows,info=restoreStateSchema.parse(JSON.parse(text(settings.get(JSON.stringify([t("restore.info")]))!.value_json)!));expect(info.ticketId).toBe(checked.ticketId);expect(info.destination).toBe(checked.destination);expect(JSON.parse(text(settings.get(JSON.stringify([t("backup.directory")]))!.value_json)!)).toBe(join(checked.destination,"backups"));const added=[...snapshot.get("activity_log")!.rows.values()].filter(row=>text(row.action)==="restore.completed");expect(added).toHaveLength(1);expect(JSON.parse(text(added[0].detail_json)!).ticketId).toBe(checked.ticketId);return info;};
    const infos=results.map(result=>runValues(result.dst,result.checked));expect(infos[0].backupCreatedAt).toBe(infos[1].backupCreatedAt);expect(infos[0].inheritedBackupIds).toEqual(infos[1].inheritedBackupIds);
    const runSpecific=(snapshot:DbSnap)=>{const copy=strip(snapshot) as Record<string,[string,Record<string,Cell|string>][]>;copy.settings=copy.settings.filter(([key])=>![JSON.stringify([t("restore.info")]),JSON.stringify([t("backup.directory")])].includes(key));copy.activity_log=copy.activity_log.filter(([,row])=>text(row.action as Cell)!=="restore.completed");copy.jobs=copy.jobs.map(([key,row])=>[key,{...row,finished_at:text(row.status as Cell)==="canceled"&&text(row.error_code as Cell)==="RESTORED_NOT_RESUMED"?"<run>":row.finished_at,updated_at:text(row.error_code as Cell)==="RESTORED_NOT_RESUMED"?"<run>":row.updated_at}]);return copy;};
    expect(runSpecific(results[0].dst)).toEqual(runSpecific(results[1].dst));
  },60000);
});

describe("거부와 원본 보존 (B·C)",()=>{
  async function rejects(zip:{zip:string;manifest:BackupManifest},code:string,list?:readonly Migration[]){await source(list);await register(zip.zip,zip.manifest);const before=await fileDigest(zip.zip),destination=join(root,"restored");
    await expect(service({migrations:list}).inspect({backupId:zip.manifest.backupId,destination})).rejects.toMatchObject({code});
    expect(existsSync(destination)).toBe(false);expect(await leftovers()).toEqual([]);expect(await fileDigest(zip.zip)).toEqual(before);expect(handle!.sqlite.prepare("SELECT key FROM settings WHERE key GLOB 'restore.check.*'").all()).toEqual([]);}
  const addFive=(m:BackupManifest)=>({...m,migrations:[...m.migrations,{version:5,name:"0005_future.sql",sha256:"5".repeat(64)}]});
  it("B1 더 새 버전(현재+5단계)은 BACKUP_TOO_NEW, staging·목적지 없음",async()=>{await rejects(await variant("too-new",{db:sqlite=>sqlite.prepare("INSERT INTO __schema_migrations VALUES(5,'0005_future.sql',?,'2026-01-06T00:00:00.000Z')").run("5".repeat(64)),manifest:addFive}),"BACKUP_TOO_NEW");});
  it("B2 기록 다름: 해시 한 글자·번호 빠짐·이름 변경은 BACKUP_SCHEMA_MISMATCH",async()=>{
    const flip=(value:string)=>`${value.slice(0,-1)}${value.endsWith("0")?"1":"0"}`;
    await rejects(await variant("sha",{db:sqlite=>sqlite.prepare("UPDATE __schema_migrations SET sha256=? WHERE version=2").run(flip(productMigrations()[1].sha256)),manifest:m=>({...m,migrations:m.migrations.map(row=>row.version===2?{...row,sha256:flip(row.sha256)}:row)})}),"BACKUP_SCHEMA_MISMATCH");
  });
  it("B2 번호 빠짐(1,2,4)",async()=>{await rejects(await variant("gap",{db:sqlite=>sqlite.exec("DELETE FROM __schema_migrations WHERE version=3"),manifest:m=>({...m,migrations:m.migrations.filter(row=>row.version!==3)})}),"BACKUP_SCHEMA_MISMATCH");});
  it("B2 이름만 변경",async()=>{await rejects(await variant("name",{db:sqlite=>sqlite.exec("UPDATE __schema_migrations SET name='0004_renamed.sql' WHERE version=4"),manifest:m=>({...m,migrations:m.migrations.map(row=>row.version===4?{...row,name:"0004_renamed.sql"}:row)})}),"BACKUP_SCHEMA_MISMATCH");});
  it("B2 기록 표 없음: manifest는 맞아도 DB 검사에서 거부하고 staging을 지운다",async()=>{await rejects(await variant("no-journal",{db:sqlite=>sqlite.exec("DROP TABLE __schema_migrations")}),"BACKUP_SCHEMA_MISMATCH");});
  it("B3 manifest와 DB 기록이 다름 (양쪽 방향)",async()=>{
    await rejects(await variant("manifest-only",{manifest:m=>({...m,migrations:m.migrations.map(row=>row.version===4?{...row,sha256:"4".repeat(64)}:row)})}),"BACKUP_SCHEMA_MISMATCH");
  });
  it("B3 DB만 다름",async()=>{await rejects(await variant("db-only",{db:sqlite=>sqlite.prepare("UPDATE __schema_migrations SET sha256=? WHERE version=4").run("4".repeat(64))}),"BACKUP_SCHEMA_MISMATCH");});
  it("B4 manifest 형식 2는 거부, appVersion은 기록용이라 0.2.0도 받는다",async()=>{
    await rejects(await variant("format",{manifest:m=>({...m,schemaVersion:2})}),"BACKUP_SCHEMA_MISMATCH");
  });
  it("B4 appVersion 0.2.0은 검사를 통과하고 화면에 기록으로만 보인다",async()=>{const zip=await variant("app",{manifest:m=>({...m,appVersion:"0.2.0"})});await source();await register(zip.zip,zip.manifest);const checked=await service().inspect({backupId:ids.backup,destination:join(root,"restored")});expect(checked).toMatchObject({compat:"same",appVersion:"0.2.0"});});
  it("B 거부는 올리기 목록에서도 같다: 5단계 이름이 다른 백업은 거부",async()=>{await rejects(await variant("other-five",{db:sqlite=>sqlite.prepare("INSERT INTO __schema_migrations VALUES(5,'0005_other.sql',?,'2026-01-06T00:00:00.000Z')").run("5".repeat(64)),manifest:addFive}),"BACKUP_SCHEMA_MISMATCH",UPGRADE());});
  it("C1 ZIP 1바이트 변조는 RESTORE_INVALID",async()=>{await source();const {zip}=await archived();const bytes=await readFile(zip);bytes[bytes.length-40]^=1;await writeFile(zip,bytes);await expect(service().inspect({backupId:ids.backup,destination:join(root,"restored")})).rejects.toMatchObject({code:"RESTORE_INVALID"});expect(await leftovers()).toEqual([]);});
  it("C3 저장 파일 내용만 다름은 RESTORE_INVALID",async()=>{await rejects(await variant("file",{storage:async(folder,manifest)=>{await writeFile(join(folder,manifest.files[0].path),"changed");}}),"RESTORE_INVALID");});
  it("C4 DB 참조가 깨진 백업은 RESTORE_INVALID",async()=>{await rejects(await variant("fk",{db:sqlite=>sqlite.prepare("DELETE FROM characters WHERE id=?").run(ids.char1)}),"RESTORE_INVALID");});
});

describe("중간 실패 격리 (D1)",()=>{
  async function failsAt(options:RestoreOptions,code:string,list?:readonly Migration[]){
    await source(list);const {zip}=await archived();const before=await fileDigest(zip),destination=join(root,"restored"),sourceBefore=business(snapshotDb(handle!.sqlite));
    const svc=service({...options,migrations:list}),checked=await svc.inspect({backupId:ids.backup,destination});await expect(svc.finish(checked.ticketId)).rejects.toMatchObject({code});
    expect(await leftovers()).toEqual([]);expect(await empty(destination)).toBe(true);expect(ticketOf(checked.ticketId).status).toBe("failed");expect(business(snapshotDb(handle!.sqlite))).toEqual(sourceBefore);return {zip,before};
  }
  it("올리기 트랜잭션 안에서 실패하면 BACKUP_UPGRADE_FAILED, 흔적 없음",async()=>{const failing={...migrationEntry(5,"0005_test_only_fail.sql","CREATE TABLE test_k6_fail (id TEXT PRIMARY KEY NOT NULL CHECK (0)) STRICT;\nINSERT INTO test_k6_fail SELECT id FROM projects;\n")};const {zip,before}=await failsAt({},"BACKUP_UPGRADE_FAILED",[...productMigrations(),failing]);expect(await fileDigest(zip)).toEqual(before);});
  it("새 단계의 데이터 검사가 실패하면 BACKUP_UPGRADE_FAILED",async()=>{const list=[...productMigrations(),test5(sqlite=>{if((sqlite.prepare("SELECT COUNT(*) AS n FROM test_k6_edit_index").get() as {n:number}).n>0)throw new Error("injected");})];await failsAt({},"BACKUP_UPGRADE_FAILED",list);});
  it("풀기 직후·올린 직후 주입 실패",async()=>{await failsAt({onStage:stage=>{if(stage==="extracted")throw new Error("injected");}},"BACKUP_UPGRADE_FAILED",UPGRADE());});
  it("올린 뒤 검사 지점 주입 실패",async()=>{await failsAt({onStage:stage=>{if(stage==="upgraded")throw new Error("injected");}},"BACKUP_UPGRADE_FAILED",UPGRADE());});
  it("정규화 직후 주입 실패는 RESTORE_INVALID",async()=>{await failsAt({onStage:stage=>{if(stage==="normalized")throw new Error("injected");}},"RESTORE_INVALID",UPGRADE());});
  it("확정 직전 원본 ZIP이 바뀌면 BACKUP_SOURCE_CHANGED, 목적지 없음",async()=>{let archive="";await failsAt({onStage:async stage=>{if(stage==="before-publish"){archive=maintenanceRepository(handle!).backup(ids.backup)!.path;await writeFile(archive,Buffer.concat([await readFile(archive),Buffer.from([0])]));}}},"BACKUP_SOURCE_CHANGED");expect(archive).not.toBe("");});
  it("검사 뒤 확정 전에 원본 ZIP이 바뀌어도 BACKUP_SOURCE_CHANGED",async()=>{await source();const {zip}=await archived();const destination=join(root,"restored"),svc=service(),checked=await svc.inspect({backupId:ids.backup,destination});await writeFile(zip,Buffer.concat([await readFile(zip),Buffer.from([0])]));await expect(svc.finish(checked.ticketId)).rejects.toMatchObject({code:"BACKUP_SOURCE_CHANGED"});expect(await leftovers()).toEqual([]);expect(await empty(destination)).toBe(true);});
});

describe("지금 쓰는 DB 올리기 전 스냅샷 (E · K-6 ⑥)",()=>{
  async function live(timeout?:number){const folder=join(root,"live");await mkdir(folder);const {db}=await extractS4(join(root,"s4"));const path=join(folder,"app.db");await copyFile(db,path);handle=openDatabase(path,{fileMustExist:true,...(timeout?{timeout}:{})});return {path,snapshots:join(root,"pre-migrate")};}
  const journalLength=(sqlite:Database.Database)=>(sqlite.prepare("SELECT COUNT(*) AS n FROM __schema_migrations").get() as {n:number}).n;
  const expectedName=()=>`${new Date(time).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}_s4-s5.db`;
  it("E1 WAL에 있는 쓰기까지 담은 새 파일 스냅샷을 남기고, 이관 후 기록 1줄을 남긴다",async()=>{
    const {path,snapshots}=await live();const other=openDatabase(path,{fileMustExist:true});try{other.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES('e1.wal','\"in wal\"')").run();expect(existsSync(`${path}-wal`)).toBe(true);
      const before=snapshotDb(handle!.sqlite);const result=migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:UPGRADE(),now});
      expect(result).toMatchObject({applied:1,from:4,to:5});expect(result.snapshot).toBe(join(snapshots,expectedName()));
      const copy=new Database(result.snapshot!,{readonly:true,fileMustExist:true});try{expect(copy.pragma("integrity_check",{simple:true})).toBe("ok");expect(snapshotDb(copy)).toEqual(before);}finally{copy.close();}
      expect(journalLength(handle!.sqlite)).toBe(5);const log=handle!.sqlite.prepare("SELECT actor,detail_json FROM activity_log WHERE action='db.migrated'").all() as {actor:string;detail_json:string}[];expect(log).toEqual([{actor:"local-user",detail_json:JSON.stringify({from:4,to:5,snapshot:expectedName()})}]);
      expect(await readdir(snapshots)).toEqual([expectedName()]);// E4: kept, never deleted
    }finally{other.close();}
  });
  it("E2 같은 이름 파일이 있으면 덮지 않고 이관도 하지 않는다",async()=>{const {snapshots}=await live();await mkdir(snapshots);await writeFile(join(snapshots,expectedName()),"keep");const before=snapshotDb(handle!.sqlite);
    expect(()=>migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:UPGRADE(),now})).toThrow(expect.objectContaining({code:"SNAPSHOT_EXISTS"}));expect(await readFile(join(snapshots,expectedName()),"utf8")).toBe("keep");expect(snapshotDb(handle!.sqlite)).toEqual(before);});
  it("E2 스냅샷 폴더를 만들 수 없으면 이관하지 않는다",async()=>{const {snapshots}=await live();await writeFile(snapshots,"not a folder");const before=snapshotDb(handle!.sqlite);
    expect(()=>migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:UPGRADE(),now})).toThrow(expect.objectContaining({code:"SNAPSHOT_FAILED"}));expect(snapshotDb(handle!.sqlite)).toEqual(before);});
  it("E3 스냅샷 뒤 다른 연결이 쓰면 DATABASE_BUSY로 멈추고 스냅샷은 남는다",async()=>{const {path,snapshots}=await live();const other=openDatabase(path,{fileMustExist:true});try{
    let error:unknown;try{migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:UPGRADE(),now,afterSnapshot:()=>{other.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES('e3.late','1')").run();}});}catch(caught){error=caught;}
    expect(error).toBeInstanceOf(LiveMigrationError);expect((error as LiveMigrationError).code).toBe("DATABASE_BUSY");expect(journalLength(handle!.sqlite)).toBe(4);expect(existsSync(join(snapshots,expectedName()))).toBe(true);}finally{other.close();}});
  it("E3 다른 연결이 쓰기 잠금을 쥐고 있으면 기다린 뒤 DATABASE_BUSY, 반쪽 스냅샷 없음",async()=>{const {path,snapshots}=await live(300);const other=new Database(path,{timeout:300});try{other.exec("BEGIN IMMEDIATE");other.prepare("INSERT INTO settings(key,value_json) VALUES('e3.uncommitted','1')").run();
    expect(()=>migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:UPGRADE(),now})).toThrow(expect.objectContaining({code:"DATABASE_BUSY"}));
    const copy=new Database(join(snapshots,expectedName()),{readonly:true,fileMustExist:true});try{expect(copy.pragma("integrity_check",{simple:true})).toBe("ok");expect(copy.prepare("SELECT 1 FROM settings WHERE key='e3.uncommitted'").get()).toBeUndefined();}finally{copy.close();}
    other.exec("ROLLBACK");expect(journalLength(handle!.sqlite)).toBe(4);}finally{other.close();}});
  it("E4 이관 중 실패하면 DB는 그대로이고 스냅샷은 남는다",async()=>{const {snapshots}=await live();const before=snapshotDb(handle!.sqlite);const list=[...productMigrations(),test5(()=>{throw new Error("injected");})];
    expect(()=>migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:list,now})).toThrow(expect.objectContaining({code:"MIGRATION_FAILED"}));expect(snapshotDb(handle!.sqlite)).toEqual(before);
    const copy=new Database(join(snapshots,expectedName()),{readonly:true,fileMustExist:true});try{expect(copy.pragma("integrity_check",{simple:true})).toBe("ok");}finally{copy.close();}});
  it("같은 구조면 스냅샷 없이 그대로, 새 DB는 스냅샷 없이 전부 적용, 다른 기록은 거부",async()=>{const {snapshots}=await live();expect(migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,now})).toEqual({applied:0,from:4,to:4,snapshot:null});expect(existsSync(snapshots)).toBe(false);
    const fresh=openDatabase(join(root,"fresh.db"));try{expect(migrateLiveDatabase(fresh,{snapshotDirectory:snapshots,now})).toEqual({applied:4,from:0,to:4,snapshot:null});}finally{fresh.close();}
    handle!.sqlite.prepare("UPDATE __schema_migrations SET name='x' WHERE version=4").run();expect(()=>migrateLiveDatabase(handle!,{snapshotDirectory:snapshots,migrations:UPGRADE(),now})).toThrow(expect.objectContaining({code:"SCHEMA_MISMATCH"}));expect(existsSync(snapshots)).toBe(false);});
});
