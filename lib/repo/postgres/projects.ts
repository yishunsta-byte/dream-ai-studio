import "server-only";
import type { projects, stageStates } from "@/lib/db/schema";
import { PostgresAccessError, type ActorTransaction } from "@/lib/db/postgres/types";

type Project = typeof projects.$inferSelect;
type StageState = typeof stageStates.$inferSelect;
type Row = Record<string, unknown>;
const string = (value: unknown): string => { if (typeof value !== "string") throw new PostgresAccessError("PG_DATA"); return value; };
const optionalString = (value: unknown) => value === null ? null : string(value);
function integer(value: unknown): number {
  if (!(typeof value === "number" || typeof value === "bigint" || (typeof value === "string" && /^\d+$/.test(value)))) throw new PostgresAccessError("PG_DATA");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new PostgresAccessError("PG_DATA");
  return result;
}
function date(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new PostgresAccessError("PG_DATA");
  return value.toISOString();
}
const optionalDate = (value: unknown) => value === null ? null : date(value);
function project(row: Row): Project {
  return { id: string(row.id), menuId: string(row.menu_id), templateVersion: string(row.template_version),
    templateSnapshotJson: string(row.template_snapshot_json), inputsJson: string(row.inputs_json),
    title: string(row.title), goal: string(row.goal), target: string(row.target), aspect: string(row.aspect),
    lengthSec: integer(row.length_sec), approvedPlanId: optionalString(row.approved_plan_id),
    contentRevision: integer(row.content_revision), currentTimelineRevId: optionalString(row.current_timeline_rev_id),
    archivedAt: optionalDate(row.archived_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
}
const columns = "id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,approved_plan_id,content_revision,current_timeline_rev_id,archived_at,created_at,updated_at";

export function postgresProjectsRepository(tx: ActorTransaction) {
  return {
    async list(): Promise<Project[]> {
      return (await tx.query(`SELECT ${columns} FROM dream.projects WHERE owner_id=$1 AND archived_at IS NULL ORDER BY updated_at DESC`, [tx.actorId])).rows.map(project);
    },
    async get(id: string): Promise<Project | undefined> {
      const { rows } = await tx.query(`SELECT ${columns} FROM dream.projects WHERE owner_id=$1 AND id=$2 AND archived_at IS NULL`, [tx.actorId, id]);
      return rows[0] ? project(rows[0]) : undefined;
    },
    async stages(id: string): Promise<StageState[]> {
      const { rows } = await tx.query("SELECT project_id,stage,status,approved_plan_id,approved_revision,approved_at,note FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2", [tx.actorId, id]);
      return rows.map(row => ({ projectId: string(row.project_id), stage: string(row.stage), status: string(row.status),
        approvedPlanId: optionalString(row.approved_plan_id), approvedRevision: row.approved_revision === null ? null : integer(row.approved_revision),
        approvedAt: optionalDate(row.approved_at), note: optionalString(row.note) }));
    },
    async jobStates(id: string): Promise<string[]> {
      return (await tx.query("SELECT status FROM dream.jobs WHERE owner_id=$1 AND project_id=$2", [tx.actorId, id])).rows.map(row => string(row.status));
    },
  };
}
