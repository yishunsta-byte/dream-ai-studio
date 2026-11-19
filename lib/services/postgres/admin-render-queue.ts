import "server-only";
import type { Pool } from "pg";
import { AUTH_MESSAGES } from "@/lib/auth/config";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId } from "@/lib/db/postgres/types";

const statusLabels = {
  queued: "대기",
  running: "진행 중",
  succeeded: "성공",
  failed: "실패",
  canceled: "취소",
} as const;
type Status = keyof typeof statusLabels;

export type AdminRenderJob = Readonly<{
  jobId: string;
  projectId: string;
  projectTitle: string;
  status: Status;
  statusLabel: (typeof statusLabels)[Status];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}>;

type Row = {
  job_id: string; project_id: string; title: string; status: Status;
  created_at: Date; updated_at: Date; finished_at: Date | null;
};

type Dependencies = {
  resolveAuth: () => Promise<ServerAuthResult>;
  getPool: () => Pick<Pool, "connect"> | Promise<Pick<Pool, "connect">>;
};

const headers = { "cache-control": "private, no-store" } as const;
const failure = (status: 401 | 403 | 503, code: string, error: string) => ({
  status, body: { code, error }, headers,
});

// Call from a trusted server entry point with the existing allowlisted Auth
// resolver and explicitly chosen project read pool. No account ID enters from a request.
export async function readAdminRenderQueue({ resolveAuth, getPool }: Dependencies) {
  let actor;
  try {
    const auth = await resolveAuth();
    if (auth.kind === "local" || (auth.kind === "denied" && auth.status === 401))
      return failure(401, "AUTH_REQUIRED", AUTH_MESSAGES.required);
    if (auth.kind === "denied" && auth.status === 403)
      return failure(403, "AUTH_FORBIDDEN", AUTH_MESSAGES.forbidden);
    if (auth.kind !== "verified" || !auth.email)
      return failure(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
    actor = actorFromVerifiedUserId(auth.userId);
  } catch {
    return failure(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
  }

  try {
    const jobs = await withActorTransaction(await getPool(), actor, async tx => {
      const { rows } = await tx.query<Row>(`SELECT j.id AS job_id,p.id AS project_id,p.title,j.status,
          j.created_at,j.updated_at,j.finished_at
        FROM dream.jobs j
        JOIN dream.projects p ON (p.owner_id,p.id)=(j.owner_id,j.project_id)
        WHERE j.owner_id=$1 AND p.archived_at IS NULL AND j.kind IN ('render-prepare','render')
        ORDER BY j.created_at DESC,j.id DESC
        LIMIT 50`, [tx.actorId]);
      return rows.map<AdminRenderJob>(row => {
        if (!Object.hasOwn(statusLabels, row.status)) throw new Error("Invalid stored render status");
        return { jobId: row.job_id, projectId: row.project_id, projectTitle: row.title, status: row.status,
          statusLabel: statusLabels[row.status], createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null };
      });
    }, { mode: "read-only-repeatable-read" });
    return { status: 200 as const, body: { jobs }, headers };
  } catch {
    return failure(503, "ADMIN_RENDER_QUEUE_UNAVAILABLE", "렌더 작업을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
}
