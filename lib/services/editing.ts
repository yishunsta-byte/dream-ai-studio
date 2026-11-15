import "server-only";
import { v7 } from "uuid";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { editInputSchema, editSnapshotSchema, requiredDisclosures, type EditInput, type EditSnapshot } from "@/lib/edit/schema";
import { finishingRepository } from "@/lib/repo/finishing";
import { jobsRepository } from "@/lib/repo/jobs";
import { workflowRepository } from "@/lib/repo/workflow";
import { productionService } from "./production";
import { workflowService } from "./workflow";
import { assertPreviousApproved, assertRevision, WorkflowError, type StageState } from "@/lib/domain/stages";
import { checkStartup } from "./startup";
export function editingService(handle:DatabaseHandle){const repo=finishingRepository(handle),jobs=jobsRepository(handle),workflow=workflowService(handle),states=workflowRepository(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function context(projectId:string){const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);assertPreviousApproved("edit",states.stages(projectId) as StageState[]);return project;}
 function current(projectId:string):{id:string|null;value:EditInput|null;snapshot:EditSnapshot|null}{const pointer=repo.setting(`project.${projectId}.edit.current`);if(!pointer)return {id:null,value:null,snapshot:null};const id=z.uuidv7().parse(JSON.parse(pointer.valueJson)),raw=repo.setting(`project.${projectId}.edit.${id}`);if(!raw)throw new WorkflowError("STAGE_LOCKED","저장한 글자 설정을 확인해 주세요.");const snapshot=editSnapshotSchema.parse(JSON.parse(raw.valueJson));return {id,value:{sceneOrder:snapshot.sceneOrder,layers:snapshot.layers},snapshot};}
 const service={
  get:(projectId:string)=>{const project=context(projectId),production=productionService(handle).get(projectId),saved=current(projectId),inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(project.inputsJson));const durationSec=production.scenes.reduce((sum,scene)=>sum+scene.durationSec,0);return {projectId,revision:project.contentRevision,aspect:project.aspect,durationSec,production,savedId:saved.id,completed:states.stages(projectId).find(row=>row.stage==="edit")?.status==="approved",value:saved.value??{sceneOrder:production.scenes.map(scene=>scene.id),layers:requiredDisclosures(inputs).map((content,index)=>({id:v7(),kind:"disclosure" as const,content,fontFamily:"Pretendard" as const,fontSize:64,color:"#FFFFFF",position:index===0?"top" as const:index===1?"middle" as const:"bottom" as const,startSec:0,endSec:durationSec,locked:true}))}};},
  save:(projectId:string,revision:number,input:unknown)=>atomic(()=>{const project=context(projectId);assertRevision(revision,project.contentRevision);const values=editInputSchema.parse(input),active=states.scenes(projectId),ids=active.map(scene=>scene.id),duration=active.reduce((sum,scene)=>sum+scene.durationSec,0),inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(project.inputsJson));if(new Set(values.sceneOrder).size!==ids.length||values.sceneOrder.length!==ids.length||ids.some(id=>!values.sceneOrder.includes(id)))throw new WorkflowError("INVALID_TRANSITION","현재 장면을 빠짐없이 한 번씩 배치해 주세요.",400);if(new Set(values.layers.map(layer=>layer.id)).size!==values.layers.length||values.layers.some(layer=>layer.endSec>duration))throw new WorkflowError("INVALID_TRANSITION","글자 항목과 전체 길이 안의 시간을 확인해 주세요.",400);
   const required=requiredDisclosures(inputs);for(const content of required){const layer=values.layers.find(layer=>layer.kind==="disclosure"&&layer.content===content);if(!layer||!layer.locked||layer.fontFamily!=="Pretendard"||layer.fontSize!==64||layer.color.toUpperCase()!=="#FFFFFF"||layer.startSec!==0||layer.endSec!==duration)throw new WorkflowError("INVALID_TRANSITION","필수 표기는 지우거나 바꿀 수 없어요. 위치만 바꿀 수 있어요.",400);}if(values.layers.some(layer=>layer.locked&&!required.includes(layer.content)))throw new WorkflowError("INVALID_TRANSITION","잠긴 필수 표기를 확인해 주세요.",400);
   const old=current(projectId);if(old.value&&JSON.stringify(old.value)===JSON.stringify(values))return {revision,id:old.id};const id=v7(),next=workflow.changeContent(projectId,revision,"edit","edit.save",()=>{repo.insertSetting(`project.${projectId}.edit.${id}`,editSnapshotSchema.parse({...values,schema_version:1,content_revision:revision+1,created_at:new Date().toISOString()}));repo.setPointer(`project.${projectId}.edit.current`,id);values.sceneOrder.forEach((sceneId,index)=>repo.scenePosition(sceneId,index+1));});return {revision:next,id};}),
  complete:(projectId:string,revision:number)=>atomic(()=>{const data=service.get(projectId);assertRevision(revision,data.revision);if(!data.savedId)throw new WorkflowError("STAGE_LOCKED","글자 설정을 먼저 저장해 주세요.");return workflow.changeStage(projectId,"edit","complete",revision);}),
  current,
 };return service;
}
export function readEditing(id:string){return withDatabase(handle=>editingService(handle).get(id));}
export function saveEditing(id:string,revision:number,input:unknown){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>editingService(handle).save(id,revision,input));}
export function completeEditing(id:string,revision:number){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>editingService(handle).complete(id,revision));}
export type EditingData=ReturnType<typeof readEditing>;
