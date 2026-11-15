import "server-only";
import { and, eq, isNull, asc } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { activityLog, assets, plans, projects, reviewItems, scenes, sceneVersions, stageStates } from "@/lib/db/schema";
import type { Stage, StageState } from "@/lib/domain/stages";

export function workflowRepository(handle:DatabaseHandle) {
  const db=handle.db;
  return {
    project:(id:string)=>db.select().from(projects).where(and(eq(projects.id,id),isNull(projects.archivedAt))).get(),
    stages:(id:string)=>db.select().from(stageStates).where(eq(stageStates.projectId,id)).all(),
    plan:(id:string)=>db.select().from(plans).where(eq(plans.id,id)).get(),
    planVersions:(id:string)=>db.select({version:plans.version}).from(plans).where(eq(plans.projectId,id)).all().map((row)=>row.version),
    insertPlan:(values:typeof plans.$inferInsert)=>db.insert(plans).values(values).run(),
    scenes:(id:string)=>db.select().from(scenes).where(and(eq(scenes.projectId,id),isNull(scenes.archivedAt))).orderBy(asc(scenes.position)).all(),
    version:(id:string)=>db.select().from(sceneVersions).where(eq(sceneVersions.id,id)).get(),
    asset:(id:string)=>db.select().from(assets).where(and(eq(assets.id,id),isNull(assets.archivedAt))).get(),
    reviews:(id:string,revision:number)=>db.select().from(reviewItems).where(and(eq(reviewItems.projectId,id),eq(reviewItems.contentRevision,revision))).all(),
    updateProject:(id:string,values:Partial<typeof projects.$inferInsert>)=>db.update(projects).set({...values,updatedAt:new Date().toISOString()}).where(eq(projects.id,id)).run(),
    updatePlan:(id:string,values:Partial<typeof plans.$inferInsert>)=>db.update(plans).set(values).where(eq(plans.id,id)).run(),
    updateStage:(projectId:string,stage:Stage,values:Partial<typeof stageStates.$inferInsert>)=>db.update(stageStates).set(values).where(and(eq(stageStates.projectId,projectId),eq(stageStates.stage,stage))).run(),
    invalidateStages:(id:string,states:StageState[])=>{for(const state of states)db.update(stageStates).set({status:state.status,approvedAt:null,approvedPlanId:null,approvedRevision:null}).where(and(eq(stageStates.projectId,id),eq(stageStates.stage,state.stage))).run();},
    markScenesForRecheck:(id:string)=>db.update(scenes).set({needsRecheck:true}).where(and(eq(scenes.projectId,id),isNull(scenes.archivedAt))).run(),
    selectVersion:(sceneId:string,versionId:string)=>db.update(scenes).set({selectedVersionId:versionId}).where(eq(scenes.id,sceneId)).run(),
    log:(projectId:string,action:string,detailJson:string)=>db.insert(activityLog).values({projectId,actor:"local-user",action,detailJson}).run(),
  };
}
