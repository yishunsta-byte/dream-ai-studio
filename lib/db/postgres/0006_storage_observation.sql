-- Storage observation v1 binding: P2-MANAGED-ASSET-VERIFIER-OBSERVATION-DB. Local source only.
-- Not listed in any migration manifest; no runner, descriptor or runtime activation is supplied.
-- Execution requires a separately approved migration action by the dream schema owner after 0004.
-- Only NEW receipt rows are checked: existing receipts and runs (including pre-observation '{}' runs)
-- are append-only history and are never re-validated, so published 0001..0005 rows stay readable.
BEGIN;

DO $preflight$
DECLARE m oid;
BEGIN
 SELECT oid INTO m FROM pg_catalog.pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls;
 IF m IS NULL
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='dream' AND nspowner=m)
   OR pg_catalog.to_regclass('dream.storage_verification_receipts') IS NULL
   OR pg_catalog.to_regclass('dream.storage_verification_runs') IS NULL
   OR pg_catalog.to_regprocedure('dream.storage_guard()') IS NULL
   OR pg_catalog.to_regprocedure('dream.storage_observation_guard()') IS NOT NULL
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='storage_observation' AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'STORAGE_OBSERVATION_PREFLIGHT';
 END IF;
END $preflight$;

-- The receipt's run must carry the verifier's observation v1 (lib/storage/uploads/observation.ts) and it must
-- state exactly what the receipt and the registered object state: same operation kind, source, bytes, format,
-- media, published copy (initial only) and tool versions, recorded by the receipt's verifier no later than it.
CREATE FUNCTION dream.storage_observation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,dream AS $$
DECLARE r_run dream.storage_verification_runs%ROWTYPE; r_obj dream.storage_objects%ROWTYPE;
 r_op dream.storage_verification_operations%ROWTYPE; o jsonb; observed_bytes jsonb;
BEGIN
 SELECT * INTO r_run FROM dream.storage_verification_runs WHERE owner_id=NEW.owner_id AND id=NEW.run_id;
 SELECT * INTO r_obj FROM dream.storage_objects WHERE owner_id=NEW.owner_id AND id=NEW.object_id;
 SELECT * INTO r_op FROM dream.storage_verification_operations WHERE owner_id=NEW.owner_id AND id=NEW.operation_id;
 IF r_run.id IS NULL OR r_obj.id IS NULL OR r_op.id IS NULL THEN
  RAISE EXCEPTION 'receipt observation target unavailable' USING ERRCODE='23514'; END IF;
 o:=r_run.observed_json::jsonb;
 observed_bytes:=jsonb_build_object('sha256',r_obj.sha256,'sizeBytes',r_obj.size_bytes);
 IF jsonb_typeof(o)<>'object'
   OR (SELECT array_agg(k COLLATE "C" ORDER BY k COLLATE "C") FROM jsonb_object_keys(o) AS k)
     IS DISTINCT FROM ARRAY['bytes','format','kind','media','published','source','tools','v']::text[]
   OR o->'v' IS DISTINCT FROM '1'::jsonb
   OR o->'kind' IS DISTINCT FROM to_jsonb(r_op.kind)
   OR o->'source' IS DISTINCT FROM jsonb_build_object('bucket',NEW.source_bucket,'key',NEW.source_key,'providerVersion',NEW.source_version)
   OR o->'bytes' IS DISTINCT FROM observed_bytes
   OR o->'format' IS DISTINCT FROM jsonb_build_object('mime',r_obj.mime,'kind',r_obj.kind)
   OR o->'media' IS DISTINCT FROM jsonb_build_object('width',NEW.width,'height',NEW.height,'durationMs',NEW.duration_ms)
   OR o->'published' IS DISTINCT FROM (CASE WHEN r_op.kind='initial' THEN observed_bytes ELSE 'null'::jsonb END)
   OR o->'tools' IS DISTINCT FROM jsonb_build_object('verifierVersion',NEW.verifier_version,'toolVersion',NEW.tool_version)
   OR r_run.worker_id IS DISTINCT FROM NEW.verifier_id
   OR r_run.recorded_at>NEW.verified_at THEN
  RAISE EXCEPTION 'receipt observation differs' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Name sorts after storage_guard, so the existing receipt checks still run first and keep their errors.
CREATE TRIGGER storage_observation BEFORE INSERT ON dream.storage_verification_receipts
 FOR EACH ROW EXECUTE FUNCTION dream.storage_observation_guard();
REVOKE ALL ON FUNCTION dream.storage_observation_guard() FROM PUBLIC,dream_api,dream_worker;
-- No role, grant, policy, SECURITY DEFINER, manifest entry or change to existing objects is created.
COMMIT;
