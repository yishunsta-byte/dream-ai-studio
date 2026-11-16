import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { assets, exports as exportRows, generations, jobs, projects, scenes, sceneVersions } from "@/lib/db/schema";
import { parseMenuConfig } from "@/lib/menus/parse";
import { projectService } from "@/lib/services/projects";
import { planningService } from "@/lib/services/planning";
import { jobsService } from "@/lib/services/jobs";
import { runNextJob } from "@/lib/jobs/runner";
import { productionService } from "@/lib/services/production";
import { editingService } from "@/lib/services/editing";
import { reviewService } from "@/lib/services/review";
import { exportDownload, exportService } from "@/lib/services/exports";
import { RETRYABLE_JOB_CODES, exportErrorCopy, isRetryableCode, safeReason, sceneErrorCopy } from "@/lib/ui/errors";
import { formatBytes, formatExactBytes } from "@/lib/ui/format";
import { placeholderText } from "@/components/result-preview";

// Virtual fixtures only (OS temp root, mock provider). Same setup as tests/jobs.test.ts.
const parsed=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));if(!parsed.ok)throw new Error("메뉴 오류");const config=parsed.config;
const providerJson=readFileSync(new URL("../config/providers.json",import.meta.url),"utf8");
let handle:DatabaseHandle,root:string,id:string,sceneId:string,assetId:string,time:number;
const now=()=>time,sleep=async(ms:number)=>{time+=ms;};
const service=()=>jobsService(handle,now),revision=()=>handle.db.select().from(projects).get()!.contentRevision;
const enqueue=(scenario="success",kind="image")=>service().enqueue({projectId:id,sceneId,revision:revision(),kind,scenario});
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const latest=()=>productionService(handle).get(id).scenes[0].versions[0];
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),"dream-t023-"));mkdirSync(join(root,"data"));mkdirSync(join(root,"config"));mkdirSync(join(root,"storage/library"),{recursive:true});writeFileSync(join(root,"config/providers.json"),providerJson);
 mkdirSync(join(root,"public/fonts"),{recursive:true});for(const name of ["PretendardVariable.woff2","OFL.txt"])copyFileSync(new URL(`../public/fonts/${name}`,import.meta.url),join(root,"public/fonts",name));
 handle=openDatabase(join(root,"data/app.db"));migrateDatabase(handle.sqlite);assetId=v7();writeFileSync(join(root,`storage/library/${assetId}.png`),"fixture");handle.db.insert(assets).values({id:assetId,kind:"image",title:"샘플",role:"original",origin:"upload",filePath:`library/${assetId}.png`,mime:"image/png",sizeBytes:7,sha256:"a".repeat(64),isMock:true,rightsNote:"직접 촬영"}).run();
 vi.spyOn(process,"cwd").mockReturnValue(root);time=Date.now();
 id=projectService(handle,config).create("shopping-shorts",{title:"T023 샘플",goal:"제품 소개",target:"샘플",aspect:"9:16",lengthSec:30,isAd:true,productName:"가상 제품",productAssets:[assetId],facts:"샘플",usageRights:"직접 촬영"});const planning=planningService(handle,config);planning.confirmBrief(id,1,true);const plan=planning.save(id,1,{script:"샘플 대본",scenes:[{stepId:config.menus[0].planSteps[0].id,title:"T023 장면",description:"샘플 설명",dialogue:"샘플 대사",durationSec:3,assetIds:[assetId],characterIds:[]}]});planning.approve(id,plan.id,2);sceneId=handle.db.select().from(scenes).get()!.id;
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();handle.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 오류");rmSync(root,{recursive:true,force:true});});

describe("오류 문장 한 곳 (lib/ui/errors.ts)",()=>{
 it("다시 시도 가능한 코드는 작업 대기열 판정과 같다",()=>{const source=readFileSync(new URL("../lib/services/jobs.ts",import.meta.url),"utf8"),match=/const retryable=new Set\(\[([^\]]*)\]\)/.exec(source);expect(match).not.toBeNull();expect(match![1].split(",").map(item=>item.trim().replace(/"/g,"")).sort()).toEqual([...RETRYABLE_JOB_CODES].sort());expect(isRetryableCode("CONTENT_REJECTED")).toBe(false);});
 it("코드별 첫 문장·다음 행동·재시도 여부",()=>{
  const rejected=sceneErrorCopy({code:"CONTENT_REJECTED",retryable:false,attempts:1});expect(rejected).toMatchObject({title:"제공사가 이 장면을 만들 수 없다고 했어요.",action:null,autoRetry:false});expect(rejected.links.map(link=>link.key)).toEqual(["plan","library"]);expect(rejected.codeLine).toContain("자동 재시도 안 함");
  expect(sceneErrorCopy({code:"STORAGE_FAILED",retryable:true,attempts:3})).toMatchObject({title:"결과는 받았지만 저장하지 못했어요.",action:"retry-storage",actionLabel:"저장 다시 시도"});
  const waiting=sceneErrorCopy({code:"PROVIDER_DOWN",retryable:false,willRetryAt:new Date(Date.UTC(2026,10,16,3,30)).toISOString(),attempts:1});expect(waiting).toMatchObject({autoRetry:true,action:null});expect(waiting.next).toMatch(/쯤 자동으로 다시 시도해요\.$/);
  expect(sceneErrorCopy({code:"TIMEOUT",retryable:true})).toMatchObject({action:"retry",actionLabel:"다시 시도"});
  expect(sceneErrorCopy({code:"AUTH",retryable:false})).toMatchObject({title:"결과를 만들지 못했어요.",action:null,links:[{key:"jobs",label:"작업 대기열 보기"}]});
  expect(exportErrorCopy({code:"EXPORT_INVALID",retryable:false,message:"결과 파일의 해시가 등록 기록과 달라요."})).toMatchObject({title:"묶음을 만들지 못했어요.",reason:"결과 파일이 등록 기록과 달라요.",action:"recreate"});
  expect(exportErrorCopy({code:"STORAGE_FAILED",retryable:true})).toMatchObject({action:"retry"});
 });
 it("이유 줄에서 경로·키 모양 글자를 빼고 샘플 문장은 그대로 둔다",()=>{expect(safeReason("시험용 콘텐츠 거절 시나리오예요. 내용을 바꾼 뒤 새로 요청해 주세요.")).toBe("시험용 콘텐츠 거절 시나리오예요. 내용을 바꾼 뒤 새로 요청해 주세요.");for(const leak of ["D:\\data\\storage\\x.png 저장 실패","/Users/me/storage 실패","api_key=abc 오류","sk-ABCDEFGHIJKLMNOP 거절",`해시 ${"f".repeat(64)}`])expect(safeReason(leak)).toBeNull();});
 it("실패·취소 자리 표시는 기다린다고 말하지 않는다",()=>{expect(placeholderText({status:"failed"})).toBe("만들지 못했어요.");expect(placeholderText({status:"canceled"})).toBe("취소했어요.");expect(placeholderText({status:"none"})).toBe("아직 만들지 않았어요.");expect(placeholderText({status:"queued",queuePosition:2})).toBe("대기 중 · 작업 대기열 2번째");expect(placeholderText({status:"running",elapsedSec:4})).toBe("만드는 중 · 4초 지남");for(const status of ["failed","canceled","none"] as const)expect(placeholderText({status})).not.toContain("기다리");});
 it("크기 표시",()=>{expect(formatBytes(999)).toBe("999바이트");expect(formatBytes(2431872)).toBe("2.4MB");expect(formatExactBytes(2431872)).toBe("2,431,872바이트");});
});

describe("장면 실패 정보 (F-016-1)",()=>{
 it("거절은 실패·시도1·재시도 없음으로 보이고 기존 선택은 그대로다",async()=>{
  enqueue();await runNextJob(handle,{now,sleep});const first=handle.db.select().from(scenes).get()!.selectedVersionId;expect(first).not.toBeNull();
  const rejected=enqueue("fail:CONTENT_REJECTED");await runNextJob(handle,{now,sleep});
  const version=latest();expect(version).toMatchObject({status:"failed",asset:null});expect(version.job).toMatchObject({status:"failed",errorCode:"CONTENT_REJECTED",retryable:false,willRetryAt:null,attempts:1});expect(version.job!.errorMessage).toContain("시험용 콘텐츠 거절");
  expect(Object.keys(version.job!).sort()).toEqual(["attempts","cancelRequested","elapsedSec","errorCode","errorMessage","id","queuePosition","retryable","startedAt","status","willRetryAt"]);
  expect(productionService(handle).get(id).scenes[0].selectedVersionId).toBe(first);
  time+=3600000;expect(await runNextJob(handle,{now,sleep})).toBe(false);expect(service().job(rejected.jobId)?.attempts).toBe(1);expect(()=>service().retry(rejected.jobId)).toThrow();
 });
 it("일시 중단은 자동 재시도 시각을 보이고 성공하면 오류가 사라진다",async()=>{
  enqueue("fail:PROVIDER_DOWN");await runNextJob(handle,{now,sleep});const waiting=latest();expect(waiting.status).toBe("queued");expect(waiting.job).toMatchObject({status:"queued",errorCode:"PROVIDER_DOWN",retryable:false,queuePosition:1});expect(waiting.job!.willRetryAt).toBeTruthy();expect(sceneErrorCopy({code:waiting.job!.errorCode,retryable:false,willRetryAt:waiting.job!.willRetryAt}).autoRetry).toBe(true);
  for(let i=0;i<5&&latest().status!=="succeeded";i++){time+=600000;await runNextJob(handle,{now,sleep});}
  expect(latest()).toMatchObject({status:"succeeded"});expect(latest().job).toMatchObject({status:"succeeded",errorCode:null,willRetryAt:null});
 });
 it("저장 실패는 다시 만들지 않고 저장만 다시 시도한다",async()=>{
  const job=enqueue();const blocked=join(root,"storage/projects");writeFileSync(blocked,"blocked fixture");
  for(let i=0;i<6&&service().job(job.jobId)?.status!=="failed";i++){await runNextJob(handle,{now,sleep});time+=130000;}
  const failed=latest();expect(failed.job).toMatchObject({status:"failed",errorCode:"STORAGE_FAILED",retryable:true});expect(sceneErrorCopy({code:failed.job!.errorCode,retryable:failed.job!.retryable}).action).toBe("retry-storage");
  const provider=handle.db.select().from(jobs).where(eq(jobs.id,job.jobId)).get()!.providerJobId;expect(provider).toBeTruthy();
  rmSync(blocked);service().retry(job.jobId);await runNextJob(handle,{now,sleep});
  expect(latest()).toMatchObject({status:"succeeded"});expect(handle.db.select().from(generations).all()).toHaveLength(1);expect(handle.db.select().from(jobs).where(eq(jobs.id,job.jobId)).get()!.providerJobId).toBe(provider);
 });
});

describe("내보내기 미리보기·완료 정보 (F-016-2)",()=>{
 function saveEdit(subtitle:boolean){const editing=editingService(handle),data=editing.get(id);const layers=subtitle?[...data.value.layers,{id:v7(),kind:"subtitle" as const,content:"샘플 수동 자막",fontFamily:"Pretendard" as const,fontSize:64,color:"#FFFFFF",position:"bottom" as const,startSec:.125,endSec:2.5,locked:false}]:data.value.layers;editing.save(id,revision(),{...data.value,layers});return editing;}
 function approveAll(subtitle=true){const editing=saveEdit(subtitle);editing.complete(id,revision());const review=reviewService(handle),data=review.get(id);for(const item of data.items)review.update(id,revision(),{itemId:item.templateItemId,status:"pass",note:"샘플 흐름 직접 확인"});review.approve(id,revision());}
 async function produce(){enqueue();await runNextJob(handle,{now,sleep});productionService(handle).complete(id,revision());}
 async function exportNow(){const request=exportService(handle).request(id,revision());await runNextJob(handle,{now,sleep});return request;}
 it("검수 전에도 미리보기가 보이고 실제 ZIP 경로·순서와 같으며 예상 크기는 ±10% 안이다",async()=>{
  await produce();const before=exportService(handle).list(id);expect(before.canCreate).toBe(false);expect(before.preview).toMatchObject({ready:true,isMock:true,subtitles:false,missing:[]});
  approveAll(true);const preview=exportService(handle).list(id).preview;if(!preview.ready)throw new Error("preview");expect(preview.subtitles).toBe(true);
  const request=await exportNow();const row=handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()!;expect(row.status).toBe("succeeded");const manifest=JSON.parse(row.manifestJson!);
  expect(preview.entries.map(entry=>entry.path)).toEqual(manifest.files.map((file:{path:string})=>file.path));expect(preview.fileCount).toBe(manifest.files.length);
  for(const entry of preview.entries)expect(entry.sizeBytes).toBe(manifest.files.find((file:{path:string})=>file.path===entry.path).sizeBytes);
  const actual=statSync(join(root,"storage",row.filePath!)).size;expect(Math.abs(preview.estimatedBytes-actual)/actual).toBeLessThan(.1);
 });
 it("자막이 없으면 미리보기와 ZIP 모두 subtitles/를 넣지 않는다",async()=>{await produce();approveAll(false);const preview=exportService(handle).list(id).preview;if(!preview.ready)throw new Error("preview");expect(preview.subtitles).toBe(false);const request=await exportNow();const manifest=JSON.parse(handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()!.manifestJson!);expect(preview.entries.map(entry=>entry.path)).toEqual(manifest.files.map((file:{path:string})=>file.path));});
 it("완료 행의 이름·크기가 내려받기 응답·실제 파일과 같고 목록 조회는 완료 파일을 바꾸지 않는다",async()=>{
  await produce();approveAll();const request=await exportNow();const stored=handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()!,file=join(root,"storage",stored.filePath!),before=sha(file);
  const row=exportService(handle).list(id).rows.find(item=>item.id===request.id)!;
  // Server helpers read migrations from the app folder and data from DREAM_DATA_ROOT.
  vi.stubEnv("DREAM_DATA_ROOT",root);vi.mocked(process.cwd).mockReturnValue(fileURLToPath(new URL("..",import.meta.url)));const download=await exportDownload(request.id);
  expect(row).toMatchObject({status:"succeeded",available:true,isMock:true,errorCode:null,retryable:false,fileName:download.title,sizeBytes:download.sizeBytes});expect(row.fileName).toBe(`editing-${request.id}_SAMPLE.zip`);expect(row.sizeBytes).toBe(statSync(file).size);expect(row.sha256!.slice(0,8)).toBe(before.slice(0,8));
  const { GET }=await import("@/app/api/exports/[id]/route");const response=await GET(new Request(`http://127.0.0.1/api/exports/${request.id}`),{params:Promise.resolve({id:request.id})});const body=Buffer.from(await response.arrayBuffer());
  expect(response.headers.get("content-length")).toBe(String(row.sizeBytes));expect(response.headers.get("content-disposition")).toContain(encodeURIComponent(row.fileName!));expect(body.length).toBe(row.sizeBytes);expect(createHash("sha256").update(body).digest("hex")).toBe(stored.sha256);
  expect(JSON.stringify(exportService(handle).list(id))).not.toContain(root);expect(sha(file)).toBe(before);expect(handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()).toEqual(stored);
 });
 it("장면 파일이 없으면 미리보기에 표시하고 만든 묶음은 실패·재생성 안내로 남긴다",async()=>{
  await produce();approveAll();const version=handle.db.select().from(sceneVersions).get()!,asset=handle.db.select().from(assets).where(eq(assets.id,version.resultAssetId!)).get()!,path=join(root,"storage",asset.filePath!);
  writeFileSync(path,"tampered test fixture");const request=await exportNow();const row=exportService(handle).list(id).rows.find(item=>item.id===request.id)!;
  expect(row).toMatchObject({status:"failed",errorCode:"EXPORT_INVALID",retryable:false,available:false,fileName:null,sizeBytes:null});expect(exportErrorCopy({code:row.errorCode,retryable:row.retryable,message:row.error}).action).toBe("recreate");
  renameSync(path,`${path}.moved`);const preview=exportService(handle).list(id).preview;if(!preview.ready)throw new Error("preview");expect(preview.missing).toEqual([{sceneNumber:1,title:"T023 장면",reason:"장면 1의 결과 파일을 찾을 수 없어요."}]);expect(preview.entries.find(entry=>entry.path.startsWith("scenes/"))?.missing).toBe(true);
 });
 it("저장 실패가 확정되면 다시 시도 가능으로 보인다",async()=>{
  await produce();approveAll();const blocked=join(root,`storage/projects/${id}/exports`);writeFileSync(blocked,"blocked fixture");const request=exportService(handle).request(id,revision());
  for(let i=0;i<6&&service().job(request.jobId)?.status!=="failed";i++){await runNextJob(handle,{now,sleep});time+=130000;}
  const row=exportService(handle).list(id).rows.find(item=>item.id===request.id)!;expect(row).toMatchObject({status:"failed",errorCode:"STORAGE_FAILED",retryable:true,available:false});expect(exportErrorCopy({code:row.errorCode,retryable:row.retryable}).action).toBe("retry");
  rmSync(blocked);service().retry(request.jobId);await runNextJob(handle,{now,sleep});expect(exportService(handle).list(id).rows.find(item=>item.id===request.id)).toMatchObject({status:"succeeded",available:true});
 });
 it("기획 승인 전에는 미리보기 대신 이유를 보인다",()=>{handle.db.update(projects).set({approvedPlanId:null}).where(eq(projects.id,id)).run();expect(exportService(handle).list(id).preview).toEqual({ready:false,reason:"기획을 승인하면 묶음에 들어갈 파일을 미리 볼 수 있어요."});});
});
