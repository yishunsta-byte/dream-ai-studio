import "server-only";
import { lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { v7 } from "uuid";
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { verifyMigrations } from "@/lib/db/migrate";
import { maintenanceRepository } from "@/lib/repo/maintenance";
import { jobsRepository } from "@/lib/repo/jobs";
import { backupMetaSchema, parseRestoreState, restoreInfoSchema, restoreTicketSchema, type RestoreInfo, type RestoreTicket } from "@/lib/backup/schema";
import { readBackupManifest, verifyBackupArchive, verifyStagingFiles } from "@/lib/backup/archive";
import { physicalPath, rejectForeignDataRoot, removeOwnedStaging, sourceBoundaries, validateInheritedBoundaries, validateRestoreBoundary, validateRestoreTarget, within } from "@/lib/backup/paths";
import { fileDigest } from "@/lib/export/zip";
import { MediaError } from "@/lib/media/inspect";
import { WorkflowError } from "@/lib/domain/stages";
import { checkStartup } from "./startup";
const inspectSchema=z.strictObject({backupId:z.uuidv7(),destination:z.string().min(1)}),ticketKey=(id:string)=>`restore.check.${id}`;
function invalid(){return new MediaError("RESTORE_INVALID","복원 검사 정보나 파일이 달라요. 다시 검사해 주세요.",409);}
function dto(ticket:RestoreTicket){return {ticketId:ticket.id,fileCount:ticket.manifest.files.length+1,projects:ticket.projects,assets:ticket.assets,pendingJobs:ticket.pendingJobs,destination:ticket.destination,expiresAt:ticket.expiresAt};}
async function exists(path:string){try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}}
export function restoreService(source:DatabaseHandle,now:()=>number=Date.now){
 verifyMigrations(source.sqlite);
 const repo=maintenanceRepository(source),jobs=jobsRepository(source),atomic=<T>(fn:()=>T)=>source.sqlite.transaction(fn).immediate();
 function load(id:string){const row=repo.setting(ticketKey(id));if(!row)throw invalid();const ticket=restoreTicketSchema.parse(JSON.parse(row.valueJson));if(ticket.id!==id)throw invalid();return ticket;}
 function save(ticket:RestoreTicket){repo.setSetting(ticketKey(ticket.id),restoreTicketSchema.parse(ticket));}
 function ownState(){return parseRestoreState(repo.setting("restore.info")?.valueJson).state;}
 async function boundary(path:string,empty:boolean,backupId:string){const target=await (empty?validateRestoreTarget(path):validateRestoreBoundary(path));const inherited=ownState()?.protectedRoots;if(inherited)await validateInheritedBoundaries(target,inherited);await rejectForeignDataRoot(target);const backup=repo.backup(backupId);if(!backup)throw invalid();const directories=[dirname(backup.path)];const configured=repo.setting("backup.directory");if(configured)directories.push(z.string().parse(JSON.parse(configured.valueJson)));for(const directory of directories){const actual=await physicalPath(directory);if(within(actual,target)||within(target,actual))throw invalid();}return target;}
 function owned(ticket:RestoreTicket,token:string){const current=load(ticket.id);if(current.claim!==token||!current.leaseUntil||Date.parse(current.leaseUntil)<=now()||current.status==="completed"||current.status==="failed")throw new WorkflowError("CONFLICT","다른 복원 요청이 처리 중이에요.",409);return current;}
 async function inspectInternal(input:unknown){
  const args=inspectSchema.parse(input),record=repo.backup(args.backupId),stored=repo.setting(`backup.${args.backupId}.meta`);if(!record||record.status!=="succeeded"||!stored)throw invalid();const meta=backupMetaSchema.parse(JSON.parse(stored.valueJson));
  let digest:{sha256:string;sizeBytes:number};try{const stat=await lstat(record.path);if(!stat.isFile()||stat.isSymbolicLink())throw invalid();digest=await fileDigest(record.path);}catch(error){if(["ENOENT","ENOTDIR"].includes((error as NodeJS.ErrnoException)?.code??""))throw new MediaError("BACKUP_NOT_FOUND","이 PC에서 백업 파일을 찾지 못했어요. 원래 백업 파일이 있던 위치나 연결한 저장 장치를 확인해 주세요.",404);throw error;}if(digest.sha256!==meta.zipSha256||digest.sizeBytes!==meta.sizeBytes)throw invalid();const manifest=await readBackupManifest(record.path);if(manifest.backupId!==args.backupId||manifest.database.sha256!==record.dbSha256||manifest.inventorySha256!==record.fileInventorySha256||manifest.files.length+1!==meta.fileCount)throw invalid();
  const destination=await boundary(args.destination,true,args.backupId),id=v7(),staging=join(dirname(destination),`.dream-restore-${id}`);let created=false;
  try{await verifyBackupArchive(record.path,manifest,staging,undefined,()=>{created=true;});const counts=await verifyStagingFiles(staging,manifest);const ticket=restoreTicketSchema.parse({id,backupId:args.backupId,destination,staging,expiresAt:new Date(now()+30*60000).toISOString(),manifest,status:"ready",projects:counts.projects,assets:counts.assets,pendingJobs:counts.pendingJobs});atomic(()=>{repo.insertSetting(ticketKey(id),ticket);jobs.log(null,"restore.inspected",{ticketId:id,backupId:args.backupId});});return dto(ticket);}
  catch(error){if(created)await removeOwnedStaging(staging,dirname(destination),id);if(error instanceof MediaError||error instanceof WorkflowError)throw error;throw invalid();}
 }
 function normalize(ticket:RestoreTicket,stamp:string,protectedRoots:string[]){
  const handle=openDatabase(join(ticket.staging,"data/app.db"),{fileMustExist:true});try{verifyMigrations(handle.sqlite);handle.sqlite.transaction(()=>{
   handle.sqlite.prepare("UPDATE jobs SET status='canceled',error_code='RESTORED_NOT_RESUMED',error_message='복원본에서는 작업을 이어서 하지 않아요.',lease_until=NULL,heartbeat_at=NULL,next_run_at=NULL,finished_at=?,updated_at=? WHERE status IN ('queued','running')").run(stamp,stamp);
   handle.sqlite.exec("UPDATE scene_versions SET status='canceled' WHERE status IN ('queued','running'); UPDATE exports SET status='failed',error='RESTORE_INTERRUPTED' WHERE status='running'; UPDATE backups SET status='failed',error='RESTORE_INTERRUPTED' WHERE status='running'; DELETE FROM settings WHERE key='worker.heartbeat' OR key='backup.auto.lastDay' OR key GLOB 'restore.check.*';");
   const restored=maintenanceRepository(handle);restored.setSetting("backup.directory",join(ticket.destination,"backups"));const inheritedBackupIds=(handle.sqlite.prepare("SELECT id FROM backups ORDER BY id").all() as {id:string}[]).map(row=>row.id);restored.setSetting("restore.info",{ticketId:ticket.id,backupId:ticket.backupId,destination:ticket.destination,backupCreatedAt:ticket.manifest.createdAt,restoredAt:stamp,inheritedBackupIds,protectedRoots});jobsRepository(handle).log(null,"restore.completed",{ticketId:ticket.id,backupId:ticket.backupId,pendingJobs:ticket.pendingJobs},"local-user");
  }).immediate();handle.sqlite.pragma("wal_checkpoint(TRUNCATE)");handle.sqlite.pragma("journal_mode = DELETE");}finally{handle.close();}
 }
 async function normalized(ticket:RestoreTicket,folder:string){
  if(!ticket.normalizedDatabase||!ticket.completedAt)throw invalid();const marker=join(folder,"restore-info.json"),markerStat=await lstat(marker);if(!markerStat.isFile()||markerStat.isSymbolicLink()||markerStat.size>16384)throw invalid();const info=restoreInfoSchema.parse(JSON.parse(await readFile(marker,"utf8")));const expected:RestoreInfo={schemaVersion:1,ticketId:ticket.id,backupId:ticket.backupId,destination:ticket.destination,backupCreatedAt:ticket.manifest.createdAt,restoredAt:ticket.completedAt,sourceDatabaseSha256:ticket.manifest.database.sha256,database:ticket.normalizedDatabase};if(JSON.stringify(info)!==JSON.stringify(expected))throw invalid();await verifyStagingFiles(folder,{...ticket.manifest,database:ticket.normalizedDatabase},undefined,["restore-info.json"],["backups"]);return info;
 }
 async function finish(input:unknown){
  const id=z.uuidv7().parse(input),token=v7();let ticket=atomic(()=>{const value=load(id);if(value.status==="failed")throw invalid();if(value.status!=="completed"&&value.claim&&value.leaseUntil&&Date.parse(value.leaseUntil)>now())throw new WorkflowError("CONFLICT","복원을 처리 중이에요. 잠시 후 다시 확인해 주세요.",409);if(value.status!=="completed"){value.claim=token;value.leaseUntil=new Date(now()+60000).toISOString();value.status="finishing";save(value);}return value;});
  let published=false,prepared=!!ticket.normalizedDatabase,invalidStage=false;
  const heartbeat=setInterval(()=>{try{atomic(()=>{const current=owned(ticket,token);current.leaseUntil=new Date(now()+60000).toISOString();save(current);});}catch{/* Final CAS also rejects an expired owner. */}},20000);
  try{
   const destination=await boundary(ticket.destination,false,ticket.backupId);if(relative(destination,ticket.destination)!=="")throw invalid();
   // A persisted prepared hash authenticates replay after rename even if the
   // completed-ticket transaction failed. A self-asserted on-disk marker alone does not.
   if(ticket.normalizedDatabase&&await exists(join(destination,"restore-info.json"))){await normalized(ticket,destination);published=true;if(ticket.status!=="completed")atomic(()=>{owned(ticket,token);save({...ticket,status:"completed",claim:null,leaseUntil:null});jobs.log(null,"restore.completed",{ticketId:id,backupId:ticket.backupId},"local-user");});return dto(ticket);}
   if(ticket.status==="completed")throw invalid();
   if(Date.parse(ticket.expiresAt)<=now()){invalidStage=true;throw new MediaError("RESTORE_EXPIRED","복원 검사 유효 시간이 지났어요. 다시 검사해 주세요.",409);}
   await boundary(destination,true,ticket.backupId);owned(ticket,token);
   if(!prepared){try{await verifyStagingFiles(ticket.staging,ticket.manifest);}catch{invalidStage=true;throw invalid();}owned(ticket,token);const protectedRoots=await sourceBoundaries(source.sqlite.name,ownState()?.protectedRoots??[]);owned(ticket,token);const stamp=new Date(now()).toISOString();normalize(ticket,stamp,protectedRoots);const database={path:"data/app.db",...await fileDigest(join(ticket.staging,"data/app.db"))};ticket={...ticket,normalizedDatabase:database,completedAt:stamp};const info:RestoreInfo={schemaVersion:1,ticketId:id,backupId:ticket.backupId,destination,backupCreatedAt:ticket.manifest.createdAt,restoredAt:stamp,sourceDatabaseSha256:ticket.manifest.database.sha256,database};await mkdir(join(ticket.staging,"backups"),{recursive:false});await writeFile(join(ticket.staging,"restore-info.json"),JSON.stringify(restoreInfoSchema.parse(info)),{flag:"wx",mode:0o600});atomic(()=>{const current=owned(ticket,token);save({...ticket,status:"prepared",leaseUntil:current.leaseUntil});});prepared=true;}
   try{await normalized(ticket,ticket.staging);}catch{invalidStage=true;throw invalid();}await boundary(destination,true,ticket.backupId);
   const identity=await lstat(ticket.staging);if(identity.isSymbolicLink()||relative(await realpath(ticket.staging),ticket.staging)!=="")throw invalid();
   atomic(()=>{owned(ticket,token);if(relative(realpathSync(dirname(destination)),dirname(destination))!=="")throw invalid();const current=lstatSync(ticket.staging);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino)throw invalid();let removedEmpty=false,removedMode:number|undefined;
    try{try{const target=lstatSync(destination);if(target.isSymbolicLink()||!target.isDirectory()||readdirSync(destination).length)throw invalid();removedMode=target.mode;rmdirSync(destination);removedEmpty=true;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}renameSync(ticket.staging,destination);published=true;save({...ticket,status:"completed",claim:null,leaseUntil:null});jobs.log(null,"restore.completed",{ticketId:id,backupId:ticket.backupId},"local-user");}
    catch(error){if(!published&&removedEmpty){try{mkdirSync(destination,{mode:removedMode});}catch{/* Never replace a newly occupied destination. */}}throw error;}
   });return dto(ticket);
  }catch(error){if(ticket.status!=="completed"){let own=false;try{atomic(()=>{const current=owned(ticket,token);save({...current,...(prepared?{normalizedDatabase:ticket.normalizedDatabase,completedAt:ticket.completedAt}:{}),status:published||prepared&&!invalidStage?"prepared":"failed",claim:null,leaseUntil:null});own=true;});}catch{/* A new owner must retain its staging and final. */}if(own&&!published&&(!prepared||invalidStage)&&await exists(ticket.staging))await removeOwnedStaging(ticket.staging,dirname(ticket.destination),id);}if(error instanceof MediaError||error instanceof WorkflowError)throw error;throw new MediaError("RESTORE_FAILED","복원을 확정하지 못했어요. 목적지와 저장 공간을 확인한 뒤 다시 시도해 주세요.",503);}
  finally{clearInterval(heartbeat);}
 }
 return {inspect:async(input:unknown)=>{try{return await inspectInternal(input);}catch(error){if(error instanceof MediaError||error instanceof WorkflowError)throw error;throw invalid();}},finish};
}
function ready(){if(!checkStartup().canStart)throw new WorkflowError("STAGE_LOCKED","시작 점검을 확인해 주세요.",503);}
async function live<T>(operation:(service:ReturnType<typeof restoreService>)=>Promise<T>){ready();const handle=openDatabase(undefined,{fileMustExist:true});try{verifyMigrations(handle.sqlite);return await operation(restoreService(handle));}finally{handle.close();}}
export function inspectRestore(input:unknown){return live(service=>service.inspect(input));}
export function finishRestore(ticketId:unknown){return live(service=>service.finish(ticketId));}
