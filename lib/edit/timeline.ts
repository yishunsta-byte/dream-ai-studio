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
export const timelineSchema=z.strictObject({
  schemaVersion:z.literal(1),fps:z.literal(FPS),aspect:z.enum(["9:16","16:9","1:1"]),
  video:z.array(clipSchema).max(100),audio:z.array(audioClipSchema).max(100),text:z.array(timelineTextSchema).max(100),
}).refine(value=>new Set(value.video.map(clip=>clip.id)).size===value.video.length&&new Set(value.video.map(clip=>clip.sceneId)).size===value.video.length,{message:"장면과 클립은 한 번씩만 넣어 주세요."})
  .refine(value=>new Set(value.text.map(layer=>layer.id)).size===value.text.length,{message:"글자 항목이 겹쳐요."});
export type Timeline=z.infer<typeof timelineSchema>;
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
// SRT from frames (subtitle layers only), the same format as the P1 bundle.
export function timelineSrt(text:readonly TimelineText[]){
  const time=(frames:number)=>{const ms=framesToMs(frames);return `${String(Math.floor(ms/3600000)).padStart(2,"0")}:${String(Math.floor(ms/60000)%60).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")},${String(ms%1000).padStart(3,"0")}`;};
  return text.filter(layer=>layer.kind==="subtitle").sort((a,b)=>a.timing.startFrame-b.timing.startFrame).map((layer,index)=>`${index+1}\n${time(layer.timing.startFrame)} --> ${time(layer.timing.endFrame)}\n${layer.content.trim()}\n`).join("\n");
}
