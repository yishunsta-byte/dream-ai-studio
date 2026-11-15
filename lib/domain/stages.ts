export const stageOrder = ["intake","brief","plan","produce","edit","review","export"] as const;
export type Stage = typeof stageOrder[number];
export type StageStatus = "locked"|"todo"|"in_progress"|"needs_approval"|"approved"|"failed";
export type StageState = {stage:Stage;status:StageStatus};
export type StageAction = "unlock"|"start"|"complete"|"request_approval"|"approve"|"fail"|"retry";
export type WorkflowErrorCode = "STAGE_LOCKED"|"MANUAL_APPROVAL_REQUIRED"|"INVALID_TRANSITION"|"PLAN_NOT_APPROVED"|"REVIEW_INVALID"|"CONFLICT"|"INVALID_VERSION"|"NOT_FOUND";
export class WorkflowError extends Error {
  constructor(public code:WorkflowErrorCode, message:string, public status=409) { super(message);this.name="WorkflowError"; }
}
export function isGate(stage:Stage) { return stage==="plan" || stage==="review"; }
export function assertPreviousApproved(stage:Stage, states:StageState[]) {
  const index=stageOrder.indexOf(stage);
  if(index<0)throw new WorkflowError("INVALID_TRANSITION","작업 단계를 확인해 주세요.",400);
  if(index>0 && states.find((entry)=>entry.stage===stageOrder[index-1])?.status!=="approved") throw new WorkflowError("STAGE_LOCKED","이전 단계를 먼저 완료해 주세요.");
}
export function transitionStage(stage:Stage,status:StageStatus,action:StageAction,states:StageState[],source:"user"|"system"):StageStatus {
  assertPreviousApproved(stage,states);
  if(action==="approve" && isGate(stage) && source!=="user")throw new WorkflowError("MANUAL_APPROVAL_REQUIRED","기획과 검수는 직접 승인해 주세요.");
  if(action==="complete" && isGate(stage))throw new WorkflowError("MANUAL_APPROVAL_REQUIRED","이 단계는 승인 버튼으로 완료해 주세요.");
  const transitions:Record<StageAction,Partial<Record<StageStatus,StageStatus>>>={
    unlock:{locked:"todo"},start:{todo:"in_progress"},complete:{todo:"approved",in_progress:"approved"},
    request_approval:{in_progress:"needs_approval"},approve:{needs_approval:"approved"},fail:{in_progress:"failed",needs_approval:"failed"},retry:{failed:"in_progress"},
  };
  if((action==="approve" || action==="request_approval") && !isGate(stage))throw new WorkflowError("INVALID_TRANSITION","이 단계에는 승인 요청이 필요하지 않아요.",400);
  const next=transitions[action][status];
  if(!next)throw new WorkflowError("INVALID_TRANSITION","현재 상태에서는 이 작업을 할 수 없어요.");
  return next;
}
export function invalidateContent(states:StageState[],origin:Stage):StageState[] {
  const index=stageOrder.indexOf(origin);
  return states.map((state)=>{
    const position=stageOrder.indexOf(state.stage);
    return position<index ? {...state} : {...state,status:position===index?"in_progress":"locked"};
  });
}
export function assertRevision(expected:number,current:number) {
  if(!Number.isSafeInteger(expected) || expected!==current)throw new WorkflowError("CONFLICT","다른 변경이 먼저 저장됐어요. 새로고침한 뒤 다시 시도해 주세요.");
}
export function nextVersion(current:number[]):number {
  if(current.some((value)=>!Number.isSafeInteger(value)||value<1))throw new WorkflowError("INVALID_VERSION","버전 기록을 확인해 주세요.");
  const version=current.reduce((max,value)=>Math.max(max,value),0)+1;
  if(!Number.isSafeInteger(version))throw new WorkflowError("INVALID_VERSION","새 버전 번호를 만들 수 없어요.");
  return version;
}
export function projectDisplayState(states:StageState[],jobs:string[]):"warning"|"running"|"approval"|"done"|"queued" {
  if(jobs.includes("failed")||states.some((state)=>state.status==="failed"))return "warning";
  if(jobs.includes("running"))return "running";
  if(states.some((state)=>state.status==="needs_approval"))return "approval";
  if(states.find((state)=>state.stage==="export")?.status==="approved")return "done";
  return "queued";
}
