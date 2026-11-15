import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { assets, plans, scenes, projects, activityLog } from "@/lib/db/schema";
import { parseMenuConfig } from "@/lib/menus/parse";
import { projectService } from "@/lib/services/projects";
import { planningInputSchema, planningService } from "@/lib/services/planning";
import { workflowService } from "@/lib/services/workflow";
const parsed=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));if(!parsed.ok)throw new Error("메뉴 오류");const config=parsed.config;
let handle:DatabaseHandle,root:string,id:string,assetId:string;
const input=()=>({script:"등록 사실만 담은 샘플 대본",scenes:config.menus[0].planSteps.map((step)=>({stepId:step.id,title:step.label,description:"가상 제품을 보여주는 샘플 장면",dialogue:"샘플 안내",durationSec:6,characterIds:[],assetIds:[assetId]}))});
beforeEach(()=>{
 handle=openDatabase(":memory:");migrateDatabase(handle.sqlite);root=mkdtempSync(join(tmpdir(),"dream-ai-planning-"));mkdirSync(join(root,"storage/library"),{recursive:true});assetId=v7();writeFileSync(join(root,`storage/library/${assetId}.png`),"fixture");
 handle.db.insert(assets).values({id:assetId,kind:"image",title:"샘플 사진",role:"original",origin:"upload",filePath:`library/${assetId}.png`,mime:"image/png",sizeBytes:7,sha256:"a".repeat(64),isMock:true}).run();vi.spyOn(process,"cwd").mockReturnValue(root);
 id=projectService(handle,config).create("shopping-shorts",{title:"기획 샘플",goal:"제품 소개",target:"샘플 대상",aspect:"9:16",lengthSec:30,productName:"가상 제품",productAssets:[assetId],facts:"샘플 장점",usageRights:"직접 촬영"});
});
afterEach(()=>{vi.restoreAllMocks();handle.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 오류");rmSync(root,{recursive:true,force:true});});
describe("요구 확인·기획 승인",()=>{
 it("편집 시간 범위를 넘는 전체 장면 길이를 저장하지 않는다",()=>{const source=input().scenes[0];expect(planningInputSchema.safeParse({script:"샘플",scenes:Array.from({length:13},()=>({...source,durationSec:600}))}).success).toBe(false);expect(planningInputSchema.safeParse({script:"샘플",scenes:Array.from({length:12},()=>({...source,durationSec:600}))}).success).toBe(true);});
 it("확인 전 저장과 확인란 없는 완료를 거부한다",()=>{
  const service=planningService(handle,config);expect(service.get(id).issues.length).toBeGreaterThan(0);expect(()=>service.confirmBrief(id,1,false)).toThrow();expect(()=>service.save(id,1,input())).toThrow();expect(handle.db.select().from(plans).all()).toHaveLength(0);
 });
 it("새 버전 저장·승인·수정·재승인과 원본 보존을 강제한다",()=>{
  const service=planningService(handle,config),workflow=workflowService(handle);service.confirmBrief(id,1,true);const first=service.save(id,1,input());expect(first).toMatchObject({version:1,revision:2});expect(()=>workflow.requireApprovedPlan(id,first.id)).toThrow();
  service.approve(id,first.id,2);const original=handle.db.select().from(plans).where(eq(plans.id,first.id)).get()!;expect(workflow.requireApprovedPlan(id,first.id).id).toBe(first.id);
  const oldRows=service.get(id).versions[0].scenes;const second=service.save(id,2,{...input(),script:"수정 대본",scenes:oldRows.slice(0,-1).map((row,index)=>({...row,description:index===0?"수정 장면":row.description}))});
  expect(second).toMatchObject({version:2,revision:3});expect(()=>workflow.requireApprovedPlan(id,first.id)).toThrow();expect(handle.db.select().from(plans).where(eq(plans.id,first.id)).get()).toEqual(original);
  const all=handle.db.select().from(scenes).all();expect(all).toHaveLength(oldRows.length);expect(all.filter((row)=>row.archivedAt)).toHaveLength(1);expect(all.every((row)=>row.needsRecheck)).toBe(true);
  service.approve(id,second.id,3);expect(workflow.requireApprovedPlan(id,second.id).status).toBe("approved");expect(service.get(id).versions).toHaveLength(2);
 });
 it("오래된 초안 승인과 동시에 도착한 저장을 거부한다",()=>{
  const service=planningService(handle,config);service.confirmBrief(id,1,true);const first=service.save(id,1,input());const second=service.save(id,2,input());
  expect(()=>service.approve(id,first.id,3)).toThrow(/최근/);expect(()=>service.save(id,2,input())).toThrow();expect(service.get(id).versions).toHaveLength(2);service.approve(id,second.id,3);
 });
 it("다른 프로젝트 장면·미연결 자료·캐릭터·중복 참조·누락 파일을 거부한다",()=>{
  const service=planningService(handle,config);service.confirmBrief(id,1,true);
  const base=input();for(const patch of [{sceneId:v7()},{assetIds:[v7()]},{characterIds:[v7()]},{assetIds:[assetId,assetId]},{stepId:"unknown"}])expect(()=>service.save(id,1,{...base,scenes:[{...base.scenes[0],...patch}]})).toThrow();
  rmSync(join(root,`storage/library/${assetId}.png`));expect(()=>service.save(id,1,base)).toThrow();expect(handle.db.select().from(scenes).all()).toHaveLength(0);
 });
 it("활동 기록 실패 시 장면·기획·내용 버전을 함께 되돌린다",()=>{
  const service=planningService(handle,config);service.confirmBrief(id,1,true);const before=handle.db.select().from(activityLog).all().length;
  handle.sqlite.exec("CREATE TRIGGER test_plan_log BEFORE INSERT ON activity_log BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");expect(()=>service.save(id,1,input())).toThrow();
  expect(handle.db.select().from(plans).all()).toHaveLength(0);expect(handle.db.select().from(scenes).all()).toHaveLength(0);expect(handle.db.select().from(projects).get()?.contentRevision).toBe(1);expect(handle.db.select().from(activityLog).all()).toHaveLength(before);
 });
});
