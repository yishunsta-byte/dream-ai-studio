import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, verifyMigrations } from "@/lib/db/migrate";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import * as schema from "@/lib/db/schema";
let handle:DatabaseHandle;
beforeEach(()=>{handle=openDatabase(":memory:");migrateDatabase(handle.sqlite);});
afterEach(()=>handle.close());
function replace(table:string,column:string,id:string){handle.sqlite.prepare(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} WHERE ${column}=?`).run(id);}
describe("REPLACE immutable history",()=>{
 it("enables recursive triggers and permits normal inserts, mutable upserts and migration reruns",()=>{expect(handle.sqlite.pragma("recursive_triggers",{simple:true})).toBe(1);verifyMigrations(handle.sqlite);expect(migrateDatabase(handle.sqlite)).toBe(0);const repo=maintenanceRepository(handle);repo.insertSetting("normal",{v:1});repo.setSetting("normal",{v:2});expect(repo.setting("normal")?.valueJson).toBe('{"v":2}');handle.db.insert(schema.backups).values({id:"b",kind:"manual",path:"fixture",status:"running"}).run();repo.updateBackup("b",{status:"succeeded"});expect(repo.backup("b")?.status).toBe("succeeded");});
 it("blocks REPLACE, UPDATE and DELETE of audit, successful backups and metadata",()=>{handle.db.insert(schema.activityLog).values({id:"a",actor:"fixture",action:"original",detailJson:"{}"}).run();handle.db.insert(schema.backups).values({id:"b",kind:"manual",path:"fixture.zip",status:"succeeded"}).run();handle.db.insert(schema.settings).values({key:"backup.fixture.meta",valueJson:'{"v":1}'}).run();for(const [table,key,id] of [["activity_log","id","a"],["backups","id","b"],["settings","key","backup.fixture.meta"]]){expect(()=>replace(table,key,id)).toThrow(/immutable|append only/);expect(()=>handle.sqlite.prepare(`UPDATE ${table} SET ${key}=${key} WHERE ${key}=?`).run(id)).toThrow();expect(()=>handle.sqlite.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(id)).toThrow();}expect(handle.sqlite.prepare("SELECT action FROM activity_log").get()).toEqual({action:"original"});expect(maintenanceRepository(handle).backup("b")?.status).toBe("succeeded");});
 it("preserves edit snapshots while allowing current pointers to change",()=>{const repo=maintenanceRepository(handle);repo.insertSetting("project.p.edit.snapshot",{v:1});repo.insertSetting("project.p.edit.current","first");expect(()=>replace("settings","key","project.p.edit.snapshot")).toThrow("immutable");repo.setSetting("project.p.edit.current","second");expect(repo.setting("project.p.edit.current")?.valueJson).toBe('"second"');});
 it("protects completed scene versions, exports and approved plans from implicit DELETE",()=>{
  handle.db.insert(schema.projects).values({id:"p",menuId:"shopping-shorts",templateVersion:"fixture",templateSnapshotJson:"{}",inputsJson:"{}",title:"fixture",goal:"fixture",target:"fixture",aspect:"9:16",lengthSec:30}).run();
  handle.db.insert(schema.plans).values({id:"plan",projectId:"p",version:1,stepsJson:"[]",script:"fixture",status:"draft"}).run();
  handle.db.insert(schema.scenes).values({id:"s",projectId:"p",position:1,title:"fixture",description:"fixture",dialogueJson:"[]",characterIdsJson:"[]",durationSec:5}).run();
  handle.db.insert(schema.assets).values({id:"a",kind:"image",title:"fixture",role:"intermediate",origin:"generated",filePath:"fixture.png",mime:"image/png",sizeBytes:1,sha256:"a".repeat(64)}).run();
  handle.db.insert(schema.sceneVersions).values({id:"v",sceneId:"s",version:1,planId:"plan",kind:"image",inputSnapshotJson:"{}",status:"succeeded",resultAssetId:"a"}).run();
  // T-158: a finished row must agree with its manifest (0010); the REPLACE guard is what this test is about.
  handle.db.insert(schema.exports).values({id:"e",projectId:"p",contentRevision:1,status:"succeeded",filePath:"projects/p/exports/e.zip",sha256:"a".repeat(64),manifestJson:JSON.stringify({manifestVersion:1,project:{id:"p"},contentRevision:1,kind:"editing-bundle",files:[{}]}),completedAt:"2026-11-16"}).run();
  expect(()=>replace("scene_versions","id","v")).toThrow("immutable");expect(()=>replace("exports","id","e")).toThrow("immutable");
  handle.sqlite.prepare("UPDATE plans SET status='approved',approved_scene_snapshot_json='[]',approved_at='2026-11-16' WHERE id='plan'").run();expect(()=>replace("plans","id","plan")).toThrow("immutable");expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
 });
});
