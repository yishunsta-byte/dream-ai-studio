-- Add the YouTube key table after 0001_install.sql on the same approved target.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);

CREATE TABLE dream_gemini_credentials.youtube_credentials (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 256),
  tag bytea NOT NULL CHECK (octet_length(tag) = 16),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE dream_gemini_credentials.youtube_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_gemini_credentials.youtube_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY own_youtube_credentials ON dream_gemini_credentials.youtube_credentials FOR ALL TO dream_gemini_app
  USING (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid);
REVOKE ALL ON TABLE dream_gemini_credentials.youtube_credentials FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE dream_gemini_credentials.youtube_credentials TO dream_gemini_app;
GRANT UPDATE (version,key_id,nonce,ciphertext,tag,updated_at)
  ON dream_gemini_credentials.youtube_credentials TO dream_gemini_app;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'dream_gemini_credentials.youtube_credentials'::regclass AND a.grantee <> c.relowner
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type IN ('SELECT','INSERT') AND NOT a.is_grantable)
  ) THEN
    RAISE EXCEPTION 'YouTube credential store has unexpected default privileges';
  END IF;
END
$verify$;
COMMIT;
