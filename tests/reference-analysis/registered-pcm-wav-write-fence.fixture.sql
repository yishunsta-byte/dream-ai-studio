BEGIN;
SET LOCAL search_path=pg_catalog;
DO $setup$
BEGIN
  IF current_database() <> 'dream_test_t367'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num')::integer <> 170012
    OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
    OR to_regclass('pcm_issuance.control') IS NULL THEN
    RAISE EXCEPTION 'PCM_WRITE_FENCE_FIXTURE_TARGET';
  END IF;
END
$setup$;
CREATE ROLE pcm_fence_installer NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE pcm_fence_observer NOLOGIN NOSUPERUSER NOBYPASSRLS;
SET LOCAL ROLE pcm_issuance_guard;

-- The generation and retired work number remain on the closed row for proof and recovery.
ALTER TABLE pcm_issuance.control ADD COLUMN close_id uuid;

CREATE FUNCTION pcm_issuance.data_request(gen text,work integer,req uuid,operation text,project uuid,asset uuid,
  expected jsonb,expected_revision integer,reserve_only boolean)
RETURNS TABLE(outcome text,revision integer,changed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE observed pcm_issuance.control%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'PCM_WRITE_FENCE_ISOLATION' USING ERRCODE='22023';
  END IF;
  SELECT * INTO observed FROM pcm_issuance.control WHERE singleton FOR SHARE;
  IF NOT FOUND OR observed.close_id IS NOT NULL OR observed.restore_gen IS DISTINCT FROM gen
    OR observed.work_number IS DISTINCT FROM work THEN
    RETURN QUERY SELECT 'unavailable'::text,NULL::integer,false; RETURN;
  END IF;
  RETURN QUERY SELECT r.outcome,r.revision,r.changed
    FROM pcm_issuance.request(req,work,operation,project,asset,expected,expected_revision,reserve_only) r;
END $$;

CREATE FUNCTION pcm_issuance.fence_writes(transition_id uuid,target_db text,target_oid text,gen text,work integer)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE observed pcm_issuance.control%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'PCM_WRITE_FENCE_ISOLATION' USING ERRCODE='22023';
  END IF;
  IF transition_id IS NULL OR current_database()::text IS DISTINCT FROM target_db OR
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM target_oid THEN
    RETURN 'conflict';
  END IF;
  SELECT * INTO observed FROM pcm_issuance.control WHERE singleton FOR UPDATE;
  IF NOT FOUND OR observed.restore_gen IS DISTINCT FROM gen OR observed.work_number IS DISTINCT FROM work THEN
    RETURN 'conflict';
  END IF;
  IF observed.close_id = transition_id THEN RETURN 'already_fenced'; END IF;
  IF observed.close_id IS NOT NULL THEN RETURN 'conflict'; END IF;
  UPDATE pcm_issuance.control SET close_id=transition_id WHERE singleton;
  RETURN 'fenced';
END $$;

CREATE FUNCTION pcm_issuance.fence_proof()
RETURNS TABLE(database text,oid text,generation text,work integer,transition uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT current_database()::text,d.oid::text,c.restore_gen,c.work_number,c.close_id
  FROM pg_database d CROSS JOIN pcm_issuance.control c
  WHERE d.datname=current_database() AND c.singleton AND c.close_id IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION pcm_issuance.request(uuid,integer,text,uuid,uuid,jsonb,integer,boolean) FROM pcm_issuance_issuer;
REVOKE ALL ON FUNCTION pcm_issuance.data_request(text,integer,uuid,text,uuid,uuid,jsonb,integer,boolean),
  pcm_issuance.fence_writes(uuid,text,text,text,integer),pcm_issuance.fence_proof() FROM PUBLIC;
GRANT USAGE ON SCHEMA pcm_issuance TO pcm_fence_installer,pcm_fence_observer;
GRANT EXECUTE ON FUNCTION pcm_issuance.data_request(text,integer,uuid,text,uuid,uuid,jsonb,integer,boolean) TO pcm_issuance_issuer;
GRANT EXECUTE ON FUNCTION pcm_issuance.fence_writes(uuid,text,text,text,integer) TO pcm_fence_installer;
GRANT EXECUTE ON FUNCTION pcm_issuance.fence_proof() TO pcm_fence_observer;
COMMIT;
