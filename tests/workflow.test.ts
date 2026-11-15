import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { seedDatabase } from "@/lib/db/seed";
import { activityLog, exports, plans, projects, reviewItems, scenes, stageStates } from "@/lib/db/schema";
import { workflowService } from "@/lib/services/workflow";
import { parseMenuConfig } from "@/lib/menus/parse";

let handle:DatabaseHandle;
let projectId:string,planId:string,sceneId:string;
const parsed=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));if(!parsed.ok)throw new Error("템플릿 오류");
beforeEach(()=>{
 handle=openDatabase(":memory:");migrateDatabase(handle.sqlite);seedDatabase(handle,parsed.config);
 projectId=handle.db.select().from(projects).get()!.id;planId=v7();sceneId=v7();
 handle.db.insert(plans).values({id:planId,projectId,version:1,stepsJson:'[{"label":"샘플 기획"}]',script:"샘플 대본",status:"draft"}).run();
 handle.db.insert(scenes).values({id:sceneId,projectId,position:1,title:"샘플 장면",description:"샘플 설명",dialogueJson:"[]",characterIdsJson:"[]",durationSec:5}).run();
});
afterEach(()=>handle.close());
function readyPlan(){const service=workflowService(handle);service.changeStage(projectId,"intake","complete",1);service.changeStage(projectId,"brief","complete",1);service.changeStage(projectId,"plan","start",1);service.changeStage(projectId,"plan","request_approval",1);return service;}
function readyReview(){const service=readyPlan();service.approvePlan(projectId,planId,1);handle.db.update(stageStates).set({status:"approved"}).where(eq(stageStates.stage,"produce")).run();handle.db.update(stageStates).set({status:"approved"}).where(eq(stageStates.stage,"edit")).run();handle.db.update(stageStates).set({status:"needs_approval"}).where(eq(stageStates.stage,"review")).run();return service;}
describe("서버 워크플로 게이트",()=>{
 it("화면을 우회한 승인 전 생성·내보내기 요청을 거부한다",()=>{
   const service=workflowService(handle);
   expect(()=>service.requireApprovedPlan(projectId,planId)).toThrow();expect(()=>service.requireApprovedReview(projectId)).toThrow();
   expect(()=>service.changeStage(projectId,"produce","start",1)).toThrow();expect(handle.db.select().from(activityLog).all()).toHaveLength(0);
 });
 it("기획 승인과 장면표 스냅샷·포인터·활동 기록이 함께 저장된다",()=>{
   const service=readyPlan();service.approvePlan(projectId,planId,1);
   const approved=service.requireApprovedPlan(projectId,planId);
   expect(approved.status).toBe("approved");expect(JSON.parse(approved.approvedSceneSnapshotJson!)[0].id).toBe(sceneId);
   expect(handle.db.select().from(projects).get()?.approvedPlanId).toBe(planId);
   expect(handle.db.select().from(activityLog).all().at(-1)?.action).toBe("plan.approve");
 });
 it("일반 단계 완료·승인 경로로 기획 게이트를 건너뛰지 못한다",()=>{
   const service=readyPlan();expect(()=>service.changeStage(projectId,"plan","complete",1)).toThrow();expect(()=>service.changeStage(projectId,"plan","approve",1)).toThrow();
   expect(handle.db.select().from(plans).get()?.status).toBe("draft");
 });
 it("승인 후 기획 변경은 원본 보존·새 내용 버전·재승인 필요 상태로 바꾼다",()=>{
   const service=readyPlan();service.approvePlan(projectId,planId,1);
   const snapshot=handle.db.select().from(plans).get()?.approvedSceneSnapshotJson;
   const draft=service.createPlanDraft(projectId,1,{steps:[{id:"hook",label:"수정"}],script:"수정 대본"});
   expect(draft).toMatchObject({version:2,revision:2});
   expect(()=>service.requireApprovedPlan(projectId,planId)).toThrow();
   expect(handle.db.select().from(plans).where(eq(plans.id,planId)).get()?.approvedSceneSnapshotJson).toBe(snapshot);
   expect(handle.db.select().from(scenes).get()?.needsRecheck).toBe(true);
 });
 it("검수 항목이 일부만 저장되어 있어도 승인하지 않는다",()=>{
   const service=readyReview();
   handle.db.insert(reviewItems).values({projectId,contentRevision:1,templateItemId:"custom",label:"일부 검수",source:"custom",required:true,status:"pass"}).run();
   expect(()=>service.approveReview(projectId,1)).toThrow();
 });
 it("필수 미통과는 검수 승인을 거부하고 내용 변경은 내보내기 자격만 무효화한다",()=>{
   const service=readyReview();const itemId=v7();
   const required=[...parsed.config.commonReview,...parsed.config.menus[0].review];
   handle.db.insert(reviewItems).values(required.map((item,index)=>({id:index===0?itemId:v7(),projectId,contentRevision:1,templateItemId:item.id,label:item.label,source:index<parsed.config.commonReview.length?"common":"menu",required:item.required,status:index===0?"unchecked":"pass"}))).run();
   expect(()=>service.approveReview(projectId,1)).toThrow();
   handle.db.update(reviewItems).set({status:"pass"}).where(eq(reviewItems.id,itemId)).run();service.approveReview(projectId,1);expect(service.requireApprovedReview(projectId).contentRevision).toBe(1);
   const exportId=v7();handle.db.insert(exports).values({id:exportId,projectId,contentRevision:1,status:"succeeded",filePath:`projects/${projectId}/exports/${exportId}.zip`,manifestJson:'{"version":1}',sha256:"a".repeat(64),completedAt:new Date().toISOString()}).run();
   service.changeContent(projectId,1,"edit","text.change",()=>{handle.db.update(scenes).set({dialogueJson:'[{"text":"수정"}]'}).where(eq(scenes.id,sceneId)).run();});
   expect(()=>service.requireApprovedReview(projectId)).toThrow();expect(handle.db.select().from(exports).get()?.sha256).toBe("a".repeat(64));
 });
 it("같은 내용 버전을 가진 두 변경 중 두 번째는 쓰기 전에 거부한다",()=>{
   const service=readyReview();service.changeContent(projectId,1,"edit","text.change",()=>{handle.db.update(scenes).set({title:"첫 변경"}).where(eq(scenes.id,sceneId)).run();});
   const second=vi.fn();expect(()=>service.changeContent(projectId,1,"edit","text.change",second)).toThrow();expect(second).not.toHaveBeenCalled();
   expect(handle.db.select().from(scenes).get()?.title).toBe("첫 변경");
 });
 it("변경 중 실패하면 내용·revision·활동 기록을 함께 롤백한다",()=>{
   const service=readyReview();const count=handle.db.select().from(activityLog).all().length;
   expect(()=>service.changeContent(projectId,1,"edit","text.change",()=>{handle.db.update(scenes).set({title:"롤백"}).where(eq(scenes.id,sceneId)).run();throw new Error("실패");})).toThrow();
   expect(handle.db.select().from(scenes).get()?.title).toBe("샘플 장면");expect(handle.db.select().from(projects).get()?.contentRevision).toBe(1);expect(handle.db.select().from(activityLog).all()).toHaveLength(count);
 });
 it("실제 선택 결과 없는 장면 제작 완료와 파일 없는 내보내기 완료를 거부한다",()=>{
   const service=readyPlan();service.approvePlan(projectId,planId,1);expect(()=>service.changeStage(projectId,"produce","complete",1)).toThrow();
   expect(()=>service.changeStage(projectId,"export","complete",1)).toThrow();
 });
});
