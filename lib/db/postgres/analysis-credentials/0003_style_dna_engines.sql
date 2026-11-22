-- Installs the image analysis engine credential table on the existing
-- credential store. Keep this schema outside the Supabase Data API.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);

CREATE TABLE dream_gemini_credentials.style_dna_engine_credentials (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model_id text NOT NULL CHECK (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  version integer NOT NULL CHECK (version >= 1),
  key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 256),
  tag bytea NOT NULL CHECK (octet_length(tag) = 16),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((provider = 'openai' AND model_id ~* '^(gpt-[a-z0-9]|o[1-9][0-9]*(-|$))')
    OR (provider = 'anthropic' AND model_id ~* '^claude-[a-z0-9]')),
  PRIMARY KEY (owner_id, provider)
);
ALTER TABLE dream_gemini_credentials.style_dna_engine_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_gemini_credentials.style_dna_engine_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY own_style_dna_engine_credentials ON dream_gemini_credentials.style_dna_engine_credentials
  FOR ALL TO dream_gemini_app
  USING (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid);
REVOKE ALL ON TABLE dream_gemini_credentials.style_dna_engine_credentials FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE dream_gemini_credentials.style_dna_engine_credentials TO dream_gemini_app;
GRANT UPDATE (model_id,version,key_id,nonce,ciphertext,tag,updated_at)
  ON dream_gemini_credentials.style_dna_engine_credentials TO dream_gemini_app;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'dream_gemini_credentials.style_dna_engine_credentials'::regclass AND a.grantee <> c.relowner
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type IN ('SELECT','INSERT') AND NOT a.is_grantable)
  ) THEN
    RAISE EXCEPTION 'Style DNA engine credential store has unexpected default privileges';
  END IF;
END
$verify$;
COMMIT;
