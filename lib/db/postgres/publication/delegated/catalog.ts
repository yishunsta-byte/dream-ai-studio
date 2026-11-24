import "server-only";

import { createHash } from "node:crypto";
import type { Client } from "pg";

export const delegatedSchemas = ["t253_showcase", "t293", "t295", "t_publication_install"] as const;
export const delegatedCatalogSha = "91b44500cc02b7625b6ed26bab80b8957f65b069149feb8170696130e7956605";

// Compare privileges and grantors, independent of ACL storage order and explicit defaults.
const acl = (expression: string) => `ARRAY(SELECT jsonb_build_array(pg_get_userbyid(grantor),
    CASE WHEN grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee) END,privilege_type,is_grantable)
  FROM aclexplode(${expression}) ORDER BY 1)`;

const catalogSql = `WITH ns AS (SELECT * FROM pg_namespace WHERE nspname=ANY($1::text[])),
  relations AS (SELECT c.*,n.nspname FROM pg_class c JOIN ns n ON n.oid=c.relnamespace),
  routines AS (SELECT p.*,n.nspname FROM pg_proc p JOIN ns n ON n.oid=p.pronamespace),
  snapshot(kind, identity, detail) AS (
    SELECT 'schema', nspname::text, jsonb_build_array(pg_get_userbyid(nspowner), ${acl("coalesce(nspacl,acldefault('n',nspowner))")}) FROM ns
    UNION ALL SELECT CASE WHEN relkind='r' THEN 'table' ELSE 'relation' END, nspname||'.'||relname,
      jsonb_build_array(relkind, pg_get_userbyid(relowner),
        ${acl("coalesce(relacl,CASE WHEN relkind='S' THEN acldefault('s',relowner) WHEN relkind IN ('r','p','v','m','f') THEN acldefault('r',relowner) END)")},
        relrowsecurity, relforcerowsecurity,
        CASE WHEN relkind IN ('i','I') THEN pg_get_indexdef(oid) END) FROM relations
    UNION ALL SELECT 'column', r.nspname||'.'||r.relname||'.'||a.attnum::text,
      jsonb_build_array(a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull, ${acl("a.attacl")}, a.attcollation::regcollation::text,
        pg_get_expr(d.adbin,d.adrelid)) FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT 'constraint', r.nspname||'.'||r.relname||'.'||c.conname,
      jsonb_build_array(c.convalidated, pg_get_constraintdef(c.oid)) FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid
    UNION ALL SELECT 'policy', r.nspname||'.'||r.relname||'.'||p.polname,
      jsonb_build_array(p.polcmd,p.polpermissive,ARRAY(SELECT pg_get_userbyid(role_oid) FROM unnest(p.polroles) role_oid ORDER BY pg_get_userbyid(role_oid)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
      FROM relations r JOIN pg_policy p ON p.polrelid=r.oid
    UNION ALL SELECT 'trigger', r.nspname||'.'||r.relname||'.'||t.tgname,
      jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid)) FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
    UNION ALL SELECT 'function', nspname||'.'||proname||'('||oidvectortypes(proargtypes)||')',
      jsonb_build_array(pg_get_userbyid(proowner),${acl("coalesce(proacl,acldefault('f',proowner))")},pg_get_functiondef(oid)) FROM routines
  ) SELECT kind, identity, detail FROM snapshot ORDER BY kind COLLATE "C", identity COLLATE "C"`;

export async function readDelegatedCatalogSha(client: Pick<Client, "query">) {
  const { rows } = await client.query(catalogSql, [delegatedSchemas]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
