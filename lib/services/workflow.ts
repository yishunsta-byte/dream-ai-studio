import "server-only";
import type { DatabaseHandle } from "@/lib/db/connection";
import { decodeJson, encodeJson, jsonArray, jsonObject } from "@/lib/db/json";
import { workflowRepository } from "@/lib/repo/workflow";
import { assertPreviousApproved, assertRevision, invalidateContent, stageOrder, transitionStage, WorkflowError, type Stage, type StageState, type StageAction } from "@/lib/domain/stages";
import { storedFileExists } from "@/lib/storage/paths";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { v7 } from "uuid";
import { z } from "zod";
import { nextVersion } from "@/lib/domain/stages";

const draftSchema=z.strictObject({script:z.string().trim().min(1).max(20000),steps:z.array(z.strictObject({id:z.string().min(1),label:z.string().min(1),help:z.string().optional()})).min(1).max(100)});

/** 화면 상태와 무관하게 서비스에서 검사하고 변경과 활동 기록을 함께 저장한다. */
export function workflowService(handle:DatabaseHandle) {
  const repo=workflowRepository(handle);
  function context(id:string) {
    const project=repo.project(id);
    if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);
    const raw=repo.stages(id);
    if(raw.length!==stageOrder.length || stageOrder.some((stage)=>!raw.some((item)=>item.stage===stage)))throw new WorkflowError("STAGE_LOCKED","작업 단계 기록을 확인해 주세요.");
    return {project,states:raw.map(({stage,status})=>({stage,status})) as StageState[]};
  }
  const atomic=<T>(action:()=>T)=>handle.sqlite.transaction(action).immediate();
  function requirePlan(projectId:string,planId:string) {
    const {project,states}=context(projectId);
    const plan=repo.plan(planId);
    if(!plan || plan.projectId!==projectId || plan.status!=="approved" || project.approvedPlanId!==planId || states.find((state)=>state.stage==="plan")?.status!=="approved")throw new WorkflowError("PLAN_NOT_APPROVED","현재 기획을 승인한 뒤 장면을 만들어 주세요.");
    return plan;
  }
  function requireReview(projectId:string) {
    const {project}=context(projectId);
    const review=repo.stages(projectId).find((state)=>state.stage==="review");
    if(review?.status!=="approved" || review.approvedRevision!==project.contentRevision)throw new WorkflowError("REVIEW_INVALID","현재 내용의 검수를 마치고 승인해 주세요.");
    return project;
  }
  const service = {
    requireApprovedPlan:(projectId:string,planId:string)=>atomic(()=>requirePlan(projectId,planId)),
    requireApprovedReview:(projectId:string)=>atomic(()=>requireReview(projectId)),
    createPlanDraft:(projectId:string,expectedRevision:number,input:unknown):{id:string;version:number;revision:number}=>atomic(()=>{
      const draft=draftSchema.parse(input);
      const id=v7();
      const version=nextVersion(repo.planVersions(projectId));
      const revision=service.changeContent(projectId,expectedRevision,"plan","plan.draft",()=>{
        repo.insertPlan({id,projectId,version,stepsJson:encodeJson(jsonArray,draft.steps),script:draft.script,status:"draft"});
      });
      return {id,version,revision};
    }),
    changeStage:(projectId:string,stage:Stage,action:StageAction,expectedRevision:number)=>atomic(()=>{
      const {project,states}=context(projectId);assertRevision(expectedRevision,project.contentRevision);
      if(action==="approve")throw new WorkflowError("MANUAL_APPROVAL_REQUIRED","전용 승인 동작으로 기획과 검수를 승인해 주세요.");
      const current=states.find((state)=>state.stage===stage)!;
      if(action==="complete" && stage==="produce") {
        const active=repo.scenes(projectId);
        if(!active.length || active.some((scene)=>{
          const version=scene.selectedVersionId ? repo.version(scene.selectedVersionId):undefined;
          const asset=version?.resultAssetId ? repo.asset(version.resultAssetId):undefined;
          return scene.needsRecheck || !version || version.sceneId!==scene.id || version.status!=="succeeded" || !storedFileExists(asset?.filePath ?? null);
        }))throw new WorkflowError("STAGE_LOCKED","모든 장면의 완료된 결과를 선택하고 확인해 주세요.");
      }
      if(action==="complete" && stage==="export")throw new WorkflowError("INVALID_TRANSITION","실제 내보내기 파일이 완성된 뒤 완료할 수 있어요.");
      const status=transitionStage(stage,current.status,action,states,"user");
      repo.updateStage(projectId,stage,{status});
      if(status==="approved") {
        const next=stageOrder[stageOrder.indexOf(stage)+1];
        if(next && states.find((state)=>state.stage===next)?.status==="locked")repo.updateStage(projectId,next,{status:"todo"});
      }
      repo.log(projectId,`stage.${action}`,encodeJson(jsonObject,{stage,status,contentRevision:project.contentRevision}));
      return status;
    }),
    approvePlan:(projectId:string,planId:string,expectedRevision:number)=>atomic(()=>{
      const {project,states}=context(projectId);assertRevision(expectedRevision,project.contentRevision);
      const plan=repo.plan(planId);
      if(!plan || plan.projectId!==projectId || plan.status!=="draft")throw new WorkflowError("PLAN_NOT_APPROVED","승인할 기획 초안을 확인해 주세요.");
      const active=repo.scenes(projectId);
      if(!plan.script.trim() || !decodeJson(jsonArray,plan.stepsJson).length || !active.length)throw new WorkflowError("STAGE_LOCKED","대본과 기획 순서, 장면표를 먼저 완성해 주세요.");
      const status=transitionStage("plan",states.find((item)=>item.stage==="plan")!.status,"approve",states,"user");
      const approvedAt=new Date().toISOString();
      repo.updatePlan(planId,{status:"approved",approvedSceneSnapshotJson:encodeJson(jsonArray,active),approvedAt});
      repo.updateProject(projectId,{approvedPlanId:planId});
      repo.updateStage(projectId,"plan",{status,approvedPlanId:planId,approvedAt});
      repo.updateStage(projectId,"produce",{status:"todo"});
      repo.log(projectId,"plan.approve",encodeJson(jsonObject,{planId,version:plan.version,contentRevision:project.contentRevision}));
      return planId;
    }),
    approveReview:(projectId:string,expectedRevision:number)=>atomic(()=>{
      const {project,states}=context(projectId);assertRevision(expectedRevision,project.contentRevision);
      const items=repo.reviews(projectId,project.contentRevision);
      const snapshot=decodeJson(menuSnapshotSchema,project.templateSnapshotJson);
      const inputs=decodeJson(jsonObject,project.inputsJson);
      const expected=[...snapshot.commonReview,...snapshot.menu.review,...snapshot.conditionalReview.filter((item)=>inputs[item.when]===true)].filter((item)=>item.required);
      if(!expected.length || expected.some((item)=>!items.some((row)=>row.templateItemId===item.id&&row.required&&row.status==="pass")) || items.some((item)=>item.required&&item.status!=="pass"))throw new WorkflowError("REVIEW_INVALID","필수 항목을 모두 통과한 뒤 승인해 주세요.");
      const status=transitionStage("review",states.find((item)=>item.stage==="review")!.status,"approve",states,"user");
      repo.updateStage(projectId,"review",{status,approvedRevision:project.contentRevision,approvedAt:new Date().toISOString()});
      repo.updateStage(projectId,"export",{status:"todo"});
      repo.log(projectId,"review.approve",encodeJson(jsonObject,{contentRevision:project.contentRevision}));
      return project.contentRevision;
    }),
    changeContent:(projectId:string,expectedRevision:number,origin:"plan"|"produce"|"edit",action:string,mutation:()=>boolean|void)=>atomic(()=>{
      const {project,states}=context(projectId);assertRevision(expectedRevision,project.contentRevision);assertPreviousApproved(origin,states);
      if(mutation()===false)return project.contentRevision;
      const revision=project.contentRevision+1;
      if(!Number.isSafeInteger(revision))throw new WorkflowError("CONFLICT","내용 버전 기록을 확인해 주세요.");
      repo.updateProject(projectId,{contentRevision:revision,...(origin==="plan"?{approvedPlanId:null}:{})});
      repo.invalidateStages(projectId,invalidateContent(states,origin).filter((state)=>stageOrder.indexOf(state.stage)>=stageOrder.indexOf(origin)));
      if(origin==="plan")repo.markScenesForRecheck(projectId);
      repo.log(projectId,action,encodeJson(jsonObject,{previousRevision:project.contentRevision,contentRevision:revision,origin}));
      return revision;
    }),
  };
  return service;
}
