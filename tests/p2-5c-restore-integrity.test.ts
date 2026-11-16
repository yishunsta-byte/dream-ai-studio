// T-144 (T-143 F137-1/2): envelope B render rows read back from a repacked backup. A copy of the fixed s5 backup in an
// OS temp folder (virtual data, synthetic sound) gets a B mix render marked as a verified success with a stand-in MP4,
// is backed up by the product backup job, and restored to a new folder (accepted). Two backups repacked from that
// database with the guard triggers dropped in the copy only — one changes only the sound verify record (999 LUFS /
// 999 dBTP), one changes only the embedded timeline (gain -12, its input hash recomputed) — must be refused by restore
// inspect with nothing left behind. Further single changes of the sound record are refused by the row check itself.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { checkRenderRows } from "@/lib/db/render-data";
import { renderInputSha256 } from "@/lib/db/render-data";
import { type PrepareDeps } from "@/lib/render/input";
import { inventoryHash, readBackupManifest } from "@/lib/backup/archive";
import { backupMetaSchema } from "@/lib/backup/schema";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { jobsRepository } from "@/lib/repo/jobs";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { jobsService } from "@/lib/services/jobs";
import { rendersService } from "@/lib/services/renders";
import { restoreService } from "@/lib/services/restore";
import { addSound, clip, P, s5Copy, saveTimeline } from "./p2-5c-helpers";

let root:string,runtime:string,handle:DatabaseHandle,renderId:string,backupId:string;
const now=()=>Date.now();
const tools={ffmpeg:"9.0.2-essentials_build-www.gyan.dev",ffmpegSha256:"a".repeat(64),ffprobeSha256:"d".repeat(64)};
const deps:PrepareDeps={browser:async()=>({ok:true,version:"158.0.8127.2",path:"x",sha256:"b".repeat(64)}),source:()=>"c".repeat(64),free:async()=>1e15,audioTools:async()=>tools};
const repo=()=>maintenanceRepository(handle);
const leftovers=async()=>(await readdir(root)).filter(name=>name.startsWith(".dream-restore"));
// The sound record a verified normalized result carries (shape written by the worker).
function audioRecord(input:{durationInFrames:number;audioPlan:{tools:typeof tools;sources:{assetId:string;sha256:string}[]}}){
  const samples=input.durationInFrames*1600,m={integrated:-14.1,range:8.2,truePeak:-4.9};
  return {mode:"aac",profile:"p2-5-local-v1",tools:input.audioPlan.tools,status:"normalized",accepted:true,
    target:{integrated:-14,truePeak:-2,range:7,tolerance:1,truePeakMax:-1},
    sources:input.audioPlan.sources.map(source=>({assetId:source.assetId,sha256:source.sha256,channels:2,decodedSamples:samples})),
    mix:{sha256:"e".repeat(64),samples,peak:0.4},
    loudness:{preGainDb:0,inputI:-17.19,inputTp:-8.35,inputLra:10.5,inputThresh:-27.27,targetOffset:-1.44,normalizationType:"dynamic",outputI:-14.01,outputTp:-4.77},
    final:m,childFinal:m,output:{decodedSamples:samples,initialPadding:1024,videoStreamSha256:"f".repeat(64)}};
}
// Changes rows of a database copy with every renders guard dropped (restored afterwards), the way a repacked backup could hold them.
function forge(db:DatabaseHandle,change:()=>void){
  const saved=db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND (tbl_name='renders' OR name='render_job_identity_guard')").all() as {sql:string}[];
  db.sqlite.exec(saved.map(row=>`DROP TRIGGER ${/CREATE TRIGGER (\w+)/.exec(row.sql)![1]};`).join(""));
  try{change();}finally{for(const row of saved)db.sqlite.exec(row.sql);}
}
const row=(db:DatabaseHandle)=>db.sqlite.prepare("SELECT input_json,verify_json FROM renders WHERE id=?").get(renderId) as {input_json:string;verify_json:string};
// A backup ZIP repacked from a snapshot of the source database changed by `change` (digests, inventory and metadata matched).
async function repacked(change:(db:DatabaseHandle)=>void){
  const id=v7(),snapshot=join(root,`${id}.db`);await handle.sqlite.backup(snapshot);
  const captured=openDatabase(snapshot,{fileMustExist:true});try{forge(captured,()=>change(captured));captured.sqlite.pragma("wal_checkpoint(TRUNCATE)");captured.sqlite.pragma("journal_mode=DELETE");}finally{captured.close();}
  const original=await readBackupManifest(repo().backup(backupId)!.path),manifest={...original,backupId:id,database:{path:"data/app.db",...await fileDigest(snapshot)}};manifest.inventorySha256=inventoryHash(manifest.files);
  const path=join(runtime,"backups",`${id}.zip`);
  await writeArchive(path,[{path:"data/app.db",filename:snapshot},...manifest.files.map(file=>({path:file.path,filename:join(runtime,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
  repo().insertBackup({id,kind:"manual",path,status:"succeeded",dbSha256:manifest.database.sha256,fileInventorySha256:manifest.inventorySha256});const digest=await fileDigest(path);
  repo().insertSetting(`backup.${id}.meta`,backupMetaSchema.parse({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:new Date().toISOString()}));
  await rm(snapshot,{force:true});return id;
}

beforeAll(async()=>{
  root=await realpath(await mkdtemp(join(tmpdir(),"dream-t144-")));runtime=join(root,"s5");vi.stubEnv("DREAM_DATA_ROOT",runtime);
  const copy=await s5Copy(runtime);handle=copy.handle;
  const music=addSound(handle,copy.storage,"음악","sine=f=440:d=12:sample_rate=48000");
  const saved=saveTimeline(handle,{audio:[clip(music.id,{durationFrames:300})]}),project=jobsRepository(handle).project(P)!;
  const request=await rendersService(handle).request(P,{revision:project.contentRevision,timelineId:saved.timelineId},deps);renderId=request.renderId;
  const input=JSON.parse(row(handle).input_json);expect(input.audioPlan.mode).toBe("mix");
  // a verified success with a stand-in file (no real render here; the real path is the T-137 e2e)
  const bytes=Buffer.from("stand-in mp4 for the restore check"),rel=`projects/${P}/renders/${renderId}.mp4`;
  await mkdir(join(copy.storage,"projects",P,"renders"),{recursive:true});await writeFile(join(copy.storage,rel),bytes);const at=new Date().toISOString();
  handle.sqlite.prepare("UPDATE renders SET status='running',started_at=? WHERE id=?").run(at,renderId);
  handle.sqlite.prepare("UPDATE renders SET status='succeeded',finished_at=?,file_path=?,sha256=?,size_bytes=?,verify_json=? WHERE id=?")
    .run(at,rel,createHash("sha256").update(bytes).digest("hex"),bytes.length,JSON.stringify({result:"passed",items:[],audio:audioRecord(input)}),renderId);
  handle.sqlite.prepare("UPDATE jobs SET status='succeeded',finished_at=?,lease_until=NULL WHERE id=?").run(at,request.jobId);
  handle.sqlite.prepare("DELETE FROM settings WHERE key='backup.directory'").run();
  expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  const backup=backupService(handle,now).request()!,claimed=jobsService(handle,now).claim()!;expect(claimed.kind).toBe("backup");await runClaimedBackup(handle,claimed,now);backupId=backup.id;
},180000);
afterAll(async()=>{handle?.close();vi.unstubAllEnvs();if(root){if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});}});

describe("봉투 B 백업 복원 정합성 (T-144)",()=>{
  it("정상 B 백업은 다른 폴더로 복원되고 행·기록이 그대로",async()=>{
    const destination=join(root,"restored-ok"),svc=restoreService(handle,now),checked=await svc.inspect({backupId,destination});
    expect(checked).toMatchObject({compat:"same",fromVersion:10,toVersion:10});await svc.finish(checked.ticketId);
    const restored=openDatabase(join(destination,"data/app.db"),{fileMustExist:true});
    try{expect(row(restored)).toEqual(row(handle));expect(()=>checkRenderRows(restored.sqlite)).not.toThrow();}finally{restored.close();}
  },120000);
  it("F137-1 소리 검증 기록만 999 LUFS/999 dBTP로 바꾼 ZIP → inspect 거절, 목적지·staging 없음",async()=>{
    const id=await repacked(db=>{const value=JSON.parse(row(db).verify_json);value.audio.final={...value.audio.final,integrated:999,truePeak:999};
      db.sqlite.prepare("UPDATE renders SET verify_json=? WHERE id=?").run(JSON.stringify(value),renderId);});
    const destination=join(root,"restored-f1");
    await expect(restoreService(handle,now).inspect({backupId:id,destination})).rejects.toThrow();
    await expect(readdir(destination)).rejects.toThrow();expect(await leftovers()).toEqual([]);
  },120000);
  it("F137-2 입력 안 타임라인만 gain -12로 바꾸고 입력 해시를 다시 맞춘 ZIP → inspect 거절, 목적지·staging 없음",async()=>{
    const id=await repacked(db=>{const input=JSON.parse(row(db).input_json);input.timeline.audio[0].gainDb=-12;const json=JSON.stringify(input);
      db.sqlite.prepare("UPDATE renders SET input_json=?,input_sha256=? WHERE id=?").run(json,renderInputSha256(json),renderId);});
    const destination=join(root,"restored-f2");
    await expect(restoreService(handle,now).inspect({backupId:id,destination})).rejects.toThrow();
    await expect(readdir(destination)).rejects.toThrow();expect(await leftovers()).toEqual([]);
  },120000);
  it("행 검사: 소리 기록의 한 군데만 어긋나도 거절(이유 고정), 무음·짧음의 null 정책은 유지",()=>{
    const base=JSON.parse(row(handle).verify_json),setAudio=(audio:unknown,extra:Record<string,unknown>={})=>handle.sqlite.prepare("UPDATE renders SET verify_json=? WHERE id=?").run(JSON.stringify({...base,...extra,audio}),renderId);
    const a=base.audio,cases:[string,unknown,Record<string,unknown>?][]=[
      ["최종 -16(허용 밖)",{...a,final:{...a.final,integrated:-16}}],["TP -0.5",{...a,final:{...a.final,truePeak:-0.5}}],
      ["accepted false",{...a,accepted:false}],["목표 -13",{...a,target:{...a.target,integrated:-13}}],
      ["도구 해시 다름",{...a,tools:{...a.tools,ffmpegSha256:"0".repeat(64)}}],["원본 해시 다름",{...a,sources:a.sources.map((s:object)=>({...s,sha256:"0".repeat(64)}))}],
      ["원본 빠짐",{...a,sources:[]}],["디코드 샘플 다름",{...a,output:{...a.output,decodedSamples:a.output.decodedSamples-1}}],
      ["믹스 샘플 다름",{...a,mix:{...a.mix,samples:1}}],["모르는 필드",{...a,extra:1}],["loudness 없음",{...a,loudness:null}],
      ["silent인데 accepted true",{...a,status:"silent"}],["silent인데 소리 있음",{...a,status:"silent",accepted:null,loudness:null}],
      ["too_short인데 30초",{...a,status:"too_short",accepted:null,loudness:null}],["검사 결과 failed",a,{result:"failed"}],
      ["기록 없음",undefined],
    ];
    for(const [label,audio,extra] of cases){handle.sqlite.exec("SAVEPOINT forge");forge(handle,()=>setAudio(audio,extra));
      expect(()=>checkRenderRows(handle.sqlite),label).toThrow(/audio verify record differs/);handle.sqlite.exec("ROLLBACK TO forge; RELEASE forge");}
    // a silent result: zero peak, accepted null, no loudness pass, null measurements allowed
    handle.sqlite.exec("SAVEPOINT forge");forge(handle,()=>setAudio({...a,status:"silent",accepted:null,loudness:null,mix:{...a.mix,peak:0},final:{integrated:-70,range:0,truePeak:null},childFinal:{integrated:null,range:null,truePeak:null}}));
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();handle.sqlite.exec("ROLLBACK TO forge; RELEASE forge");
    expect(()=>checkRenderRows(handle.sqlite)).not.toThrow();
  });
});
