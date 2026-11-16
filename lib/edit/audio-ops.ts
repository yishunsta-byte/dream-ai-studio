import { v7 } from "uuid";
import { AUDIO_MIX_PROFILE, audioIssues, canonicalJson, FPS, outputFrames, timelineV2Schema, type Timeline, type TimelineAudioClip, type TimelineV2 } from "./timeline";
import { parseFrameTime } from "./text-ops";
import { formatFrameTime } from "./preview";

// P2-5 U2 (T-146 4장, T-149): the sound part of the editing draft. Pure and client-safe; each operation returns a new
// timeline and never changes its input. The saved contract is timeline v2 as it is (lib/edit/timeline.ts); the server
// checks it again (timelineService.checkAudio) and owns the file rules (archived / missing / bytes).

// What the editor knows about a sound file (read-only list from the editing loader).
export type AudioSource={id:string;title:string;kind:"audio";mime:string|null;durationMs:number|null;isMock:boolean;archived:boolean;available:boolean;sourceUrl:string|null;rightsNote:string|null};
export type AudioRole=TimelineAudioClip["role"];
export const ROLE_LABEL:Record<AudioRole,string>={voice:"목소리",music:"배경 음악",effect:"효과음"};
type Join=TimelineV2["audioJoins"][number];
type Rights=TimelineV2["audioRights"][number];

// Whole 30 fps frames of a file (the server's rule: floor(durationMs × 30 / 1000)); null when the length is unknown.
export const sourceFrames=(durationMs:number|null)=>durationMs!==null&&Number.isSafeInteger(durationMs)&&durationMs>0?Math.floor(durationMs*FPS/1000):null;

// v1 is never turned into v2 by reading. The person starts sound → a v2 draft with every required field. A v1 with a
// non-empty sound list (no source range) cannot be converted (T-132: no guessed conversion).
export function canAddSound(timeline:Timeline){return timeline.schemaVersion===2||timeline.audio.length===0;}
export function asV2(timeline:Timeline):TimelineV2|null{
  if(timeline.schemaVersion===2)return timeline;if(timeline.audio.length)return null;
  return {schemaVersion:2,fps:timeline.fps,aspect:timeline.aspect,video:timeline.video,text:timeline.text,audio:[],audioJoins:[],audioMixProfile:AUDIO_MIX_PROFILE,audioRights:[]};
}
const emptyRights=(assetId:string):Rights=>({assetId,sourceUrl:null,planName:null,createdOn:null,licenseNote:null});

export type AddResult={timeline:TimelineV2;clipId:string;startFrame:number;durationFrames:number}|{error:string};
// A new clip: start 0 (a second song goes after the last song ends), used length min(whole file frames, space left in
// the output length D). Sound never makes the video longer; nothing overlapping is saved silently.
export function addClip(timeline:Timeline,source:AudioSource,role:AudioRole):AddResult{
  const base=asV2(timeline);if(!base)return {error:"이 타임라인의 예전 소리 기록은 바꿀 수 없어요. 소리를 넣으려면 새 소리 설정이 필요해요."};
  if(source.archived||!source.available)return {error:"보관했거나 파일이 없는 소리는 새로 넣을 수 없어요."};
  const whole=sourceFrames(source.durationMs);if(whole===null)return {error:"소리 파일의 길이를 알 수 없어요. 다른 파일을 골라 주세요."};
  if(whole<1)return {error:"1/30초보다 짧은 소리는 넣을 수 없어요."};
  const end=outputFrames(base);if(end<1)return {error:"영상 길이가 정해지지 않아 소리를 넣을 수 없어요. 장면을 먼저 준비해 주세요."};
  const songs=base.audio.filter(clip=>clip.role==="music");
  const start=role==="music"&&songs.length?Math.max(...songs.map(clip=>clip.startFrame+clip.durationFrames)):0;
  if(start>=end)return {error:"앞 곡 뒤에 남은 영상 시간이 없어요. 앞 곡을 줄이거나 곡 연결을 써 주세요."};
  const durationFrames=Math.min(whole,end-start),id=v7();
  const clip:TimelineAudioClip={id,assetId:source.id,role,startFrame:start,sourceInFrame:0,durationFrames,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false};
  const audioRights=base.audioRights.some(row=>row.assetId===source.id)?base.audioRights:[...base.audioRights,emptyRights(source.id)];
  return {timeline:{...base,audio:[...base.audio,clip],audioRights},clipId:id,startFrame:start,durationFrames};
}
// Removing a clip removes its joins and the rights row of a file no other clip uses (draft only: the file and the
// saved versions stay).
export function removeClip(timeline:TimelineV2,id:string):TimelineV2{
  const clip=timeline.audio.find(item=>item.id===id);if(!clip)return timeline;
  const audio=timeline.audio.filter(item=>item.id!==id),used=new Set(audio.map(item=>item.assetId));
  return {...timeline,audio,audioJoins:timeline.audioJoins.filter(join=>join.fromClipId!==id&&join.toClipId!==id),audioRights:timeline.audioRights.filter(row=>used.has(row.assetId))};
}
export type ClipPatch=Partial<Pick<TimelineAudioClip,"startFrame"|"sourceInFrame"|"durationFrames"|"gainDb"|"fadeInFrames"|"fadeOutFrames"|"duckUnderVoice">>;
export function updateClip(timeline:TimelineV2,id:string,patch:ClipPatch):TimelineV2{
  return {...timeline,audio:timeline.audio.map(clip=>clip.id===id?{...clip,...patch}:clip)};
}
// A role other than music has no ducking and no song join; those are dropped with the change (and said by the caller).
export function changeRole(timeline:TimelineV2,id:string,role:AudioRole):{timeline:TimelineV2;droppedJoins:number;duckOff:boolean}{
  const clip=timeline.audio.find(item=>item.id===id);if(!clip||clip.role===role)return {timeline,droppedJoins:0,duckOff:false};
  const toMusic=role==="music",joins=toMusic?timeline.audioJoins:timeline.audioJoins.filter(join=>join.fromClipId!==id&&join.toClipId!==id);
  return {timeline:{...timeline,audio:timeline.audio.map(item=>item.id===id?{...item,role,duckUnderVoice:toMusic?item.duckUnderVoice:false}:item),audioJoins:joins},droppedJoins:timeline.audioJoins.length-joins.length,duckOff:!toMusic&&clip.duckUnderVoice};
}
export function updateRights(timeline:TimelineV2,assetId:string,patch:Partial<Omit<Rights,"assetId">>):TimelineV2{
  return {...timeline,audioRights:timeline.audioRights.map(row=>row.assetId===assetId?{...row,...patch}:row)};
}

// Joining two songs (crossfade X): the next song starts X before the first ends, and the fades on the joined sides are
// 0 (the join is that fade). The plan lists every value it changes so the person confirms them; other clips, scenes
// and texts are never moved.
export type JoinChange={clipId:string;field:"fadeOutFrames"|"fadeInFrames"|"startFrame";from:number;to:number};
export type JoinPlan={timeline:TimelineV2;changes:JoinChange[];problems:string[]}|{error:string};
export function joinCandidates(timeline:TimelineV2,fromId:string){
  const from=timeline.audio.find(clip=>clip.id===fromId);if(!from||from.role!=="music"||timeline.audioJoins.some(join=>join.fromClipId===fromId))return [];
  return timeline.audio.filter(clip=>clip.id!==fromId&&clip.role==="music"&&!timeline.audioJoins.some(join=>join.toClipId===clip.id||(join.fromClipId===clip.id&&join.toClipId===fromId)));
}
export function planJoin(timeline:TimelineV2,fromId:string,toId:string,durationFrames:number):JoinPlan{
  const from=timeline.audio.find(clip=>clip.id===fromId),to=timeline.audio.find(clip=>clip.id===toId);
  if(!from||!to||from.role!=="music"||to.role!=="music"||from.id===to.id)return {error:"곡 연결은 서로 다른 배경 음악 두 곡에만 써요."};
  if(!Number.isSafeInteger(durationFrames)||durationFrames<1)return {error:"겹치는 시간은 1/30초 이상이어야 해요."};
  const start=from.startFrame+from.durationFrames-durationFrames;if(start<0)return {error:"겹치는 시간이 앞 곡보다 길어요."};
  const changes:JoinChange[]=[];
  if(from.fadeOutFrames)changes.push({clipId:from.id,field:"fadeOutFrames",from:from.fadeOutFrames,to:0});
  if(to.fadeInFrames)changes.push({clipId:to.id,field:"fadeInFrames",from:to.fadeInFrames,to:0});
  if(to.startFrame!==start)changes.push({clipId:to.id,field:"startFrame",from:to.startFrame,to:start});
  const others=timeline.audioJoins.filter(join=>!(join.fromClipId===fromId&&join.toClipId===toId));
  const join:Join={fromClipId:fromId,toClipId:toId,type:"crossfade",durationFrames,curve:"equalPower"};
  const next:TimelineV2={...timeline,audio:timeline.audio.map(clip=>clip.id===fromId?{...clip,fadeOutFrames:0}:clip.id===toId?{...clip,fadeInFrames:0,startFrame:start}:clip),audioJoins:[...others,join]};
  const problems=[...new Set(audioIssues(next).filter(issue=>issue.path[0]==="audioJoins"||(issue.path[0]==="audio"&&[fromId,toId].includes(next.audio[issue.path[1] as number]?.id))).map(issue=>issue.message))];
  return {timeline:next,changes,problems};
}
export function removeJoin(timeline:TimelineV2,fromId:string):TimelineV2{return {...timeline,audioJoins:timeline.audioJoins.filter(join=>join.fromClipId!==fromId)};}

// Typed fields that are not a valid value yet ("<clipId>:<field>" → raw text + message). The draft keeps the last good
// value; only fields of clips still in the draft count (like the text time fields).
export type AudioField="startFrame"|"sourceInFrame"|"durationFrames"|"fadeInFrames"|"fadeOutFrames"|"gainDb"|"join";
export type AudioRawState=Record<string,{raw:string;error:string}>;
export const AUDIO_FIELD_LABEL:Record<AudioField,string>={startFrame:"영상 안 시작",sourceInFrame:"원본에서 가져올 시작",durationFrames:"사용 길이",fadeInFrames:"처음 서서히",fadeOutFrames:"끝 서서히",gainDb:"소리 크기",join:"곡 연결 겹침"};
export function liveAudioFields(fields:AudioRawState,timeline:Timeline):AudioRawState{
  const ids=new Set(timeline.schemaVersion===2?timeline.audio.map(clip=>clip.id):[]);
  return Object.fromEntries(Object.entries(fields).filter(([key])=>ids.has(key.split(":")[0])));
}
// MM:SS.FF (a length too: 00:01.15 = 1.5 s). Returns frames or the message to show.
export function parseAudioTime(raw:string):{frame:number}|{error:string}{
  const parsed=parseFrameTime(raw);if("frame" in parsed)return parsed;
  return {error:parsed.error==="format"?"시간은 00:02.15처럼 적어 주세요(1/30초 단위).":"프레임은 00~29까지예요."};
}
export function parseGain(raw:string):{gainDb:number}|{error:string}{
  const text=raw.trim();if(!/^[-+]?\d+(\.\d+)?$/.test(text))return {error:"소리 크기는 -60에서 12 사이 숫자(dB)로 적어 주세요."};
  const value=Number(text);if(value<-60||value>12)return {error:"소리 크기는 -60에서 12 사이(dB)예요."};
  return {gainDb:Math.round(value*10)/10};
}
export const audioTime=(frames:number)=>formatFrameTime(frames);

// Problems of the draft's sound part, by place (client-safe schema + the file range when the length is known). The
// server checks again and owns archived / missing / changed bytes.
export type AudioProblems={clips:Record<string,string[]>;joins:Record<string,string[]>;rights:Record<string,string[]>;general:string[]};
export function audioProblems(timeline:Timeline,sources:readonly AudioSource[]):AudioProblems{
  const out:AudioProblems={clips:{},joins:{},rights:{},general:[]};if(timeline.schemaVersion!==2)return out;
  const push=(map:Record<string,string[]>,key:string,message:string)=>{const list=map[key]??=[];if(!list.includes(message))list.push(message);};
  const parsed=timelineV2Schema.safeParse(timeline);
  if(!parsed.success)for(const raw of parsed.error.issues){const [area,index]=raw.path as (string|number)[],issue={message:plainMessage(raw.path.at(-1),raw.message)};
    if(area==="audio"&&typeof index==="number"&&timeline.audio[index])push(out.clips,timeline.audio[index].id,issue.message);
    else if(area==="audioJoins"&&typeof index==="number"&&timeline.audioJoins[index])push(out.joins,timeline.audioJoins[index].fromClipId,issue.message);
    else if(area==="audioRights"&&typeof index==="number"&&timeline.audioRights[index])push(out.rights,timeline.audioRights[index].assetId,issue.message);
    else if((area==="audio"||area==="audioJoins"||area==="audioRights")&&!out.general.includes(issue.message))out.general.push(issue.message);}
  const byId=new Map(sources.map(source=>[source.id,source]));
  for(const clip of timeline.audio){const whole=sourceFrames(byId.get(clip.assetId)?.durationMs??null);
    if(whole!==null&&clip.sourceInFrame+clip.durationFrames>whole)push(out.clips,clip.id,`원본 파일 길이(${audioTime(whole)})를 넘어요. 가져올 시작이나 사용 길이를 줄여 주세요.`);}
  return out;
}
// The schema's own messages for a field format are English: shown in plain Korean instead.
const FIELD_MESSAGE:Record<string,string>={sourceUrl:"출처 주소는 http:// 또는 https://로 시작하는 주소로 적거나 비워 두세요.",createdOn:"만든 날은 2026-10-01처럼 적거나 비워 두세요.",planName:"요금제·이용 조건 이름은 120자 안으로 앞뒤 공백 없이 적거나 비워 두세요.",licenseNote:"라이선스 메모는 1000자 안으로 앞뒤 공백 없이 적거나 비워 두세요."};
function plainMessage(field:PropertyKey|undefined,message:string){if(/[가-힣]/.test(message))return message;return (typeof field==="string"&&FIELD_MESSAGE[field])||"소리 설정을 확인해 주세요.";}
export const problemCount=(problems:AudioProblems)=>Object.values(problems.clips).flat().length+Object.values(problems.joins).flat().length+Object.values(problems.rights).flat().length+problems.general.length;
// A clip whose file is archived or missing can be kept as saved, but not changed or newly added (server rule).
export function fileNote(clip:TimelineAudioClip,saved:Timeline,source:AudioSource|undefined):string|null{
  const carried=saved.schemaVersion===2&&saved.audio.some(item=>item.id===clip.id&&canonicalJson(item)===canonicalJson(clip));
  if(!source)return "보관함에서 이 파일을 찾을 수 없어요. 저장한 그대로만 둘 수 있고, 렌더에서 막혀요.";
  if(source.archived||!source.available)return `${source.archived?"보관한 파일이에요.":"파일이 없어요."} ${carried?"저장한 그대로는 남겨 둘 수 있어요. 바꾸면 저장할 수 없어요.":"이 상태로는 저장할 수 없어요. 저장한 값으로 되돌리거나 빼 주세요."}`;
  return null;
}

// What changed in the sound part after a save was sent (T-098 recovery list), in plain words.
export type AudioLaterChanges={clips:{id:string;change:"added"|"removed"|"changed";role:AudioRole;assetId:string;fields:string[]}[];joins:boolean;rights:boolean;started:boolean};
const CLIP_FIELD_LABEL:Record<string,string>={role:"역할",startFrame:"영상 안 시작",sourceInFrame:"원본에서 가져올 시작",durationFrames:"사용 길이",gainDb:"소리 크기",fadeInFrames:"처음 서서히",fadeOutFrames:"끝 서서히",duckUnderVoice:"목소리에 맞춰 낮춤",assetId:"파일"};
export function audioLaterChanges(sent:Timeline,later:Timeline):AudioLaterChanges{
  const a=sent.schemaVersion===2?sent:null,b=later.schemaVersion===2?later:null;
  const before=new Map((a?.audio??[]).map(clip=>[clip.id,clip])),now=new Set((b?.audio??[]).map(clip=>clip.id)),clips:AudioLaterChanges["clips"]=[];
  for(const clip of b?.audio??[]){const old=before.get(clip.id);
    if(!old){clips.push({id:clip.id,change:"added",role:clip.role,assetId:clip.assetId,fields:[]});continue;}
    const fields=Object.keys(CLIP_FIELD_LABEL).filter(key=>canonicalJson((old as Record<string,unknown>)[key])!==canonicalJson((clip as Record<string,unknown>)[key])).map(key=>CLIP_FIELD_LABEL[key]);
    if(fields.length)clips.push({id:clip.id,change:"changed",role:clip.role,assetId:clip.assetId,fields});}
  for(const clip of a?.audio??[])if(!now.has(clip.id))clips.push({id:clip.id,change:"removed",role:clip.role,assetId:clip.assetId,fields:[]});
  return {clips,joins:canonicalJson(a?.audioJoins??[])!==canonicalJson(b?.audioJoins??[]),rights:canonicalJson(a?.audioRights??[])!==canonicalJson(b?.audioRights??[]),started:!a&&!!b};
}
export const hasAudioLaterChanges=(changes:AudioLaterChanges)=>changes.clips.length>0||changes.joins||changes.rights||changes.started;
// "그 밖의 타임라인 설정" without the sound part (listed on its own above).
export function otherThanSound(sent:Timeline,later:Timeline){
  const rest=(timeline:Timeline)=>{const {text:_t,video:_v,audio:_a,...others}=timeline as Record<string,unknown>;void _t;void _v;void _a;
    delete others.audioJoins;delete others.audioRights;delete others.audioMixProfile;delete others.schemaVersion;return canonicalJson(others);};
  return rest(sent)!==rest(later);
}
