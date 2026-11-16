// T-132 P2-5A sound storage foundation: timeline v2 (sound clips, joins, mix profile, rights per version) next to the
// unchanged v1, server checks against the library, explicit save/restore/CAS, the 0008 feature gate, usage counts,
// the music-rights review item, backup/restore and the silent-render block. Fixed backups are only read; every
// database is a copy in an OS temp folder (never real data).
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { v7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { compareMigrations, journal, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkTimelineRows, readTimelineRow, timelineSha256, type TimelineRow } from "@/lib/db/timeline-data";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { fileDigest } from "@/lib/export/zip";
import { AUDIO_MIX_PROFILE, canonicalJson, outputFrames, SAMPLES_PER_FRAME, timelineSchema, timelineV1Schema, timelineV2Schema, type Timeline, type TimelineV2 } from "@/lib/edit/timeline";
import { renderInputSilentSchema, prepareRender } from "@/lib/render/input";
import { libraryRepository } from "@/lib/repo/library";
import { menusSchema } from "@/lib/menus/schema";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { jobsRepository } from "@/lib/repo/jobs";
import { timelineRepository } from "@/lib/repo/timeline";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { editingService } from "@/lib/services/editing";
import { jobsService } from "@/lib/services/jobs";
import { restoreService } from "@/lib/services/restore";
import { reviewService } from "@/lib/services/review";
import { AUDIO_ASSET_INVALID, AUDIO_RANGE_INVALID, AUDIO_V1_UNSUPPORTED, timelineService } from "@/lib/services/timeline";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";

const ids=s4Ids(),now=()=>Date.parse("2026-11-17T09:00:00Z");
let root:string,committed:{sha256:string;sizeBytes:number};const handles:DatabaseHandle[]=[];
beforeAll(async()=>{committed=await fileDigest(S4_ZIP);});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed);});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-p25a-")));});
afterEach(()=>{vi.unstubAllEnvs();for(const handle of handles.splice(0))handle.close();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});

// ── pure schema ──────────────────────────────────────────────────────────────────────────────────────────────────
const u=(n:number)=>`019b9132-0000-7000-8000-${String(n).padStart(12,"0")}`;
const clip=(n:number,over:Partial<TimelineV2["audio"][number]>={})=>({id:u(100+n),assetId:u(200+n),role:"music" as const,startFrame:0,sourceInFrame:0,durationFrames:60,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false,...over});
const rights=(assetId:string,over:Partial<TimelineV2["audioRights"][number]>={})=>({assetId,sourceUrl:null,planName:null,createdOn:null,licenseNote:null,...over});
function v2(audio:TimelineV2["audio"],joins:TimelineV2["audioJoins"]=[],extra:Partial<TimelineV2>={}):TimelineV2{
  return {schemaVersion:2,fps:30,aspect:"9:16",video:[{id:u(1),sceneId:u(2),sceneVersionId:null,assetId:null,durationFrames:300,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}}],text:[],
    audio,audioJoins:joins,audioMixProfile:AUDIO_MIX_PROFILE,audioRights:[...new Set(audio.map(item=>item.assetId))].map(id=>rights(id)),...extra};
}
const join2=(from:number,to:number,durationFrames:number)=>({fromClipId:u(100+from),toClipId:u(100+to),type:"crossfade" as const,durationFrames,curve:"equalPower" as const});
const messages=(value:unknown)=>{const result=timelineV2Schema.safeParse(value);return result.success?[]:result.error.issues.map(issue=>`${issue.path.join(".")}: ${issue.message}`);};

describe("timeline v2 스키마",()=>{
  it("정상: 목소리·두 곡 crossfade·효과음, 48kHz 1프레임=1600샘플, v1·v2 모두 읽음, 출력 길이는 영상·글자 기준",()=>{
    expect(SAMPLES_PER_FRAME).toBe(1600);
    const value=v2([clip(1,{role:"voice",startFrame:10,durationFrames:90,gainDb:-3,fadeInFrames:5,fadeOutFrames:5}),clip(2,{startFrame:0,durationFrames:150,fadeInFrames:10,duckUnderVoice:true}),clip(3,{startFrame:120,durationFrames:180,fadeOutFrames:30}),clip(4,{role:"effect",startFrame:200,durationFrames:3,gainDb:6})],[join2(2,3,30)]);
    expect(messages(value)).toEqual([]);expect(timelineSchema.parse(value)).toEqual(value);
    const v1={schemaVersion:1,fps:30,aspect:"9:16",video:value.video,audio:[],text:[]};expect(timelineSchema.parse(v1)).toEqual(v1);
    expect(timelineV1Schema.safeParse(value).success).toBe(false);// an app that knows only v1 cannot read v2
    expect(outputFrames({video:value.video,text:[]})).toBe(300);
    expect(outputFrames({video:value.video,text:[{timing:{endFrame:330}}]})).toBe(330);
    expect(messages({...value,audio:[clip(1,{startFrame:300,durationFrames:30})],audioJoins:[],audioRights:[rights(u(201))]})).toEqual(["audio.0.durationFrames: 소리는 영상 길이 안에서 끝나야 해요. 소리로 영상을 늘리지 않아요."]);
  });
  it("형식: 모르는 키·프로필·숫자(NaN/Infinity/소수 프레임/음수/범위)·길이 0 거절",()=>{
    const base=v2([clip(1)]);
    expect(messages({...base,extra:1}).length).toBeGreaterThan(0);
    expect(messages({...base,audioMixProfile:"other"}).length).toBeGreaterThan(0);
    const {audioMixProfile:_drop,...noProfile}=base;void _drop;expect(messages(noProfile).length).toBeGreaterThan(0);
    for(const bad of [{gainDb:Number.NaN},{gainDb:Number.POSITIVE_INFINITY},{gainDb:12.5},{gainDb:-61},{startFrame:1.5},{startFrame:-1},{sourceInFrame:0.5},{durationFrames:0},{fadeInFrames:-1},{role:"narration"},{assetId:"x"}])
      expect(messages({...base,audio:[{...clip(1),...bad}]}).length,JSON.stringify(bad)).toBeGreaterThan(0);
    expect(messages({...base,audio:[{...clip(1),extra:true}]}).length).toBeGreaterThan(0);
  });
  it("항목 규칙: 중복 id, 영상 끝 넘김, 서서히 합 초과, 음악 아닌 낮추기",()=>{
    expect(messages(v2([clip(1),clip(1,{startFrame:100})]))).toContain("audio.1.id: 소리 항목이 겹쳐요.");
    expect(messages(v2([clip(1,{startFrame:250,durationFrames:60})]))[0]).toMatch(/^audio.0.durationFrames/);
    expect(messages(v2([clip(1,{durationFrames:20,fadeInFrames:10,fadeOutFrames:11})]))).toEqual(["audio.0.fadeOutFrames: 처음·끝 서서히의 합이 소리 길이보다 길어요."]);
    expect(messages(v2([clip(1,{durationFrames:20,fadeInFrames:10,fadeOutFrames:10})]))).toEqual([]);
    expect(messages(v2([clip(1,{role:"voice",duckUnderVoice:true})]))).toEqual(["audio.0.duckUnderVoice: 음성에 맞춰 낮추기는 배경 음악에만 써요."]);
  });
  it("곡 연결: 위치·길이·서서히 중복·대상·한 번씩, 이어지지 않은 겹침과 세 곡 겹침 거절",()=>{
    const a=clip(1,{startFrame:0,durationFrames:100}),b=clip(2,{startFrame:70,durationFrames:100});
    expect(messages(v2([a,b],[join2(1,2,30)]))).toEqual([]);
    expect(messages(v2([a,b]))).toEqual(["audio.1.startFrame: 배경 음악은 곡 사이 겹치기로만 겹칠 수 있어요."]);
    expect(messages(v2([a,b],[join2(1,2,20)]))).toContain("audioJoins.0.durationFrames: 다음 곡은 앞 곡 끝에서 겹치는 시간만큼 앞에서 시작해야 해요.");
    expect(messages(v2([a,{...b,fadeInFrames:5}],[join2(1,2,30)]))).toContain("audioJoins.0.durationFrames: 곡 사이 겹치기 쪽에는 따로 서서히를 넣지 않아요.");
    expect(messages(v2([{...a,fadeOutFrames:5},b],[join2(1,2,30)]))).toContain("audioJoins.0.durationFrames: 곡 사이 겹치기 쪽에는 따로 서서히를 넣지 않아요.");
    expect(messages(v2([a,clip(2,{startFrame:0,durationFrames:100})],[join2(1,2,100)]))).toContain("audioJoins.0.durationFrames: 겹치는 시간은 두 곡의 사용 길이보다 짧아야 해요.");
    expect(messages(v2([a,clip(2,{role:"voice",startFrame:70})],[join2(1,2,30)]))).toEqual(["audioJoins.0.fromClipId: 곡 사이 겹치기는 서로 다른 배경 음악 두 곡에만 써요."]);
    expect(messages(v2([a],[join2(1,9,30)]))).toEqual(["audioJoins.0.toClipId: 이어 붙일 소리를 찾을 수 없어요."]);
    expect(messages(v2([a,b],[join2(1,2,30),join2(1,2,30)]))).toContain("audioJoins.1.fromClipId: 한 곡은 앞뒤로 한 번씩만 이어 붙일 수 있어요.");
    // A→B→C where B is shorter than both joins: three songs at once.
    const c3=[clip(1,{startFrame:0,durationFrames:100}),clip(2,{startFrame:70,durationFrames:40}),clip(3,{startFrame:90,durationFrames:100})];
    const triple=messages(v2(c3,[join2(1,2,30),join2(2,3,20)]));expect(triple).toContain("audio.1.durationFrames: 앞뒤 겹치는 시간이 이 곡보다 길어 세 곡이 겹쳐요.");expect(triple).toContain("audio: 배경 음악이 세 곡 이상 겹쳐요.");
    expect(messages(v2([clip(1,{startFrame:0,durationFrames:100}),clip(2,{startFrame:70,durationFrames:60}),clip(3,{startFrame:110,durationFrames:100})],[join2(1,2,30),join2(2,3,20)]))).toEqual([]);
    // voice and effect may overlap music and each other freely
    expect(messages(v2([a,clip(5,{role:"voice",startFrame:0}),clip(6,{role:"effect",startFrame:10})]))).toEqual([]);
  });
  it("권리: 쓰는 파일마다 정확히 한 줄, 빈 값 허용, URL·날짜·공백 검사, 남는 줄 거절",()=>{
    const value=v2([clip(1),clip(2,{role:"voice",startFrame:100,assetId:u(201)})]);expect(value.audioRights).toHaveLength(1);expect(messages(value)).toEqual([]);
    expect(messages({...value,audioRights:[]})).toEqual(["audioRights: 쓰는 소리마다 권리 기록 한 줄이 필요해요(모르면 비워 두세요)."]);
    expect(messages({...value,audioRights:[rights(u(201)),rights(u(201))]})).toEqual(["audioRights.1.assetId: 권리 기록이 겹쳐요."]);
    expect(messages({...value,audioRights:[rights(u(201)),rights(u(299))]})).toEqual(["audioRights.1.assetId: 쓰지 않는 소리의 권리 기록이에요."]);
    expect(messages({...value,audioRights:[rights(u(201),{sourceUrl:"https://example.com/track",planName:"개인 플랜",createdOn:"2026-11-01",licenseNote:"상업 사용 가능(직접 확인)"})]})).toEqual([]);
    for(const bad of [{sourceUrl:"ftp://example.com"},{sourceUrl:"javascript:alert(1)"},{createdOn:"2026-13-01"},{createdOn:"2026/11/01"},{planName:" 플랜"},{planName:""},{licenseNote:"x".repeat(1001)}])
      expect(messages({...value,audioRights:[rights(u(201),bad)]}).length,JSON.stringify(bad)).toBeGreaterThan(0);
  });
});

// ── database (fixed s4 copy, product migrations incl. 0008) ─────────────────────────────────────────────────────────
type Fixture={handle:DatabaseHandle;runtime:string;audio:{voice:string;song1:string;song2:string;archived:string;unknown:string}};
async function s4Runtime(migrations=productMigrations()){
  const runtime=join(root,"rt");await verifyBackupArchive(S4_ZIP,await readBackupManifest(S4_ZIP),runtime);mkdirSync(join(runtime,"backups"),{recursive:true});mkdirSync(join(runtime,"storage/library"),{recursive:true});
  const sqlite=new Database(join(runtime,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");migrateDatabase(sqlite,{migrations,now});}finally{sqlite.close();}
  vi.stubEnv("DREAM_DATA_ROOT",runtime);return runtime;
}
function addAudio(handle:DatabaseHandle,runtime:string,title:string,durationMs:number|null,archived=false){
  const id=v7(),bytes=Buffer.from(`virtual ${title} ${id}`),path=`library/${id}.wav`;writeFileSync(join(runtime,"storage",path),bytes);
  handle.sqlite.prepare("INSERT INTO assets(id,kind,title,role,file_path,mime,size_bytes,sha256,duration_ms,origin,is_mock,archived_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,"audio",title,"original",path,"audio/wav",bytes.length,createHash("sha256").update(bytes).digest("hex"),durationMs,"upload",0,archived?"2026-11-17T00:00:00Z":null,"2026-11-17T00:00:00Z");return id;
}
async function fixture(migrations=productMigrations()):Promise<Fixture>{
  const runtime=await s4Runtime(migrations),handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});handles.push(handle);
  return {handle,runtime,audio:{voice:addAudio(handle,runtime,"목소리",10000),song1:addAudio(handle,runtime,"곡 1",20000),song2:addAudio(handle,runtime,"곡 2",20000),archived:addAudio(handle,runtime,"보관한 곡",20000,true),unknown:addAudio(handle,runtime,"길이 모름",null)}};
}
const rowsOf=(handle:DatabaseHandle)=>handle.sqlite.prepare("SELECT * FROM timeline_revisions ORDER BY project_id,revision").all() as TimelineRow[];
const projectRow=(handle:DatabaseHandle)=>handle.sqlite.prepare("SELECT content_revision,current_timeline_rev_id FROM projects WHERE id=?").get(ids.main);
const thrown=(fn:()=>unknown)=>{try{fn();}catch(error){return error as Error&{code?:string};}throw new Error("expected a throw");};
// The current saved timeline of the main project as v2 with the given sound (video/text kept exactly).
function soundOn(base:Timeline,audio:TimelineV2["audio"],joins:TimelineV2["audioJoins"]=[],rightsRows?:TimelineV2["audioRights"]):TimelineV2{
  return {schemaVersion:2,fps:30,aspect:base.aspect,video:base.video,text:base.text,audio,audioJoins:joins,audioMixProfile:AUDIO_MIX_PROFILE,audioRights:rightsRows??[...new Set(audio.map(item=>item.assetId))].map(id=>rights(id))};
}
const sound=(assetId:string,over:Partial<TimelineV2["audio"][number]>={})=>({...clip(0),id:v7(),assetId,...over});

describe("저장·읽기·복원 (가상 s4 사본)",()=>{
  it("v2 명시 저장: 원값 그대로 왕복·해시·내용 버전+1, 읽기는 아무것도 쓰지 않고 v1 r1은 바이트 그대로",async()=>{
    const {handle,audio}=await fixture(),timelines=timelineService(handle),data=timelines.get(ids.main),r1=rowsOf(handle);
    expect(data.timeline!.schemaVersion).toBe(1);const before=JSON.stringify(rowsOf(handle));timelines.get(ids.main);timelines.state(ids.main);expect(JSON.stringify(rowsOf(handle))).toBe(before);
    const end=outputFrames(data.timeline!);
    const value=soundOn(data.timeline!,[sound(audio.voice,{role:"voice",startFrame:3,sourceInFrame:7,durationFrames:61,gainDb:-2.5,fadeInFrames:2,fadeOutFrames:3}),sound(audio.song1,{startFrame:0,durationFrames:90,duckUnderVoice:true,fadeInFrames:15}),sound(audio.song2,{startFrame:60,sourceInFrame:30,durationFrames:Math.min(end-60,400),gainDb:-6,fadeOutFrames:20})],[],
      [rights(audio.voice),rights(audio.song1,{planName:"개인 플랜",createdOn:"2026-11-01",licenseNote:"직접 확인 필요",sourceUrl:"https://example.com/a"}),rights(audio.song2)]);
    value.audioJoins=[{fromClipId:value.audio[1].id,toClipId:value.audio[2].id,type:"crossfade",durationFrames:30,curve:"equalPower"}];
    const saved=timelines.save(ids.main,data.project.contentRevision,data.current!.id,value);expect(saved).toMatchObject({created:true,revision:data.project.contentRevision+1});
    const row=timelineRepository(handle).row(saved.timelineId)!;expect(row.timeline_json).toBe(canonicalJson(value));expect(row.timeline_sha256).toBe(timelineSha256(row.timeline_json));
    expect(readTimelineRow(row)).toEqual(value);expect(timelines.get(ids.main).timeline).toEqual(value);
    expect(rowsOf(handle).find(item=>item.id===r1[0].id)).toEqual(r1[0]);
    // the same content again creates nothing
    expect(timelines.save(ids.main,saved.revision,saved.timelineId,value)).toMatchObject({created:false,revision:saved.revision});
    expect(()=>checkTimelineRows(handle.sqlite)).not.toThrow();
    // opt-in only: saving v1 again stays v1 (no automatic conversion either way)
    const back=timelines.save(ids.main,saved.revision,saved.timelineId,{schemaVersion:1,fps:30,aspect:value.aspect,video:value.video,audio:[],text:value.text});
    expect(JSON.parse(timelineRepository(handle).row(back.timelineId)!.timeline_json).schemaVersion).toBe(1);
    // restore the v2 version: a new restore row with every sound value
    const restored=timelines.restore(ids.main,back.revision,back.timelineId,saved.timelineId);
    const restoredRow=timelineRepository(handle).row(restored.timelineId)!;expect(restoredRow.source).toBe("restore-version");expect(restoredRow.timeline_json).toBe(row.timeline_json);
  });
  it("원자 거절: 없는 자료·소리 아닌 자료·보관된 새 자료·파일 길이 넘음·길이 모름·스키마 오류, 행·버전·포인터 그대로",async()=>{
    const {handle,audio}=await fixture(),timelines=timelineService(handle),data=timelines.get(ids.main),rev=data.project.contentRevision,id=data.current!.id,base=data.timeline!;
    const snapshot=()=>JSON.stringify({rows:rowsOf(handle),project:projectRow(handle)}),before=snapshot();
    const save=(audioList:TimelineV2["audio"])=>thrown(()=>timelines.save(ids.main,rev,id,soundOn(base,audioList)));
    expect(save([sound(v7())]).message).toBe(AUDIO_ASSET_INVALID);
    expect(save([sound(ids.up1)]).message).toBe(AUDIO_ASSET_INVALID);
    expect(save([sound(audio.archived)]).message).toBe(AUDIO_ASSET_INVALID);
    expect(save([sound(audio.unknown)]).message).toMatch("길이를 알 수 없어요");
    expect(save([sound(audio.voice,{role:"voice",sourceInFrame:241,durationFrames:60})]).message).toBe(AUDIO_RANGE_INVALID);// 10 s = 300 frames
    expect(()=>timelines.save(ids.main,rev,id,soundOn(base,[sound(audio.voice,{role:"voice",sourceInFrame:240,durationFrames:60})]))).not.toThrow();
    const after=timelineService(handle).get(ids.main);// that one saved; check the rest left nothing
    expect(rowsOf(handle)).toHaveLength(JSON.parse(before).rows.length+1);expect(after.timeline!.schemaVersion).toBe(2);
    const fresh=snapshot();
    for(const bad of [{...soundOn(after.timeline as never,[]),audioMixProfile:"x"},soundOn(after.timeline as never,[sound(audio.song1,{durationFrames:outputFrames(base)+1})]),{...soundOn(after.timeline as never,[sound(audio.song1)]),audioRights:[]}])
      expect(()=>timelines.save(ids.main,after.project.contentRevision,after.current!.id,bad)).toThrow();
    // v1 never gains sound
    expect(thrown(()=>timelines.save(ids.main,after.project.contentRevision,after.current!.id,{schemaVersion:1,fps:30,aspect:base.aspect,video:base.video,text:base.text,audio:[{id:v7(),assetId:audio.voice,role:"voice",startFrame:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}]})).message).toBe(AUDIO_V1_UNSUPPORTED);
    expect(snapshot()).toBe(fresh);
  });
  it("CAS: 오래된 내용 버전·타임라인 id는 CONFLICT, 아무것도 쓰지 않음",async()=>{
    const {handle,audio}=await fixture(),timelines=timelineService(handle),data=timelines.get(ids.main),value=soundOn(data.timeline!,[sound(audio.song1)]);
    const first=timelines.save(ids.main,data.project.contentRevision,data.current!.id,value),before=JSON.stringify(rowsOf(handle));
    const other=soundOn(data.timeline!,[sound(audio.song2)]);
    expect(thrown(()=>timelines.save(ids.main,data.project.contentRevision,first.timelineId,other)).code).toBe("CONFLICT");
    expect(thrown(()=>timelines.save(ids.main,first.revision,data.current!.id,other)).code).toBe("CONFLICT");
    expect(JSON.stringify(rowsOf(handle))).toBe(before);
  });
  it("보관 뒤: 그대로 둔 소리는 저장 가능, 바꾸면 거절. 사용 수는 타임라인에만 쓴 소리도 센다",async()=>{
    const {handle,audio}=await fixture(),timelines=timelineService(handle),library=libraryRepository(handle),data=timelines.get(ids.main);
    expect(library.assetUsage(audio.song1)).toBe(0);
    const value=soundOn(data.timeline!,[sound(audio.song1)]),saved=timelines.save(ids.main,data.project.contentRevision,data.current!.id,value);
    expect(library.assetUsage(audio.song1)).toBe(1);expect(library.assetUsage(audio.song2)).toBe(0);expect(library.assetUsage(ids.up1)).toBeGreaterThanOrEqual(0);
    library.archiveAsset(audio.song1);
    const textOnly={...value,text:value.text.map((layer,index)=>index===value.text.length-1&&!layer.locked?{...layer,content:`${layer.content} 고침`}:layer)};
    expect(timelines.save(ids.main,saved.revision,saved.timelineId,textOnly)).toMatchObject({created:true});
    const now2=timelines.get(ids.main);
    expect(thrown(()=>timelines.save(ids.main,now2.project.contentRevision,now2.current!.id,{...now2.timeline!,audio:[{...value.audio[0],gainDb:-1}]})).message).toBe(AUDIO_ASSET_INVALID);
    expect(library.assetUsage(audio.song1)).toBe(1);
  });
  it("검수: 저장한 타임라인에 실제 음악이 있으면 음악 권리 항목이 생기고 자동 통과하지 않음",async()=>{
    const {handle,audio}=await fixture(),timelines=timelineService(handle),data=timelines.get(ids.main);
    const value=soundOn(data.timeline!,[sound(audio.song1)],[],[rights(audio.song1,{planName:"개인 플랜",createdOn:"2026-11-01",licenseNote:"메모"})]);
    // the fixed s4 project keeps an older template record; give this copy the current menu snapshot so review can open
    const config=menusSchema.parse(JSON.parse(readFileSync(join(process.cwd(),"docs/spec/menus.json"),"utf8")));
    handle.sqlite.prepare("UPDATE projects SET template_snapshot_json=? WHERE id=?").run(JSON.stringify(snapshotForMenu(config,config.menus[0])),ids.main);
    expect(JSON.parse(data.project.inputsJson).usesMusic).not.toBe(true);// the project answer says no music
    const saved=timelines.save(ids.main,data.project.contentRevision,data.current!.id,value);
    editingService(handle).complete(ids.main,saved.revision);
    const review=reviewService(handle).get(ids.main),item=review.items.find(row=>row.templateItemId==="x.music-rights");
    expect(item).toMatchObject({status:"unchecked",required:true});expect(item!.evidence).toMatch(/1곡 중 플랜·생성일·라이선스가 모두 적힌 곡 1곡/);expect(review.approved).toBe(false);
  });
  // T-137: a v2 timeline is rendered through envelope B (never the silent envelope A); envelope A stays a v1 without sound.
  it("렌더: v2는 봉투 B(소리 없으면 mode none, 있으면 mix 준비 검사)로만, 무음 봉투 A는 소리 없는 v1만",async()=>{
    const {handle,audio}=await fixture(),timelines=timelineService(handle),data=timelines.get(ids.main);
    const saved=timelines.save(ids.main,data.project.contentRevision,data.current!.id,soundOn(data.timeline!,[sound(audio.song1)]));
    const deps={browser:async()=>({ok:false as const,reason:"missing" as const,version:"x"}),audioTools:async()=>null};
    const prepared=await prepareRender(handle,ids.main,deps);
    expect(prepared.input).toBeNull();expect(prepared.blockers.map(item=>item.code)).toContain("AUDIO_TOOL_MISSING");expect(prepared.blockers.map(item=>item.code)).not.toContain("AUDIO_RENDER_UNSUPPORTED");
    timelines.save(ids.main,saved.revision,saved.timelineId,soundOn(data.timeline!,[]));
    expect((await prepareRender(handle,ids.main,deps)).blockers.map(item=>item.code)).not.toContain("AUDIO_RENDER_UNSUPPORTED");
    const timelineField=renderInputSilentSchema.shape.timeline;
    expect(timelineField.safeParse(data.timeline).success).toBe(true);
    expect(timelineField.safeParse(soundOn(data.timeline!,[])).success).toBe(false);
    expect(timelineField.safeParse({...data.timeline,audio:[{id:v7(),assetId:audio.voice,role:"voice",startFrame:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}]}).success).toBe(false);
  });
});

describe("0008 기능 게이트·예전 v1 소리·백업 복원",()=>{
  it("0008: 새 행은 소리 없는 v1이나 고정 프로필 v2만, 예전 앱(7단계)은 이 DB를 too_new로 거부",async()=>{
    const {handle}=await fixture(),r1=rowsOf(handle)[0],insert=(json:string)=>handle.sqlite.prepare("INSERT INTO timeline_revisions(id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,restored_from_id,migrated_from_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(v7(),ids.main,99,99,json,timelineSha256(json),"user",null,null,"2026-11-17T00:00:00Z");
    const timeline=JSON.parse(r1.timeline_json) as Record<string,unknown>;
    for(const bad of [{...timeline,audio:[{x:1}]},{...timeline,schemaVersion:3},{...timeline,schemaVersion:2,audioJoins:[],audioRights:[],audioMixProfile:"other"},{...timeline,schemaVersion:2,audioMixProfile:AUDIO_MIX_PROFILE}])
      expect(()=>insert(JSON.stringify(bad)),JSON.stringify(bad).slice(0,60)).toThrow(/timeline schema is not writable/);
    const recorded=journal(handle.sqlite)!;expect(recorded.map(row=>row.version)).toEqual([1,2,3,4,5,6,7,8,9,10]);expect(recorded[7].name).toBe("0008_timeline_audio.sql");
    expect(compareMigrations(recorded,productMigrations().slice(0,7))).toBe("too_new");expect(compareMigrations(recorded,productMigrations())).toBe("same");
  });
  it("0008 이전에 쓰인 소리 있는 v1 행: 올려도 바이트 그대로 읽히고, 저장·되돌리기·렌더는 명시 거절",async()=>{
    const runtime=await s4Runtime(productMigrations().slice(0,7)),file=join(runtime,"data/app.db");let historical="";
    {const handle=openDatabase(file,{fileMustExist:true});try{const timelines=timelineService(handle),data=timelines.get(ids.main);
      // written the way a row of that time could hold it (0008 did not exist yet)
      const json=canonicalJson({...data.timeline!,audio:[{id:v7(),assetId:ids.up1,role:"music",startFrame:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}]}),id=v7();historical=id;
      timelineRepository(handle).insert({id,project_id:ids.main,revision:2,content_revision:data.project.contentRevision+1,timeline_json:json,timeline_sha256:timelineSha256(json),source:"user",restored_from_id:null,migrated_from_key:null,created_at:"2026-11-16T00:00:00Z"});
      handle.sqlite.prepare("UPDATE projects SET content_revision=content_revision+1 WHERE id=?").run(ids.main);timelineRepository(handle).point(ids.main,id);}finally{handle.close();}}
    const before=new Database(file,{readonly:true});const kept=before.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(historical);before.close();
    const sqlite=new Database(file);try{sqlite.pragma("foreign_keys = ON");expect(migrateDatabase(sqlite,{migrations:productMigrations(),now})).toBe(3);}finally{sqlite.close();}
    const handle=openDatabase(file,{fileMustExist:true});handles.push(handle);
    expect(handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(historical)).toEqual(kept);
    const timelines=timelineService(handle),data=timelines.get(ids.main);expect(data.timeline!.audio).toHaveLength(1);expect(data.timeline!.schemaVersion).toBe(1);
    expect(thrown(()=>timelines.save(ids.main,data.project.contentRevision,historical,data.timeline)).message).toBe(AUDIO_V1_UNSUPPORTED);
    const r1=rowsOf(handle)[0],back=timelines.restore(ids.main,data.project.contentRevision,historical,r1.id);
    expect(thrown(()=>timelines.restore(ids.main,back.revision,back.timelineId,historical)).message).toBe(AUDIO_V1_UNSUPPORTED);
    expect(handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(historical)).toEqual(kept);
  });
  it("소리 있는 예전 v1이 현재 버전이면 렌더 차단",async()=>{
    const runtime=await s4Runtime(productMigrations().slice(0,7)),file=join(runtime,"data/app.db");
    {const handle=openDatabase(file,{fileMustExist:true});try{const data=timelineService(handle).get(ids.main),json=canonicalJson({...data.timeline!,audio:[{id:v7(),assetId:ids.up1,role:"voice",startFrame:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}]}),id=v7();
      timelineRepository(handle).insert({id,project_id:ids.main,revision:2,content_revision:data.project.contentRevision+1,timeline_json:json,timeline_sha256:timelineSha256(json),source:"user",restored_from_id:null,migrated_from_key:null,created_at:"2026-11-16T00:00:00Z"});
      handle.sqlite.prepare("UPDATE projects SET content_revision=content_revision+1 WHERE id=?").run(ids.main);timelineRepository(handle).point(ids.main,id);}finally{handle.close();}}
    const sqlite=new Database(file);try{migrateDatabase(sqlite,{migrations:productMigrations(),now});}finally{sqlite.close();}
    const handle=openDatabase(file,{fileMustExist:true});handles.push(handle);
    expect((await prepareRender(handle,ids.main,{browser:async()=>{throw new Error("not reached");}})).blockers).toEqual([{code:"AUDIO_RENDER_UNSUPPORTED",params:{schemaVersion:1,audioClips:1}}]);
  });
  it("백업 → 다른 폴더로 복원: v2 행 바이트·해시와 소리 파일이 그대로, 소리 참조가 깨진 DB는 행 검사에서 거절",async()=>{
    const {handle,runtime,audio}=await fixture(),timelines=timelineService(handle),data=timelines.get(ids.main);
    const saved=timelines.save(ids.main,data.project.contentRevision,data.current!.id,soundOn(data.timeline!,[sound(audio.voice,{role:"voice"}),sound(audio.song1,{startFrame:100})]));
    const row=timelineRepository(handle).row(saved.timelineId)!,files=[audio.voice,audio.song1].map(id=>jobsRepository(handle).assets([id])[0]);
    // this copy only: earlier virtual jobs must not take the worker slot before the backup
    handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status='running'").run();handle.sqlite.prepare("UPDATE jobs SET next_run_at='2099-01-01T00:00:00Z' WHERE status='queued'").run();
    handle.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();// the fixture's folder setting points outside this copy
    expect(handle.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='running'").get()).toEqual({n:0});
    const request=backupService(handle,now).request()!,claimed=jobsService(handle,now).claim()!;expect(claimed.kind).toBe("backup");await runClaimedBackup(handle,claimed,now);
    const destination=join(root,"restored"),svc=restoreService(handle,now),checked=await svc.inspect({backupId:request.id,destination});expect(checked).toMatchObject({compat:"same",fromVersion:10,toVersion:10});await svc.finish(checked.ticketId);
    const restored=openDatabase(join(destination,"data/app.db"),{fileMustExist:true});handles.push(restored);
    expect(restored.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(row.id)).toEqual(row);
    for(const file of files)expect(await fileDigest(join(destination,"storage",...file.filePath!.split("/")))).toEqual({sha256:file.sha256,sizeBytes:file.sizeBytes});
    expect(()=>checkTimelineRows(restored.sqlite)).not.toThrow();
    restored.sqlite.prepare("UPDATE assets SET kind='text' WHERE id=?").run(audio.song1);
    expect(()=>checkTimelineRows(restored.sqlite)).toThrow(/Timeline audio reference differs/);
    void runtime;
  },120000);
});
