// P2-4b (T-114) real renders through the worker path on a copy of the fixed s5 backup (virtual data, OS temp folder):
// request → runNextJob → owned child (Remotion + pinned browser) → app ffprobe → publish → download route.
// Runs only with DREAM_RENDER_E2E=1 and the pinned browser installed (scripts/remotion/install-browser.ps1); the s5
// required disclosure stays 0–900 frames (it cannot be changed), so each render is 30 s of video; about 7 full renders. Checked: success for 9:16·16:9·1:1, earlier files and
// the fixture's other stored bytes unchanged, text-only change, stale edit, input changed, verify failure (forced),
// cancel during compose, render child crash → retry, lease recover, late cancel kept but not served, Range download,
// stale temp folder cleanup, and no render process left behind.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const control=vi.hoisted(()=>({failVerify:false,onVerified:null as null|(()=>void)}));
vi.mock("@/lib/render/verify",async original=>{const real=await original<typeof import("@/lib/render/verify")>();
  return {...real,verifyRender:async(...args:Parameters<typeof real.verifyRender>)=>{const result=await real.verifyRender(...args);control.onVerified?.();
    return control.failVerify?{...result,result:"failed" as const,items:result.items.map(item=>item.item==="frames"?{...item,expected:Number(item.actual)+1,pass:false}:item)}:result;}};});
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkRenderRows, renderFileReferences } from "@/lib/db/render-data";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { runNextJob } from "@/lib/jobs/runner";
import { cleanStaleRenderTemps } from "@/lib/jobs/render";
import { descendants } from "@/lib/render/run";
import { verifyRender as realVerify } from "@/lib/render/verify";
import { checkBrowser } from "@/lib/render/tools";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository } from "@/lib/repo/renders";
import { jobsService } from "@/lib/services/jobs";
import { rendersService } from "@/lib/services/renders";
import { timelineService } from "@/lib/services/timeline";
import { GET as fileRoute } from "@/app/api/renders/[id]/file/route";
import { S5_ZIP } from "./fixtures/backups/s5-build";
import { s4Ids } from "./fixtures/backups/s4-build";

const enabled=process.env.DREAM_RENDER_E2E==="1";
const P=s4Ids().main,EMPTY_SCENE="019b8b76-3ae0-779e-abdc-6c717d70b2c7";
let root:string,handle:DatabaseHandle,storage:string,osTempBefore:Set<string>;const started=Date.now();
// Browser profiles and Remotion frame folders in the OS temp folder (the render child's TEMP points into its work folder).
const osTemp=()=>new Set(readdirSync(tmpdir()).filter(name=>/^(puppeteer_dev_chrome_profile|react-motion-render)/.test(name)));
const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
const walk=(dir:string):string[]=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]):[];
const inventory=()=>new Map(walk(storage).filter(file=>!relative(storage,file).replaceAll("\\","/").startsWith("tmp/")).map(file=>[relative(storage,file).replaceAll("\\","/"),sha(file)]));
const service=()=>rendersService(handle);
const project=()=>jobsRepository(handle).project(P)!;
const body=()=>({revision:project().contentRevision,timelineId:project().currentTimelineRevId!});
const row=(id:string)=>rendersRepository(handle).row(id)!;
// A short timeline (two 30-frame scenes, texts inside 60 frames) saved through the product service.
function saveShort(aspect:"9:16"|"16:9"|"1:1"="9:16",textEdit=""){
  const state=timelineService(handle).state(P),saved=state.timeline!;
  if(aspect!==saved.aspect)handle.sqlite.prepare("UPDATE projects SET aspect=? WHERE id=?").run(aspect,P);
  const fresh=timelineService(handle).state(P);
  const video=saved.video.filter(clip=>clip.sceneId!==EMPTY_SCENE).map(clip=>{const now=fresh.clips.find(item=>item.sceneId===clip.sceneId)!;return {...clip,...now,id:clip.id};});
  const text=saved.text.map((item,index)=>index===1?{...item,content:`${item.content.trim()}${textEdit}`,animation:{...item.animation,in:"fade" as const,durationFrames:8}}:item);
  return timelineService(handle).save(P,fresh.project.contentRevision,fresh.current!.id,{...saved,aspect,video,text});
}
async function renderOnce(expectStatus="succeeded"){const {renderId,jobId}=await service().request(P,body());await runNextJob(handle);expect(row(renderId).status,JSON.stringify(row(renderId))).toBe(expectStatus);return {renderId,jobId};}
async function renderChildren(){
  if(process.platform!=="win32")return [];
  const out=execFileSync("powershell.exe",["-NoProfile","-Command",`Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*child.ts*' } | Select-Object -ExpandProperty ProcessId`],{encoding:"utf8",windowsHide:true});
  return out.split(/\r?\n/).filter(Boolean).map(Number);
}
// Render processes (render child, browser, compositor) started by this test process that are still alive. The
// process-table query itself (PowerShell) and vitest helpers are not counted.
async function renderTree(){
  if(process.platform!=="win32")return [];
  const tree=new Set(await descendants(process.pid,started));if(!tree.size)return [];
  const out=execFileSync("powershell.exe",["-NoProfile","-Command","Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome-headless-shell.exe','remotion.exe') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*child.ts*') } | ForEach-Object { \"$($_.ProcessId) $($_.Name)\" }"],{encoding:"utf8",windowsHide:true});
  return out.split(/\r?\n/).filter(Boolean).map(line=>line.split(" ")).filter(([pid])=>tree.has(Number(pid))).map(([,name])=>name);
}
const until=async(test:()=>boolean,ms=120000)=>{const end=Date.now()+ms;while(!test()){if(Date.now()>end)throw new Error("timed out");await new Promise(resolve=>setTimeout(resolve,200));}};

describe.skipIf(!enabled)("실제 렌더 e2e (가상 s5)",()=>{
  beforeAll(async()=>{
    expect((await checkBrowser({fresh:true})).ok).toBe(true);osTempBefore=osTemp();
    root=await realpath(await mkdtemp(join(tmpdir(),"dream-t114-e2e-")));await verifyBackupArchive(S5_ZIP,await readBackupManifest(S5_ZIP),join(root,"s5"));
    vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));storage=join(root,"s5","storage");
    handle=openDatabase(join(root,"s5","data/app.db"),{fileMustExist:true});migrateDatabase(handle.sqlite,{migrations:productMigrations(),now:Date.now});
    handle.sqlite.prepare("UPDATE jobs SET status='canceled',finished_at=?,lease_until=NULL WHERE status IN ('queued','running')").run(new Date().toISOString());
    handle.sqlite.prepare("UPDATE scenes SET archived_at=? WHERE id=?").run(new Date().toISOString(),EMPTY_SCENE);
    // short scenes (virtual data): the clip length follows the scene length, so the saved timeline stays current
    handle.sqlite.prepare("UPDATE scenes SET duration_sec=1 WHERE project_id=? AND archived_at IS NULL").run(P);
    saveShort();
  },120000);
  afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});
  // a test that stopped early must not leave its queued render blocking the next one (one active per project)
  beforeEach(()=>{control.failVerify=false;control.onVerified=null;const active=rendersRepository(handle).active(P);if(active)jobsService(handle).cancel(active.jobId);});

  let first:{renderId:string;jobId:string},firstSha:string,before:Map<string,string>;
  it("9:16 렌더가 확인을 통과하고 게시되며 다른 저장 파일은 바이트가 그대로다",async()=>{
    before=inventory();first=await renderOnce();const value=row(first.renderId);
    expect(value).toMatchObject({stage:"verify",progressPermille:1000,framesDone:900,canceledLate:false,errorCode:null,filePath:`projects/${P}/renders/${first.renderId}.mp4`});
    const file=join(storage,value.filePath!);firstSha=sha(file);expect(value.sha256).toBe(firstSha);expect(statSync(file).size).toBe(value.sizeBytes);
    const probe=await realVerify(file,{width:1080,height:1920,fps:30,frames:900});expect(probe.result,JSON.stringify(probe.items.filter(item=>!item.pass))).toBe("passed");
    const after=inventory();for(const [path,hash] of before)expect(after.get(path),path).toBe(hash);expect(after.size).toBe(before.size+1);
    expect(walk(join(storage,"tmp")).filter(path=>/render-/.test(path))).toEqual([]);
    const view=(await service().list(P,{check:false})).renders[0];
    expect(view).toMatchObject({status:"succeeded",fileExists:true,codec:"h264",audioStreams:0,width:1080,height:1920,durationSec:30,stale:false,attempt:1,etaSec:null});
    expect(view.verify?.result).toBe("passed");expect(renderFileReferences(handle.sqlite).map(item=>item.filePath)).toContain(value.filePath);
    expect(await renderTree()).toEqual([]);
  },600000);

  it("받기는 전체·Range·이름·헤더를 지키고, 통과한 파일만 준다",async()=>{
    const params=Promise.resolve({id:first.renderId}),value=row(first.renderId);
    const full=await fileRoute(new Request(`http://127.0.0.1/api/renders/${first.renderId}/file?download`),{params});
    expect(full.status).toBe(200);expect(createHash("sha256").update(Buffer.from(await full.arrayBuffer())).digest("hex")).toBe(firstSha);
    expect(full.headers.get("content-disposition")).toBe(`attachment; filename="render.mp4"; filename*=UTF-8''${encodeURIComponent(value.displayName).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");expect(full.headers.get("cache-control")).toBe("private, no-store");expect(full.headers.get("content-type")).toBe("video/mp4");
    const part=await fileRoute(new Request(`http://127.0.0.1/api/renders/${first.renderId}/file`,{headers:{range:"bytes=10-109"}}),{params:Promise.resolve({id:first.renderId})});
    expect(part.status).toBe(206);expect(part.headers.get("content-range")).toBe(`bytes 10-109/${value.sizeBytes}`);expect(Buffer.from(await part.arrayBuffer()).equals(readFileSync(join(storage,value.filePath!)).subarray(10,110))).toBe(true);
    expect((await fileRoute(new Request("http://127.0.0.1/x",{headers:{range:"bytes=999999999-"}}),{params:Promise.resolve({id:first.renderId})})).status).toBe(416);
    expect((await fileRoute(new Request("http://127.0.0.1/x"),{params:Promise.resolve({id:"not-a-uuid"})})).status).toBe(404);
  },60000);

  it("요청 뒤 편집해도 고정 입력대로 만들고 stale이며, 글자만 바꾼 다음 요청은 textOnlyChange·새 이름이고, 장면 파일이 바뀌면 재시도 없이 RENDER_INPUT_CHANGED다",async()=>{
    const fixed=await service().request(P,body());saveShort("9:16"," 수정");await runNextJob(handle);
    expect(row(fixed.renderId).status).toBe("succeeded");expect(sha(join(storage,row(first.renderId).filePath!))).toBe(firstSha);
    const next=await service().request(P,body());
    const list=(await service().list(P,{check:false})).renders,view=list.find(item=>item.id===next.renderId)!,old=list.find(item=>item.id===fixed.renderId)!;
    expect(old.stale).toBe(true);expect(view.stale).toBe(false);expect(view.textOnlyChange).toBe(true);expect(view.fileName).not.toBe(old.fileName);expect(view.fileName).toMatch(/_9x16_r\d+_SAMPLE\.mp4$/);
    const input=JSON.parse(row(next.renderId).inputJson) as {media:{relPath:string}[]};
    const target=join(storage,input.media[0].relPath),original=readFileSync(target);appendFileSync(target,"x");
    try{await runNextJob(handle);}finally{writeFileSync(target,original);}
    expect(row(next.renderId)).toMatchObject({status:"failed",errorCode:"RENDER_INPUT_CHANGED",filePath:null});expect(jobsRepository(handle).job(next.jobId)!.attempts).toBe(1);
  },600000);

  it("16:9·1:1도 크기대로 렌더되고 확인을 통과한다",async()=>{
    for(const [aspect,width,height] of [["16:9",1920,1080],["1:1",1080,1080]] as const){
      saveShort(aspect);const {renderId}=await renderOnce();const value=row(renderId);
      const probe=await realVerify(join(storage,value.filePath!),{width,height,fps:30,frames:900});expect(probe.result,aspect).toBe("passed");
      expect(value.displayName).toContain(`_${aspect.replace(":","x")}_`);
    }
    saveShort("9:16");
  },900000);

  it("확인 실패는 파일을 게시하지 않고 항목별 기록만 남긴다",async()=>{
    control.failVerify=true;const before=inventory();const {renderId,jobId}=await renderOnce("failed");
    const value=row(renderId);expect(value).toMatchObject({errorCode:"RENDER_VERIFY_FAILED",filePath:null,sha256:null});expect(jobsRepository(handle).job(jobId)!.attempts).toBe(1);
    const verify=JSON.parse(value.verifyJson!) as {result:string;items:{item:string;pass:boolean}[]};expect(verify.result).toBe("failed");expect(verify.items.filter(item=>!item.pass).map(item=>item.item)).toEqual(["frames"]);
    expect(inventory()).toEqual(before);expect(walk(join(storage,"tmp")).filter(path=>/render-/.test(path))).toEqual([]);
    expect((await fileRoute(new Request("http://127.0.0.1/x"),{params:Promise.resolve({id:renderId})})).status).toBe(404);
  },600000);

  it("확인을 통과한 뒤 취소가 오면 canceled_late로 보관하되 받기·선택 대상이 아니다",async()=>{
    const {renderId,jobId}=await service().request(P,body());control.onVerified=()=>{jobsService(handle).cancel(jobId);};
    await runNextJob(handle);const value=row(renderId);
    expect(value).toMatchObject({status:"canceled",canceledLate:true,errorCode:"RENDER_CANCELED"});expect(value.filePath).not.toBeNull();expect(sha(join(storage,value.filePath!))).toBe(value.sha256);
    expect((await fileRoute(new Request("http://127.0.0.1/x"),{params:Promise.resolve({id:renderId})})).status).toBe(404);
    expect(renderFileReferences(handle.sqlite).map(item=>item.filePath)).toContain(value.filePath);
    expect((await service().list(P,{check:false})).renders.find(item=>item.id===renderId)).toMatchObject({canceledLate:true,error:null});
  },600000);

  it("합치는 중 취소하면 파일 없이 끝나고 임시 폴더·자식 프로세스가 남지 않는다",async()=>{
    const {renderId,jobId}=await service().request(P,body()),running=runNextJob(handle);
    await until(()=>row(renderId).stage==="compose");jobsService(handle).cancel(jobId);await running;
    expect(row(renderId)).toMatchObject({status:"canceled",canceledLate:false,filePath:null,errorCode:"RENDER_CANCELED"});
    expect(walk(join(storage,"tmp")).filter(path=>/render-/.test(path))).toEqual([]);expect(await renderChildren()).toEqual([]);
    expect(await renderTree()).toEqual([]);
  },600000);

  it("렌더 자식이 죽으면 RENDER_BROWSER_CRASHED로 다시 대기하고, 처리기가 멈춘 뒤 lease가 끝나면 회수해 처음부터 다시 만들며, 남은 임시 폴더는 시작 시 정리한다",async()=>{
    const {renderId,jobId}=await service().request(P,body()),running=runNextJob(handle);
    await until(()=>row(renderId).stage==="compose");const children=await renderChildren();expect(children.length).toBe(1);
    execFileSync("taskkill",["/PID",String(children[0]),"/F"],{windowsHide:true});await running;
    expect(row(renderId)).toMatchObject({status:"queued",stage:null});expect(jobsRepository(handle).job(jobId)).toMatchObject({status:"queued",errorCode:"RENDER_BROWSER_CRASHED",attempts:1});
    expect(await renderTree()).toEqual([]);expect(walk(join(storage,"tmp")).filter(path=>/render-/.test(path))).toEqual([]);
    // worker stopped right after claiming attempt 2 (no heartbeat): its folder is left and its lease runs out
    handle.sqlite.prepare("UPDATE jobs SET next_run_at=? WHERE id=?").run(new Date().toISOString(),jobId);
    expect(jobsService(handle).claim()!.attempts).toBe(2);expect(row(renderId).status).toBe("running");
    const stale=join(storage,"tmp",`render-${renderId}-2`);mkdirSync(stale,{recursive:true});writeFileSync(join(stale,"part.mp4"),"x");
    handle.sqlite.prepare("UPDATE jobs SET lease_until=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),jobId);
    expect(await cleanStaleRenderTemps(handle)).toEqual([]);expect(existsSync(stale)).toBe(false);
    await runNextJob(handle);expect(row(renderId).status).toBe("succeeded");expect(jobsRepository(handle).job(jobId)!.attempts).toBe(3);
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();expect(sha(join(storage,row(first.renderId).filePath!))).toBe(firstSha);
    expect(await renderTree()).toEqual([]);
  },600000);
  it("모든 렌더(성공·취소·충돌·회수) 뒤 OS 임시 폴더에 새 브라우저 프로필·프레임 폴더가 없다",()=>{
    expect([...osTemp()].filter(name=>!osTempBefore.has(name))).toEqual([]);expect(walk(join(storage,"tmp")).filter(path=>/render-/.test(path))).toEqual([]);
  });
});
