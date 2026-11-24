import "server-only";
import { v7 } from "uuid";
import { z } from "zod";
import type { ActorTransactionOptions } from "@/lib/db/postgres/transaction";
import { PostgresAccessError, type ActorTransaction } from "@/lib/db/postgres/types";

// P2 managed source → scene result version (candidate). Runs inside withActorTransaction as the
// dedicated LOGIN dream_scene_result_app (never SET ROLE to dream_api). After managed-scene-result 0002 that login has no
// table privilege: the whole registration (checks, request receipt, scene version, project link, activity log) is one
// call to dream_scene_result.register(), a SECURITY DEFINER function owned by the NOLOGIN dream_scene_result_writer.
// Refusals come back as an outcome row (no write, no SQL error) so the caller keeps its domain code.
export const sceneResultRole = "dream_scene_result_app";
export type SceneResultCode = "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "PLAN_NOT_APPROVED" | "STAGE_LOCKED" | "ASSET_NOT_READY";
export class SceneResultError extends Error {
  constructor(public code: SceneResultCode, public status: number) { super(code); this.name = "SceneResultError"; }
}
export const isSceneResultError = (error: unknown): error is SceneResultError => error instanceof SceneResultError;

const inputSchema = z.object({
  requestId: z.uuid(), projectId: z.uuid(), sceneId: z.uuid(), assetId: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type SceneResultInput = z.infer<typeof inputSchema>;
export type SceneResultSaved = { versionId: string; version: number; duplicate: boolean };

const installation = `SELECT EXISTS (SELECT FROM dream_scene_result.installation WHERE version=1 AND project_ref=$1)
  AND current_user::text=$2 AND current_user=session_user AND current_setting('server_version_num')::int/10000=17
  AND EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND EXISTS (SELECT FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=r.oid OR (m.roleid=r.oid AND (m.set_option OR m.inherit_option))))
  AND EXISTS (SELECT FROM pg_roles w WHERE w.rolname='dream_scene_result_writer' AND NOT w.rolcanlogin
    AND NOT (w.rolsuper OR w.rolbypassrls OR w.rolcreaterole OR w.rolcreatedb OR w.rolreplication OR w.rolinherit)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=w.oid OR (m.roleid=w.oid AND (m.set_option OR m.inherit_option))))
  AND EXISTS (SELECT FROM pg_proc f WHERE f.oid=to_regprocedure('dream_scene_result.register(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid)')
    AND f.prosecdef AND f.proowner=to_regrole('dream_scene_result_writer') AND f.proconfig=ARRAY['search_path=pg_catalog']
    AND has_function_privilege(f.oid,'EXECUTE'))
  -- The writer's two project policies share one known install state: 0002 (shopping-shorts) or 0003 (both menus).
  -- Without 0003 a topic-shorts project is NOT_FOUND inside register(); shopping-shorts is unchanged.
  AND 2 IN ((SELECT count(*) FROM pg_policy p WHERE p.polrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname='projects')
      AND p.polname IN ('scene_result_read','scene_result_lock') AND p.polroles=ARRAY[to_regrole('dream_scene_result_writer')::oid]
      AND pg_get_expr(p.polqual,p.polrelid) LIKE '%menu_id = ANY (ARRAY[''shopping-shorts''::text, ''topic-shorts''::text])%' AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%(menu_id = ''shopping-shorts''::text)%'),
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relname='projects')
      AND p.polname IN ('scene_result_read','scene_result_lock') AND p.polroles=ARRAY[to_regrole('dream_scene_result_writer')::oid]
      AND pg_get_expr(p.polqual,p.polrelid) LIKE '%(menu_id = ''shopping-shorts''::text)%' AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%topic-shorts%'))
  AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('dream','dream_scene_result') AND c.relkind IN ('r','v','m','p') AND c.oid<>'dream_scene_result.installation'::regclass
      AND (has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  AND NOT has_schema_privilege('dream','USAGE') AND NOT has_schema_privilege('dream_scene_result','CREATE') AS ready`;

// Server-owned session setup for the dedicated login (same shape as the project-core runtime).
export function sceneResultSession(ref: string): NonNullable<ActorTransactionOptions["prepareSession"]> {
  return async client => {
    await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='6s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const { rows: [state] } = await client.query<{ ready: boolean }>(installation, [ref, sceneResultRole]);
    if (!state?.ready) throw new PostgresAccessError("PG_CONFIG");
  };
}

const refusals: Record<string, [SceneResultCode, number]> = {
  INVALID_INPUT: ["INVALID_INPUT", 400], NOT_FOUND: ["NOT_FOUND", 404], CONFLICT: ["CONFLICT", 409],
  PLAN_NOT_APPROVED: ["PLAN_NOT_APPROVED", 409], STAGE_LOCKED: ["STAGE_LOCKED", 409], ASSET_NOT_READY: ["ASSET_NOT_READY", 409],
};

export async function registerManagedSceneResult(tx: ActorTransaction, raw: unknown): Promise<SceneResultSaved> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new SceneResultError("INVALID_INPUT", 400);
  const args = parsed.data;
  const { rows: [row] } = await tx.query<{ r_outcome: string; r_version_id: string | null; r_version: string | null }>(
    "SELECT r_outcome,r_version_id,r_version FROM dream_scene_result.register($1,$2,$3,$4,$5,$6,$7,$8)",
    [args.requestId, args.projectId, args.sceneId, args.assetId, args.sha256, args.revision, v7(), v7()]);
  if (row?.r_outcome === "CREATED" || row?.r_outcome === "DUPLICATE") {
    return { versionId: row.r_version_id!, version: Number(row.r_version), duplicate: row.r_outcome === "DUPLICATE" };
  }
  const refusal = row && Object.hasOwn(refusals, row.r_outcome) ? refusals[row.r_outcome] : undefined;
  if (!refusal) throw new PostgresAccessError("PG_TRANSACTION");
  throw new SceneResultError(refusal[0], refusal[1]);
}
