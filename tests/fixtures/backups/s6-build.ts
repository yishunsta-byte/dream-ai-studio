// Fixed virtual backup s6 (T-105): the s5 runtime upgraded with the product list (adds 0006_renders.sql at a fixed
// time), then five virtual render records of the main project's saved timeline r1, archived the way a real backup is.
// Test-side only (vitest, `server-only` mocked), writes only into the temporary root it is given; s4/s5 are never
// changed by this file. The two MP4 files are small real H.264 clips (1080×1920, 30/1, 900 frames, no audio) made
// once with the app's ffmpeg and kept in s6-inputs/; they stand in for render output and are not rendered from the
// timeline (the third scene of r1 is an empty slot, which a real render refuses: these rows are backup data only).
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { openDatabase } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { renderInputSha256 } from "@/lib/db/render-data";
import { canonicalJson } from "@/lib/edit/timeline";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { inventoryHash, storageInventory } from "@/lib/backup/archive";
import { APP_VERSION, backupManifestSchema, type BackupManifest } from "@/lib/backup/schema";
import { at, labelId, s4Ids } from "./s4-build";
import { buildS5Runtime } from "./s5-build";

export const S6_DIR=fileURLToPath(new URL(".",import.meta.url));
export const S6_ZIP=join(S6_DIR,"s6.zip"),S6_RECORD=join(S6_DIR,"s6.json");
export const S6_INPUTS={passed:join(S6_DIR,"s6-inputs","render-passed.mp4"),late:join(S6_DIR,"s6-inputs","render-late.mp4")};
export const S6_GENERATOR_VERSION=1;
export const S6_BACKUP_ID=labelId("backup.s6",970);
export const S6_UPGRADED_AT=Date.parse(at(951));
const RENDERER={remotion:"4.0.543",browser:"158.0.8127.2",compositionSourceSha256:"0".repeat(64)};
const VERIFY=(frames:number)=>({format:"mov,mp4,m4a,3gp,3g2,mj2",video:{count:1,codec:"h264",pixFmt:"yuv420p",width:1080,height:1920,rFrameRate:"30/1",avgFrameRate:"30/1",frames},durationSec:frames/30,audioStreams:0,otherStreams:0,expectedFrames:900,result:frames===900?"passed":"failed"});
// The five rows: verified success, verified result after cancel (kept), verify failure, plain cancel with a temp path
// left, and one still running when the backup was taken (a restore stops it).
export function s6Ids(){return {
  passed:labelId("render.passed",952),late:labelId("render.late",954),verifyFailed:labelId("render.verify-failed",956),canceled:labelId("render.canceled",958),running:labelId("render.running",960),
  jobPassed:labelId("job.render.passed",952),jobLate:labelId("job.render.late",954),jobVerifyFailed:labelId("job.render.verify-failed",956),jobCanceled:labelId("job.render.canceled",958),jobRunning:labelId("job.render.running",960),
};}
export type S6Ids=ReturnType<typeof s6Ids>;
export const s6RenderPath=(projectId:string,renderId:string)=>`projects/${projectId}/renders/${renderId}.mp4`;

function insert(sqlite:Database.Database,table:string,row:Record<string,unknown>){const keys=Object.keys(row);sqlite.prepare(`INSERT INTO "${table}" (${keys.map(key=>`"${key}"`).join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...keys.map(key=>row[key]));}
function update(sqlite:Database.Database,id:string,row:Record<string,unknown>){const keys=Object.keys(row);sqlite.prepare(`UPDATE renders SET ${keys.map(key=>`"${key}"=?`).join(",")} WHERE id=?`).run(...keys.map(key=>row[key]),id);}

// Input record of the main project's current timeline revision (T-101 2.2 shape), canonical text and its hash.
function renderInput(sqlite:Database.Database,projectId:string){
  const project=sqlite.prepare("SELECT current_timeline_rev_id AS rev FROM projects WHERE id=?").get(projectId) as {rev:string};
  const row=sqlite.prepare("SELECT id,revision,content_revision,timeline_json,timeline_sha256 FROM timeline_revisions WHERE id=?").get(project.rev) as {id:string;revision:number;content_revision:number;timeline_json:string;timeline_sha256:string};
  const timeline=JSON.parse(row.timeline_json) as {video:{assetId:string|null}[]};
  const media=timeline.video.filter(clip=>clip.assetId).map(clip=>sqlite.prepare("SELECT id AS assetId,kind,file_path AS relPath,sha256,size_bytes AS sizeBytes,is_mock AS isMock FROM assets WHERE id=?").get(clip.assetId) as Record<string,unknown>).map(asset=>({...asset,isMock:asset.isMock===1}));
  const input={schemaVersion:1,projectId,contentRevision:row.content_revision,timelineRevId:row.id,timelineRevision:row.revision,timelineSha256:row.timeline_sha256,timeline,
    output:{codec:"h264",pixelFormat:"yuv420p",fps:30,width:1080,height:1920,audio:"none"},durationInFrames:900,media,fonts:[],renderer:RENDERER,sample:true};
  const json=canonicalJson(input);return {row,json,sha256:renderInputSha256(json)};
}

// s5 runtime → product list (0006 at a fixed time) → five render rows (and their jobs) + two files under storage/.
export async function buildS6Runtime(runtime:string){
  await buildS5Runtime(runtime);
  const ids=s6Ids(),projectId=s4Ids().main,handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});
  try{
    migrateDatabase(handle.sqlite,{migrations:productMigrations(),now:()=>S6_UPGRADED_AT});
    const sqlite=handle.sqlite,input=renderInput(sqlite,projectId);
    const files:{id:string;from:string}[]=[];
    const make=(seq:number,id:string,jobId:string,sec:number,end:{job:Record<string,unknown>;render:Record<string,unknown>|null;file?:string;stage?:string;progress?:number})=>{
      const name=`가상 텀블러 소개_9x16_r${input.row.revision}_SAMPLE${seq>1?`-${seq}`:""}.mp4`;
      insert(sqlite,"jobs",{id:jobId,kind:"render",payload_version:1,input_snapshot_json:JSON.stringify({schemaVersion:1,renderId:id}),status:"queued",project_id:projectId,ref_type:"render",ref_id:id,provider:"local",idempotency_key:`render:${projectId}:${input.sha256}:${seq}`,attempts:0,max_attempts:3,next_run_at:at(sec),created_at:at(sec),updated_at:at(sec)});
      insert(sqlite,"renders",{id,project_id:projectId,job_id:jobId,timeline_rev_id:input.row.id,timeline_revision:input.row.revision,content_revision:input.row.content_revision,input_json:input.json,input_sha256:input.sha256,status:"queued",frames_total:900,display_name:name,name_seq:seq,is_sample:1,created_at:at(sec)});
      update(sqlite,id,{status:"running",stage:end.stage??"compose",progress_permille:end.progress??0,started_at:at(sec)});
      if(end.render)update(sqlite,id,{...end.render,finished_at:at(sec+1)});
      sqlite.prepare(`UPDATE jobs SET ${Object.keys(end.job).map(key=>`"${key}"=?`).join(",")} WHERE id=?`).run(...Object.values(end.job),jobId);
      if(end.file)files.push({id,from:end.file});
    };
    const file=(path:string)=>{const bytes=readFileSync(path);return {sha256:createHash("sha256").update(bytes).digest("hex"),size_bytes:bytes.length};};
    const done=(sec:number,status:string,extra:Record<string,unknown>={})=>({status,attempts:1,lease_until:null,heartbeat_at:null,next_run_at:null,finished_at:at(sec+1),updated_at:at(sec+1),...extra});
    make(1,ids.passed,ids.jobPassed,952,{file:S6_INPUTS.passed,job:done(952,"succeeded"),render:{status:"succeeded",stage:"verify",progress_permille:1000,frames_done:900,file_path:s6RenderPath(projectId,ids.passed),...file(S6_INPUTS.passed),verify_json:JSON.stringify(VERIFY(900))}});
    make(2,ids.late,ids.jobLate,954,{file:S6_INPUTS.late,job:done(954,"canceled",{cancel_requested_at:at(954),error_code:"RENDER_CANCELED",error_message:"영상 만들기를 취소했어요."}),render:{status:"canceled",canceled_late:1,stage:"verify",progress_permille:1000,frames_done:900,file_path:s6RenderPath(projectId,ids.late),...file(S6_INPUTS.late),verify_json:JSON.stringify(VERIFY(900)),error_code:"RENDER_CANCELED",error_message:"취소 뒤 끝남"}});
    make(3,ids.verifyFailed,ids.jobVerifyFailed,956,{job:done(956,"failed",{error_code:"RENDER_VERIFY_FAILED",error_message:"만든 영상의 확인을 통과하지 못했어요."}),render:{status:"failed",stage:"verify",progress_permille:1000,frames_done:900,verify_json:JSON.stringify(VERIFY(899)),error_code:"RENDER_VERIFY_FAILED",error_message:"프레임 수가 달라요 (899/900)."}});
    make(4,ids.canceled,ids.jobCanceled,958,{job:done(958,"canceled",{cancel_requested_at:at(958),error_code:"RENDER_CANCELED",error_message:"영상 만들기를 취소했어요."}),render:{status:"canceled",progress_permille:400,frames_done:360,error_code:"RENDER_CANCELED",error_message:"영상 만들기를 취소했어요.",cleanup_left_json:JSON.stringify(["tmp/render-"+ids.canceled+"-1/out.mp4"])}});
    make(5,ids.running,ids.jobRunning,960,{job:{status:"running",attempts:1,lease_until:at(1020),heartbeat_at:at(960),updated_at:at(960)},render:null,stage:"compose",progress:250});
    for(const item of files){const to=join(runtime,"storage",...s6RenderPath(projectId,item.id).split("/"));mkdirSync(join(to,".."),{recursive:true});copyFileSync(item.from,to);}
    if(sqlite.pragma("integrity_check",{simple:true})!=="ok"||(sqlite.pragma("foreign_key_check") as unknown[]).length)throw new Error("s6 fixture integrity failed");
  }finally{handle.close();}
}
// Same steps as assembleS5Zip (snapshot → inventory → manifest → writeArchive) with the s6 id and time.
export async function assembleS6Zip(runtime:string,workdir:string,out:string){
  const snapshot=join(workdir,"app.db");await mkdir(workdir,{recursive:true});
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});try{await handle.sqlite.backup(snapshot);}finally{handle.close();}
  const files=await storageInventory(join(runtime,"storage"));
  const captured=openDatabase(snapshot,{readonly:true,fileMustExist:true});let migrations:BackupManifest["migrations"];try{migrations=captured.sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as BackupManifest["migrations"];}finally{captured.close();}
  const manifest=backupManifestSchema.parse({schemaVersion:1,backupId:S6_BACKUP_ID,appVersion:APP_VERSION,createdAt:at(970),database:{path:"data/app.db",...await fileDigest(snapshot)},files,inventorySha256:inventoryHash(files),migrations});
  await writeArchive(out,[{path:manifest.database.path,filename:snapshot},...files.map(file=>({path:file.path,filename:join(runtime,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
  return manifest;
}
