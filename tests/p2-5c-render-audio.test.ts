// T-137 P2-5C render ↔ sound connection, without a real render: envelope A bytes unchanged, envelope B built by the
// request check (mode none / mix, every blocker at once), the 0009 insert guard and row check, the old app's refusal
// of a 0009 database, the verify items, the error mapping and the screen values. Every database is a copy of the
// fixed s5 backup in an OS temp folder (virtual data); sound files are synthetic.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import type { DatabaseHandle } from "@/lib/db/connection";
import { compareMigrations, journal, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkRenderRows, renderEnvelope, renderRowReasons } from "@/lib/db/render-data";
import { canonicalJson } from "@/lib/edit/timeline";
import { prepareRender, renderInputJson, renderInputSchema, renderInputSilentSchema, sha256Text, type PrepareDeps } from "@/lib/render/input";
import { audioFailureCode, RENDER_MESSAGES } from "@/lib/render/errors";
import { judge } from "@/lib/render/verify";
import { rendersRepository } from "@/lib/repo/renders";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersService } from "@/lib/services/renders";
import { blockerLines, failureCopy, verifyReasons } from "@/components/render-panel/copy";
import { addSound, clip, P, s5Copy, saveTimeline } from "./p2-5c-helpers";

let root:string,handle:DatabaseHandle,storage:string;
const jobsProject=()=>jobsRepository(handle).project(P)!;
const tools={ffmpeg:"9.0.2-essentials_build-www.gyan.dev",ffmpegSha256:"a".repeat(64),ffprobeSha256:"d".repeat(64)};
const deps=(extra:Partial<PrepareDeps>={}):PrepareDeps=>({browser:async()=>({ok:true,version:"158.0.8127.2",path:"x",sha256:"b".repeat(64)}),source:()=>"c".repeat(64),free:async()=>1e15,audioTools:async()=>tools,...extra});
let storedRows:Record<string,unknown>[]=[],promoted:Record<string,unknown>[]=[];
beforeAll(async()=>{
  root=await realpath(await mkdtemp(join(tmpdir(),"dream-t137-unit-")));vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));
  // a database at 0008 (the app before this step) with an envelope A render row written by the request service
  ({handle,storage}=await s5Copy(join(root,"s5"),productMigrations().slice(0,8)));
  saveTimeline(handle,null);const before=await rendersService(handle).request(P,{revision:jobsProject().contentRevision,timelineId:jobsProject().currentTimelineRevId},deps());
  storedRows=handle.sqlite.prepare("SELECT * FROM renders ORDER BY id").all() as typeof storedRows;
  expect(migrateDatabase(handle.sqlite,{migrations:productMigrations(),now:Date.now})).toBe(2);
  promoted=handle.sqlite.prepare("SELECT * FROM renders ORDER BY id").all() as typeof promoted;
  rendersService(handle).cancel(before.renderId);
},120000);
afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});

describe("봉투 A(기존 무음) 그대로",()=>{
  it("0008에서 쓴 봉투 A 렌더 행은 0009 승격 뒤에도 바이트·해시 그대로이고, 다시 정규화해도 같은 텍스트이며 행 검사를 통과한다",()=>{
    expect(storedRows.length).toBe(1);expect(promoted).toEqual(storedRows);
    for(const row of storedRows as {input_json:string;input_sha256:string}[]){
      expect(sha256Text(row.input_json)).toBe(row.input_sha256);
      const parsed=renderInputSchema.parse(JSON.parse(row.input_json));expect("audioPlan" in parsed).toBe(false);
      expect(renderInputJson(parsed)).toBe(row.input_json);expect(canonicalJson(renderInputSilentSchema.parse(parsed))).toBe(row.input_json);
    }
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
    expect(journal(handle.sqlite)!.map(step=>step.version)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  });
  it("v1 타임라인 요청은 봉투 A(audioPlan 없음, output.audio none)이고, 0008까지만 아는 앱은 이 DB를 too_new로 거부한다",async()=>{
    saveTimeline(handle,null);const prepared=await prepareRender(handle,P,deps());
    expect(prepared.blockers).toEqual([]);expect(prepared.input).not.toBeNull();expect("audioPlan" in prepared.input!).toBe(false);expect(prepared.input!.output.audio).toBe("none");
    expect(renderInputSilentSchema.safeParse(prepared.input).success).toBe(true);
    expect(compareMigrations(journal(handle.sqlite)!,productMigrations().slice(0,8))).toBe("too_new");
  });
});

describe("봉투 B 준비 검사",()=>{
  let music:{id:string;file:string},voice:{id:string;file:string};
  beforeAll(()=>{music=addSound(handle,storage,"음악","anoisesrc=d=20:c=pink:r=48000:a=0.2:seed=7");voice=addSound(handle,storage,"목소리","sine=f=220:d=12:sample_rate=44100","wav",["-ac","1"]);});
  it("v2 + 소리 없음 → mode none(무음 출력), v2 + 소리 → mix(소스 정렬·중복 없음·도구 고정·출력 aac), 요청 행은 0009 트리거·행 검사를 통과",async()=>{
    saveTimeline(handle,{audio:[]});let prepared=await prepareRender(handle,P,deps());
    expect(prepared.blockers).toEqual([]);expect(prepared.input).toMatchObject({output:{audio:"none"},audioPlan:{schemaVersion:1,mode:"none"},timeline:{schemaVersion:2}});
    saveTimeline(handle,{audio:[clip(music.id,{durationFrames:600,duckUnderVoice:true}),clip(voice.id,{role:"voice",startFrame:60,durationFrames:300}),clip(music.id,{role:"effect",startFrame:700,sourceInFrame:30,durationFrames:30})]});
    prepared=await prepareRender(handle,P,deps());expect(prepared.blockers).toEqual([]);
    const input=prepared.input!;if(!("audioPlan" in input)||input.audioPlan.mode!=="mix")throw new Error("expected mix");
    expect(input.output.audio).toBe("aac");expect(input.audioPlan).toMatchObject({profile:"p2-5-local-v1",outputFrames:900,tools});
    expect(input.audioPlan.sources.map(source=>source.assetId)).toEqual([music.id,voice.id].sort());
    expect(input.audioPlan.sources.find(source=>source.assetId===voice.id)).toMatchObject({relPath:`library/${voice.id}.wav`,durationMs:12000,isMock:false});
    const request=await rendersService(handle).request(P,{revision:prepared.project.contentRevision,timelineId:prepared.row!.id},deps());
    const row=rendersRepository(handle).row(request.renderId)!;expect(JSON.parse(row.inputJson)).toEqual(JSON.parse(renderInputJson(input)));
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
    const view=(await rendersService(handle).list(P,{check:false})).renders.find(item=>item.id===request.renderId)!;
    expect(view).toMatchObject({audioMode:"aac",progress:null,audio:{status:null,accepted:null,clips:3,hasMusic:true,profile:"p2-5-local-v1",ffmpeg:tools.ffmpeg,target:{integrated:-14,tolerance:1,truePeakMax:-1}}});
    rendersService(handle).cancel(request.renderId);
  });
  it("막는 이유를 모두 모은다: 파일 변경·삭제·구간 초과·도구 없음(요청 단계에서 작업 생성 안 함)",async()=>{
    const changed=addSound(handle,storage,"바뀔 곡","sine=f=330:d=10"),gone=addSound(handle,storage,"지울 곡","sine=f=440:d=10"),short=addSound(handle,storage,"짧은 곡","sine=f=550:d=10");
    const saved=saveTimeline(handle,{audio:[clip(changed.id,{durationFrames:90}),clip(gone.id,{role:"effect",startFrame:100,durationFrames:30}),clip(short.id,{role:"voice",startFrame:200,durationFrames:290})]});
    const keep=readFileSync(changed.file);writeFileSync(changed.file,Buffer.concat([keep,Buffer.from("x")]));rmSync(gone.file);
    handle.sqlite.prepare("UPDATE assets SET duration_ms=9000 WHERE id=?").run(short.id);// 9 s = 270 frames < 290
    try{
      const prepared=await prepareRender(handle,P,deps({audioTools:async()=>null}));expect(prepared.input).toBeNull();
      const audio=prepared.blockers.filter(item=>item.code.startsWith("AUDIO_"));
      expect(audio).toEqual(expect.arrayContaining([
        {code:"AUDIO_SOURCE_MISSING",params:{reason:"file_changed",clipId:expect.any(String),assetId:changed.id}},
        {code:"AUDIO_SOURCE_MISSING",params:{reason:"file_missing",clipId:expect.any(String),assetId:gone.id}},
        {code:"AUDIO_SOURCE_MISSING",params:{reason:"range",clipId:expect.any(String),assetId:short.id}},
        {code:"AUDIO_TOOL_MISSING",params:{}}]));
      expect(audio).toHaveLength(4);
      const before=handle.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get() as {n:number};
      await expect(rendersService(handle).request(P,{revision:saved.revision,timelineId:saved.timelineId},deps({audioTools:async()=>null}))).rejects.toMatchObject({code:"AUDIO_SOURCE_MISSING",status:409});
      expect(handle.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual(before);
      const lines=blockerLines(prepared.blockers).filter(line=>line.code?.startsWith("AUDIO_"));expect(lines).toHaveLength(4);expect(lines.every(line=>line.text.length>0)).toBe(true);
    }finally{writeFileSync(changed.file,keep);}
  });
});

describe("0009 기록 규칙",()=>{
  const sql=readFileSync(join(process.cwd(),"lib/db/migrations/0009_render_audio.sql"),"utf8");
  const v2={schemaVersion:2,audio:[{assetId:"x"}]},v2none={schemaVersion:2,audio:[]};
  it("트리거: 봉투 A(소리 판단 없음)·B none·B mix만 들어가고, 어긋난 봉투는 거절한다",()=>{
    const sqlite=new Database(":memory:");sqlite.exec("CREATE TABLE renders(input_json TEXT)");sqlite.exec(sql);
    const insert=(value:unknown)=>sqlite.prepare("INSERT INTO renders(input_json) VALUES(?)").run(JSON.stringify(value));
    const mix={schemaVersion:1,mode:"mix",profile:"p2-5-local-v1",sources:[{assetId:"x"}]};
    for(const good of [{schemaVersion:1},{timeline:{schemaVersion:1,audio:[]},output:{audio:"none"}},{timeline:v2none,output:{audio:"none"},audioPlan:{schemaVersion:1,mode:"none"}},{timeline:v2,output:{audio:"aac"},audioPlan:mix}])
      expect(()=>insert(good),JSON.stringify(good)).not.toThrow();
    for(const bad of [{timeline:v2none,output:{audio:"none"}},{timeline:{schemaVersion:1,audio:[]},output:{audio:"aac"}},{timeline:v2,output:{audio:"none"},audioPlan:mix},{timeline:v2none,output:{audio:"aac"},audioPlan:mix},
      {timeline:v2,output:{audio:"none"},audioPlan:{schemaVersion:1,mode:"none"}},{timeline:v2,output:{audio:"aac"},audioPlan:{...mix,profile:"other"}},{timeline:v2,output:{audio:"aac"},audioPlan:{...mix,sources:[]}},
      {timeline:{schemaVersion:1,audio:[]},output:{audio:"none"},audioPlan:{schemaVersion:1,mode:"none"}},{timeline:v2,output:{audio:"aac"},audioPlan:{...mix,schemaVersion:2}},{timeline:v2,output:{audio:"aac"},audioPlan:"mix"}])
      expect(()=>insert(bad),JSON.stringify(bad)).toThrow(/render input envelope differs/);
    sqlite.close();
  });
  it("행 검사 사유는 기존 문장 뒤에만 붙고, 봉투 판정은 이유를 고정 문장으로 준다",()=>{
    expect(renderRowReasons.slice(-3)).toEqual(["input envelope is not known","input audio plan differs from its timeline","audio verify record differs"]);
    expect(renderRowReasons.indexOf("more than one render in progress")).toBe(16);
    expect(renderEnvelope({schemaVersion:1})).toEqual({kind:"A"});
    expect(renderEnvelope({timeline:{schemaVersion:2},output:{audio:"none"}})).toBe("input envelope is not known");
    expect(renderEnvelope({output:{audio:"aac"}})).toBe("input envelope is not known");
    expect(renderEnvelope({timeline:{schemaVersion:2},output:{audio:"aac"},audioPlan:{schemaVersion:1,mode:"none"}})).toBe("input envelope is not known");
    const stored=rendersRepository(handle).list(P).find(row=>{const value=JSON.parse(row.inputJson) as {audioPlan?:{mode:string}};return value.audioPlan?.mode==="mix";})!;
    const record=JSON.parse(stored.inputJson) as Record<string,unknown>&{audioPlan:{outputFrames:number;sources:unknown[]}};
    expect(renderEnvelope(record)).toEqual({kind:"B",mode:"mix"});
    expect(renderEnvelope({...record,durationInFrames:899})).toBe("input audio plan differs from its timeline");
    expect(renderEnvelope({...record,audioPlan:{...record.audioPlan,sources:[...record.audioPlan.sources].reverse()}})).toBe("input audio plan differs from its timeline");
    expect(renderEnvelope({...record,output:{...(record.output as object),audio:"none"}})).toBe("input audio plan differs from its timeline");
  });
});

describe("확인 항목·오류 연결·문구",()=>{
  const raw=(audio:{codec_name:string;profile:string;sample_rate:string;channels:number}[])=>({format:{format_name:"mov,mp4,m4a,3gp,3g2,mj2",duration:"30.000000"},streams:[{codec_type:"video",codec_name:"h264",pix_fmt:"yuv420p",color_range:"tv",color_space:"bt709",width:1080,height:1920,r_frame_rate:"30/1",avg_frame_rate:"30/1",nb_read_frames:"900"},...audio.map(item=>({codec_type:"audio",...item}))]});
  const expectBase={width:1080,height:1920,fps:30,frames:900};
  it("무음(기본) 항목은 P2-4와 같은 15개, aac는 소리 트랙 1개와 형식 4개를 더 본다",()=>{
    const silent=judge(raw([]),expectBase,1000);
    expect(silent.items.map(item=>item.item)).toEqual(["container","videoStreams","codec","pixelFormat","colorRange","colorSpace","width","height","frameRate","averageFrameRate","frames","durationSec","audioStreams","otherStreams","sizeBytes"]);
    expect(silent.result).toBe("passed");expect(judge(raw([]),{...expectBase,audio:"none"},1000)).toEqual(silent);
    const good=judge(raw([{codec_name:"aac",profile:"LC",sample_rate:"48000",channels:2}]),{...expectBase,audio:"aac"},1000);
    expect(good.result).toBe("passed");expect(good.items.slice(15).map(item=>item.item)).toEqual(["audioCodec","audioProfile","audioSampleRate","audioChannels"]);
    expect(judge(raw([{codec_name:"aac",profile:"LC",sample_rate:"48000",channels:2}]),expectBase,1000).result).toBe("failed");
    const bad=judge(raw([{codec_name:"aac",profile:"HE-AAC",sample_rate:"44100",channels:1}]),{...expectBase,audio:"aac"},1000);
    expect(bad.items.filter(item=>!item.pass).map(item=>item.item)).toEqual(["audioProfile","audioSampleRate","audioChannels"]);
    expect(verifyReasons(bad.items)).toEqual(["소리 형식이 기준(AAC-LC·48kHz·두 채널)과 달라요"]);
    expect(judge(raw([]),{...expectBase,audio:"aac"},1000).items.find(item=>item.item==="audioStreams")).toMatchObject({expected:1,actual:0,pass:false});
  });
  it("소리 처리 오류 코드 → 렌더 오류 코드(재시도 없음), 문구가 있다",()=>{
    const table:Record<string,string>={LOUDNESS_OUT_OF_RANGE:"AUDIO_LOUDNESS_FAILED",LOUDNESS_UNMEASURABLE:"AUDIO_LOUDNESS_FAILED",SOURCE_UNSUPPORTED:"AUDIO_SOURCE_INVALID",SOURCE_TOO_SHORT:"AUDIO_SOURCE_INVALID",
      SOURCE_CHANGED:"RENDER_INPUT_CHANGED",TOOL_CHANGED:"RENDER_INPUT_CHANGED",OUTPUT_INVALID:"RENDER_VERIFY_FAILED",VIDEO_MISMATCH:"RENDER_VERIFY_FAILED",OUTPUT_EXISTS:"STORAGE_FAILED",
      DISK_FULL:"DISK_FULL",CANCELED:"RENDER_CANCELED",TIMEOUT:"TIMEOUT",STATS_MISMATCH:"AUDIO_FAILED",TOOL_FAILED:"AUDIO_FAILED",INVALID_INPUT:"AUDIO_FAILED",SOMETHING_NEW:"AUDIO_FAILED"};
    for(const [from,to] of Object.entries(table)){expect(audioFailureCode(from),from).toBe(to);expect(RENDER_MESSAGES[to as keyof typeof RENDER_MESSAGES]).toBeTruthy();}
    const view={errorCode:"AUDIO_LOUDNESS_FAILED",error:{code:"AUDIO_LOUDNESS_FAILED",retryable:false,attempts:1,maxAttempts:3},attempt:1,errorMessage:null} as unknown as Parameters<typeof failureCopy>[0];
    expect(failureCopy(view).text).toMatch(/-14 LUFS/);
  });
});
