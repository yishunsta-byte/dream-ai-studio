import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { renderFileReferences } from "@/lib/db/render-data";
import { activityLog, assets, backups, exports as exportRows, generations, jobs, projects, scenes, sceneVersions, settings } from "@/lib/db/schema";
export function maintenanceRepository(handle:DatabaseHandle){const db=handle.db;return {
 backup:(id:string)=>db.select().from(backups).where(eq(backups.id,id)).get(),
 backups:()=>db.select().from(backups).orderBy(desc(backups.createdAt)).all(),
 insertBackup:(value:typeof backups.$inferInsert)=>db.insert(backups).values(value).run(),
 updateBackup:(id:string,value:Partial<typeof backups.$inferInsert>)=>db.update(backups).set(value).where(eq(backups.id,id)).run(),
 setting:(key:string)=>db.select().from(settings).where(eq(settings.key,key)).get(),
 insertSetting:(key:string,value:unknown)=>db.insert(settings).values({key,valueJson:JSON.stringify(value)}).run(),
 setSetting:(key:string,value:unknown)=>db.insert(settings).values({key,valueJson:JSON.stringify(value)}).onConflictDoUpdate({target:settings.key,set:{valueJson:JSON.stringify(value)}}).run(),
 fileReferences:()=>[...db.select({filePath:assets.filePath,sha256:assets.sha256,sizeBytes:assets.sizeBytes}).from(assets).all().filter(row=>row.filePath!==null),...db.select({filePath:exportRows.filePath,sha256:exportRows.sha256}).from(exportRows).where(eq(exportRows.status,"succeeded")).all().map(row=>({...row,sizeBytes:null})),...renderFileReferences(handle.sqlite)],
 projects:()=>db.select({id:projects.id,title:projects.title,archivedAt:projects.archivedAt}).from(projects).orderBy(desc(projects.updatedAt)).all(),
 archiveProject:(id:string,archivedAt:string|null)=>db.update(projects).set({archivedAt,updatedAt:new Date().toISOString()}).where(eq(projects.id,id)).run(),
 generationCount:(projectId?:string)=>db.select({n:count()}).from(generations).innerJoin(jobs,eq(jobs.id,generations.jobId)).where(projectId?eq(jobs.projectId,projectId):undefined).get()!.n,
 generationPage:(offset:number,projectId?:string)=>db.select({id:generations.id,provider:generations.provider,model:generations.model,paramsJson:generations.paramsJson,referenceSnapshotJson:generations.referenceSnapshotJson,costEstimateMicros:generations.costEstimateMicros,costActualMicros:generations.costActualMicros,currency:generations.currency,settlement:generations.settlement,startedAt:generations.startedAt,finishedAt:generations.finishedAt,projectId:jobs.projectId,projectTitle:projects.title,sceneTitle:scenes.title,status:jobs.status,errorCode:jobs.errorCode,errorMessage:jobs.errorMessage,cancelRequestedAt:jobs.cancelRequestedAt,assetId:assets.id,filePath:assets.filePath,isMock:assets.isMock,version:sceneVersions.version}).from(generations).innerJoin(jobs,eq(jobs.id,generations.jobId)).leftJoin(projects,eq(projects.id,jobs.projectId)).leftJoin(sceneVersions,eq(sceneVersions.generationId,generations.id)).leftJoin(scenes,eq(scenes.id,sceneVersions.sceneId)).leftJoin(assets,eq(assets.id,sceneVersions.resultAssetId)).where(projectId?eq(jobs.projectId,projectId):undefined).orderBy(desc(generations.startedAt)).limit(50).offset(offset).all(),
 activityCount:(projectId?:string)=>db.select({n:count()}).from(activityLog).where(projectId?eq(activityLog.projectId,projectId):undefined).get()!.n,
 activityPage:(offset:number,projectId?:string)=>db.select({id:activityLog.id,projectId:activityLog.projectId,projectTitle:projects.title,actor:activityLog.actor,action:activityLog.action,detailJson:activityLog.detailJson,createdAt:activityLog.createdAt}).from(activityLog).leftJoin(projects,eq(projects.id,activityLog.projectId)).where(projectId?eq(activityLog.projectId,projectId):undefined).orderBy(desc(activityLog.createdAt)).limit(50).offset(offset).all(),
 pendingJobs:()=>db.select().from(jobs).where(and(eq(jobs.status,"queued"))).all(),
 };
}
