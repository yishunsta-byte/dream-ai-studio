-- T312 private extension of the T310/T311 fixtures in an owned PG17 database.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'dream_test_t281' OR current_user <> 't281_bootstrap'
    OR current_setting('server_version_num') <> '170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t312.synthetic',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T312_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;

CREATE SCHEMA rea_t312;
REVOKE ALL ON SCHEMA rea_t312 FROM PUBLIC;
GRANT USAGE ON SCHEMA rea_t312 TO t311_guard,t311_read;
GRANT EXECUTE ON FUNCTION rea_t310.lock_request(text,text,uuid,bigint) TO t311_guard;
GRANT SELECT,INSERT,UPDATE(state,result_revision) ON rea_t310.ledger TO t311_guard;
ALTER TABLE rea_t311.proof ADD COLUMN retired boolean NOT NULL DEFAULT false,
  ADD COLUMN retired_storage_generation bigint CHECK(retired_storage_generation > 0),
  ADD CHECK(retired=(retired_storage_generation IS NOT NULL));

CREATE VIEW rea_t312.storage_snapshot WITH (security_invoker=true) AS
 SELECT o.owner_id,s.asset_id,
    jsonb_build_object('policyId',p.policy_id,'policyEpoch',p.epoch,'policyDigest',p.digest,
      'objectId',o.id,'identityDigest',o.identity_digest,'storageGeneration',o.active_generation,
      'verificationId',s.current_receipt_id,'stateRevision',s.revision,'stateStatus',s.status,
      'eligible',e.evidence) AS snapshot,
    e.evidence AS eligible,e.not_after
 FROM dream.storage_policies p
 CROSS JOIN dream.storage_objects o
 JOIN dream.asset_receipt_state s ON (s.owner_id,s.object_id,s.asset_id)=(o.owner_id,o.id,o.registered_asset_id)
 LEFT JOIN rea_t311.current_evidence e ON (e.owner_id,e.asset_id)=(s.owner_id,s.asset_id)
 WHERE p.policy_id='fixture';
GRANT SELECT ON rea_t312.storage_snapshot TO t311_guard;

CREATE VIEW rea_t312.readable WITH (security_invoker=true) AS
 SELECT r.owner_id,r.project_id,r.asset_id,r.revision,r.source_generation
 FROM rea_t311.readable r JOIN rea_t311.proof p ON (p.owner_id,p.asset_id)=(r.owner_id,r.asset_id)
 WHERE NOT p.retired;
GRANT SELECT ON rea_t312.readable TO t311_read;

CREATE FUNCTION rea_t312.request(request_id uuid,work bigint,operation text,target uuid,expected jsonb,
  expected_revision bigint,reserve_only boolean)
RETURNS TABLE(outcome text,revision bigint,changed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  actor uuid := dream.actor_id();
  store constant text := 'fixture-store';
  generation constant text := 'restore-1';
  request_row rea_t310.ledger%ROWTYPE;
  obj dream.storage_objects%ROWTYPE;
  proof_row rea_t311.proof%ROWTYPE;
  input jsonb;
  current_storage record;
  new_revision bigint;
  next_state text;
BEGIN
  IF actor IS NULL OR target IS NULL OR NOT EXISTS(SELECT 1 FROM dream.assets WHERE owner_id=actor AND id=target)
    OR NOT rea_t310.lock_request(store,generation,request_id,work) THEN
    RETURN QUERY SELECT 'unavailable'::text,NULL::bigint,false;
    RETURN;
  END IF;
  IF operation IS NULL OR operation NOT IN ('issue','revoke') OR jsonb_typeof(expected) IS DISTINCT FROM 'object'
    OR expected_revision IS NULL OR expected_revision<0 OR reserve_only IS NULL THEN
    RAISE EXCEPTION 'T312_INVALID_REQUEST' USING ERRCODE='22023';
  END IF;
  input := jsonb_build_object('owner',actor,'operation',operation,'asset',target,'snapshot',expected,'revision',expected_revision);
  SELECT l.* INTO request_row FROM rea_t310.ledger l
    WHERE (l.store_id,l.restore_generation,l.request_id)=(store,generation,$1);
  IF FOUND THEN
    IF request_row.fingerprint->>'owner' IS DISTINCT FROM actor::text THEN
      RETURN QUERY SELECT 'unavailable'::text,NULL::bigint,false;
      RETURN;
    ELSIF request_row.fingerprint IS DISTINCT FROM input THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::bigint,false;
      RETURN;
    ELSIF request_row.state<>'reserved' OR reserve_only THEN
      RETURN QUERY SELECT request_row.state,request_row.result_revision,false;
      RETURN;
    ELSIF request_row.reservation_xid=pg_current_xact_id() THEN
      RETURN QUERY SELECT 'reservation_required'::text,NULL::bigint,false;
      RETURN;
    END IF;
  ELSIF reserve_only THEN
    INSERT INTO rea_t310.ledger(store_id,restore_generation,request_id,fingerprint,state)
      VALUES(store,generation,$1,input,'reserved');
    RETURN QUERY SELECT 'reserved'::text,NULL::bigint,false;
    RETURN;
  ELSE
    RETURN QUERY SELECT 'reservation_required'::text,NULL::bigint,false;
    RETURN;
  END IF;

  -- T310 holds the control/request locks; acquired SQL4 rows are held to COMMIT.
  PERFORM 1 FROM dream.storage_policies WHERE policy_id='fixture' FOR SHARE;
  SELECT * INTO obj FROM dream.storage_objects WHERE owner_id=actor AND reserved_asset_id=target FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'stale_evidence'::text,NULL::bigint,false; RETURN; END IF;
  PERFORM 1 FROM dream.storage_verification_operations v
    WHERE v.owner_id=actor AND v.object_id=obj.id AND v.generation=obj.active_generation FOR SHARE;
  PERFORM 1 FROM dream.assets WHERE owner_id=actor AND id=target FOR SHARE;
  PERFORM 1 FROM dream.asset_receipt_state WHERE owner_id=actor AND asset_id=target FOR SHARE;
  SELECT s.snapshot,s.eligible,s.not_after INTO current_storage FROM rea_t312.storage_snapshot s
    WHERE (s.owner_id,s.asset_id)=(actor,target);
  IF NOT FOUND OR current_storage.snapshot IS DISTINCT FROM expected
    OR (operation='issue' AND current_storage.eligible IS NULL) THEN
    RETURN QUERY SELECT 'stale_evidence'::text,NULL::bigint,false;
    RETURN;
  END IF;

  SELECT * INTO proof_row FROM rea_t311.proof p WHERE (p.owner_id,p.asset_id)=(actor,target) FOR UPDATE;
  IF coalesce(proof_row.revision,0)<>expected_revision
    OR (operation='revoke' AND (proof_row.revision IS NULL OR proof_row.retired)) THEN
    RETURN QUERY SELECT 'stale_pointer'::text,NULL::bigint,false;
    RETURN;
  END IF;
  IF operation='issue' AND proof_row.revision IS NOT NULL AND
    (proof_row.evidence->>'verificationId'=current_storage.eligible->>'verificationId'
      OR greatest((proof_row.evidence->>'storageGeneration')::bigint,proof_row.retired_storage_generation)
        >= (current_storage.eligible->>'storageGeneration')::bigint) THEN
    RETURN QUERY SELECT 'renewal_requires_new_verification'::text,NULL::bigint,false;
    RETURN;
  END IF;
  IF operation='issue' THEN
    INSERT INTO rea_t311.proof AS p(owner_id,asset_id,revision,store_id,restore_generation,evidence,source_generation,not_after)
      VALUES(actor,target,1,store,generation,current_storage.eligible,gen_random_uuid(),current_storage.not_after)
      ON CONFLICT(owner_id,asset_id) DO UPDATE SET revision=p.revision+1,evidence=excluded.evidence,
        store_id=excluded.store_id,restore_generation=excluded.restore_generation,source_generation=excluded.source_generation,
        not_after=excluded.not_after,retired=false,retired_storage_generation=NULL
      WHERE p.revision=expected_revision RETURNING p.revision INTO new_revision;
    next_state := 'issued';
  ELSE
    UPDATE rea_t311.proof p SET revision=p.revision+1,retired=true,
      retired_storage_generation=(current_storage.snapshot->>'storageGeneration')::bigint
      WHERE (p.owner_id,p.asset_id,p.revision)=(actor,target,expected_revision) RETURNING p.revision INTO new_revision;
    next_state := 'revoked';
  END IF;
  IF new_revision IS NULL THEN
    RETURN QUERY SELECT 'stale_pointer'::text,NULL::bigint,false;
    RETURN;
  END IF;
  UPDATE rea_t310.ledger l SET state=next_state,result_revision=new_revision
    WHERE (l.store_id,l.restore_generation,l.request_id)=(store,generation,$1) AND l.state='reserved';
  IF NOT FOUND THEN RAISE EXCEPTION 'T312_LEDGER_CHANGED'; END IF;
  RETURN QUERY SELECT next_state,new_revision,true;
END $$;

CREATE FUNCTION rea_t312.observe(request_id uuid)
RETURNS TABLE(state text,revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT l.state,l.result_revision FROM rea_t310.ledger l
  WHERE (l.store_id,l.restore_generation,l.request_id)=('fixture-store','restore-1',$1)
    AND l.fingerprint->>'owner'=dream.actor_id()::text
$$;
ALTER FUNCTION rea_t312.request(uuid,bigint,text,uuid,jsonb,bigint,boolean) OWNER TO t311_guard;
ALTER FUNCTION rea_t312.observe(uuid) OWNER TO t311_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rea_t312 FROM PUBLIC;
COMMIT;
