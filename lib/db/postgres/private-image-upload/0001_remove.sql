-- Withdraw the local ACL overlay only. SQL4 append-only evidence remains.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(175840031,367);
DO $check$
BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
  OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
  OR obj_description(to_regnamespace('private_image_upload_v1'),'pg_namespace') IS DISTINCT FROM 'T367 owned PostgreSQL 17 candidate v1'
 THEN RAISE EXCEPTION 'T367_OWNED_TARGET_OR_CONFLICT'; END IF;
END
$check$;
LOCK TABLE dream.upload_intents,dream.storage_objects,dream.storage_outbox IN SHARE ROW EXCLUSIVE MODE;
DO $check$
BEGIN
 IF EXISTS(SELECT FROM dream.upload_intents i JOIN dream.storage_objects o ON (o.owner_id,o.id)=(i.owner_id,i.object_id)
  WHERE i.incoming_bucket='t367-incoming' AND (o.lifecycle NOT IN ('registered','tombstoned')
   OR EXISTS(SELECT FROM dream.storage_outbox x WHERE (x.owner_id,x.object_id)=(o.owner_id,o.id) AND x.status<>'done')))
 THEN RAISE EXCEPTION 'T367_PENDING_STORAGE_WORK'; END IF;
END
$check$;
DO $acl$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assets','storage_objects','upload_intents','storage_verification_operations','storage_verification_runs',
  'storage_verification_receipts','asset_receipt_state','storage_cleanup_claims','storage_outbox'] LOOP
  EXECUTE format('DROP POLICY t367_read ON dream.%I',t);
  EXECUTE format('REVOKE ALL ON dream.%I FROM t367_ingest,t367_verify,t367_cleanup RESTRICT',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['storage_objects','upload_intents'] LOOP
  EXECUTE format('DROP POLICY t367_add_ingest ON dream.%I',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['assets','storage_verification_operations','storage_verification_runs','storage_verification_receipts','asset_receipt_state','storage_outbox'] LOOP
  EXECUTE format('DROP POLICY t367_add_verify ON dream.%I',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['storage_cleanup_claims','storage_outbox'] LOOP
  EXECUTE format('DROP POLICY t367_add_cleanup ON dream.%I',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['storage_objects','upload_intents','storage_verification_operations','storage_outbox','storage_cleanup_claims'] LOOP
  EXECUTE format('DROP POLICY t367_change ON dream.%I',t);
 END LOOP;
END
$acl$;
DROP POLICY t367_policy_read ON dream.storage_policies;
DROP POLICY t367_policy_lock ON dream.storage_policies;
REVOKE SELECT,UPDATE(revision) ON dream.storage_policies FROM t367_verify RESTRICT;
REVOKE UPDATE(lifecycle,registered_asset_id,active_generation,bucket,object_key,kind,mime,sha256,size_bytes,
 identity_json,identity_digest,publication_json,revision) ON dream.storage_objects FROM t367_verify RESTRICT;
REVOKE UPDATE(status,revision) ON dream.upload_intents FROM t367_verify,t367_cleanup RESTRICT;
REVOKE UPDATE(status,fence,worker_id,claimed_at,claim_verifiers,lease_until,completed_at,completed_state_revision,
 completed_aggregate_revision,terminal_receipt_id,terminal_json,terminal_digest,revision) ON dream.storage_verification_operations FROM t367_verify RESTRICT;
REVOKE UPDATE(lifecycle,initial_closed,closure_json,cleanup_id,barrier_fence,revision) ON dream.storage_objects FROM t367_cleanup RESTRICT;
REVOKE UPDATE(status,fence,worker_id,claimed_at,claim_verifiers,lease_until,completed_at,completed_state_revision,
 completed_aggregate_revision,terminal_json,terminal_digest,canceled_claim_json,revision) ON dream.storage_verification_operations FROM t367_cleanup RESTRICT;
REVOKE UPDATE(status,revision) ON dream.storage_outbox FROM t367_verify,t367_cleanup RESTRICT;
REVOKE UPDATE(observation_json,revision) ON dream.storage_cleanup_claims FROM t367_cleanup RESTRICT;
REVOKE EXECUTE ON FUNCTION dream.actor_id(),dream.valid_object_key(text,uuid),dream.storage_uuid7(uuid),
 dream.storage_raw_hash(text,text) FROM t367_ingest,t367_verify,t367_cleanup RESTRICT;
REVOKE USAGE ON DOMAIN dream.safe_uint,dream.safe_positive,dream.sha256 FROM t367_ingest,t367_verify,t367_cleanup RESTRICT;
REVOKE USAGE ON SCHEMA dream FROM t367_ingest,t367_verify,t367_cleanup RESTRICT;
DROP SCHEMA private_image_upload_v1 RESTRICT;
DROP ROLE t367_ingest,t367_verify,t367_cleanup;
COMMIT;
