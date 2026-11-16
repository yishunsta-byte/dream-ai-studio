// T-111 (F110-1): the real migrate command keeps the typed cause when 0007's data check refuses a row written under
// 0006. The public code (MIGRATION_FAILED), the shared sentences and the record format stay as they were; one extra
// stderr line names the render UUID and the fixed reason. Nothing stored (input JSON, file path, hash) or any stack is
// printed. Runs on copies of the fixed s6 backup in a new OS temp folder.
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { runMigrateCommand } from "@/lib/db/migrate-command";
import { migrationEntry, productMigrations } from "@/lib/db/migrate";
import { RenderRowError, renderRowReasons } from "@/lib/db/render-data";
import { migrationFailureCopy } from "@/lib/db/migration-copy";
import type { MigrationRecord } from "@/lib/db/migration-record";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { S6_ZIP, s6Ids } from "./fixtures/backups/s6-build";

let root:string;
const now=()=>Date.parse("2026-11-17T01:00:00Z");
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-t111-")));});
afterEach(async()=>{if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});
async function runtime(change?:(sqlite:Database.Database)=>void){
  const folder=join(root,"rt");await verifyBackupArchive(S6_ZIP,await readBackupManifest(S6_ZIP),folder);
  if(change){const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");change(sqlite);sqlite.pragma("journal_mode = DELETE");}finally{sqlite.close();}}
  return folder;
}
const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
function run(folder:string,migrations=productMigrations()){
  const out:string[]=[],err:string[]=[],records:MigrationRecord[]=[];
  const exit=runMigrateCommand({root:folder,migrations,now,log:line=>out.push(line),error:line=>err.push(line),writeRecord:(_root,record)=>records.push(record)});
  return {exit,out,err,record:records[0]};
}
function state(folder:string){const sqlite=new Database(join(folder,"data/app.db"),{readonly:true});try{return {journal:(sqlite.prepare("SELECT version FROM __schema_migrations ORDER BY version").all() as {version:number}[]).map(row=>row.version),guards:(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('render_job_identity_guard','render_file_tuple_insert_guard','render_file_tuple_update_guard')").get() as {n:number}).n};}finally{sqlite.close();}}
const ids=s6Ids();
// What must never reach the output: stored text of the row (path, hashes, input JSON) or a stack.
function noLeak(lines:string[],sqlite:{filePath:string|null;input:string}){const text=lines.join("\n");expect(text).not.toMatch(/\n\s+at |Error:|\.ts:\d+|\{"/);if(sqlite.filePath)expect(text).not.toContain(sqlite.filePath);expect(text).not.toContain(sqlite.input);expect(text).not.toMatch(/[0-9a-f]{64}/);}
const copy=migrationFailureCopy("MIGRATION_FAILED",null,true);

describe("실제 migrate 명령: 0007 행 확인 실패의 원인이 남는다",()=>{
  it("성공인데 sha256 NULL(0006에서 저장됨) → exit 1, 공용 문구 + 원인 진단(렌더 UUID·file fields), DB 바이트·기록 6·새 트리거 0·복사본 유지",async()=>{
    let input="",filePath:string|null=null;
    const folder=await runtime(sqlite=>{sqlite.prepare("UPDATE renders SET status='succeeded',finished_at='2026-11-16T00:00:00Z',file_path='projects/'||project_id||'/renders/'||id||'.mp4',sha256=NULL,size_bytes=1,verify_json='{}' WHERE id=?").run(ids.running);
      ({input_json:input,file_path:filePath}=sqlite.prepare("SELECT input_json,file_path FROM renders WHERE id=?").get(ids.running) as {input_json:string;file_path:string});});
    const db=join(folder,"data/app.db"),before=sha(db);const result=run(folder);
    expect(result.exit).toBe(1);expect(result.out).toEqual([]);
    expect(result.err[0]).toBe(copy.headline);expect(result.err[1]).toBe(copy.next);
    expect(result.err[2]).toBe(`원인 진단: 렌더 기록 ${ids.running} — file fields are incomplete`);
    expect(result.err[3]).toMatch(/^바꾸기 전 복사본: backups\/pre-migrate\/\d{8}T\d{6}Z_s6-s7\.db \(자동으로 지우지 않아요\)$/);expect(result.err).toHaveLength(4);
    noLeak(result.err,{filePath,input});
    expect(sha(db)).toBe(before);expect(state(folder)).toEqual({journal:[1,2,3,4,5,6],guards:0});
    expect(readdirSync(join(folder,"backups/pre-migrate"))).toHaveLength(1);
    // Public record unchanged in form: fixed code, no reason, snapshot kept.
    expect(result.record).toMatchObject({result:"failed",code:"MIGRATION_FAILED",reason:null,from:6,to:7});expect(JSON.stringify(result.record)).not.toContain(ids.running);
  });
  it("렌더 작업 kind가 0006에서 바뀐 행 → 원인 진단 job differs",async()=>{
    let input="";const folder=await runtime(sqlite=>{sqlite.prepare("UPDATE jobs SET kind='export' WHERE id=?").run(ids.jobPassed);input=(sqlite.prepare("SELECT input_json FROM renders WHERE id=?").get(ids.passed) as {input_json:string}).input_json;});
    const result=run(folder);expect(result.exit).toBe(1);expect(result.err[2]).toBe(`원인 진단: 렌더 기록 ${ids.passed} — job differs`);noLeak(result.err,{filePath:null,input});
    expect(state(folder)).toEqual({journal:[1,2,3,4,5,6],guards:0});
  });
  it("회귀: 정상 s6 → 1개 적용·원인 진단 없음, 다시 실행 0개",async()=>{
    const folder=await runtime();const first=run(folder);expect(first.exit).toBe(0);expect(first.err).toEqual([]);expect(first.out[0]).toBe("데이터베이스 준비 완료: 새 마이그레이션 1개");
    expect(state(folder)).toEqual({journal:[1,2,3,4,5,6,7],guards:3});
    const second=run(folder);expect(second.exit).toBe(0);expect(second.out).toEqual(["데이터베이스 준비 완료: 새 마이그레이션 0개"]);expect(second.err).toEqual([]);
  });
  it("회귀: 행 확인이 아닌 실패(알 수 없는 SQL 오류)는 원인 진단 줄 없이 공용 문구만, 스택 없음",async()=>{
    const folder=await runtime(),broken=[...productMigrations(),migrationEntry(8,"0008_broken.sql","SELECT * FROM no_such_table;")];
    const result=run(folder,broken);expect(result.exit).toBe(1);expect(result.err.some(line=>line.startsWith("원인 진단"))).toBe(false);
    expect(result.err.slice(0,2)).toEqual([copy.headline,copy.next]);expect(result.err.join("\n")).not.toMatch(/no_such_table|\n\s+at /);expect(state(folder).journal).toEqual([1,2,3,4,5,6]);
  });
});

describe("RenderRowError 형태",()=>{
  it("이유는 정해진 목록, id는 UUID일 때만 남는다",()=>{
    const ok=new RenderRowError("render",ids.passed,"job differs");expect(ok).toMatchObject({subject:"render",subjectId:ids.passed,reason:"job differs"});expect(ok.message).toBe(`Render row ${ids.passed}: job differs`);
    const odd=new RenderRowError("render","../../x/<path>","file fields are incomplete");expect(odd.subjectId).toBeNull();expect(odd.message).not.toContain("<path>");
    expect(new Set(renderRowReasons).size).toBe(renderRowReasons.length);for(const reason of renderRowReasons)expect(reason).toMatch(/^[A-Za-z0-9 ]+$/);
  });
});
