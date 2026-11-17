// T-166 (F163-1): a sound source that changes after the ZIP is written (or resumed) but before the bundle is published
// fails the export (EXPORT_INVALID, not retryable); the ZIP holds the earlier bytes, the contract still refuses it.
// Every runtime is the fixed s9 backup restored into an OS temp folder and upgraded 9→10 there.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
// Test-only seams around the real ZIP functions: run a change right after the real write or the real verification.
const hook=vi.hoisted(()=>({afterWrite:null as null|((file:string)=>void),afterVerify:null as null|((file:string)=>void)}));
vi.mock("@/lib/export/zip",async(importOriginal)=>{const real=await importOriginal<typeof import("@/lib/export/zip")>();
  return {...real,
    writeZip:async(...args:Parameters<typeof real.writeZip>)=>{const result=await real.writeZip(...args);const after=hook.afterWrite;hook.afterWrite=null;after?.(args[0]);return result;},
    verifyZip:async(...args:Parameters<typeof real.verifyZip>)=>{const result=await real.verifyZip(...args);const after=hook.afterVerify;hook.afterVerify=null;after?.(args[0]);return result;}};});
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { manifestSchema } from "@/lib/export/schema";
import { verifyZip } from "@/lib/export/zip";
import { runNextJob } from "@/lib/jobs/runner";
import { editingService } from "@/lib/services/editing";
import { exportService } from "@/lib/services/exports";
import { reviewService } from "@/lib/services/review";
import { isRetryableCode } from "@/lib/ui/errors";
import { S9_RECORD, S9_ZIP } from "./fixtures/backups/s9-build";
import { readS9 } from "./fixtures/backups/s9-compare";

const ids=readS9(S9_RECORD).ids,P=ids.project;
let root:string,folder:string,handle:DatabaseHandle,time:number;
const now=()=>time,sleep=async(ms:number)=>{time+=ms;};
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const revision=()=>(handle.sqlite.prepare("SELECT content_revision AS r FROM projects WHERE id=?").get(P) as {r:number}).r;
const asset=(id:string)=>handle.sqlite.prepare("SELECT file_path AS path,sha256 FROM assets WHERE id=?").get(id) as {path:string;sha256:string};
const sourceFile=(id:string)=>join(folder,"storage",asset(id).path);
type ExportRow={id:string;status:string;file_path:string|null;manifest_version:number;manifest_json:string|null};
const exportRow=(id:string)=>handle.sqlite.prepare("SELECT id,status,file_path,manifest_version,manifest_json FROM exports WHERE id=?").get(id) as ExportRow;
const jobRow=(id:string)=>handle.sqlite.prepare("SELECT status,error_code AS code,error_message AS message FROM jobs WHERE id=?").get(id) as {status:string;code:string|null;message:string|null};
const finalZip=(id:string)=>join(folder,"storage/projects",P,"exports",`${id}.zip`);
const parts=()=>{const temp=join(folder,"storage/tmp");return existsSync(temp)?readdirSync(temp).filter(name=>name.endsWith(".part")):[];};
// Same size, one byte changed, modification time put back: nothing but the content tells the files apart.
// It never throws inside the seam (a throw there would become a write error); the test checks the recorded stats.
const flips:{size:[number,number];mtimeMs:[number,number]}[]=[];
function flipKeepingTime(file:string){const before=statSync(file),bytes=readFileSync(file);bytes[bytes.length-1]^=1;writeFileSync(file,bytes);utimesSync(file,before.atimeMs/1000,before.mtimeMs/1000);
  const after=statSync(file);flips.push({size:[before.size,after.size],mtimeMs:[before.mtimeMs,after.mtimeMs]});}
const expectSameStat=()=>{expect(flips).toHaveLength(1);expect(flips[0].size[1]).toBe(flips[0].size[0]);expect(Math.trunc(flips[0].mtimeMs[1])).toBe(Math.trunc(flips[0].mtimeMs[0]));/* same to the millisecond: utimes cannot set sub-ms exactly */};
beforeEach(async()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t166-")));folder=join(root,"rt");time=Date.parse("2026-11-17T10:00:00Z");
  // T-204: 제품 request는 new Date()로 nextRunAt을 적고 claim은 주입한 now로 비교한다. Date만 가짜로 두어 두 시계를 같은 축(고정 시각 1초 전)에 맞춘다. 타이머(setInterval 등)는 실제 그대로.
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(time-1000);
  hook.afterWrite=null;hook.afterVerify=null;flips.length=0;
  await verifyBackupArchive(S9_ZIP,await readBackupManifest(S9_ZIP),folder);mkdirSync(join(folder,"backups"),{recursive:true});
  const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");migrateDatabase(sqlite,{migrations:productMigrations()});}finally{sqlite.close();}
  vi.stubEnv("DREAM_DATA_ROOT",folder);handle=openDatabase(join(folder,"data/app.db"),{fileMustExist:true});
  handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status IN ('running','queued')").run();
  // this copy only: scene 2's plan-change check is marked done and the review passed
  handle.sqlite.prepare("UPDATE scenes SET needs_recheck=0 WHERE project_id=?").run(P);editingService(handle).complete(P,revision());
  const review=reviewService(handle);for(const item of review.get(P).items)review.update(P,revision(),{itemId:item.templateItemId,status:"pass",note:"가상 s9 사본 확인"});review.approve(P,revision());
});
afterEach(()=>{vi.useRealTimers();/* T-204: 시험이 실패해도 가장 먼저 실제 시계로 되돌린다 */handle?.close();vi.unstubAllEnvs();hook.afterWrite=null;hook.afterVerify=null;if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
async function runExport(){const request=exportService(handle).request(P,revision());await runNextJob(handle,{now,sleep});return request;}
function expectRefused(request:{id:string;jobId:string},pattern:RegExp){
  const job=jobRow(request.jobId);expect(job).toMatchObject({status:"failed",code:"EXPORT_INVALID"});expect(job.message).toMatch(pattern);expect(isRetryableCode(job.code)).toBe(false);
  expect(exportRow(request.id)).toMatchObject({status:"failed",file_path:null,manifest_json:null});expect(parts()).toEqual([]);
}

describe("ZIP 작성 뒤·확정 전 소리 원본 변경 (F163-1)",()=>{
  it("정상 경로는 그대로 manifest 2로 확정(확정 전 재측정이 통과)",async()=>{
    const request=await runExport(),row=exportRow(request.id);expect(jobRow(request.jobId).status).toBe("succeeded");expect(row.manifest_version).toBe(2);
    await verifyZip(finalZip(request.id),manifestSchema.parse(JSON.parse(row.manifest_json!)));
  },180000);
  it("writeZip이 끝난 직후 같은 크기·같은 수정 시각으로 1바이트 바뀌면: ZIP은 원래 바이트로 맞지만 확정하지 않고 EXPORT_INVALID",async()=>{
    const file=sourceFile(ids.voice),registered=asset(ids.voice).sha256;let inZip:string|null=null;
    hook.afterWrite=written=>{inZip=sha(readFileSync(written));flipKeepingTime(file);};
    const request=await runExport();expect(inZip).not.toBeNull();expect(sha(readFileSync(file))).not.toBe(registered);
    expectSameStat();expectRefused(request,/저장할 때와 달라요/);expect(existsSync(finalZip(request.id))).toBe(false);
  },180000);
  it("ZIP 검증까지 끝난 직후 원본이 없어져도 확정하지 않는다(찾을 수 없어요)",async()=>{
    const file=sourceFile(ids.music);hook.afterVerify=()=>renameSync(file,`${file}.away`);
    const request=await runExport();expectRefused(request,/을 찾을 수 없어요/);expect(existsSync(finalZip(request.id))).toBe(false);renameSync(`${file}.away`,file);
  },180000);
  it("남은 orphan ZIP을 이어받는 재시도도 현재 원본이 다르면 성공하지 않고, orphan 바이트는 그대로 둔다",async()=>{
    // attempt 1: the real ZIP is written, a copy is left at the final path, then a storage error (retryable)
    hook.afterWrite=written=>{const target=finalZip(exportService(handle).list(P).rows.find(row=>row.status==="running")!.id);mkdirSync(dirname(target),{recursive:true});copyFileSync(written,target);throw new Error("simulated storage stop");};
    const request=await runExport();expect(jobRow(request.jobId)).toMatchObject({status:"queued",code:"STORAGE_FAILED"});
    const orphan=finalZip(request.id),orphanSha=sha(readFileSync(orphan));
    // attempt 2 resumes the orphan: its verification passes, then the source changes (same size and time) before publishing
    let resumed="";hook.afterVerify=verified=>{resumed=verified;flipKeepingTime(sourceFile(ids.voice));};
    time+=30000;await runNextJob(handle,{now,sleep});
    expectSameStat();expect(resumed.endsWith(`${request.id}.zip`)).toBe(true);expectRefused(request,/저장할 때와 달라요/);expect(sha(readFileSync(orphan))).toBe(orphanSha);
  },180000);
  it("확정 전 다른 파일이 같은 이름에 생기면 덮어쓰지 않고(noreplace) 그 파일을 보존, 성공 행 없음",async()=>{
    const foreign=Buffer.from("foreign test file, not an export");
    hook.afterVerify=verified=>{if(verified.endsWith(".part")){const id=exportService(handle).list(P).rows.find(row=>row.status==="running")!.id;mkdirSync(dirname(finalZip(id)),{recursive:true});writeFileSync(finalZip(id),foreign);}};
    const request=await runExport();expect(jobRow(request.jobId).code).toBe("STORAGE_FAILED");expect(exportRow(request.id).status).toBe("failed");
    expect(readFileSync(finalZip(request.id))).toEqual(foreign);expect(parts()).toEqual([]);
    time+=30000;await runNextJob(handle,{now,sleep});expect(exportRow(request.id).status).toBe("failed");expect(readFileSync(finalZip(request.id))).toEqual(foreign);
  },180000);
  it("link 뒤 DB 확정이 실패하면 확정 파일을 지우고 다시 시도 대기, 고친 뒤 재시도는 성공하고 이전 성공 묶음은 그대로",async()=>{
    const first=await runExport();expect(jobRow(first.jobId).status).toBe("succeeded");const old=readFileSync(finalZip(first.id));
    handle.sqlite.exec("CREATE TRIGGER t166_fail BEFORE UPDATE OF status ON exports WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'t166 simulated'); END;");
    // the first bundle is final; a new request for the same revision makes a second export
    const second=await runExport();expect(jobRow(second.jobId)).toMatchObject({status:"queued",code:"STORAGE_FAILED"});expect(existsSync(finalZip(second.id))).toBe(false);expect(parts()).toEqual([]);
    handle.sqlite.exec("DROP TRIGGER t166_fail");time+=30000;await runNextJob(handle,{now,sleep});
    expect(jobRow(second.jobId).status).toBe("succeeded");expect(exportRow(second.id).manifest_version).toBe(2);expect(readFileSync(finalZip(first.id))).toEqual(old);
  },180000);
});
