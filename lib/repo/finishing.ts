import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { exports as exportRows, reviewItems, scenes, settings } from "@/lib/db/schema";
export function finishingRepository(handle:DatabaseHandle){const db=handle.db;return {
 setting:(key:string)=>db.select().from(settings).where(eq(settings.key,key)).get(),
 insertSetting:(key:string,value:unknown)=>db.insert(settings).values({key,valueJson:JSON.stringify(value)}).run(),
 setPointer:(key:string,value:string)=>db.insert(settings).values({key,valueJson:JSON.stringify(value)}).onConflictDoUpdate({target:settings.key,set:{valueJson:JSON.stringify(value)}}).run(),
 scenePosition:(id:string,position:number)=>db.update(scenes).set({position}).where(eq(scenes.id,id)).run(),
 reviews:(projectId:string,revision:number)=>db.select().from(reviewItems).where(and(eq(reviewItems.projectId,projectId),eq(reviewItems.contentRevision,revision))).orderBy(asc(reviewItems.templateItemId)).all(),
 insertReview:(row:typeof reviewItems.$inferInsert)=>db.insert(reviewItems).values(row).onConflictDoNothing().run(),
 updateReview:(id:string,patch:Partial<typeof reviewItems.$inferInsert>)=>db.update(reviewItems).set(patch).where(eq(reviewItems.id,id)).run(),
 export:(id:string)=>db.select().from(exportRows).where(eq(exportRows.id,id)).get(),
 exports:(projectId:string)=>db.select().from(exportRows).where(eq(exportRows.projectId,projectId)).orderBy(desc(exportRows.createdAt)).all(),
 insertExport:(row:typeof exportRows.$inferInsert)=>db.insert(exportRows).values(row).run(),
 updateExport:(id:string,patch:Partial<typeof exportRows.$inferInsert>)=>db.update(exportRows).set(patch).where(eq(exportRows.id,id)).run(),
};}
