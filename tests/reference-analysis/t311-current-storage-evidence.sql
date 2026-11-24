-- T311 owned PG17 fixture only.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'dream_test_t281' OR current_user <> 't281_bootstrap'
    OR current_setting('server_version_num') <> '170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t311.synthetic',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T311_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;

CREATE ROLE t311_guard NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE t311_read NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE SCHEMA rea_t311;
REVOKE ALL ON SCHEMA rea_t311 FROM PUBLIC;
GRANT USAGE ON SCHEMA dream,rea_t311 TO t311_guard,t311_read;
GRANT USAGE ON SCHEMA rea_t310 TO t311_guard;
GRANT USAGE ON SCHEMA rea_t281,rea_t307 TO t311_read;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO t311_guard,t311_read;
GRANT SELECT,UPDATE(work_number) ON rea_t310.control TO t311_guard;
GRANT SELECT ON rea_t307.restore_witness TO t311_read;

INSERT INTO dream.storage_policies(policy_id,epoch,digest,revision,updated_at)
  SELECT policy_id,epoch,digest,0,now() FROM dream.storage_policy_versions WHERE policy_id='fixture' AND epoch=1;

DO $$
DECLARE relation regclass;
BEGIN
  FOREACH relation IN ARRAY ARRAY['dream.storage_objects','dream.storage_verification_operations',
    'dream.asset_receipt_state','dream.assets','dream.storage_verification_receipts']::regclass[] LOOP
    EXECUTE format('GRANT SELECT ON %s TO t311_guard,t311_read',relation);
    EXECUTE format('CREATE POLICY t311_actor_read ON %s FOR SELECT TO t311_guard,t311_read
      USING (owner_id=(SELECT dream.actor_id()))',relation);
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['dream.projects','dream.project_assets','rea_t281.owner_state','rea_t281.scope_state']::regclass[] LOOP
    EXECUTE format('GRANT SELECT ON %s TO t311_read',relation);
    EXECUTE format('CREATE POLICY t311_actor_read ON %s FOR SELECT TO t311_read
      USING (owner_id=(SELECT dream.actor_id()))',relation);
  END LOOP;
END $$;

-- A row lock needs UPDATE privilege on a column and the matching RLS policy.
-- WITH CHECK(false) bars actual writes by the NOLOGIN function owner.
GRANT UPDATE(revision) ON dream.storage_objects,dream.storage_verification_operations,dream.asset_receipt_state TO t311_guard;
GRANT UPDATE(id) ON dream.assets TO t311_guard;
CREATE POLICY t311_object_lock ON dream.storage_objects FOR UPDATE TO t311_guard
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK(false);
CREATE POLICY t311_operation_lock ON dream.storage_verification_operations FOR UPDATE TO t311_guard
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK(false);
CREATE POLICY t311_state_lock ON dream.asset_receipt_state FOR UPDATE TO t311_guard
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK(false);
CREATE POLICY t311_asset_lock ON dream.assets FOR UPDATE TO t311_guard
  USING (owner_id=(SELECT dream.actor_id())) WITH CHECK(false);
GRANT SELECT ON dream.storage_policies TO t311_guard,t311_read;
GRANT UPDATE(revision) ON dream.storage_policies TO t311_guard;
CREATE POLICY t311_policy_read ON dream.storage_policies FOR SELECT TO t311_guard,t311_read USING(policy_id='fixture');
CREATE POLICY t311_policy_lock ON dream.storage_policies FOR UPDATE TO t311_guard
  USING(policy_id='fixture') WITH CHECK(false);

CREATE TABLE rea_t311.proof (
  owner_id uuid NOT NULL, asset_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision > 0),
  store_id text NOT NULL, restore_generation text NOT NULL, evidence jsonb NOT NULL,
  source_generation uuid NOT NULL, not_after timestamptz NOT NULL, PRIMARY KEY(owner_id,asset_id)
);
ALTER TABLE rea_t311.proof ENABLE ROW LEVEL SECURITY;
ALTER TABLE rea_t311.proof FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON rea_t311.proof TO t311_guard;
GRANT SELECT ON rea_t311.proof TO t311_read;
CREATE POLICY t311_issue_proof ON rea_t311.proof TO t311_guard
  USING(owner_id=(SELECT dream.actor_id())) WITH CHECK(owner_id=(SELECT dream.actor_id()));
CREATE POLICY t311_read_proof ON rea_t311.proof FOR SELECT TO t311_read USING(owner_id=(SELECT dream.actor_id()));

CREATE VIEW rea_t311.current_evidence WITH (security_invoker=true) AS
 SELECT a.owner_id,a.id AS asset_id,r.not_after,
    jsonb_build_object('policyId',p.policy_id,'policyEpoch',p.epoch,'policyDigest',p.digest,'objectId',o.id,
      'identityDigest',o.identity_digest,'verificationId',r.id,'storageGeneration',r.generation) AS evidence
 FROM dream.assets a
 JOIN dream.asset_receipt_state s ON (s.owner_id,s.asset_id)=(a.owner_id,a.id)
 JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(a.owner_id,s.object_id,a.id)
 JOIN dream.storage_verification_receipts r
    ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
      =(a.owner_id,s.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
 JOIN dream.storage_verification_operations v
    ON (v.owner_id,v.id,v.object_id,v.generation,v.terminal_receipt_id)=(a.owner_id,r.operation_id,o.id,r.generation,r.id)
 JOIN dream.storage_policies p ON (p.policy_id,p.epoch,p.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
 WHERE p.policy_id='fixture' AND v.status='succeeded' AND s.status='ready' AND o.lifecycle='registered'
   AND a.archived_at IS NULL AND a.is_mock=0 AND a.kind IN ('image','video') AND o.bucket='private-test'
   AND (a.file_path,a.sha256,a.size_bytes,a.mime,a.kind)=(o.object_key,o.sha256,o.size_bytes,o.mime,o.kind)
   AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp();
GRANT SELECT ON rea_t311.current_evidence TO t311_guard,t311_read;

CREATE VIEW rea_t311.readable WITH (security_invoker=true) AS
 SELECT c.owner_id,l.project_id,c.asset_id,w.revision,w.evidence,w.source_generation
 FROM rea_t311.current_evidence c
 JOIN rea_t311.proof w ON (w.owner_id,w.asset_id,w.evidence)=(c.owner_id,c.asset_id,c.evidence)
 JOIN rea_t307.restore_witness e ON e.singleton AND (e.store_id,e.restore_generation)=(w.store_id,w.restore_generation)
 JOIN dream.project_assets l ON (l.owner_id,l.asset_id)=(c.owner_id,c.asset_id) AND l.purpose='rea-reference'
 JOIN dream.projects p ON (p.owner_id,p.id)=(l.owner_id,l.project_id) AND p.archived_at IS NULL
 JOIN rea_t281.owner_state u ON u.owner_id=l.owner_id AND u.enabled AND u.generation>0
 JOIN rea_t281.scope_state g ON (g.owner_id,g.project_id,g.asset_id)=(l.owner_id,l.project_id,l.asset_id)
   AND g.active AND g.permission_generation>0
 WHERE LEAST(e.not_after,w.not_after)>clock_timestamp();
GRANT SELECT ON rea_t311.readable TO t311_read;

CREATE FUNCTION rea_t311.issue(target uuid, expected jsonb, expected_revision bigint, work bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  actor uuid := dream.actor_id();
  ctl rea_t310.control%ROWTYPE;
  obj dream.storage_objects%ROWTYPE;
  current_tuple record;
  new_revision bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'T311_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
  END IF;
  IF actor IS NULL OR expected_revision IS NULL OR expected_revision<0 THEN RETURN 'unavailable'; END IF;
  SELECT * INTO ctl FROM rea_t310.control WHERE store_id='fixture-store' FOR SHARE;
  IF NOT FOUND OR NOT ctl.active OR ctl.restore_generation<>'restore-1'
    OR ctl.work_number IS DISTINCT FROM work THEN RETURN 'unavailable'; END IF;

  PERFORM 1 FROM dream.storage_policies WHERE policy_id='fixture' FOR SHARE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  SELECT * INTO obj FROM dream.storage_objects
    WHERE owner_id=actor AND reserved_asset_id=target FOR SHARE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  PERFORM 1 FROM dream.storage_verification_operations
    WHERE owner_id=actor AND object_id=obj.id AND generation=obj.active_generation FOR SHARE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  PERFORM 1 FROM dream.assets WHERE owner_id=actor AND id=target FOR SHARE;
  PERFORM 1 FROM dream.asset_receipt_state WHERE owner_id=actor AND asset_id=target FOR SHARE;
  SELECT c.evidence,c.not_after INTO current_tuple FROM rea_t311.current_evidence c
    WHERE (c.owner_id,c.asset_id)=(actor,target);
  IF NOT FOUND OR current_tuple.evidence IS DISTINCT FROM expected THEN RETURN 'stale_evidence'; END IF;

  IF expected_revision=0 THEN
    INSERT INTO rea_t311.proof(owner_id,asset_id,revision,store_id,restore_generation,evidence,source_generation,not_after)
      VALUES(actor,target,1,ctl.store_id,ctl.restore_generation,current_tuple.evidence,gen_random_uuid(),current_tuple.not_after)
      ON CONFLICT DO NOTHING RETURNING revision INTO new_revision;
  ELSE
    UPDATE rea_t311.proof p SET revision=p.revision+1,store_id=ctl.store_id,restore_generation=ctl.restore_generation,
      evidence=current_tuple.evidence,source_generation=gen_random_uuid(),not_after=current_tuple.not_after
      WHERE (p.owner_id,p.asset_id,p.revision)=(actor,target,expected_revision) RETURNING revision INTO new_revision;
  END IF;
  IF new_revision IS NULL THEN RETURN 'stale_pointer'; END IF;
  RETURN 'issued';
END $$;
ALTER FUNCTION rea_t311.issue(uuid,jsonb,bigint,bigint) OWNER TO t311_guard;
REVOKE ALL ON FUNCTION rea_t311.issue(uuid,jsonb,bigint,bigint) FROM PUBLIC;

-- These two invoker functions stand in for the bootstrap-only storage writer.
-- They exercise the actual SQL4 checks and triggers, without provisioning a production registrar.
CREATE FUNCTION rea_t311.rotate_policy() RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  previous dream.storage_policies%ROWTYPE;
  next_digest text;
BEGIN
  SELECT * INTO STRICT previous FROM dream.storage_policies WHERE policy_id='fixture' FOR UPDATE;
  next_digest := encode(sha256(convert_to('fixture:' || (previous.epoch+1)::text,'UTF8')),'hex');
  INSERT INTO dream.storage_policy_versions VALUES(previous.policy_id,previous.epoch+1,next_digest,clock_timestamp());
  UPDATE dream.storage_policies SET epoch=previous.epoch+1,digest=next_digest,revision=previous.revision+1,updated_at=clock_timestamp()
    WHERE policy_id=previous.policy_id;
  RETURN previous.epoch+1;
END $$;

CREATE FUNCTION rea_t311.reverify(tenant uuid, target uuid, succeeds boolean) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  pol dream.storage_policies%ROWTYPE;
  obj dream.storage_objects%ROWTYPE;
  st dream.asset_receipt_state%ROWTYPE;
  a dream.assets%ROWTYPE;
  next_generation bigint;
  next_revision bigint;
  op_id uuid;
  run_id uuid;
  receipt_id uuid;
  worker uuid := '10000000-0000-4000-8000-000000000099';
  opened timestamptz := date_trunc('milliseconds',clock_timestamp()) - interval '2 seconds';
  claimed timestamptz := opened + interval '500 milliseconds';
  verified timestamptz := opened + interval '1 second';
  lease timestamptz := opened + interval '2 minutes';
  deadline timestamptz := opened + interval '3 minutes';
  expiry timestamptz := opened + interval '1 hour';
  empty_hash text := encode(sha256(convert_to('{}','UTF8')),'hex');
  terminal text;
  raw_receipt text;
BEGIN
  SELECT * INTO STRICT pol FROM dream.storage_policies WHERE policy_id='fixture' FOR SHARE;
  SELECT * INTO STRICT obj FROM dream.storage_objects
    WHERE owner_id=tenant AND registered_asset_id=target FOR UPDATE;
  -- The object barrier is held before reading state to allocate the next operation.
  SELECT * INTO STRICT st FROM dream.asset_receipt_state WHERE owner_id=tenant AND asset_id=target;
  next_generation := obj.active_generation+1;
  next_revision := st.revision+1;
  op_id := ('40000000-0000-7000-8000-' || lpad(next_generation::text,4,'0') || right(target::text,8))::uuid;
  run_id := ('50000000-0000-7000-8000-' || lpad(next_generation::text,4,'0') || right(target::text,8))::uuid;
  receipt_id := ('60000000-0000-7000-8000-' || lpad(next_generation::text,4,'0') || right(target::text,8))::uuid;
  INSERT INTO dream.storage_verification_operations(owner_id,id,object_id,kind,generation,
    request_fingerprint,request_json,request_raw_sha,policy_id,policy_epoch,policy_digest,authorization_until,
    expected_state_revision,fence,status,revision,created_at)
    VALUES(tenant,op_id,obj.id,'reverify',next_generation,empty_hash,'{}',empty_hash,pol.policy_id,pol.epoch,pol.digest,
      deadline,st.revision,0,'pending',0,opened);
  UPDATE dream.storage_verification_operations SET status='running',revision=1,fence=1,worker_id=worker,
    lease_until=lease,claimed_at=claimed,claim_verifiers=ARRAY[worker] WHERE id=op_id;
  SELECT * INTO STRICT a FROM dream.assets WHERE owner_id=tenant AND id=target FOR SHARE;
  SELECT * INTO STRICT st FROM dream.asset_receipt_state WHERE owner_id=tenant AND asset_id=target FOR UPDATE;
  UPDATE dream.storage_objects SET active_generation=next_generation,revision=obj.revision+1 WHERE id=obj.id;
  INSERT INTO dream.storage_verification_runs VALUES(tenant,run_id,obj.id,op_id,next_generation,1,worker,
    CASE WHEN succeeds THEN 'succeeded' ELSE 'failed' END,'{}',empty_hash,verified);

  IF succeeds THEN
    raw_receipt := jsonb_build_object('id',receipt_id::text,'objectId',obj.id::text,'identity',obj.identity_json::jsonb,
      'operationId',op_id::text,'generation',next_generation,'fence',1,'policyEpoch',pol.epoch,'policyDigest',pol.digest,
      'source',jsonb_build_object('bucket',obj.bucket,'key',obj.object_key,'providerVersion',obj.provider_version),
      'media',jsonb_build_object('width',a.width,'height',a.height,'durationMs',a.duration_ms),
      'verifiedAt',floor(extract(epoch FROM verified)*1000)::bigint,'notAfter',floor(extract(epoch FROM expiry)*1000)::bigint,
      'verifierId',worker::text,'verifierVersion','fixture','toolVersion','fixture')::text;
    INSERT INTO dream.storage_verification_receipts(owner_id,id,object_id,asset_id,operation_id,run_id,generation,fence,
      identity_digest,policy_id,policy_epoch,policy_digest,source_bucket,source_key,source_version,width,height,duration_ms,
      verifier_id,verifier_version,tool_version,verified_at,not_after,receipt_json,receipt_digest)
      VALUES(tenant,receipt_id,obj.id,target,op_id,run_id,next_generation,1,obj.identity_digest,pol.policy_id,pol.epoch,pol.digest,
        obj.bucket,obj.object_key,obj.provider_version,a.width,a.height,a.duration_ms,worker,'fixture','fixture',verified,expiry,
        raw_receipt,dream.storage_raw_hash('verification-receipt',raw_receipt));
    terminal := jsonb_build_object('status','succeeded','receiptId',receipt_id::text)::text;
    UPDATE dream.storage_verification_operations SET status='succeeded',revision=2,completed_at=verified,
      completed_state_revision=next_revision,completed_aggregate_revision=obj.revision+1,terminal_receipt_id=receipt_id,
      terminal_json=terminal,terminal_digest=dream.storage_raw_hash('verification-terminal',terminal) WHERE id=op_id;
    UPDATE dream.asset_receipt_state SET status='ready',current_receipt_id=receipt_id,revision=next_revision,
      updated_at=verified,reason_code=NULL WHERE owner_id=tenant AND asset_id=target;
  ELSE
    terminal := '{"status":"failed","code":"HASH_MISMATCH"}';
    UPDATE dream.storage_verification_operations SET status='failed',revision=2,completed_at=verified,
      completed_state_revision=next_revision,completed_aggregate_revision=obj.revision+1,failure_code='HASH_MISMATCH',
      terminal_json=terminal,terminal_digest=dream.storage_raw_hash('verification-terminal',terminal) WHERE id=op_id;
    UPDATE dream.asset_receipt_state SET status='revoked',revision=next_revision,updated_at=verified,reason_code='HASH_MISMATCH',
      revocation_history_json=(st.revocation_history_json::jsonb || jsonb_build_array(jsonb_build_object(
        'kind','verification_failure','revision',next_revision,'at',floor(extract(epoch FROM verified)*1000)::bigint,
        'principalId',worker::text,'authorizers',jsonb_build_array(worker::text),'operationId',op_id::text)))::text
      WHERE owner_id=tenant AND asset_id=target;
  END IF;
  RETURN next_generation;
END $$;
REVOKE ALL ON FUNCTION rea_t311.rotate_policy(),rea_t311.reverify(uuid,uuid,boolean) FROM PUBLIC;
COMMIT;
