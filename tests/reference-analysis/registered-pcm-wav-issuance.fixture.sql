BEGIN;
SET LOCAL search_path = pg_catalog;
DO $setup$
BEGIN
  IF current_database() <> 'dream_test_t367' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR current_setting('dream.t367_owned', true) IS DISTINCT FROM 'on'
    OR to_regclass('pcm_fixture.current_wav') IS NULL THEN
    RAISE EXCEPTION 'PCM_ISSUANCE_FIXTURE_TARGET';
  END IF;
END
$setup$;

CREATE ROLE pcm_issuance_guard NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE pcm_issuance_issuer NOLOGIN;
CREATE ROLE pcm_issuance_reader NOLOGIN;
GRANT pcm_fixture_reader TO pcm_issuance_guard WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
CREATE SCHEMA pcm_issuance AUTHORIZATION pcm_issuance_guard;
SET LOCAL ROLE pcm_issuance_guard;
REVOKE ALL ON SCHEMA pcm_issuance FROM PUBLIC;

CREATE TABLE pcm_issuance.control (
  singleton boolean PRIMARY KEY CHECK (singleton),
  restore_gen text NOT NULL,
  work_number integer NOT NULL CHECK (work_number > 0)
);
INSERT INTO pcm_issuance.control VALUES (true,'restore-1',1);
CREATE TABLE pcm_issuance.pointer (
  restore_gen text NOT NULL,
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('issued','revoked')),
  proof jsonb NOT NULL,
  PRIMARY KEY (restore_gen,owner_id,project_id,asset_id)
);
CREATE TABLE pcm_issuance.requests (
  restore_gen text NOT NULL,
  request_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  fingerprint jsonb NOT NULL,
  reservation_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  state text NOT NULL CHECK (state IN ('reserved','issued','revoked')),
  result_revision integer,
  CHECK ((state = 'reserved') = (result_revision IS NULL)),
  PRIMARY KEY (restore_gen,request_id)
);

-- The fixture controller uses this same lock before changing generation or approval.
CREATE FUNCTION pcm_issuance.scope_lock(owner_id uuid,project_id uuid,asset_id uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(concat_ws('/', $1,$2,$3), 811))
$$;

CREATE VIEW pcm_issuance.current_proof WITH (security_invoker = true) AS
SELECT w.owner_id,w.project_id,w.asset_id,f.content,
  jsonb_build_object('registrationGeneration',w.registration_generation,
    'approvalGeneration',w.approval_generation,'sha256',w.sha256,'sizeBytes',w.size_bytes) AS proof
FROM pcm_fixture.current_wav w JOIN local_wav.files f USING (owner_id,asset_id)
WHERE w.owner_id=dream.actor_id();

CREATE FUNCTION pcm_issuance.request(req uuid,work integer,operation text,project uuid,asset uuid,
  expected jsonb,expected_revision integer,reserve_only boolean)
RETURNS TABLE(outcome text,revision integer,changed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  owner uuid := dream.actor_id();
  control_row pcm_issuance.control%ROWTYPE;
  request_row pcm_issuance.requests%ROWTYPE;
  pointer_row pcm_issuance.pointer%ROWTYPE;
  input jsonb;
  actual jsonb;
  next_revision integer;
  next_state text;
BEGIN
  IF req IS NULL OR project IS NULL OR asset IS NULL OR reserve_only IS NULL OR
      operation IS NULL OR operation NOT IN ('issue','revoke') OR jsonb_typeof(expected) IS DISTINCT FROM 'object' OR
      expected_revision IS NULL OR expected_revision < 0 OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'PCM_ISSUANCE_INVALID_REQUEST' USING ERRCODE='22023';
  END IF;
  SELECT * INTO control_row FROM pcm_issuance.control WHERE singleton FOR SHARE;
  IF NOT FOUND OR control_row.work_number IS DISTINCT FROM work OR owner IS NULL OR
      NOT EXISTS(SELECT 1 FROM dream.assets a WHERE a.owner_id=owner AND a.id=asset) OR
      NOT EXISTS(SELECT 1 FROM dream.projects p WHERE p.owner_id=owner AND p.id=project) THEN
    RETURN QUERY SELECT 'unavailable'::text,NULL::integer,false; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(control_row.restore_gen||'/'||req::text, 812));
  input := jsonb_build_object('operation',operation,'project',project,'asset',asset,'proof',expected,'revision',expected_revision);
  SELECT l.* INTO request_row FROM pcm_issuance.requests l WHERE (l.restore_gen,l.request_id)=(control_row.restore_gen,req);
  IF FOUND THEN
    IF request_row.owner_id <> owner THEN
      RETURN QUERY SELECT 'unavailable'::text,NULL::integer,false; RETURN;
    ELSIF request_row.fingerprint <> input THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::integer,false; RETURN;
    ELSIF request_row.state <> 'reserved' OR reserve_only THEN
      RETURN QUERY SELECT request_row.state,request_row.result_revision,false; RETURN;
    ELSIF request_row.reservation_xid = pg_current_xact_id() THEN
      RETURN QUERY SELECT 'reservation_required'::text,NULL::integer,false; RETURN;
    END IF;
  ELSIF reserve_only THEN
    INSERT INTO pcm_issuance.requests(restore_gen,request_id,owner_id,fingerprint,state)
      VALUES(control_row.restore_gen,req,owner,input,'reserved');
    RETURN QUERY SELECT 'reserved'::text,NULL::integer,false; RETURN;
  ELSE
    RETURN QUERY SELECT 'reservation_required'::text,NULL::integer,false; RETURN;
  END IF;

  PERFORM pcm_issuance.scope_lock(owner,project,asset);
  SELECT p.* INTO pointer_row FROM pcm_issuance.pointer p
    WHERE (p.restore_gen,p.owner_id,p.project_id,p.asset_id)=(control_row.restore_gen,owner,project,asset) FOR UPDATE;
  IF coalesce(pointer_row.revision,0) <> expected_revision OR
      (operation='revoke' AND pointer_row.state IS DISTINCT FROM 'issued') THEN
    RETURN QUERY SELECT 'stale_pointer'::text,NULL::integer,false; RETURN;
  END IF;
  IF operation='issue' THEN
    SELECT w.proof INTO actual FROM pcm_issuance.current_proof w
      WHERE (w.owner_id,w.project_id,w.asset_id)=(owner,project,asset);
    IF actual IS NULL OR actual <> expected THEN
      RETURN QUERY SELECT 'stale_evidence'::text,NULL::integer,false; RETURN;
    END IF;
    IF (pointer_row.proof->>'registrationGeneration')::integer >= (actual->>'registrationGeneration')::integer THEN
      RETURN QUERY SELECT 'renewal_requires_new_verification'::text,NULL::integer,false; RETURN;
    END IF;
    next_state := 'issued';
  ELSE
    -- Retire from the last issued proof even if the authorization has already been withdrawn.
    IF pointer_row.proof <> expected THEN
      RETURN QUERY SELECT 'stale_evidence'::text,NULL::integer,false; RETURN;
    END IF;
    actual := pointer_row.proof;
    next_state := 'revoked';
  END IF;
  INSERT INTO pcm_issuance.pointer AS p VALUES (control_row.restore_gen,owner,project,asset,1,next_state,actual)
    ON CONFLICT (restore_gen,owner_id,project_id,asset_id)
    DO UPDATE SET revision=p.revision+1,state=excluded.state,proof=excluded.proof WHERE p.revision=expected_revision
    RETURNING p.revision INTO next_revision;
  IF next_revision IS NULL THEN RAISE EXCEPTION 'PCM_ISSUANCE_POINTER_CHANGED'; END IF;
  UPDATE pcm_issuance.requests l SET state=next_state,result_revision=next_revision
    WHERE (l.restore_gen,l.request_id)=(control_row.restore_gen,req) AND l.state='reserved';
  IF NOT FOUND THEN RAISE EXCEPTION 'PCM_ISSUANCE_REQUEST_CHANGED'; END IF;
  RETURN QUERY SELECT next_state,next_revision,true;
END $$;

CREATE FUNCTION pcm_issuance.observe(req uuid)
RETURNS TABLE(state text,revision integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT l.state,l.result_revision FROM pcm_issuance.requests l JOIN pcm_issuance.control c USING (restore_gen)
  WHERE c.singleton AND l.request_id=$1 AND l.owner_id=dream.actor_id()
$$;
CREATE FUNCTION pcm_issuance.read_current(project uuid,asset uuid)
RETURNS TABLE(proof jsonb,content bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT w.proof,w.content FROM pcm_issuance.pointer p JOIN pcm_issuance.control c USING (restore_gen)
  JOIN pcm_issuance.current_proof w USING (owner_id,project_id,asset_id)
  WHERE c.singleton AND p.state='issued' AND p.proof=w.proof AND p.owner_id=dream.actor_id()
    AND p.project_id=$1 AND p.asset_id=$2
$$;

-- Test-only deferred trigger to hold a real COMMIT after both writes.
CREATE FUNCTION pcm_issuance.hold_commit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF current_setting('pcm_issuance.hold_commit',true)='on' THEN PERFORM pg_advisory_xact_lock(98236711); END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER pcm_issuance_hold_commit AFTER UPDATE ON pcm_issuance.requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.state <> 'reserved')
  EXECUTE FUNCTION pcm_issuance.hold_commit();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pcm_issuance FROM PUBLIC;
GRANT USAGE ON SCHEMA pcm_issuance TO pcm_issuance_issuer,pcm_issuance_reader;
GRANT EXECUTE ON FUNCTION pcm_issuance.request(uuid,integer,text,uuid,uuid,jsonb,integer,boolean),pcm_issuance.observe(uuid)
  TO pcm_issuance_issuer;
GRANT EXECUTE ON FUNCTION pcm_issuance.read_current(uuid,uuid) TO pcm_issuance_reader;
COMMIT;
