import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { assets, exports as exportRows, generations, jobs, plans, projects, reviewItems, scenes, sceneVersions, settings, stageStates } from "@/lib/db/schema";
import { parseMenuConfig } from "@/lib/menus/parse";
import { projectService } from "@/lib/services/projects";
import { planningService } from "@/lib/services/planning";
import { jobsService } from "@/lib/services/jobs";
import { runNextJob } from "@/lib/jobs/runner";
import { createMockProvider, mockImage, mockSpeech } from "@/lib/providers/mock";
import { generationInputSchema } from "@/lib/jobs/schema";
import { productionService } from "@/lib/services/production";
import { editingService } from "@/lib/services/editing";
import { reviewService } from "@/lib/services/review";
import { exportService, runClaimedExport } from "@/lib/services/exports";
import { workflowService } from "@/lib/services/workflow";
import { fileDigest, verifyZip } from "@/lib/export/zip";
import { srtText } from "@/lib/edit/schema";
import { timelineVtt } from "@/lib/edit/timeline";
import { timelineService } from "@/lib/services/timeline";
import { openPromise } from "yauzl";
const parsed=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));if(!parsed.ok)throw new Error("메뉴 오류");const config=parsed.config;
const providerJson=readFileSync(new URL("../config/providers.json",import.meta.url),"utf8");
let handle:DatabaseHandle,root:string,id:string,sceneId:string,assetId:string,time:number;
const now=()=>time,sleep=async(ms:number)=>{time+=ms;};
const service=()=>jobsService(handle,now);
const revision=()=>handle.db.select().from(projects).get()!.contentRevision;
const enqueue=(scenario="success",kind="image")=>service().enqueue({projectId:id,sceneId,revision:revision(),kind,scenario});
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),"dream-ai-jobs-"));mkdirSync(join(root,"data"));mkdirSync(join(root,"config"));mkdirSync(join(root,"storage/library"),{recursive:true});writeFileSync(join(root,"config/providers.json"),providerJson);
 handle=openDatabase(join(root,"data/app.db"));migrateDatabase(handle.sqlite);assetId=v7();writeFileSync(join(root,`storage/library/${assetId}.png`),"fixture");handle.db.insert(assets).values({id:assetId,kind:"image",title:"샘플",role:"original",origin:"upload",filePath:`library/${assetId}.png`,mime:"image/png",sizeBytes:7,sha256:"a".repeat(64),isMock:true,rightsNote:"직접 촬영"}).run();
 vi.spyOn(process,"cwd").mockReturnValue(root);time=Date.now();
 id=projectService(handle,config).create("shopping-shorts",{title:"큐 샘플",goal:"제품 소개",target:"샘플",aspect:"9:16",lengthSec:30,isAd:true,productName:"가상 제품",productAssets:[assetId],facts:"샘플",usageRights:"직접 촬영"});const planning=planningService(handle,config);planning.confirmBrief(id,1,true);const plan=planning.save(id,1,{script:"샘플 대본",scenes:[{stepId:config.menus[0].planSteps[0].id,title:"큐 샘플 장면",description:"샘플 설명",dialogue:"샘플 대사",durationSec:3,assetIds:[assetId],characterIds:[]}]});planning.approve(id,plan.id,2);sceneId=handle.db.select().from(scenes).get()!.id;
});
describe("장면 버전 선택·복원",()=>{
 async function twoVersions(){enqueue();await runNextJob(handle,{now,sleep});enqueue();await runNextJob(handle,{now,sleep});return handle.db.select().from(sceneVersions).all();}
 function twoScenePlan(){const planning=planningService(handle,config),old=planning.get(id).versions[0];const next=planning.save(id,revision(),{script:old.script,scenes:[...old.scenes,{...old.scenes[0],sceneId:undefined,title:"다른 샘플 장면"}]});planning.approve(id,next.id,next.revision);return handle.db.select().from(scenes).all().find(row=>row.id!==sceneId)!;}
 it("하나만 새로 만들고 재선택해도 다른 장면과 원본 파일·버전은 보존한다",async()=>{
  const other=twoScenePlan();enqueue();service().enqueue({projectId:id,sceneId:other.id,revision:revision(),kind:"image"});await runNextJob(handle,{now,sleep});await runNextJob(handle,{now,sleep});const original=handle.db.select().from(sceneVersions).where(eq(sceneVersions.sceneId,sceneId)).get()!;const asset=handle.db.select().from(assets).where(eq(assets.id,original.resultAssetId!)).get()!;const bytes=readFileSync(join(root,"storage",asset.filePath!));const otherBefore=handle.db.select().from(scenes).where(eq(scenes.id,other.id)).get();enqueue();await runNextJob(handle,{now,sleep});
  const newer=handle.db.select().from(sceneVersions).where(eq(sceneVersions.sceneId,sceneId)).all().find(row=>row.id!==original.id)!;const production=productionService(handle);const before=revision();production.select(id,sceneId,newer.id,before,original.id);expect(revision()).toBe(before+1);production.select(id,sceneId,original.id,revision(),newer.id);
  expect(handle.db.select().from(scenes).where(eq(scenes.id,other.id)).get()).toEqual(otherBefore);expect(handle.db.select().from(sceneVersions).where(eq(sceneVersions.id,original.id)).get()).toEqual(original);expect(readFileSync(join(root,"storage",asset.filePath!)).equals(bytes)).toBe(true);expect(handle.db.select().from(sceneVersions).where(eq(sceneVersions.sceneId,sceneId)).all()).toHaveLength(2);
 });
 it("같은 revision의 두 선택 중 하나만 쓰고 오래된 선택 포인터도 거부한다",async()=>{
  const [first,second]=await twoVersions(),old=revision();const another=openDatabase(join(root,"data/app.db"));try{productionService(handle).select(id,sceneId,second.id,old,first.id);expect(()=>productionService(another).select(id,sceneId,first.id,old,first.id)).toThrow();expect(()=>productionService(another).select(id,sceneId,first.id,revision(),first.id)).toThrow();}finally{another.close();}expect(handle.db.select().from(scenes).get()?.selectedVersionId).toBe(second.id);
 });
 it("같은 버전 재선택은 내용 버전을 불필요하게 올리지 않는다",async()=>{
  const [first]=await twoVersions();const before=revision();expect(productionService(handle).select(id,sceneId,first.id,before,first.id)).toBe(before);expect(revision()).toBe(before);
 });
 it("기획 변경 후 이전 결과 복원은 재확인 전 완료할 수 없다",async()=>{
  const [first,second]=await twoVersions();const planning=planningService(handle,config),old=planning.get(id).versions[0];const next=planning.save(id,revision(),{script:old.script,scenes:old.scenes.map(row=>({...row,description:"바뀐 기획 설명"}))});planning.approve(id,next.id,next.revision);const production=productionService(handle);production.select(id,sceneId,second.id,revision(),first.id);expect(handle.db.select().from(scenes).get()?.needsRecheck).toBe(true);expect(()=>production.complete(id,revision())).toThrow();const before=revision();production.keep(id,sceneId,before,second.id);expect(revision()).toBe(before);production.complete(id,before);expect(handle.db.select().from(stageStates).all().find(row=>row.stage==="produce")?.status).toBe("approved");
 });
 it("대기 결과·다른 장면 결과·누락 파일은 선택하지 않는다",async()=>{
  const [first,second]=await twoVersions();const pending=enqueue();const waiting=handle.db.select().from(sceneVersions).where(eq(sceneVersions.jobId,pending.jobId)).get()!;const production=productionService(handle);expect(()=>production.select(id,sceneId,waiting.id,revision(),first.id)).toThrow();expect(()=>production.select(id,v7(),second.id,revision(),null)).toThrow();const asset=handle.db.select().from(assets).where(eq(assets.id,second.resultAssetId!)).get()!;rmSync(join(root,"storage",asset.filePath!));const before=revision();expect(()=>production.select(id,sceneId,second.id,before,first.id)).toThrow();expect(revision()).toBe(before);
 });
 it("자료 보관은 사용 중인 선택 결과를 끊지 않으며 내용 변경은 후속 단계를 잠근다",async()=>{
  const [first,second]=await twoVersions();handle.db.update(assets).set({archivedAt:new Date().toISOString()}).where(eq(assets.id,first.resultAssetId!)).run();const production=productionService(handle);production.complete(id,revision());expect(production.get(id).completed).toBe(true);production.select(id,sceneId,second.id,revision(),first.id);expect(production.get(id).completed).toBe(false);expect(handle.db.select().from(stageStates).all().find(row=>row.stage==="edit")?.status).toBe("locked");
 });
 it("결과·진행 중 작업이 없는 장면만 묶음 등록한다",async()=>{
  const other=twoScenePlan();enqueue();const production=productionService(handle);const added=production.missing(id,revision());expect(added).toHaveLength(1);expect(service().job(added[0].jobId)?.refId).toBe(other.id);expect(production.missing(id,revision())).toHaveLength(0);await runNextJob(handle,{now,sleep});await runNextJob(handle,{now,sleep});expect(production.missing(id,revision())).toHaveLength(0);
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();handle.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 오류");rmSync(root,{recursive:true,force:true});});
describe("정적 글자·검수·편집용 묶음",()=>{
 beforeEach(async()=>{mkdirSync(join(root,"public/fonts"),{recursive:true});for(const name of ["PretendardVariable.woff2","OFL.txt"])copyFileSync(new URL(`../public/fonts/${name}`,import.meta.url),join(root,"public/fonts",name));enqueue();await runNextJob(handle,{now,sleep});productionService(handle).complete(id,revision());});
 function saveEdit(){const editing=editingService(handle),data=editing.get(id);const value={...data.value,layers:[...data.value.layers,{id:v7(),kind:"subtitle" as const,content:"샘플 수동 자막",fontFamily:"Pretendard" as const,fontSize:64,color:"#FFFFFF",position:"bottom" as const,startSec:.125,endSec:2.5,locked:false}]};const saved=editing.save(id,revision(),value);return {editing,value,saved};}
 function approveAll(){const {editing}=saveEdit();editing.complete(id,revision());const review=reviewService(handle),data=review.get(id);for(const item of data.items)review.update(id,revision(),{itemId:item.templateItemId,status:"pass",note:"샘플 흐름 직접 확인"});review.approve(id,revision());return review;}
 it("필수 광고 표기의 삭제·문구·시간 변경과 잘못된 순서를 서버에서 막는다",()=>{const editing=editingService(handle),data=editing.get(id);expect(data.value.layers[0]).toMatchObject({content:"광고",locked:true,startSec:0,endSec:3});for(const patch of [{layers:[]},{layers:data.value.layers.map(layer=>({...layer,content:"표기 바꾸기"}))},{layers:data.value.layers.map(layer=>({...layer,endSec:1}))},{sceneOrder:[sceneId,sceneId]}])expect(()=>editing.save(id,revision(),{...data.value,...patch})).toThrow();expect(handle.db.select().from(settings).all().filter(row=>row.key.startsWith("project."))).toHaveLength(0);});
 // T-061: the static editor now saves timeline revisions (no new P1 settings snapshot); the rows are immutable in the DB.
 it("글자는 새 타임라인 행·메타데이터로 저장하고 이전 행 수정·삭제를 DB도 거부한다",()=>{const {editing,value,saved}=saveEdit();const first=handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(saved.id) as Record<string,unknown>;expect(first).toMatchObject({project_id:id,revision:1,content_revision:revision(),source:"user",created_at:expect.stringMatching(/Z$/)});expect(handle.db.select().from(settings).all().filter(row=>row.key.startsWith(`project.${id}.edit.`))).toHaveLength(0);expect(()=>handle.sqlite.prepare("UPDATE timeline_revisions SET timeline_json='{}' WHERE id=?").run(saved.id)).toThrow();expect(()=>handle.sqlite.prepare("DELETE FROM timeline_revisions WHERE id=?").run(saved.id)).toThrow();const before=revision();expect(editing.save(id,before,value)).toMatchObject({revision:before,id:saved.id});editing.save(id,before,{...value,layers:value.layers.map(layer=>layer.kind==="subtitle"?{...layer,content:"고친 샘플 문구"}:layer)});expect(handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(saved.id)).toEqual(first);expect(revision()).toBe(before+1);});
 it("직접 입력한 자막 시간만 SRT로 만들고 표기 레이어는 자막으로 꾸미지 않는다",()=>{const {value}=saveEdit();expect(srtText(value.layers)).toBe("1\n00:00:00,125 --> 00:00:02,500\n샘플 수동 자막\n");});
 it("장면 순서 수정은 선택 결과와 승인 기획 원본을 바꾸지 않는다",async()=>{const planning=planningService(handle,config),old=planning.get(id).versions[0],draft=planning.save(id,revision(),{script:old.script,scenes:[...old.scenes,{...old.scenes[0],sceneId:undefined,title:"추가 샘플 장면"}]});planning.approve(id,draft.id,draft.revision);const selectedBefore=handle.db.select().from(scenes).where(eq(scenes.id,sceneId)).get()!.selectedVersionId;productionService(handle).keep(id,sceneId,revision(),selectedBefore);const other=handle.db.select().from(scenes).all().find(scene=>scene.id!==sceneId)!;service().enqueue({projectId:id,sceneId:other.id,revision:revision(),kind:"image"});await runNextJob(handle,{now,sleep});productionService(handle).complete(id,revision());const approved=handle.db.select().from(plans).where(eq(plans.id,draft.id)).get(),editing=editingService(handle),value=editing.get(id).value;editing.save(id,revision(),{...value,sceneOrder:[...value.sceneOrder].reverse()});expect(productionService(handle).get(id).scenes[0].id).toBe(other.id);expect(handle.db.select().from(scenes).where(eq(scenes.id,sceneId)).get()?.selectedVersionId).toBe(selectedBefore);expect(handle.db.select().from(plans).where(eq(plans.id,draft.id)).get()).toEqual(approved);});
 it("필수 항목 누락·사유 없는 보류를 거절하고 승인 후 검수 원본을 보존한다",()=>{const {editing}=saveEdit();editing.complete(id,revision());const review=reviewService(handle),data=review.get(id);expect(data.items.some(item=>item.templateItemId==="x.ad-disclosure")).toBe(true);expect(()=>review.approve(id,revision())).toThrow();expect(()=>review.update(id,revision(),{itemId:data.items[0].templateItemId,status:"hold",note:""})).toThrow();review.update(id,revision(),{itemId:data.items[0].templateItemId,status:"hold",note:"샘플 보류 사유"});for(const item of data.items.slice(1))review.update(id,revision(),{itemId:item.templateItemId,status:"pass",note:""});expect(()=>review.approve(id,revision())).toThrow();review.update(id,revision(),{itemId:data.items[0].templateItemId,status:"pass",note:"확인 후 통과"});review.approve(id,revision());expect(()=>review.update(id,revision(),{itemId:data.items[0].templateItemId,status:"unchecked",note:""})).toThrow();});
 it("검수 전 직접 내보내기는 거절하고 중복 진행 요청은 작업 하나만 만든다",()=>{expect(()=>exportService(handle).request(id,revision())).toThrow();approveAll();const first=exportService(handle).request(id,revision()),second=exportService(handle).request(id,revision());expect(second).toMatchObject({id:first.id,jobId:first.jobId,duplicate:true});expect(handle.db.select().from(jobs).all().filter(job=>job.kind==="export")).toHaveLength(1);});
 it("실제 ZIP을 다시 열어 전 파일 해시·샘플 이름·사용권·수동 SRT를 검증한다",async()=>{approveAll();writeFileSync(join(root,".env.local"),"TEST_ONLY_SENTINEL=DO_NOT_EXPORT_FIXTURE");const request=exportService(handle).request(id,revision());await runNextJob(handle,{now,sleep});const row=handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()!;expect(row.status).toBe("succeeded");const manifest=JSON.parse(row.manifestJson!),filename=join(root,"storage",row.filePath!);await expect(verifyZip(filename,manifest)).resolves.toMatchObject({isMock:true,kind:"editing-bundle",contentRevision:revision()});expect(manifest.files.some((file:{path:string})=>file.path.includes("_SAMPLE.png"))).toBe(true);expect(manifest.files.some((file:{path:string})=>file.path==="subtitles/manual.srt")).toBe(true);expect(manifest.files.some((file:{path:string})=>file.path==="LICENSES/Pretendard-OFL.txt")).toBe(true);expect(manifest.files.some((file:{path:string})=>file.path.startsWith("final/")||file.path.includes(".env"))).toBe(false);expect(JSON.stringify(manifest)).not.toContain(root);expect((await fileDigest(filename)).sha256).toBe(row.sha256);expect(()=>handle.db.update(exportRows).set({manifestJson:"{}"}).where(eq(exportRows.id,row.id)).run()).toThrow();});
 // T-155 (P2-6 S1): a real export of a saved timeline carries subtitles/timeline.vtt made from the stored subtitle layers;
 // the SRT stays the same function. Without any subtitle there is no VTT (and no SRT). T155_VTT_DIR (an OS temp folder
 // only) receives the extracted file for the browser textTrack check.
 async function zipTexts(filename:string){const zip=await openPromise(filename,{lazyEntries:true,autoClose:false}),texts=new Map<string,string>();
  try{for await(const entry of zip.eachEntry()){if(!entry.fileName.startsWith("subtitles/"))continue;const chunks:Buffer[]=[];for await(const chunk of await zip.openReadStreamPromise(entry))chunks.push(chunk as Buffer);texts.set(entry.fileName,Buffer.concat(chunks).toString("utf8"));}}finally{zip.close();}return texts;}
 function approveWith(layers:{content:string;startSec:number;endSec:number}[]){const editing=editingService(handle),data=editing.get(id);
  editing.save(id,revision(),{...data.value,layers:[...data.value.layers,...layers.map(item=>({id:v7(),kind:"subtitle" as const,fontFamily:"Pretendard" as const,fontSize:64,color:"#FFFFFF",position:"bottom" as const,locked:false,...item}))]});editing.complete(id,revision());
  const review=reviewService(handle);for(const item of review.get(id).items)review.update(id,revision(),{itemId:item.templateItemId,status:"pass",note:"샘플 흐름 직접 확인"});review.approve(id,revision());}
 async function exported(){const request=exportService(handle).request(id,revision());await runNextJob(handle,{now,sleep});const row=handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()!;expect(row.status).toBe("succeeded");
  const manifest=JSON.parse(row.manifestJson!),filename=join(root,"storage",row.filePath!);await verifyZip(filename,manifest);return {manifest,texts:await zipTexts(filename)};}
 it("실제 ZIP의 timeline.vtt는 저장 타임라인 자막과 같고(escape·여러 줄·겹침) SRT 함수는 그대로다",async()=>{
  approveWith([{content:"A & B <i>x</i> --> 끝 😀\n둘째 줄",startSec:.125,endSec:2.5},{content:"겹치는 자막",startSec:1,endSec:3}]);
  const {manifest,texts}=await exported(),vtt=texts.get("subtitles/timeline.vtt")!,saved=timelineService(handle).get(id).timeline!;
  expect(manifest.files.find((file:{path:string})=>file.path==="subtitles/timeline.vtt")).toMatchObject({mime:"text/vtt",sizeBytes:Buffer.byteLength(vtt,"utf8")});
  expect(vtt).toBe(timelineVtt(saved.text));expect(texts.get("subtitles/manual.srt")).toBe(srtText(timelineService(handle).editView(id).value!.layers));
  expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);expect(vtt).not.toContain("\r");expect(vtt).not.toContain("광고");expect(vtt.split("\n\n").length).toBe(3);
  expect(vtt).toContain("A &amp; B &lt;i&gt;x&lt;/i&gt; --&gt; 끝 😀\n둘째 줄");
  const out=process.env.T155_VTT_DIR;if(out&&realpathSync.native(out).startsWith(realpathSync.native(tmpdir())+sep)){writeFileSync(join(out,"timeline.vtt"),vtt);writeFileSync(join(out,"subtitles.json"),JSON.stringify(saved.text.filter(layer=>layer.kind==="subtitle")));}
 });
 it("자막이 없는 타임라인 묶음에는 VTT·SRT 파일이 없다",async()=>{approveWith([]);const {manifest,texts}=await exported();expect(texts.size).toBe(0);expect(manifest.files.some((file:{path:string})=>file.path.startsWith("subtitles/"))).toBe(false);expect(manifest.files.some((file:{path:string})=>file.path==="edit/timeline.json")).toBe(true);});
 it("글자 수정은 생성 없이 검수·내보내기 자격만 무효화하고 예전 ZIP은 보존한다",async()=>{approveAll();const request=exportService(handle).request(id,revision());await runNextJob(handle,{now,sleep});const original=handle.db.select().from(exportRows).where(eq(exportRows.id,request.id)).get()!,oldRevision=revision(),oldReviews=handle.db.select().from(reviewItems).all(),count=handle.db.select().from(generations).all().length;const editing=editingService(handle),value=editing.get(id).value;editing.save(id,oldRevision,{...value,layers:value.layers.map(layer=>layer.kind==="subtitle"?{...layer,content:"수정한 샘플 자막"}:layer)});expect(revision()).toBe(oldRevision+1);expect(handle.db.select().from(generations).all()).toHaveLength(count);expect(()=>workflowService(handle).requireApprovedReview(id)).toThrow();expect(()=>exportService(handle).request(id,revision())).toThrow();expect(handle.db.select().from(exportRows).where(eq(exportRows.id,original.id)).get()).toEqual(original);expect((await fileDigest(join(root,"storage",original.filePath!))).sha256).toBe(original.sha256);editing.complete(id,revision());expect(reviewService(handle).get(id).items.every(item=>item.status==="unchecked")).toBe(true);expect(handle.db.select().from(reviewItems).all().filter(item=>item.contentRevision===oldRevision)).toEqual(oldReviews);});
 it("누락·해시가 바뀐 장면 파일은 성공 ZIP으로 내보내지 않는다",async()=>{approveAll();const request=exportService(handle).request(id,revision());const version=handle.db.select().from(sceneVersions).get()!,asset=handle.db.select().from(assets).where(eq(assets.id,version.resultAssetId!)).get()!;writeFileSync(join(root,"storage",asset.filePath!),"tampered test fixture");await runNextJob(handle,{now,sleep});expect(service().job(request.jobId)).toMatchObject({status:"failed",errorCode:"EXPORT_INVALID"});expect(handle.db.select().from(exportRows).get()).toMatchObject({status:"failed",filePath:null});});
 it("저장 실패는 실패로 남기고 같은 내보내기 작업만 재시도한다",async()=>{approveAll();const request=exportService(handle).request(id,revision()),blocked=join(root,`storage/projects/${id}/exports`);writeFileSync(blocked,"blocked fixture");await runNextJob(handle,{now,sleep});expect(service().job(request.jobId)).toMatchObject({status:"queued",errorCode:"STORAGE_FAILED"});expect(handle.db.select().from(exportRows).get()).toMatchObject({status:"failed",filePath:null});const count=handle.db.select().from(generations).all().length;rmSync(blocked);time+=30000;await runNextJob(handle,{now,sleep});expect(service().job(request.jobId)?.status).toBe("succeeded");expect(handle.db.select().from(generations).all()).toHaveLength(count);});
 it("내보내기 처리 중 내용 변경·취소를 성공으로 확정하지 않는다",async()=>{approveAll();const request=exportService(handle).request(id,revision());const claimed=service().claim()!;service().cancel(request.jobId);try{await runClaimedExport(handle,claimed,now);}catch(error){service().fail(claimed.id,claimed.attempts,"EXPORT_CANCELED",(error as Error).message);}expect(service().job(request.jobId)?.status).toBe("canceled");expect(handle.db.select().from(exportRows).get()?.status).toBe("failed");const next=exportService(handle).request(id,revision());const editing=editingService(handle),value=editing.get(id).value;editing.save(id,revision(),{...value,layers:value.layers.map(layer=>layer.kind==="subtitle"?{...layer,content:"새 내용"}:layer)});await runNextJob(handle,{now,sleep});expect(service().job(next.jobId)).toMatchObject({status:"failed",errorCode:"EXPORT_INVALID"});});
 it("만료된 이전 워커와 복구 워커가 겹쳐도 새 성공 ZIP을 지우지 않는다",async()=>{approveAll();const request=exportService(handle).request(id,revision()),old=service().claim()!;time+=61000;const current=service().claim()!;const results=await Promise.allSettled([runClaimedExport(handle,old,now),runClaimedExport(handle,current,now)]);expect(results[0].status).toBe("rejected");expect(results[1].status).toBe("fulfilled");const row=handle.db.select().from(exportRows).get()!;expect(service().job(request.jobId)?.status).toBe("succeeded");expect(existsSync(join(root,"storage",row.filePath!))).toBe(true);expect((await fileDigest(join(root,"storage",row.filePath!))).sha256).toBe(row.sha256);});
});

describe("작업 대기열·워커",()=>{
 it("무작위 시험은 기본 꺼져 있고 직접 설정했을 때만 입력에 기록한다",()=>{
  const random=vi.spyOn(Math,"random").mockReturnValue(0);const first=enqueue();expect(JSON.parse(service().job(first.jobId)!.inputSnapshotJson).scenario).toBe("success");expect(random).not.toHaveBeenCalled();
  const changed=JSON.parse(providerJson);changed.manualQa={randomFailureEnabled:true,failureRate:0.1};writeFileSync(join(root,"config/providers.json"),JSON.stringify(changed));const next=enqueue();expect(JSON.parse(service().job(next.jobId)!.inputSnapshotJson).scenario).toBe("fail:PROVIDER_DOWN");
 });
 it("샘플 글은 순서 라벨을 따르고 영상 도구가 없으면 PNG 대체를 명시한다",async()=>{
  const job=enqueue(),input=generationInputSchema.parse(JSON.parse(service().job(job.jobId)!.inputSnapshotJson));
  const provider=createMockProvider(input,1,1,now),submission=await provider.submit({capability:"text",model:"sample-text-v1",params:{planSteps:["도입","마무리"]}},"text-key");time+=1000;expect((await provider.poll(submission.providerJobId!)).output).toMatchObject({type:"structured",data:[{label:"도입",description:"샘플 기획 · 도입"},{label:"마무리",description:"샘플 기획 · 마무리"}]});
  vi.stubEnv("FFMPEG_PATH",join(root,"missing-ffmpeg.exe"));const video=createMockProvider({...input,kind:"video"},2,1,now),request=await video.submit({capability:"video",model:"sample-video-v1",params:{}},"video-key");time+=1000;expect((await video.poll(request.providerJobId!)).output).toMatchObject({type:"media",files:[{mime:"image/png"}]});
 });
 it("승인 전 직접 요청과 오래된 내용 버전을 거부한다",()=>{
  handle.db.update(projects).set({approvedPlanId:null}).where(eq(projects.id,id)).run();expect(()=>enqueue()).toThrow(/승인/);expect(service().list().jobs).toHaveLength(0);
 });
 it("두 연결의 중복 제출·동시 집기를 트랜잭션으로 하나만 허용한다",()=>{
  const first=enqueue();const secondHandle=openDatabase(join(root,"data/app.db"));try{const other=jobsService(secondHandle,now);expect(other.enqueue({projectId:id,sceneId,revision:revision(),kind:"image"})).toMatchObject({jobId:first.jobId,duplicate:true});expect(service().claim()?.id).toBe(first.jobId);expect(other.claim()).toBeNull();}finally{secondHandle.close();}expect(service().list().jobs).toHaveLength(1);
 });
 it("스냅샷은 참조 해시·권리·승인 기획을 보존한다",()=>{
  const job=enqueue();const before=service().job(job.jobId)!.inputSnapshotJson;handle.db.update(assets).set({rightsNote:"변경된 메모"}).where(eq(assets.id,assetId)).run();expect(service().job(job.jobId)!.inputSnapshotJson).toBe(before);expect(JSON.parse(before).refs[0]).toMatchObject({sha256:"a".repeat(64),rightsNote:"직접 촬영"});
 });
 it("임대 만료 후 다른 연결이 이어받으면 이전 워커의 쓰기를 거부한다",()=>{
  const job=enqueue();const first=service().claim()!;time+=61000;const next=service().claim()!;expect(next.id).toBe(first.id);expect(next.attempts).toBe(first.attempts+1);expect(()=>service().heartbeat(job.jobId,first.attempts)).toThrow();expect(()=>service().providerStarted(job.jobId,first.attempts,"old")).toThrow();
 });
 it("재시작 후 저장된 제공자 번호를 재제출 없이 폴링한다",async()=>{
  const job=enqueue();const claim=service().claim()!;service().providerStarted(job.jobId,claim.attempts,`mock:${time}:${"a".repeat(64)}`);handle.close();handle=openDatabase(join(root,"data/app.db"));time+=61000;
  const submit=vi.fn();await runNextJob(handle,{now,sleep,provider:(input,version,attempt)=>({...createMockProvider(input,version,attempt,now),submit})});expect(submit).not.toHaveBeenCalled();expect(service().job(job.jobId)?.status).toBe("succeeded");expect(handle.db.select().from(scenes).get()?.selectedVersionId).toBeTruthy();
 });
 it("일시 오류만 지수 지연 후 재시도하고 거절은 자동·수동 재시도하지 않는다",async()=>{
  const job=enqueue("fail:PROVIDER_DOWN");await runNextJob(handle,{now,sleep});expect(service().job(job.jobId)).toMatchObject({status:"queued",attempts:1,errorCode:"PROVIDER_DOWN"});expect(service().claim()).toBeNull();time+=30000;await runNextJob(handle,{now,sleep});expect(service().job(job.jobId)).toMatchObject({status:"succeeded",attempts:2});
  const reject=enqueue("fail:CONTENT_REJECTED");await runNextJob(handle,{now,sleep});expect(service().job(reject.jobId)?.status).toBe("failed");expect(()=>service().retry(reject.jobId)).toThrow();
 });
 it("대기 취소는 실행하지 않고 실행 중 취소 후 늦은 결과는 선택하지 않는다",async()=>{
  const waiting=enqueue();service().cancel(waiting.jobId);expect(await runNextJob(handle,{now,sleep})).toBe(false);expect(service().job(waiting.jobId)?.status).toBe("canceled");
  const late=enqueue("cancel-late");await runNextJob(handle,{now,sleep:async(ms)=>{await sleep(ms);service().cancel(late.jobId);}});expect(service().job(late.jobId)).toMatchObject({status:"succeeded",cancelRequestedAt:expect.any(String)});expect(handle.db.select().from(sceneVersions).where(eq(sceneVersions.jobId,late.jobId)).get()?.resultAssetId).toBeTruthy();expect(handle.db.select().from(scenes).get()?.selectedVersionId).toBeNull();
 });
 it("정상 취소 지원은 취소됨으로 종료한다",async()=>{
  const job=enqueue("delay:10s");await runNextJob(handle,{now,sleep:async(ms)=>{await sleep(ms);service().cancel(job.jobId);}});expect(service().job(job.jobId)?.status).toBe("canceled");expect(handle.db.select().from(sceneVersions).get()?.resultAssetId).toBeNull();
 });
 it("저장 오류는 생성 성공으로 표시하지 않는다",async()=>{
  const job=enqueue();writeFileSync(join(root,"storage/projects"),"blocked fixture");await runNextJob(handle,{now,sleep});expect(service().job(job.jobId)).toMatchObject({status:"queued",errorCode:"STORAGE_FAILED"});expect(handle.db.select().from(scenes).get()?.selectedVersionId).toBeNull();expect(handle.db.select().from(assets).all()).toHaveLength(1);
 });
 it("첫 결과만 선택하고 같은 입력의 새 버전은 기존 선택을 바꾸지 않는다",async()=>{
  const first=enqueue();await runNextJob(handle,{now,sleep});const selected=handle.db.select().from(scenes).get()!.selectedVersionId;const current=revision();const second=enqueue();expect(second.jobId).not.toBe(first.jobId);await runNextJob(handle,{now,sleep});expect(handle.db.select().from(scenes).get()?.selectedVersionId).toBe(selected);expect(revision()).toBe(current);const outputs=handle.db.select().from(assets).all().filter(asset=>asset.origin==="generated");expect(outputs).toHaveLength(2);for(const asset of outputs){expect(asset.isMock).toBe(true);expect(asset.filePath).toMatch(new RegExp(`^projects/${id}/assets/`));expect(existsSync(join(root,"storage",asset.filePath!))).toBe(true);}
 });
 it("생성 제한 시간은 워커 재시작으로 초기화하지 않는다",async()=>{
  const job=enqueue();const claim=service().claim()!;service().providerStarted(job.jobId,claim.attempts,`mock:${time}:${"b".repeat(64)}`);time+=16*60000;await runNextJob(handle,{now,sleep});expect(service().job(job.jobId)?.errorCode).toBe("TIMEOUT");expect(handle.db.select().from(scenes).get()?.selectedVersionId).toBeNull();
 });
 it("동일 입력 샘플 이미지·무음은 결정적이며 비율과 제목·버전 표시를 담는다",async()=>{
  const job=enqueue(),input=generationInputSchema.parse(JSON.parse(service().job(job.jobId)!.inputSnapshotJson));const a=await mockImage(input,1,"same"),b=await mockImage(input,1,"same"),c=await mockImage(input,2,"same");expect(a.equals(b)).toBe(true);expect(a.equals(c)).toBe(false);const sharp=(await import("sharp")).default;expect(await sharp(a).metadata()).toMatchObject({width:1080,height:1920,format:"png"});const wav=mockSpeech(3);expect(wav.toString("ascii",0,4)).toBe("RIFF");expect(wav.length).toBe(44+16000*2*3);expect(handle.db.select().from(plans).get()?.status).toBe("approved");
 });
});
