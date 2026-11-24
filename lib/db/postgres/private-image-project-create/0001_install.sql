-- Local T368 overlay. Install only after the pinned SQL4 and T367 fixture.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(175840031,368);
DO $check$
BEGIN
 IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
  OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper)
  OR obj_description(to_regnamespace('private_image_upload_v1'),'pg_namespace') IS DISTINCT FROM 'T367 owned PostgreSQL 17 candidate v1'
  OR to_regnamespace('private_image_create_v1') IS NOT NULL
  OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('t368_create_guard','t368_create_runtime'))
 THEN RAISE EXCEPTION 'T368_OWNED_TARGET_OR_CONFLICT'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class WHERE oid=to_regclass('dream.creation_operations')
  AND relkind='r' AND relowner=current_user::regrole AND relrowsecurity AND relforcerowsecurity)
  OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=to_regclass('dream.creation_operations') AND tgname='storage_guard'
    AND tgenabled='O' AND tgfoid=to_regprocedure('dream.storage_guard()'))
  OR NOT EXISTS(SELECT FROM dream.storage_policies WHERE policy_id='t367-local-png')
 THEN RAISE EXCEPTION 'T368_SQL4_CATALOG'; END IF;
END
$check$;

CREATE ROLE t368_create_guard NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE t368_create_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE SCHEMA private_image_create_v1;
COMMENT ON SCHEMA private_image_create_v1 IS 'T368 owned PostgreSQL 17 candidate v1';
REVOKE ALL ON SCHEMA private_image_create_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA private_image_create_v1 TO t368_create_guard,t368_create_runtime;
GRANT USAGE ON SCHEMA dream TO t368_create_guard;
GRANT USAGE ON DOMAIN dream.safe_uint,dream.sha256 TO t368_create_guard;
GRANT EXECUTE ON FUNCTION dream.actor_id(),dream.storage_uuid7(uuid),dream.storage_raw_hash(text,text),
 dream.storage_creation_fingerprint(text,text) TO t368_create_guard;

DO $acl$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assets','storage_objects','storage_verification_operations','storage_verification_receipts','asset_receipt_state',
  'creation_operations','projects','stage_states','project_assets','activity_log'] LOOP
  EXECUTE format('GRANT SELECT ON dream.%I TO t368_create_guard',t);
  EXECUTE format('CREATE POLICY t368_owner_read ON dream.%I FOR SELECT TO t368_create_guard USING(owner_id=(SELECT dream.actor_id()))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['assets','storage_objects','storage_verification_operations','asset_receipt_state'] LOOP
  EXECUTE format('CREATE POLICY t368_owner_lock ON dream.%I FOR UPDATE TO t368_create_guard USING(owner_id=(SELECT dream.actor_id())) WITH CHECK(false)',t);
 END LOOP;
END
$acl$;
GRANT UPDATE(id) ON dream.assets TO t368_create_guard;
GRANT UPDATE(revision) ON dream.storage_objects,dream.storage_verification_operations,dream.asset_receipt_state TO t368_create_guard;
GRANT SELECT,UPDATE(revision) ON dream.storage_policies TO t368_create_guard;
CREATE POLICY t368_policy_read ON dream.storage_policies FOR SELECT TO t368_create_guard USING(policy_id='t367-local-png');
CREATE POLICY t368_policy_lock ON dream.storage_policies FOR UPDATE TO t368_create_guard USING(policy_id='t367-local-png') WITH CHECK(false);
CREATE POLICY t368_ledger_insert ON dream.creation_operations FOR INSERT TO t368_create_guard
 WITH CHECK(owner_id=(SELECT dream.actor_id()) AND status='pending' AND client_json::jsonb->>'candidate'='t368');
CREATE POLICY t368_ledger_update ON dream.creation_operations FOR UPDATE TO t368_create_guard
 USING(owner_id=(SELECT dream.actor_id()) AND status='pending' AND client_json::jsonb->>'candidate'='t368')
 WITH CHECK(owner_id=(SELECT dream.actor_id()) AND status='succeeded' AND client_json::jsonb->>'candidate'='t368');
GRANT INSERT,UPDATE(status,project_id,result_json,result_digest,settled_at,settled_by,settled_registrars,revision)
 ON dream.creation_operations TO t368_create_guard;

-- The share locks follow the same policy -> object -> operation -> asset/state
-- order as the existing SQL4 consumer. Immutable evidence needs no write lock.
CREATE FUNCTION private_image_create_v1.current_png(asset uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE owner uuid:=dream.actor_id(); obj uuid; expected_generation bigint;
BEGIN
 PERFORM 1 FROM dream.storage_policies WHERE policy_id='t367-local-png' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT id,active_generation INTO obj,expected_generation FROM dream.storage_objects
 WHERE owner_id=owner AND registered_asset_id=asset AND reserved_asset_id=asset
  AND lifecycle='registered' AND bucket='t367-private' AND kind='image' AND mime='image/png' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM dream.storage_verification_operations v
  WHERE v.owner_id=owner AND v.object_id=obj AND v.generation=expected_generation FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM dream.assets WHERE owner_id=owner AND id=asset AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM dream.asset_receipt_state WHERE owner_id=owner AND asset_id=asset AND object_id=obj FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN EXISTS(
  SELECT FROM dream.assets a
  JOIN dream.asset_receipt_state s ON (s.owner_id,s.asset_id)=(a.owner_id,a.id)
  JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(s.owner_id,s.object_id,s.asset_id)
  JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
    =(s.owner_id,s.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
  JOIN dream.storage_verification_operations v ON (v.owner_id,v.id,v.object_id,v.generation,v.terminal_receipt_id)
    =(r.owner_id,r.operation_id,r.object_id,r.generation,r.id)
  JOIN dream.storage_policies p ON (p.policy_id,p.epoch,p.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
  WHERE a.owner_id=owner AND a.id=asset AND o.id=obj AND p.policy_id='t367-local-png'
    AND s.status='ready' AND v.status='succeeded' AND a.archived_at IS NULL AND a.is_mock=0
    AND (a.file_path,a.sha256,a.size_bytes,a.mime,a.kind,a.width,a.height)
        =(o.object_key,o.sha256,o.size_bytes,o.mime,o.kind,r.width,r.height)
    AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp()
 );
END
$fn$;

CREATE FUNCTION private_image_create_v1.begin_create(rid uuid, asset uuid, client_raw text, snapshot_raw text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $fn$
DECLARE owner uuid:=dream.actor_id(); existing dream.creation_operations%ROWTYPE; client_hash text; snapshot_hash text;
BEGIN
 IF owner IS NULL OR dream.storage_uuid7(rid) IS DISTINCT FROM true OR dream.storage_uuid7(asset) IS DISTINCT FROM true
  OR octet_length(client_raw)>16384 OR octet_length(snapshot_raw)>131072
  OR (client_raw IS JSON OBJECT WITH UNIQUE KEYS) IS DISTINCT FROM true OR (snapshot_raw IS JSON OBJECT WITH UNIQUE KEYS) IS DISTINCT FROM true
  OR client_raw::jsonb->>'candidate' IS DISTINCT FROM 't368' OR client_raw::jsonb->>'assetId' IS DISTINCT FROM asset::text
 THEN RAISE EXCEPTION 'T368_INVALID_REQUEST'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner::text||'/'||rid::text,368));
 client_hash:=dream.storage_raw_hash('creation-client',client_raw);
 SELECT * INTO existing FROM dream.creation_operations WHERE owner_id=owner AND request_id=rid;
 IF FOUND THEN
  IF existing.client_digest<>client_hash OR existing.client_json IS DISTINCT FROM client_raw THEN
   RETURN jsonb_build_object('status','conflict');
  END IF;
  IF existing.status='succeeded' THEN
   RETURN jsonb_build_object('status','replayed','projectId',existing.project_id);
  END IF;
  RETURN jsonb_build_object('status','unavailable');
 END IF;
 IF NOT private_image_create_v1.current_png(asset) THEN RETURN jsonb_build_object('status','not_verified'); END IF;
 snapshot_hash:=dream.storage_raw_hash('creation-snapshot',snapshot_raw);
 INSERT INTO dream.creation_operations(owner_id,request_id,client_digest,snapshot_digest,fingerprint_version,request_fingerprint,
  client_json,original_snapshot_json,request_json,authorization_until,status,revision,created_at)
 VALUES(owner,rid,client_hash,snapshot_hash,2,dream.storage_creation_fingerprint(client_hash,snapshot_hash),
  client_raw,snapshot_raw,jsonb_build_object('client',client_raw::jsonb,'snapshot',snapshot_raw::jsonb)::text,
  clock_timestamp()+interval '30 seconds','pending',0,clock_timestamp());
 RETURN jsonb_build_object('status','new');
END
$fn$;

CREATE FUNCTION private_image_create_v1.finish_create(rid uuid, project uuid, registrar uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $fn$
DECLARE owner uuid:=dream.actor_id(); entry dream.creation_operations%ROWTYPE; now_at timestamptz; final text; asset uuid;
BEGIN
 SELECT * INTO entry FROM dream.creation_operations WHERE owner_id=owner AND request_id=rid;
 IF NOT FOUND OR entry.status<>'pending' OR entry.client_json::jsonb->>'candidate' IS DISTINCT FROM 't368'
  OR dream.storage_uuid7(project) IS DISTINCT FROM true OR registrar IS NULL OR registrar=owner
 THEN RAISE EXCEPTION 'T368_CREATION_STATE'; END IF;
 asset:=(entry.client_json::jsonb->>'assetId')::uuid;
 IF NOT private_image_create_v1.current_png(asset) OR NOT EXISTS(
    SELECT FROM dream.projects p WHERE p.owner_id=owner AND p.id=project
     AND p.menu_id=entry.client_json::jsonb->>'menuId'
     AND p.template_snapshot_json=entry.original_snapshot_json AND p.inputs_json::jsonb=entry.client_json::jsonb->'inputs')
  OR (SELECT count(*) FROM dream.stage_states s WHERE s.owner_id=owner AND s.project_id=project)<>7
  OR (SELECT count(*) FROM dream.project_assets l WHERE l.owner_id=owner AND l.project_id=project)<>1
  OR NOT EXISTS(SELECT FROM dream.project_assets l WHERE l.owner_id=owner AND l.project_id=project AND l.asset_id=asset AND l.purpose='productAssets')
  OR (SELECT count(*) FROM dream.activity_log a WHERE a.owner_id=owner AND a.project_id=project AND a.action='project.create')<>1
 THEN RAISE EXCEPTION 'T368_CREATION_STATE'; END IF;
 final:=jsonb_build_object('status','succeeded','projectId',project::text)::text;
 now_at:=clock_timestamp();
 UPDATE dream.creation_operations SET status='succeeded',project_id=project,result_json=final,
  result_digest=dream.storage_raw_hash('creation-result',final),settled_at=now_at,settled_by=registrar,
  settled_registrars=ARRAY[registrar],revision=revision+1
 WHERE owner_id=owner AND request_id=rid AND status='pending' AND authorization_until>now_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'T368_CREATION_STATE'; END IF;
END
$fn$;
REVOKE ALL ON FUNCTION private_image_create_v1.current_png(uuid),
 private_image_create_v1.begin_create(uuid,uuid,text,text),private_image_create_v1.finish_create(uuid,uuid,uuid) FROM PUBLIC;
ALTER FUNCTION private_image_create_v1.current_png(uuid) OWNER TO t368_create_guard;
ALTER FUNCTION private_image_create_v1.begin_create(uuid,uuid,text,text) OWNER TO t368_create_guard;
ALTER FUNCTION private_image_create_v1.finish_create(uuid,uuid,uuid) OWNER TO t368_create_guard;
GRANT EXECUTE ON FUNCTION private_image_create_v1.begin_create(uuid,uuid,text,text),private_image_create_v1.finish_create(uuid,uuid,uuid)
 TO t368_create_runtime;
COMMIT;
