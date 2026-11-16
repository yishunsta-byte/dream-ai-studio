// T-152 (F150-1): the song-join preview must not overwrite the draft with the timeline of the moment it was made.
// Pure: the request keeps only (two songs, overlap, the change list seen); the preview is planned again from the
// newest draft, applying plans again on the draft it changes, and a changed list waits for a new look. Component: the
// sound editor keeps no timeline in state and only changes the draft through functional updates. DB: the original
// repro (preview → gain −6 dB and rights memo → 이대로 연결 → save → read) on a copy of the fixed s5 backup.
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import type { DatabaseHandle } from "@/lib/db/connection";
import { addClip, applyJoin, insertClip, audioProblems, changeRole, joinChangeKey, joinPreview, planJoin, problemCount, removeClip, restoreClip, updateClip, updateRights, type AudioSource, type JoinRequest } from "@/lib/edit/audio-ops";
import { canonicalJson, type TimelineV1, type TimelineV2 } from "@/lib/edit/timeline";
import { editingService } from "@/lib/services/editing";
import { timelineService } from "@/lib/services/timeline";
import { jobsRepository } from "@/lib/repo/jobs";
import { addSound, P, s5Copy, saveTimeline } from "./p2-5c-helpers";

const src=(over:Partial<AudioSource>={}):AudioSource=>({id:v7(),title:"곡",kind:"audio",mime:"audio/wav",durationMs:10000,isMock:false,archived:false,available:true,sourceUrl:null,rightsNote:null,...over});
const v1=(frames=900):TimelineV1=>({schemaVersion:1,fps:30,aspect:"9:16",video:[{id:v7(),sceneId:v7(),sceneVersionId:null,assetId:null,durationFrames:frames,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}}],audio:[],text:[]});
function twoSongs(){
  const a=src(),b=src();
  const first=addClip(v1(),a,"music");if("error" in first)throw new Error(first.error);
  const second=addClip(first.timeline,b,"music");if("error" in second)throw new Error(second.error);
  return {a,b,A:first.clipId,B:second.clipId,t:updateClip(second.timeline,first.clipId,{fadeOutFrames:15})};
}
// What the component keeps when the person picks the next song: the request and the change list they saw
function ask(t:TimelineV2,from:string,to:string,frames:number):JoinRequest{
  const plan=planJoin(t,from,to,frames);if("error" in plan)throw new Error(plan.error);return {fromId:from,toId:to,frames,seen:joinChangeKey(plan.changes)};
}
const get=(result:ReturnType<typeof applyJoin>)=>{if("error" in result)throw new Error(result.error);return result.timeline;};

describe("곡 연결 미리보기가 나중 초안을 덮지 않음 (F150-1)",()=>{
  it("원재현: 미리보기 뒤 크기 -6 dB·권리 메모를 바꾸고 적용해도 둘 다 남고, 연결 값만 바뀐다",()=>{
    const s=twoSongs(),request=ask(s.t,s.A,s.B,30);
    const later=updateRights(updateClip(s.t,s.A,{gainDb:-6}),s.a.id,{licenseNote:"F150-stale-plan-keep",sourceUrl:"https://example.com/a"});
    expect(joinPreview(later,request).stale).toBe(false);
    const applied=get(applyJoin(later,request));
    expect(applied.audio.find(clip=>clip.id===s.A)).toMatchObject({gainDb:-6,fadeOutFrames:0});
    expect(applied.audio.find(clip=>clip.id===s.B)).toMatchObject({startFrame:270,fadeInFrames:0});
    expect(applied.audioRights.find(row=>row.assetId===s.a.id)).toMatchObject({licenseNote:"F150-stale-plan-keep",sourceUrl:"https://example.com/a"});
    expect(applied.audioJoins).toEqual([{fromClipId:s.A,toClipId:s.B,type:"crossfade",durationFrames:30,curve:"equalPower"}]);
    // everything except the three join fields and the join itself is the later draft
    const strip=(t:TimelineV2)=>canonicalJson({...t,audioJoins:[],audio:t.audio.map(clip=>({...clip,fadeOutFrames:0,fadeInFrames:0,startFrame:clip.id===s.B?0:clip.startFrame}))});
    expect(strip(applied)).toBe(strip(later));
  });
  it("다른 소리 추가·역할·영상 변경도 남고, 미리보기 뒤 다음 곡을 빼면 연결하지 않는다",()=>{
    const s=twoSongs(),request=ask(s.t,s.A,s.B,30);
    const fx=addClip(s.t,src({durationMs:1000}),"effect");if("error" in fx)throw new Error(fx.error);
    const later={...fx.timeline,video:fx.timeline.video.map(item=>({...item,trimInFrames:3}))};
    const applied=get(applyJoin(later,request));
    expect(applied.audio.map(clip=>clip.id)).toEqual(later.audio.map(clip=>clip.id));expect(applied.video[0].trimInFrames).toBe(3);
    expect(changeRole(applied,fx.clipId,"voice").timeline.audio.find(clip=>clip.id===fx.clipId)!.role).toBe("voice");
    const gone=removeClip(s.t,s.B);expect(applyJoin(gone,request)).toHaveProperty("error");expect("error" in joinPreview(gone,request).plan).toBe(true);
  });
  it("미리 본 값이 바뀌면(앞 곡 길이·끝 서서히) 조용히 적용하지 않고 새 목록 확인을 기다린다",()=>{
    const s=twoSongs(),request=ask(s.t,s.A,s.B,30);
    const moved=updateClip(s.t,s.A,{durationFrames:240});
    const view=joinPreview(moved,request);expect(view.stale).toBe(true);
    expect(applyJoin(moved,request)).toEqual({error:expect.stringMatching(/다시 확인/)});
    if("error" in view.plan)throw new Error(view.plan.error);
    expect(view.plan.changes.find(change=>change.field==="startFrame")).toMatchObject({to:210});
    const seen={...request,seen:joinChangeKey(view.plan.changes)};expect(get(applyJoin(moved,seen)).audio.find(clip=>clip.id===s.B)!.startFrame).toBe(210);
    expect(joinPreview(updateClip(s.t,s.A,{fadeOutFrames:0}),request).stale).toBe(true);
  });
  it("빼기 되돌리기는 그 순간의 초안 전체가 아니라 뺀 소리만 최신 초안에 돌려놓는다",()=>{
    const s=twoSongs(),before=get(applyJoin(s.t,ask(s.t,s.A,s.B,30)));
    const later=updateRights(updateClip(removeClip(before,s.B),s.A,{gainDb:-6}),s.a.id,{licenseNote:"keep"});
    const back=restoreClip(later,before,s.B) as TimelineV2;
    expect(back.audio.map(clip=>clip.id)).toEqual([s.A,s.B]);expect(back.audio[0].gainDb).toBe(-6);
    expect(back.audioRights.find(row=>row.assetId===s.a.id)!.licenseNote).toBe("keep");expect(back.audioRights.map(row=>row.assetId)).toContain(s.b.id);
    expect(back.audioJoins).toHaveLength(1);expect(restoreClip(back,before,s.B)).toBe(back);
  });
  it("소리 넣기는 새 소리만 최신 초안에 더한다(넣기 버튼을 누르는 사이 바뀐 값 보존)",()=>{
    const s=twoSongs(),fx=src({durationMs:1000}),planned=addClip(s.t,fx,"effect");if("error" in planned)throw new Error(planned.error);
    const later=updateClip(s.t,s.A,{gainDb:-6}),merged=insertClip(later,planned.timeline,planned.clipId) as TimelineV2;
    expect(merged.audio.find(clip=>clip.id===s.A)!.gainDb).toBe(-6);expect(merged.audio.at(-1)!.id).toBe(planned.clipId);expect(merged.audioRights.map(row=>row.assetId)).toContain(fx.id);
    expect(insertClip(merged,planned.timeline,planned.clipId)).toBe(merged);
    const fresh=v1(),first=addClip(fresh,fx,"effect");if("error" in first)throw new Error(first.error);expect((insertClip(fresh,first.timeline,first.clipId) as TimelineV2).schemaVersion).toBe(2);
  });
  it("컴포넌트: 미리보기·되돌리기는 timeline을 state에 두지 않고 최신 초안 함수형 갱신만 쓴다",()=>{
    const code=readFileSync("components/audio-editor/audio-editor.tsx","utf8");
    expect(code).not.toMatch(/useState<JoinPlan/);expect(code).not.toMatch(/\?before:current/);
    expect(code).toMatch(/useState<JoinRequest\|null>/);expect(code).toMatch(/joinPreview\(timeline,request\)/);
    expect(code).toMatch(/setDraft\(old=>\{const result=applyJoin\(old,asked\)/);expect(code).toMatch(/restoreClip\(current,before,clip\.id\)/);
    for(const line of code.split("\n"))for(const call of line.match(/setDraft\([^)]{0,12}/g)??[])expect(call).toMatch(/^setDraft\((old|current)=>/);
  });
});

let root="",handle:DatabaseHandle,storage="";
beforeAll(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-t152-")));vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));({handle,storage}=await s5Copy(join(root,"s5")));},120000);
afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});

describe("가짜 프로젝트 저장 왕복 (F150-1 원재현)",()=>{
  it("미리보기 → 크기 -6·권리 메모 → 이대로 연결 → 저장 → 다시 읽어도 -6·메모·연결이 있다. 오래된 revision은 거절",()=>{
    saveTimeline(handle,null);const before=editingService(handle).get(P);
    const m1=addSound(handle,storage,"곡A","sine=f=440:d=10:sample_rate=48000"),m2=addSound(handle,storage,"곡B","sine=f=550:d=10:sample_rate=48000");
    const sources=editingService(handle).get(P).audioSources,find=(id:string)=>sources.find(item=>item.id===id)!;
    const one=addClip(before.draft,find(m1.id),"music");if("error" in one)throw new Error(one.error);
    const two=addClip(one.timeline,find(m2.id),"music");if("error" in two)throw new Error(two.error);
    const shown=updateClip(two.timeline,one.clipId,{fadeOutFrames:5}),request=ask(shown,one.clipId,two.clipId,30);
    const later=updateRights(updateClip(shown,one.clipId,{gainDb:-6}),m1.id,{licenseNote:"F150-stale-plan-keep"});
    const t=get(applyJoin(later,request));expect(problemCount(audioProblems(t,sources))).toBe(0);
    const project=jobsRepository(handle).project(P)!;expect(timelineService(handle).save(P,project.contentRevision,project.currentTimelineRevId,t).created).toBe(true);
    const back=editingService(handle).get(P).draft as TimelineV2;
    expect(back.audio.find(clip=>clip.id===one.clipId)).toMatchObject({gainDb:-6,fadeOutFrames:0});
    expect(back.audioRights.find(row=>row.assetId===m1.id)!.licenseNote).toBe("F150-stale-plan-keep");
    expect(back.audioJoins).toEqual([{fromClipId:one.clipId,toClipId:two.clipId,type:"crossfade",durationFrames:30,curve:"equalPower"}]);
    expect(()=>timelineService(handle).save(P,project.contentRevision,project.currentTimelineRevId,t)).toThrow();
  },120000);
});
