import "server-only";
import { v7 } from "uuid";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { checkP1MigratedRow, currentClips, P1SourceMismatchError, readTimelineRow, timelineSha256, type TimelineRow } from "@/lib/db/timeline-data";
import { requiredDisclosures, type EditInput, type EditSnapshot } from "@/lib/edit/schema";
import { canonicalJson, editViewFromTimeline, FPS, framesToSeconds, sameClip, textEndLimit, timelineSchema, totalFrames, type Timeline, type TimelineClip, type TimelineText } from "@/lib/edit/timeline";
import type { FontRef } from "@/lib/edit/fonts";
import { presetFor } from "@/lib/edit/presets";
import { selectableFonts } from "@/lib/fonts/registry";
import { finishingRepository } from "@/lib/repo/finishing";
import { jobsRepository } from "@/lib/repo/jobs";
import { timelineRepository } from "@/lib/repo/timeline";
import { workflowRepository } from "@/lib/repo/workflow";
import { assertPreviousApproved, assertRevision, WorkflowError, type StageState } from "@/lib/domain/stages";
import { checkStartup } from "./startup";
import { workflowService } from "./workflow";

// P2-1 timeline service (PLAN 11.2, T-060 3장, T-061). Reading never writes; saving and restoring are explicit and
// go through workflow.changeContent (content revision + 1, later stages invalidated) in one immediate transaction.
export const TIMELINE_CONFLICT="다른 창에서 먼저 저장했어요. 새로고침한 뒤 다시 고쳐 주세요.";
export const TIMELINE_P1_MISMATCH="옮긴 타임라인이 원래 글자 설정과 달라요(글자·장면 순서·클립). 데이터 상태를 확인해 주세요.";
export const FONT_UNAVAILABLE="이 글꼴은 아직 설치되지 않았어요. 다른 글꼴을 골라 주세요.";
export const FONT_WEIGHT_UNAVAILABLE="이 글꼴에 없는 굵기예요. 굵기를 다시 골라 주세요.";
export const TIMELINE_STALE="선택한 장면 결과가 타임라인을 저장한 뒤 바뀌었어요. 편집 화면에서 지금 선택으로 다시 저장해 주세요.";
const MAX_JSON=1024*1024;
const invalid=(message:string)=>new WorkflowError("INVALID_TRANSITION",message,400);
export type TimelineSummary={id:string;revision:number;source:TimelineRow["source"];contentRevision:number;createdAt:string;sha256:string;restoredFromId:string|null};
const summary=(row:TimelineRow):TimelineSummary=>({id:row.id,revision:row.revision,source:row.source,contentRevision:row.content_revision,createdAt:row.created_at,sha256:row.timeline_sha256,restoredFromId:row.restored_from_id});

// `fonts`: the selectable fonts (spec ∩ installed ∩ license); tests pass their own list.
export function timelineService(handle:DatabaseHandle,fonts:()=>readonly FontRef[]=selectableFonts){const repo=timelineRepository(handle),finishing=finishingRepository(handle),jobs=jobsRepository(handle),states=workflowRepository(handle),workflow=workflowService(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function project(projectId:string){const value=jobs.project(projectId);if(!value)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);return value;}
 function gated(projectId:string){const value=project(projectId);assertPreviousApproved("edit",states.stages(projectId) as StageState[]);return value;}
 function currentRow(projectId:string,pointer:string|null){if(!pointer)return null;const row=repo.row(pointer);if(!row||row.project_id!==projectId)throw new WorkflowError("STAGE_LOCKED","저장한 타임라인을 확인해 주세요.");return {row,timeline:readTimelineRow(row)};}
 // The clips of the current selection, in the saved order, keeping each scene's saved clip id (new scenes get a new one).
 function clipsFor(projectId:string,base:Timeline|null):TimelineClip[]{const ids=new Map(base?.video.map(clip=>[clip.sceneId,clip.id])??[]);return currentClips(handle.sqlite,projectId,base?.video.map(clip=>clip.sceneId)??[]).map(clip=>({id:ids.get(clip.sceneId)??v7(),...clip}));}
 function staleScenes(saved:Timeline,clips:TimelineClip[]){const now=new Map(clips.map(clip=>[clip.sceneId,clip]));const changed=saved.video.filter(clip=>{const next=now.get(clip.sceneId);return !next||!sameClip(clip,next);}).map(clip=>clip.sceneId);for(const clip of clips)if(!saved.video.some(old=>old.sceneId===clip.sceneId))changed.push(clip.sceneId);return changed;}
 function warnings(timeline:Timeline,lengthSec:number){const video=totalFrames(timeline.video);return {textBeyondVideo:timeline.text.filter(layer=>layer.timing.endFrame>video).map(layer=>layer.id),textBeyondLimit:timeline.text.filter(layer=>layer.timing.endFrame>textEndLimit(timeline.video,lengthSec)).map(layer=>layer.id),emptySlots:timeline.video.filter(clip=>clip.sceneVersionId===null).map(clip=>clip.sceneId)};}
 // State without the stage gate: the edit screen, review and export read the same answer.
 function state(projectId:string){
  const value=project(projectId),saved=currentRow(projectId,value.currentTimelineRevId),clips=clipsFor(projectId,saved?.timeline??null);
  const stale=saved?staleScenes(saved.timeline,clips):[];
  return {project:value,current:saved?summary(saved.row):null,row:saved?.row??null,timeline:saved?.timeline??null,clips,stale,warnings:saved?warnings(saved.timeline,value.lengthSec):{textBeyondVideo:[],textBeyondLimit:[],emptySlots:clips.filter(clip=>clip.sceneVersionId===null).map(clip=>clip.sceneId)}};
 }
 // T-060 2.2: every rule of the P1 save, in frames, plus the server-owned clip values.
 function check(projectId:string,input:unknown,base:Timeline|null){
  const value=project(projectId),timeline=timelineSchema.parse(input),json=canonicalJson(timeline);
  if(json.length>MAX_JSON)throw invalid("타임라인이 너무 커요. 글자와 장면 수를 줄여 주세요.");
  if(timeline.aspect!==value.aspect)throw invalid("화면 비율은 프로젝트와 같아야 해요.");
  if(timeline.audio.length)throw invalid("소리 줄은 다음 단계에서 열려요. 지금은 비워 두세요.");
  const server=clipsFor(projectId,base),byScene=new Map(server.map(clip=>[clip.sceneId,clip])),savedIds=new Map(base?.video.map(clip=>[clip.sceneId,clip.id])??[]);
  if(timeline.video.length!==server.length||timeline.video.some(clip=>!byScene.has(clip.sceneId)))throw invalid("현재 장면을 빠짐없이 한 번씩 배치해 주세요.");
  if(timeline.video.some(clip=>!sameClip(clip,byScene.get(clip.sceneId)!)||(savedIds.has(clip.sceneId)&&savedIds.get(clip.sceneId)!==clip.id)))throw new WorkflowError("CONFLICT","장면 결과가 지금 선택과 달라요. 새로고침한 뒤 다시 저장해 주세요.");
  const before=new Map(base?.text.map(layer=>[layer.id,layer])??[]),carried=(layer:TimelineText)=>{const old=before.get(layer.id);return !!old&&canonicalJson(old)===canonicalJson(layer);};
  // A text moved from P1 (or kept from the last save) may end after the limit; it is kept and warned about, never cut.
  // A new or changed text must end inside max(video frames, project length × 30).
  const limit=textEndLimit(timeline.video,value.lengthSec);
  if(timeline.text.some(layer=>layer.timing.endFrame>limit&&!carried(layer)))throw invalid(`글자 끝 시간은 ${framesToSeconds(limit)}초 안이어야 해요. 끝 시간을 직접 줄여 주세요.`);
  // P2-3: a new or changed text uses a selectable font and one of its weights. A text whose font and weight are the
  // saved ones keeps them even if that font is no longer installed (its stored value is never rewritten).
  const selectable=new Map(fonts().map(font=>[font.family as string,font]));
  for(const layer of timeline.text){const old=before.get(layer.id);if(old&&old.style.fontFamily===layer.style.fontFamily&&old.style.fontWeight===layer.style.fontWeight)continue;
   const font=selectable.get(layer.style.fontFamily);if(!font)throw invalid(FONT_UNAVAILABLE);if(!font.weights.includes(layer.style.fontWeight))throw invalid(FONT_WEIGHT_UNAVAILABLE);}
  const inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(value.inputsJson)),required=requiredDisclosures(inputs),planned=states.scenes(projectId).reduce((sum,scene)=>sum+scene.durationSec,0)*FPS;
  // A required disclosure follows the P1 rule (64, white, whole plan), or (P2-3, Master D-4) the spec disclosure look
  // exactly over the whole plan, or is the saved one with only its box moved (older values are kept, never corrected).
  const disclosureLook=canonicalJson({style:presetFor("disclosure").style,animation:presetFor("disclosure").animation});
  for(const content of required){const layer=timeline.text.find(item=>item.kind==="disclosure"&&item.content===content),old=layer&&before.get(layer.id);
   const kept=!!old&&canonicalJson({...old,box:null})===canonicalJson({...layer,box:null});
   if(!layer||!layer.locked||!(kept||(layer.timing.startFrame===0&&layer.timing.endFrame===planned&&((layer.style.fontSize===64&&layer.style.color.toUpperCase()==="#FFFFFF")||canonicalJson({style:layer.style,animation:layer.animation})===disclosureLook))))throw invalid("필수 표기는 지우거나 바꿀 수 없어요. 위치만 바꿀 수 있어요.");}
  if(timeline.text.some(layer=>layer.locked&&!required.includes(layer.content)))throw invalid("잠긴 필수 표기를 확인해 주세요.");
  return {timeline,json};
 }
 function write(projectId:string,revision:number,expectedTimelineId:string|null,json:string,action:"timeline.save"|"timeline.restore",restoredFromId:string|null,timeline:Timeline){
  const value=project(projectId),current=currentRow(projectId,value.currentTimelineRevId);
  if(current&&current.row.timeline_json===json)return {revision,timelineId:current.row.id,timelineRevision:current.row.revision,created:false};
  const id=v7(),number=repo.nextRevision(projectId);
  const next=workflow.changeContent(projectId,revision,"edit",action,()=>{
   repo.insert({id,project_id:projectId,revision:number,content_revision:revision+1,timeline_json:json,timeline_sha256:timelineSha256(json),source:restoredFromId?"restore-version":"user",restored_from_id:restoredFromId,migrated_from_key:null,created_at:new Date().toISOString()});
   repo.point(projectId,id);timeline.video.forEach((clip,index)=>finishing.scenePosition(clip.sceneId,index+1));
  },()=>({timelineId:id,timelineRevision:number,...(expectedTimelineId?{previousTimelineId:expectedTimelineId}:{}),...(restoredFromId?{restoredFromId}:{})}));
  return {revision:next,timelineId:id,timelineRevision:number,created:true};
 }
 function cas(projectId:string,revision:number,expectedTimelineId:string|null){const value=gated(projectId);assertRevision(revision,value.contentRevision);if((value.currentTimelineRevId??null)!==expectedTimelineId)throw new WorkflowError("CONFLICT",TIMELINE_CONFLICT);return value;}
 const service={
  state,
  get:(projectId:string)=>{gated(projectId);const data=state(projectId);return {...data,history:repo.list(projectId).map(summary)};},
  save:(projectId:string,revision:number,expectedTimelineId:string|null,input:unknown)=>atomic(()=>{const value=cas(projectId,revision,expectedTimelineId),base=currentRow(projectId,value.currentTimelineRevId)?.timeline??null;const {timeline,json}=check(projectId,input,base);return write(projectId,revision,expectedTimelineId,json,"timeline.save",null,timeline);}),
  restore:(projectId:string,revision:number,expectedTimelineId:string|null,fromId:string)=>atomic(()=>{const value=cas(projectId,revision,expectedTimelineId),from=repo.row(fromId);if(!from||from.project_id!==projectId)throw new WorkflowError("NOT_FOUND","되돌릴 타임라인 버전을 찾을 수 없어요.",404);
   const old=readTimelineRow(from),base=currentRow(projectId,value.currentTimelineRevId)?.timeline??null;
   // The old version is checked by today's rules against today's selection; carried texts are judged against itself.
   let checked:{timeline:Timeline;json:string};try{checked=check(projectId,old,{...old,video:base?.video??old.video});}catch(error){if(error instanceof WorkflowError||error instanceof z.ZodError)throw invalid("그 버전 이후 장면이나 기준이 바뀌어 그대로 되돌릴 수 없어요.");throw error;}
   return write(projectId,revision,expectedTimelineId,checked.json,"timeline.restore",from.id,checked.timeline);}),
  // Review and export: the saved P1-moved row reads its source snapshot byte for byte (same bundle, same SRT); any
  // later row reads its frames. `stale` lists scenes whose current selection no longer matches the saved clips.
  editView:(projectId:string):{id:string|null;value:EditInput|null;snapshot:(EditSnapshot&{timeline?:TimelineSummary})|null;stale:string[];current:TimelineSummary|null;timelineJson:string|null}=>{
   const data=state(projectId);if(!data.row||!data.timeline)return {id:null,value:null,snapshot:null,stale:[],current:null,timelineJson:null};
   // The P1 path is taken only when the saved r1 (already read through schema + hash) still equals its source snapshot
   // moved by the 0005 rules; otherwise nothing is shown as that snapshot. Stale clips are reported either way.
   // F065-1: the whole row is compared with its snapshot (texts, scene order, clip ids, record), not the texts only.
   if(data.row.source==="p1-migration"){let source:ReturnType<typeof checkP1MigratedRow>;try{source=checkP1MigratedRow(handle.sqlite,data.row,data.timeline);}catch(error){if(error instanceof P1SourceMismatchError||error instanceof z.ZodError||error instanceof SyntaxError)throw new WorkflowError("STAGE_LOCKED",TIMELINE_P1_MISMATCH);throw error;}
    return {id:source.key.split(".").at(-1)!,value:{sceneOrder:source.snapshot.sceneOrder,layers:source.snapshot.layers},snapshot:source.snapshot,stale:data.stale,current:data.current,timelineJson:null};}
   const view=editViewFromTimeline(data.timeline);
   return {id:data.row.id,value:view,snapshot:{schema_version:1,content_revision:data.row.content_revision,created_at:data.row.created_at,...view,timeline:data.current!},stale:data.stale,current:data.current,
    // P2-3 (Master D-8): a user or restored version also carries its stored timeline bytes for the bundle.
    timelineJson:data.row.timeline_json};
  },
 };return service;
}
function writable(){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);}
export function readTimeline(id:string){return withDatabase(handle=>timelineService(handle).get(id));}
export function saveTimeline(id:string,revision:number,timelineId:string|null,timeline:unknown){writable();return withDatabase(handle=>timelineService(handle).save(id,revision,timelineId,timeline));}
export function restoreTimeline(id:string,revision:number,timelineId:string|null,fromId:string){writable();return withDatabase(handle=>timelineService(handle).restore(id,revision,timelineId,fromId));}
export type TimelineData=ReturnType<typeof readTimeline>;
