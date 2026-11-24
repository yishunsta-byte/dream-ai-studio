import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { renders } from "@/lib/db/schema";

export type RenderRow=typeof renders.$inferSelect;
export type RenderInsert=Pick<typeof renders.$inferInsert,"id"|"projectId"|"jobId"|"timelineRevId"|"timelineRevision"|"contentRevision"|"inputJson"|"inputSha256"|"framesTotal"|"displayName"|"nameSeq"|"isSample"|"createdAt">;
// Fields a worker may change while a render is queued/running, and the final fields set once when it finishes.
export type RenderProgress=Partial<Pick<typeof renders.$inferInsert,"status"|"stage"|"progressPermille"|"framesDone"|"startedAt">>;
export type RenderFinish=Pick<typeof renders.$inferInsert,"status"|"finishedAt">&Partial<Pick<typeof renders.$inferInsert,"filePath"|"sha256"|"sizeBytes"|"verifyJson"|"canceledLate"|"errorCode"|"errorMessage"|"stage"|"progressPermille"|"framesDone"|"cleanupLeftJson">>;
// P2-4a render rows (T-105). The 0006 triggers enforce the job/timeline contract, immutability and no delete;
// this repository only inserts new queued rows and applies the allowed changes.
export function rendersRepository(handle:DatabaseHandle){const {db}=handle;
 return {
  row:(id:string)=>db.select().from(renders).where(eq(renders.id,id)).get(),
  byJob:(jobId:string)=>db.select().from(renders).where(eq(renders.jobId,jobId)).get(),
  list:(projectId:string,limit=50)=>db.select().from(renders).where(eq(renders.projectId,projectId)).orderBy(desc(renders.createdAt),desc(renders.id)).limit(limit).all(),
  completedFiles:(projectId:string,timelineId:string,contentRevision:number)=>db.select({
    id:renders.id,filePath:renders.filePath,sizeBytes:renders.sizeBytes,
  }).from(renders).where(and(eq(renders.projectId,projectId),eq(renders.timelineRevId,timelineId),
    eq(renders.contentRevision,contentRevision),eq(renders.status,"succeeded"),eq(renders.canceledLate,false)))
    .orderBy(desc(renders.createdAt),desc(renders.id)).all(),
  active:(projectId:string)=>db.select().from(renders).where(and(eq(renders.projectId,projectId),inArray(renders.status,["queued","running"]))).get(),
  // Next "-N" number for the same saved timeline revision (1 for the first render of it).
  nextNameSeq:(projectId:string,timelineRevId:string)=>(db.select({n:sql<number>`coalesce(max(${renders.nameSeq}),0)`}).from(renders).where(and(eq(renders.projectId,projectId),eq(renders.timelineRevId,timelineRevId))).get()?.n??0)+1,
  insert:(value:RenderInsert)=>db.insert(renders).values({...value,status:"queued"}).run(),
  progress:(id:string,value:RenderProgress)=>db.update(renders).set(value).where(eq(renders.id,id)).run(),
  finish:(id:string,value:RenderFinish)=>db.update(renders).set(value).where(eq(renders.id,id)).run(),
  recordCleanup:(id:string,left:readonly string[])=>db.update(renders).set({cleanupLeftJson:JSON.stringify(left)}).where(eq(renders.id,id)).run(),
 };
}
