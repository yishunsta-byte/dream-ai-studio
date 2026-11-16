// T-069 (F065-1): a P1-moved timeline r1 whose scene order (or clips) differs from its P1 source snapshot — with its
// canonical JSON, hash and the backup manifest all made consistent — must not be read as that snapshot. Virtual copies
// of the fixed s5 in OS temp only; s4/s5 bytes are checked unchanged.
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkTimelineRows, P1SourceMismatchError, readTimelineRow, timelineSha256, type TimelineRow } from "@/lib/db/timeline-data";
import { canonicalJson, type Timeline } from "@/lib/edit/timeline";
import { srtText } from "@/lib/edit/schema";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { backupManifestSchema } from "@/lib/backup/schema";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { editingService } from "@/lib/services/editing";
import { exportService } from "@/lib/services/exports";
import { restoreService } from "@/lib/services/restore";
import { reviewService } from "@/lib/services/review";
import { timelineService, TIMELINE_P1_MISMATCH } from "@/lib/services/timeline";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { snapshotDb } from "./fixtures/backups/s4-compare";
import { S5_ZIP } from "./fixtures/backups/s5-build";

const ids=s4Ids(),now=()=>Date.parse("2026-11-16T12:00:00Z");
let root:string,committed:{s4:{sha256:string;sizeBytes:number};s5:{sha256:string;sizeBytes:number}};const handles:DatabaseHandle[]=[];
beforeAll(async()=>{committed={s4:await fileDigest(S4_ZIP),s5:await fileDigest(S5_ZIP)};});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed.s4);expect(await fileDigest(S5_ZIP)).toEqual(committed.s5);});
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-f065-")));});
afterEach(async()=>{vi.unstubAllEnvs();for(const handle of handles.splice(0))handle.close();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

async function extracted(name:string){const into=join(root,name),manifest=await readBackupManifest(S5_ZIP);await verifyBackupArchive(S5_ZIP,manifest,into);return {into,manifest,db:join(into,"data/app.db")};}
// Rewrites r1 the way the review did: guard dropped on this copy only, JSON + canonical hash changed together, the
// original guard SQL put back (sqlite_master compared before/after).
function rewriteR1(file:string,change:(timeline:Timeline)=>Timeline){
  const sqlite=new Database(file);try{
    const schemaBefore=sqlite.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
    const guard=(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='timeline_revisions_update_guard'").get() as {sql:string}).sql;
    const row=sqlite.prepare("SELECT * FROM timeline_revisions WHERE project_id=?").get(ids.main) as TimelineRow,json=canonicalJson(change(readTimelineRow(row)));
    sqlite.exec("DROP TRIGGER timeline_revisions_update_guard");sqlite.prepare("UPDATE timeline_revisions SET timeline_json=?,timeline_sha256=? WHERE id=?").run(json,timelineSha256(json),row.id);sqlite.exec(guard);
    expect(sqlite.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(schemaBefore);
    const changed=sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(row.id) as TimelineRow;expect(readTimelineRow(changed)).toBeTruthy();return {before:row,after:changed};
  }finally{sqlite.close();}
}
const reversed=(timeline:Timeline)=>({...timeline,video:[...timeline.video].reverse()});
function open(file:string){const handle=openDatabase(file,{fileMustExist:true});handles.push(handle);return handle;}
const thrown=(fn:()=>unknown)=>{try{fn();}catch(error){return error as Error&{code?:string};}throw new Error("expected a throw");};

describe("F065-1: 옮긴 r1이 출처 P1과 다르면 P1로 읽지 않는다",()=>{
  it("정상 s5 r1은 그대로 통과하고 P1 묶음·SRT 바이트도 같다",async()=>{
    const {db}=await extracted("ok"),handle=open(db);expect(()=>checkTimelineRows(handle.sqlite)).not.toThrow();
    const view=timelineService(handle).editView(ids.main),p1=editingService(handle).current(ids.main);expect({id:view.id,value:view.value,snapshot:view.snapshot}).toEqual(p1);expect(srtText(view.value!.layers)).toContain("00:00:00,125 --> 00:00:02,500");
  });
  it.each([
    ["장면 순서만 거꾸로",reversed],
    ["순서는 같고 클립 id만 다름",(t:Timeline)=>({...t,video:t.video.map((clip,index)=>index===1?{...clip,id:"019b8b7f-0000-7000-8000-000000000001"}:clip)})],
    ["세 번째 장면을 맨 앞으로",(t:Timeline)=>({...t,video:[t.video[2],t.video[0],t.video[1]]})],
  ] as const)("%s: 해시가 맞아도 읽기·검수·내보내기 거부, 검사기 거부, DB 그대로",async(_name,change)=>{
    const {db}=await extracted("changed");rewriteR1(db,change);const handle=open(db),before=snapshotDb(handle.sqlite);
    expect(()=>checkTimelineRows(handle.sqlite)).toThrow(P1SourceMismatchError);
    expect(thrown(()=>timelineService(handle).editView(ids.main))).toMatchObject({code:"STAGE_LOCKED",message:TIMELINE_P1_MISMATCH});
    const revision=(handle.sqlite.prepare("SELECT content_revision AS r FROM projects WHERE id=?").get(ids.main) as {r:number}).r;
    expect(thrown(()=>reviewService(handle).approve(ids.main,revision)).message).toBe(TIMELINE_P1_MISMATCH);
    // Export creation behind an approved review (set on this virtual copy only) reads the same refused row.
    handle.sqlite.prepare("UPDATE stage_states SET status='approved',approved_revision=? WHERE project_id=? AND stage='review'").run(revision,ids.main);
    expect(thrown(()=>exportService(handle).request(ids.main,revision)).message).toBe(TIMELINE_P1_MISMATCH);
    handle.sqlite.prepare("UPDATE stage_states SET status='in_progress',approved_revision=NULL WHERE project_id=? AND stage='review'").run(ids.main);
    const preview=exportService(handle).list(ids.main).preview;expect(preview).toMatchObject({ready:true,editSaved:false,timelineError:TIMELINE_P1_MISMATCH});
    expect(editingService(handle).get(ids.main).savedSrt).toBeNull();
    expect(snapshotDb(handle.sqlite)).toEqual(before);
  });
  it("재현 그대로: 순서를 바꾸고 manifest까지 맞춘 백업은 복원 단계에서 거부되고 목적지가 생기지 않는다",async()=>{
    const {into,manifest,db}=await extracted("src");const {after}=rewriteR1(db,reversed);
    const next=backupManifestSchema.parse({...manifest,database:{path:manifest.database.path,...await fileDigest(db)}}),zip=join(root,"archive","changed-order.zip");mkdirSync(dirname(zip),{recursive:true});
    await writeArchive(zip,[{path:next.database.path,filename:db},...next.files.map(file=>({path:file.path,filename:join(into,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(next))}]);
    const runtime=join(root,"source");for(const path of ["data","storage","backups"])mkdirSync(join(runtime,path),{recursive:true});vi.stubEnv("DREAM_DATA_ROOT",runtime);
    const handle=openDatabase(join(runtime,"data/app.db"));handles.push(handle);migrateDatabase(handle.sqlite,{migrations:productMigrations(),now});const digest=await fileDigest(zip);
    handle.sqlite.prepare("INSERT INTO backups(id,kind,path,db_sha256,file_inventory_sha256,status,created_at) VALUES(?,?,?,?,?,?,?)").run(next.backupId,"manual",zip,next.database.sha256,next.inventorySha256,"succeeded",next.createdAt);
    handle.sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`backup.${next.backupId}.meta`,JSON.stringify({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:next.files.length+1,verifiedAt:new Date(now()).toISOString()}));
    const destination=join(root,"restored"),svc=restoreService(handle,now);
    const attempt=async()=>{const checked=await svc.inspect({backupId:next.backupId,destination});return svc.finish(checked.ticketId);};
    const error=await attempt().then(()=>null,(caught:unknown)=>caught as Error&{code?:string});expect(error).toMatchObject({code:"RESTORE_INVALID"});expect(existsSync(join(destination,"data/app.db"))).toBe(false);expect(await fileDigest(zip)).toEqual(digest);
    expect(timelineSha256(after.timeline_json)).toBe(after.timeline_sha256);
  },60000);
});
