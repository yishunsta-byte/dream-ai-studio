// P2-4a (T-105): 0006_renders.sql rules on a copy of the fixed s5 backup upgraded with the product list, the exact
// prefix registration of 0006, the renders repository, the backup file references and the restore row check.
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { compareMigrations, LATER_SQL_STEPS, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkRenderRows, renderInputSha256 } from "@/lib/db/render-data";
import { rendersRepository } from "@/lib/repo/renders";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { S5_RECORD, S5_ZIP } from "./fixtures/backups/s5-build";
import { s4Ids } from "./fixtures/backups/s4-build";

let root:string,handle:DatabaseHandle;
const now=()=>Date.parse("2026-11-16T10:00:00Z"),stamp=new Date(now()).toISOString();
const P=s4Ids().main,OTHER=s4Ids().draft;
let timeline:{id:string;revision:number;content_revision:number};
beforeEach(async()=>{
  root=await realpath(await mkdtemp(join(tmpdir(),"dream-0006-")));const manifest=await readBackupManifest(S5_ZIP);await verifyBackupArchive(S5_ZIP,manifest,join(root,"s5"));
  handle=openDatabase(join(root,"s5","data/app.db"),{fileMustExist:true});migrateDatabase(handle.sqlite,{migrations:productMigrations(),now});
  timeline=handle.sqlite.prepare("SELECT id,revision,content_revision FROM timeline_revisions WHERE project_id=?").get(P) as typeof timeline;
});
afterEach(async()=>{handle.close();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

let counter=0;
const id=(n:number)=>`019b9000-0000-7000-8000-${String(n).padStart(12,"0")}`;
function input(project=P,rev=timeline){return JSON.stringify({contentRevision:rev.content_revision,projectId:project,schemaVersion:1,timelineRevId:rev.id,timelineRevision:rev.revision});}
function job(renderId:string,extra:Record<string,unknown>={}){const jobId=id(++counter+500);const row={id:jobId,kind:"render",payload_version:1,input_snapshot_json:"{}",status:"queued",project_id:P,ref_type:"render",ref_id:renderId,provider:"local",idempotency_key:`render:test:${jobId}`,created_at:stamp,updated_at:stamp,...extra};const keys=Object.keys(row);handle.sqlite.prepare(`INSERT INTO jobs (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));return jobId;}
function render(extra:Record<string,unknown>={},jobExtra:Record<string,unknown>={}){
  const renderId=(extra.id as string)??id(++counter);const json=(extra.input_json as string)??input();
  const row={id:renderId,project_id:P,job_id:job(renderId,jobExtra),timeline_rev_id:timeline.id,timeline_revision:timeline.revision,content_revision:timeline.content_revision,input_json:json,input_sha256:renderInputSha256(json),status:"queued",frames_total:900,display_name:"가상_9x16_r1.mp4",name_seq:counter,is_sample:1,created_at:stamp,...extra};
  const keys=Object.keys(row);handle.sqlite.prepare(`INSERT INTO renders (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));return renderId;
}
const set=(renderId:string,values:Record<string,unknown>)=>handle.sqlite.prepare(`UPDATE renders SET ${Object.keys(values).map(key=>`${key}=?`).join(",")} WHERE id=?`).run(...Object.values(values),renderId);
const file=(renderId:string)=>({file_path:`projects/${P}/renders/${renderId}.mp4`,sha256:"a".repeat(64),size_bytes:1000,verify_json:"{\"result\":\"passed\"}"});
const succeed=(renderId:string)=>{set(renderId,{status:"running",started_at:stamp});set(renderId,{status:"succeeded",finished_at:stamp,...file(renderId)});};

describe("0006 등록 (정확한 앞부분)",()=>{
  it("제품 목록은 1~5(0005 코드 해시 그대로) 뒤에 0006 SQL 하나이고, s5 기록은 그 앞부분이라 upgrade다",()=>{
    const list=productMigrations(),s5=JSON.parse(readFileSync(S5_RECORD,"utf8")) as {migrations:{version:number;name:string;sha256:string}[]};
    expect(list.map(step=>step.version)).toEqual([1,2,3,4,5,6]);expect(LATER_SQL_STEPS).toEqual([{version:6,name:"0006_renders.sql"}]);
    expect(list.slice(0,5).map(({version,name,sha256})=>({version,name,sha256}))).toEqual(s5.migrations);
    const text=readFileSync(join(process.cwd(),"lib/db/migrations/0006_renders.sql"),"utf8").replace(/\r\n/g,"\n");expect(list[5].sha256).toBe(createHash("sha256").update(text).digest("hex"));
    expect(compareMigrations(s5.migrations,list)).toBe("upgrade");expect(compareMigrations(list,list.slice(0,5))).toBe("too_new");
    expect(compareMigrations([...s5.migrations.slice(0,4),{version:5,name:list[5].name,sha256:list[5].sha256}],list)).toBe("mismatch");
    expect(migrateDatabase(handle.sqlite,{migrations:list,now})).toBe(0);
  });
});

describe("renders 표 규칙",()=>{
  it("작업 계약(kind·ref·같은 프로젝트)과 같은 프로젝트의 저장된 타임라인만 받는다",()=>{
    expect(render()).toBeTruthy();
    for(const bad of [{kind:"export"},{ref_type:"export"},{project_id:OTHER}])expect(()=>render({},bad)).toThrow(/render job differs/);
    expect(()=>{const renderId=id(++counter);const jobId=job(id(9999));handle.sqlite.prepare("INSERT INTO renders (id,project_id,job_id,timeline_rev_id,timeline_revision,content_revision,input_json,input_sha256,status,frames_total,display_name,name_seq,is_sample,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(renderId,P,jobId,timeline.id,1,timeline.content_revision,input(),renderInputSha256(input()),"queued",900,"a.mp4x",1,0,stamp);}).toThrow();
    expect(()=>render({timeline_revision:2,input_json:input(P,{...timeline,revision:2})})).toThrow(/render timeline differs/);
    expect(()=>render({project_id:OTHER,input_json:input(OTHER)},{project_id:OTHER})).toThrow(/render timeline differs/);
  });
  it("입력 기록은 행과 같은 프로젝트·타임라인이어야 하고, 시작은 queued·빈 상태다",()=>{
    expect(()=>render({input_json:JSON.stringify({schemaVersion:2})})).toThrow(/CHECK/);
    expect(()=>render({input_json:input(OTHER)})).toThrow(/CHECK/);
    expect(()=>render({input_sha256:"X".repeat(64)})).toThrow(/CHECK/);
    for(const bad of [{status:"running"},{progress_permille:5},{stage:"prepare"},{error_code:"X"}])expect(()=>render(bad)).toThrow(/starts queued/);
    for(const name of ["a/b.mp4","a:b.mp4","noext","x.mp4\\"])expect(()=>render({display_name:name})).toThrow(/CHECK/);
  });
  it("프로젝트당 진행 중 1개, 같은 타임라인 버전의 이름 번호는 겹치지 않는다",()=>{
    const first=render({name_seq:1});expect(()=>render({name_seq:2})).toThrow(/UNIQUE/);
    succeed(first);const second=render({name_seq:2});expect(()=>render({name_seq:3})).toThrow(/UNIQUE/);
    set(second,{status:"canceled",finished_at:stamp,error_code:"RENDER_CANCELED"});expect(()=>render({name_seq:2})).toThrow(/UNIQUE/);
    const repo=rendersRepository(handle);expect(repo.nextNameSeq(P,timeline.id)).toBe(3);expect(repo.active(P)).toBeUndefined();
    const third=render({name_seq:3});expect(repo.active(P)?.id).toBe(third);expect(repo.list(P).map(row=>row.nameSeq).sort()).toEqual([1,2,3]);
  });
  it("상태는 정해진 길로만 바뀌고, 성공에는 정해진 경로의 파일·확인 기록이 있어야 한다",()=>{
    const a=render({name_seq:1});expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a)})).toThrow(/not allowed/);
    set(a,{status:"running",started_at:stamp,stage:"compose",progress_permille:300,frames_done:270});
    expect(()=>set(a,{status:"succeeded",finished_at:stamp})).toThrow(/CHECK/);
    expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a),file_path:`projects/${P}/renders/other.mp4`})).toThrow(/CHECK/);
    expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a),verify_json:null})).toThrow(/CHECK/);
    expect(()=>set(a,{frames_done:901})).toThrow(/CHECK/);expect(()=>set(a,{file_path:file(a).file_path,sha256:"a".repeat(64),size_bytes:1,verify_json:"{}"})).toThrow(/CHECK/);
    expect(()=>set(a,{status:"failed",finished_at:stamp})).toThrow(/CHECK/);
    set(a,{status:"running",progress_permille:500});set(a,{status:"queued"});set(a,{status:"running"});set(a,{status:"succeeded",finished_at:stamp,...file(a)});
    expect(()=>set(a,{status:"canceled"})).toThrow();
  });
  it("취소 뒤 끝남은 canceled + 파일, 확인 실패·취소는 파일이 없다",()=>{
    const late=render({name_seq:1});set(late,{status:"running",started_at:stamp});
    expect(()=>set(late,{status:"canceled",canceled_late:1,finished_at:stamp})).toThrow(/CHECK/);
    expect(()=>set(late,{status:"failed",canceled_late:1,error_code:"X",finished_at:stamp,...file(late)})).toThrow(/CHECK/);
    set(late,{status:"canceled",canceled_late:1,finished_at:stamp,error_code:"RENDER_CANCELED",...file(late)});
    const failed=render({name_seq:2});set(failed,{status:"running",started_at:stamp});
    expect(()=>set(failed,{status:"failed",error_code:"RENDER_VERIFY_FAILED",finished_at:stamp,...file(failed)})).toThrow(/CHECK/);
    set(failed,{status:"failed",error_code:"RENDER_VERIFY_FAILED",finished_at:stamp,verify_json:"{\"result\":\"failed\"}"});
    expect(maintenanceRepository(handle).fileReferences().filter(ref=>ref.filePath?.includes("/renders/"))).toEqual([{filePath:file(late).file_path,sha256:"a".repeat(64),sizeBytes:1000}]);
  });
  it("입력은 진행 중에도 바뀌지 않고, 끝난 행은 정리 기록만 바뀌며, 어떤 행도 지울 수 없다",()=>{
    const a=render({name_seq:1});set(a,{status:"running",started_at:stamp});
    for(const change of [{input_json:input(),input_sha256:"b".repeat(64)},{display_name:"다른.mp4"},{name_seq:9},{frames_total:901},{is_sample:0},{created_at:"x"}])expect(()=>set(a,change)).toThrow(/immutable/);
    set(a,{status:"canceled",finished_at:stamp,error_code:"RENDER_CANCELED"});
    for(const change of [{error_code:"X"},{progress_permille:1},{stage:"verify"},{finished_at:"y"},{status:"running"}])expect(()=>set(a,change)).toThrow(/immutable|not allowed/);
    rendersRepository(handle).recordCleanup(a,["tmp/render-x/out.mp4"]);expect(rendersRepository(handle).row(a)?.cleanupLeftJson).toBe("[\"tmp/render-x/out.mp4\"]");
    expect(()=>set(a,{cleanup_left_json:"{}"})).toThrow(/CHECK/);
    expect(()=>handle.sqlite.prepare("DELETE FROM renders WHERE id=?").run(a)).toThrow(/never deleted/);
    const b=render({name_seq:2});expect(()=>handle.sqlite.prepare("DELETE FROM renders WHERE id=?").run(b)).toThrow(/never deleted/);
  });
  it("복원 확인: 입력 해시와 작업 계약이 맞지 않는 행을 찾는다",()=>{
    const a=render({name_seq:1});expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
    handle.sqlite.exec("DROP TRIGGER render_input_immutable");set(a,{input_sha256:"c".repeat(64)});expect(()=>checkRenderRows(handle.sqlite)).toThrow(/hash/);
    set(a,{input_sha256:renderInputSha256(input())});handle.sqlite.prepare("UPDATE jobs SET ref_id=? WHERE id=(SELECT job_id FROM renders WHERE id=?)").run(id(9998),a);expect(()=>checkRenderRows(handle.sqlite)).toThrow(/job differs/);
  });
});
