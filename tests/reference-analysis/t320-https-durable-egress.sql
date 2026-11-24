-- Extension loaded only into the owned T319/T320 PG17 fixture.
BEGIN;
DO $$
BEGIN
  IF current_database()<>'dream_test_t319' OR current_user<>'t319_bootstrap'
    OR current_setting('server_version_num')<>'170012'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_setting('rea_t320.synthetic',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T320_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;
CREATE SCHEMA rea_t320;
REVOKE ALL ON SCHEMA rea_t320 FROM PUBLIC;
GRANT USAGE ON SCHEMA rea_t320 TO t319_guard;

CREATE TABLE rea_t320.control (
  singleton boolean PRIMARY KEY CHECK(singleton),
  controller_epoch bigint NOT NULL CHECK(controller_epoch>=0),
  authority_revision bigint NOT NULL CHECK(authority_revision>0)
);
INSERT INTO rea_t320.control VALUES(true,0,1);
CREATE TABLE rea_t320.actor (id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE rea_t320.sender_login (owner_id uuid PRIMARY KEY REFERENCES rea_t319.sender, login name UNIQUE NOT NULL);
ALTER TABLE rea_t320.control OWNER TO t319_guard;
ALTER TABLE rea_t320.actor OWNER TO t319_guard;
ALTER TABLE rea_t320.sender_login OWNER TO t319_guard;
ALTER TABLE rea_t319.permit
  ADD COLUMN controller_epoch bigint NOT NULL,
  ADD COLUMN authority_revision bigint NOT NULL,
  ADD COLUMN channel_id uuid;

CREATE FUNCTION rea_t320.control_action(action text, epoch bigint, subject_id uuid, target uuid, successor uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  g rea_t319.gate%ROWTYPE;
  c rea_t320.control%ROWTYPE;
BEGIN
  SELECT * INTO STRICT g FROM rea_t319.gate WHERE singleton FOR UPDATE;
  SELECT * INTO STRICT c FROM rea_t320.control WHERE singleton FOR UPDATE;
  IF action='boot' THEN
    UPDATE rea_t320.control SET controller_epoch=c.controller_epoch+1 WHERE singleton;
    RETURN (c.controller_epoch+1)::text;
  END IF;
  IF epoch IS DISTINCT FROM c.controller_epoch THEN RETURN 'stale_controller'; END IF;
  IF action='revoke' THEN
    UPDATE rea_t320.actor SET enabled=false WHERE id=subject_id AND enabled;
    IF NOT FOUND THEN RETURN 'unavailable'; END IF;
    UPDATE rea_t320.control SET authority_revision=c.authority_revision+1 WHERE singleton;
    RETURN 'revoked';
  ELSIF action IN ('drain','activate') THEN
    RETURN rea_t319.change(action,g.generation,g.owner_id,NULL,NULL,successor);
  ELSIF action<>'issue' OR action IS NULL THEN
    RETURN 'unavailable';
  END IF;
  IF g.candidate_id IS NOT NULL THEN RETURN 'draining'; END IF;
  IF NOT EXISTS(SELECT 1 FROM rea_t320.actor WHERE id=subject_id AND enabled) THEN RETURN 'unavailable'; END IF;
  INSERT INTO rea_t319.permit(id,subject,generation,owner_id,not_after,state,controller_epoch,authority_revision)
    VALUES(target,subject_id,g.generation,g.owner_id,clock_timestamp()+interval '5 minutes','prepared',
      c.controller_epoch,c.authority_revision) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'existing'; END IF;
  INSERT INTO rea_t319.event(permit_id,state) VALUES(target,'prepared');
  RETURN 'issued';
END $$;

CREATE FUNCTION rea_t320.send_step(action text, target uuid, subject_id uuid, channel uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  g rea_t319.gate%ROWTYPE;
  c rea_t320.control%ROWTYPE;
  p rea_t319.permit%ROWTYPE;
  next_state text;
BEGIN
  SELECT * INTO STRICT g FROM rea_t319.gate WHERE singleton FOR UPDATE;
  SELECT * INTO STRICT c FROM rea_t320.control WHERE singleton;
  IF NOT EXISTS(SELECT 1 FROM rea_t320.sender_login WHERE owner_id=g.owner_id AND login=session_user) THEN
    RETURN 'wrong_sender';
  END IF;
  SELECT * INTO p FROM rea_t319.permit WHERE id=target FOR UPDATE;
  IF NOT FOUND OR (p.generation,p.owner_id,p.subject) IS DISTINCT FROM (g.generation,g.owner_id,subject_id)
    OR channel IS NULL THEN RETURN 'unavailable'; END IF;
  IF action IN ('consume','before_write') THEN
    IF g.candidate_id IS NOT NULL THEN RETURN 'draining'; END IF;
    IF p.controller_epoch<>c.controller_epoch OR p.authority_revision<>c.authority_revision
      OR NOT EXISTS(SELECT 1 FROM rea_t320.actor WHERE id=p.subject AND enabled) THEN RETURN 'stale_authority'; END IF;
    IF p.not_after<=clock_timestamp() THEN RETURN 'expired'; END IF;
  END IF;
  IF action='consume' THEN
    IF p.state<>'prepared' THEN RETURN 'already_consumed'; END IF;
    UPDATE rea_t319.permit SET state='starting',channel_id=channel WHERE id=target;
    INSERT INTO rea_t319.event(permit_id,state) VALUES(target,'starting');
    RETURN 'starting';
  END IF;
  IF p.channel_id IS DISTINCT FROM channel THEN RETURN 'wrong_channel'; END IF;
  IF action='before_write' AND p.state='starting' THEN RETURN 'ready'; END IF;
  IF action='first_report' AND p.state='starting' THEN
    next_state:='sending';
  ELSIF action='closed_complete' AND p.state='sending' THEN
    next_state:='finished';
  ELSIF action='closed_aborted' AND p.state IN ('starting','sending') THEN
    next_state:='cancelled';
  ELSE
    RETURN 'invalid_state';
  END IF;
  UPDATE rea_t319.permit SET state=next_state WHERE id=target;
  INSERT INTO rea_t319.event(permit_id,state) VALUES(target,next_state);
  RETURN next_state;
END $$;

ALTER FUNCTION rea_t320.control_action(text,bigint,uuid,uuid,uuid) OWNER TO t319_guard;
ALTER FUNCTION rea_t320.send_step(text,uuid,uuid,uuid) OWNER TO t319_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rea_t320 FROM PUBLIC;
COMMIT;
