import "server-only";
import { Client } from "pg";
import { authDeniedResponse } from "@/lib/auth/api";
import { resolveServerAuth } from "@/lib/auth/resolve";
import { localProjectFormEnabled } from "./local-project-form-enabled";

const unavailable = () => Response.json({code:"BRIEF_UNAVAILABLE"}, {status:503,headers:{"cache-control":"private, no-store"}});
type Access = { owner:string; port:number; password:string };

export async function openLocalPlanAccess(request: Request): Promise<Response|Access> {
  const env = process.env;
  const port = Number(env.DREAM_OWNED_CREATE_PG_PORT);
  if (!localProjectFormEnabled() || !["localhost","127.0.0.1"].includes(new URL(request.url).hostname)
    || env.DREAM_AUTH_MODE !== "supabase" || !Number.isInteger(port) || port < 1 || port > 65535
    || !env.DREAM_OWNED_CREATE_PG_PASSWORD) return unavailable();
  const auth = await resolveServerAuth();
  if (auth.kind === "denied") return authDeniedResponse(auth);
  if (auth.kind !== "verified") return authDeniedResponse({kind:"denied",status:401,code:"AUTH_REQUIRED"});
  return {owner:auth.userId,port,password:env.DREAM_OWNED_CREATE_PG_PASSWORD};
}

export async function localPlanTransaction<T>(access: Access, write: boolean, operation: (client: Client)=>Promise<T>): Promise<T|Response> {
  const client = new Client({host:"127.0.0.1",database:"dream_test_t367",port:access.port,user:"local_project_brief_login",
    password:access.password,ssl:false,connectionTimeoutMillis:3000});
  try {
    await client.connect();
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const {rows:[target]} = await client.query(`SELECT current_database()='dream_test_t367' AND inet_server_addr()='127.0.0.1'::inet
      AND current_setting('server_version_num')::int/10000=17 AND session_user='local_project_brief_login'
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolinherit)
      AND (SELECT array_agg(p.rolname::text) FROM pg_roles p WHERE p.rolname<>r.rolname AND pg_has_role(r.oid,p.oid,'MEMBER'))
        =ARRAY['local_project_brief'] AS ok FROM pg_roles r WHERE r.rolname=session_user`);
    if (!target?.ok) return unavailable();
    await client.query("SET LOCAL ROLE local_project_brief");
    await client.query("SELECT set_config('dream.actor_id',$1,true)",[access.owner]);
    const result = await operation(client);
    if ((await client.query("COMMIT")).command !== "COMMIT") return unavailable();
    return result;
  } catch { return unavailable(); }
  finally { await client.end().catch(()=>{}); }
}
