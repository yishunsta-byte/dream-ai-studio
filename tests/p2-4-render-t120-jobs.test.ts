// P2-4b (T-120) worker path fixes on a copy of the fixed s5 backup (virtual data, OS temp folder). The composition
// itself is replaced by a stand-in attempt (the real render is in p2-4-render-e2e and tmp/t120-evidence); the browser
// pin and the composition source are stubbed to the input's values, the output check passes. Checked:
// F116-2 inputs are copied while hashing into the attempt folder and served from there — a same-size replacement or
//        removal of the stored files during the render does not change what the render reads; a change to the
//        attempt copies is caught before publishing; a change before the copy stops the render (input changed);
// F116-3 the final link fails by cause: ENOSPC → DISK_FULL (final), EACCES/ENOENT → STORAGE_FAILED (final),
//        EBUSY → retried; the original errno is kept in the activity log; nothing is published.
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/render/tools",async original=>{const real=await original<typeof import("@/lib/render/tools")>();
  return {...real,checkBrowser:async()=>({ok:true,version:"158.0.8127.2",path:"x",sha256:"b".repeat(64)}),compositionSourceSha256:()=>"c".repeat(64)};});
vi.mock("@/lib/render/verify",async original=>{const real=await original<typeof import("@/lib/render/verify")>();
  return {...real,verifyRender:async()=>({result:"passed",items:[],probe:{}})};});
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import type { PrepareDeps, RenderInput } from "@/lib/render/input";
import { runClaimedRender, type RenderRunOptions } from "@/lib/jobs/render";
import type { AttemptOptions } from "@/lib/render/run";
import { rendersRepository } from "@/lib/repo/renders";
import { jobsRepository } from "@/lib/repo/jobs";
import { jobsService } from "@/lib/services/jobs";
import { rendersService } from "@/lib/services/renders";
import { timelineService } from "@/lib/services/timeline";
import { S5_ZIP } from "./fixtures/backups/s5-build";
import { s4Ids } from "./fixtures/backups/s4-build";

const P=s4Ids().main,EMPTY_SCENE="019b8b76-3ae0-779e-abdc-6c717d70b2c7";
let root:string,handle:DatabaseHandle,time:number;const now=()=>time;
const deps=():PrepareDeps=>({browser:async()=>({ok:true,version:"158.0.8127.2",path:"x",sha256:"b".repeat(64)}),source:()=>"c".repeat(64),free:async()=>1e15});
const storage=()=>join(root,"s5","storage");
beforeEach(async()=>{
  time=Date.parse("2026-11-17T09:00:00Z");root=await realpath(await mkdtemp(join(tmpdir(),"dream-t120-jobs-")));
  await verifyBackupArchive(S5_ZIP,await readBackupManifest(S5_ZIP),join(root,"s5"));vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));
  handle=openDatabase(join(root,"s5","data/app.db"),{fileMustExist:true});migrateDatabase(handle.sqlite,{migrations:productMigrations(),now});
  handle.sqlite.prepare("UPDATE scenes SET archived_at=? WHERE id=?").run(new Date(time).toISOString(),EMPTY_SCENE);
  const state=timelineService(handle).state(P);const saved=state.timeline!;
  timelineService(handle).save(P,state.project.contentRevision,state.current!.id,{...saved,video:saved.video.filter(clip=>clip.sceneId!==EMPTY_SCENE)});
});
afterEach(async()=>{handle.close();vi.unstubAllEnvs();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const project=()=>jobsRepository(handle).project(P)!;
async function claimed(){
  // the s5 copy holds other unfinished jobs (as in p2-4-render-jobs): they are closed so the render is the one claimed
  handle.sqlite.prepare("UPDATE jobs SET status='canceled',finished_at=?,lease_until=NULL WHERE status IN ('queued','running')").run(new Date(time).toISOString());
  const request=await rendersService(handle,now).request(P,{revision:project().contentRevision,timelineId:project().currentTimelineRevId!},deps());
  const job=jobsService(handle,now).claim()!;expect(job.id).toBe(request.jobId);
  const row=rendersRepository(handle).row(request.renderId)!;
  return {job:{id:job.id,attempts:job.attempts,refId:job.refId,startedAt:job.startedAt},row,input:JSON.parse(row.inputJson) as RenderInput};
}
const run=(job:Awaited<ReturnType<typeof claimed>>["job"],options:RenderRunOptions)=>runClaimedRender(handle,job,{now,pollMs:20,bundleRoot:join(root,"bundles"),...options});
const stored=(input:RenderInput)=>input.media.map(item=>join(storage(),item.relPath));
// A stand-in composition: reads every clip and font from the file server like the browser does, then writes a file.
const reader=(during:(options:AttemptOptions)=>void,seen:{index:number;sha:string}[])=>async(options:AttemptOptions)=>{
  during(options);
  for(const clip of options.props.clips){const index=Number(/\/m\/(\d+)$/.exec(clip.src)![1]);seen.push({index,sha:sha(Buffer.from(await (await fetch(clip.src)).arrayBuffer()))});}
  for(const font of options.props.fonts)expect((await fetch(font.url)).status).toBe(200);
  writeFileSync(options.output,"stand-in output");return {ok:true} as const;
};
const log=(action:string)=>(handle.sqlite.prepare("SELECT detail_json AS detail FROM activity_log WHERE action=?").all(action) as {detail:string}[]).map(row=>JSON.parse(row.detail));
const tmpLeft=()=>existsSync(join(storage(),"tmp"))?readdirSync(join(storage(),"tmp")).filter(name=>name.startsWith("render-")):[];

describe("F116-2 고정한 입력 복사본만 렌더에 간다",()=>{
  it("렌더 중 저장 파일을 같은 크기로 바꾸거나 지워도 고정 바이트로 만들고 게시한다",async()=>{
    const {job,row,input}=await claimed(),files=stored(input),seen:{index:number;sha:string}[]=[];
    const before=files.map(file=>readFileSync(file));
    await run(job,{attempt:reader(()=>{
      files.forEach((file,index)=>{const bytes=readFileSync(file);if(index===files.length-1)writeFileSync(file,Buffer.alloc(0));else writeFileSync(file,Buffer.alloc(bytes.length,0xee));});
    },seen)});
    expect(rendersRepository(handle).row(row.id)).toMatchObject({status:"succeeded"});
    expect(seen.length).toBeGreaterThan(0);for(const item of seen)expect(item.sha).toBe(input.media[item.index].sha256);
    // the stored originals were really changed (the stand-in did it), and nothing restored them
    expect(files.some((file,index)=>!readFileSync(file).equals(before[index]))).toBe(true);
    expect(tmpLeft()).toEqual([]);
  });
  it("렌더 중 시도 복사본이 바뀌면 게시 전에 멈춘다(입력 바뀜)",async()=>{
    const {job,row}=await claimed();
    await run(job,{attempt:reader(options=>{const folder=join(dirname(options.output),"inputs"),first=readdirSync(folder).find(name=>name.startsWith("m"))!;const path=join(folder,first);
      const size=readFileSync(path).length;chmodSync(path,0o666);writeFileSync(path,Buffer.alloc(size,1));},[])});
    expect(rendersRepository(handle).row(row.id)).toMatchObject({status:"failed",errorCode:"RENDER_INPUT_CHANGED",filePath:null});
    expect(existsSync(join(storage(),"projects",P,"renders",`${row.id}.mp4`))).toBe(false);
  });
  it("복사 전에 같은 크기로 바뀐 파일은 시작하지 않는다",async()=>{
    const {job,row,input}=await claimed(),file=stored(input)[0];writeFileSync(file,Buffer.alloc(readFileSync(file).length,3));let called=false;
    await run(job,{attempt:async()=>{called=true;return {ok:true};}});
    expect(called).toBe(false);expect(rendersRepository(handle).row(row.id)).toMatchObject({status:"failed",errorCode:"RENDER_INPUT_CHANGED"});
  });
});

describe("F116-3 게시 실패를 원인별로 나눈다",()=>{
  const fault=(code:string)=>()=>{throw Object.assign(new Error(`${code}: link`),{code});};
  for(const [errno,status,error,jobStatus] of [["ENOSPC","failed","DISK_FULL","failed"],["EACCES","failed","STORAGE_FAILED","failed"],["ENOENT","failed","STORAGE_FAILED","failed"],["EBUSY","queued",null,"queued"]] as const){
    it(`${errno}: ${error??"재시도"}`,async()=>{
      const {job,row}=await claimed();
      await run(job,{attempt:reader(()=>{},[]),link:fault(errno)});
      expect(rendersRepository(handle).row(row.id)).toMatchObject({status,filePath:null,...(error?{errorCode:error}:{})});
      expect(jobsRepository(handle).job(job.id)).toMatchObject({status:jobStatus,errorCode:error??"STORAGE_FAILED"});
      expect(log("render.io_error").at(-1)).toMatchObject({renderId:row.id,errno,code:error??"STORAGE_FAILED",retryable:errno==="EBUSY"});
      expect(existsSync(join(storage(),"projects",P,"renders",`${row.id}.mp4`))).toBe(false);expect(tmpLeft()).toEqual([]);
    });
  }
});
