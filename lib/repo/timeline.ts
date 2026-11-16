import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/lib/db/connection";
import { projects, timelineRevisions } from "@/lib/db/schema";
import type { TimelineRow } from "@/lib/db/timeline-data";

// P2-1 timeline rows (T-061). Rows are only inserted (the 0005 triggers refuse UPDATE/DELETE/REPLACE); the
// project's pointer only names a row of the same project.
export function timelineRepository(handle:DatabaseHandle){const {db}=handle;
 const raw=(row:typeof timelineRevisions.$inferSelect):TimelineRow=>({id:row.id,project_id:row.projectId,revision:row.revision,content_revision:row.contentRevision,timeline_json:row.timelineJson,timeline_sha256:row.timelineSha256,source:row.source,restored_from_id:row.restoredFromId,migrated_from_key:row.migratedFromKey,created_at:row.createdAt});
 return {
  row:(id:string)=>{const row=db.select().from(timelineRevisions).where(eq(timelineRevisions.id,id)).get();return row?raw(row):undefined;},
  list:(projectId:string,limit=50)=>db.select().from(timelineRevisions).where(eq(timelineRevisions.projectId,projectId)).orderBy(desc(timelineRevisions.revision)).limit(limit).all().map(raw),
  nextRevision:(projectId:string)=>(db.select({n:sql<number>`coalesce(max(${timelineRevisions.revision}),0)`}).from(timelineRevisions).where(eq(timelineRevisions.projectId,projectId)).get()?.n??0)+1,
  insert:(row:TimelineRow)=>db.insert(timelineRevisions).values({id:row.id,projectId:row.project_id,revision:row.revision,contentRevision:row.content_revision,timelineJson:row.timeline_json,timelineSha256:row.timeline_sha256,source:row.source,restoredFromId:row.restored_from_id,migratedFromKey:row.migrated_from_key,createdAt:row.created_at}).run(),
  point:(projectId:string,id:string)=>db.update(projects).set({currentTimelineRevId:id}).where(and(eq(projects.id,projectId))).run(),
 };
}
