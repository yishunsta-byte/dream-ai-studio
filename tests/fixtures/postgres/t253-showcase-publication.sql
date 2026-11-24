-- Synthetic fixture. Apply in one caller-owned transaction to a disposable PG17 database.
DO $$
BEGIN
  IF current_database() !~ '^t253_[a-f0-9]{32}$'
     OR current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'T253 requires a disposable PG17 database';
  END IF;
END $$;

CREATE ROLE t253_list NOLOGIN NOBYPASSRLS;
CREATE ROLE t253_file NOLOGIN NOBYPASSRLS;
CREATE ROLE t253_publish NOLOGIN NOBYPASSRLS;
CREATE ROLE t253_list_owner NOLOGIN NOBYPASSRLS;
CREATE ROLE t253_file_owner NOLOGIN NOBYPASSRLS;
CREATE ROLE t253_write_owner NOLOGIN NOBYPASSRLS;
CREATE SCHEMA t253_showcase;
REVOKE ALL ON SCHEMA t253_showcase FROM PUBLIC;
GRANT USAGE ON SCHEMA t253_showcase TO t253_list, t253_file, t253_publish,
  t253_list_owner, t253_file_owner, t253_write_owner;

-- Supply verified identities and finished image provenance as private synthetic fixtures.
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

CREATE POLICY t253_active_list ON t253_showcase.slots FOR SELECT TO t253_list_owner
  USING (active_generation IS NOT NULL);
CREATE POLICY t253_active_file ON t253_showcase.slots FOR SELECT TO t253_file_owner
  USING (active_generation IS NOT NULL);
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

GRANT SELECT (slug,active_generation,active_display,approved_ms)
  ON t253_showcase.slots TO t253_list_owner;
GRANT SELECT (slug,active_generation,object_key,mime,size_bytes,sha)
  ON t253_showcase.slots TO t253_file_owner;
GRANT SELECT, INSERT, UPDATE ON t253_showcase.slots, t253_showcase.requests TO t253_write_owner;
GRANT SELECT ON t253_showcase.publishers, t253_showcase.source_images TO t253_write_owner;

CREATE FUNCTION t253_showcase.list_approved() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'nowMs', floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint::text,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', q.slug, 'generation', q.active_generation::text,
        'approvedMs', q.approved_ms::text, 'display', q.active_display
      ) ORDER BY q.approved_ms DESC, q.slug COLLATE "C" ASC)
      FROM (
        SELECT slug,active_generation,approved_ms,active_display
        FROM t253_showcase.slots WHERE active_generation IS NOT NULL
        ORDER BY approved_ms DESC, slug COLLATE "C" ASC LIMIT 25
      ) q
    ), '[]'::jsonb)
  )
$$;
ALTER FUNCTION t253_showcase.list_approved() OWNER TO t253_list_owner;
REVOKE ALL ON FUNCTION t253_showcase.list_approved() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t253_showcase.list_approved() TO t253_list;

CREATE FUNCTION t253_showcase.find_cover(wanted_slug text, wanted_generation bigint)
RETURNS TABLE (object_key text, mime text, size_bytes integer, sha text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.object_key,s.mime,s.size_bytes,s.sha
  FROM t253_showcase.slots s
  WHERE s.slug = wanted_slug AND s.active_generation = wanted_generation
$$;
ALTER FUNCTION t253_showcase.find_cover(text,bigint) OWNER TO t253_file_owner;
REVOKE ALL ON FUNCTION t253_showcase.find_cover(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t253_showcase.find_cover(text,bigint) TO t253_file;

-- t253_publish is a trusted server-only caller. The local actor is set by that caller
-- after authentication, never by an anonymous role or from a request owner field.
CREATE FUNCTION t253_showcase.apply_command(
  request uuid, command text, target_slug text, expected_version bigint,
  generation bigint, payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
ALTER FUNCTION t253_showcase.apply_command(uuid,text,text,bigint,bigint,jsonb) OWNER TO t253_write_owner;
REVOKE ALL ON FUNCTION t253_showcase.apply_command(uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t253_showcase.apply_command(uuid,text,text,bigint,bigint,jsonb) TO t253_publish;
