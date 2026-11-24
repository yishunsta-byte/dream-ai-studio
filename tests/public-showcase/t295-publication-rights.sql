-- Test-only overlay for the fixed T253 and T293 fixtures.
DO $$ BEGIN
  IF session_user <> 't293_bootstrap' OR current_database() !~ '^t253_[a-f0-9]{32}$'
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
     OR to_regnamespace('t293') IS NULL THEN RAISE EXCEPTION 'Owned PG17 fixture required'; END IF;
END $$;

CREATE ROLE t295_writer NOLOGIN NOBYPASSRLS;
CREATE ROLE t295_list_owner NOLOGIN NOBYPASSRLS;
CREATE ROLE t295_file_owner NOLOGIN NOBYPASSRLS;
CREATE ROLE t295_list NOLOGIN NOBYPASSRLS;
CREATE ROLE t295_file NOLOGIN NOBYPASSRLS;
GRANT t293_app TO t295_writer;
CREATE SCHEMA t295;
REVOKE ALL ON SCHEMA t295 FROM PUBLIC;
GRANT USAGE ON SCHEMA t295 TO t293_app,t295_writer,t295_list_owner,t295_file_owner,t295_list,t295_file;
GRANT USAGE ON SCHEMA t253_showcase TO t295_list_owner,t295_file_owner;

CREATE TABLE t295.attestations (
  owner_id uuid NOT NULL, slug text NOT NULL, rights_ref text NOT NULL CHECK (rights_ref ~ '^[A-Za-z0-9_-]{1,128}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object' AND manifest->>'rightsRef' IS NOT DISTINCT FROM rights_ref),
  mode text NOT NULL, expires_at timestamptz,
  PRIMARY KEY (owner_id,slug,rights_ref), FOREIGN KEY(owner_id,slug) REFERENCES t293.works(owner_id,slug),
  CHECK ((mode='perpetual' AND expires_at IS NULL) OR (mode='timed' AND expires_at IS NOT NULL AND isfinite(expires_at)))
);
CREATE TABLE t295.frozen_manifest (
  owner_id uuid NOT NULL, slug text NOT NULL, generation bigint NOT NULL CHECK (generation > 0), rights_ref text NOT NULL,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object' AND manifest->>'rightsRef' IS NOT DISTINCT FROM rights_ref),
  mode text NOT NULL, expires_at timestamptz,
  PRIMARY KEY(owner_id,slug,generation), FOREIGN KEY(owner_id,slug) REFERENCES t293.works(owner_id,slug),
  CHECK ((mode='perpetual' AND expires_at IS NULL) OR (mode='timed' AND expires_at IS NOT NULL AND isfinite(expires_at)))
);
CREATE TABLE t295.activation (
  owner_id uuid NOT NULL, slug text NOT NULL, generation bigint NOT NULL, approved_ms bigint NOT NULL CHECK (approved_ms >= 0),
  rights_ref text NOT NULL, mode text NOT NULL, expires_at timestamptz,
  PRIMARY KEY(owner_id,slug,generation), FOREIGN KEY(owner_id,slug,generation) REFERENCES t295.frozen_manifest(owner_id,slug,generation),
  CHECK ((mode='perpetual' AND expires_at IS NULL) OR (mode='timed' AND expires_at IS NOT NULL AND isfinite(expires_at)))
);
CREATE TABLE t295.requests (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, intent jsonb NOT NULL, outcome jsonb NOT NULL,
  PRIMARY KEY(owner_id,request_id)
);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['attestations','frozen_manifest','activation','requests'] LOOP
    EXECUTE format('ALTER TABLE t295.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE t295.%I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY writer_scope ON t295.%I TO t295_writer USING (owner_id=t293.actor()) WITH CHECK (owner_id=t293.actor())',name);
  END LOOP;
END $$;
GRANT SELECT ON t295.attestations,t295.frozen_manifest,t295.activation,t295.requests TO t295_writer;
-- The reader can lock the current attestation but has no login or public entrypoint for changing it.
GRANT UPDATE (expires_at) ON t295.attestations TO t295_writer;
GRANT INSERT ON t295.frozen_manifest,t295.activation,t295.requests TO t295_writer;

CREATE POLICY t295_list_slots ON t253_showcase.slots FOR SELECT TO t295_list_owner USING (active_generation IS NOT NULL);
CREATE POLICY t295_file_slots ON t253_showcase.slots FOR SELECT TO t295_file_owner USING (active_generation IS NOT NULL);
GRANT SELECT (owner_id,slug,active_generation,approved_ms,active_display,object_key,mime,size_bytes,sha) ON t253_showcase.slots TO t295_list_owner;
GRANT SELECT (owner_id,slug,active_generation,approved_ms,active_display,object_key,mime,size_bytes,sha) ON t253_showcase.slots TO t295_file_owner;
CREATE POLICY reader_manifest ON t295.frozen_manifest FOR SELECT TO t295_list_owner,t295_file_owner USING (true);
CREATE POLICY reader_activation ON t295.activation FOR SELECT TO t295_list_owner,t295_file_owner USING (true);
GRANT SELECT ON t295.frozen_manifest,t295.activation TO t295_list_owner,t295_file_owner;

CREATE FUNCTION t295.valid_rights(mode text, expires_at timestamptz, observed_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT COALESCE(isfinite(observed_at) AND ((mode='perpetual' AND expires_at IS NULL) OR
    (mode='timed' AND isfinite(expires_at) AND observed_at < expires_at)),false)
$$;
REVOKE ALL ON FUNCTION t295.valid_rights(text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.valid_rights(text,timestamptz,timestamptz) TO t295_writer,t295_list_owner,t295_file_owner;

CREATE FUNCTION t295.list_approved() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT jsonb_build_object('nowMs',floor(extract(epoch FROM statement_timestamp())*1000)::bigint::text,
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('slug',q.slug,'generation',q.active_generation::text,
      'approvedMs',q.approved_ms::text,'display',q.active_display) ORDER BY q.approved_ms DESC,q.slug COLLATE "C") FROM (
      SELECT s.slug,s.active_generation,s.approved_ms,s.active_display
      FROM t253_showcase.slots s JOIN t295.activation a
        ON (a.owner_id,a.slug,a.generation,a.approved_ms)=(s.owner_id,s.slug,s.active_generation,s.approved_ms)
      JOIN t295.frozen_manifest m ON (m.owner_id,m.slug,m.generation)=(a.owner_id,a.slug,a.generation)
      WHERE t295.valid_rights(m.mode,m.expires_at,statement_timestamp())
        AND (a.rights_ref,a.mode,a.expires_at) IS NOT DISTINCT FROM (m.rights_ref,m.mode,m.expires_at)
        AND s.active_display=m.manifest->'display' AND s.sha=m.manifest->>'coverSha'
        AND s.size_bytes::text=m.manifest->>'coverBytes'
        AND s.object_key=s.slug||'/'||s.active_generation::text||'/'||s.sha||'.webp' AND s.mime='image/webp'
        AND s.approved_ms <= floor(extract(epoch FROM statement_timestamp())*1000)::bigint
      ORDER BY s.approved_ms DESC,s.slug COLLATE "C" LIMIT 25
    ) q),'[]'::jsonb))
$$;
ALTER FUNCTION t295.list_approved() OWNER TO t295_list_owner;
REVOKE ALL ON FUNCTION t295.list_approved() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.list_approved() TO t295_list;

CREATE FUNCTION t295.find_cover(target_slug text,target_generation bigint)
RETURNS TABLE(object_key text,mime text,size_bytes integer,sha text) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT s.object_key,s.mime,s.size_bytes,s.sha
  FROM t253_showcase.slots s JOIN t295.activation a
    ON (a.owner_id,a.slug,a.generation,a.approved_ms)=(s.owner_id,s.slug,s.active_generation,s.approved_ms)
  JOIN t295.frozen_manifest m ON (m.owner_id,m.slug,m.generation)=(a.owner_id,a.slug,a.generation)
  WHERE s.slug=target_slug AND s.active_generation=target_generation
    AND t295.valid_rights(m.mode,m.expires_at,statement_timestamp())
    AND (a.rights_ref,a.mode,a.expires_at) IS NOT DISTINCT FROM (m.rights_ref,m.mode,m.expires_at)
    AND s.active_display=m.manifest->'display' AND s.sha=m.manifest->>'coverSha' AND s.size_bytes::text=m.manifest->>'coverBytes'
    AND s.object_key=s.slug||'/'||s.active_generation::text||'/'||s.sha||'.webp' AND s.mime='image/webp'
    AND s.approved_ms <= floor(extract(epoch FROM statement_timestamp())*1000)::bigint
$$;
ALTER FUNCTION t295.find_cover(text,bigint) OWNER TO t295_file_owner;
REVOKE ALL ON FUNCTION t295.find_cover(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.find_cover(text,bigint) TO t295_file;

CREATE FUNCTION t295.apply(request_id uuid,command text,target_slug text,expected_version bigint,target_generation bigint,rights_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid := t293.actor(); intent jsonb; result jsonb; frozen t295.frozen_manifest; grant_row t295.attestations;
  prior t295.requests; committed_generation bigint; approved bigint;
BEGIN
  IF actor IS NULL OR NOT t293.can_publish() THEN RAISE EXCEPTION 'Publisher denied' USING ERRCODE='42501'; END IF;
  IF request_id IS NULL OR command IS NULL OR command NOT IN ('prepare','complete','revoke') OR target_slug IS NULL OR
    expected_version IS NULL OR expected_version < 0 OR
    (command='prepare' AND target_generation IS NOT NULL) OR
    (command<>'prepare' AND (target_generation IS NULL OR target_generation < 1 OR target_generation > expected_version OR rights_ref IS NOT NULL))
    THEN RAISE EXCEPTION 'Invalid intent' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM t293.works w WHERE w.owner_id=actor AND w.slug=target_slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owner denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||'/'||request_id::text,295));
  IF NOT t293.can_publish() THEN RAISE EXCEPTION 'Publisher denied' USING ERRCODE='42501'; END IF;
  -- The rights reference is server evidence. A retry must not depend on re-resolving that reference.
  intent := jsonb_build_array(command,target_slug,expected_version,target_generation);
  SELECT * INTO prior FROM t295.requests r WHERE r.owner_id=actor AND r.request_id=apply.request_id;
  IF FOUND THEN
    IF prior.intent<>intent THEN RAISE EXCEPTION 'Intent mismatch' USING ERRCODE='22023'; END IF;
    RETURN prior.outcome;
  END IF;

  IF command='prepare' THEN
    SELECT * INTO grant_row FROM t295.attestations g WHERE g.owner_id=actor AND g.slug=target_slug AND g.rights_ref=apply.rights_ref FOR SHARE;
    IF NOT FOUND OR NOT t295.valid_rights(grant_row.mode,grant_row.expires_at,clock_timestamp()) THEN
      result := '{"status":"source-unavailable"}'::jsonb;
    ELSE
      result := t293.apply_t253(request_id,command,target_slug,expected_version,NULL,grant_row.manifest);
      IF result->>'status'='prepared' THEN
        INSERT INTO t295.frozen_manifest VALUES(actor,target_slug,(result->>'generation')::bigint,grant_row.rights_ref,
          grant_row.manifest,grant_row.mode,grant_row.expires_at);
      END IF;
    END IF;
  ELSIF command='complete' THEN
    SELECT * INTO frozen FROM t295.frozen_manifest m WHERE m.owner_id=actor AND m.slug=target_slug AND m.generation=target_generation;
    IF NOT FOUND THEN result := '{"status":"source-unavailable"}'::jsonb;
    ELSE
      SELECT * INTO grant_row FROM t295.attestations g WHERE g.owner_id=actor AND g.slug=target_slug AND g.rights_ref=frozen.rights_ref FOR SHARE;
      IF NOT FOUND OR (grant_row.manifest,grant_row.mode,grant_row.expires_at) IS DISTINCT FROM (frozen.manifest,frozen.mode,frozen.expires_at)
        OR NOT t295.valid_rights(frozen.mode,frozen.expires_at,clock_timestamp()) THEN result := '{"status":"source-unavailable"}'::jsonb;
      ELSE
        BEGIN
          result := t293.apply_t253(request_id,command,target_slug,expected_version,target_generation,frozen.manifest);
          IF result->>'status'='published' THEN
            committed_generation := (result->>'generation')::bigint;
            approved := t293.approved_ms(target_slug,committed_generation)::bigint;
            IF NOT t295.valid_rights(frozen.mode,frozen.expires_at,clock_timestamp()) THEN RAISE SQLSTATE 'R2950'; END IF;
            INSERT INTO t295.activation VALUES(actor,target_slug,committed_generation,approved,frozen.rights_ref,frozen.mode,frozen.expires_at);
          END IF;
        EXCEPTION WHEN SQLSTATE 'R2950' THEN result := '{"status":"source-unavailable"}'::jsonb;
        END;
      END IF;
    END IF;
  ELSE
    result := t293.apply_t253(request_id,command,target_slug,expected_version,target_generation,NULL);
  END IF;
  INSERT INTO t295.requests VALUES(actor,request_id,intent,result);
  RETURN result;
END $$;
ALTER FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) OWNER TO t295_writer;
REVOKE ALL ON FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) TO t293_app;
