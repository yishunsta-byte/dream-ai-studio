import { z } from "zod";
import type { EditInput, TextLayer as P1TextLayer } from "./schema";
import { READABLE_FONT_FAMILIES } from "./fonts";

// P2-1 timeline (PLAN 11.2·11.3, T-060, spec text-presets.json migration.fromP1Values). Pure and client-safe: the
// editing screen builds the timeline it saves with these helpers, and the server checks it again with the same rules.
export const FPS=30;
export const MAX_FRAMES=7200*FPS;
export const P1_BOX_X=0.44,P1_WIDTH_RATIO=0.76;
export const P1_Y_BY_POSITION={top:0.16,middle:0.5,bottom:0.74} as const;
export type P1Position=keyof typeof P1_Y_BY_POSITION;
// maxLines per kind from spec presets[].style.maxLines (warning only; text is never cut).
export const MAX_LINES_BY_KIND={subtitle:2,hook:2,emphasis:1,title:2,ending:2,lyric:2,brand:1,disclosure:1} as const;
export const TEXT_KINDS=["subtitle","hook","emphasis","title","ending","lyric","brand","disclosure"] as const;

const hex=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const frame=z.number().int().min(0).max(MAX_FRAMES);
const ref=z.uuid();
export const clipSchema=z.strictObject({
  id:ref,sceneId:ref,sceneVersionId:ref.nullable(),assetId:ref.nullable(),
  durationFrames:z.number().int().min(1).max(MAX_FRAMES),trimInFrames:frame,trimOutFrames:frame,
  transition:z.strictObject({type:z.literal("cut"),durationFrames:z.literal(0)}),
}).refine(clip=>(clip.sceneVersionId===null)===(clip.assetId===null),{message:"빈 자리는 버전과 자료가 함께 비어 있어야 해요."});
export const audioClipSchema=z.strictObject({id:ref,assetId:ref,role:z.enum(["voice","music","effect"]),startFrame:frame,gainDb:z.number().min(-60).max(12),fadeInFrames:frame,fadeOutFrames:frame,duckUnderVoice:z.boolean()});
const shadow=z.strictObject({color:hex,opacity:z.number().min(0).max(1),blur:z.number().min(0).max(100),x:z.number().min(-100).max(100),y:z.number().min(-100).max(100)});
const background=z.strictObject({color:hex,opacity:z.number().min(0).max(1),paddingX:z.number().min(0).max(200),paddingY:z.number().min(0).max(200),radius:z.number().min(0).max(200)});
export const timelineTextSchema=z.strictObject({
  id:z.uuidv7(),kind:z.enum(TEXT_KINDS),content:z.string().max(500).refine(text=>text.trim().length>0,{message:"문구를 적어 주세요."}),speakerCharacterId:ref.nullable(),
  // P2-3: any readable family (append-only list); the server allows only selectable ones for new or changed text.
  style:z.strictObject({fontFamily:z.enum(READABLE_FONT_FAMILIES),fontSize:z.number().int().min(18).max(120),fontWeight:z.number().int().min(100).max(900),color:hex,
    stroke:z.strictObject({color:hex,width:z.number().min(0).max(40)}).nullable(),shadow:shadow.nullable(),background:background.nullable(),
    align:z.enum(["left","center","right"]),letterSpacing:z.number().min(-1).max(1),lineHeight:z.number().min(0.8).max(3),maxLines:z.number().int().min(1).max(10)}),
  box:z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1),anchor:z.enum(["center","top-left"]),widthRatio:z.number().min(0.05).max(1),rotation:z.number().min(-180).max(180)}),
  timing:z.strictObject({startFrame:frame,endFrame:z.number().int().min(1).max(MAX_FRAMES)}),
  animation:z.strictObject({in:z.enum(["none","fade","pop","slide-up","typewriter"]),out:z.enum(["none","fade","slide-down"]),emphasis:z.enum(["none","bounce","shake","scale"]),durationFrames:z.number().int().min(0).max(300),easing:z.enum(["linear","ease-out","ease-in-out"])}),
  locked:z.boolean(),
}).refine(layer=>layer.timing.endFrame>layer.timing.startFrame,{message:"끝은 시작보다 1프레임 이상 뒤여야 해요."});
const uniqueVideo=(value:{video:{id:string;sceneId:string}[]})=>new Set(value.video.map(clip=>clip.id)).size===value.video.length&&new Set(value.video.map(clip=>clip.sceneId)).size===value.video.length;
const uniqueText=(value:{text:{id:string}[]})=>new Set(value.text.map(layer=>layer.id)).size===value.text.length;
// v1 (P2-1): read as stored. Its `audio` has no source range, so a non-empty v1 audio list is kept byte for byte but is
// never saved again, converted or rendered (T-132, Master: no guessed conversion).
export const timelineV1Schema=z.strictObject({
  schemaVersion:z.literal(1),fps:z.literal(FPS),aspect:z.enum(["9:16","16:9","1:1"]),
  video:z.array(clipSchema).max(100),audio:z.array(audioClipSchema).max(100),text:z.array(timelineTextSchema).max(100),
}).refine(uniqueVideo,{message:"장면과 클립은 한 번씩만 넣어 주세요."})
  .refine(uniqueText,{message:"글자 항목이 겹쳐요."});

// ── P2-5A timeline v2 (T-130 4.1, T-132). Saved only when the client sends schemaVersion 2 (opt-in); a v1 row is never
// rewritten as v2 by reading. Times are whole 30 fps frames; the mix uses 48 kHz, so one frame is exactly 1600 samples.
export const AUDIO_SAMPLE_RATE=48000;
export const SAMPLES_PER_FRAME=AUDIO_SAMPLE_RATE/FPS;
export const AUDIO_MIX_PROFILE="p2-5-local-v1";
export const AUDIO_ROLES=["voice","music","effect"] as const;
const AUDIO_CHECK="소리 설정을 확인해 주세요.";
export const audioClipV2Schema=z.strictObject({
  id:ref,assetId:ref,role:z.enum(AUDIO_ROLES),
  startFrame:frame,                                              // where it starts in the video
  sourceInFrame:frame,durationFrames:z.number().int().min(1).max(MAX_FRAMES),// the part of the file it uses
  gainDb:z.number().min(-60).max(12),fadeInFrames:frame,fadeOutFrames:frame,duckUnderVoice:z.boolean(),
});
export const audioJoinSchema=z.strictObject({fromClipId:ref,toClipId:ref,type:z.literal("crossfade"),durationFrames:z.number().int().min(1).max(MAX_FRAMES),curve:z.literal("equalPower")});
const rightsText=(max:number)=>z.string().max(max).refine(value=>value.trim()===value&&value.length>0,{message:"앞뒤 공백 없이 적거나 비워 두세요."}).nullable();
// Rights as recorded for THIS version (one row per audio file the version uses). A filled row is a record, not a
// license decision: it never passes a review item by itself. Empty values mean "직접 확인 필요".
export const audioRightsSchema=z.strictObject({
  assetId:ref,sourceUrl:z.url({protocol:/^https?$/}).max(2000).nullable(),planName:rightsText(120),
  createdOn:z.iso.date().nullable(),licenseNote:rightsText(1000),
});
type AudioClipV2=z.infer<typeof audioClipV2Schema>;
type AudioJoin=z.infer<typeof audioJoinSchema>;
type AudioRights=z.infer<typeof audioRightsSchema>;
type AudioIssue={path:(string|number)[];message:string};
// Output length D (T-132 Master): the video and the texts decide it; sound never makes a video longer or loops.
export const outputFrames=(timeline:{video:readonly {durationFrames:number}[];text:readonly {timing:{endFrame:number}}[]})=>Math.max(totalFrames(timeline.video),...timeline.text.map(layer=>layer.timing.endFrame));
// Every rule that needs only the timeline itself (asset rules are checked by the server against the database).
export function audioIssues(value:{video:readonly {durationFrames:number}[];text:readonly {timing:{endFrame:number}}[];audio:readonly AudioClipV2[];audioJoins:readonly AudioJoin[];audioRights:readonly AudioRights[]}):AudioIssue[]{
  const issues:AudioIssue[]=[],add=(path:(string|number)[],message:string)=>issues.push({path,message});
  const end=outputFrames(value),byId=new Map<string,AudioClipV2>();
  value.audio.forEach((clip,index)=>{
    if(byId.has(clip.id))add(["audio",index,"id"],"소리 항목이 겹쳐요.");byId.set(clip.id,clip);
    if(clip.startFrame+clip.durationFrames>end)add(["audio",index,"durationFrames"],"소리는 영상 길이 안에서 끝나야 해요. 소리로 영상을 늘리지 않아요.");
    if(clip.fadeInFrames+clip.fadeOutFrames>clip.durationFrames)add(["audio",index,"fadeOutFrames"],"처음·끝 서서히의 합이 소리 길이보다 길어요.");
    if(clip.duckUnderVoice&&clip.role!=="music")add(["audio",index,"duckUnderVoice"],"음성에 맞춰 낮추기는 배경 음악에만 써요.");
  });
  const incoming=new Map<string,AudioJoin>(),outgoing=new Map<string,AudioJoin>(),pair=(a:string,b:string)=>a<b?`${a}|${b}`:`${b}|${a}`,joined=new Set<string>();
  value.audioJoins.forEach((join,index)=>{
    const from=byId.get(join.fromClipId),to=byId.get(join.toClipId),at=(field:string)=>["audioJoins",index,field];
    if(!from||!to){add(at(from?"toClipId":"fromClipId"),"이어 붙일 소리를 찾을 수 없어요.");return;}
    if(from.id===to.id||from.role!=="music"||to.role!=="music"){add(at("fromClipId"),"곡 사이 겹치기는 서로 다른 배경 음악 두 곡에만 써요.");return;}
    if(outgoing.has(from.id)||incoming.has(to.id)||joined.has(pair(from.id,to.id))){add(at("fromClipId"),"한 곡은 앞뒤로 한 번씩만 이어 붙일 수 있어요.");return;}
    outgoing.set(from.id,join);incoming.set(to.id,join);joined.add(pair(from.id,to.id));
    if(to.startFrame!==from.startFrame+from.durationFrames-join.durationFrames)add(at("durationFrames"),"다음 곡은 앞 곡 끝에서 겹치는 시간만큼 앞에서 시작해야 해요.");
    // The join is the fade between the two songs: the clip's own fade on that side stays 0 (never applied twice).
    if(from.fadeOutFrames||to.fadeInFrames)add(at("durationFrames"),"곡 사이 겹치기 쪽에는 따로 서서히를 넣지 않아요.");
    if(join.durationFrames+from.fadeInFrames>=from.durationFrames||join.durationFrames+to.fadeOutFrames>=to.durationFrames)add(at("durationFrames"),"겹치는 시간은 두 곡의 사용 길이보다 짧아야 해요.");
  });
  for(const clip of value.audio){const a=incoming.get(clip.id),b=outgoing.get(clip.id);if(a&&b&&a.durationFrames+b.durationFrames>=clip.durationFrames)add(["audio",value.audio.indexOf(clip),"durationFrames"],"앞뒤 겹치는 시간이 이 곡보다 길어 세 곡이 겹쳐요.");}
  // Music: two songs may overlap only through their join; three at the same moment are refused.
  const music=value.audio.filter(clip=>clip.role==="music");
  for(let i=0;i<music.length;i++)for(let j=i+1;j<music.length;j++){const a=music[i],b=music[j];
    if(a.startFrame<b.startFrame+b.durationFrames&&b.startFrame<a.startFrame+a.durationFrames&&!joined.has(pair(a.id,b.id)))add(["audio",value.audio.indexOf(b),"startFrame"],"배경 음악은 곡 사이 겹치기로만 겹칠 수 있어요.");}
  const edges=music.flatMap(clip=>[[clip.startFrame,1],[clip.startFrame+clip.durationFrames,-1]] as const).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let live=0;
  for(const [,step] of edges){live+=step;if(live>2){add(["audio"],"배경 음악이 세 곡 이상 겹쳐요.");break;}}
  // Rights: exactly one record for each audio file the version uses.
  const used=new Set(value.audio.map(clip=>clip.assetId)),seen=new Set<string>();
  value.audioRights.forEach((row,index)=>{if(seen.has(row.assetId))add(["audioRights",index,"assetId"],"권리 기록이 겹쳐요.");else if(!used.has(row.assetId))add(["audioRights",index,"assetId"],"쓰지 않는 소리의 권리 기록이에요.");seen.add(row.assetId);});
  for(const assetId of used)if(!seen.has(assetId))add(["audioRights"],"쓰는 소리마다 권리 기록 한 줄이 필요해요(모르면 비워 두세요).");
  return issues;
}
export const timelineV2Schema=z.strictObject({
  schemaVersion:z.literal(2),fps:z.literal(FPS),aspect:z.enum(["9:16","16:9","1:1"]),
  video:z.array(clipSchema).max(100),text:z.array(timelineTextSchema).max(100),
  audio:z.array(audioClipV2Schema).max(100),audioJoins:z.array(audioJoinSchema).max(100),audioMixProfile:z.literal(AUDIO_MIX_PROFILE),audioRights:z.array(audioRightsSchema).max(100),
}).refine(uniqueVideo,{message:"장면과 클립은 한 번씩만 넣어 주세요."})
  .refine(uniqueText,{message:"글자 항목이 겹쳐요."})
  .superRefine((value,ctx)=>{for(const issue of audioIssues(value))ctx.addIssue({code:"custom",path:issue.path,message:issue.message||AUDIO_CHECK});});
export const timelineSchema=z.discriminatedUnion("schemaVersion",[timelineV1Schema,timelineV2Schema]);
export type Timeline=z.infer<typeof timelineSchema>;
export type TimelineV1=z.infer<typeof timelineV1Schema>;
export type TimelineV2=z.infer<typeof timelineV2Schema>;
export type TimelineAudioClip=AudioClipV2;
export type TimelineClip=z.infer<typeof clipSchema>;
export type TimelineText=z.infer<typeof timelineTextSchema>;

// spec secondsToFrames: round(seconds × 30), 0.5 rounds up, integers only (0.125 s → 4, 5.25 s → 158).
export function secondsToFrames(seconds:number){const ms=Math.round(seconds*1000);return Math.floor((ms*FPS+500)/1000);}
// For the static editor and SRT: frames back to whole milliseconds (round trip frame → ms → frame is exact).
export function framesToMs(frames:number){return Math.floor((frames*1000*2+FPS)/(FPS*2));}
export const framesToSeconds=(frames:number)=>framesToMs(frames)/1000;
export const totalFrames=(video:readonly {durationFrames:number}[])=>video.reduce((sum,clip)=>sum+clip.durationFrames,0);
// spec fromP1Values.endFrameLimit: a text may end at max(video total, project length × 30); P1 values moved by 0005 are not cut.
export const textEndLimit=(video:readonly {durationFrames:number}[],lengthSec:number)=>Math.max(totalFrames(video),lengthSec*FPS);

// Key-sorted JSON without spaces (arrays keep their order): the input of timeline_sha256 and of "same content".
export function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value!==null&&typeof value==="object")return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// spec migration.fromP1Values: P1 preview values as they are; presets are not applied. The content is kept byte for
// byte (a stored P1 value with outer spaces stays so); only text typed in the editor is trimmed (applyEditView).
export function textFromP1(layer:P1TextLayer,startFrame=secondsToFrames(layer.startSec),endFrame=Math.max(secondsToFrames(layer.endSec),startFrame+1)):TimelineText{
  return {id:layer.id,kind:layer.kind,content:layer.content,speakerCharacterId:null,
    style:{fontFamily:"Pretendard",fontSize:layer.fontSize,fontWeight:700,color:layer.color,stroke:null,shadow:null,background:null,align:"center",letterSpacing:0,lineHeight:1.3,maxLines:MAX_LINES_BY_KIND[layer.kind]},
    box:{x:P1_BOX_X,y:P1_Y_BY_POSITION[layer.position],anchor:"center",widthRatio:P1_WIDTH_RATIO,rotation:0},
    timing:{startFrame,endFrame},animation:{in:"none",out:"none",emphasis:"none",durationFrames:0,easing:"ease-out"},locked:layer.locked};
}
// The static editor shows three positions; any other box is shown at the nearest one (P2-3 brings free placement).
export function positionOfBox(box:{y:number}):P1Position{
  return (Object.entries(P1_Y_BY_POSITION) as [P1Position,number][]).reduce((best,[name,y])=>Math.abs(box.y-y)<Math.abs(box.y-P1_Y_BY_POSITION[best])?name:best,"top" as P1Position);
}
const P1_KINDS=["subtitle","hook","emphasis","title","ending","disclosure"] as const;
export const editableInStaticEditor=(layer:TimelineText)=>(P1_KINDS as readonly string[]).includes(layer.kind);
// The view (screen, bundle text, SRT) shows a text trimmed the way the P1 reader did; the stored row keeps its bytes.
export function editViewFromTimeline(timeline:Timeline):EditInput{
  return {sceneOrder:timeline.video.map(clip=>clip.sceneId),layers:timeline.text.filter(editableInStaticEditor).map(layer=>({id:layer.id,kind:layer.kind as P1TextLayer["kind"],content:layer.content.trim(),fontFamily:"Pretendard",fontSize:layer.style.fontSize,color:layer.style.color,position:positionOfBox(layer.box),startSec:framesToSeconds(layer.timing.startFrame),endSec:framesToSeconds(layer.timing.endFrame),locked:layer.locked}))};
}
// Static editor values on top of the timeline they were read from. Unchanged fields keep the base values exactly
// (box, style details, frames); `clips` are the server's clips for the current selection, keyed by scene.
export function applyEditView(base:Timeline,view:EditInput,clips:readonly TimelineClip[]):Timeline{
  const bySceneId=new Map(clips.map(clip=>[clip.sceneId,clip])),old=new Map(base.text.map(layer=>[layer.id,layer]));
  const text=view.layers.map(layer=>{
    const before=old.get(layer.id);if(!before)return textFromP1({...layer,content:layer.content.trim()});
    const startFrame=framesToSeconds(before.timing.startFrame)===layer.startSec?before.timing.startFrame:secondsToFrames(layer.startSec);
    const endFrame=framesToSeconds(before.timing.endFrame)===layer.endSec?before.timing.endFrame:Math.max(secondsToFrames(layer.endSec),startFrame+1);
    const box=positionOfBox(before.box)===layer.position?before.box:{...before.box,x:P1_BOX_X,y:P1_Y_BY_POSITION[layer.position],anchor:"center" as const,widthRatio:P1_WIDTH_RATIO};
    // The P1 input schema trims, so "same after trimming" means unchanged: the saved bytes (outer spaces too) stay.
    return {...before,kind:layer.kind,content:layer.content.trim()===before.content.trim()?before.content:layer.content.trim(),style:{...before.style,fontSize:layer.fontSize,color:layer.color},box,timing:{startFrame,endFrame},locked:layer.locked};
  });
  const kept=base.text.filter(layer=>!editableInStaticEditor(layer));
  return {...base,video:view.sceneOrder.map(sceneId=>{const clip=bySceneId.get(sceneId);if(!clip)throw new Error("장면 순서를 확인해 주세요.");return clip;}),text:[...text,...kept]};
}
export const sameClip=(a:TimelineClip,b:TimelineClip)=>a.sceneId===b.sceneId&&a.sceneVersionId===b.sceneVersionId&&a.assetId===b.assetId&&a.durationFrames===b.durationFrames&&a.trimInFrames===b.trimInFrames&&a.trimOutFrames===b.trimOutFrames;
// WebVTT from frames (P2-6, T-155): the same subtitle layers as the SRT, for timeline bundles only. UTF-8 without BOM,
// LF only; cue id = layer id; order start, end, id; overlapping cues kept (VTT shows them together); times are the
// same rounded milliseconds as the SRT (≤0.5 ms from the 30 fps frame edge). Cue text: trimmed like the SRT, line
// breaks made LF, empty lines dropped (an empty line would end the cue), & < > escaped (so "-->" cannot appear).
export function vttCueText(content:string){
  return content.trim().replace(/\r\n?/g,"\n").split("\n").filter(line=>line.trim()!=="").join("\n").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
export function timelineVtt(text:readonly TimelineText[]):string|null{
  const time=(frames:number)=>{const ms=framesToMs(frames);return `${String(Math.floor(ms/3600000)).padStart(2,"0")}:${String(Math.floor(ms/60000)%60).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;};
  const cues=text.filter(layer=>layer.kind==="subtitle").sort((a,b)=>a.timing.startFrame-b.timing.startFrame||a.timing.endFrame-b.timing.endFrame||(a.id<b.id?-1:a.id>b.id?1:0));
  if(!cues.length)return null;
  return "WEBVTT\n\n"+cues.map(layer=>`${layer.id}\n${time(layer.timing.startFrame)} --> ${time(layer.timing.endFrame)}\n${vttCueText(layer.content)}\n`).join("\n");
}
// SRT from frames (subtitle layers only), the same format as the P1 bundle.
export function timelineSrt(text:readonly TimelineText[]){
  const time=(frames:number)=>{const ms=framesToMs(frames);return `${String(Math.floor(ms/3600000)).padStart(2,"0")}:${String(Math.floor(ms/60000)%60).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")},${String(ms%1000).padStart(3,"0")}`;};
  return text.filter(layer=>layer.kind==="subtitle").sort((a,b)=>a.timing.startFrame-b.timing.startFrame).map((layer,index)=>`${index+1}\n${time(layer.timing.startFrame)} --> ${time(layer.timing.endFrame)}\n${layer.content.trim()}\n`).join("\n");
}
