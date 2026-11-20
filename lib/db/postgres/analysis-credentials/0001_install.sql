-- Separate server credential store. Run on the approved Supabase PostgreSQL
-- target as the schema owner. Do not expose the schema through the Data API.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);

CREATE ROLE dream_gemini_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA dream_gemini_credentials;
REVOKE ALL ON SCHEMA dream_gemini_credentials FROM PUBLIC;

CREATE TABLE dream_gemini_credentials.credentials (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_group text NOT NULL CHECK (provider_group IN ('reference','music')),
  version integer NOT NULL CHECK (version >= 1),
  models jsonb NOT NULL CHECK (jsonb_typeof(models) = 'object'),
  key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 256),
  tag bytea NOT NULL CHECK (octet_length(tag) = 16),
  last_test jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(last_test) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, provider_group)
);
ALTER TABLE dream_gemini_credentials.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_gemini_credentials.credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY own_credentials ON dream_gemini_credentials.credentials FOR ALL TO dream_gemini_app
  USING (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid);
REVOKE ALL ON TABLE dream_gemini_credentials.credentials FROM PUBLIC;
GRANT USAGE ON SCHEMA dream_gemini_credentials TO dream_gemini_app;
GRANT SELECT, INSERT ON TABLE dream_gemini_credentials.credentials TO dream_gemini_app;
GRANT UPDATE (version,models,key_id,nonce,ciphertext,tag,last_test,updated_at)
  ON dream_gemini_credentials.credentials TO dream_gemini_app;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname = 'dream_gemini_credentials' AND a.grantee <> n.nspowner
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type = 'USAGE' AND NOT a.is_grantable)
  ) OR EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'dream_gemini_credentials.credentials'::regclass AND a.grantee <> c.relowner
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type IN ('SELECT','INSERT') AND NOT a.is_grantable)
  ) THEN
    RAISE EXCEPTION 'Gemini credential store has unexpected default privileges';
  END IF;
END
$verify$;
COMMIT;
