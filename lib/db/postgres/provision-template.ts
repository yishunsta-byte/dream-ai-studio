import "server-only";
import { postgresMigrationManifest } from "./migration-manifest";
import { migrationLock } from "./migration-runner";

// A reviewed, password-free template, not an automatic provisioning operation.
// Existing logins are never adopted, altered or granted additional roles.
export function postgresProvisionTemplate(): string {
  const checks = postgresMigrationManifest.map((entry, index) => `(${index + 1},'${entry.id}','${entry.checksum}')`).join(",");
  return `-- Review the exact staging target, migration owner and history first.
-- PASSWORD NULL deliberately prevents password login until an authorized secret
-- operator supplies credentials out of band. Never paste secrets into this file.
BEGIN;
SELECT pg_advisory_xact_lock(${migrationLock[0]},${migrationLock[1]});
DO $checks$ BEGIN
 IF to_regclass('dream_migrations.history') IS NULL THEN RAISE EXCEPTION 'Migration history required'; END IF;
 IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='dream_migrations.history'::regclass)<>session_user THEN RAISE EXCEPTION 'Migration owner required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('dream_api_login','dream_worker_login')) THEN RAISE EXCEPTION 'Existing login must be reviewed separately'; END IF;
 IF (SELECT count(*) FROM dream_migrations.history)<>3 OR EXISTS(
   SELECT * FROM (VALUES ${checks}) AS expected(ordinal,id,checksum)
   EXCEPT SELECT ordinal,id,checksum FROM dream_migrations.history
 ) THEN RAISE EXCEPTION 'Known migration history required'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('dream_api','dream_worker') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)<>2 THEN RAISE EXCEPTION 'Restricted runtime roles required'; END IF;
END $checks$;
CREATE ROLE dream_api_login LOGIN PASSWORD NULL NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE dream_worker_login LOGIN PASSWORD NULL NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
GRANT dream_api TO dream_api_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT dream_worker TO dream_worker_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
COMMIT;
`;
}
