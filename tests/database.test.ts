import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, verifyMigrations } from "@/lib/db/migrate";
import { seedDatabase } from "@/lib/db/seed";
import { encodeJson, decodeJson } from "@/lib/db/json";
import * as schema from "@/lib/db/schema";
import { parseMenuConfig } from "@/lib/menus/parse";

const configResult=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));
if(!configResult.ok)throw new Error("기준 메뉴 파싱 실패");
const config=configResult.config;
const now=()=>new Date().toISOString();
let handle:DatabaseHandle;
const tempRoots:string[]=[];
beforeEach(()=>{handle=openDatabase(":memory:");migrateDatabase(handle.sqlite);});
afterEach(()=>{if(handle.sqlite.open)handle.close();for(const root of tempRoots.splice(0)){if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("잘못된 임시 경로");rmSync(root,{recursive:true,force:true});}});
function project(title="샘플 프로젝트") {
  const id=v7();
  handle.db.insert(schema.projects).values({id,menuId:"shopping-shorts",templateVersion:"test",templateSnapshotJson:"{}",inputsJson:"{}",title,goal:"샘플 목표",target:"샘플 보는 사람",aspect:"9:16",lengthSec:30}).run();
  return id;
}
function plan(projectId:string) {
  const id=v7();handle.db.insert(schema.plans).values({id,projectId,version:1,stepsJson:"[]",script:"샘플 대본",status:"draft"}).run();return id;
}
describe("P1 데이터베이스",()=>{
 it("17개 테이블(P2-1 timeline_revisions 포함)·Drizzle 칼럼 일치와 외래키 활성화를 확인한다",()=>{
   expect(Object.keys(schema)).toHaveLength(17);
   for(const table of Object.values(schema)) {
    const columns=handle.sqlite.pragma(`table_info('${getTableName(table)}')`) as {name:string}[];
    expect(columns.map(c=>c.name)).toEqual(getTableConfig(table).columns.map(c=>c.name));
   }
   expect(handle.sqlite.pragma("foreign_keys",{simple:true})).toBe(1);
   expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
   expect(migrateDatabase(handle.sqlite)).toBe(0);
 });
 it("잘못된 상태·규격·JSON과 중복 단계·깨진 참조를 거부한다",()=>{
   const id=project();
   expect(()=>handle.sqlite.prepare("UPDATE projects SET aspect='4:3' WHERE id=?").run(id)).toThrow();
   expect(()=>handle.sqlite.prepare("UPDATE projects SET inputs_json='broken' WHERE id=?").run(id)).toThrow();
   expect(()=>handle.db.insert(schema.stageStates).values({projectId:v7(),stage:"intake",status:"todo"}).run()).toThrow();
   handle.db.insert(schema.stageStates).values({projectId:id,stage:"intake",status:"todo"}).run();
   expect(()=>handle.db.insert(schema.stageStates).values({projectId:id,stage:"intake",status:"todo"}).run()).toThrow();
   expect(()=>handle.sqlite.prepare("UPDATE stage_states SET status='fake'").run()).toThrow();
 });
 it("승인된 기획 변경과 다른 프로젝트 기획 선택을 막는다",()=>{
   const first=project(),second=project(),planId=plan(first);
   handle.sqlite.prepare("UPDATE plans SET status='approved',approved_scene_snapshot_json='[]',approved_at=? WHERE id=?").run(now(),planId);
   handle.sqlite.prepare("UPDATE projects SET approved_plan_id=? WHERE id=?").run(planId,first);
   expect(()=>handle.sqlite.prepare("UPDATE projects SET approved_plan_id=? WHERE id=?").run(planId,second)).toThrow();
   expect(()=>handle.sqlite.prepare("UPDATE plans SET script='overwritten' WHERE id=?").run(planId)).toThrow();
 });
 it("파일과 링크를 구분하고 원본 경로·해시 덮어쓰기를 막는다",()=>{
   const id=v7();
   expect(()=>handle.db.insert(schema.assets).values({id,kind:"image",title:"샘플",role:"original",origin:"upload"}).run()).toThrow();
   handle.db.insert(schema.assets).values({id,kind:"image",title:"샘플",role:"original",origin:"upload",filePath:`library/${id}.png`,mime:"image/png",sizeBytes:10,sha256:"a".repeat(64)}).run();
   expect(()=>handle.sqlite.prepare("UPDATE assets SET file_path='../escape.png' WHERE id=?").run(id)).toThrow();
   expect(()=>handle.sqlite.prepare("UPDATE assets SET sha256=? WHERE id=?").run("b".repeat(64),id)).toThrow();
   handle.sqlite.prepare("UPDATE assets SET archived_at=? WHERE id=?").run(now(),id);
 });
 it("중복 작업과 부동소수 금액을 거부한다",()=>{
   const jobId=v7();
   const row={id:jobId,kind:"generate",inputSnapshotJson:"{}",status:"queued",refType:"scene",refId:v7(),provider:"mock",idempotencyKey:"same-input"};
   handle.db.insert(schema.jobs).values(row).run();
   expect(()=>handle.db.insert(schema.jobs).values({...row,id:v7()}).run()).toThrow();
   expect(()=>handle.db.insert(schema.generations).values({id:v7(),jobId,provider:"mock",model:"sample",paramsJson:"{}",referenceSnapshotJson:"[]",costEstimateMicros:1.5,currency:"USD",settlement:"reserved",startedAt:now()}).run()).toThrow();
 });
 it("장면 선택은 같은 장면의 성공 버전만 허용하고 기획 소유권을 검사한다",()=>{
   const projectId=project(),planId=plan(projectId),wrongPlan=plan(project());
   const sceneId=v7(),otherSceneId=v7(),assetId=v7(),versionId=v7();
   for(const id of [sceneId,otherSceneId])handle.db.insert(schema.scenes).values({id,projectId,position:1,title:"샘플 장면",description:"설명",dialogueJson:"[]",characterIdsJson:"[]",durationSec:5}).run();
   const version={id:versionId,sceneId,version:1,planId,inputSnapshotJson:"{}",kind:"image",status:"queued"};
   expect(()=>handle.db.insert(schema.sceneVersions).values({...version,planId:wrongPlan}).run()).toThrow();
   handle.db.insert(schema.sceneVersions).values(version).run();
   expect(()=>handle.sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(versionId,sceneId)).toThrow();
   handle.db.insert(schema.assets).values({id:assetId,kind:"image",title:"샘플",role:"intermediate",origin:"generated",filePath:`library/${assetId}.png`,mime:"image/png",sizeBytes:10,sha256:"a".repeat(64),isMock:true}).run();
   handle.sqlite.prepare("UPDATE scene_versions SET status='succeeded',result_asset_id=? WHERE id=?").run(assetId,versionId);
   handle.sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(versionId,sceneId);
   expect(()=>handle.sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(versionId,otherSceneId)).toThrow();
   expect(()=>handle.sqlite.prepare("UPDATE scene_versions SET result_asset_id=NULL WHERE id=?").run(versionId)).toThrow();
 });
 it("보류 검수에는 사유가 필요하고 완료 결과 없는 성공을 거부한다",()=>{
   const projectId=project();
   expect(()=>handle.db.insert(schema.reviewItems).values({projectId,contentRevision:1,templateItemId:"test",label:"검수",source:"custom",required:true,status:"hold"}).run()).toThrow();
   expect(()=>handle.db.insert(schema.exports).values({projectId,contentRevision:1,status:"succeeded"}).run()).toThrow();
 });
 it("시드는 빈 DB에만 추가하며 재실행과 기존 데이터에 손대지 않는다",()=>{
   expect(seedDatabase(handle,config).inserted).toBe(1);
   const first=handle.db.select().from(schema.projects).get()!;
   expect(first.id).toMatch(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
   expect(first.createdAt).toMatch(/Z$/);
   expect(first.templateSnapshotJson).not.toContain("D:/starwork");
   handle.sqlite.prepare("UPDATE projects SET title='사용자 수정' WHERE id=?").run(first.id);
   expect(seedDatabase(handle,config).inserted).toBe(0);
   expect(handle.db.select().from(schema.projects).get()?.title).toBe("사용자 수정");
 });
 it("프로젝트가 없어도 기존 설정이 있으면 시드를 건너뛴다",()=>{
   handle.db.insert(schema.settings).values({key:"test",valueJson:"{}"}).run();
   expect(seedDatabase(handle,config).inserted).toBe(0);
   expect(handle.db.select().from(schema.projects).all()).toEqual([]);
 });
 it("마이그레이션 기록 불일치 시 변경 없이 중단한다",()=>{
   const id=project();
   handle.sqlite.prepare("UPDATE __schema_migrations SET sha256='changed'").run();
   expect(()=>verifyMigrations(handle.sqlite)).toThrow();
   expect(()=>migrateDatabase(handle.sqlite)).toThrow();
   expect(handle.db.select().from(schema.projects).get()?.id).toBe(id);
 });
 it("중간 적용 실패는 전체 롤백하고 기존 테이블을 보존한다",()=>{
   const other=openDatabase(":memory:");
   try {
    other.sqlite.exec("CREATE TABLE projects (marker TEXT); INSERT INTO projects VALUES ('preserve')");
    expect(()=>migrateDatabase(other.sqlite)).toThrow();
    expect(other.sqlite.prepare("SELECT marker FROM projects").get()).toEqual({marker:"preserve"});
    expect(other.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='activity_log'").get()).toBeUndefined();
   } finally {other.close();}
 });
 it("파일 DB 재연결 후 데이터·WAL·스키마를 유지한다",()=>{
   handle.close();const root=mkdtempSync(join(tmpdir(),"dream-ai-database-"));tempRoots.push(root);
   const file=join(root,"app.db");handle=openDatabase(file);migrateDatabase(handle.sqlite);
   const id=project();expect(handle.sqlite.pragma("journal_mode",{simple:true})).toBe("wal");handle.close();
   handle=openDatabase(file,{fileMustExist:true});verifyMigrations(handle.sqlite);expect(handle.db.select().from(schema.projects).get()?.id).toBe(id);
 });
 it("JSON 저장·로드 경계에서 zod를 적용한다",()=>{
   const shape=z.object({version:z.number().int().positive()});
   expect(decodeJson(shape,encodeJson(shape,{version:1}))).toEqual({version:1});
   expect(()=>encodeJson(shape,{version:"wrong"})).toThrow();
   expect(()=>decodeJson(shape,'{"version":0}')).toThrow();
 });
});
