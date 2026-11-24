import "server-only";
import { Client } from "pg";
import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth } from "../auth/resolve";

const error = (status: number, message: string) => Response.json({error:message},{status,headers:{"cache-control":"private, no-store"}});
type Access = { owner:string; port:number; password:string };
export async function openLocalWavAccess(request: Request):Promise<Response|Access> {
  const env = process.env;
  const port=Number(env.DREAM_OWNED_CREATE_PG_PORT);
  if (env.DREAM_PRIVATE_UPLOAD_BACKEND!=="owned-pg17" || env.VERCEL || env.NODE_ENV==="production" ||
      !["localhost","127.0.0.1"].includes(new URL(request.url).hostname) || env.DREAM_AUTH_MODE!=="supabase" ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(env.NEXT_PUBLIC_SUPABASE_URL??"") ||
      !Number.isInteger(port) || port<1 || port>65535 || !env.DREAM_OWNED_CREATE_PG_PASSWORD) return error(503,"로컬 음원 저장소를 확인해 주세요.");
  const auth=await resolveServerAuth();
  if (auth.kind==="denied") return authDeniedResponse(auth);
  if (auth.kind!=="verified") return error(401,"로그인이 필요해요.");
  return {owner:auth.userId,port,password:env.DREAM_OWNED_CREATE_PG_PASSWORD};
}

const transactionRoles = {
  local_project_brief: "SET LOCAL ROLE local_project_brief",
  local_wav: "SET LOCAL ROLE local_wav",
  local_project_audio: "SET LOCAL ROLE local_project_audio",
  local_audio_edit: "SET LOCAL ROLE local_audio_edit",
  local_render_request: "SET LOCAL ROLE local_render_request",
  local_project_review: "SET LOCAL ROLE local_project_review",
  local_render_execute: "SET LOCAL ROLE local_render_execute",
  local_editing_bundle_export: "SET LOCAL ROLE local_editing_bundle_export",
} as const;

export async function localWavTransaction(access:Access, role:keyof typeof transactionRoles, write:boolean,
  operation:(client:Client)=>Promise<Response>) {
  const client=new Client({host:"127.0.0.1",database:"dream_test_t367",port:access.port,user:role+"_login",
    password:access.password,ssl:false,connectionTimeoutMillis:3000});
  try {
    await client.connect();
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const {rows:[target]}=await client.query(`SELECT current_database()='dream_test_t367' AND inet_server_addr()='127.0.0.1'::inet
      AND current_setting('server_version_num')::int/10000=17 AND session_user=$1
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolinherit)
      AND (SELECT array_agg(p.rolname::text) FROM pg_roles p WHERE p.rolname<>r.rolname AND pg_has_role(r.oid,p.oid,'MEMBER'))
        =ARRAY[$2]::text[] AS ok FROM pg_roles r WHERE r.rolname=session_user`,[role+"_login",role]);
    if (!target?.ok) throw new Error("Invalid WAV trial target");
    await client.query(transactionRoles[role]);
    await client.query("SELECT set_config('dream.actor_id',$1,true)",[access.owner]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch {
    const code = role === "local_project_brief" ? "BRIEF_UNAVAILABLE" :
      role === "local_project_review" ? "REVIEW_UNAVAILABLE" :
      role === "local_render_request" || role === "local_render_execute" ? "RENDER_REQUEST_UNAVAILABLE" :
      role === "local_editing_bundle_export" ? "EXPORT_UNAVAILABLE" : null;
    return code ? Response.json({code},{status:503,headers:{"cache-control":"private, no-store"}})
      : error(503,"음원 저장소를 확인한 뒤 다시 시도해 주세요.");
  }
  finally { await client.end().catch(()=>undefined); }
}
