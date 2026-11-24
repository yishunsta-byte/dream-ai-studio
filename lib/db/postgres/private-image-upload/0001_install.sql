-- T367 local installation candidate. SQL1–4 are loaded and checked by the owned runner.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(175840031,367);
DO $check$
DECLARE t text;
BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
  OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper)
  OR to_regnamespace('private_image_upload_v1') IS NOT NULL
  OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('t367_ingest','t367_verify','t367_cleanup'))
  OR to_regnamespace('dream_reservation') IS NOT NULL
 THEN RAISE EXCEPTION 'T367_OWNED_TARGET_OR_CONFLICT'; END IF;
 FOREACH t IN ARRAY ARRAY['assets','storage_policies','storage_objects','upload_intents','storage_verification_operations',
  'storage_verification_runs','storage_verification_receipts','asset_receipt_state','storage_cleanup_claims','storage_outbox'] LOOP
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=to_regclass('dream.'||t) AND relkind='r'
    AND relowner=current_user::regrole AND relrowsecurity AND relforcerowsecurity)
   OR (t<>'assets' AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=to_regclass('dream.'||t)
      AND tgname='storage_guard' AND tgenabled='O' AND tgfoid=to_regprocedure('dream.storage_guard()')))
  THEN RAISE EXCEPTION 'T367_SQL4_CATALOG'; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['storage_objects','storage_verification_operations','storage_verification_receipts','asset_receipt_state','storage_cleanup_claims'] LOOP
  IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=to_regclass('dream.'||t) AND tgname='storage_consistency'
   AND tgdeferrable AND tginitdeferred AND tgenabled='O' AND tgfoid=to_regprocedure('dream.storage_consistency_guard()'))
  THEN RAISE EXCEPTION 'T367_SQL4_CATALOG'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM dream_migrations.history)<>3 OR EXISTS(
  SELECT * FROM (VALUES
   (1,'0001_schema','3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19'),
   (2,'0002_invariants','1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100'),
   (3,'0003_rls','7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d')
  ) AS v(ordinal,id,checksum)
  EXCEPT SELECT ordinal,id,checksum FROM dream_migrations.history)
  OR EXISTS(SELECT 1 FROM dream.storage_policies WHERE policy_id='t367-local-png')
 THEN RAISE EXCEPTION 'T367_BASELINE_OR_POLICY'; END IF;
END
$check$;

CREATE ROLE t367_ingest NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE t367_verify NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE t367_cleanup NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE SCHEMA private_image_upload_v1;
COMMENT ON SCHEMA private_image_upload_v1 IS 'T367 owned PostgreSQL 17 candidate v1';
REVOKE ALL ON SCHEMA private_image_upload_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA dream TO t367_ingest,t367_verify,t367_cleanup;
GRANT USAGE ON DOMAIN dream.safe_uint,dream.safe_positive,dream.sha256 TO t367_ingest,t367_verify,t367_cleanup;
GRANT EXECUTE ON FUNCTION dream.actor_id(),dream.valid_object_key(text,uuid),dream.storage_uuid7(uuid),
 dream.storage_raw_hash(text,text) TO t367_ingest,t367_verify,t367_cleanup;

-- All three roles are restricted server principals, never browser or login roles.
-- SQL4's deferred triggers run as their caller and need the same owner's evidence.
DO $acl$
DECLARE t text; scope_sql text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assets','storage_objects','upload_intents','storage_verification_operations','storage_verification_runs',
  'storage_verification_receipts','asset_receipt_state','storage_cleanup_claims','storage_outbox'] LOOP
  EXECUTE format('GRANT SELECT ON dream.%I TO t367_ingest,t367_verify,t367_cleanup',t);
  EXECUTE format('CREATE POLICY t367_read ON dream.%I FOR SELECT TO t367_ingest,t367_verify,t367_cleanup USING (owner_id=(SELECT dream.actor_id()))',t);
 END LOOP;
 CREATE POLICY t367_add_ingest ON dream.storage_objects FOR INSERT TO t367_ingest WITH CHECK (owner_id=(SELECT dream.actor_id()));
 CREATE POLICY t367_add_ingest ON dream.upload_intents FOR INSERT TO t367_ingest
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND incoming_bucket='t367-incoming'
   AND incoming_key=owner_id::text||'/incoming/'||object_id::text||'/'||id::text);
 CREATE POLICY t367_add_verify ON dream.assets FOR INSERT TO t367_verify
  WITH CHECK (owner_id=(SELECT dream.actor_id()) AND EXISTS (
   SELECT FROM dream.storage_objects o JOIN dream.upload_intents i USING(owner_id)
   WHERE i.object_id=o.id AND i.incoming_bucket='t367-incoming' AND o.bucket='t367-private'
    AND o.lifecycle='publication_reserved' AND o.owner_id=assets.owner_id AND o.reserved_asset_id=assets.id
    AND o.object_key=assets.file_path AND o.sha256=assets.sha256 AND o.size_bytes=assets.size_bytes
    AND o.mime=assets.mime AND o.kind=assets.kind));
 FOR t IN SELECT unnest(ARRAY['storage_verification_operations','storage_verification_runs','storage_verification_receipts','asset_receipt_state','storage_outbox']) LOOP
  scope_sql:=format('EXISTS (SELECT FROM dream.upload_intents i WHERE (i.owner_id,i.object_id)=(%1$I.owner_id,%1$I.object_id) AND i.incoming_bucket=''t367-incoming'')',t);
  EXECUTE format('CREATE POLICY t367_add_verify ON dream.%I FOR INSERT TO t367_verify WITH CHECK (owner_id=(SELECT dream.actor_id()) AND %s)',t,scope_sql);
 END LOOP;
 FOR t IN SELECT unnest(ARRAY['storage_cleanup_claims','storage_outbox']) LOOP
  scope_sql:=format('EXISTS (SELECT FROM dream.upload_intents i WHERE (i.owner_id,i.object_id)=(%1$I.owner_id,%1$I.object_id) AND i.incoming_bucket=''t367-incoming'')',t);
  EXECUTE format('CREATE POLICY t367_add_cleanup ON dream.%I FOR INSERT TO t367_cleanup WITH CHECK (owner_id=(SELECT dream.actor_id()) AND %s)',t,scope_sql);
 END LOOP;
 FOR t IN SELECT unnest(ARRAY['storage_objects','storage_verification_operations','storage_outbox','storage_cleanup_claims']) LOOP
  scope_sql:=format('owner_id=(SELECT dream.actor_id()) AND EXISTS (SELECT FROM dream.upload_intents i WHERE (i.owner_id,i.object_id)=(%1$I.owner_id,%1$I.%2$I) AND i.incoming_bucket=''t367-incoming'')',
   t,CASE WHEN t='storage_objects' THEN 'id' ELSE 'object_id' END);
  EXECUTE format('CREATE POLICY t367_change ON dream.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
   t,CASE WHEN t='storage_cleanup_claims' THEN 't367_cleanup' ELSE 't367_verify,t367_cleanup' END,scope_sql,scope_sql);
 END LOOP;
END
$acl$;
CREATE POLICY t367_change ON dream.upload_intents FOR UPDATE TO t367_verify,t367_cleanup
 USING (owner_id=(SELECT dream.actor_id()) AND incoming_bucket='t367-incoming')
 WITH CHECK (owner_id=(SELECT dream.actor_id()) AND incoming_bucket='t367-incoming');
CREATE POLICY t367_policy_read ON dream.storage_policies FOR SELECT TO t367_verify
 USING (policy_id='t367-local-png');
CREATE POLICY t367_policy_lock ON dream.storage_policies FOR UPDATE TO t367_verify
 USING (policy_id='t367-local-png') WITH CHECK(false);
GRANT SELECT,UPDATE(revision) ON dream.storage_policies TO t367_verify;
GRANT INSERT ON dream.storage_objects,dream.upload_intents TO t367_ingest;
GRANT INSERT ON dream.assets,dream.storage_verification_operations,dream.storage_verification_runs,
 dream.storage_verification_receipts,dream.asset_receipt_state,dream.storage_outbox TO t367_verify;
GRANT UPDATE(lifecycle,registered_asset_id,active_generation,bucket,object_key,kind,mime,sha256,size_bytes,
 identity_json,identity_digest,publication_json,revision) ON dream.storage_objects TO t367_verify;
GRANT UPDATE(status,revision) ON dream.upload_intents TO t367_verify,t367_cleanup;
GRANT UPDATE(status,fence,worker_id,claimed_at,claim_verifiers,lease_until,completed_at,completed_state_revision,
 completed_aggregate_revision,terminal_receipt_id,terminal_json,terminal_digest,revision) ON dream.storage_verification_operations TO t367_verify;
GRANT INSERT ON dream.storage_cleanup_claims,dream.storage_outbox TO t367_cleanup;
GRANT UPDATE(lifecycle,initial_closed,closure_json,cleanup_id,barrier_fence,revision) ON dream.storage_objects TO t367_cleanup;
GRANT UPDATE(status,fence,worker_id,claimed_at,claim_verifiers,lease_until,completed_at,completed_state_revision,
 completed_aggregate_revision,terminal_json,terminal_digest,canceled_claim_json,revision) ON dream.storage_verification_operations TO t367_cleanup;
GRANT UPDATE(status,revision) ON dream.storage_outbox TO t367_verify,t367_cleanup;
GRANT UPDATE(observation_json,revision) ON dream.storage_cleanup_claims TO t367_cleanup;
COMMIT;
