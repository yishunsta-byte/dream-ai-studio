// T-162 P2-6 S3: the editing bundle carries the sound sources of a saved v2 timeline (manifest 2). Every runtime is a
// copy of the fixed s9 backup (stage 9, synthetic sounds) restored into an OS temp folder and upgraded 9→10 there;
// s9.zip itself is only read.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { openPromise } from "yauzl";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
// Lets one case change a source while the ZIP is written (or right after); off by default.
const hook=vi.hoisted(()=>({during:null as null|(()=>void),after:null as null|(()=>void)}));
vi.mock("@/lib/export/zip",async(importOriginal)=>{const real=await importOriginal<typeof import("@/lib/export/zip")>();
  return {...real,writeZip:async(...args:Parameters<typeof real.writeZip>)=>{const during=hook.during;hook.during=null;during?.();const result=await real.writeZip(...args);const after=hook.after;hook.after=null;after?.();return result;}};});
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { journal, migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkExportRows } from "@/lib/db/export-data";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { manifestSchema, type BundleManifest, type BundleManifestV2 } from "@/lib/export/schema";
import { fileDigest, verifyZip } from "@/lib/export/zip";
import { timelineSchema } from "@/lib/edit/timeline";
import { runNextJob } from "@/lib/jobs/runner";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { editingService } from "@/lib/services/editing";
import { exportDownload, exportService, ExportSourceError } from "@/lib/services/exports";
import { jobsService } from "@/lib/services/jobs";
import { restoreService } from "@/lib/services/restore";
import { reviewService } from "@/lib/services/review";
import { timelineService } from "@/lib/services/timeline";
import { isRetryableCode } from "@/lib/ui/errors";
import { S9_RECORD, S9_ZIP } from "./fixtures/backups/s9-build";
import { readS9 } from "./fixtures/backups/s9-compare";

const record=readS9(S9_RECORD),ids=record.ids,P=ids.project;
let root:string,folder:string,handle:DatabaseHandle,time:number;
const now=()=>time,sleep=async(ms:number)=>{time+=ms;};
// T-165: manifest 2 and its sound source entries are narrowed by checks, not by casts.
type ManifestFile=BundleManifestV2["files"][number];type AudioFile=Extract<ManifestFile,{audio:unknown}>;
const isAudioFile=(entry:ManifestFile):entry is AudioFile=>"audio" in entry&&entry.audio!==undefined;
function manifest2(value:BundleManifest):BundleManifestV2{expect(value.manifestVersion).toBe(2);if(value.manifestVersion!==2)throw new Error("manifest 2 expected");return value;}
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const revision=()=>(handle.sqlite.prepare("SELECT content_revision AS r FROM projects WHERE id=?").get(P) as {r:number}).r;
const asset=(id:string)=>handle.sqlite.prepare("SELECT * FROM assets WHERE id=?").get(id) as {id:string;title:string;file_path:string;sha256:string;size_bytes:number;duration_ms:number;is_mock:number;archived_at:string|null};
const sourceFile=(id:string)=>join(folder,"storage",asset(id).file_path);
type ExportRow={id:string;status:string;file_path:string|null;manifest_version:number;manifest_json:string|null;sha256:string|null;error:string|null};
const exportRow=(id:string)=>handle.sqlite.prepare("SELECT * FROM exports WHERE id=?").get(id) as ExportRow;
const jobRow=(id:string)=>handle.sqlite.prepare("SELECT status,error_code AS code,error_message AS message FROM jobs WHERE id=?").get(id) as {status:string;code:string|null;message:string|null};
beforeEach(async()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t162-")));folder=join(root,"rt");time=Date.parse("2026-11-17T10:00:00Z");
  // T-204: 제품 request는 new Date()로 nextRunAt을 적고 claim은 주입한 now로 비교한다. Date만 가짜로 두어 두 시계를 같은 축(고정 시각 1초 전)에 맞춘다. 타이머(setInterval 등)는 실제 그대로.
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(time-1000);
  hook.during=null;hook.after=null;
  await verifyBackupArchive(S9_ZIP,await readBackupManifest(S9_ZIP),folder);mkdirSync(join(folder,"backups"),{recursive:true});
  const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys = ON");expect(journal(sqlite)!.map(row=>row.version)).toEqual([1,2,3,4,5,6,7,8,9]);migrateDatabase(sqlite,{migrations:productMigrations()});}finally{sqlite.close();}
  vi.stubEnv("DREAM_DATA_ROOT",folder);handle=openDatabase(join(folder,"data/app.db"),{fileMustExist:true});
  // the s9 backup was taken while its own backup job ran; nothing else may be claimed before the export
  handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status IN ('running','queued')").run();
});
afterEach(()=>{vi.useRealTimers();/* T-204: 시험이 실패해도 가장 먼저 실제 시계로 되돌린다 */handle?.close();vi.unstubAllEnvs();hook.during=null;hook.after=null;if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
// s9 leaves scene 2 waiting for its plan-change check (needs_recheck); this copy marks it checked before approving.
function approve(){handle.sqlite.prepare("UPDATE scenes SET needs_recheck=0 WHERE project_id=?").run(P);const editing=editingService(handle);editing.complete(P,revision());const review=reviewService(handle);for(const item of review.get(P).items)review.update(P,revision(),{itemId:item.templateItemId,status:"pass",note:"가상 s9 사본 확인"});review.approve(P,revision());}
async function runExport(){const request=exportService(handle).request(P,revision());await runNextJob(handle,{now,sleep});return request;}
async function zipFiles(file:string){const zip=await openPromise(file,{lazyEntries:true,autoClose:false}),files=new Map<string,Buffer>();
  try{for await(const entry of zip.eachEntry()){const chunks:Buffer[]=[];for await(const chunk of await zip.openReadStreamPromise(entry))chunks.push(chunk as Buffer);files.set(entry.fileName,Buffer.concat(chunks));}}finally{zip.close();}return files;}
function currentTimeline(){return handle.sqlite.prepare("SELECT t.id,t.timeline_json AS json FROM timeline_revisions t JOIN projects p ON p.current_timeline_rev_id=t.id WHERE p.id=?").get(P) as {id:string;json:string};}
function saveTimeline(change:(value:Record<string,unknown>&{audio:Record<string,unknown>[]})=>Record<string,unknown>){
  const service=timelineService(handle),state=service.state(P),value=JSON.parse(currentTimeline().json);
  return service.save(P,state.project.contentRevision,state.current!.id,change(value) as never);
}

describe("s9 사본 9→10 → 실제 소리 원본 편집 묶음",()=>{
  it("v2 소리 묶음: 원본 바이트·해시 그대로 1회씩, timeline 원형·목록·README·권리, manifest 2·샘플 정합, 미리보기 DTO·예상 크기",async()=>{
    expect(await fileDigest(S9_ZIP)).toEqual(record.zip);approve();
    const preview=exportService(handle).preview(P);if(!preview.ready)throw new Error("preview");
    expect(preview.manifestVersion).toBe(2);expect(preview.audioBlocked).toBe(false);expect(preview.audio.map(item=>item.assetId)).toEqual([ids.music,ids.voice].sort());
    expect(JSON.stringify(preview.audio)).not.toContain(asset(ids.voice).file_path);expect(JSON.stringify(preview.audio)).not.toMatch(/storage|[A-Z]:[\\/]/);
    const request=await runExport(),row=exportRow(request.id);expect(jobRow(request.jobId).status).toBe("succeeded");expect(row).toMatchObject({status:"succeeded",manifest_version:2});
    const manifest=manifest2(manifestSchema.parse(JSON.parse(row.manifest_json!))),file=join(folder,"storage",row.file_path!);
    expect(await verifyZip(file,manifest)).toBeTruthy();expect(()=>checkExportRows(handle.sqlite)).not.toThrow();
    const files=await zipFiles(file),timeline=currentTimeline(),parsed=timelineSchema.parse(JSON.parse(timeline.json));if(parsed.schemaVersion!==2)throw new Error("v2 expected");
    // every file of the manifest is in the ZIP with its exact hash
    for(const entry of manifest.files)expect(sha(files.get(entry.path)!),entry.path).toBe(entry.sha256);
    expect([...files.keys()].sort()).toEqual([...manifest.files.map(entry=>entry.path),"manifest.json"].sort());
    // sources: each asset once, bytes equal the stored file and the s9 record
    const audio=manifest.files.filter(isAudioFile);expect(audio).toHaveLength(2);
    for(const [index,assetId] of [ids.music,ids.voice].sort().entries()){const a=asset(assetId),entry=audio[index];
      expect(entry.path).toBe(`audio/0${index+1}_${assetId}${a.is_mock?"_SAMPLE":""}.wav`);expect(entry.audio).toEqual({assetId,roles:[parsed.audio.find(clip=>clip.assetId===assetId)!.role],isMock:!!a.is_mock});
      expect(sha(files.get(entry.path)!)).toBe(a.sha256);expect(sha(readFileSync(sourceFile(assetId)))).toBe(a.sha256);}
    expect(manifest.timeline).toEqual({revisionId:timeline.id,schemaVersion:2,audioMixProfile:"p2-5-local-v1"});
    expect(manifest.isMock).toBe(true);expect(audio.some(entry=>entry.audio.isMock)?manifest.isMock:true).toBe(true);
    expect(files.get("edit/timeline.json")!.toString("utf8")).toBe(timeline.json);
    const list=JSON.parse(files.get("edit/audio_sources.json")!.toString("utf8"));
    expect(list).toMatchObject({schemaVersion:1,timelineRevisionId:timeline.id,timelineFile:"edit/timeline.json",fps:30,audioMixProfile:"p2-5-local-v1",joins:parsed.audioJoins});
    for(const source of list.sources){const a=asset(source.assetId),clips=parsed.audio.filter(clip=>clip.assetId===source.assetId);
      expect(source).toMatchObject({sha256:a.sha256,sizeBytes:a.size_bytes,durationMs:a.duration_ms,isMock:!!a.is_mock,archived:false,clipIds:clips.map(clip=>clip.id),rights:parsed.audioRights.find(item=>item.assetId===source.assetId)});
      expect(source.clips).toEqual(clips.map(clip=>({id:clip.id,role:clip.role,startFrame:clip.startFrame,sourceInFrame:clip.sourceInFrame,durationFrames:clip.durationFrames})));}
    const readme=files.get("README.txt")!.toString("utf8"),rights=files.get("provenance/rights.md")!.toString("utf8");
    for(const words of ["audio/ 폴더","edit/audio_sources.json","합친 소리(믹스)와 완성 영상(MP4)은 들어 있지 않아요","다시 불러오는 기능이 없어요","백업·복원","p2-5-local-v1","사용권이 확인된 것은 아니에요","샘플 포함"])expect(readme).toContain(words);
    expect(rights).toContain("## 소리 원본 권리");expect(rights).toContain(asset(ids.voice).title);
    // estimate within ±10%, list and download name agree with the manifest sample flag
    const size=(await fileDigest(file)).sizeBytes;expect(Math.abs(preview.estimatedBytes-size)/size).toBeLessThan(0.1);expect(preview.backupGrowthBytes).toBe(preview.estimatedBytes);
    const listed=exportService(handle).list(P).rows.find(item=>item.id===request.id)!;expect(listed).toMatchObject({isMock:true,fileName:`editing-${request.id}_SAMPLE.zip`,fileCount:manifest.files.length,available:true});
    expect((await exportDownload(request.id)).title).toBe(`editing-${request.id}_SAMPLE.zip`);
    // the stored source files were not touched
    for(const assetId of [ids.voice,ids.music])expect(sha(readFileSync(sourceFile(assetId)))).toBe(asset(assetId).sha256);
  },180000);

  it("새 묶음이 있는 사본도 실제 백업·복원 검사/확정을 통과하고 복원본에서 같은 행·ZIP으로 읽힌다",async()=>{
    approve();const request=await runExport(),row=exportRow(request.id);expect(row.manifest_version).toBe(2);
    handle.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();
    const backup=backupService(handle,now).request()!,claimed=jobsService(handle,now).claim()!;expect(claimed.kind).toBe("backup");await runClaimedBackup(handle,claimed,now);
    const destination=join(root,"restored"),checked=await restoreService(handle,now).inspect({backupId:backup.id,destination});expect(checked).toMatchObject({compat:"same",fromVersion:10,toVersion:10});
    await restoreService(handle,now).finish(checked.ticketId);
    const restored=openDatabase(join(destination,"data/app.db"),{fileMustExist:true});
    try{expect(restored.sqlite.prepare("SELECT * FROM exports WHERE id=?").get(request.id)).toEqual(row);expect((await fileDigest(join(destination,"storage",row.file_path!))).sha256).toBe(row.sha256);}finally{restored.close();}
  },240000);
});

describe("원본 없음·바뀜·종류·범위: 요청과 작성 모두 EXPORT_INVALID, 다시 시도 없음",()=>{
  const reject=(label:string,pattern:RegExp)=>{const before=handle.sqlite.prepare("SELECT count(*) AS n FROM exports").get();let error:unknown;try{exportService(handle).request(P,revision());}catch(caught){error=caught;}
    expect(error,label).toBeInstanceOf(ExportSourceError);expect((error as ExportSourceError).status).toBe(409);expect((error as ExportSourceError).exportCode).toBe("EXPORT_INVALID");expect((error as Error).message).toMatch(pattern);
    expect(handle.sqlite.prepare("SELECT count(*) AS n FROM exports").get()).toEqual(before);};
  it("요청 단계: 파일 없음·크기 바뀜·소리 아님·구간 초과·등록 행 없음은 묶음을 만들지 않고 쉬운 문장으로 거절, 미리보기는 같은 문제를 표시",async()=>{
    approve();const voice=asset(ids.voice),file=sourceFile(ids.voice),moved=`${file}.away`;
    renameSync(file,moved);reject("파일 없음",/을 찾을 수 없어요/);
    const preview=exportService(handle).preview(P);if(!preview.ready)throw new Error("preview");expect(preview.audioBlocked).toBe(true);expect(preview.audio.find(item=>item.assetId===ids.voice)!.problem).toMatchObject({reason:"file_missing"});expect(preview.entries.find(entry=>entry.path.includes(ids.voice))!.missing).toBe(true);
    renameSync(moved,file);
    writeFileSync(file,Buffer.concat([readFileSync(file),Buffer.from([0])]));reject("크기 바뀜",/저장할 때와 달라요/);writeFileSync(file,readFileSync(file).subarray(0,voice.size_bytes));
    expect(sha(readFileSync(file))).toBe(voice.sha256);
    handle.sqlite.prepare("UPDATE assets SET kind='doc' WHERE id=?").run(ids.voice);reject("소리 아님",/소리 파일이 아니에요/);handle.sqlite.prepare("UPDATE assets SET kind='audio' WHERE id=?").run(ids.voice);
    handle.sqlite.prepare("UPDATE assets SET duration_ms=1000 WHERE id=?").run(ids.voice);reject("구간 초과",/사용 구간이 파일 길이를 넘어요/);handle.sqlite.prepare("UPDATE assets SET duration_ms=? WHERE id=?").run(voice.duration_ms,ids.voice);
    handle.sqlite.pragma("foreign_keys = OFF");handle.sqlite.prepare("UPDATE assets SET id=? WHERE id=?").run(v7(),ids.voice);reject("행 없음",/등록 기록이 없는 소리/);
  },180000);
  it("작성 단계: 같은 크기로 바이트가 바뀐 원본은 실패·다시 시도 불가, 성공 파일·임시 파일이 남지 않는다",async()=>{
    approve();const file=sourceFile(ids.voice),bytes=readFileSync(file);bytes[bytes.length-1]^=1;writeFileSync(file,bytes);
    const request=await runExport(),job=jobRow(request.jobId);
    expect(job).toMatchObject({status:"failed",code:"EXPORT_INVALID"});expect(job.message).toMatch(/저장할 때와 달라요/);expect(isRetryableCode(job.code)).toBe(false);
    expect(exportRow(request.id)).toMatchObject({status:"failed",file_path:null,manifest_json:null});
    expect(existsSync(join(folder,"storage/projects",P,"exports",`${request.id}.zip`))).toBe(false);
    const temp=join(folder,"storage/tmp");expect(existsSync(temp)?readdirSync(temp).filter(name=>name.startsWith(request.id)):[]).toEqual([]);
  },180000);
  it("작성 중 원본이 바뀌면(같은 크기) 저장 오류가 아니라 EXPORT_INVALID, 작성 뒤 확정 전에 원본이 없어져도 확정하지 않는다",async()=>{
    approve();const file=sourceFile(ids.voice),original=readFileSync(file);
    hook.during=()=>{const bytes=Buffer.from(original);bytes[bytes.length-1]^=1;writeFileSync(file,bytes);};
    const first=await runExport();expect(jobRow(first.jobId)).toMatchObject({status:"failed",code:"EXPORT_INVALID"});expect(jobRow(first.jobId).message).toMatch(/저장할 때와 달라요/);
    expect(existsSync(join(folder,"storage/projects",P,"exports",`${first.id}.zip`))).toBe(false);writeFileSync(file,original);
    hook.after=()=>renameSync(file,`${file}.away`);
    const second=await runExport();expect(jobRow(second.jobId)).toMatchObject({status:"failed",code:"EXPORT_INVALID"});expect(jobRow(second.jobId).message).toMatch(/을 찾을 수 없어요/);
    expect(exportRow(second.id)).toMatchObject({status:"failed",file_path:null});expect(existsSync(join(folder,"storage/projects",P,"exports",`${second.id}.zip`))).toBe(false);
    renameSync(`${file}.away`,file);const temp=join(folder,"storage/tmp");expect(existsSync(temp)?readdirSync(temp).filter(name=>name.endsWith(".part")):[]).toEqual([]);
  },180000);
  it("저장 실패는 다시 시도할 수 있고, 다시 시도는 소리 원본을 다시 재서 같은 manifest 2 묶음으로 확정",async()=>{
    approve();const request=exportService(handle).request(P,revision()),blocked=join(folder,"storage/projects",P,"exports");mkdirSync(dirname(blocked),{recursive:true});
    if(existsSync(blocked))renameSync(blocked,`${blocked}.kept`);writeFileSync(blocked,"blocked fixture");
    await runNextJob(handle,{now,sleep});expect(jobRow(request.jobId)).toMatchObject({status:"queued",code:"STORAGE_FAILED"});expect(exportRow(request.id).status).toBe("failed");
    rmSync(blocked);if(existsSync(`${blocked}.kept`))renameSync(`${blocked}.kept`,blocked);time+=30000;await runNextJob(handle,{now,sleep});
    expect(jobRow(request.jobId).status).toBe("succeeded");const row=exportRow(request.id);expect(row.manifest_version).toBe(2);await verifyZip(join(folder,"storage",row.file_path!),manifestSchema.parse(JSON.parse(row.manifest_json!)));
  },180000);
});

describe("같은 원본 여러 역할 · 보관 · 샘플 · 소리 없는 v2",()=>{
  it("같은 소리를 두 역할로 써도 파일은 1번, roles·clipIds 모두, 보관한 원본도 넣고 표시, 소리 샘플이면 묶음 샘플",async()=>{
    saveTimeline(value=>({...value,audio:[...value.audio,{id:v7(),assetId:ids.voice,role:"effect",startFrame:0,sourceInFrame:0,durationFrames:30,gainDb:-6,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false}]}));
    handle.sqlite.prepare("UPDATE assets SET archived_at=? WHERE id=?").run("2026-11-17T09:00:00.000Z",ids.music);handle.sqlite.prepare("UPDATE assets SET is_mock=1 WHERE id=?").run(ids.voice);handle.sqlite.prepare("UPDATE assets SET is_mock=0 WHERE id=?").run(ids.music);
    approve();const request=await runExport();expect(jobRow(request.jobId).status).toBe("succeeded");
    const row=exportRow(request.id),manifest=manifest2(manifestSchema.parse(JSON.parse(row.manifest_json!))),files=await zipFiles(join(folder,"storage",row.file_path!));
    const audio=manifest.files.filter(isAudioFile);
    expect(audio.map(entry=>entry.audio.assetId).sort()).toEqual([ids.voice,ids.music].sort());
    const voice=audio.find(entry=>entry.audio.assetId===ids.voice)!,music=audio.find(entry=>entry.audio.assetId===ids.music)!;
    expect(voice.audio.roles).toEqual(["voice","effect"]);expect(voice.path).toMatch(/_SAMPLE\.wav$/);expect(voice.audio.isMock).toBe(true);expect(music.path).not.toContain("_SAMPLE");expect(music.audio.isMock).toBe(false);
    expect(manifest.isMock).toBe(true);
    const list=JSON.parse(files.get("edit/audio_sources.json")!.toString("utf8"));expect(list.sources.find((item:{assetId:string})=>item.assetId===ids.voice).clipIds).toHaveLength(2);expect(list.sources.find((item:{assetId:string})=>item.assetId===ids.music).archived).toBe(true);
    expect(files.get("README.txt")!.toString("utf8")).toContain("보관한 소리도");
  },180000);
  it("소리를 모두 뺀 v2 타임라인은 manifest 1, audio/·목록·추가 문구 없음",async()=>{
    saveTimeline(value=>({...value,audio:[],audioJoins:[],audioRights:[]}));approve();
    const request=await runExport(),row=exportRow(request.id);expect(jobRow(request.jobId).status).toBe("succeeded");expect(row.manifest_version).toBe(1);
    const manifest=manifestSchema.parse(JSON.parse(row.manifest_json!));expect(manifest.manifestVersion).toBe(1);expect(manifest.files.some(entry=>entry.path.startsWith("audio/")||entry.path==="edit/audio_sources.json")).toBe(false);
    const readme=(await zipFiles(join(folder,"storage",row.file_path!))).get("README.txt")!.toString("utf8");expect(readme).not.toContain("audio/");expect(readme).not.toContain("소리 원본");
  },180000);
});
