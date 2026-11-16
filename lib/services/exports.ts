import "server-only";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { linkSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { v7 } from "uuid";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { assertRevision, WorkflowError } from "@/lib/domain/stages";
import { menuSnapshotSchema } from "@/lib/menus/snapshot";
import { generationInputSchema } from "@/lib/jobs/schema";
import { exportJobSchema, manifestSchema, type BundleManifest } from "@/lib/export/schema";
import { fileDigest, verifyZip, writeZip, type BundleSource } from "@/lib/export/zip";
import { srtText } from "@/lib/edit/schema";
import { timelineSchema, timelineVtt } from "@/lib/edit/timeline";
import { FONT_MIME, fontStatuses } from "@/lib/fonts/registry";
import { finishingRepository } from "@/lib/repo/finishing";
import { jobsRepository } from "@/lib/repo/jobs";
import { planningRepository } from "@/lib/repo/planning";
import { workflowRepository } from "@/lib/repo/workflow";
import { resolveStoredFile } from "@/lib/storage/paths";
import { storageDirectory } from "@/lib/storage/upload";
import { MediaError } from "@/lib/media/inspect";
import { isRetryableCode } from "@/lib/ui/errors";
import { workflowService } from "./workflow";
import { timelineService, TIMELINE_STALE } from "./timeline";
import { jobsService } from "./jobs";
import { checkStartup } from "./startup";

// Download name: the list, the preview and the download header all use this one function.
export function bundleFileName(id:string,isMock:boolean){return `editing-${id}${isMock?"_SAMPLE":""}.zip`;}
const fontFile=()=>join(process.cwd(),"public/fonts/PretendardVariable.woff2"),licenseFile=()=>join(process.cwd(),"public/fonts/OFL.txt");
type Plan={id:string;version:number;script:string;stepsJson:string};
type Project={id:string;title:string;inputsJson:string};
type LayoutScene={scene:{id:string;title:string};version:{id:string;version:number;jobId:string|null};asset:{isMock:boolean;filePath:string|null;mime:string|null;sizeBytes:number|null;width:number|null;height:number|null;durationMs:number|null;rightsNote:string|null};filename:string|null};
type LayoutInput={project:Project;plan:Plan;edit:{id:string|null;value:{layers:Parameters<typeof srtText>[0]}|null;snapshot:unknown;timelineJson?:string|null};revision:number;reviews:{status:string;label:string;required:boolean;note:string|null}[];selected:LayoutScene[]};
export type BundleEntry={path:string;mime:string}&({source:"scene";index:number;item:LayoutScene}|{source:"text";text:string}|{source:"file";filename:string});
export function scenePath(index:number,item:Pick<LayoutScene,"scene"|"version"|"asset">){return `scenes/${String(index+1).padStart(2,"0")}_${item.scene.id}_v${item.version.version}${item.asset.isMock?"_SAMPLE":""}${extname(item.asset.filePath??"")}`;}
// The single list of bundle files in ZIP order. runClaimedExport writes exactly these entries
// (plus manifest.json); the preview shows exactly these paths.
export function bundleLayout(handle:DatabaseHandle,input:LayoutInput):BundleEntry[]{
 const jobs=jobsRepository(handle),entries:BundleEntry[]=[],text=(path:string,value:string,mime="text/plain")=>entries.push({path,mime,source:"text",text:value});
 input.selected.forEach((item,index)=>entries.push({path:scenePath(index,item),mime:item.asset.mime??"application/octet-stream",source:"scene",index,item}));
 // P2-3 (Master D-8): a user or restored timeline also gives its stored bytes and the font files it names. A moved P1
 // r1 (timelineJson null) keeps exactly the P1 layout, so bundles of that version stay the same byte for byte.
 const timelineJson=input.edit.timelineJson??null,timelineText=timelineJson?timelineSchema.parse(JSON.parse(timelineJson)).text:[],families=timelineJson?[...new Set(timelineText.map(layer=>layer.style.fontFamily as string))].filter(family=>family!=="Pretendard"):[];
 const fonts=families.length?fontStatuses().filter(font=>families.includes(font.family)&&font.installed):[],absent=families.filter(family=>!fonts.some(font=>font.family===family));
 text("README.txt",`${timelineJson?"":"P1 "}편집용 묶음입니다. 완성 영상은 포함하지 않습니다.\n${input.selected.some(item=>item.asset.isMock)?"샘플 포함 · 실제 생성 결과가 아닌 시험용 자료입니다.\n":""}영상 조립과 글자 합성은 P2 범위입니다. SRT는 직접 입력한 시간만 사용합니다.\n${timelineJson?"글자 모양·위치·움직임은 edit/timeline.json에 있어요.\n":""}${absent.map(family=>`글꼴 ${family} 파일을 찾지 못해 넣지 못했어요. 직접 확인해 주세요.\n`).join("")}`);
 text("script/script.txt",input.plan.script);
 text("script/plan.md",`# 승인 기획 v${input.plan.version}\n\n${input.plan.script}\n\n${JSON.stringify(JSON.parse(input.plan.stepsJson),null,2)}`);
 text("edit/text_overlays.json",JSON.stringify({revisionId:input.edit.id,...(input.edit.snapshot as object|null)},null,2),"application/json");
 const subtitles=input.edit.value?srtText(input.edit.value.layers):"";if(subtitles)text("subtitles/manual.srt",subtitles,"application/x-subrip");
 const generations=input.selected.map(item=>{const generation=item.version.jobId?jobs.generation(item.version.jobId):undefined;const params=generation?generationInputSchema.safeParse(JSON.parse(generation.paramsJson)):null;return {sceneId:item.scene.id,versionId:item.version.id,generationId:generation?.id??null,provider:generation?.provider??null,model:generation?.model??null,params:params?.success?params.data:null,costActualMicros:generation?.costActualMicros??null,currency:generation?.currency??null,isMock:item.asset.isMock};});
 text("provenance/generations.json",JSON.stringify(generations,null,2),"application/json");
 const original=planningRepository(handle).assets(input.project.id),inputs=z.record(z.string(),z.unknown()).parse(JSON.parse(input.project.inputsJson));
 text("provenance/rights.md",`# 출처·권리 기록\n\n프로젝트 사용권 입력: ${String(inputs.usageRights??"기록 없음")}\n\n${original.map(asset=>`- ${asset.title}: ${asset.rightsNote??"자료 메모 없음 · 직접 확인 필요"}`).join("\n")}\n\n${input.selected.map(item=>`- 선택 ${item.scene.title}: ${item.asset.rightsNote??"권리 메모 없음"}`).join("\n")}`);
 text("review/checklist.md",`# 내용 버전 r${input.revision} 검수\n\n${input.reviews.map(item=>`- [${item.status==="pass"?"x":" "}] ${item.label}${item.required?" (필수)":""}${item.note?` · ${item.note}`:""}`).join("\n")}`);
 entries.push({path:"fonts/PretendardVariable.woff2",mime:"font/woff2",source:"file",filename:fontFile()});
 text("LICENSES/Pretendard-OFL.txt",readFileSync(licenseFile(),"utf8"));
 if(timelineJson){text("edit/timeline.json",timelineJson,"application/json");
  // P2-6 (T-155): WebVTT of the same subtitle layers, only when there is at least one (like the SRT). P1 r1 has none.
  const vtt=timelineVtt(timelineText);if(vtt)text("subtitles/timeline.vtt",vtt,"text/vtt");
  for(const font of fonts){const name=basename(font.file!);entries.push({path:`fonts/${font.folder}/${name}`,mime:FONT_MIME[extname(name).slice(1).toLowerCase()]??"application/octet-stream",source:"file",filename:font.file!});text(`LICENSES/${font.folder}-OFL.txt`,readFileSync(font.license!,"utf8"));}}
 return entries;
}
function entryBytes(entry:BundleEntry){if(entry.source==="text")return Buffer.byteLength(entry.text,"utf8");if(entry.source==="scene")return entry.item.asset.sizeBytes??0;try{return statSync(entry.filename).size;}catch{return 0;}}
// Stored (uncompressed) ZIP64: each entry adds local+central headers with the path twice; manifest.json
// lists every file with its hash. Constants were measured against real bundles (tests check ±10%).
function estimateZipBytes(entries:{path:string;sizeBytes:number}[]){const manifest=600+entries.reduce((sum,entry)=>sum+entry.path.length+190,0);return entries.reduce((sum,entry)=>sum+entry.sizeBytes+2*Buffer.byteLength(entry.path)+170,0)+manifest+2*"manifest.json".length+170+100;}
export function exportService(handle:DatabaseHandle){const repo=finishingRepository(handle),jobs=jobsRepository(handle),states=workflowRepository(handle),workflow=workflowService(handle);const atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function context(projectId:string,revision:number){const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);assertRevision(revision,project.contentRevision);if(!project.approvedPlanId)throw new WorkflowError("PLAN_NOT_APPROVED","현재 기획을 승인해 주세요.");const plan=workflow.requireApprovedPlan(projectId,project.approvedPlanId);workflow.requireApprovedReview(projectId);const edit=timelineService(handle).editView(projectId);if(!edit.value)throw new WorkflowError("STAGE_LOCKED","저장한 글자 설정을 확인해 주세요.");if(edit.stale.length)throw new WorkflowError("STAGE_LOCKED",TIMELINE_STALE);const selected=states.scenes(projectId).map(scene=>{const version=scene.selectedVersionId?jobs.versions(scene.id).find(row=>row.id===scene.selectedVersionId):undefined;const asset=version?.resultAssetId?jobs.assets([version.resultAssetId])[0]:undefined;const filename=asset?resolveStoredFile(asset.filePath):null;if(scene.needsRecheck||!version||version.status!=="succeeded"||!asset||!filename)throw new WorkflowError("INVALID_VERSION","모든 장면의 선택 결과 파일과 기획 변경 확인을 마쳐 주세요.");return {scene,version,asset,filename};});if(!selected.length)throw new WorkflowError("INVALID_VERSION","선택한 장면이 없어요.");return {project,plan,edit,selected,snapshot:menuSnapshotSchema.parse(JSON.parse(project.templateSnapshotJson)),reviews:repo.reviews(projectId,revision)};}
 // Before creation (also before review approval): same layout function, no gates, never throws for
 // missing scene results — those are listed as missing and block creation.
 function preview(projectId:string){const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);const plan=project.approvedPlanId?jobs.plan(project.approvedPlanId):undefined;if(!plan||plan.status!=="approved")return {ready:false as const,reason:"기획을 승인하면 묶음에 들어갈 파일을 미리 볼 수 있어요."};
  // A saved timeline that cannot be read (e.g. a moved r1 that differs from its P1 source) is shown with its reason.
  let edit:ReturnType<ReturnType<typeof timelineService>["editView"]>,timelineError:string|null=null;try{edit=timelineService(handle).editView(projectId);}catch(error){edit={id:null,value:null,snapshot:null,stale:[],current:null,timelineJson:null};timelineError=error instanceof WorkflowError?error.message:"저장한 타임라인을 확인해 주세요.";}
  const missing:{sceneNumber:number;title:string;reason:string}[]=[],present:LayoutScene[]=[];
  states.scenes(projectId).forEach((scene,index)=>{const version=scene.selectedVersionId?jobs.versions(scene.id).find(row=>row.id===scene.selectedVersionId):undefined;const asset=version?.resultAssetId?jobs.assets([version.resultAssetId])[0]:undefined;const filename=asset?resolveStoredFile(asset.filePath):null;if(!version||version.status!=="succeeded"||!asset){missing.push({sceneNumber:index+1,title:scene.title,reason:`장면 ${index+1}의 결과를 선택해 주세요.`});return;}if(!filename)missing.push({sceneNumber:index+1,title:scene.title,reason:`장면 ${index+1}의 결과 파일을 찾을 수 없어요.`});present.push({scene,version,asset,filename});});
  const entries=bundleLayout(handle,{project,plan,edit,revision:project.contentRevision,reviews:repo.reviews(projectId,project.contentRevision),selected:present}).map(entry=>({path:entry.path,sizeBytes:entryBytes(entry),missing:entry.source==="scene"&&!entry.item.filename,sample:entry.source==="scene"&&entry.item.asset.isMock}));
  const isMock=present.some(item=>item.asset.isMock);
  return {ready:true as const,fileNameExample:bundleFileName("…",isMock),isMock,fileCount:entries.length,estimatedBytes:estimateZipBytes(entries),entries,missing,subtitles:entries.some(entry=>entry.path==="subtitles/manual.srt"),editSaved:!!edit.value,timelineStale:edit.stale.length>0,timelineError};}
 return {
  context,preview,
  request:(projectId:string,revision:number)=>atomic(()=>{const data=context(projectId,revision);const base=`export:${projectId}:r${revision}:${data.plan.id}:`;const old=jobs.all().find(job=>job.idempotencyKey.startsWith(base)&&["queued","running"].includes(job.status));if(old)return {id:old.refId,jobId:old.id,duplicate:true};const id=v7(),jobId=v7();repo.insertExport({id,projectId,contentRevision:revision,status:"running"});jobs.insert({id:jobId,kind:"export",inputSnapshotJson:JSON.stringify({schemaVersion:1,projectId,revision,planId:data.plan.id,exportId:id}),status:"queued",projectId,refType:"export",refId:id,provider:"local",idempotencyKey:base+id,nextRunAt:new Date().toISOString()});jobs.log(projectId,"export.enqueue",{exportId:id,jobId,contentRevision:revision},"local-user");return {id,jobId,duplicate:false};}),
  list:(projectId:string)=>{const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);const allJobs=jobs.all();return {projectId,revision:project.contentRevision,canCreate:states.stages(projectId).some(state=>state.stage==="review"&&state.status==="approved"&&state.approvedRevision===project.contentRevision),preview:preview(projectId),rows:repo.exports(projectId).map(row=>{const job=allJobs.find(job=>job.kind==="export"&&job.refId===row.id);const manifest=row.manifestJson?manifestSchema.safeParse(JSON.parse(row.manifestJson)):null;const file=row.status==="succeeded"?resolveStoredFile(row.filePath):null;let sizeBytes:number|null=null;if(file){try{sizeBytes=statSync(file).size;}catch{sizeBytes=null;}}const isMock=manifest?.success?manifest.data.isMock:null;return {id:row.id,revision:row.contentRevision,status:row.status,jobId:job?.id??null,jobStatus:job?.status??null,error:row.error,errorCode:row.status==="failed"?job?.errorCode??null:null,retryable:row.status==="failed"&&job?.status==="failed"&&isRetryableCode(job.errorCode),createdAt:row.createdAt,completedAt:row.completedAt,available:row.status==="succeeded"&&!!file&&sizeBytes!==null,isMock,fileCount:manifest?.success?manifest.data.files.length:0,sha256:row.sha256,fileName:row.status==="succeeded"&&manifest?.success?bundleFileName(row.id,manifest.data.isMock):null,sizeBytes};})};},
 };
}
export async function runClaimedExport(handle:DatabaseHandle,job:{id:string;attempts:number;inputSnapshotJson:string;startedAt:string},now:()=>number=Date.now){
 const input=exportJobSchema.parse(JSON.parse(job.inputSnapshotJson)),service=jobsService(handle,now),repo=finishingRepository(handle),jobs=jobsRepository(handle),states=workflowRepository(handle);const record=repo.export(input.exportId);if(!record||record.projectId!==input.projectId||record.contentRevision!==input.revision)throw new MediaError("EXPORT_INVALID","내보내기 입력을 확인해 주세요.");
 const controller=new AbortController();let canceled=false,timedOut=false;const timer=setInterval(()=>{if(service.job(job.id)?.cancelRequestedAt){canceled=true;controller.abort();}else if(now()-Date.parse(job.startedAt)>10*60000){timedOut=true;controller.abort();}},250);
 let temp:string|undefined,tempCreated=false,final:string|undefined;
 try {
  if(service.job(job.id)?.cancelRequestedAt){canceled=true;throw new MediaError("EXPORT_CANCELED","내보내기를 취소했어요.");}
  let data;try{data=exportService(handle).context(input.projectId,input.revision);if(data.plan.id!==input.planId)throw new Error("plan changed");}catch{throw new MediaError("EXPORT_INVALID","내용이 바뀌었거나 검수가 유효하지 않아요. 현재 내용을 다시 검수해 주세요.",409);}
  const sources:BundleSource[]=[],files:BundleManifest["files"]=[];
  for(const entry of bundleLayout(handle,{...data,revision:input.revision})){
   if(entry.source==="text"){const bytes=Buffer.from(entry.text,"utf8");sources.push({path:entry.path,bytes});files.push({path:entry.path,mime:entry.mime,sizeBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});continue;}
   const filename=entry.source==="scene"?entry.item.filename!:entry.filename,digest=await fileDigest(filename,controller.signal);sources.push({path:entry.path,filename});
   if(entry.source==="file"){files.push({path:entry.path,mime:entry.mime,...digest});continue;}
   const item=data.selected[entry.index];files.push({sceneId:item.scene.id,versionId:item.version.id,width:item.asset.width,height:item.asset.height,durationMs:item.asset.durationMs,rights:item.asset.rightsNote,path:entry.path,mime:entry.mime,...digest});
   if(digest.sha256!==item.asset.sha256||digest.sizeBytes!==item.asset.sizeBytes)throw new MediaError("EXPORT_INVALID","결과 파일의 해시가 등록 기록과 달라요. 파일을 확인해 주세요.",409);
  }
  const manifest=manifestSchema.parse({manifestVersion:1,project:{id:data.project.id,title:data.project.title,aspect:data.project.aspect,lengthSec:data.project.lengthSec},menu:{id:data.snapshot.menu.id,label:data.snapshot.menu.label},templateVersion:data.project.templateVersion,contentRevision:input.revision,planId:data.plan.id,exportedAt:record.createdAt,isMock:data.selected.some(item=>item.asset.isMock),kind:"editing-bundle",files});
  const relative=`projects/${input.projectId}/exports/${input.exportId}.zip`,existing=resolveStoredFile(relative);const destination=await storageDirectory(`projects/${input.projectId}/exports`);final=join(/*turbopackIgnore: true*/destination,`${input.exportId}.zip`);
  if(existing)await verifyZip(existing,manifest,controller.signal);else{const tempDir=await storageDirectory("tmp");temp=join(/*turbopackIgnore: true*/tempDir,`${input.exportId}-${v7()}.zip.part`);await writeZip(temp,sources,manifest,controller.signal);tempCreated=true;await verifyZip(temp,manifest,controller.signal);}
  const digest=await fileDigest(existing??temp!,controller.signal);
  handle.sqlite.transaction(()=>{
   const claimed=service.assertClaim(job.id,job.attempts);if(claimed.cancelRequestedAt)throw new MediaError("EXPORT_CANCELED","내보내기를 취소했어요.");const current=exportService(handle).context(input.projectId,input.revision);if(current.plan.id!==input.planId)throw new MediaError("EXPORT_INVALID","승인 기획이 바뀌었어요.");let linked=false;
   try{if(!existing){linkSync(temp!,final!);linked=true;}else if(!resolveStoredFile(relative))throw new MediaError("STORAGE_FAILED","내보낸 파일이 없어졌어요.",503);
    repo.updateExport(input.exportId,{status:"succeeded",filePath:relative,manifestJson:JSON.stringify(manifest),sha256:digest.sha256,completedAt:new Date(now()).toISOString(),error:null});jobs.update(job.id,{status:"succeeded",leaseUntil:null,finishedAt:new Date(now()).toISOString(),errorCode:null,errorMessage:null});states.updateStage(input.projectId,"export",{status:"approved",approvedRevision:input.revision,approvedAt:new Date(now()).toISOString()});jobs.log(input.projectId,"export.succeeded",{exportId:input.exportId,contentRevision:input.revision,sha256:digest.sha256,isMock:manifest.isMock});
   }catch(error){if(linked){try{unlinkSync(final!);}catch{/* 확정되지 않은 파일은 다음 처리기가 검증 후 이어받을 수 있다. */}}throw error;}
  }).immediate();
 }catch(error){if(canceled){service.canceled(job.id,job.attempts);return;}if(timedOut)throw new MediaError("TIMEOUT","내보내기 제한 시간이 지났어요.");if(error instanceof MediaError||error instanceof WorkflowError)throw error;throw new MediaError("STORAGE_FAILED","편집용 묶음을 저장하거나 검증하지 못했어요. 저장 공간과 파일을 확인해 주세요.",503);}
 finally{clearInterval(timer);if(temp&&tempCreated)await unlink(temp).catch(()=>{});}
}
export function readExports(id:string){return withDatabase(handle=>exportService(handle).list(id));}
export function requestExport(id:string,revision:number){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);return withDatabase(handle=>exportService(handle).request(id,revision));}
export async function exportDownload(id:string){const row=withDatabase(handle=>finishingRepository(handle).export(id));if(!row||row.status!=="succeeded"||!row.manifestJson||!row.sha256)throw new WorkflowError("NOT_FOUND","내보낸 파일을 찾을 수 없어요.",404);const filename=resolveStoredFile(row.filePath);if(!filename)throw new MediaError("STORAGE_FAILED","내보낸 파일이 없어요. 저장 위치를 확인해 주세요.",503);const digest=await fileDigest(filename);if(digest.sha256!==row.sha256)throw new MediaError("STORAGE_FAILED","내보낸 파일이 저장 기록과 달라요. 파일을 확인해 주세요.",503);return {filename,sizeBytes:digest.sizeBytes,title:bundleFileName(id,manifestSchema.parse(JSON.parse(row.manifestJson)).isMock)};}
export type ExportsData=ReturnType<typeof readExports>;
