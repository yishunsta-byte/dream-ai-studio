BEGIN;
SET LOCAL search_path = pg_catalog;
CREATE ROLE dream_audio_upload_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE SCHEMA dream_audio_upload;
REVOKE ALL ON SCHEMA dream_audio_upload FROM PUBLIC;
GRANT USAGE ON SCHEMA dream_audio_upload TO dream_audio_upload_app;

CREATE TABLE dream_audio_upload.uploads (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  credential_version int NOT NULL CHECK (credential_version >= 1),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 5 AND 255),
  size_bytes int NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
  received_bytes int NOT NULL DEFAULT 0 CHECK (received_bytes BETWEEN 0 AND size_bytes),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 minutes'),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','uploaded','analyzing','completed','failed','cancelled','expired')),
  analysis_id uuid,
  analysis_hash text CHECK (analysis_hash ~ '^[0-9a-f]{64}$'),
  report jsonb CHECK (jsonb_typeof(report)='object'),
  code text,
  provider_file text CHECK (provider_file ~ '^files/[a-z0-9][a-z0-9-]{0,39}$'),
  cleanup text NOT NULL DEFAULT 'none' CHECK (cleanup IN ('none','pending','done','unconfirmed')),
  PRIMARY KEY (owner_id,id),
  UNIQUE (owner_id,request_id),
  CHECK ((analysis_id IS NULL) = (analysis_hash IS NULL)),
  CHECK (status NOT IN ('analyzing','completed','failed') OR (analysis_id IS NOT NULL AND received_bytes=size_bytes)),
  CHECK ((status='completed') = (report IS NOT NULL)),
  CHECK ((cleanup='pending') = (provider_file IS NOT NULL))
);
CREATE INDEX audio_upload_active ON dream_audio_upload.uploads(owner_id,expires_at) WHERE status IN ('uploading','uploaded','analyzing');

CREATE TABLE dream_audio_upload.chunks (
  owner_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  offset_bytes int NOT NULL CHECK (offset_bytes >= 0 AND offset_bytes < 104857600 AND offset_bytes % 2097152 = 0),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152 AND offset_bytes + octet_length(data) <= 104857600),
  PRIMARY KEY (owner_id,upload_id,offset_bytes),
  FOREIGN KEY (owner_id,upload_id) REFERENCES dream_audio_upload.uploads(owner_id,id) ON DELETE RESTRICT
);

DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['uploads','chunks'] LOOP
    EXECUTE format('ALTER TABLE dream_audio_upload.%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE dream_audio_upload.%I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY audio_upload_owner ON dream_audio_upload.%I FOR ALL TO dream_audio_upload_app
      USING (owner_id=nullif(current_setting(''dream_audio_upload.owner_id'',true),'''')::uuid)
      WITH CHECK (owner_id=nullif(current_setting(''dream_audio_upload.owner_id'',true),'''')::uuid)',relation);
  END LOOP;
END $$;
GRANT SELECT ON dream_audio_upload.uploads, dream_audio_upload.chunks TO dream_audio_upload_app;
GRANT INSERT(owner_id,id,request_id,request_hash,credential_version,filename,size_bytes) ON dream_audio_upload.uploads TO dream_audio_upload_app;
GRANT UPDATE(received_bytes,status,analysis_id,analysis_hash,report,code,provider_file,cleanup) ON dream_audio_upload.uploads TO dream_audio_upload_app;
GRANT INSERT, DELETE ON dream_audio_upload.chunks TO dream_audio_upload_app;

-- The database operator can schedule this bounded sweep for abandoned sessions.
-- It runs under the scheduler's own privileges and is unavailable to the app role.
CREATE FUNCTION dream_audio_upload.reap_expired_uploads() RETURNS integer
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
  WITH due AS (
    SELECT owner_id, id FROM dream_audio_upload.uploads
    WHERE expires_at <= clock_timestamp() AND status IN ('uploading','uploaded','analyzing')
    ORDER BY expires_at, owner_id, id
    LIMIT 100 FOR UPDATE SKIP LOCKED
  ), expired AS (
    UPDATE dream_audio_upload.uploads u SET status='expired',code='expired'
    FROM due WHERE (u.owner_id,u.id)=(due.owner_id,due.id)
    RETURNING u.owner_id,u.id
  ), removed AS (
    DELETE FROM dream_audio_upload.chunks c USING expired e
    WHERE (c.owner_id,c.upload_id)=(e.owner_id,e.id)
  )
  SELECT count(*)::int FROM expired;
$$;
REVOKE ALL ON FUNCTION dream_audio_upload.reap_expired_uploads() FROM PUBLIC;
COMMIT;
