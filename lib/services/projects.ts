import "server-only";
import { v7 } from "uuid";
import type { DatabaseHandle } from "@/lib/db/connection";
import { decodeJson, encodeJson, jsonObject } from "@/lib/db/json";
import { withDatabase } from "@/lib/db/server";
import { projectDisplayState, stageOrder, WorkflowError, type StageState } from "@/lib/domain/stages";
import type { MenuConfig } from "@/lib/menus/schema";
import { getMenuConfig } from "@/lib/menus/server";
import { menuSnapshotSchema, snapshotForMenu } from "@/lib/menus/snapshot";
import { validateProjectInputs, type ProjectInputErrors } from "@/lib/menus/inputs";
import { projectsRepository } from "@/lib/repo/projects";
import { storedFileExists } from "@/lib/storage/paths";
import { checkStartup } from "./startup";

export class ProjectInputError extends Error { constructor(public errors:ProjectInputErrors){super("입력 항목을 확인해 주세요.");} }
export function projectService(handle:DatabaseHandle,config:MenuConfig) {
 const repo=projectsRepository(handle);
 return {
  choices:()=>({assets:repo.assetChoices().filter((asset)=>asset.kind==="link"||storedFileExists(asset.filePath)).map(({id,title,kind})=>({id,title,kind})),characters:repo.characterChoices()}),
  create:(menuId:string,input:unknown)=>handle.sqlite.transaction(()=>{
    const menu=config.menus.find((item)=>item.id===menuId);
    if(!menu || menu.availability!=="active")throw new WorkflowError("STAGE_LOCKED","이 분야는 준비 중이에요. 지금은 둘러보기만 할 수 있어요.");
    const snapshot=snapshotForMenu(config,menu);
    const validated=validateProjectInputs(snapshot,input);
    if(!validated.ok)throw new ProjectInputError(validated.errors);
    const values=validated.values;
    const assetLinks:{assetId:string;purpose:string}[]=[];
    const characterIds:string[]=[];
    for(const field of [...snapshot.commonInputs,...menu.inputs]) {
      const ids=values[field.id];
      if(!Array.isArray(ids))continue;
      for(const id of ids as string[]) {
        if(field.type==="assets") {
          const asset=repo.asset(id);
          if(!asset || (field.accept && !field.accept.includes(asset.kind as "image"|"video"|"audio"|"doc")) || (asset.kind!=="link"&&!storedFileExists(asset.filePath)))throw new ProjectInputError({[field.id]:"이 자료를 사용할 수 없어요. 보관함에서 자료의 상태와 형식을 확인해 주세요."});
          assetLinks.push({assetId:id,purpose:field.id});
        } else if(field.type==="characters") {
          if(!repo.character(id))throw new ProjectInputError({[field.id]:"캐릭터를 다시 선택해 주세요."});
          characterIds.push(id);
        }
      }
    }
    const id=v7();
    repo.insert({id,menuId,templateVersion:config.templateVersion,templateSnapshotJson:encodeJson(menuSnapshotSchema,snapshot),inputsJson:encodeJson(jsonObject,values),title:values.title as string,goal:values.goal as string,target:values.target as string,aspect:values.aspect as string,lengthSec:values.lengthSec as number});
    repo.insertStages(stageOrder.map((stage,index)=>({projectId:id,stage,status:index===0?"approved":index===1?"todo":"locked",approvedAt:index===0?new Date().toISOString():null})));
    for(const link of assetLinks)repo.linkAsset({projectId:id,...link});
    for(const characterId of characterIds)repo.linkCharacter({projectId:id,characterId});
    repo.log({projectId:id,actor:"local-user",action:"project.create",detailJson:encodeJson(jsonObject,{menuId,templateVersion:config.templateVersion,contentRevision:1})});
    return id;
  }).immediate(),
  list:()=>repo.list().map((project)=>{const states=repo.stages(project.id) as StageState[];return {id:project.id,title:project.title,menuId:project.menuId,menuLabel:decodeJson(menuSnapshotSchema,project.templateSnapshotJson).menu.label,aspect:project.aspect,lengthSec:project.lengthSec,updatedAt:project.updatedAt,status:projectDisplayState(states,repo.jobStates(project.id)),states,nextStage:stageOrder.find((stage)=>states.find((item)=>item.stage===stage)?.status!=="approved")??"export"};}),
  get:(id:string)=>{
    const project=repo.get(id);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);
    return {project,snapshot:decodeJson(menuSnapshotSchema,project.templateSnapshotJson),inputs:decodeJson(jsonObject,project.inputsJson),states:repo.stages(id) as (StageState&{note:string|null})[]};
  },
 };
}
export function listProjects() {return withDatabase((handle)=>projectService(handle,getMenuConfig()).list());}
export function readProject(id:string) {return withDatabase((handle)=>projectService(handle,getMenuConfig()).get(id));}
export function projectChoices() {return withDatabase((handle)=>projectService(handle,getMenuConfig()).choices());}
export function createProject(menuId:string,input:unknown) {
  if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검의 실패 항목을 해결한 뒤 다시 시도해 주세요.",503);
  return withDatabase((handle)=>projectService(handle,getMenuConfig()).create(menuId,input));
}
