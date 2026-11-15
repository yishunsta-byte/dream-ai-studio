import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { assets, activityLog, projects, projectAssets, stageStates } from "@/lib/db/schema";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { validateProjectInputs } from "@/lib/menus/inputs";
import { projectService, ProjectInputError } from "@/lib/services/projects";

const parsed=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));if(!parsed.ok)throw new Error("템플릿 오류");
const config=parsed.config;
let handle:DatabaseHandle,assetId:string,root:string;
const values=()=>({title:"샘플 프로젝트",goal:"제품을 소개해요",target:"샘플 보는 사람",aspect:"9:16",lengthSec:30,productName:"샘플 텀블러",productAssets:[assetId],facts:"검증용 샘플 장점",usageRights:"직접 촬영"});
beforeEach(()=>{
 handle=openDatabase(":memory:");migrateDatabase(handle.sqlite);assetId=v7();
 root=mkdtempSync(join(tmpdir(),"dream-ai-projects-"));mkdirSync(join(root,"storage/library"),{recursive:true});writeFileSync(join(root,`storage/library/${assetId}.png`),"test-fixture");
 handle.db.insert(assets).values({id:assetId,kind:"image",title:"샘플 자료",role:"original",origin:"upload",filePath:`library/${assetId}.png`,mime:"image/png",sizeBytes:12,sha256:"a".repeat(64),isMock:true}).run();
 vi.spyOn(process,"cwd").mockReturnValue(root);
});
afterEach(()=>{vi.restoreAllMocks();handle.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 오류");rmSync(root,{recursive:true,force:true});});
describe("프로젝트 등록",()=>{
 it("필수 누락·잘못된 규격·조건부 체크 형식·중복 자료를 항목별로 거부한다",()=>{
   const snapshot=snapshotForMenu(config,config.menus[0]);
   const result=validateProjectInputs(snapshot,{...values(),title:" ",aspect:"4:3",lengthSec:10000,isAd:"false",productAssets:[assetId,assetId]});
   expect(result.ok).toBe(false);if(result.ok)return;
   expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(["title","aspect","lengthSec","isAd","productAssets"]));
 });
 it("주소의 실행 스킴·계정정보와 허용되지 않은 입력을 거부한다",()=>{
   const snapshot=snapshotForMenu(config,config.menus[0]);
   for(const productLink of ["javascript:alert(1)","https://user:password@example.com"])expect(validateProjectInputs(snapshot,{...values(),productLink}).ok).toBe(false);
   expect(validateProjectInputs(snapshot,{...values(),apiKey:"never-store"}).ok).toBe(false);
 });
 it("등록·단계·자료 참조·활동 기록을 함께 저장한다",()=>{
   const service=projectService(handle,config);const id=service.create("shopping-shorts",values());
   const data=service.get(id);
   expect(data.project.title).toBe("샘플 프로젝트");expect(data.inputs.productAssets).toEqual([assetId]);
   expect(data.states.find((state)=>state.stage==="intake")?.status).toBe("approved");expect(data.states.find((state)=>state.stage==="brief")?.status).toBe("todo");
   expect(handle.db.select().from(projectAssets).all()).toHaveLength(1);expect(handle.db.select().from(activityLog).all()).toHaveLength(1);
   expect(service.list()[0].nextStage).toBe("brief");
 });
 it("설정이 바뀌어도 기존 템플릿 스냅샷은 보존한다",()=>{
   const mutable=structuredClone(config);const service=projectService(handle,mutable);const id=service.create("shopping-shorts",values());
   const old=service.get(id).project.templateSnapshotJson;mutable.templateVersion="changed";mutable.menus[0].label="새 이름";
   expect(service.get(id).project.templateSnapshotJson).toBe(old);expect(service.get(id).snapshot.menu.label).toBe(config.menus[0].label);
   expect(old).not.toContain("D:/starwork");
 });
 it("준비 분야·보관 자료·없는 파일·잘못된 자료 종류는 등록하지 않는다",()=>{
   const service=projectService(handle,config);expect(()=>service.create("travel-shorts",values())).toThrow();
   handle.db.update(assets).set({archivedAt:new Date().toISOString()}).where(eq(assets.id,assetId)).run();
   expect(()=>service.create("shopping-shorts",values())).toThrow(ProjectInputError);
   handle.db.update(assets).set({archivedAt:null}).where(eq(assets.id,assetId)).run();
   rmSync(join(root,`storage/library/${assetId}.png`));
   expect(()=>service.create("shopping-shorts",values())).toThrow(ProjectInputError);
   const linkId=v7();handle.db.insert(assets).values({id:linkId,kind:"link",title:"참조 링크",role:"original",origin:"link",sourceUrl:"https://example.com"}).run();
   expect(()=>service.create("shopping-shorts",{...values(),productAssets:[linkId]})).toThrow(ProjectInputError);
   expect(handle.db.select().from(projects).all()).toHaveLength(0);
 });
 it("기록 저장 실패는 프로젝트·단계·연결 전체를 롤백한다",()=>{
   handle.sqlite.exec("CREATE TRIGGER test_log_failure BEFORE INSERT ON activity_log BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
   expect(()=>projectService(handle,config).create("shopping-shorts",values())).toThrow();
   expect(handle.db.select().from(projects).all()).toHaveLength(0);expect(handle.db.select().from(stageStates).all()).toHaveLength(0);expect(handle.db.select().from(projectAssets).all()).toHaveLength(0);
 });
});
