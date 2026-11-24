-- Withdraw the local overlay without deleting SQL4 creation results.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(175840031,368);
DO $check$
BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
  OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
  OR obj_description(to_regnamespace('private_image_create_v1'),'pg_namespace') IS DISTINCT FROM 'T368 owned PostgreSQL 17 candidate v1'
 THEN RAISE EXCEPTION 'T368_OWNED_TARGET_OR_CONFLICT'; END IF;
END
$check$;
DROP FUNCTION private_image_create_v1.begin_create(uuid,uuid,text,text),private_image_create_v1.finish_create(uuid,uuid,uuid) RESTRICT;
DROP FUNCTION private_image_create_v1.current_png(uuid) RESTRICT;
DROP SCHEMA private_image_create_v1 RESTRICT;
DO $acl$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assets','storage_objects','storage_verification_operations','storage_verification_receipts','asset_receipt_state',
  'creation_operations','projects','stage_states','project_assets','activity_log'] LOOP
  EXECUTE format('DROP POLICY t368_owner_read ON dream.%I',t);
  EXECUTE format('REVOKE SELECT ON dream.%I FROM t368_create_guard RESTRICT',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['assets','storage_objects','storage_verification_operations','asset_receipt_state'] LOOP
  EXECUTE format('DROP POLICY t368_owner_lock ON dream.%I',t);
 END LOOP;
END
$acl$;
DROP POLICY t368_policy_read ON dream.storage_policies;
DROP POLICY t368_policy_lock ON dream.storage_policies;
DROP POLICY t368_ledger_insert ON dream.creation_operations;
DROP POLICY t368_ledger_update ON dream.creation_operations;
REVOKE UPDATE(id) ON dream.assets FROM t368_create_guard RESTRICT;
REVOKE UPDATE(revision) ON dream.storage_objects,dream.storage_verification_operations,dream.asset_receipt_state FROM t368_create_guard RESTRICT;
REVOKE SELECT,UPDATE(revision) ON dream.storage_policies FROM t368_create_guard RESTRICT;
REVOKE INSERT,UPDATE(status,project_id,result_json,result_digest,settled_at,settled_by,settled_registrars,revision)
 ON dream.creation_operations FROM t368_create_guard RESTRICT;
REVOKE EXECUTE ON FUNCTION dream.actor_id(),dream.storage_uuid7(uuid),dream.storage_raw_hash(text,text),
 dream.storage_creation_fingerprint(text,text) FROM t368_create_guard RESTRICT;
REVOKE USAGE ON DOMAIN dream.safe_uint,dream.sha256 FROM t368_create_guard RESTRICT;
REVOKE USAGE ON SCHEMA dream FROM t368_create_guard RESTRICT;
DROP ROLE t368_create_guard,t368_create_runtime;
COMMIT;
