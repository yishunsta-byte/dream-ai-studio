import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { activityLog, assets, characters, generations, jobs, plans, projects, sceneVersions, scenes, settings } from "@/lib/db/schema";
export function jobsRepository(handle:DatabaseHandle){const db=handle.db;return {
 job:(id:string)=>db.select().from(jobs).where(eq(jobs.id,id)).get(),
 all:()=>db.select().from(jobs).orderBy(desc(jobs.createdAt)).all(),
 queued:()=>db.select().from(jobs).where(eq(jobs.status,"queued")).orderBy(asc(jobs.createdAt)).all(),
 running:()=>db.select().from(jobs).where(eq(jobs.status,"running")).all(),
 insert:(row:typeof jobs.$inferInsert)=>db.insert(jobs).values(row).run(),
 update:(id:string,patch:Partial<typeof jobs.$inferInsert>)=>db.update(jobs).set(patch).where(eq(jobs.id,id)).run(),
 versions:(id:string)=>db.select().from(sceneVersions).where(eq(sceneVersions.sceneId,id)).all(),
 versionForJob:(id:string)=>db.select().from(sceneVersions).where(eq(sceneVersions.jobId,id)).get(),
 insertVersion:(row:typeof sceneVersions.$inferInsert)=>db.insert(sceneVersions).values(row).run(),
 updateVersion:(id:string,patch:Partial<typeof sceneVersions.$inferInsert>)=>db.update(sceneVersions).set(patch).where(eq(sceneVersions.id,id)).run(),
 project:(id:string)=>db.select().from(projects).where(and(eq(projects.id,id),isNull(projects.archivedAt))).get(),
 scene:(id:string)=>db.select().from(scenes).where(eq(scenes.id,id)).get(),
 plan:(id:string)=>db.select().from(plans).where(eq(plans.id,id)).get(),
 assets:(ids:string[])=>ids.length?db.select().from(assets).where(inArray(assets.id,ids)).all():[],
 characters:(ids:string[])=>ids.length?db.select().from(characters).where(inArray(characters.id,ids)).all():[],
 generation:(jobId:string)=>db.select().from(generations).where(eq(generations.jobId,jobId)).get(),
 insertGeneration:(row:typeof generations.$inferInsert)=>db.insert(generations).values(row).run(),
 updateGeneration:(id:string,patch:Partial<typeof generations.$inferInsert>)=>db.update(generations).set(patch).where(eq(generations.id,id)).run(),
 insertAsset:(row:typeof assets.$inferInsert)=>db.insert(assets).values(row).run(),
 select:(id:string,versionId:string)=>db.update(scenes).set({selectedVersionId:versionId,needsRecheck:false}).where(eq(scenes.id,id)).run(),
 setting:(key:string)=>db.select().from(settings).where(eq(settings.key,key)).get(),
 setSetting:(key:string,value:unknown)=>db.insert(settings).values({key,valueJson:JSON.stringify(value)}).onConflictDoUpdate({target:settings.key,set:{valueJson:JSON.stringify(value)}}).run(),
 log:(projectId:string|null,action:string,detail:unknown,actor="worker")=>db.insert(activityLog).values({projectId,actor,action,detailJson:JSON.stringify(detail)}).run(),
};}
