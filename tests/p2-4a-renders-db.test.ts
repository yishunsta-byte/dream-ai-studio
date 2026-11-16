// P2-4a (T-105, T-109): renders rules on a copy of the fixed s5 backup upgraded with the product list (0006 + 0007),
// the exact prefix registration, the renders repository, the backup file references and the stored-row check.
// T-109: linked job identity (F107-1), NULL-free file fields (F107-2), saved timeline binding (F107-3), and 0007
// stopping with the cause (nothing applied) when a row written under 0006 breaks the new rules.
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { compareMigrations, journal, LATER_SQL_STEPS, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkRenderRows, renderInputSha256 } from "@/lib/db/render-data";
import { rendersRepository } from "@/lib/repo/renders";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { S5_RECORD, S5_ZIP } from "./fixtures/backups/s5-build";
import { s4Ids } from "./fixtures/backups/s4-build";

let root:string,handle:DatabaseHandle;
const now=()=>Date.parse("2026-11-16T10:00:00Z"),stamp=new Date(now()).toISOString();
const P=s4Ids().main,OTHER=s4Ids().draft;
type Rev={id:string;revision:number;content_revision:number;timeline_sha256:string};
let timeline:Rev;
async function s5Copy(steps:number){
  root=await realpath(await mkdtemp(join(tmpdir(),"dream-0007-")));const manifest=await readBackupManifest(S5_ZIP);await verifyBackupArchive(S5_ZIP,manifest,join(root,"s5"));
  handle=openDatabase(join(root,"s5","data/app.db"),{fileMustExist:true});migrateDatabase(handle.sqlite,{migrations:productMigrations().slice(0,steps),now});
  timeline=handle.sqlite.prepare("SELECT id,revision,content_revision,timeline_sha256 FROM timeline_revisions WHERE project_id=?").get(P) as Rev;
}
afterEach(async()=>{handle.close();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});

let counter=0;
const id=(n:number)=>`019b9000-0000-7000-8000-${String(n).padStart(12,"0")}`;
function input(project=P,rev:Rev=timeline,extra:Record<string,unknown>={}){return JSON.stringify({contentRevision:rev.content_revision,projectId:project,schemaVersion:1,timelineRevId:rev.id,timelineRevision:rev.revision,timelineSha256:rev.timeline_sha256,...extra});}
function job(renderId:string,extra:Record<string,unknown>={}){const jobId=id(++counter+500);const row={id:jobId,kind:"render",payload_version:1,input_snapshot_json:"{}",status:"queued",project_id:P,ref_type:"render",ref_id:renderId,provider:"local",idempotency_key:`render:test:${jobId}`,created_at:stamp,updated_at:stamp,...extra};const keys=Object.keys(row);handle.sqlite.prepare(`INSERT INTO jobs (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));return jobId;}
function render(extra:Record<string,unknown>={},jobExtra:Record<string,unknown>={}){
  const renderId=(extra.id as string)??id(++counter);const json=(extra.input_json as string)??input();
  const row={id:renderId,project_id:P,job_id:job(renderId,jobExtra),timeline_rev_id:timeline.id,timeline_revision:timeline.revision,content_revision:timeline.content_revision,input_json:json,input_sha256:renderInputSha256(json),status:"queued",frames_total:900,display_name:"가상_9x16_r1.mp4",name_seq:counter,is_sample:1,created_at:stamp,...extra};
  const keys=Object.keys(row);handle.sqlite.prepare(`INSERT INTO renders (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));return renderId;
}
const set=(renderId:string,values:Record<string,unknown>)=>handle.sqlite.prepare(`UPDATE renders SET ${Object.keys(values).map(key=>`${key}=?`).join(",")} WHERE id=?`).run(...Object.values(values),renderId);
const setJob=(jobId:string,values:Record<string,unknown>)=>handle.sqlite.prepare(`UPDATE jobs SET ${Object.keys(values).map(key=>`${key}=?`).join(",")} WHERE id=?`).run(...Object.values(values),jobId);
const jobOf=(renderId:string)=>(handle.sqlite.prepare("SELECT job_id FROM renders WHERE id=?").get(renderId) as {job_id:string}).job_id;
const file=(renderId:string)=>({file_path:`projects/${P}/renders/${renderId}.mp4`,sha256:"a".repeat(64),size_bytes:1000,verify_json:"{\"result\":\"passed\"}"});
const succeed=(renderId:string)=>{set(renderId,{status:"running",started_at:stamp});set(renderId,{status:"succeeded",finished_at:stamp,...file(renderId)});};
const rejected=/CHECK|incomplete/;

describe("등록 (정확한 앞부분)",()=>{
  beforeEach(()=>s5Copy(7));
  it("제품 목록은 1~5(0005 코드 해시 그대로) 뒤에 0006·0007 SQL이고, s5·0006 기록은 그 앞부분이라 upgrade다",()=>{
    const list=productMigrations(),s5=JSON.parse(readFileSync(S5_RECORD,"utf8")) as {migrations:{version:number;name:string;sha256:string}[]};
    expect(list.map(step=>step.version)).toEqual([1,2,3,4,5,6,7,8,9]);expect(LATER_SQL_STEPS).toEqual([{version:6,name:"0006_renders.sql"},{version:7,name:"0007_render_guards.sql"},{version:8,name:"0008_timeline_audio.sql"},{version:9,name:"0009_render_audio.sql"}]);
    expect(list.slice(0,5).map(({version,name,sha256})=>({version,name,sha256}))).toEqual(s5.migrations);
    for(const step of list.slice(5)){const text=readFileSync(join(process.cwd(),"lib/db/migrations",step.name),"utf8").replace(/\r\n/g,"\n");expect(step.sha256).toBe(createHash("sha256").update(text).digest("hex"));}
    // 0006 as issued by T-105 (normalized source digest recorded by T-107) is unchanged.
    expect(list[5].sha256).toBe("0bedf2afb9db707b255917707a364ed6a30f35b8d97dfb660485e2e7aea0d19e");expect(list[6].verify).toBeTypeOf("function");
    const plainList=list.map(({version,name,sha256})=>({version,name,sha256}));
    expect(compareMigrations(s5.migrations,list)).toBe("upgrade");expect(compareMigrations(plainList.slice(0,6),list)).toBe("upgrade");expect(compareMigrations(plainList,list.slice(0,6))).toBe("too_new");
    expect(compareMigrations([...plainList.slice(0,5),plainList[6]],list)).toBe("mismatch");
    expect(migrateDatabase(handle.sqlite,{migrations:list.slice(0,7),now})).toBe(0);expect(migrateDatabase(handle.sqlite,{migrations:list,now})).toBe(2);
  });
});

describe("renders 표 규칙 (0006+0007)",()=>{
  beforeEach(()=>s5Copy(7));
  it("작업 계약(kind·ref·같은 프로젝트)과 같은 프로젝트의 저장된 타임라인만 받는다",()=>{
    expect(render()).toBeTruthy();
    for(const bad of [{kind:"export"},{ref_type:"export"},{project_id:OTHER}])expect(()=>render({},bad)).toThrow(/render job differs/);
    expect(()=>render({timeline_revision:2,input_json:input(P,{...timeline,revision:2})})).toThrow(/render timeline differs/);
    expect(()=>render({project_id:OTHER,input_json:input(OTHER)},{project_id:OTHER})).toThrow(/render timeline differs/);
  });
  it("F107-1: 렌더가 가리키는 작업의 kind·ref_type·ref_id·project_id는 바뀌지 않고, 상태·진행·취소·끝 필드는 바뀐다",()=>{
    const done=render({name_seq:1});succeed(done);const running=render({name_seq:2});
    for(const renderId of [done,running]){const jobId=jobOf(renderId);
      for(const change of [{kind:"export"},{ref_type:"export"},{ref_id:id(9999)},{project_id:OTHER},{project_id:null}])expect(()=>setJob(jobId,change)).toThrow(/identity is immutable/);
      expect(()=>setJob(jobId,{kind:"render",ref_type:"render",ref_id:renderId,project_id:P})).not.toThrow();}
    const jobId=jobOf(running);
    setJob(jobId,{status:"running",attempts:1,lease_until:stamp,heartbeat_at:stamp,updated_at:stamp});setJob(jobId,{cancel_requested_at:stamp});
    setJob(jobId,{status:"canceled",error_code:"RENDER_CANCELED",finished_at:stamp,lease_until:null});
    // A job no render points to yet (inserted first, as the contract says) is not locked.
    const lone=job(id(9000));expect(()=>setJob(lone,{ref_id:id(9001)})).not.toThrow();
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
    // Restore normalization on a product connection still cancels queued/running jobs.
    expect(()=>handle.sqlite.prepare("UPDATE jobs SET status='canceled',error_code='RESTORED_NOT_RESUMED',lease_until=NULL,finished_at=?,updated_at=? WHERE status IN ('queued','running')").run(stamp,stamp)).not.toThrow();
  });
  it("F107-2: 파일 칸 셋은 모두 비었거나 모두 있어야 한다 (NULL 틈 없음), 정상 성공·취소 뒤 끝남은 된다",()=>{
    const a=render({name_seq:1});set(a,{status:"running",started_at:stamp});
    for(const partial of [{sha256:null},{size_bytes:null},{verify_json:null}])expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a),...partial})).toThrow(rejected);
    expect(()=>set(a,{status:"succeeded",finished_at:stamp,sha256:"a".repeat(64),size_bytes:1,verify_json:"{}"})).toThrow(rejected);
    for(const partial of [{sha256:"a".repeat(64)},{size_bytes:5},{sha256:"a".repeat(64),size_bytes:5}])expect(()=>set(a,partial)).toThrow(rejected);
    expect(()=>set(a,{status:"canceled",canceled_late:1,finished_at:stamp,error_code:"RENDER_CANCELED",...file(a),sha256:null})).toThrow(rejected);
    for(const bad of [{sha256:"A".repeat(64)},{sha256:"a".repeat(63)},{size_bytes:0}])expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a),...bad})).toThrow(rejected);
    set(a,{status:"succeeded",finished_at:stamp,...file(a)});
    const late=render({name_seq:2});set(late,{status:"running",started_at:stamp});set(late,{status:"canceled",canceled_late:1,finished_at:stamp,error_code:"RENDER_CANCELED",...file(late)});
    expect(()=>render({name_seq:3,...file(id(1)),id:id(1)})).toThrow(/starts queued|incomplete/);
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
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
    expect(()=>set(a,{status:"succeeded",finished_at:stamp})).toThrow(rejected);
    expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a),file_path:`projects/${P}/renders/other.mp4`})).toThrow(rejected);
    expect(()=>set(a,{status:"succeeded",finished_at:stamp,...file(a),verify_json:null})).toThrow(rejected);
    expect(()=>set(a,{frames_done:901})).toThrow(/CHECK/);expect(()=>set(a,{file_path:file(a).file_path,sha256:"a".repeat(64),size_bytes:1,verify_json:"{}"})).toThrow(rejected);
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
});

describe("저장된 행 검사 (F107-3) — 트리거를 거치지 않은 행도 의미로 다시 읽는다",()=>{
  beforeEach(()=>s5Copy(7));
  // Rows changed with every guard trigger dropped, the way a repacked backup could hold them.
  function forge(renderId:string,change:()=>void){const saved=handle.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND (tbl_name='renders' OR name='render_job_identity_guard')").all() as {sql:string}[];
    handle.sqlite.exec(saved.map(row=>`DROP TRIGGER ${/CREATE TRIGGER (\w+)/.exec(row.sql)![1]};`).join(""));handle.sqlite.pragma("ignore_check_constraints = ON");
    try{change();}finally{handle.sqlite.pragma("ignore_check_constraints = OFF");for(const row of saved)handle.sqlite.exec(row.sql);}void renderId;}
  it("정상 행은 통과하고, 위조된 타임라인 묶음·작업·파일 칸은 이유와 함께 거부한다",()=>{
    const a=render({name_seq:1});succeed(a);expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
    const cases:[string,()=>void,RegExp][]=[
      ["타임라인 번호 999 (입력·해시까지 맞춤)",()=>{const json=input(P,{...timeline,revision:999});set(a,{timeline_revision:999,input_json:json,input_sha256:renderInputSha256(json)});},/saved timeline binding differs/],
      ["내용 버전 다름 (입력·해시까지 맞춤)",()=>{const json=input(P,{...timeline,content_revision:timeline.content_revision+1});set(a,{content_revision:timeline.content_revision+1,input_json:json,input_sha256:renderInputSha256(json)});},/saved timeline binding differs/],
      ["입력의 타임라인 해시 다름",()=>{const json=input(P,timeline,{timelineSha256:"e".repeat(64)});set(a,{input_json:json,input_sha256:renderInputSha256(json)});},/timeline hash differs/],
      ["입력 해시 다름",()=>set(a,{input_sha256:"c".repeat(64)}),/input differs from its hash/],
      ["작업 kind 바뀜",()=>setJob(jobOf(a),{kind:"export"}),/job differs/],
      ["작업 프로젝트 바뀜",()=>setJob(jobOf(a),{project_id:OTHER}),/job differs/],
      ["성공인데 sha256 없음",()=>set(a,{sha256:null}),/file fields are incomplete|success without/],
      ["경로만 있음",()=>set(a,{sha256:null,size_bytes:null}),/file fields are incomplete|success without/],
    ];
    for(const [label,change,reason] of cases){
      handle.sqlite.exec("SAVEPOINT forge");forge(a,change);
      expect(()=>checkRenderRows(handle.sqlite),label).toThrow(reason);
      handle.sqlite.exec("ROLLBACK TO forge; RELEASE forge");
    }
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  });
});

describe("0007 이관: 0006 아래 쓰인 잘못된 행은 원인을 밝히고 아무것도 적용하지 않는다",()=>{
  beforeEach(()=>s5Copy(6));
  it("0006 CHECK를 통과한 NULL sha256 성공 행 → 0007 실패, 기록·행 그대로",()=>{
    const a=render({name_seq:1});set(a,{status:"running",started_at:stamp});
    set(a,{status:"succeeded",finished_at:stamp,file_path:`projects/${P}/renders/${a}.mp4`,sha256:null,size_bytes:1,verify_json:"{}"}); // F107-2 as reproduced under 0006
    const before=JSON.stringify(handle.sqlite.prepare("SELECT * FROM renders").all()),triggers=handle.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get();
    expect(()=>migrateDatabase(handle.sqlite,{migrations:productMigrations().slice(0,7),now})).toThrow(new RegExp(`Render row ${a}: (file fields are incomplete|success without a verified file)`));
    expect(journal(handle.sqlite)!.map(row=>row.version)).toEqual([1,2,3,4,5,6]);expect(JSON.stringify(handle.sqlite.prepare("SELECT * FROM renders").all())).toBe(before);
    expect(handle.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get()).toEqual(triggers);
  });
  it("0006에서 작업 계약이 깨진 행(작업 kind 변경) → 0007 실패 / 정상 행만 있으면 0007 적용 후 검사 통과",()=>{
    const a=render({name_seq:1});setJob(jobOf(a),{kind:"export"}); // F107-1 as reproduced under 0006
    expect(()=>migrateDatabase(handle.sqlite,{migrations:productMigrations().slice(0,7),now})).toThrow(new RegExp(`Render row ${a}: job differs`));
    expect(journal(handle.sqlite)!.map(row=>row.version)).toEqual([1,2,3,4,5,6]);
    setJob(jobOf(a),{kind:"render"});expect(migrateDatabase(handle.sqlite,{migrations:productMigrations().slice(0,7),now})).toBe(1);
    expect(journal(handle.sqlite)!.at(-1)?.name).toBe("0007_render_guards.sql");expect(()=>setJob(jobOf(a),{kind:"export"})).toThrow(/identity is immutable/);
  });
});
