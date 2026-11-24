import "server-only";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { finishingRepository } from "@/lib/repo/finishing";

import { currentPlayableRenderId } from "./renders";
import { jobsRepository } from "@/lib/repo/jobs";
import { workflowRepository } from "@/lib/repo/workflow";
import { planningRepository } from "@/lib/repo/planning";
import { assertPreviousApproved, assertRevision, WorkflowError, type StageState } from "@/lib/domain/stages";
import { workflowService } from "./workflow";
import { productionService } from "./production";
import { timelineService, TIMELINE_STALE } from "./timeline";
import type { Timeline } from "@/lib/edit/timeline";
import { checkStartup } from "./startup";
import { musicClips, reviewInputSchema, reviewItems } from "@/lib/domain/review";
export { reviewInputSchema } from "@/lib/domain/review";
function musicRightsEvidence(timeline:Timeline|null){
 if(timeline?.schemaVersion!==2)return null;const songs=[...new Set(musicClips(timeline).map(clip=>clip.assetId))];if(!songs.length)return null;
 const full=songs.filter(id=>{const row=timeline.audioRights.find(item=>item.assetId===id);return !!row&&!!row.planName&&!!row.createdOn&&!!row.licenseNote;}).length;
 return `이 버전 배경 음악 ${songs.length}곡 중 플랜·생성일·라이선스가 모두 적힌 곡 ${full}곡 · 적혀 있어도 사용권은 직접 확인해 주세요.`;
}
export function reviewService(handle:DatabaseHandle){const repo=finishingRepository(handle),jobs=jobsRepository(handle),states=workflowRepository(handle),workflow=workflowService(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function context(projectId:string){const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);assertPreviousApproved("review",states.stages(projectId) as StageState[]);const snapshot=menuSnapshotSchema.parse(JSON.parse(project.templateSnapshotJson)),inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(project.inputsJson));const expected=reviewItems(snapshot,inputs,timelineService(handle).state(projectId).timeline);return {project,snapshot,expected};}
 function ensure(projectId:string){const data=context(projectId);for(const item of data.expected)repo.insertReview({projectId,contentRevision:data.project.contentRevision,templateItemId:item.id,label:item.label,source:item.source,required:item.required,status:"unchecked"});return data;}
 const service={
  get:(projectId:string)=>atomic(()=>{const {project,expected}=ensure(projectId),rows=repo.reviews(projectId,project.contentRevision),production=productionService(handle).get(projectId),edit=timelineService(handle).editView(projectId);const selected=production.scenes.map(scene=>scene.versions.find(version=>version.id===scene.selectedVersionId));const sample=selected.some(version=>version?.asset?.isMock);const sourceAssets=planningRepository(handle).assets(projectId);const evidence:Record<string,string>={"c.files-exist":`선택 파일 ${selected.filter(version=>version?.asset?.available).length}/${selected.length}개 존재 · 실제 재생은 직접 확인해 주세요. 해시는 내보내기에서 재검사해요.`,"c.spec-match":selected.map((version,index)=>`장면 ${index+1}: ${version?.asset?.width&&version.asset.height?`${version.asset.width}×${version.asset.height}`:"해상도 없음"}${version?.asset?.durationMs?` · 실제 ${version.asset.durationMs/1000}초`:""} / 기획 ${production.scenes[index].durationSec}초`).join(" / "),"c.no-mock-final":sample?"샘플 포함 · 완성 영상이 아닌 편집용 묶음으로 표시해요.":"선택한 결과에 샘플 표시가 없어요.","c.rights":`${sourceAssets.filter(asset=>!!asset.rightsNote).length}/${sourceAssets.length}개 원본 자료에 권리 메모가 있어요. 빈 메모와 음악 권리는 직접 확인하고 기록해 주세요.`,"x.music-rights":musicRightsEvidence(timelineService(handle).state(projectId).timeline)??"이 버전 타임라인에는 배경 음악이 없어요. 프로젝트에서 쓰는 음악이 있으면 곡별 기록을 확인해 주세요.","x.ad-disclosure":edit.value?.layers.some(layer=>layer.locked&&layer.content==="광고")?"광고 표기가 전체 기획 시간에 잠겨 있어요. 시작·끝·상품 언급 장면을 직접 확인해 주세요.":"저장한 광고 표기를 확인해 주세요."};const currentMp4Id=edit.current&&!edit.stale.length?currentPlayableRenderId(handle,projectId,edit.current.id,project.contentRevision):null;
   return {currentMp4Id,projectId,revision:project.contentRevision,timeline:edit.current,timelineStale:edit.stale.length>0,isMock:sample,approved:states.stages(projectId).some(row=>row.stage==="review"&&row.status==="approved"&&row.approvedRevision===project.contentRevision),items:expected.map(item=>({...rows.find(row=>row.templateItemId===item.id)!,evidence:evidence[item.id]??null})),production};}),
  update:(projectId:string,revision:number,input:unknown)=>atomic(()=>{const values=reviewInputSchema.parse(input),{project,expected}=ensure(projectId);assertRevision(revision,project.contentRevision);if(!expected.some(item=>item.id===values.itemId))throw new WorkflowError("NOT_FOUND","현재 검수 항목을 확인해 주세요.",404);const row=repo.reviews(projectId,revision).find(item=>item.templateItemId===values.itemId)!;const stage=states.stages(projectId).find(item=>item.stage==="review")!;if(stage.status==="approved")throw new WorkflowError("REVIEW_INVALID","승인된 검수는 보존돼요. 내용을 바꾸면 새 내용 버전으로 다시 검수해요.");if(stage.status==="todo")workflow.changeStage(projectId,"review","start",revision);repo.updateReview(row.id,{status:values.status,note:values.note||null,checkedAt:values.status==="unchecked"?null:new Date().toISOString()});jobs.log(projectId,"review.item",{itemId:values.itemId,status:values.status,contentRevision:revision},"local-user");return revision;}),
  approve:(projectId:string,revision:number)=>atomic(()=>{if(timelineService(handle).editView(projectId).stale.length)throw new WorkflowError("STAGE_LOCKED",TIMELINE_STALE);const {project}=ensure(projectId);assertRevision(revision,project.contentRevision);let stage=states.stages(projectId).find(item=>item.stage==="review")!;if(stage.status==="todo")workflow.changeStage(projectId,"review","start",revision);stage=states.stages(projectId).find(item=>item.stage==="review")!;if(stage.status==="in_progress")workflow.changeStage(projectId,"review","request_approval",revision);return workflow.approveReview(projectId,revision);}),
 };return service;
}
export function readReview(id:string){return withDatabase(handle=>reviewService(handle).get(id));}
export function updateReview(id:string,revision:number,input:unknown){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>reviewService(handle).update(id,revision,input));}
export function approveReview(id:string,revision:number){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>reviewService(handle).approve(id,revision));}
export type ReviewData=ReturnType<typeof readReview>;
