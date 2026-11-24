import { v7 } from "uuid";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { localWavTransaction, openLocalWavAccess } from "@/lib/cloud/local-wav-access";

const approval = z.strictObject({ acknowledged: z.literal(true), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "private, no-store" } });

export async function localProjectBrief(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) {
    const denied = await requireApiAuth();
    return denied ?? reply({ error: "요구 확인을 사용할 수 없어요." }, 503);
  }
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  const missing = () => reply({ error: "프로젝트를 찾을 수 없어요." }, 404);
  if (!z.uuidv7().safeParse(id).success) return missing();
  const writing = request.method === "POST";
  const command = writing ? approval.safeParse(await request.json().catch(() => null)).data : undefined;
  if (writing && !command) return reply({ error: "요구 사항을 검토한 뒤 승인해 주세요." }, 400);

  return localWavTransaction(access, "local_project_brief", writing, async client => {
    const keys = [access.owner, id];
    const { rows: [project] } = await client.query(`SELECT title,goal,target,aspect,length_sec::int AS "lengthSec",
      content_revision AS revision,inputs_json::jsonb->>'facts' AS facts,inputs_json::jsonb->>'productName' AS product,
      inputs_json::jsonb->>'usageRights' AS rights,inputs_json::jsonb->>'factSources' AS sources
      FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL`
      + (writing ? " FOR UPDATE" : ""), keys);
    if (!project) return missing();
    const { rows } = await client.query("SELECT stage,status FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2 AND stage IN ('intake','brief','plan')", keys);
    const stages = Object.fromEntries(rows.map(row => [row.stage, row.status]));
    const revision = Number(project.revision);
    if (!command) return reply({ ...project, revision, stages });
    if (command.revision !== revision || stages.intake !== "approved" || stages.brief !== "todo" || stages.plan !== "locked")
      return reply({ error: "프로젝트가 변경됐어요. 현재 상태를 다시 확인해 주세요." }, 409);

    const approved = await client.query("UPDATE dream.stage_states SET status='approved',approved_revision=$3,approved_at=clock_timestamp() WHERE owner_id=$1 AND project_id=$2 AND stage='brief' AND status='todo'", [...keys, revision]);
    const ready = await client.query("UPDATE dream.stage_states SET status='todo' WHERE owner_id=$1 AND project_id=$2 AND stage='plan' AND status='locked'", keys);
    if (approved.rowCount !== 1 || ready.rowCount !== 1) throw new Error("Brief transition changed");
    await client.query("INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at) VALUES($1,$3,$2,'local-user','brief.confirm',$4,clock_timestamp())",
      [...keys, v7(), JSON.stringify({ revision })]);
    return reply({ stage: "plan", revision });
  });
}
