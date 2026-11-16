// T-137 shared setup for the P2-5C render-sound tests: a copy of the fixed s5 backup in an OS temp folder (virtual
// data only), the short timeline of the P2-4 e2e (two 1 s scenes, the fixed 0–900 frame disclosure: 30 s output),
// synthetic sound files written with the app's FFmpeg into that copy's library, and a v2 timeline saved through the
// product service. Never touches real data or the fixed backup bytes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v7 } from "uuid";
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { AUDIO_MIX_PROFILE, type TimelineV2 } from "@/lib/edit/timeline";
import { mediaBinary } from "@/lib/media/tools";
import { timelineService } from "@/lib/services/timeline";
import { S5_ZIP } from "./fixtures/backups/s5-build";
import { s4Ids } from "./fixtures/backups/s4-build";

export const P=s4Ids().main,EMPTY_SCENE="019b8b76-3ae0-779e-abdc-6c717d70b2c7";
// Unpacks s5 into `dir` (product migrations applied) and prepares the short timeline. The caller stubs DREAM_DATA_ROOT.
export async function s5Copy(dir:string,migrations=productMigrations()){
  await verifyBackupArchive(S5_ZIP,await readBackupManifest(S5_ZIP),dir);
  const handle=openDatabase(join(dir,"data/app.db"),{fileMustExist:true});migrateDatabase(handle.sqlite,{migrations,now:Date.now});
  handle.sqlite.prepare("UPDATE jobs SET status='canceled',finished_at=?,lease_until=NULL WHERE status IN ('queued','running')").run(new Date().toISOString());
  handle.sqlite.prepare("UPDATE scenes SET archived_at=? WHERE id=?").run(new Date().toISOString(),EMPTY_SCENE);
  handle.sqlite.prepare("UPDATE scenes SET duration_sec=1 WHERE project_id=? AND archived_at IS NULL").run(P);
  return {handle,storage:join(dir,"storage")};
}
// The saved timeline with the current clips (aspect kept), as v1 (no sound) or v2 with the given sound.
export function saveTimeline(handle:DatabaseHandle,sound:null|{audio:TimelineV2["audio"];joins?:TimelineV2["audioJoins"]},aspect:"9:16"|"16:9"|"1:1"="9:16"){
  handle.sqlite.prepare("UPDATE projects SET aspect=? WHERE id=?").run(aspect,P);
  const fresh=timelineService(handle).state(P),saved=fresh.timeline!;
  const video=saved.video.filter(clip=>clip.sceneId!==EMPTY_SCENE).map(clip=>{const now=fresh.clips.find(item=>item.sceneId===clip.sceneId)!;return {...clip,...now,id:clip.id};});
  const base={fps:30 as const,aspect,video,text:saved.text};
  const value=sound?{...base,schemaVersion:2 as const,audio:sound.audio,audioJoins:sound.joins??[],audioMixProfile:AUDIO_MIX_PROFILE,
    audioRights:[...new Set(sound.audio.map(item=>item.assetId))].map(assetId=>({assetId,sourceUrl:null,planName:null,createdOn:null,licenseNote:null}))}
    :{...base,schemaVersion:1 as const,audio:[]};
  return timelineService(handle).save(P,fresh.project.contentRevision,fresh.current!.id,value);
}
// A synthetic sound file (FFmpeg lavfi) stored in the copy's library and registered as an audio asset.
export function addSound(handle:DatabaseHandle,storage:string,title:string,lavfi:string,ext="wav",extra:string[]=[]){
  const id=v7(),rel=`library/${id}.${ext}`,file=join(storage,rel);
  execFileSync(mediaBinary("ffmpeg"),["-v","error","-f","lavfi","-i",lavfi,...extra,file],{windowsHide:true});
  const bytes=readFileSync(file),probe=execFileSync(mediaBinary("ffprobe"),["-v","error","-show_entries","format=duration","-of","csv=p=0",file],{encoding:"utf8",windowsHide:true});
  handle.sqlite.prepare("INSERT INTO assets(id,kind,title,role,file_path,mime,size_bytes,sha256,duration_ms,origin,is_mock,archived_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,"audio",title,"original",rel,ext==="wav"?"audio/wav":ext==="mp3"?"audio/mpeg":"audio/mp4",bytes.length,createHash("sha256").update(bytes).digest("hex"),Math.floor(Number(probe.trim())*1000),"upload",0,null,new Date().toISOString());
  return {id,file};
}
export const clip=(assetId:string,over:Partial<TimelineV2["audio"][number]>={}):TimelineV2["audio"][number]=>({id:v7(),assetId,role:"music",startFrame:0,sourceInFrame:0,durationFrames:300,gainDb:0,fadeInFrames:0,fadeOutFrames:0,duckUnderVoice:false,...over});
