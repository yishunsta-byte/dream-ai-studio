-- Delegated publication schema candidate, version 2. Requires approved precreated roles.
-- Install via the candidate transaction only. No login, data or credential is provisioned here.

CREATE SCHEMA t253_showcase;
GRANT CREATE ON SCHEMA t253_showcase TO t253_write_owner,t341_schema_owner;
REVOKE ALL ON SCHEMA t253_showcase FROM PUBLIC;
GRANT USAGE ON SCHEMA t253_showcase TO t253_publish, t253_write_owner;
GRANT USAGE ON SCHEMA t253_showcase TO t_publication_authority;

-- Provision verified identities and completed image evidence separately.
CREATE TABLE t253_showcase.source_images (
  owner_id uuid NOT NULL,
  source_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  sha text NOT NULL CHECK (sha ~ '^[a-f0-9]{64}$'),
  finished boolean NOT NULL,
  PRIMARY KEY (owner_id, source_id)
);
CREATE TABLE t253_showcase.publishers (actor uuid PRIMARY KEY);

CREATE TABLE t253_showcase.slots (
  slug text COLLATE "C" PRIMARY KEY CHECK (
    slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
    AND slug NOT IN ('sign','authenticated','private','signed')
  ),
  owner_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  pending_generation bigint,
  pending jsonb,
  active_generation bigint,
  active_display jsonb,
  approved_ms bigint,
  object_key text,
  mime text CHECK (mime = 'image/webp'),
  size_bytes integer CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha text CHECK (sha ~ '^[a-f0-9]{64}$'),
  CHECK ((pending_generation IS NULL AND pending IS NULL)
      OR (pending_generation IS NOT NULL AND pending IS NOT NULL AND pending_generation BETWEEN 1 AND version)),
  CHECK ((active_generation IS NULL AND num_nonnulls(active_display,approved_ms,object_key,mime,size_bytes,sha) = 0)
      OR (active_generation IS NOT NULL AND active_generation BETWEEN 1 AND version
          AND num_nonnulls(active_display,approved_ms,object_key,mime,size_bytes,sha) = 6))
);
CREATE INDEX t253_active_order ON t253_showcase.slots (approved_ms DESC, slug ASC)
  WHERE active_generation IS NOT NULL;

CREATE TABLE t253_showcase.requests (
  actor uuid NOT NULL,
  request_id uuid NOT NULL,
  fingerprint jsonb NOT NULL,
  outcome jsonb,
  recorded_ms bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  PRIMARY KEY (actor, request_id)
);

ALTER TABLE t253_showcase.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.slots FORCE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.requests FORCE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.source_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.source_images FORCE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE t253_showcase.publishers FORCE ROW LEVEL SECURITY;
CREATE POLICY publisher_provisioning ON t253_showcase.publishers TO t_publication_authority
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON t253_showcase.publishers TO t_publication_authority;

CREATE POLICY t253_write_slots ON t253_showcase.slots TO t253_write_owner
  USING (owner_id = nullif(current_setting('t253.actor', true),'')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('t253.actor', true),'')::uuid);
CREATE POLICY t253_write_requests ON t253_showcase.requests TO t253_write_owner
  USING (actor = nullif(current_setting('t253.actor', true),'')::uuid)
  WITH CHECK (actor = nullif(current_setting('t253.actor', true),'')::uuid);
CREATE POLICY t253_source_owner ON t253_showcase.source_images FOR SELECT TO t253_write_owner
  USING (owner_id = nullif(current_setting('t253.actor', true),'')::uuid);
CREATE POLICY t253_publisher_self ON t253_showcase.publishers FOR SELECT TO t253_write_owner
  USING (actor = nullif(current_setting('t253.actor', true),'')::uuid);

GRANT SELECT, INSERT, UPDATE ON t253_showcase.slots, t253_showcase.requests TO t253_write_owner;
GRANT SELECT ON t253_showcase.publishers, t253_showcase.source_images TO t253_write_owner;

-- t253_publish is a trusted server-only caller. The local actor is set by that caller
-- after authentication, never by an anonymous role or from a request owner field.
CREATE FUNCTION t253_showcase.apply_command(
  request uuid, command text, target_slug text, expected_version bigint,
  generation bigint, payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE
  actor_id uuid := nullif(current_setting('t253.actor', true),'')::uuid;
  fp jsonb;
  prior t253_showcase.requests%ROWTYPE;
  slot t253_showcase.slots%ROWTYPE;
  result jsonb;
  new_version bigint;
  committed_ms bigint;
  display_limit record;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (SELECT FROM t253_showcase.publishers p WHERE p.actor = actor_id) THEN
    RAISE EXCEPTION 'publisher denied' USING ERRCODE = '42501';
  END IF;
  IF request IS NULL OR command IS NULL OR command NOT IN ('prepare','complete','revoke')
     OR target_slug IS NULL OR target_slug !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
     OR target_slug IN ('sign','authenticated','private','signed')
     OR expected_version IS NULL OR expected_version < 0
     OR (command IN ('complete','revoke') AND
         (generation IS NULL OR generation < 1 OR generation > expected_version))
     OR (command = 'prepare' AND generation IS NOT NULL)
     OR (command = 'revoke' AND payload IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid command' USING ERRCODE = '22023';
  END IF;

  IF command IN ('prepare','complete') THEN
    IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text) > 4096 THEN
      RAISE EXCEPTION 'invalid manifest' USING ERRCODE = '22023';
    END IF;
    IF NOT (payload ?& ARRAY['sourceId','sourceRevision','sourceSha','rightsRef','display','coverSha','coverBytes'])
       OR payload - ARRAY['sourceId','sourceRevision','sourceSha','rightsRef','display','coverSha','coverBytes'] <> '{}'::jsonb
       OR jsonb_typeof(payload->'sourceId') IS DISTINCT FROM 'string'
       OR coalesce(payload->>'sourceId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
       OR jsonb_typeof(payload->'sourceRevision') IS DISTINCT FROM 'string'
       OR coalesce(payload->>'sourceRevision','') !~ '^[1-9][0-9]{0,18}$'
       OR jsonb_typeof(payload->'sourceSha') IS DISTINCT FROM 'string'
       OR coalesce(payload->>'sourceSha','') !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(payload->'coverSha') IS DISTINCT FROM 'string'
       OR coalesce(payload->>'coverSha','') !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(payload->'rightsRef') IS DISTINCT FROM 'string'
       OR coalesce(payload->>'rightsRef','') !~ '^[A-Za-z0-9_-]{1,128}$'
       OR jsonb_typeof(payload->'coverBytes') IS DISTINCT FROM 'number'
       OR coalesce(payload->>'coverBytes','') !~ '^[1-9][0-9]{0,6}$'
       OR jsonb_typeof(payload->'display') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid manifest fields' USING ERRCODE = '22023';
    END IF;
    IF (payload->>'sourceRevision')::numeric > 9223372036854775807
       OR (payload->>'coverBytes')::integer > 5242880
       OR (payload->'display') - ARRAY['kind','title','subtitle','creator','genre','format','description','width','height'] <> '{}'::jsonb
       OR coalesce(payload->'display'->>'kind','') NOT IN ('영상','광고','여행') THEN
      RAISE EXCEPTION 'invalid manifest bounds' USING ERRCODE = '22023';
    END IF;
    FOR display_limit IN SELECT * FROM (VALUES
      ('title',80),('subtitle',120),('creator',60),('genre',40),('format',40),('description',400)
    ) limits(field_name, max_length) LOOP
      IF jsonb_typeof(payload->'display'->display_limit.field_name) IS DISTINCT FROM 'string'
         OR length(btrim(payload->'display'->>display_limit.field_name)) NOT BETWEEN 1 AND display_limit.max_length
         OR (payload->'display'->>display_limit.field_name) ~ '[[:cntrl:]@]'
         OR strpos(payload->'display'->>display_limit.field_name, chr(8232)) > 0
         OR strpos(payload->'display'->>display_limit.field_name, chr(8233)) > 0 THEN
        RAISE EXCEPTION 'invalid display text' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_typeof(payload->'display'->'width') IS DISTINCT FROM 'number'
       OR jsonb_typeof(payload->'display'->'height') IS DISTINCT FROM 'number'
       OR coalesce(payload->'display'->>'width','') !~ '^[1-9][0-9]{0,3}$'
       OR coalesce(payload->'display'->>'height','') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'invalid image dimensions' USING ERRCODE = '22023';
    END IF;
    IF (payload->'display'->>'width')::integer > 4096 OR (payload->'display'->>'height')::integer > 4096 THEN
      RAISE EXCEPTION 'invalid image dimensions' USING ERRCODE = '22023';
    END IF;
  END IF;

  fp := jsonb_build_object('command',command,'slug',target_slug,'version',expected_version,
    'generation',generation,'payload',payload);
  INSERT INTO t253_showcase.requests(actor,request_id,fingerprint) VALUES (actor_id,request,fp)
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT prior FROM t253_showcase.requests r
    WHERE r.actor = actor_id AND r.request_id = request FOR UPDATE;
  IF prior.fingerprint <> fp THEN
    RAISE EXCEPTION 'request fingerprint mismatch' USING ERRCODE = '22023';
  END IF;
  IF prior.outcome IS NOT NULL THEN RETURN prior.outcome; END IF;

  IF command = 'prepare' AND expected_version = 0 AND EXISTS (
    SELECT FROM t253_showcase.source_images i WHERE i.owner_id = actor_id
      AND i.source_id = (payload->>'sourceId')::uuid AND i.revision = (payload->>'sourceRevision')::bigint
      AND i.sha = payload->>'sourceSha' AND i.finished
  ) THEN
    INSERT INTO t253_showcase.slots(slug,owner_id) VALUES (target_slug,actor_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT * INTO slot FROM t253_showcase.slots s WHERE s.slug = target_slug FOR UPDATE;
  IF NOT FOUND AND command = 'prepare' AND expected_version = 0 THEN
    result := jsonb_build_object('status','source-unavailable');
  ELSIF NOT FOUND OR expected_version > slot.version THEN
    result := jsonb_build_object('status','conflict');
  ELSIF command = 'complete' AND
      (expected_version <> generation OR slot.pending_generation IS DISTINCT FROM generation
        OR slot.pending IS DISTINCT FROM payload) THEN
    result := jsonb_build_object('status','conflict');
  ELSIF command = 'prepare' AND (slot.version <> expected_version OR slot.pending_generation IS NOT NULL) THEN
    result := jsonb_build_object('status','conflict');
  ELSIF command = 'revoke' AND slot.pending_generation IS DISTINCT FROM generation
      AND slot.active_generation IS DISTINCT FROM generation THEN
    result := jsonb_build_object('status','conflict');
  ELSIF command IN ('prepare','complete') AND NOT EXISTS (
    SELECT FROM t253_showcase.source_images i WHERE i.owner_id = actor_id
      AND i.source_id = (payload->>'sourceId')::uuid AND i.revision = (payload->>'sourceRevision')::bigint
      AND i.sha = payload->>'sourceSha' AND i.finished
  ) THEN
    result := jsonb_build_object('status','source-unavailable');
  ELSE
    new_version := slot.version + 1;
    IF command = 'prepare' THEN
      UPDATE t253_showcase.slots SET version = new_version, pending_generation = new_version, pending = payload
        WHERE slug = target_slug;
      result := jsonb_build_object('status','prepared','version',new_version::text,'generation',new_version::text);
    ELSIF command = 'complete' THEN
      committed_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
      UPDATE t253_showcase.slots SET version = new_version, pending_generation = NULL, pending = NULL,
        active_generation = generation, active_display = payload->'display', approved_ms = committed_ms,
        object_key = target_slug || '/' || generation::text || '/' || (payload->>'coverSha') || '.webp',
        mime = 'image/webp', size_bytes = (payload->>'coverBytes')::integer, sha = payload->>'coverSha'
        WHERE slug = target_slug;
      result := jsonb_build_object('status','published','version',new_version::text,'generation',generation::text);
    ELSE
      -- Retire only the observed generation. The other pointer may represent different work.
      UPDATE t253_showcase.slots SET version = new_version,
        pending_generation = CASE WHEN slot.pending_generation = generation THEN NULL ELSE slot.pending_generation END,
        pending = CASE WHEN slot.pending_generation = generation THEN NULL ELSE slot.pending END,
        active_generation = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.active_generation END,
        active_display = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.active_display END,
        approved_ms = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.approved_ms END,
        object_key = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.object_key END,
        mime = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.mime END,
        size_bytes = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.size_bytes END,
        sha = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.sha END
        WHERE slug = target_slug;
      result := jsonb_build_object('status','revoked','version',new_version::text,'generation',generation::text);
    END IF;
  END IF;
  UPDATE t253_showcase.requests SET outcome = result WHERE actor = actor_id AND request_id = request;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION t253_showcase.apply_command(uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t253_showcase.apply_command(uuid,text,text,bigint,bigint,jsonb) TO t253_publish;

CREATE SCHEMA t293;
GRANT CREATE ON SCHEMA t293 TO t253_write_owner,t293_binding_owner,t293_gateway,t341_schema_owner;
REVOKE ALL ON SCHEMA t293 FROM PUBLIC;
GRANT USAGE ON SCHEMA t293 TO t293_app, t293_gateway, t253_write_owner, t293_binding_owner;

-- The authorized provisioning operator binds an existing limited login OID to a verified Auth UUID.
CREATE TABLE t293.actor_bindings (
  login_role oid PRIMARY KEY,
  actor_id uuid NOT NULL
);
ALTER TABLE t293.actor_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE t293.actor_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY current_login_binding ON t293.actor_bindings FOR SELECT TO t293_binding_owner
  USING (login_role = (SELECT oid FROM pg_roles WHERE rolname = session_user AND rolcanlogin));
GRANT SELECT ON t293.actor_bindings TO t293_binding_owner;
GRANT USAGE ON SCHEMA t293 TO t_publication_authority;
CREATE POLICY login_provisioning ON t293.actor_bindings TO t_publication_authority
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON t293.actor_bindings TO t_publication_authority;

CREATE FUNCTION t293.actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT actor_id FROM t293.actor_bindings
  WHERE login_role = (SELECT oid FROM pg_roles WHERE rolname = session_user AND rolcanlogin)
    AND actor_id::text = current_setting('t293.actor', true)
$$;
REVOKE ALL ON FUNCTION t293.actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.actor() TO t293_app, t293_gateway, t253_write_owner;

CREATE FUNCTION t293.can_publish() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid := t293.actor();
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  PERFORM set_config('t253.actor', actor::text, true);
  RETURN EXISTS (SELECT 1 FROM t253_showcase.publishers WHERE publishers.actor = t293.actor());
END $$;
REVOKE ALL ON FUNCTION t293.can_publish() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.can_publish() TO t293_app, t293_gateway;

CREATE FUNCTION t293.approved_ms(target_slug text, target_generation bigint) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT approved_ms::text FROM t253_showcase.slots WHERE slug=target_slug
    AND active_generation=target_generation AND owner_id=t293.actor()
$$;
REVOKE ALL ON FUNCTION t293.approved_ms(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.approved_ms(text,bigint) TO t293_app;

CREATE FUNCTION t293.apply_t253(request_id uuid, command text, slug text, version bigint, generation bigint, manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
BEGIN
  IF NOT t293.can_publish() THEN RAISE EXCEPTION 'publisher denied' USING ERRCODE = '42501'; END IF;
  RETURN t253_showcase.apply_command(request_id, command, slug, version, generation, manifest);
END $$;
REVOKE ALL ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC;

CREATE TABLE t293.works (
  owner_id uuid NOT NULL, slug text PRIMARY KEY, state jsonb NOT NULL,
  UNIQUE (owner_id, slug),
  CHECK ((state->>'ownerId')::uuid IS NOT DISTINCT FROM owner_id AND state->>'slug' IS NOT DISTINCT FROM slug)
);
CREATE TABLE t293.evidence (
  owner_id uuid NOT NULL, slug text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(owner_id, slug),
  FOREIGN KEY(owner_id, slug) REFERENCES t293.works(owner_id, slug)
);
CREATE TABLE t293.manifests (
  owner_id uuid NOT NULL, slug text NOT NULL, generation bigint NOT NULL CHECK (generation > 0), value jsonb NOT NULL,
  PRIMARY KEY(owner_id, slug, generation), FOREIGN KEY(owner_id, slug) REFERENCES t293.works(owner_id, slug)
);
CREATE TABLE t293.app_requests (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, slug text NOT NULL, entry jsonb NOT NULL,
  manifest_generation bigint, PRIMARY KEY(owner_id, request_id),
  FOREIGN KEY(owner_id, slug) REFERENCES t293.works(owner_id, slug),
  FOREIGN KEY(owner_id, slug, manifest_generation) REFERENCES t293.manifests(owner_id, slug, generation)
);
CREATE TABLE t293.audit (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, value jsonb NOT NULL, PRIMARY KEY(owner_id, request_id),
  FOREIGN KEY(owner_id, request_id) REFERENCES t293.app_requests(owner_id, request_id)
);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['works','evidence','manifests','app_requests','audit'] LOOP
    EXECUTE format('ALTER TABLE t293.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE t293.%I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY scoped_actor ON t293.%I TO t293_app USING (owner_id = t293.actor()) WITH CHECK (owner_id = t293.actor())',name);
  END LOOP;
END $$;
GRANT SELECT ON t293.works,t293.evidence,t293.manifests,t293.app_requests,t293.audit TO t293_app;
GRANT UPDATE (state) ON t293.works TO t293_app;
GRANT INSERT ON t293.manifests,t293.app_requests,t293.audit TO t293_app;

GRANT EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) TO t295_writer;
CREATE SCHEMA t295;
GRANT CREATE ON SCHEMA t295 TO t295_writer,t295_list_owner,t295_file_owner,t341_schema_owner;
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
REVOKE ALL ON FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) TO t293_app;

CREATE FUNCTION t295.exact_ms(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog, pg_temp AS $$
  SELECT CASE WHEN ms=trunc(ms) THEN trunc(ms)::bigint::text ELSE 'frac:' || ms::text END
  FROM (SELECT extract(epoch FROM value)*1000 AS ms) x
$$;
REVOKE ALL ON FUNCTION t295.exact_ms(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.exact_ms(timestamptz) TO t295_writer;

CREATE FUNCTION t295.rights_state(target_slug text,target_generation bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog, pg_temp SET row_security=on AS $$
  SELECT jsonb_build_object(
    'frozen', (SELECT jsonb_build_object('rights_ref',m.rights_ref,'manifest',m.manifest,'mode',m.mode,'expires_ms',t295.exact_ms(m.expires_at))
      FROM t295.frozen_manifest m WHERE m.owner_id=t293.actor() AND m.slug=target_slug AND m.generation=target_generation),
    'activation', (SELECT jsonb_build_object('rights_ref',a.rights_ref,'mode',a.mode,'expires_ms',t295.exact_ms(a.expires_at),'approved_ms',a.approved_ms::text)
      FROM t295.activation a WHERE a.owner_id=t293.actor() AND a.slug=target_slug AND a.generation=target_generation))
$$;
REVOKE ALL ON FUNCTION t295.rights_state(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.rights_state(text,bigint) TO t293_app;

CREATE SCHEMA t_publication_install;
REVOKE ALL ON SCHEMA t_publication_install FROM PUBLIC;
CREATE TABLE t_publication_install.history (
  version integer PRIMARY KEY CHECK (version = 2),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  catalog_sha256 text NOT NULL CHECK (catalog_sha256 ~ '^[a-f0-9]{64}$'),
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

GRANT CREATE ON SCHEMA t_publication_install TO t341_history_owner;
GRANT USAGE ON SCHEMA t_publication_install TO t341_verify;
GRANT SELECT (version,source_sha256,plan_sha256,catalog_sha256,installed_at)
  ON t_publication_install.history TO t341_verify;

-- The installer is the current creator for all ACL changes and ownership transfers.
ALTER FUNCTION t253_showcase.apply_command(uuid,text,text,bigint,bigint,jsonb) OWNER TO t253_write_owner;
ALTER FUNCTION t293.actor() OWNER TO t293_binding_owner;
ALTER FUNCTION t293.can_publish() OWNER TO t253_write_owner;
ALTER FUNCTION t293.approved_ms(text,bigint) OWNER TO t253_write_owner;
ALTER FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) OWNER TO t293_gateway;
ALTER FUNCTION t295.list_approved() OWNER TO t295_list_owner;
ALTER FUNCTION t295.find_cover(text,bigint) OWNER TO t295_file_owner;
ALTER FUNCTION t295.apply(uuid,text,text,bigint,bigint,text) OWNER TO t295_writer;
ALTER FUNCTION t295.rights_state(text,bigint) OWNER TO t295_writer;
ALTER FUNCTION t295.valid_rights(text,timestamptz,timestamptz) OWNER TO t341_schema_owner;
ALTER FUNCTION t295.exact_ms(timestamptz) OWNER TO t341_schema_owner;
ALTER TABLE t253_showcase.source_images OWNER TO t341_schema_owner;
ALTER TABLE t253_showcase.publishers OWNER TO t341_schema_owner;
ALTER TABLE t253_showcase.slots OWNER TO t341_schema_owner;
ALTER TABLE t253_showcase.requests OWNER TO t341_schema_owner;
ALTER TABLE t293.actor_bindings OWNER TO t341_schema_owner;
ALTER TABLE t293.works OWNER TO t341_schema_owner;
ALTER TABLE t293.evidence OWNER TO t341_schema_owner;
ALTER TABLE t293.manifests OWNER TO t341_schema_owner;
ALTER TABLE t293.app_requests OWNER TO t341_schema_owner;
ALTER TABLE t293.audit OWNER TO t341_schema_owner;
ALTER TABLE t295.attestations OWNER TO t341_schema_owner;
ALTER TABLE t295.frozen_manifest OWNER TO t341_schema_owner;
ALTER TABLE t295.activation OWNER TO t341_schema_owner;
ALTER TABLE t295.requests OWNER TO t341_schema_owner;
ALTER TABLE t_publication_install.history OWNER TO t341_history_owner;

-- The installer still owns each schema while removing its temporary object-owner grants.
REVOKE CREATE ON SCHEMA t253_showcase FROM t253_write_owner,t341_schema_owner;
REVOKE CREATE ON SCHEMA t293 FROM t253_write_owner,t293_binding_owner,t293_gateway,t341_schema_owner;
REVOKE CREATE ON SCHEMA t295 FROM t295_writer,t295_list_owner,t295_file_owner,t341_schema_owner;
REVOKE CREATE ON SCHEMA t_publication_install FROM t341_history_owner;
ALTER SCHEMA t253_showcase OWNER TO t341_schema_owner;
ALTER SCHEMA t293 OWNER TO t341_schema_owner;
ALTER SCHEMA t295 OWNER TO t341_schema_owner;
ALTER SCHEMA t_publication_install OWNER TO t341_history_owner;
