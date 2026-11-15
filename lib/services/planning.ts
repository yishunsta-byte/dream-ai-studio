import "server-only";
import { z } from "zod";
import { v7 } from "uuid";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { encodeJson, jsonArray } from "@/lib/db/json";
import { WorkflowError } from "@/lib/domain/stages";
import { getMenuConfig } from "@/lib/menus/server";
import type { MenuConfig } from "@/lib/menus/schema";
import { planningRepository } from "@/lib/repo/planning";
import { storedFileExists } from "@/lib/storage/paths";
import { checkStartup } from "./startup";
import { projectService } from "./projects";
import { workflowService } from "./workflow";

export const sceneDraftSchema=z.strictObject({sceneId:z.uuidv7().optional(),stepId:z.string().min(1).max(80),title:z.string().trim().min(1).max(120),description:z.string().trim().min(1).max(2000),dialogue:z.string().trim().max(4000),durationSec:z.number().int().min(1).max(600),characterIds:z.array(z.uuidv7()).max(20),assetIds:z.array(z.uuidv7()).max(30)});
export const planningInputSchema=z.strictObject({script:z.string().trim().min(1).max(20000),scenes:z.array(sceneDraftSchema).min(1).max(100)}).refine(input=>input.scenes.reduce((sum,scene)=>sum+scene.durationSec,0)<=7200,{message:"전체 기획 길이는 7,200초 이하여야 해요."});
export type SceneDraft=z.infer<typeof sceneDraftSchema>;
function assertReady(){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인하고 다시 시도해 주세요.",503);}
export function planningService(handle:DatabaseHandle,config:MenuConfig=getMenuConfig()) {
 const repo=planningRepository(handle);const workflow=workflowService(handle);
 function projectData(id:string){return projectService(handle,config).get(id);}
 return {
  get:(id:string)=>{
   const data=projectData(id);const assets=repo.assets(id),characters=repo.characters(id);
   const issues:string[]=[];
   if(data.inputs.usageRights==="확인 필요")issues.push("제품 이미지 사용권이 아직 확인되지 않았어요.");
   if(!data.inputs.factSources)issues.push("입력한 장점의 출처가 비어 있어요. 기획과 검수에서 확인해 주세요.");
   if(assets.some((asset)=>!asset.rightsNote))issues.push("일부 자료의 출처·권리 메모가 없어요.");
   if(assets.some((asset)=>asset.kind!=="link"&&!storedFileExists(asset.filePath)))issues.push("연결한 자료 중 열 수 없는 파일이 있어요.");
   if(characters.some((character)=>character.status!=="confirmed"))issues.push("확인되지 않은 캐릭터 설정이 있어요.");
   const versions=repo.plans(id).map((plan)=>{
     const rows=z.array(sceneDraftSchema).safeParse(JSON.parse(plan.stepsJson));
     return {id:plan.id,version:plan.version,status:plan.status,script:plan.script,createdAt:plan.createdAt,approvedAt:plan.approvedAt,scenes:rows.success?rows.data:[]};
   });
   return {...data,issues,assets:assets.map(({filePath,...asset})=>({...asset,available:asset.kind==="link"||storedFileExists(filePath)})),characters,versions};
  },
  confirmBrief:(id:string,expectedRevision:number,acknowledged:boolean)=>{
    if(!acknowledged)throw new WorkflowError("STAGE_LOCKED","누락·불명확 항목을 살펴본 뒤 확인해 주세요.",400);
    return workflow.changeStage(id,"brief","complete",expectedRevision);
  },
  save:(id:string,expectedRevision:number,input:unknown)=>handle.sqlite.transaction(()=>{
   const values=planningInputSchema.parse(input);const data=projectData(id);const eligibleAssets=repo.assets(id),eligibleCharacters=repo.characters(id);const existing=repo.allScenes(id);
   const ids=values.scenes.flatMap((scene)=>scene.sceneId?[scene.sceneId]:[]);if(new Set(ids).size!==ids.length)throw new WorkflowError("INVALID_TRANSITION","장면이 중복되었어요.",400);
   for(const scene of values.scenes){
    if(scene.sceneId&&!existing.some((old)=>old.id===scene.sceneId))throw new WorkflowError("NOT_FOUND","프로젝트에 속한 장면을 선택해 주세요.",404);
    if(scene.stepId!=="custom"&&!data.snapshot.menu.planSteps.some((step)=>step.id===scene.stepId))throw new WorkflowError("INVALID_TRANSITION","기획 순서를 다시 확인해 주세요.",400);
    if(new Set(scene.assetIds).size!==scene.assetIds.length||new Set(scene.characterIds).size!==scene.characterIds.length)throw new WorkflowError("INVALID_TRANSITION","참조가 중복되었어요.",400);
    if(scene.assetIds.some((assetId)=>!eligibleAssets.some((asset)=>asset.id===assetId&&(asset.kind==="link"||storedFileExists(asset.filePath)))))throw new WorkflowError("INVALID_TRANSITION","장면에서 사용할 자료를 다시 확인해 주세요.",400);
    if(scene.characterIds.some((characterId)=>!eligibleCharacters.some((character)=>character.id===characterId)))throw new WorkflowError("INVALID_TRANSITION","장면에서 사용할 캐릭터를 다시 선택해 주세요.",400);
   }
   const saved=workflow.createPlanDraft(id,expectedRevision,{script:values.script,steps:values.scenes.map((scene)=>({id:scene.stepId,label:scene.title}))},()=>{
    const retained=new Set(values.scenes.map((scene)=>scene.sceneId).filter(Boolean));
    for(const scene of existing.filter((scene)=>!scene.archivedAt&&!retained.has(scene.id)))repo.updateScene(scene.id,id,{archivedAt:new Date().toISOString()});
    return values.scenes.map((scene,index)=>{
      const sceneId=scene.sceneId??v7();const row={projectId:id,position:index+1,title:scene.title,description:scene.description,dialogueJson:encodeJson(jsonArray,scene.dialogue?[{text:scene.dialogue}]:[]),characterIdsJson:encodeJson(jsonArray,scene.characterIds),durationSec:scene.durationSec,archivedAt:null};
      if(scene.sceneId)repo.updateScene(sceneId,id,row);else repo.insertScene({id:sceneId,...row});
      return {...scene,sceneId};
    });
   });
   workflow.changeStage(id,"plan","request_approval",saved.revision);
   return saved;
  }).immediate(),
  approve:(id:string,planId:string,expectedRevision:number)=>workflow.approvePlan(id,planId,expectedRevision),
 };
}
export function readPlanning(id:string){return withDatabase((handle)=>planningService(handle).get(id));}
export function confirmProjectBrief(id:string,revision:number,acknowledged:boolean){assertReady();return withDatabase((handle)=>planningService(handle).confirmBrief(id,revision,acknowledged));}
export function saveProjectPlan(id:string,revision:number,input:unknown){assertReady();return withDatabase((handle)=>planningService(handle).save(id,revision,input));}
export function approveProjectPlan(id:string,planId:string,revision:number){assertReady();return withDatabase((handle)=>planningService(handle).approve(id,planId,revision));}
export type PlanningData=ReturnType<typeof readPlanning>;
