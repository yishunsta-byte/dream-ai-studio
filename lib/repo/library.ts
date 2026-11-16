import "server-only";
import { countDistinct, desc, eq, isNull } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { activityLog, assets, characters, projectCharacters } from "@/lib/db/schema";
export function libraryRepository(handle:DatabaseHandle) {
 const db=handle.db;
 return {
  assets:(includeArchived=false)=>db.select().from(assets).where(includeArchived?undefined:isNull(assets.archivedAt)).orderBy(desc(assets.createdAt)).all(),
  asset:(id:string)=>db.select().from(assets).where(eq(assets.id,id)).get(),
  insertAsset:(values:typeof assets.$inferInsert)=>db.insert(assets).values(values).run(),
  archiveAsset:(id:string,archived=true)=>db.update(assets).set({archivedAt:archived?new Date().toISOString():null}).where(eq(assets.id,id)).run(),
  // Projects that use the asset: a project link, or (T-132) any saved timeline version whose sound names it, so a
  // sound file used only on a timeline is never shown as unused.
  assetUsage:(id:string)=>(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM (SELECT project_id FROM project_assets WHERE asset_id=?
    UNION SELECT t.project_id FROM timeline_revisions t, json_each(t.timeline_json,'$.audio') a WHERE json_extract(a.value,'$.assetId')=?)`).get(id,id) as {n:number}).n,
  characters:(includeArchived=false)=>db.select().from(characters).where(includeArchived?undefined:isNull(characters.archivedAt)).orderBy(desc(characters.createdAt)).all(),
  character:(id:string)=>db.select().from(characters).where(eq(characters.id,id)).get(),
  insertCharacter:(values:typeof characters.$inferInsert)=>db.insert(characters).values(values).run(),
  archiveCharacter:(id:string,archived=true)=>db.update(characters).set({archivedAt:archived?new Date().toISOString():null}).where(eq(characters.id,id)).run(),
  characterUsage:(id:string)=>db.select({count:countDistinct(projectCharacters.projectId)}).from(projectCharacters).where(eq(projectCharacters.characterId,id)).get()?.count??0,
  log:(action:string,detailJson:string)=>db.insert(activityLog).values({projectId:null,actor:"local-user",action,detailJson}).run(),
 };
}
