// P2-4b (T-114) render request and job states on a copy of the fixed s5 backup upgraded with the product list (never
// real data; OS temp folder). Pre-check (every blocker), deterministic input, CAS, duplicate request, one active per
// project, and the jobs service branches: claim, retry by cause, permanent failure with the verify record, recover,
// RENDER_INTERRUPTED at the attempt limit, cancel (queued / running), no manual retry, list label and blockedBy.
import { appendFileSync, unlinkSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkRenderRows } from "@/lib/db/render-data";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { prepareRender, renderInputJson, sha256Text, type PrepareDeps } from "@/lib/render/input";
import { rendersRepository } from "@/lib/repo/renders";
import { jobsRepository } from "@/lib/repo/jobs";
import { jobsService } from "@/lib/services/jobs";
import { RenderRequestError, rendersService } from "@/lib/services/renders";
import { timelineService } from "@/lib/services/timeline";
import { S5_ZIP } from "./fixtures/backups/s5-build";
import { s4Ids } from "./fixtures/backups/s4-build";

const P=s4Ids().main,DRAFT=s4Ids().draft,EMPTY_SCENE="019b8b76-3ae0-779e-abdc-6c717d70b2c7";
let root:string,handle:DatabaseHandle,time:number;const now=()=>time;
const deps=(extra:Partial<PrepareDeps>={}):PrepareDeps=>({browser:async()=>({ok:true,version:"158.0.8127.2",path:"x",sha256:"b".repeat(64)}),source:()=>"c".repeat(64),free:async()=>1e15,...extra});
beforeEach(async()=>{
  time=Date.parse("2026-11-17T09:00:00Z");root=await realpath(await mkdtemp(join(tmpdir(),"dream-t114-jobs-")));
  await verifyBackupArchive(S5_ZIP,await readBackupManifest(S5_ZIP),join(root,"s5"));vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));
  handle=openDatabase(join(root,"s5","data/app.db"),{fileMustExist:true});migrateDatabase(handle.sqlite,{migrations:productMigrations(),now});
  // s5 scene 3 has no result (an empty slot): it is archived and the timeline saved again with the product service.
  handle.sqlite.prepare("UPDATE scenes SET archived_at=? WHERE id=?").run(new Date(time).toISOString(),EMPTY_SCENE);
  const state=timelineService(handle).state(P);const saved=state.timeline!;
  timelineService(handle).save(P,state.project.contentRevision,state.current!.id,{...saved,video:saved.video.filter(clip=>clip.sceneId!==EMPTY_SCENE)});
});
afterEach(async()=>{handle.close();vi.unstubAllEnvs();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});
const project=()=>jobsRepository(handle).project(P)!;
const body=()=>({revision:project().contentRevision,timelineId:project().currentTimelineRevId!});
const thrown=async(fn:()=>unknown)=>{try{await fn();}catch(error){return error as RenderRequestError;}throw new Error("expected a throw");};
const mediaFiles=()=>handle.sqlite.prepare("SELECT a.file_path AS path FROM timeline_revisions t, json_each(t.timeline_json,'$.video') v JOIN assets a ON a.id=json_extract(v.value,'$.assetId') WHERE t.id=? ORDER BY a.id").all(project().currentTimelineRevId) as {path:string}[];

describe("시작 전 확인·입력 묶음 (T-101 2.2)",()=>{
  it("저장된 타임라인의 장면 파일·글꼴·도구를 해시로 고정하고 두 번 만들어도 같은 입력이다",async()=>{
    const first=await prepareRender(handle,P,deps()),second=await prepareRender(handle,P,deps());
    expect(first.blockers).toEqual([]);expect(first.input).not.toBeNull();
    expect(renderInputJson(first.input!)).toBe(renderInputJson(second.input!));
    const input=first.input!;expect(input.media.length).toBeGreaterThan(0);expect(input.sample).toBe(true);
    expect(input.output).toEqual({codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",fps:30,width:1080,height:1920,audio:"none"});
    expect(input.fonts.map(font=>font.relPath)).toEqual(["PretendardVariable.woff2"]);
    expect(input.durationInFrames).toBe(Math.max(input.videoFrames,...input.timeline.text.map(text=>text.timing.endFrame)));
    expect(renderInputJson(input)).not.toMatch(/[A-Za-z]:[\\/]/);expect(renderInputJson(input)).not.toContain(root);
  });
  it("이유를 모두 모은다: 파일 없음·바뀜·글꼴·브라우저·공간·선택 바뀜",async()=>{
    const files=mediaFiles();expect(files.length).toBeGreaterThanOrEqual(2);
    unlinkSync(join(root,"s5","storage",files[0].path));appendFileSync(join(root,"s5","storage",files[1].path),"x");
    const scene=(handle.sqlite.prepare("SELECT id FROM scenes WHERE project_id=? AND selected_version_id IS NOT NULL ORDER BY id DESC").get(P) as {id:string});
    handle.sqlite.prepare("UPDATE scenes SET selected_version_id=NULL WHERE id=?").run(scene.id);
    const result=await prepareRender(handle,P,deps({browser:async()=>({ok:false,reason:"mismatch",version:"158.0.8127.2"}),free:async()=>1000,fonts:()=>[{family:"Pretendard",installed:false,file:null,weights:[],reason:"파일 없음"} as never]}));
    expect(result.input).toBeNull();
    const codes=result.blockers.map(item=>item.code==="RENDER_INPUT_MISSING"?`${item.code}:${item.params.reason}`:item.code);
    expect(codes).toEqual(expect.arrayContaining(["RENDER_INPUT_MISSING:file_missing","RENDER_INPUT_MISSING:file_changed","FONT_MISSING","TIMELINE_STALE","RENDER_BROWSER_MISSING","DISK_FULL"]));
    expect(result.blockers.filter(item=>item.code==="DISK_FULL").map(item=>item.params)).toEqual([expect.objectContaining({where:"storage",freeBytes:1000})]);
    expect(result.blockers.find(item=>item.code==="RENDER_BROWSER_MISSING")!.params).toEqual({reason:"mismatch",version:"158.0.8127.2"});
    const font=result.blockers.find(item=>item.code==="FONT_MISSING")!;expect(font.params).toMatchObject({family:"Pretendard",reason:"파일 없음"});
    expect(JSON.stringify(result.blockers)).not.toMatch(/[A-Za-z]:[\\/]|storage\//);
  });
  it("다른 창 기준 요청은 CAS로 막고, 저장된 타임라인이 없거나 빈 자리가 있으면 RENDER_INPUT_MISSING이다",async()=>{
    const locked=await thrown(()=>rendersService(handle,now).request(DRAFT,{revision:1,timelineId:v7()},deps()));expect(locked.code).toBe("CONFLICT");
    handle.sqlite.prepare("UPDATE scenes SET archived_at=NULL WHERE id=?").run(EMPTY_SCENE);
    const state=timelineService(handle).state(P);timelineService(handle).save(P,state.project.contentRevision,state.current!.id,{...state.timeline!,video:[...state.timeline!.video,{...state.timeline!.video[0],id:v7(),sceneId:EMPTY_SCENE,sceneVersionId:null,assetId:null}]});
    expect((await prepareRender(handle,P,deps())).blockers).toEqual([expect.objectContaining({code:"RENDER_INPUT_MISSING",params:expect.objectContaining({reason:"empty_slot",sceneId:EMPTY_SCENE,sceneNumber:3,sceneTitle:"장면 3"})})]);
    handle.sqlite.prepare("UPDATE projects SET current_timeline_rev_id=NULL WHERE id=?").run(P);
    const result=await prepareRender(handle,P,deps());expect(result.blockers).toEqual([{code:"RENDER_INPUT_MISSING",params:{reason:"no_timeline"}}]);
  });
});

describe("요청·CAS·중복 (T-101 2.9)",()=>{
  it("화면의 revision·timelineId가 다르면 409 CONFLICT이고 아무것도 만들지 않는다",async()=>{
    const service=rendersService(handle,now);
    expect((await thrown(()=>service.request(P,{...body(),revision:body().revision+1},deps()))).code).toBe("CONFLICT");
    expect((await thrown(()=>service.request(P,{...body(),timelineId:v7()},deps()))).status).toBe(409);
    expect((await thrown(()=>service.request(P,{revision:"1"},deps()))).name).toBe("ZodError");
    expect(rendersRepository(handle).list(P)).toEqual([]);
  });
  it("작업을 먼저 넣고 행을 만들며, 같은 입력이면 진행 중인 것을 돌려주고 다른 입력은 RENDER_ACTIVE다",async()=>{
    const service=rendersService(handle,now),first=await service.request(P,body(),deps());
    expect(first).toEqual({renderId:expect.any(String),jobId:expect.any(String),existing:false});
    const row=rendersRepository(handle).row(first.renderId)!,job=jobsRepository(handle).job(first.jobId)!;
    expect(row).toMatchObject({status:"queued",nameSeq:1,isSample:true,jobId:first.jobId});expect(row.inputSha256).toBe(sha256Text(row.inputJson));
    expect(row.displayName).toMatch(/_9x16_r\d+_SAMPLE\.mp4$/);
    expect(job).toMatchObject({kind:"render",refType:"render",refId:first.renderId,provider:"local",maxAttempts:3,status:"queued",idempotencyKey:`render:${P}:${row.inputSha256}:1`});
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
    expect(await service.request(P,body(),deps())).toEqual({...first,existing:true});
    const busy=await thrown(()=>service.request(P,body(),deps({source:()=>"d".repeat(64)})));
    expect(busy.code).toBe("RENDER_ACTIVE");expect(busy.blockers).toEqual([{code:"RENDER_ACTIVE",params:{renderId:first.renderId}}]);
    const list=await service.list(P,{deps:deps()});
    expect(list.check?.blockers).toEqual([{code:"RENDER_ACTIVE",params:{renderId:first.renderId}}]);
    expect(list.renders[0]).toMatchObject({id:first.renderId,status:"queued",stage:null,progress:null,attempt:0,maxAttempts:3,waiting:{reason:"worker_off"},stale:false,isSample:true,fileName:row.displayName,fileExists:false,width:1080,height:1920,fps:30,verify:null,subtitleMeasure:null,phonePlayback:null,textOnlyChange:null,etaSec:null,error:null});
  });
});

describe("작업 상태 (T-101 2.7)",()=>{
  // s5 holds earlier sample jobs (queued/running, one of an old kind): they are closed so the render is the next job.
  beforeEach(()=>{handle.sqlite.prepare("UPDATE jobs SET status='canceled',finished_at=?,lease_until=NULL WHERE status IN ('queued','running')").run(new Date(time).toISOString());});
  async function queued(){const result=await rendersService(handle,now).request(P,body(),deps());return result;}
  const renderRow=(id:string)=>rendersRepository(handle).row(id)!;
  it("claim은 행을 running·prepare로 두고, 원인별로 재시도하며 영구 실패는 확인 기록과 함께 끝난다",async()=>{
    const {renderId,jobId}=await queued(),jobs=jobsService(handle,now);
    const claimed=jobs.claim()!;expect(claimed.id).toBe(jobId);expect(renderRow(renderId)).toMatchObject({status:"running",stage:"prepare",progressPermille:0});
    expect(renderRow(renderId).startedAt).not.toBeNull();
    jobs.fail(jobId,1,"RENDER_BROWSER_CRASHED","멈췄어요.",{retryable:true});
    expect(jobsRepository(handle).job(jobId)).toMatchObject({status:"queued",errorCode:"RENDER_BROWSER_CRASHED"});expect(renderRow(renderId)).toMatchObject({status:"queued",stage:null,finishedAt:null});
    const waiting=(await rendersService(handle,now).list(P,{check:false})).renders[0];expect(waiting.waiting).toEqual({reason:"worker_off"});
    jobs.heartbeatWorker();expect((await rendersService(handle,now).list(P,{check:false})).renders[0].waiting).toMatchObject({reason:"retry_scheduled"});
    time+=10*60000;expect(jobs.claim()!.attempts).toBe(2);
    const verify=JSON.stringify({result:"failed",items:[{item:"frames",expected:900,actual:899,pass:false}],probe:{audioStreams:0}});
    jobs.fail(jobId,2,"RENDER_VERIFY_FAILED","확인 실패",{retryable:false,verifyJson:verify});
    expect(renderRow(renderId)).toMatchObject({status:"failed",errorCode:"RENDER_VERIFY_FAILED",verifyJson:verify,filePath:null});
    expect(jobsRepository(handle).job(jobId)!.status).toBe("failed");
    const view=(await rendersService(handle,now).list(P,{check:false})).renders[0];
    expect(view.verify?.items[0]).toEqual({item:"frames",expected:900,actual:899,pass:false});expect(view.error).toEqual({code:"RENDER_VERIFY_FAILED",retryable:false,attempts:2,maxAttempts:3});
    expect(jobs.list().jobs.find(item=>item.id===jobId)).toMatchObject({kind:"render",sceneTitle:"영상 만들기",retryable:false});
    expect(()=>jobs.retry(jobId)).toThrow(/다시 만들기/);expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  });
  it("lease가 끝나면 다시 대기하고, 시도 한도에 닿으면 RENDER_INTERRUPTED로 끝난다",async()=>{
    const {renderId,jobId}=await queued(),jobs=jobsService(handle,now);
    for(let attempt=1;attempt<=3;attempt++){expect(jobs.claim()!.attempts).toBe(attempt);time+=61000;jobs.recover();if(attempt<3)expect(renderRow(renderId).status).toBe("queued");}
    expect(jobsRepository(handle).job(jobId)).toMatchObject({status:"failed",errorCode:"RENDER_INTERRUPTED"});
    expect(renderRow(renderId)).toMatchObject({status:"failed",errorCode:"RENDER_INTERRUPTED"});expect(renderRow(renderId).finishedAt).not.toBeNull();
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  });
  it("대기 중 취소는 바로 끝나고, 진행 중 취소는 처리기가 끝내며, 다른 작업은 렌더 뒤에서 기다린다",async()=>{
    const first=await queued(),jobs=jobsService(handle,now);jobs.cancel(first.jobId);
    expect(renderRow(first.renderId)).toMatchObject({status:"canceled",errorCode:"RENDER_CANCELED",canceledLate:false});
    const second=await queued();expect(second.existing).toBe(false);expect(renderRow(second.renderId).nameSeq).toBe(2);expect(renderRow(second.renderId).displayName).toMatch(/-2\.mp4$/);
    jobs.claim();const other=v7();
    jobsRepository(handle).insert({id:other,kind:"export",inputSnapshotJson:"{}",status:"queued",projectId:P,refType:"export",refId:v7(),provider:"local",idempotencyKey:`t114:${other}`,nextRunAt:new Date(time).toISOString()});
    expect(jobs.list().jobs.find(item=>item.id===other)?.blockedBy).toBe("render");
    jobs.cancel(second.jobId);expect(renderRow(second.renderId).status).toBe("running");expect(jobsRepository(handle).job(second.jobId)!.cancelRequestedAt).not.toBeNull();
    jobs.canceled(second.jobId,1);expect(renderRow(second.renderId)).toMatchObject({status:"canceled",errorCode:"RENDER_CANCELED"});
    expect((await rendersService(handle,now).list(P,{check:false})).renders.find(item=>item.id===second.renderId)?.cancelRequested).toBe(true);
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  });
});
