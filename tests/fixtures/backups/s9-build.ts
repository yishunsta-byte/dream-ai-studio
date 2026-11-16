import { execFileSync } from "node:child_process";
// T156: new stage-9 virtual fixture; native generation is opt-in and requires an OS-temp physical tool copy.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { v7 } from "uuid";
import { type DatabaseHandle } from "@/lib/db/connection";
import { productMigrations } from "@/lib/db/migrate";
import { menusSchema } from "@/lib/menus/schema";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import { checkBrowser } from "@/lib/render/tools";
import { mediaBinary } from "@/lib/media/tools";
import { timelineService } from "@/lib/services/timeline";
import { rendersService } from "@/lib/services/renders";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { jobsService } from "@/lib/services/jobs";
import { jobsRepository } from "@/lib/repo/jobs";
import { rendersRepository } from "@/lib/repo/renders";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { runClaimedRender } from "@/lib/jobs/render";
import { checkRenderRows } from "@/lib/db/render-data";
import { checkTimelineRows } from "@/lib/db/timeline-data";
import { readBackupManifest } from "@/lib/backup/archive";
import { s5Copy, addSound, clip, P } from "../../p2-5c-helpers";

export const S9_BASIS="927abc8";
export const S9_GENERATOR_VERSION=1;
export const S9_TIME=Date.parse("2026-11-17T00:00:00.000Z");
export const S9_ZIP=fileURLToPath(new URL("s9.zip",import.meta.url));
export const S9_RECORD=fileURLToPath(new URL("s9.json",import.meta.url));
export const S9_LICENSE="검수용 합성 원본: FFmpeg lavfi sine/pink noise를 직접 생성. 외부 음원·실제 사람 음성 없음. 사용권 승인이나 실제 인물 녹음이 아님.";
export const s9Migrations=()=>{const list=productMigrations().slice(0,9);if(list.length!==9||list.at(-1)?.name!=="0009_render_audio.sql")throw Error("s9 requires the published 1..9 steps");return list;};
const inside=(parent:string,file:string)=>{const r=relative(parent,file);return r!==""&&!r.startsWith("..")&&!isAbsolute(r);};
const sha=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
// Refuse native generation in the real app folder, or through symlinks/junctions to installed tools.
export function copiedToolHashes(){const cwd=realpathSync.native(process.cwd()),temp=realpathSync.native(tmpdir());if(!inside(temp,cwd))throw Error("S9 native generation requires an OS-temp snapshot");
  return Object.fromEntries((["ffmpeg","ffprobe"] as const).map(name=>{const tool=realpathSync.native(mediaBinary(name));if(!inside(join(cwd,".tools"),tool))throw Error("S9 requires physical tool copies in the snapshot");return [name,sha(tool)];}));}
export type S9Ids={project:string;v1:string;v2:string;voice:string;music:string;a:string;b:string;backup:string};
const save=(h:DatabaseHandle,audio:ReturnType<typeof clip>[]|null)=>{const t=timelineService(h),d=t.state(P);const base={fps:30 as const,aspect:"9:16" as const,video:d.clips,text:[]};return t.save(P,d.project.contentRevision,d.current!.id,audio?{...base,schemaVersion:2,audio,audioJoins:[],audioMixProfile:"p2-5-local-v1",audioRights:audio.map(c=>({assetId:c.assetId,sourceUrl:null,planName:"자체 합성 · fixture 전용",createdOn:"2026-11-17",licenseNote:S9_LICENSE}))}:{...base,schemaVersion:1,audio:[]});};
async function render(h:DatabaseHandle){const p=jobsRepository(h).project(P)!,request=await rendersService(h).request(P,{revision:p.contentRevision,timelineId:p.currentTimelineRevId!});const job=jobsService(h).claim();if(job?.id!==request.jobId)throw Error("Unexpected render claim");await runClaimedRender(h,job);const row=rendersRepository(h).row(request.renderId)!;if(row.status!=="succeeded")throw Error(`Real render failed: ${row.errorCode} ${row.errorMessage}`);return row;}
// Uses the exact s5 archive as the old data, applies only published steps through9, then makes real A and B outputs.
// The caller fixes uuid only; clocks, native deadlines, timers and child processes remain real.
export async function buildS9Runtime(runtime:string){if(productMigrations().length!==9)throw Error("Native generation must use the pinned stage9 app snapshot");const tools=copiedToolHashes();if(process.env.DREAM_DATA_ROOT!==runtime||existsSync(runtime)||!inside(realpathSync.native(tmpdir()),realpathSync.native(dirname(runtime))))throw Error("S9 requires a fresh caller-selected temporary runtime");const browser=await checkBrowser({fresh:true});if(!browser.ok||!inside(realpathSync.native(join(process.cwd(),".tools")),realpathSync.native(browser.path)))throw Error("S9 requires a pinned physical browser copy");const {handle:h,storage}=await s5Copy(runtime,s9Migrations());
  try{const menus=menusSchema.parse(JSON.parse(readFileSync("docs/spec/menus.json","utf8")));h.sqlite.prepare("UPDATE projects SET template_snapshot_json=?,inputs_json=? WHERE id=?").run(JSON.stringify(snapshotForMenu(menus,menus.menus[0])),"{}",P);h.sqlite.prepare("UPDATE scenes SET duration_sec=2 WHERE project_id=? AND archived_at IS NULL").run(P);
    const v1=save(h,null),a=await render(h),aBefore=JSON.stringify(a),v1Before=h.sqlite.prepare("SELECT timeline_json,timeline_sha256 FROM timeline_revisions WHERE id=?").get(v1.timelineId);
    const voice=addSound(h,storage,"[가상] s9 합성 목소리 역할 (sine)","sine=f=880:d=4:r=48000"),music=addSound(h,storage,"[가상] s9 합성 배경음 (pink seed156)","anoisesrc=d=4:c=pink:r=48000:a=0.16:seed=156");
    h.sqlite.prepare("UPDATE assets SET rights_note=? WHERE id IN (?,?)").run(S9_LICENSE,voice.id,music.id);
    const v2=save(h,[clip(voice.id,{role:"voice",durationFrames:120,gainDb:-4,fadeInFrames:3,fadeOutFrames:3}),clip(music.id,{role:"music",durationFrames:120,gainDb:-8,duckUnderVoice:true,fadeInFrames:3,fadeOutFrames:3})]),b=await render(h);
    if(JSON.stringify(rendersRepository(h).row(a.id))!==aBefore||JSON.stringify(h.sqlite.prepare("SELECT timeline_json,timeline_sha256 FROM timeline_revisions WHERE id=?").get(v1.timelineId))!==JSON.stringify(v1Before))throw Error("Old A/v1 changed");
    checkTimelineRows(h.sqlite);checkRenderRows(h.sqlite);if(JSON.stringify(copiedToolHashes())!==JSON.stringify(tools))throw Error("Copied tools changed during generation");
    // Real product backup job: its snapshot includes the currently-running backup job, which restore interrupts.
    h.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();const backup=backupService(h).request()!,job=jobsService(h).claim();if(job?.id!==backup.jobId)throw Error("Unexpected backup claim");await runClaimedBackup(h,job);const row=maintenanceRepository(h).backup(backup.id)!;if(row.status!=="succeeded")throw Error(`Backup job failed: ${row.error}`);
    const ids:S9Ids={project:P,v1:v1.timelineId,v2:v2.timelineId,voice:voice.id,music:music.id,a:a.id,b:b.id,backup:backup.id};
    const packet=(file:string)=>{const text=execFileSync(mediaBinary("ffmpeg"),["-v","error","-nostdin","-i",file,"-map","0:v:0","-c","copy","-f","streamhash","-hash","sha256","-"],{encoding:"utf8",windowsHide:true});const hash=/SHA256=([a-f0-9]{64})/i.exec(text)?.[1].toLowerCase();if(!hash)throw Error("Missing video packet hash");return hash;};const videoPackets={[a.id]:packet(join(storage,a.filePath!)),[b.id]:packet(join(storage,b.filePath!))};return {videoPackets,zip:row.path,manifest:await readBackupManifest(row.path),ids,tools,sourceIds:{aJob:a.jobId,bJob:b.jobId,backupJob:backup.jobId},voiceSha:sha(voice.file),musicSha:sha(music.file)};
  }finally{h.close();}
}
// A fresh, non-user test identifier for forged copies; never used to overwrite the published fixture.
export const freshS9Id=()=>v7();
