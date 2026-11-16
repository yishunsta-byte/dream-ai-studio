// T-149 P2-5 U2/U3: the sound part of the editing draft (pure operations), the read-only sound list of the editing
// loader, and saving what the operations build through the product timeline service (v1 → v2 opt-in, role / range /
// gain / fades / ducking / song join / rights round trip, archived and missing files kept as saved). Every database is
// a copy of the fixed s5 backup in an OS temp folder (virtual data); sound files are synthetic.
import { rmSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import type { DatabaseHandle } from "@/lib/db/connection";
import { addClip, asV2, audioLaterChanges, audioProblems, canAddSound, changeRole, fileNote, hasAudioLaterChanges, joinCandidates, liveAudioFields, otherThanSound, parseAudioTime, parseGain, planJoin, problemCount, removeClip, removeJoin, sourceFrames, updateClip, updateRights, type AudioSource } from "@/lib/edit/audio-ops";
import { recoveryJson } from "@/lib/edit/text-ops";
import { canonicalJson, outputFrames, timelineSchema, type TimelineV1, type TimelineV2 } from "@/lib/edit/timeline";
import { editingService } from "@/lib/services/editing";
import { timelineService } from "@/lib/services/timeline";
import { libraryRepository } from "@/lib/repo/library";
import { jobsRepository } from "@/lib/repo/jobs";
import { addSound, P, s5Copy, saveTimeline } from "./p2-5c-helpers";

const src=(over:Partial<AudioSource>={}):AudioSource=>({id:v7(),title:"곡",kind:"audio",mime:"audio/wav",durationMs:20000,isMock:false,archived:false,available:true,sourceUrl:null,rightsNote:null,...over});
const v1=(frames=900):TimelineV1=>({schemaVersion:1,fps:30,aspect:"9:16",video:[{id:v7(),sceneId:v7(),sceneVersionId:null,assetId:null,durationFrames:frames,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}}],audio:[],text:[]});
const ok=(result:ReturnType<typeof addClip>)=>{if("error" in result)throw new Error(result.error);return result;};

describe("소리 초안 연산 (순수)",()=>{
  it("v1은 읽기만으로 바뀌지 않고, 소리를 넣을 때 v2 필수 칸을 함께 만든다. 예전 소리가 있는 v1은 바꾸지 않는다",()=>{
    const base=v1(),before=canonicalJson(base),song=src();
    expect(canAddSound(base)).toBe(true);const added=ok(addClip(base,song,"music"));expect(canonicalJson(base)).toBe(before);
    expect(added.timeline).toMatchObject({schemaVersion:2,audioJoins:[],audioMixProfile:"p2-5-local-v1",audioRights:[{assetId:song.id,sourceUrl:null,planName:null,createdOn:null,licenseNote:null}]});
    expect(added.timeline.audio[0]).toMatchObject({role:"music",startFrame:0,sourceInFrame:0,durationFrames:600,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false});
    expect(timelineSchema.safeParse(added.timeline).success).toBe(true);
    const legacy={...base,audio:[{id:v7(),assetId:song.id,role:"voice" as const,startFrame:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}]};
    expect(canAddSound(legacy)).toBe(false);expect(asV2(legacy)).toBeNull();expect(addClip(legacy,song,"voice")).toHaveProperty("error");
    // v2 with every sound removed stays v2 (its fields kept)
    const empty=removeClip(added.timeline,added.clipId);expect(empty).toMatchObject({schemaVersion:2,audio:[],audioJoins:[],audioRights:[]});expect(timelineSchema.safeParse(empty).success).toBe(true);
  });
  it("넣기 기본값: 길이는 min(원본 프레임, 남은 영상), 두 번째 곡은 앞 곡 끝, 자리 없음·길이 모름·1프레임 미만·보관/없음은 이유와 함께 거절",()=>{
    const long=src({durationMs:60000}),first=ok(addClip(v1(900),long,"music"));expect(first.durationFrames).toBe(900);
    expect(addClip(first.timeline,src(),"music")).toEqual({error:expect.stringMatching(/남은 영상 시간이 없어요/)});
    const short=ok(addClip(v1(900),src({durationMs:10000}),"music")),second=ok(addClip(short.timeline,src({durationMs:30000}),"music"));
    expect(second).toMatchObject({startFrame:300,durationFrames:600});expect(problemCount(audioProblems(second.timeline,[]))).toBe(0);
    expect(ok(addClip(short.timeline,src(),"voice")).startFrame).toBe(0);
    expect(addClip(v1(),src({durationMs:null}),"voice")).toEqual({error:expect.stringMatching(/길이를 알 수 없어요/)});
    expect(addClip(v1(),src({durationMs:20}),"voice")).toEqual({error:expect.stringMatching(/1\/30초보다 짧은/)});
    expect(addClip(v1(),src({archived:true}),"voice")).toHaveProperty("error");expect(addClip(v1(),src({available:false}),"voice")).toHaveProperty("error");
    expect(sourceFrames(1033)).toBe(30);expect(sourceFrames(null)).toBeNull();
  });
  it("잘못된 시간·서서히·겹침·세 곡·부족한 원본·음악 외 덮킹은 자리별 오류, 다른 초안은 그대로",()=>{
    const a=src({durationMs:10000}),b=src({durationMs:10000}),c=src({durationMs:10000});
    let t=ok(addClip(v1(900),a,"music")).timeline;const one=t.audio[0].id;t=ok(addClip(t,b,"music")).timeline;const two=t.audio[1].id;
    const sources=[a,b,c];
    const fades=updateClip(t,one,{fadeInFrames:200,fadeOutFrames:200});expect(audioProblems(fades,sources).clips[one]).toEqual(expect.arrayContaining([expect.stringMatching(/서서히의 합/)]));
    const overlap=updateClip(t,two,{startFrame:200});expect(audioProblems(overlap,sources).clips[two]).toEqual(expect.arrayContaining([expect.stringMatching(/곡 사이 겹치기로만/)]));
    const beyond=updateClip(t,one,{sourceInFrame:100});expect(audioProblems(beyond,sources).clips[one]).toEqual(expect.arrayContaining([expect.stringMatching(/원본 파일 길이\(00:10.00\)를 넘어요/)]));
    const longer=updateClip(t,two,{durationFrames:700});expect(audioProblems(longer,sources).clips[two]?.join()).toMatch(/영상 길이 안에서/);
    const voice=ok(addClip(t,c,"voice")).timeline,vid=voice.audio[2].id;expect(audioProblems(updateClip(voice,vid,{duckUnderVoice:true}),sources).clips[vid]).toEqual([expect.stringMatching(/배경 음악에만/)]);
    // three songs at once
    const d=src({durationMs:10000});
    const triple:TimelineV2={...t,audio:[...t.audio.map(clip=>({...clip,startFrame:0})),{...t.audio[0],id:v7(),assetId:d.id,startFrame:0}],audioRights:[...t.audioRights,{assetId:d.id,sourceUrl:null,planName:null,createdOn:null,licenseNote:null}]};
    expect(audioProblems(triple,[...sources,d]).general.join()).toMatch(/세 곡 이상/);
    // every check above worked on copies: the draft it started from is unchanged
    expect(t.audio.map(clip=>[clip.startFrame,clip.durationFrames,clip.sourceInFrame,clip.fadeInFrames])).toEqual([[0,300,0,0],[300,300,0,0]]);
    expect(parseAudioTime("00:02.15")).toEqual({frame:75});expect(parseAudioTime("2.5")).toHaveProperty("error");expect(parseAudioTime("00:01.30")).toEqual({error:expect.stringMatching(/00~29/)});
    expect(parseGain("-6.26")).toEqual({gainDb:-6.3});expect(parseGain("13")).toHaveProperty("error");expect(parseGain("-60")).toEqual({gainDb:-60});expect(parseGain("abc")).toHaveProperty("error");
    expect(liveAudioFields({[`${one}:gainDb`]:{raw:"x",error:"e"},[`${v7()}:startFrame`]:{raw:"y",error:"e"}},t)).toEqual({[`${one}:gainDb`]:{raw:"x",error:"e"}});
  });
  it("곡 연결: 바뀌는 값(양끝 서서히 0·다음 곡 시작)을 미리 보여 주고 적용, 다른 소리는 그대로, 풀기·역할 변경·빼기 정합성",()=>{
    const a=src({durationMs:10000}),b=src({durationMs:10000}),v=src();
    let t=ok(addClip(v1(900),a,"music")).timeline;const one=t.audio[0].id;t=ok(addClip(t,b,"music")).timeline;const two=t.audio[1].id;
    t=ok(addClip(t,v,"voice")).timeline;const voice=t.audio[2].id;
    t=updateClip(updateClip(t,one,{fadeOutFrames:15,fadeInFrames:6}),two,{fadeInFrames:9});
    expect(joinCandidates(t,one).map(clip=>clip.id)).toEqual([two]);expect(joinCandidates(t,voice)).toEqual([]);
    const plan=planJoin(t,one,two,30);if("error" in plan)throw new Error(plan.error);
    expect(plan.changes).toEqual([{clipId:one,field:"fadeOutFrames",from:15,to:0},{clipId:two,field:"fadeInFrames",from:9,to:0},{clipId:two,field:"startFrame",from:300,to:270}]);
    expect(plan.problems).toEqual([]);expect(plan.timeline.audioJoins).toEqual([{fromClipId:one,toClipId:two,type:"crossfade",durationFrames:30,curve:"equalPower"}]);
    expect(plan.timeline.audio.find(clip=>clip.id===voice)).toEqual(t.audio.find(clip=>clip.id===voice));expect(plan.timeline.video).toBe(t.video);
    expect(timelineSchema.safeParse(plan.timeline).success).toBe(true);expect(joinCandidates(plan.timeline,one)).toEqual([]);expect(joinCandidates(plan.timeline,two)).toEqual([]);
    const tooLong=planJoin(t,one,two,300);expect("error" in tooLong?tooLong.error:tooLong.problems.join()).toMatch(/짧아야|길어요/);
    expect(planJoin(t,one,voice,10)).toHaveProperty("error");
    // role change drops the join (and ducking); removing a clip drops its join and the unused rights row
    const joined=updateClip(plan.timeline,one,{duckUnderVoice:true}),role=changeRole(joined,one,"effect");
    expect(role).toMatchObject({droppedJoins:1,duckOff:true});expect(role.timeline.audioJoins).toEqual([]);expect(role.timeline.audio.find(clip=>clip.id===one)).toMatchObject({role:"effect",duckUnderVoice:false});
    const removed=removeClip(plan.timeline,two);expect(removed.audioJoins).toEqual([]);expect(removed.audioRights.map(row=>row.assetId)).toEqual([a.id,v.id]);
    expect(removeJoin(plan.timeline,one).audioJoins).toEqual([]);
  });
  it("같은 파일을 두 번 써도 권리 기록은 한 줄, 하나를 빼도 남는다. 권리 칸 값 그대로·빈 값은 null, 잘못된 주소/공백은 권리 자리 오류",()=>{
    const a=src({durationMs:3000});let t=ok(addClip(v1(900),a,"effect")).timeline;t=ok(addClip(t,a,"effect")).timeline;
    expect(t.audio).toHaveLength(2);expect(t.audioRights).toHaveLength(1);expect(removeClip(t,t.audio[0].id).audioRights).toHaveLength(1);
    const filled=updateRights(t,a.id,{sourceUrl:"https://example.com/a",planName:"개인",createdOn:"2026-01-02",licenseNote:"메모"});expect(problemCount(audioProblems(filled,[a]))).toBe(0);
    expect(audioProblems(updateRights(t,a.id,{sourceUrl:"ftp://x"}),[a]).rights[a.id]).toEqual([expect.stringMatching(/출처 주소는/)]);expect(audioProblems(updateRights(t,a.id,{createdOn:"2026-13-40"}),[a]).rights[a.id]).toEqual([expect.stringMatching(/만든 날은/)]);
    expect(audioProblems(updateRights(t,a.id,{planName:" 앞 공백"}),[a]).rights[a.id]?.join()).toMatch(/앞뒤 공백/);
  });
  it("저장 뒤 고친 소리는 쉬운 말 목록과 복구 자료(적다 만 칸·고른 소리 포함)에 남고, '그 밖의 설정'에 섞이지 않는다",()=>{
    const a=src(),sent=v1(),started=ok(addClip(sent,a,"music")),later=updateClip(started.timeline,started.clipId,{gainDb:-6});
    const changes=audioLaterChanges(sent,later);expect(changes).toMatchObject({started:true,rights:true,joins:false});expect(changes.clips).toEqual([{id:started.clipId,change:"added",role:"music",assetId:a.id,fields:[]}]);
    const after=audioLaterChanges(started.timeline,later);expect(after.clips).toEqual([{id:started.clipId,change:"changed",role:"music",assetId:a.id,fields:["소리 크기"]}]);expect(hasAudioLaterChanges(after)).toBe(true);
    expect(otherThanSound(sent,later)).toBe(false);expect(otherThanSound(sent,{...later,aspect:"1:1"})).toBe(true);
    const json=JSON.parse(recoveryJson({projectId:"p",createdAt:"2026-11-17T00:00:00.000Z",sentFrom:{revision:1,timelineId:"t1",timelineRevision:1},ownSave:{revision:2,timelineId:"t2",timelineRevision:2},shown:{revision:3,timelineId:"t3",timelineRevision:3},
      sent,draft:later,timeFields:{},selectedTextId:null,selectedAtSend:null,audioFields:{[`${started.clipId}:startFrame`]:{raw:"00:0",error:"e"}},selectedAudioId:started.clipId,selectedAudioAtSend:null}));
    expect(json.draft).toEqual(later);expect(json.audioFields).toEqual({[`${started.clipId}:startFrame`]:{raw:"00:0",error:"e"}});expect(json.selectedAudioId).toBe(started.clipId);
    // an old caller without sound fields writes the file as before
    expect(Object.keys(JSON.parse(recoveryJson({projectId:"p",createdAt:"x",sentFrom:{revision:1,timelineId:null,timelineRevision:null},ownSave:{revision:2,timelineId:"t",timelineRevision:1},shown:{revision:3,timelineId:"u",timelineRevision:2},sent,draft:sent,timeFields:{},selectedTextId:null,selectedAtSend:null})))).not.toContain("audioFields");
  });
});

let root:string,handle:DatabaseHandle,storage:string;
beforeAll(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-t149-")));vi.stubEnv("DREAM_DATA_ROOT",join(root,"s5"));({handle,storage}=await s5Copy(join(root,"s5")));},120000);
afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});

describe("편집 화면 소리 목록과 실제 저장 (가상 s5)",()=>{
  it("소리 목록: 보관 안 된 소리만 새 후보, 저장본이 쓰는 보관·없는 파일은 행 유지, 소리 아닌 자료는 없음, 경로·해시 없음",()=>{
    saveTimeline(handle,null);
    const live=addSound(handle,storage,"쓸 곡","sine=f=440:d=4:sample_rate=48000"),gone=addSound(handle,storage,"지울 곡","sine=f=330:d=4:sample_rate=48000");
    const list=()=>editingService(handle).get(P).audioSources,mine=()=>list().filter(item=>[live.id,gone.id].includes(item.id));
    expect(mine()).toEqual(expect.arrayContaining([expect.objectContaining({id:live.id,title:"쓸 곡",kind:"audio",durationMs:4000,archived:false,available:true})]));
    expect(list().every(item=>item.kind==="audio")).toBe(true);expect(JSON.stringify(list())).not.toMatch(/library\/|sha256|[A-Za-z]:\\/);
    // the saved timeline names `gone`; then it is archived and its file removed: still listed, marked
    const data=editingService(handle).get(P),sources=data.audioSources,result=ok(addClip(data.draft,sources.find(item=>item.id===gone.id)!,"music"));
    const project=jobsRepository(handle).project(P)!;timelineService(handle).save(P,project.contentRevision,project.currentTimelineRevId,result.timeline);
    libraryRepository(handle).archiveAsset(gone.id);rmSync(gone.file);libraryRepository(handle).archiveAsset(live.id);
    const after=list();expect(after.find(item=>item.id===gone.id)).toMatchObject({archived:true,available:false});expect(after.some(item=>item.id===live.id)).toBe(false);
    const saved=editingService(handle).get(P),clip=(saved.draft as TimelineV2).audio[0];
    expect(fileNote(clip,saved.draft,after.find(item=>item.id===gone.id))).toMatch(/저장한 그대로는 남겨 둘 수 있어요/);
    expect(fileNote({...clip,gainDb:-3},saved.draft,after.find(item=>item.id===gone.id))).toMatch(/이 상태로는 저장할 수 없어요/);
    // text-only change of that version keeps the archived clip byte for byte (server carried exception)
    const textOnly={...saved.draft,text:saved.draft.text.map((layer,index)=>index===0?{...layer,box:{...layer.box,y:Math.round((layer.box.y+0.01)*1000)/1000}}:layer)};expect(saved.draft.text.length).toBeGreaterThan(0);
    const p2=jobsRepository(handle).project(P)!,next=timelineService(handle).save(P,p2.contentRevision,p2.currentTimelineRevId,textOnly);
    expect(next.created).toBe(true);expect((editingService(handle).get(P).draft as TimelineV2).audio).toEqual([clip]);
    // changing that clip is refused by the server
    const p3=jobsRepository(handle).project(P)!,changed=updateClip(editingService(handle).get(P).draft as TimelineV2,clip.id,{gainDb:-3});
    expect(()=>timelineService(handle).save(P,p3.contentRevision,p3.currentTimelineRevId,changed)).toThrow();
    libraryRepository(handle).archiveAsset(live.id,false);
  },120000);
  it("v1 저장본 → 사용자가 소리를 넣어 v2로 저장, 역할·구간·크기·서서히·덮킹·곡 연결·권리 왕복, 다시 읽어도 같은 값",()=>{
    saveTimeline(handle,null);const before=editingService(handle).get(P);expect(before.draft.schemaVersion).toBe(1);
    const voice=addSound(handle,storage,"목소리","sine=f=300:d=6:sample_rate=44100","wav",["-ac","1"]),m1=addSound(handle,storage,"곡1","sine=f=440:d=20:sample_rate=48000"),m2=addSound(handle,storage,"곡2","sine=f=550:d=20:sample_rate=48000");
    const sources=editingService(handle).get(P).audioSources,find=(id:string)=>sources.find(item=>item.id===id)!;
    const D=outputFrames(before.draft);expect(D).toBeGreaterThan(60);
    let t=ok(addClip(before.draft,find(m1.id),"music")).timeline;const one=t.audio[0].id;
    t=updateClip(t,one,{durationFrames:Math.min(t.audio[0].durationFrames,Math.floor(D/2)+15),duckUnderVoice:true,gainDb:-4.5,fadeInFrames:6});
    const second=ok(addClip(t,find(m2.id),"music"));t=second.timeline;
    const plan=planJoin(updateClip(t,second.clipId,{fadeOutFrames:3}),one,second.clipId,15);if("error" in plan)throw new Error(plan.error);expect(plan.problems).toEqual([]);t=plan.timeline;
    t=ok(addClip(t,find(voice.id),"voice")).timeline;const v=t.audio.at(-1)!.id;t=updateClip(t,v,{startFrame:10,sourceInFrame:15,durationFrames:30,fadeInFrames:3,fadeOutFrames:3});
    t=updateRights(t,m1.id,{sourceUrl:"https://example.com/song1",planName:"개인 이용",createdOn:"2026-10-01",licenseNote:"직접 확인 필요"});
    expect(problemCount(audioProblems(t,sources))).toBe(0);
    const project=jobsRepository(handle).project(P)!,saved=timelineService(handle).save(P,project.contentRevision,project.currentTimelineRevId,t);expect(saved.created).toBe(true);
    const back=editingService(handle).get(P);expect(back.draft.schemaVersion).toBe(2);expect(canonicalJson({...back.draft,video:null})).toBe(canonicalJson({...t,video:null}));
    expect(back.revision).toBe(project.contentRevision+1);
    // CAS: a save from the old revision is refused and nothing changes
    expect(()=>timelineService(handle).save(P,project.contentRevision,project.currentTimelineRevId,updateClip(t,v,{gainDb:-1}))).toThrow();
    expect(canonicalJson(editingService(handle).get(P).draft)).toBe(canonicalJson(back.draft));
  },120000);
});
