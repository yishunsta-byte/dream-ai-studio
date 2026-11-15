import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { activityLog, assets, characters, jobs, projectAssets, projectCharacters, projects, stageStates } from "@/lib/db/schema";

export function projectsRepository(handle:DatabaseHandle) {
 const db=handle.db;
 return {
  list:()=>db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(desc(projects.updatedAt)).all(),
  get:(id:string)=>db.select().from(projects).where(and(eq(projects.id,id),isNull(projects.archivedAt))).get(),
  stages:(id:string)=>db.select().from(stageStates).where(eq(stageStates.projectId,id)).all(),
  jobStates:(id:string)=>db.select({status:jobs.status}).from(jobs).where(eq(jobs.projectId,id)).all().map((row)=>row.status),
  asset:(id:string)=>db.select().from(assets).where(and(eq(assets.id,id),isNull(assets.archivedAt))).get(),
  character:(id:string)=>db.select().from(characters).where(and(eq(characters.id,id),isNull(characters.archivedAt))).get(),
  assetChoices:()=>db.select({id:assets.id,title:assets.title,kind:assets.kind,filePath:assets.filePath}).from(assets).where(isNull(assets.archivedAt)).all(),
  characterChoices:()=>db.select({id:characters.id,name:characters.name,status:characters.status}).from(characters).where(isNull(characters.archivedAt)).all(),
  insert:(values:typeof projects.$inferInsert)=>db.insert(projects).values(values).run(),
  insertStages:(values:typeof stageStates.$inferInsert[])=>db.insert(stageStates).values(values).run(),
  linkAsset:(values:typeof projectAssets.$inferInsert)=>db.insert(projectAssets).values(values).run(),
  linkCharacter:(values:typeof projectCharacters.$inferInsert)=>db.insert(projectCharacters).values(values).onConflictDoNothing().run(),
  log:(values:typeof activityLog.$inferInsert)=>db.insert(activityLog).values(values).run(),
 };
}
