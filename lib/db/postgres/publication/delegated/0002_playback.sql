-- Apply only to the verified delegated v2 catalog, in the installer's transaction.
SET LOCAL ROLE t341_schema_owner;
ALTER TABLE t253_showcase.slots ADD COLUMN active_media_manifest jsonb;
GRANT SELECT (active_media_manifest) ON t253_showcase.slots TO t295_file_owner,t295_list_owner;
GRANT CREATE ON SCHEMA t253_showcase TO t253_write_owner;
GRANT CREATE ON SCHEMA t295 TO t295_file_owner,t295_list_owner;

SET LOCAL ROLE t253_write_owner;
CREATE OR REPLACE FUNCTION t253_showcase.apply_command(
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
       OR payload - ARRAY['mediaKind','mediaExt','mediaMime','mediaBytes','mediaSha','mediaVersion','sourceId','sourceRevision','sourceSha','rightsRef','display','coverSha','coverBytes'] <> '{}'::jsonb
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
    IF payload ?| ARRAY['mediaKind','mediaExt','mediaMime','mediaBytes','mediaSha','mediaVersion'] AND NOT coalesce(
      payload ?& ARRAY['mediaKind','mediaExt','mediaMime','mediaBytes','mediaSha','mediaVersion']
      AND jsonb_typeof(payload->'mediaVersion')='string' AND payload->>'mediaVersion' ~ '^"[!#-~]{1,128}"$'
      AND jsonb_typeof(payload->'mediaBytes')='number' AND payload->>'mediaBytes' ~ '^[1-9][0-9]{0,8}$'
      AND jsonb_typeof(payload->'mediaSha')='string' AND payload->>'mediaSha'=payload->>'sourceSha'
      AND (payload->>'mediaKind',payload->>'mediaExt',payload->>'mediaMime') IN
        (('video','mp4','video/mp4'),('video','webm','video/webm'),('audio','mp3','audio/mpeg'),('audio','m4a','audio/mp4'))
      AND (payload->>'mediaBytes')::numeric <= CASE payload->>'mediaKind' WHEN 'video' THEN 524288000 ELSE 52428800 END,false) THEN
      RAISE EXCEPTION 'invalid media manifest' USING ERRCODE = '22023';
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
        active_media_manifest = CASE WHEN payload ? 'mediaExt' THEN payload END,
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
        active_media_manifest = CASE WHEN slot.active_generation = generation THEN NULL ELSE slot.active_media_manifest END,
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

SET LOCAL ROLE t295_list_owner;
CREATE OR REPLACE FUNCTION t295.list_approved() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT jsonb_build_object('nowMs',floor(extract(epoch FROM statement_timestamp())*1000)::bigint::text,
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('slug',q.slug,'generation',q.active_generation::text,
      'approvedMs',q.approved_ms::text,'display',q.active_display) || CASE WHEN q.active_media_manifest IS NULL THEN '{}'::jsonb ELSE
      jsonb_build_object('media',jsonb_build_object('kind',q.active_media_manifest->>'mediaKind','ext',q.active_media_manifest->>'mediaExt')) END ORDER BY q.approved_ms DESC,q.slug COLLATE "C") FROM (
      SELECT s.slug,s.active_generation,s.approved_ms,s.active_display,s.active_media_manifest
      FROM t253_showcase.slots s JOIN t295.activation a
        ON (a.owner_id,a.slug,a.generation,a.approved_ms)=(s.owner_id,s.slug,s.active_generation,s.approved_ms)
      JOIN t295.frozen_manifest m ON (m.owner_id,m.slug,m.generation)=(a.owner_id,a.slug,a.generation)
      WHERE t295.valid_rights(m.mode,m.expires_at,statement_timestamp())
        AND (a.rights_ref,a.mode,a.expires_at) IS NOT DISTINCT FROM (m.rights_ref,m.mode,m.expires_at)
        AND s.active_media_manifest IS NOT DISTINCT FROM CASE WHEN m.manifest ? 'mediaExt' THEN m.manifest END
        AND s.active_display=m.manifest->'display' AND s.sha=m.manifest->>'coverSha'
        AND s.size_bytes::text=m.manifest->>'coverBytes'
        AND s.object_key=s.slug||'/'||s.active_generation::text||'/'||s.sha||'.webp' AND s.mime='image/webp'
        AND s.approved_ms <= floor(extract(epoch FROM statement_timestamp())*1000)::bigint
      ORDER BY s.approved_ms DESC,s.slug COLLATE "C" LIMIT 25
    ) q),'[]'::jsonb))
$$;

SET LOCAL ROLE t295_file_owner;
CREATE FUNCTION t295.find_media(target_slug text,target_generation bigint)
RETURNS TABLE(object_key text,mime text,size_bytes integer,sha text,ext text,version text) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT s.slug||'/'||s.active_generation::text||'/'||(m.manifest->>'mediaSha')||'.'||(m.manifest->>'mediaExt'),
    m.manifest->>'mediaMime',(m.manifest->>'mediaBytes')::integer,m.manifest->>'mediaSha',m.manifest->>'mediaExt',m.manifest->>'mediaVersion'
  FROM t253_showcase.slots s JOIN t295.activation a
    ON (a.owner_id,a.slug,a.generation,a.approved_ms)=(s.owner_id,s.slug,s.active_generation,s.approved_ms)
  JOIN t295.frozen_manifest m ON (m.owner_id,m.slug,m.generation)=(a.owner_id,a.slug,a.generation)
  WHERE s.active_media_manifest=m.manifest AND m.manifest ? 'mediaExt' AND s.slug=target_slug AND s.active_generation=target_generation
    AND t295.valid_rights(m.mode,m.expires_at,statement_timestamp())
    AND (a.rights_ref,a.mode,a.expires_at) IS NOT DISTINCT FROM (m.rights_ref,m.mode,m.expires_at)
    AND s.active_display=m.manifest->'display' AND s.sha=m.manifest->>'coverSha' AND s.size_bytes::text=m.manifest->>'coverBytes'
    AND s.object_key=s.slug||'/'||s.active_generation::text||'/'||s.sha||'.webp' AND s.mime='image/webp'
    AND s.approved_ms <= floor(extract(epoch FROM statement_timestamp())*1000)::bigint
$$;
REVOKE ALL ON FUNCTION t295.find_media(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t295.find_media(text,bigint) TO t295_file;

SET LOCAL ROLE t341_schema_owner;
REVOKE CREATE ON SCHEMA t253_showcase FROM t253_write_owner;
REVOKE CREATE ON SCHEMA t295 FROM t295_file_owner,t295_list_owner;

SET LOCAL ROLE t341_history_owner;
ALTER TABLE t_publication_install.history DROP CONSTRAINT history_version_check;
ALTER TABLE t_publication_install.history ADD CHECK (version IN (2,3));
RESET ROLE;
