-- T310 owned PG17 fixture. Do not install as a product migration.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'dream_test_t281' OR current_user <> 't281_bootstrap'
    OR current_setting('server_version_num') <> '170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t310.synthetic', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T310_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;

CREATE ROLE t310_guard NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE SCHEMA rea_t310;
REVOKE ALL ON SCHEMA rea_t310 FROM PUBLIC;
GRANT USAGE ON SCHEMA rea_t310 TO t310_guard;

CREATE TABLE rea_t310.control (
  store_id text PRIMARY KEY, restore_generation text NOT NULL, work_number bigint NOT NULL CHECK(work_number > 0),
  active boolean NOT NULL
);
INSERT INTO rea_t310.control VALUES('fixture-store','restore-1',1,true);

-- Copy the known verification identity from the T307 registration fixture. The
-- probe holds it stable and exercises the request ledger and pointer, not SQL4 writers.
CREATE TABLE rea_t310.source (
  owner_id uuid NOT NULL, asset_id uuid NOT NULL, object_id uuid NOT NULL, identity_digest text NOT NULL,
  verification_id uuid NOT NULL, storage_generation bigint NOT NULL CHECK(storage_generation > 0),
  policy_id text NOT NULL, policy_epoch bigint NOT NULL, policy_digest text NOT NULL, not_after timestamptz NOT NULL,
  PRIMARY KEY(owner_id,asset_id)
);
INSERT INTO rea_t310.source
  SELECT w.owner_id,w.asset_id,w.object_id,w.identity_digest,r.id,r.generation,r.policy_id,r.policy_epoch,r.policy_digest,r.not_after
  FROM rea_t307.asset_witness w JOIN dream.storage_verification_receipts r
    ON (r.owner_id,r.id,r.object_id,r.asset_id) = (w.owner_id,w.receipt_id,w.object_id,w.asset_id);

CREATE TABLE rea_t310.pointer (
  owner_id uuid NOT NULL, asset_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision >= 0),
  state text NOT NULL CHECK(state IN ('empty','issued','revoked')), source_generation text,
  PRIMARY KEY(owner_id,asset_id), FOREIGN KEY(owner_id,asset_id) REFERENCES rea_t310.source,
  CHECK((state='issued')=(source_generation IS NOT NULL))
);
INSERT INTO rea_t310.pointer SELECT owner_id,asset_id,0,'empty',NULL FROM rea_t310.source;

CREATE TABLE rea_t310.ledger (
  store_id text NOT NULL REFERENCES rea_t310.control,
  restore_generation text NOT NULL, request_id uuid NOT NULL,
  fingerprint jsonb NOT NULL, state text NOT NULL CHECK(state IN ('reserved','issued','revoked')),
  result_revision bigint CHECK(result_revision > 0), reservation_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  CHECK((state='reserved')=(result_revision IS NULL)),
  PRIMARY KEY(store_id,restore_generation,request_id)
);

ALTER TABLE rea_t310.control OWNER TO t310_guard;
ALTER TABLE rea_t310.source OWNER TO t310_guard;
ALTER TABLE rea_t310.pointer OWNER TO t310_guard;
ALTER TABLE rea_t310.ledger OWNER TO t310_guard;

CREATE FUNCTION rea_t310.lock_request(store text, generation text, request uuid, work bigint) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE ctl rea_t310.control%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'T310_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
  END IF;
  SELECT * INTO ctl FROM rea_t310.control c WHERE c.store_id=store FOR SHARE;
  IF NOT FOUND OR NOT ctl.active OR ctl.restore_generation IS DISTINCT FROM generation
    OR ctl.work_number IS DISTINCT FROM work OR request IS NULL THEN
    RETURN false;
  END IF;
  -- Hash collisions only add unrelated waiting. The ledger compares exact keys.
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(store,generation,request)::text,310));
  RETURN true;
END $$;

CREATE FUNCTION rea_t310.submit(store text, generation text, request uuid, work bigint, operation text,
  tenant uuid, asset uuid, expected_revision bigint, verification uuid, reserve_only boolean)
RETURNS TABLE(outcome text, revision bigint, changed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  request_row rea_t310.ledger%ROWTYPE;
  source_row rea_t310.source%ROWTYPE;
  input jsonb;
  next_state text;
  new_revision bigint;
BEGIN
  IF NOT rea_t310.lock_request(store,generation,request,work) THEN
    RETURN QUERY SELECT 'inactive'::text,NULL::bigint,false;
    RETURN;
  END IF;
  IF operation IS NULL OR operation NOT IN ('issue','revoke') OR tenant IS NULL OR asset IS NULL
    OR expected_revision IS NULL OR expected_revision < 0 OR verification IS NULL OR reserve_only IS NULL THEN
    RAISE EXCEPTION 'T310_INVALID_REQUEST' USING ERRCODE='22023';
  END IF;
  input := jsonb_build_array(operation,tenant,asset,expected_revision,verification);
  SELECT l.* INTO request_row FROM rea_t310.ledger l
    WHERE (l.store_id,l.restore_generation,l.request_id)=(store,generation,request);
  IF FOUND THEN
    IF request_row.fingerprint IS DISTINCT FROM input THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::bigint,false;
      RETURN;
    END IF;
    IF request_row.state <> 'reserved' OR reserve_only THEN
      RETURN QUERY SELECT request_row.state,request_row.result_revision,false;
      RETURN;
    END IF;
    IF request_row.reservation_xid=pg_current_xact_id() THEN
      RETURN QUERY SELECT 'reservation_required'::text,NULL::bigint,false;
      RETURN;
    END IF;
  ELSIF reserve_only THEN
    INSERT INTO rea_t310.ledger(store_id,restore_generation,request_id,fingerprint,state)
      VALUES(store,generation,request,input,'reserved');
    RETURN QUERY SELECT 'reserved'::text,NULL::bigint,false;
    RETURN;
  ELSE
    RETURN QUERY SELECT 'reservation_required'::text,NULL::bigint,false;
    RETURN;
  END IF;

  SELECT * INTO source_row FROM rea_t310.source s WHERE (s.owner_id,s.asset_id)=(tenant,asset);
  IF NOT FOUND OR source_row.verification_id IS DISTINCT FROM verification
    OR (operation='issue' AND source_row.not_after<=clock_timestamp()) THEN
    RETURN QUERY SELECT 'no_evidence'::text,NULL::bigint,false;
    RETURN;
  END IF;
  next_state := CASE operation WHEN 'issue' THEN 'issued' ELSE 'revoked' END;
  UPDATE rea_t310.pointer p SET revision=p.revision+1, state=next_state,
    source_generation=CASE next_state WHEN 'issued' THEN gen_random_uuid()::text ELSE NULL END
    WHERE (p.owner_id,p.asset_id,p.revision)=(tenant,asset,expected_revision)
    RETURNING p.revision INTO new_revision;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale_pointer'::text,NULL::bigint,false;
    RETURN;
  END IF;
  UPDATE rea_t310.ledger l SET state=next_state,result_revision=new_revision
    WHERE (l.store_id,l.restore_generation,l.request_id)=(store,generation,request) AND l.state='reserved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T310_LEDGER_CHANGED';
  END IF;
  RETURN QUERY SELECT next_state,new_revision,true;
END $$;

-- A committed-state observation deliberately does not acquire the request lock.
CREATE FUNCTION rea_t310.observe(store text, generation text, request uuid)
RETURNS TABLE(state text, revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT l.state,l.result_revision FROM rea_t310.ledger l
    WHERE (l.store_id,l.restore_generation,l.request_id)=($1,$2,$3)
$$;

-- The test connection opts in to a deferred constraint trigger, allowing a
-- controller holding this advisory lock to stop the original session inside COMMIT.
CREATE FUNCTION rea_t310.pause_commit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF current_setting('rea_t310.pause_commit',true)='on' THEN
    PERFORM pg_advisory_xact_lock(310001,17);
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER t310_deferred_commit AFTER INSERT OR UPDATE ON rea_t310.ledger
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rea_t310.pause_commit();

ALTER FUNCTION rea_t310.lock_request(text,text,uuid,bigint) OWNER TO t310_guard;
ALTER FUNCTION rea_t310.submit(text,text,uuid,bigint,text,uuid,uuid,bigint,uuid,boolean) OWNER TO t310_guard;
ALTER FUNCTION rea_t310.observe(text,text,uuid) OWNER TO t310_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rea_t310 FROM PUBLIC;
COMMIT;
