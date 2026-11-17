import "server-only";
import { PostgresAccessError, type ActorTransaction } from "@/lib/db/postgres/types";

export type ProjectCreateAsset = Readonly<{ ownerId: string; id: string; kind: string; mime: string | null; objectKey: string | null; sha256: string | null; sizeBytes: number | null }>;
export type NewPostgresProject = Readonly<{ id: string; menuId: string; templateVersion: string; templateSnapshotJson: string; inputsJson: string;
  title: string; goal: string; target: string; aspect: string; lengthSec: number; now: string }>;

// Trusted service SQL only. Ownership always comes from the transaction, never
// from a project/reference DTO. Share locks keep archive/delete checks stable.
export function postgresProjectCreateRepository(tx: ActorTransaction) {
  return {
    async asset(id: string): Promise<ProjectCreateAsset | undefined> {
      const row = (await tx.query("SELECT owner_id,id,kind,mime,file_path,sha256,size_bytes FROM dream.assets WHERE owner_id=$1 AND id=$2 AND archived_at IS NULL FOR SHARE", [tx.actorId, id])).rows[0];
      if (!row) return undefined;
      if (typeof row.owner_id !== "string" || row.owner_id !== tx.actorId || typeof row.id !== "string" || typeof row.kind !== "string" ||
        (row.mime !== null && typeof row.mime !== "string") ||
        (row.file_path !== null && typeof row.file_path !== "string") || (row.sha256 !== null && typeof row.sha256 !== "string")) throw new PostgresAccessError("PG_DATA");
      const size = row.size_bytes === null ? null : Number(row.size_bytes);
      if (size !== null && (!Number.isSafeInteger(size) || size < 0)) throw new PostgresAccessError("PG_DATA");
      return Object.freeze({ ownerId: row.owner_id, id: row.id, kind: row.kind, mime: row.mime, objectKey: row.file_path, sha256: row.sha256, sizeBytes: size });
    },
    async character(id: string): Promise<boolean> {
      return (await tx.query("SELECT id FROM dream.characters WHERE owner_id=$1 AND id=$2 AND archived_at IS NULL FOR SHARE", [tx.actorId, id])).rowCount === 1;
    },
    async insert(project: NewPostgresProject) {
      await tx.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,content_revision,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$12)`, [tx.actorId, project.id, project.menuId, project.templateVersion, project.templateSnapshotJson, project.inputsJson,
        project.title, project.goal, project.target, project.aspect, project.lengthSec, project.now]);
    },
    async stage(projectId: string, stage: string, status: string, approvedAt: string | null) {
      await tx.query("INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_at) VALUES($1,$2,$3,$4,$5)", [tx.actorId, projectId, stage, status, approvedAt]);
    },
    async linkAsset(projectId: string, assetId: string, purpose: string) {
      await tx.query("INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,$4)", [tx.actorId, projectId, assetId, purpose]);
    },
    async linkCharacter(projectId: string, characterId: string) {
      await tx.query("INSERT INTO dream.project_characters(owner_id,project_id,character_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [tx.actorId, projectId, characterId]);
    },
    async log(id: string, projectId: string, detailJson: string, now: string) {
      // Preserve the existing project.create audit label/action/payload. The
      // verified identity is independently recorded as owner_id by this repo.
      await tx.query("INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at) VALUES($1,$2,$3,'local-user','project.create',$4,$5)", [tx.actorId, id, projectId, detailJson, now]);
    },
  };
}
