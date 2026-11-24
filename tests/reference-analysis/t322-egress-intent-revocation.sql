-- T322 extension for the owned T319/T320 PostgreSQL fixture.
BEGIN;
DO $$
BEGIN
  IF current_database()<>'dream_test_t319' OR current_user<>'t319_bootstrap'
    OR current_setting('server_version_num')<>'170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t322.synthetic',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T322_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;
CREATE SCHEMA rea_t322;
REVOKE ALL ON SCHEMA rea_t322 FROM PUBLIC;
GRANT USAGE ON SCHEMA rea_t322 TO t319_guard;

CREATE TABLE rea_t322.intent (
  permit_id uuid PRIMARY KEY REFERENCES rea_t319.permit,
  channel_id uuid NOT NULL,
  generation bigint NOT NULL,
  owner_id uuid NOT NULL REFERENCES rea_t319.sender,
  controller_epoch bigint NOT NULL,
  authority_revision bigint NOT NULL,
  subject uuid NOT NULL,
  body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
  not_after timestamptz NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  first_reported_at timestamptz,
  terminal text CHECK(terminal IN ('finished','cancelled','isolated')),
  closed_at timestamptz,
  CHECK((terminal IS NULL)=(closed_at IS NULL))
);
CREATE TABLE rea_t322.revocation (
  id uuid PRIMARY KEY,
  generation bigint NOT NULL,
  subject uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX t322_only_pending ON rea_t322.revocation ((true)) WHERE completed_at IS NULL;
ALTER TABLE rea_t322.intent OWNER TO t319_guard;
ALTER TABLE rea_t322.revocation OWNER TO t319_guard;

CREATE FUNCTION rea_t322.control_action(action text, epoch bigint, subject_id uuid, target uuid, successor uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  g rea_t319.gate%ROWTYPE;
  c rea_t320.control%ROWTYPE;
  r rea_t322.revocation%ROWTYPE;
BEGIN
  SELECT * INTO STRICT g FROM rea_t319.gate WHERE singleton FOR UPDATE;
  SELECT * INTO STRICT c FROM rea_t320.control WHERE singleton;
  IF action='boot' THEN RETURN rea_t320.control_action(action,epoch,subject_id,target,successor); END IF;
  IF epoch IS DISTINCT FROM c.controller_epoch THEN RETURN 'stale_controller'; END IF;
  IF action IN ('accept_revoke','finish_revoke') THEN
    SELECT * INTO r FROM rea_t322.revocation WHERE id=target;
    IF FOUND AND r.subject IS DISTINCT FROM subject_id THEN RETURN 'conflict'; END IF;
    IF r.completed_at IS NOT NULL THEN RETURN 'completed'; END IF;
    IF action='accept_revoke' THEN
      IF r.id IS NOT NULL THEN RETURN 'pending'; END IF;
      IF EXISTS(SELECT 1 FROM rea_t322.revocation WHERE completed_at IS NULL) THEN RETURN 'busy'; END IF;
      IF NOT EXISTS(SELECT 1 FROM rea_t320.actor WHERE id=subject_id AND enabled) THEN RETURN 'unavailable'; END IF;
      INSERT INTO rea_t322.revocation(id,generation,subject) VALUES(target,g.generation,subject_id);
      RETURN 'pending';
    END IF;
    IF r.id IS NULL OR r.generation<>g.generation THEN RETURN 'unavailable'; END IF;
    IF EXISTS(SELECT 1 FROM rea_t322.intent WHERE generation=g.generation AND terminal IS NULL) THEN RETURN 'pending'; END IF;
    IF rea_t320.control_action('revoke',epoch,subject_id,NULL,NULL)<>'revoked' THEN RETURN 'unavailable'; END IF;
    UPDATE rea_t322.revocation SET completed_at=clock_timestamp() WHERE id=target;
    RETURN 'completed';
  END IF;
  IF action IN ('issue','activate') AND EXISTS(SELECT 1 FROM rea_t322.revocation WHERE completed_at IS NULL) THEN
    RETURN 'revocation_pending';
  END IF;
  IF action IN ('issue','drain','activate') THEN RETURN rea_t320.control_action(action,epoch,subject_id,target,successor); END IF;
  RETURN 'unavailable';
END $$;

CREATE FUNCTION rea_t322.send_step(action text, target uuid, subject_id uuid, channel uuid, digest text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  g rea_t319.gate%ROWTYPE;
  p rea_t319.permit%ROWTYPE;
  effect text;
BEGIN
  SELECT * INTO STRICT g FROM rea_t319.gate WHERE singleton FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM rea_t320.sender_login WHERE owner_id=g.owner_id AND login=session_user) THEN RETURN 'wrong_sender'; END IF;
  IF action IN ('consume','intent') AND EXISTS(SELECT 1 FROM rea_t322.revocation WHERE completed_at IS NULL) THEN
    RETURN 'revocation_pending';
  END IF;
  IF action='consume' THEN RETURN rea_t320.send_step(action,target,subject_id,channel); END IF;
  IF action='intent' THEN
    effect:=rea_t320.send_step('before_write',target,subject_id,channel);
    IF effect<>'ready' THEN RETURN effect; END IF;
    SELECT * INTO STRICT p FROM rea_t319.permit WHERE id=target;
    INSERT INTO rea_t322.intent(permit_id,channel_id,generation,owner_id,controller_epoch,authority_revision,subject,body_digest,not_after)
      VALUES(target,channel,p.generation,p.owner_id,p.controller_epoch,p.authority_revision,p.subject,digest,p.not_after)
      ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN 'already_intended'; END IF;
    RETURN 'ready';
  END IF;
  IF action='first_report' AND NOT EXISTS(SELECT 1 FROM rea_t322.intent
    WHERE permit_id=target AND channel_id=channel AND body_digest=digest AND terminal IS NULL) THEN
    RETURN 'invalid_state';
  END IF;
  IF action NOT IN ('first_report','closed_complete','closed_aborted') OR action IS NULL THEN RETURN 'unavailable'; END IF;
  effect:=rea_t320.send_step(action,target,subject_id,channel);
  IF effect='sending' THEN
    UPDATE rea_t322.intent SET first_reported_at=clock_timestamp() WHERE permit_id=target AND channel_id=channel;
  ELSIF effect IN ('finished','cancelled') THEN
    UPDATE rea_t322.intent SET terminal=effect,closed_at=clock_timestamp() WHERE permit_id=target AND channel_id=channel;
  END IF;
  RETURN effect;
END $$;

CREATE FUNCTION rea_t322.record_isolation(expected_generation bigint, sender_id uuid, observed_pid integer)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE outcome text;
BEGIN
  -- T319 takes the same gate lock used by the sending and revocation paths
  -- and checks the current generation, owner, observer PID and pending cutover.
  outcome:=rea_t319.terminate('isolated',expected_generation,sender_id,observed_pid,NULL);
  IF outcome<>'isolated' THEN RETURN outcome; END IF;

  UPDATE rea_t322.intent i SET terminal='isolated',closed_at=clock_timestamp()
    FROM rea_t319.permit p
    WHERE i.generation=expected_generation AND i.owner_id=sender_id AND i.terminal IS NULL
      AND (p.id,p.channel_id,p.generation,p.owner_id,p.subject,p.controller_epoch,p.authority_revision)
        =(i.permit_id,i.channel_id,i.generation,i.owner_id,i.subject,i.controller_epoch,i.authority_revision)
      AND p.state='isolated';
  -- Stopping at a mismatched record must undo the prior T319 writes as well.
  IF EXISTS(SELECT 1 FROM rea_t322.intent
    WHERE generation=expected_generation AND owner_id=sender_id AND terminal IS NULL) THEN
    RAISE EXCEPTION 'T322_ISOLATION_INTENT_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN outcome;
END $$;

ALTER FUNCTION rea_t322.control_action(text,bigint,uuid,uuid,uuid) OWNER TO t319_guard;
ALTER FUNCTION rea_t322.send_step(text,uuid,uuid,uuid,text) OWNER TO t319_guard;
ALTER FUNCTION rea_t322.record_isolation(bigint,uuid,integer) OWNER TO t319_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rea_t322 FROM PUBLIC;
COMMIT;
