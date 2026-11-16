// T-158 P2-6 S2: export manifest 2 + migration 0010 (feature gate). Every database is a copy of the fixed s4 backup in an
// OS temp folder (virtual data); manifest 2 rows are only the valid test rows of ./export-row-helpers.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { compareMigrations, journal, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkDatabase } from "@/lib/db/server";
import { checkExportRows, ExportRowError } from "@/lib/db/export-data";
import { readBackupManifest, verifyBackupArchive, verifyRestoredDatabase } from "@/lib/backup/archive";
import { manifestSchema, manifestV1Schema } from "@/lib/export/schema";
import { verifyZip } from "@/lib/export/zip";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { exportDownload, exportService } from "@/lib/services/exports";
import { jobsService } from "@/lib/services/jobs";
import { restoreService } from "@/lib/services/restore";
import { S4_ZIP, s4Ids, exportManifest } from "./fixtures/backups/s4-build";
import { writeExportFixture } from "./export-row-helpers";

const ids=s4Ids(),now=()=>Date.parse("2026-11-17T09:00:00Z"),nine=()=>productMigrations().slice(0,9);
let root:string;const handles:(DatabaseHandle|Database.Database)[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t158-")));});
afterEach(()=>{for(const handle of handles.splice(0))("sqlite" in handle?handle.sqlite:handle).close();vi.unstubAllEnvs();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
async function runtime(migrations=productMigrations(),name="rt"){
  const folder=join(root,name);await verifyBackupArchive(S4_ZIP,await readBackupManifest(S4_ZIP),folder);mkdirSync(join(folder,"backups"),{recursive:true});
  const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");migrateDatabase(sqlite,{migrations,now});}finally{sqlite.close();}
  vi.stubEnv("DREAM_DATA_ROOT",folder);return folder;
}
const open=(folder:string)=>{const handle=openDatabase(join(folder,"data/app.db"),{fileMustExist:true});handles.push(handle);return handle;};
const revisionOf=(handle:DatabaseHandle)=>(handle.sqlite.prepare("SELECT content_revision AS r FROM projects WHERE id=?").get(ids.main) as {r:number}).r;
type Row={id:string;project_id:string;content_revision:number;status:string;file_path:string|null;manifest_version:unknown;manifest_json:string|null;sha256:string|null;completed_at:string|null};
function insert(sqlite:Database.Database,row:Partial<Row>&{id:string}){
  const full:Row={project_id:ids.main,content_revision:1,status:"succeeded",file_path:`projects/${ids.main}/exports/${row.id}.zip`,manifest_version:1,manifest_json:null,sha256:"a".repeat(64),completed_at:"2026-11-17T00:00:00Z",...row};
  sqlite.prepare("INSERT INTO exports(id,project_id,content_revision,status,file_path,manifest_version,manifest_json,sha256,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(full.id,full.project_id,full.content_revision,full.status,full.file_path,full.manifest_version,full.manifest_json,full.sha256,"2026-11-17T00:00:00Z",full.completed_at);
}
const v1Json=(over:Record<string,unknown>={})=>JSON.stringify({...exportManifest(ids),contentRevision:1,...over});

describe("manifest 1/2 계약 (lib/export/schema)",()=>{
  it("manifest 1은 지금 형태 그대로 읽히고(키 순서·바이트 동일) 2의 필드는 받지 않는다",()=>{
    const v1=exportManifest(ids);expect(JSON.stringify(manifestSchema.parse(v1))).toBe(JSON.stringify(v1));expect(JSON.stringify(manifestV1Schema.parse(v1))).toBe(JSON.stringify(v1));
    expect(manifestSchema.safeParse({...v1,timeline:{revisionId:v7(),schemaVersion:2,audioMixProfile:"p2-5-local-v1"}}).success).toBe(false);
    expect(manifestSchema.safeParse({...v1,manifestVersion:3}).success).toBe(false);expect(manifestSchema.safeParse({...v1,manifestVersion:"1"}).success).toBe(false);
  });
  it("manifest 2: 소리 원본 파일이 하나 이상, audio/ 아래·장면 필드 없음·같은 소리 1번·역할 중복 없음, 모르는 필드 거절",async()=>{
    const good=(await writeExportFixture(join(root,"s"),{projectId:ids.main,contentRevision:1,version:2})).manifest as Record<string,unknown>&{files:Record<string,unknown>[]};
    expect(manifestSchema.parse(good)).toEqual(good);
    const audio=good.files[1],bad=(files:unknown[],extra:Record<string,unknown>={})=>manifestSchema.safeParse({...good,files,...extra}).success;
    expect(bad([good.files[0]])).toBe(false);
    expect(bad([good.files[0],{...audio,path:"sound/x.wav"}])).toBe(false);
    expect(bad([good.files[0],{...audio,sceneId:v7()}])).toBe(false);
    expect(bad([good.files[0],audio,{...audio,path:"audio/02.wav"}])).toBe(false);
    expect(bad([good.files[0],{...audio,audio:{...(audio.audio as object),roles:["music","music"]}}])).toBe(false);
    expect(bad([good.files[0],{path:"audio/loose.wav",sha256:"a".repeat(64),sizeBytes:1,mime:"audio/wav"},audio])).toBe(false);
    expect(bad(good.files,{extra:1})).toBe(false);expect(bad(good.files,{timeline:{...(good.timeline as object),audioMixProfile:"other"}})).toBe(false);
    expect(bad(good.files,{timeline:undefined})).toBe(false);
  });
});

describe("0010 트리거 (NULL 세 값·모르는 manifest·행 일치)",()=>{
  it("완료 행은 manifest와 열·프로젝트·revision·해시·경로가 맞아야 하고, 하나라도 비거나 틀리면 거절",async()=>{
    const folder=await runtime(),sqlite=new Database(join(folder,"data/app.db"));handles.push(sqlite);sqlite.pragma("foreign_keys = ON");
    const v2=(await writeExportFixture(join(folder,"storage"),{projectId:ids.main,contentRevision:1,version:2})).manifestJson;
    const reject=(row:Partial<Row>,label:string)=>expect(()=>insert(sqlite,{id:v7(),...row}),label).toThrow(/export manifest differs/);
    reject({manifest_version:3,manifest_json:v1Json({manifestVersion:3})},"모르는 버전 3");
    reject({manifest_version:2,manifest_json:v1Json()},"열 2 · manifest 1");
    reject({manifest_json:v1Json({manifestVersion:undefined})},"manifestVersion 없음(NULL)");
    reject({manifest_json:v1Json({manifestVersion:"1"})},"manifestVersion 문자열");
    reject({manifest_json:v1Json({kind:undefined})},"kind 없음");
    reject({manifest_json:v1Json({project:{id:v7()}})},"다른 프로젝트");
    reject({manifest_json:v1Json({contentRevision:undefined})},"revision 없음");
    reject({manifest_json:v1Json({contentRevision:2})},"다른 revision");
    reject({manifest_json:v1Json({files:[]})},"파일 0개");
    reject({manifest_json:v1Json({timeline:{schemaVersion:2,audioMixProfile:"p2-5-local-v1"}})},"manifest 1에 timeline");
    reject({manifest_version:2,manifest_json:JSON.stringify({...JSON.parse(v2),timeline:undefined})},"manifest 2에 timeline 없음");
    reject({manifest_version:2,manifest_json:JSON.stringify({...JSON.parse(v2),timeline:{...JSON.parse(v2).timeline,audioMixProfile:"other"}})},"다른 믹스 프로필");
    reject({manifest_version:2,manifest_json:JSON.stringify({...JSON.parse(v2),timeline:{...JSON.parse(v2).timeline,schemaVersion:null}})},"timeline schemaVersion null");
    reject({manifest_json:v1Json(),sha256:"A".repeat(64)},"대문자 해시");reject({manifest_json:v1Json(),sha256:"a".repeat(63)},"짧은 해시");
    reject({manifest_json:v1Json(),sha256:null},"해시 없음");reject({manifest_json:v1Json(),file_path:"library/x.zip"},"다른 경로");
    reject({status:"running",file_path:null,sha256:null,completed_at:null,manifest_version:2},"미완료 행 버전 2");
    // a text version never reaches the trigger: the STRICT column refuses it first
    expect(()=>insert(sqlite,{id:v7(),manifest_version:"x" as unknown as number,manifest_json:v1Json()})).toThrow(/cannot store TEXT/);
    const ok1=v7(),ok2=v7(),running=v7();insert(sqlite,{id:ok1,manifest_json:v1Json()});insert(sqlite,{id:ok2,manifest_version:2,manifest_json:v2});
    insert(sqlite,{id:running,status:"running",file_path:null,sha256:null,completed_at:null});
    // the update path: a running row becomes finished only with an agreeing manifest; failing a running row stays allowed
    expect(()=>sqlite.prepare("UPDATE exports SET status='succeeded',file_path=?,manifest_version=2,manifest_json=?,sha256=?,completed_at='x' WHERE id=?").run(`projects/${ids.main}/exports/${running}.zip`,v1Json(),"b".repeat(64),running)).toThrow(/export manifest differs/);
    sqlite.prepare("UPDATE exports SET status='succeeded',file_path=?,manifest_version=2,manifest_json=?,sha256=?,completed_at='x' WHERE id=?").run(`projects/${ids.main}/exports/${running}.zip`,v2,"b".repeat(64),running);
    const another=v7();insert(sqlite,{id:another,status:"running",file_path:null,sha256:null,completed_at:null});sqlite.prepare("UPDATE exports SET status='failed',error='STORAGE_FAILED' WHERE id=?").run(another);
    expect(()=>checkExportRows(sqlite)).not.toThrow();
  });
});

describe("행 검사는 트리거에 기대지 않는다 · 승격과 되돌림",()=>{
  it("트리거를 지운 사본에 넣은 틀린 행도 checkExportRows가 이유와 함께 거절(SQL보다 엄격한 manifest 형식 포함)",async()=>{
    const folder=await runtime(),sqlite=new Database(join(folder,"data/app.db"));handles.push(sqlite);
    // this copy only: without the 0010 guards (and the finished-row delete guard, to clear each case)
    sqlite.exec("DROP TRIGGER export_manifest_insert_guard; DROP TRIGGER export_manifest_update_guard; DROP TRIGGER completed_export_delete_guard;");
    const cases:[Partial<Row>,RegExp][]=[[{manifest_version:2,manifest_json:v1Json()},/manifest_version differs/],[{manifest_version:3,manifest_json:v1Json({manifestVersion:3})},/not 1 or 2/],
      [{manifest_json:v1Json({menu:undefined})},/not a known version/],[{manifest_json:v1Json({contentRevision:5})},/not this row/],[{manifest_json:v1Json(),file_path:"library/x.zip"},/file path/],
      [{status:"running",file_path:null,sha256:null,completed_at:null,manifest_version:2},/unfinished row/]];
    for(const [row,reason] of cases){const id=v7();insert(sqlite,{id,...row});expect(()=>checkExportRows(sqlite)).toThrow(reason);sqlite.prepare("DELETE FROM exports WHERE id=?").run(id);}
    // "{}" with manifest_version 1 also passes no trigger here, and the code check still refuses it
    insert(sqlite,{id:v7(),manifest_json:"{}"});expect(()=>checkExportRows(sqlite)).toThrow(ExportRowError);
  });
  it("9단계 s4 사본 → 10: 예전 행 바이트 그대로·1단계만 기록, 틀린 예전 행이 있으면 전부 되돌리고 기록 없음",async()=>{
    const folder=await runtime(nine()),file=join(folder,"data/app.db");
    const read=()=>{const db=new Database(file,{readonly:true});try{return {rows:db.prepare("SELECT * FROM exports ORDER BY id").all(),journal:journal(db)!.map(row=>row.version),triggers:db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'export_manifest%'").all()};}finally{db.close();}};
    const before=read();expect(before.journal).toEqual([1,2,3,4,5,6,7,8,9]);expect(before.triggers).toEqual([]);
    // a row written by a 9 app that breaks the contract (no trigger existed): the upgrade stops and records nothing
    {const db=new Database(file);try{insert(db,{id:v7(),manifest_version:2,manifest_json:v1Json()});}finally{db.close();}}
    const broken=read();
    {const db=new Database(file);try{db.pragma("foreign_keys = ON");expect(()=>migrateDatabase(db,{now})).toThrow(ExportRowError);}finally{db.close();}}
    expect(read()).toEqual(broken);
    // a clean 9 copy upgrades by exactly one step and keeps every export row byte for byte
    const clean=await runtime(nine(),"clean"),cleanFile=join(clean,"data/app.db");
    {const db=new Database(cleanFile);try{db.pragma("foreign_keys = ON");expect(migrateDatabase(db,{now})).toBe(1);}finally{db.close();}}
    const after=(()=>{const db=new Database(cleanFile,{readonly:true});try{return {rows:db.prepare("SELECT * FROM exports ORDER BY id").all(),journal:journal(db)!.map(row=>row.version),triggers:db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'export_manifest%'").all()};}finally{db.close();}})();expect(after.rows).toEqual(before.rows);expect(after.journal).toEqual([1,2,3,4,5,6,7,8,9,10]);expect(after.triggers).toHaveLength(2);
    // the old export ZIP still holds exactly its stored manifest, and reads through the union like before
    const handle=open(clean),row=handle.sqlite.prepare("SELECT * FROM exports WHERE status='succeeded'").get() as Row;
    await expect(verifyZip(join(clean,"storage",row.file_path!),manifestSchema.parse(JSON.parse(row.manifest_json!)))).resolves.toMatchObject({manifestVersion:1});
    expect(exportService(handle).list(ids.main).rows.find(item=>item.id===row.id)).toMatchObject({status:"succeeded",fileCount:JSON.parse(row.manifest_json!).files.length,isMock:true});
    expect((await exportDownload(row.id)).sizeBytes).toBeGreaterThan(0);
  },120000);
});

describe("구 9앱 거부 · 복원 판독 · 해시 묶음",()=>{
  async function backedUp(prepare?:(handle:DatabaseHandle,folder:string)=>Promise<void>|void){
    const folder=await runtime(),handle=open(folder);
    const v2=await writeExportFixture(join(folder,"storage"),{projectId:ids.main,contentRevision:revisionOf(handle),version:2});
    handle.sqlite.prepare("INSERT INTO exports(id,project_id,content_revision,status,file_path,manifest_version,manifest_json,sha256,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(v2.id,ids.main,revisionOf(handle),"succeeded",v2.relPath,2,v2.manifestJson,v2.sha256,"2026-11-17T00:00:00Z","2026-11-17T00:00:01Z");
    await prepare?.(handle,folder);
    handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status='running'").run();handle.sqlite.prepare("UPDATE jobs SET next_run_at='2099-01-01T00:00:00Z' WHERE status='queued'").run();
    handle.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();
    const request=backupService(handle,now).request()!,claimed=jobsService(handle,now).claim()!;expect(claimed.kind).toBe("backup");await runClaimedBackup(handle,claimed,now);
    return {folder,handle,backupId:request.id,v2};
  }
  it("10단계 DB와 그 백업을 9단계 앱은 시작·검사·확정에서 거부하고, 현재 앱은 manifest 2 행을 그대로 복원·읽는다",async()=>{
    const {folder,handle,backupId,v2}=await backedUp();
    expect(compareMigrations(journal(handle.sqlite)!,nine())).toBe("too_new");expect(checkDatabase(folder,nine()).ok).toBe(false);expect(checkDatabase(folder).ok).toBe(true);
    const oldDestination=join(root,"old-restored");
    // the 9 app refuses before reading the backup: its own check of the (10-step) database fails first
    expect(()=>restoreService(handle,now,{migrations:nine()})).toThrow(/마이그레이션 기록이 맞지 않아요/);expect(existsSync(oldDestination)).toBe(false);
    // and the backup itself is too new for a 9 list (the restore judge of a 9 app)
    expect(compareMigrations((await readBackupManifest(String((handle.sqlite.prepare("SELECT path FROM backups WHERE id=?").get(backupId) as {path:string}).path))).migrations,nine())).toBe("too_new");
    // a ticket checked by the current app cannot be finished by a 9 app either
    const destination=join(root,"restored"),checked=await restoreService(handle,now).inspect({backupId,destination});expect(checked).toMatchObject({compat:"same",fromVersion:10,toVersion:10});
    expect(()=>restoreService(handle,now,{migrations:nine()})).toThrow();expect(existsSync(destination)).toBe(false);
    await restoreService(handle,now).finish(checked.ticketId);
    const restored=open(destination),row=restored.sqlite.prepare("SELECT * FROM exports WHERE id=?").get(v2.id) as Row;
    expect(row).toEqual(handle.sqlite.prepare("SELECT * FROM exports WHERE id=?").get(v2.id));expect(row.manifest_version).toBe(2);
    expect(exportService(handle).list(ids.main).rows.find(item=>item.id===v2.id)).toMatchObject({status:"succeeded",fileCount:2,isMock:true,available:true,sha256:v2.sha256});
    vi.stubEnv("DREAM_DATA_ROOT",folder);expect(await exportDownload(v2.id)).toMatchObject({sizeBytes:v2.sizeBytes,title:`editing-${v2.id}_SAMPLE.zip`});
  },180000);
  it("행 manifest가 저장된 ZIP과 다르면(열·트리거·파일 해시는 맞아도) 백업 만들기와 복원 판독이 모두 거절",async()=>{
    const retitle=(sqlite:Database.Database)=>{const row=sqlite.prepare("SELECT id,manifest_json FROM exports WHERE manifest_version=2").get() as {id:string;manifest_json:string},manifest=JSON.parse(row.manifest_json);
      sqlite.exec("DROP TRIGGER completed_export_immutable");sqlite.prepare("UPDATE exports SET manifest_json=? WHERE id=?").run(JSON.stringify({...manifest,project:{...manifest.project,title:"바뀐 제목"}}),row.id);
      expect(()=>checkExportRows(sqlite)).not.toThrow();};
    // a good backup, then its extracted copy changed: the restore check opens the ZIP and refuses
    const {handle,backupId}=await backedUp(),path=String((handle.sqlite.prepare("SELECT path FROM backups WHERE id=?").get(backupId) as {path:string}).path),manifest=await readBackupManifest(path),copy=join(root,"extracted");
    await verifyBackupArchive(path,manifest,copy);await expect(verifyRestoredDatabase(copy,manifest)).resolves.toMatchObject({compat:"same"});
    {const db=new Database(join(copy,"data/app.db"));try{retitle(db);}finally{db.close();}}
    await expect(verifyRestoredDatabase(copy,manifest,false)).rejects.toThrow(/ZIP manifest differs/);
    // the same change in a live database: the backup job refuses to finish it
    const second=await runtime(productMigrations(),"live2"),live=open(second),v2=await writeExportFixture(join(second,"storage"),{projectId:ids.main,contentRevision:revisionOf(live),version:2});
    live.sqlite.prepare("INSERT INTO exports(id,project_id,content_revision,status,file_path,manifest_version,manifest_json,sha256,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(v2.id,ids.main,revisionOf(live),"succeeded",v2.relPath,2,v2.manifestJson,v2.sha256,"2026-11-17T00:00:00Z","2026-11-17T00:00:01Z");
    retitle(live.sqlite);live.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status='running'").run();live.sqlite.prepare("UPDATE jobs SET next_run_at='2099-01-01T00:00:00Z' WHERE status='queued'").run();live.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();
    backupService(live,now).request();const claimed=jobsService(live,now).claim()!;await expect(runClaimedBackup(live,claimed,now)).rejects.toThrow();
  },180000);
});
