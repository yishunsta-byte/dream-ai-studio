import "server-only";
import { linkSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { v7 } from "uuid";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { withDatabase } from "@/lib/db/server";
import { runtimeRoot } from "@/lib/config/runtime";
import { WorkflowError } from "@/lib/domain/stages";
import { MediaError } from "@/lib/media/inspect";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { jobsRepository } from "@/lib/repo/jobs";
import { backupJobSchema, backupManifestSchema, backupMetaSchema, type BackupManifest } from "@/lib/backup/schema";
import { inventoryHash, readBackupManifest, storageInventory, verifyBackupArchive, verifyStagingFiles } from "@/lib/backup/archive";
import { removeOwnedStaging, validateBackupDirectory, within } from "@/lib/backup/paths";
import { fileDigest, writeArchive } from "@/lib/export/zip";
import { jobsService } from "./jobs";
import { checkStartup } from "./startup";
const directoryKey="backup.directory",autoDayKey="backup.auto.lastDay";
export function seoulDay(time:number){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(time));}
export function backupService(handle:DatabaseHandle,now:()=>number=Date.now){
 const repo=maintenanceRepository(handle),jobs=jobsRepository(handle),atomic=<T>(fn:()=>T)=>handle.sqlite.transaction(fn).immediate();
 function directory(){const stored=repo.setting(directoryKey);return stored?z.string().min(1).parse(JSON.parse(stored.valueJson)):join(runtimeRoot(),"backups");}
 function request(kind:"manual"|"auto"="manual"){return atomic(()=>{
  const day=seoulDay(now());if(kind==="auto"&&repo.setting(autoDayKey)?.valueJson===JSON.stringify(day))return null;
  const existing=jobs.all().find(job=>job.kind==="backup"&&["queued","running"].includes(job.status));if(existing)return {id:existing.refId,jobId:existing.id,duplicate:true};
  const id=v7(),jobId=v7(),stamp=new Date(now()).toISOString();repo.insertBackup({id,kind,path:join(directory(),`${id}.zip`),status:"running",createdAt:stamp});
  jobs.insert({id:jobId,kind:"backup",provider:"local",refType:"backup",refId:id,inputSnapshotJson:JSON.stringify(backupJobSchema.parse({schemaVersion:1,backupId:id,kind})),status:"queued",idempotencyKey:`backup:${kind}:${kind==="auto"?day:id}`,nextRunAt:stamp,createdAt:stamp,updatedAt:stamp,maxAttempts:3});if(kind==="auto")repo.setSetting(autoDayKey,day);jobs.log(null,"backup.enqueue",{backupId:id,jobId,kind},"local-user");return {id,jobId,duplicate:false};
 });}
 function list(){const allJobs=jobs.all();const rows=repo.backups().map(row=>{const job=allJobs.find(job=>job.kind==="backup"&&job.refId===row.id);const stored=repo.setting(`backup.${row.id}.meta`);const meta=stored?backupMetaSchema.safeParse(JSON.parse(stored.valueJson)):null;return {id:row.id,kind:row.kind,status:row.status,jobId:job?.id??null,jobStatus:job?.status??null,createdAt:row.createdAt,finishedAt:job?.finishedAt??null,error:row.error?(job?.status==="canceled"?"취소했어요.":row.error==="RESTORE_INTERRUPTED"?"복원으로 중단된 백업이에요.":"백업을 마치지 못했어요. 저장 위치와 공간을 확인해 주세요."):null,verifiedAt:meta?.success?meta.data.verifiedAt:null,fileCount:meta?.success?meta.data.fileCount:null,sizeBytes:meta?.success?meta.data.sizeBytes:null};});return {rows,lastSuccess:rows.filter(row=>row.status==="succeeded").sort((a,b)=>(b.verifiedAt??b.createdAt).localeCompare(a.verifiedAt??a.createdAt))[0]??null,lastFailure:rows.filter(row=>row.status==="failed").sort((a,b)=>(b.finishedAt??b.createdAt).localeCompare(a.finishedAt??a.createdAt))[0]??null};}
 return {request,enqueueAuto:()=>request("auto"),list,configuration:()=>({directory:directory()}),setDirectory:async(input:string)=>{const target=await validateBackupDirectory(input);atomic(()=>{repo.setSetting(directoryKey,target);jobs.log(null,"backup.directory_changed",{},"local-user");});return {directory:target};}};
}
export async function runClaimedBackup(handle:DatabaseHandle,job:{id:string;attempts:number;inputSnapshotJson:string;startedAt:string},now:()=>number=Date.now){
 const input=backupJobSchema.parse(JSON.parse(job.inputSnapshotJson)),repo=maintenanceRepository(handle),jobs=jobsRepository(handle),service=jobsService(handle,now),record=repo.backup(input.backupId);
 if(!record||record.kind!==input.kind||record.status==="succeeded")throw new MediaError("BACKUP_INVALID","백업 작업 정보를 확인해 주세요.");
 const controller=new AbortController();let staging:string|undefined,parent:string|undefined;
 function check(){const current=service.assertClaim(job.id,job.attempts);if(current.refId!==input.backupId||current.kind!=="backup")throw new WorkflowError("CONFLICT","백업 처리권이 바뀌었어요.");if(current.cancelRequestedAt)throw new MediaError("BACKUP_CANCELED","백업을 취소했어요.");if(now()-Date.parse(job.startedAt)>=30*60000)throw new MediaError("TIMEOUT","백업 제한 시간이 지났어요.");}
 const timer=setInterval(()=>{try{check();}catch(error){controller.abort(error);}},250);
 try{
  check();parent=await validateBackupDirectory(dirname(record.path));const final=join(parent,`${input.backupId}.zip`);if(!within(parent,final))throw new Error("Backup path escaped");
  staging=join(parent,`.dream-backup-${input.backupId}-${job.attempts}-${v7()}`);await mkdir(staging,{mode:0o700});staging=await realpath(/*turbopackIgnore: true*/staging);
  let manifest:BackupManifest,temp:string|undefined,existing=false,orphanIdentity:{dev:number;ino:number}|undefined;
  try{const stat=await lstat(final);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Backup final link rejected");existing=true;orphanIdentity={dev:stat.dev,ino:stat.ino};}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  if(existing){manifest=await readBackupManifest(final);if(manifest.backupId!==input.backupId||manifest.createdAt!==record.createdAt)throw new Error("Orphan backup identity differs");await verifyBackupArchive(final,manifest,undefined,controller.signal);}
  else{
   const data=join(staging,"data");await mkdir(data);const snapshot=join(data,"app.db");
   await handle.sqlite.backup(snapshot,{progress:()=>{check();return 100;}});check();
   const files=await storageInventory(join(runtimeRoot(),"storage"),controller.signal);
   // The backup API captures WAL state. Reference checks below use the captured
   // DB, not mutable live rows; extraction verifies every recorded source hash.
   const {openDatabase}=await import("@/lib/db/connection");const captured=openDatabase(snapshot,{readonly:true,fileMustExist:true});let migrations:BackupManifest["migrations"];
   try{migrations=captured.sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as BackupManifest["migrations"];const inventory=new Map(files.map(file=>[file.path,file]));for(const ref of maintenanceRepository(captured).fileReferences()){const file=inventory.get(`storage/${ref.filePath}`);if(!file||!ref.sha256||file.sha256!==ref.sha256||(ref.sizeBytes!==null&&file.sizeBytes!==ref.sizeBytes))throw new MediaError("BACKUP_INVALID","참조 자료가 없거나 저장 기록과 달라요.");}}finally{captured.close();}
   manifest=backupManifestSchema.parse({schemaVersion:1,backupId:input.backupId,appVersion:"0.1.0",createdAt:record.createdAt,database:{path:"data/app.db",...await fileDigest(snapshot,controller.signal)},files,inventorySha256:inventoryHash(files),migrations});
   temp=join(staging,"archive.zip");const storage=await realpath(/*turbopackIgnore: true*/join(runtimeRoot(),"storage"));await writeArchive(temp,[{path:manifest.database.path,filename:snapshot},...files.map(file=>({path:file.path,filename:join(storage,file.path.slice("storage/".length))})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}],controller.signal);
  }
  check();const archive=existing?final:temp!;const verified=join(staging,"verified");await verifyBackupArchive(archive,manifest,verified,controller.signal);await verifyStagingFiles(verified,manifest,controller.signal);const digest=await fileDigest(archive,controller.signal),meta=backupMetaSchema.parse({zipSha256:digest.sha256,sizeBytes:digest.sizeBytes,fileCount:manifest.files.length+1,verifiedAt:new Date(now()).toISOString()});check();
  handle.sqlite.transaction(()=>{check();if(relative(parent!,realpathSync(parent!))!=="")throw new Error("Backup directory changed");if(existing){const current=lstatSync(final);if(!current.isFile()||current.isSymbolicLink()||current.dev!==orphanIdentity!.dev||current.ino!==orphanIdentity!.ino)throw new Error("Orphan backup changed");}let linked=false;try{if(!existing){linkSync(temp!,final);linked=true;}else{const stat=service.assertClaim(job.id,job.attempts);if(stat.cancelRequestedAt)throw new MediaError("BACKUP_CANCELED","백업을 취소했어요.");}
   repo.updateBackup(input.backupId,{status:"succeeded",path:final,dbSha256:manifest.database.sha256,fileInventorySha256:manifest.inventorySha256,error:null});repo.insertSetting(`backup.${input.backupId}.meta`,meta);jobs.update(job.id,{status:"succeeded",leaseUntil:null,finishedAt:new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString(),errorCode:null,errorMessage:null});jobs.log(null,"backup.succeeded",{backupId:input.backupId,jobId:job.id,fileCount:meta.fileCount});
  }catch(error){if(linked){try{unlinkSync(final);}catch{/* An uncommitted orphan can be verified by the next lease owner. */}}throw error;}}).immediate();
 }catch(caught){const error=controller.signal.aborted?controller.signal.reason:caught;if(error instanceof MediaError&&error.code==="BACKUP_CANCELED"){service.canceled(job.id,job.attempts);return;}if(error instanceof MediaError||error instanceof WorkflowError)throw error;throw new MediaError("STORAGE_FAILED","백업을 저장하거나 검증하지 못했어요. 저장 공간과 자료를 확인해 주세요.",503);}
 finally{clearInterval(timer);if(staging&&parent)await removeOwnedStaging(staging,parent,input.backupId);}
}
function ready(){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);}
export function readBackups(){return withDatabase(handle=>backupService(handle).list());}
export function readBackupConfiguration(){return withDatabase(handle=>backupService(handle).configuration());}
export function requestBackup(){ready();return withDatabase(handle=>backupService(handle).request());}
export async function configureBackupDirectory(input:string){ready();const target=await validateBackupDirectory(input);return withDatabase(handle=>handle.sqlite.transaction(()=>{const repo=maintenanceRepository(handle);repo.setSetting(directoryKey,target);jobsRepository(handle).log(null,"backup.directory_changed",{},"local-user");return {directory:target};}).immediate());}
export type BackupsData=ReturnType<typeof readBackups>;
