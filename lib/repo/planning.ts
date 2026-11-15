import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { assets, characters, plans, projectAssets, projectCharacters, scenes } from "@/lib/db/schema";
export function planningRepository(handle:DatabaseHandle) {
 const db=handle.db;
 return {
  plans:(projectId:string)=>db.select().from(plans).where(eq(plans.projectId,projectId)).orderBy(desc(plans.version)).all(),
  allScenes:(projectId:string)=>db.select().from(scenes).where(eq(scenes.projectId,projectId)).orderBy(asc(scenes.position)).all(),
  insertScene:(values:typeof scenes.$inferInsert)=>db.insert(scenes).values(values).run(),
  updateScene:(id:string,projectId:string,values:Partial<typeof scenes.$inferInsert>)=>db.update(scenes).set(values).where(and(eq(scenes.id,id),eq(scenes.projectId,projectId))).run(),
  assets:(projectId:string)=>db.select({id:assets.id,title:assets.title,kind:assets.kind,filePath:assets.filePath,rightsNote:assets.rightsNote,archivedAt:assets.archivedAt}).from(projectAssets).innerJoin(assets,eq(projectAssets.assetId,assets.id)).where(eq(projectAssets.projectId,projectId)).all(),
  characters:(projectId:string)=>db.select({id:characters.id,name:characters.name,status:characters.status,archivedAt:characters.archivedAt}).from(projectCharacters).innerJoin(characters,eq(projectCharacters.characterId,characters.id)).where(eq(projectCharacters.projectId,projectId)).all(),
 };
}
