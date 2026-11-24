-- T319 owned PG17 fixture only.
BEGIN;
DO $$
BEGIN
  IF current_database()<>'dream_test_t319' OR current_user<>'t319_bootstrap'
    OR current_setting('server_version_num')<>'170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t319.synthetic',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T319_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;

CREATE ROLE t319_guard NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE SCHEMA rea_t319;
REVOKE ALL ON SCHEMA rea_t319 FROM PUBLIC;
GRANT USAGE ON SCHEMA rea_t319 TO t319_guard;

CREATE TABLE rea_t319.sender (
  boot_id uuid PRIMARY KEY,
  process_id integer NOT NULL CHECK(process_id>0),
  isolated_at timestamptz
);
CREATE TABLE rea_t319.gate (
  singleton boolean PRIMARY KEY CHECK(singleton),
  generation bigint NOT NULL CHECK(generation>0),
  owner_id uuid NOT NULL REFERENCES rea_t319.sender,
  candidate_id uuid REFERENCES rea_t319.sender,
  CHECK(candidate_id IS NULL OR candidate_id<>owner_id)
);
CREATE TABLE rea_t319.permit (
  id uuid PRIMARY KEY,
  subject uuid NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  owner_id uuid NOT NULL REFERENCES rea_t319.sender,
  not_after timestamptz NOT NULL,
  state text NOT NULL CHECK(state IN ('prepared','starting','sending','finished','cancelled','isolated'))
);
CREATE TABLE rea_t319.event (
  permit_id uuid NOT NULL REFERENCES rea_t319.permit,
  state text NOT NULL CHECK(state IN ('prepared','starting','sending','finished','cancelled','isolated')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(permit_id,state)
);
ALTER TABLE rea_t319.sender OWNER TO t319_guard;
ALTER TABLE rea_t319.gate OWNER TO t319_guard;
ALTER TABLE rea_t319.permit OWNER TO t319_guard;
ALTER TABLE rea_t319.event OWNER TO t319_guard;

CREATE FUNCTION rea_t319.change(code text, expected_generation bigint, sender_id uuid, permit_id uuid,
    actor uuid, next_owner uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  g rea_t319.gate%ROWTYPE;
  p rea_t319.permit%ROWTYPE;
  next_state text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'T319_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
  END IF;
  SELECT * INTO g FROM rea_t319.gate WHERE singleton FOR UPDATE;
  IF NOT FOUND OR (g.generation,g.owner_id) IS DISTINCT FROM (expected_generation,sender_id) THEN RETURN 'stale_owner'; END IF;
  IF code='drain' THEN
    IF g.candidate_id IS NOT NULL THEN
      RETURN CASE WHEN g.candidate_id=next_owner THEN 'draining' ELSE 'candidate_conflict' END;
    END IF;
    IF next_owner=g.owner_id OR NOT EXISTS(SELECT 1 FROM rea_t319.sender WHERE boot_id=next_owner AND isolated_at IS NULL)
      THEN RETURN 'invalid_candidate'; END IF;
    UPDATE rea_t319.gate SET candidate_id=next_owner WHERE singleton;
    WITH closed AS (
      UPDATE rea_t319.permit SET state='cancelled' WHERE generation=g.generation AND state='prepared' RETURNING id
    ) INSERT INTO rea_t319.event(permit_id,state) SELECT id,'cancelled' FROM closed;
    RETURN 'draining';
  ELSIF code='activate' THEN
    IF g.candidate_id IS NULL OR g.candidate_id IS DISTINCT FROM next_owner THEN RETURN 'invalid_candidate'; END IF;
    IF EXISTS(SELECT 1 FROM rea_t319.permit WHERE generation=g.generation AND state IN ('prepared','starting','sending'))
      OR NOT EXISTS(SELECT 1 FROM rea_t319.sender WHERE boot_id=g.owner_id AND isolated_at IS NOT NULL)
      THEN RETURN 'waiting_for_isolation'; END IF;
    IF NOT EXISTS(SELECT 1 FROM rea_t319.sender WHERE boot_id=g.candidate_id AND isolated_at IS NULL)
      THEN RETURN 'invalid_candidate'; END IF;
    UPDATE rea_t319.gate SET owner_id=g.candidate_id,generation=g.generation+1,candidate_id=NULL WHERE singleton;
    RETURN 'activated';
  ELSIF code='issue' THEN
    IF g.candidate_id IS NOT NULL THEN RETURN 'draining'; END IF;
    IF permit_id IS NULL OR actor IS NULL THEN RETURN 'unavailable'; END IF;
    INSERT INTO rea_t319.permit VALUES(permit_id,actor,g.generation,g.owner_id,clock_timestamp()+interval '5 minutes','prepared')
      ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN 'existing'; END IF;
    INSERT INTO rea_t319.event(permit_id,state) VALUES(permit_id,'prepared');
    RETURN 'issued';
  ELSIF code NOT IN ('consume','first_report') OR code IS NULL THEN
    RETURN 'unavailable';
  END IF;

  SELECT * INTO p FROM rea_t319.permit WHERE id=permit_id FOR UPDATE;
  IF NOT FOUND OR (p.generation,p.owner_id,p.subject) IS DISTINCT FROM (g.generation,g.owner_id,actor)
    THEN RETURN 'unavailable'; END IF;
  IF g.candidate_id IS NOT NULL THEN RETURN 'draining'; END IF;
  IF code='consume' THEN
    IF p.state<>'prepared' THEN RETURN 'already_consumed'; END IF;
    IF p.not_after<=clock_timestamp() THEN RETURN 'expired'; END IF;
    next_state := 'starting';
  ELSE
    IF p.state<>'starting' THEN RETURN 'invalid_state'; END IF;
    next_state := 'sending';
  END IF;
  UPDATE rea_t319.permit SET state=next_state WHERE id=permit_id;
  INSERT INTO rea_t319.event(permit_id,state) VALUES(permit_id,next_state);
  RETURN next_state;
END $$;

-- Only the test supervisor can submit independently observed termination.
CREATE FUNCTION rea_t319.terminate(code text, expected_generation bigint, sender_id uuid, observed_pid integer,
    target uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g rea_t319.gate%ROWTYPE;
BEGIN
  SELECT * INTO g FROM rea_t319.gate WHERE singleton FOR UPDATE;
  IF NOT FOUND OR (g.generation,g.owner_id) IS DISTINCT FROM (expected_generation,sender_id) THEN RETURN 'stale_owner'; END IF;
  IF NOT EXISTS(SELECT 1 FROM rea_t319.sender WHERE boot_id=sender_id AND process_id=observed_pid) THEN
    RETURN 'unknown_sender';
  END IF;
  IF code='finished' THEN
    UPDATE rea_t319.permit SET state='finished'
      WHERE id=target AND owner_id=g.owner_id AND generation=g.generation AND state='sending';
    IF NOT FOUND THEN RETURN 'invalid_state'; END IF;
    INSERT INTO rea_t319.event(permit_id,state) VALUES(target,'finished');
    RETURN 'finished';
  ELSIF code='isolated' THEN
    IF g.candidate_id IS NULL THEN RETURN 'invalid_state'; END IF;
    UPDATE rea_t319.sender SET isolated_at=coalesce(isolated_at,clock_timestamp()) WHERE boot_id=sender_id;
    WITH closed AS (
      UPDATE rea_t319.permit SET state='isolated'
        WHERE owner_id=g.owner_id AND generation=g.generation AND state IN ('starting','sending') RETURNING id
    ) INSERT INTO rea_t319.event(permit_id,state) SELECT id,'isolated' FROM closed;
    RETURN 'isolated';
  END IF;
  RETURN 'invalid_state';
END $$;

CREATE FUNCTION rea_t319.status(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('generation',g.generation,'owner',g.owner_id,'candidate',g.candidate_id,
    'state',p.state,'events',coalesce((SELECT jsonb_agg(e.state ORDER BY e.recorded_at,e.state)
      FROM rea_t319.event e WHERE e.permit_id=p.id),'[]'::jsonb))
  FROM rea_t319.gate g LEFT JOIN rea_t319.permit p ON p.id=$1 WHERE g.singleton
$$;

ALTER FUNCTION rea_t319.change(text,bigint,uuid,uuid,uuid,uuid) OWNER TO t319_guard;
ALTER FUNCTION rea_t319.terminate(text,bigint,uuid,integer,uuid) OWNER TO t319_guard;
ALTER FUNCTION rea_t319.status(uuid) OWNER TO t319_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rea_t319 FROM PUBLIC;
COMMIT;
