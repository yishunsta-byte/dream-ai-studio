import "server-only";
import { countDistinct, desc, eq, isNull } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { activityLog, assets, characters, projectAssets, projectCharacters } from "@/lib/db/schema";
export function libraryRepository(handle:DatabaseHandle) {
 const db=handle.db;
 return {
  assets:(includeArchived=false)=>db.select().from(assets).where(includeArchived?undefined:isNull(assets.archivedAt)).orderBy(desc(assets.createdAt)).all(),
  asset:(id:string)=>db.select().from(assets).where(eq(assets.id,id)).get(),
  insertAsset:(values:typeof assets.$inferInsert)=>db.insert(assets).values(values).run(),
  archiveAsset:(id:string,archived=true)=>db.update(assets).set({archivedAt:archived?new Date().toISOString():null}).where(eq(assets.id,id)).run(),
  assetUsage:(id:string)=>db.select({count:countDistinct(projectAssets.projectId)}).from(projectAssets).where(eq(projectAssets.assetId,id)).get()?.count??0,
  characters:(includeArchived=false)=>db.select().from(characters).where(includeArchived?undefined:isNull(characters.archivedAt)).orderBy(desc(characters.createdAt)).all(),
  character:(id:string)=>db.select().from(characters).where(eq(characters.id,id)).get(),
  insertCharacter:(values:typeof characters.$inferInsert)=>db.insert(characters).values(values).run(),
  archiveCharacter:(id:string,archived=true)=>db.update(characters).set({archivedAt:archived?new Date().toISOString():null}).where(eq(characters.id,id)).run(),
  characterUsage:(id:string)=>db.select({count:countDistinct(projectCharacters.projectId)}).from(projectCharacters).where(eq(projectCharacters.characterId,id)).get()?.count??0,
  log:(action:string,detailJson:string)=>db.insert(activityLog).values({projectId:null,actor:"local-user",action,detailJson}).run(),
 };
}
