BEGIN;
SET LOCAL search_path=pg_catalog;
DO $setup$
BEGIN
  IF current_database() <> 'dream_test_t319'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num') <> '170012'
    OR current_setting('rea_t320.synthetic',true) IS DISTINCT FROM 'on'
    OR to_regclass('rea_t320.control') IS NULL THEN
    RAISE EXCEPTION 'PCM_ONE_SHOT_FIXTURE_TARGET';
  END IF;
END
$setup$;

CREATE TABLE rea_t320.pcm_committed_result (
  store_id uuid NOT NULL, restoration text NOT NULL, owner_id uuid NOT NULL, request_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0), digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
  delivery_generation bigint NOT NULL CHECK(delivery_generation>0),
  PRIMARY KEY (store_id,restoration,owner_id,request_id)
);
CREATE TABLE rea_t320.pcm_send_intent (
  store_id uuid NOT NULL, restoration text NOT NULL, owner_id uuid NOT NULL, request_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0), digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
  permit_id uuid NOT NULL UNIQUE REFERENCES rea_t319.permit(id),
  PRIMARY KEY (store_id,restoration,owner_id,request_id),
  FOREIGN KEY (store_id,restoration,owner_id,request_id) REFERENCES
    rea_t320.pcm_committed_result(store_id,restoration,owner_id,request_id)
);
ALTER TABLE rea_t320.pcm_committed_result OWNER TO t319_guard;
ALTER TABLE rea_t320.pcm_send_intent OWNER TO t319_guard;

CREATE FUNCTION rea_t320.pcm_issue(s uuid,g text,o uuid,r uuid,v integer,h text,t uuid,e bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  gate rea_t319.gate%ROWTYPE;
  expected rea_t320.pcm_committed_result%ROWTYPE;
  verdict text;
BEGIN
  SELECT * INTO gate FROM rea_t319.gate WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF gate.candidate_id IS NOT NULL THEN RETURN 'draining'; END IF;
  SELECT * INTO expected FROM rea_t320.pcm_committed_result c
  WHERE (c.store_id,c.restoration,c.owner_id,c.request_id)=(s,g,o,r);
  IF NOT FOUND OR expected.revision IS DISTINCT FROM v OR expected.digest IS DISTINCT FROM h OR t IS NULL
    OR expected.delivery_generation IS DISTINCT FROM gate.generation
    THEN RETURN 'unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM rea_t320.pcm_send_intent i WHERE (i.store_id,i.restoration,i.owner_id,i.request_id)=(s,g,o,r))
    THEN RETURN 'duplicate_request'; END IF;
  verdict := rea_t320.control_action('issue',e,o,t,NULL);
  IF verdict <> 'issued' THEN RETURN verdict; END IF;
  INSERT INTO rea_t320.pcm_send_intent VALUES(s,g,o,r,v,h,t);
  RETURN 'issued';
END $$;

CREATE FUNCTION rea_t320.pcm_send_step(action text,t uuid,o uuid,channel uuid,h text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM rea_t320.pcm_send_intent i WHERE (i.permit_id,i.owner_id,i.digest)=(t,o,h))
    THEN RETURN 'unavailable'; END IF;
  RETURN rea_t320.send_step(action,t,o,channel);
END $$;

ALTER FUNCTION rea_t320.pcm_issue(uuid,text,uuid,uuid,integer,text,uuid,bigint) OWNER TO t319_guard;
ALTER FUNCTION rea_t320.pcm_send_step(text,uuid,uuid,uuid,text) OWNER TO t319_guard;
REVOKE ALL ON FUNCTION rea_t320.pcm_issue(uuid,text,uuid,uuid,integer,text,uuid,bigint),
  rea_t320.pcm_send_step(text,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rea_t320.send_step(text,uuid,uuid,uuid) FROM pcm_tls_old,pcm_tls_next;
GRANT EXECUTE ON FUNCTION rea_t320.pcm_send_step(text,uuid,uuid,uuid,text) TO pcm_tls_old,pcm_tls_next;
COMMIT;
