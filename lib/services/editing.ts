import "server-only";
import { v7 } from "uuid";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { editInputSchema, editSnapshotSchema, requiredDisclosures, srtText, type EditInput, type EditSnapshot } from "@/lib/edit/schema";
import { applyEditView, editViewFromTimeline, FPS, framesToSeconds, textEndLimit, type Timeline } from "@/lib/edit/timeline";
import { finishingRepository } from "@/lib/repo/finishing";
import { jobsRepository } from "@/lib/repo/jobs";
import { workflowRepository } from "@/lib/repo/workflow";
import { productionService } from "./production";
import { timelineService, TIMELINE_STALE } from "./timeline";
import { workflowService } from "./workflow";
import { assertPreviousApproved, assertRevision, WorkflowError, type StageState } from "@/lib/domain/stages";
import { checkStartup } from "./startup";
// The static editor (P1 screen) on top of the P2-1 timeline (T-061, D3): it reads the current timeline revision and
// saves through the timeline service. P1 settings snapshots are only read (0005 source, old bundles); never written.
export function editingService(handle:DatabaseHandle){const repo=finishingRepository(handle),jobs=jobsRepository(handle),workflow=workflowService(handle),states=workflowRepository(handle),timelines=timelineService(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function context(projectId:string){const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);assertPreviousApproved("edit",states.stages(projectId) as StageState[]);return project;}
 // The P1 snapshot the old pointer names (read-only record; 0005 moved it to timeline r1).
 function current(projectId:string):{id:string|null;value:EditInput|null;snapshot:EditSnapshot|null}{const pointer=repo.setting(`project.${projectId}.edit.current`);if(!pointer)return {id:null,value:null,snapshot:null};const id=z.uuidv7().parse(JSON.parse(pointer.valueJson)),raw=repo.setting(`project.${projectId}.edit.${id}`);if(!raw)throw new WorkflowError("STAGE_LOCKED","저장한 글자 설정을 확인해 주세요.");const snapshot=editSnapshotSchema.parse(JSON.parse(raw.valueJson));return {id,value:{sceneOrder:snapshot.sceneOrder,layers:snapshot.layers},snapshot};}
 // The timeline the screen edits: the saved one, or (nothing saved yet) a draft with the current clips and the
 // required disclosures over the whole plan. The draft is computed, never stored.
 function base(projectId:string){const project=context(projectId),state=timelines.state(projectId),inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(project.inputsJson));const durationSec=states.scenes(projectId).reduce((sum,scene)=>sum+scene.durationSec,0);
  const timeline:Timeline=state.timeline??{schemaVersion:1,fps:FPS,aspect:project.aspect as Timeline["aspect"],video:[],audio:[],text:[]};
  const value:EditInput=state.timeline?{...editViewFromTimeline(state.timeline),sceneOrder:state.clips.map(clip=>clip.sceneId)}:{sceneOrder:state.clips.map(clip=>clip.sceneId),layers:requiredDisclosures(inputs).map((content,index)=>({id:v7(),kind:"disclosure" as const,content,fontFamily:"Pretendard" as const,fontSize:64,color:"#FFFFFF",position:index===0?"top" as const:index===1?"middle" as const:"bottom" as const,startSec:0,endSec:durationSec,locked:true}))};
  return {project,state,timeline,value,durationSec};}
 // The SRT the bundle writes for the saved timeline (a moved r1 keeps its P1 times), shown while nothing is changed.
 // A row that fails its checks shows no saved preview here; review/export refuse it with their own message.
 function savedSrt(projectId:string,saved:boolean){if(!saved)return null;try{const view=timelines.editView(projectId);return view.value?srtText(view.value.layers):null;}catch{return null;}}
 const service={
  get:(projectId:string)=>{const {project,state,timeline,value,durationSec}=base(projectId),production=productionService(handle).get(projectId);
   return {projectId,revision:project.contentRevision,aspect:project.aspect,durationSec,lengthSec:project.lengthSec,maxEndSec:framesToSeconds(textEndLimit(state.clips,project.lengthSec)),production,savedId:state.current?.id??null,timelineId:state.current?.id??null,current:state.current,base:timeline,clips:state.clips,stale:state.stale,warnings:state.warnings,completed:states.stages(projectId).find(row=>row.stage==="edit")?.status==="approved",value,savedSrt:savedSrt(projectId,state.current!==null),fromP1:state.current?.source==="p1-migration"};},
  // Static-editor values saved as a timeline revision (server-side callers and tests; the screen posts the timeline).
  save:(projectId:string,revision:number,input:unknown)=>atomic(()=>{const values=editInputSchema.parse(input),{project,state,timeline}=base(projectId);assertRevision(revision,project.contentRevision);let next:Timeline;try{next=applyEditView(timeline,values,state.clips);}catch{throw new WorkflowError("INVALID_TRANSITION","현재 장면을 빠짐없이 한 번씩 배치해 주세요.",400);}const saved=timelines.save(projectId,revision,state.current?.id??null,next);return {revision:saved.revision,id:saved.timelineId};}),
  complete:(projectId:string,revision:number)=>atomic(()=>{const project=context(projectId);assertRevision(revision,project.contentRevision);const state=timelines.state(projectId);if(!state.current)throw new WorkflowError("STAGE_LOCKED","글자 설정을 먼저 저장해 주세요.");if(state.stale.length)throw new WorkflowError("STAGE_LOCKED",TIMELINE_STALE);return workflow.changeStage(projectId,"edit","complete",revision);}),
  current,
 };return service;
}
export function readEditing(id:string){return withDatabase(handle=>editingService(handle).get(id));}
export function completeEditing(id:string,revision:number){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>editingService(handle).complete(id,revision));}
export type EditingData=ReturnType<typeof readEditing>;
