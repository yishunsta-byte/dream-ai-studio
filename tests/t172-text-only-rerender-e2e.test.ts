// T-172 real renders with sound AND burned-in subtitles on a copy of the fixed s9 backup (stage 9, synthetic sounds,
// 2 scenes × 2 s = 120 frames), restored into an OS temp folder and upgraded 9→10 there; s9.zip itself is only read.
// request → runNextJob → owned child (Remotion + pinned browser → lib/audio mix + AAC + mux) → app checks → publish.
// Checked: a text-only save renders a new file flagged textOnlyChange, while every earlier MP4, scene result, scene
// selection, generation record and sound source keeps its bytes and rows; a sound change is never text-only.
// Runs only with DREAM_RENDER_E2E=1 and the pinned browser. Nothing is listened to (measurements only).
// T172_SAMPLE_OUT=<absolute new .mp4 path> keeps a copy of the subtitle+AAC render for a manual phone check
// (never overwrites; the expected subtitle frames go to the same name + ".json").
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { journal, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkRenderRows } from "@/lib/db/render-data";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { newTextLayer } from "@/lib/edit/text-ops";
import { runNextJob } from "@/lib/jobs/runner";
import { descendants } from "@/lib/render/run";
import { checkBrowser } from "@/lib/render/tools";
import type { VerifyResult } from "@/lib/render/verify";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository } from "@/lib/repo/renders";
import { rendersService } from "@/lib/services/renders";
import { timelineService } from "@/lib/services/timeline";
import { S9_RECORD, S9_ZIP } from "./fixtures/backups/s9-build";
import { readS9 } from "./fixtures/backups/s9-compare";

const enabled=process.env.DREAM_RENDER_E2E==="1";
const ids=readS9(S9_RECORD).ids,P=ids.project;
// Two subtitles inside the 120 frames, not on frame boundaries of the scene change (60).
const CUES=[{content:"[가상] 첫 번째 자막",startFrame:15,endFrame:55},{content:"[가상] 두 번째 자막",startFrame:70,endFrame:110}];
let root:string,handle:DatabaseHandle,storage:string;const started=Date.now();
const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
const walk=(dir:string):string[]=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]):[];
const inventory=()=>new Map(walk(storage).filter(file=>!relative(storage,file).replaceAll("\\","/").startsWith("tmp/")).map(file=>[relative(storage,file).replaceAll("\\","/"),sha(file)]));
const tmpRenders=()=>existsSync(join(storage,"tmp"))?readdirSync(join(storage,"tmp")).filter(name=>name.startsWith("render-")):[];
const project=()=>jobsRepository(handle).project(P)!;
const row=(id:string)=>rendersRepository(handle).row(id)!;
const verifyOf=(id:string)=>JSON.parse(row(id).verifyJson!) as VerifyResult;
const view=(id:string)=>rendersService(handle).list(P,{check:false}).then(list=>list.renders.find(item=>item.id===id)!);
// Rows a render must never touch: scene results and their selection, generation records, sources, non-render jobs.
const all=(sql:string)=>JSON.stringify(handle.sqlite.prepare(sql).all());
const fixedRows=()=>({scenes:all("SELECT * FROM scenes ORDER BY id"),versions:all("SELECT * FROM scene_versions ORDER BY id"),
  assets:all("SELECT * FROM assets ORDER BY id"),generations:all("SELECT * FROM generations ORDER BY id"),jobs:all("SELECT * FROM jobs WHERE kind<>'render' ORDER BY id")});
function currentTimeline(){return JSON.parse((handle.sqlite.prepare("SELECT t.timeline_json AS json FROM timeline_revisions t JOIN projects p ON p.current_timeline_rev_id=t.id WHERE p.id=?").get(P) as {json:string}).json);}
function save(change:(value:ReturnType<typeof currentTimeline>)=>unknown){const service=timelineService(handle),state=service.state(P);return service.save(P,state.project.contentRevision,state.current!.id,change(currentTimeline()) as never);}
async function renderOnce(){const p=project(),{renderId}=await rendersService(handle).request(P,{revision:p.contentRevision,timelineId:p.currentTimelineRevId!});
  const flagged=(await view(renderId)).textOnlyChange;await runNextJob(handle);
  expect(row(renderId).status,JSON.stringify({...row(renderId),inputJson:undefined})).toBe("succeeded");return {renderId,flagged};}
// Render-related processes started by this test process that are still alive.
async function leftovers(){
  if(process.platform!=="win32")return [];
  const tree=new Set(await descendants(process.pid,started));if(!tree.size)return [];
  const out=execFileSync("powershell.exe",["-NoProfile","-Command","Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome-headless-shell.exe','remotion.exe','ffmpeg.exe','ffprobe.exe') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*child.ts*') } | ForEach-Object { \"$($_.ProcessId) $($_.Name)\" }"],{encoding:"utf8",windowsHide:true});
  return out.split(/\r?\n/).filter(Boolean).map(line=>line.split(" ")).filter(([pid])=>tree.has(Number(pid))).map(([,name])=>name);
}

describe.skipIf(!enabled)("T-172 s9 사본: 소리+자막 렌더 → 글자만 바꿔 다시 렌더",()=>{
  let before:Map<string,string>,rows:ReturnType<typeof fixedRows>,first:{renderId:string;flagged:boolean|null},firstSha:string;
  beforeAll(async()=>{
    expect((await checkBrowser({fresh:true})).ok).toBe(true);
    root=await realpath(await mkdtemp(join(tmpdir(),"dream-t172-e2e-")));const folder=join(root,"rt");storage=join(folder,"storage");
    await verifyBackupArchive(S9_ZIP,await readBackupManifest(S9_ZIP),folder);mkdirSync(join(folder,"backups"),{recursive:true});
    const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");expect(journal(sqlite)!.map(item=>item.version)).toEqual([1,2,3,4,5,6,7,8,9]);migrateDatabase(sqlite,{migrations:productMigrations()});}finally{sqlite.close();}
    vi.stubEnv("DREAM_DATA_ROOT",folder);handle=openDatabase(join(folder,"data/app.db"),{fileMustExist:true});
    // the s9 backup was taken while its own backup job ran; nothing else may be claimed before these renders
    handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status IN ('running','queued')").run();
    before=inventory();rows=fixedRows();
  },180000);
  afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});

  it("자막 2개를 더한 v2(목소리+음악) 9:16: 성공·AAC·120프레임, 이전 MP4·장면·소리 원본 그대로",async()=>{
    const saved=currentTimeline();expect(saved).toMatchObject({schemaVersion:2,aspect:"9:16"});expect(saved.audio).toHaveLength(2);expect(saved.text).toEqual([]);
    save(value=>({...value,text:CUES.map(cue=>{const layer=newTextLayer("subtitle",{startFrame:cue.startFrame,videoFrames:120,plannedFrames:120,content:cue.content});return {...layer,timing:{startFrame:cue.startFrame,endFrame:cue.endFrame}};})}));
    first=await renderOnce();const verify=verifyOf(first.renderId),items=Object.fromEntries(verify.items.map(item=>[item.item,item]));
    expect(verify.result,JSON.stringify(verify.items.filter(item=>!item.pass))).toBe("passed");
    expect(items.frames).toMatchObject({actual:120,pass:true});expect(items.audioStreams).toMatchObject({expected:1,actual:1});expect(items.audioCodec.actual).toBe("aac");
    firstSha=sha(join(storage,row(first.renderId).filePath!));expect(row(first.renderId).sha256).toBe(firstSha);
    // the s9 B render (same scenes and sound, no text) is the previous success: adding subtitles is itself text-only
    expect(first.flagged).toBe(true);
    for(const [path,hash] of before)expect(sha(join(storage,path)),path).toBe(hash);expect(fixedRows()).toEqual(rows);
  },600000);

  it("글자만 바꿔 저장 → 다시 렌더: textOnlyChange·새 이름·새 파일, 앞 MP4(s9 A·B·첫 렌더)·장면 결과·선택·생성 기록·소리 원본 그대로",async()=>{
    const firstName=(await view(first.renderId)).fileName;
    save(value=>({...value,text:value.text.map((layer:{content:string},index:number)=>index===0?{...layer,content:`${layer.content} (수정)`}:layer)}));
    const second=await renderOnce(),item=await view(second.renderId),file=join(storage,row(second.renderId).filePath!);
    expect(second.flagged).toBe(true);expect(item.textOnlyChange).toBe(true);expect(item.stale).toBe(false);expect((await view(first.renderId)).stale).toBe(true);
    expect(item.fileName).not.toBe(firstName);expect(item.fileName).toMatch(/_9x16_r\d+_SAMPLE\.mp4$/);
    const secondSha=sha(file);expect(secondSha).not.toBe(firstSha);expect(sha(join(storage,row(first.renderId).filePath!))).toBe(firstSha);
    for(const [path,hash] of before)expect(sha(join(storage,path)),path).toBe(hash);expect(fixedRows()).toEqual(rows);
    // the two renders pin the same scene media and sound sources; only the text differs
    const a=JSON.parse(row(first.renderId).inputJson),b=JSON.parse(row(second.renderId).inputJson);
    expect(b.media).toEqual(a.media);expect(b.timeline.video).toEqual(a.timeline.video);expect(b.timeline.audio).toEqual(a.timeline.audio);expect(b.audioPlan).toEqual(a.audioPlan);expect(b.timeline.text).not.toEqual(a.timeline.text);
    const out=process.env.T172_SAMPLE_OUT;
    if(out){if(!isAbsolute(out)||!out.endsWith(".mp4"))throw new Error("T172_SAMPLE_OUT must be an absolute .mp4 path");copyFileSync(file,out,constants.COPYFILE_EXCL);expect(sha(out)).toBe(secondSha);
      writeFileSync(`${out}.json`,JSON.stringify({renderId:second.renderId,fileName:item.fileName,sha256:secondSha,sizeBytes:row(second.renderId).sizeBytes,fps:30,frames:120,
        cues:b.timeline.text.map((layer:{content:string;timing:{startFrame:number;endFrame:number};animation:unknown})=>({content:layer.content,startFrame:layer.timing.startFrame,endFrame:layer.timing.endFrame,startSec:layer.timing.startFrame/30,endSec:layer.timing.endFrame/30,animation:layer.animation}))},null,1),{flag:"wx"});}
  },600000);

  it("소리만 바꾸면(목소리 -4→-6dB) 글자만 바뀐 것이 아니다(요청 때·렌더 뒤 모두 false), 원본 소리 파일 그대로",async()=>{
    save(value=>({...value,audio:value.audio.map((clip:{role:string;gainDb:number})=>clip.role==="voice"?{...clip,gainDb:-6}:clip)}));
    const third=await renderOnce();expect(third.flagged).toBe(false);expect((await view(third.renderId)).textOnlyChange).toBe(false);
    for(const [path,hash] of before)expect(sha(join(storage,path)),path).toBe(hash);expect(fixedRows()).toEqual(rows);
    for(const id of [ids.voice,ids.music]){const asset=handle.sqlite.prepare("SELECT file_path,sha256 FROM assets WHERE id=?").get(id) as {file_path:string;sha256:string};expect(sha(join(storage,asset.file_path))).toBe(asset.sha256);}
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  },600000);

  it("정리: 렌더 임시 폴더·렌더 프로세스가 남지 않는다",async()=>{
    expect(tmpRenders()).toEqual([]);expect(await leftovers()).toEqual([]);
  });
});
