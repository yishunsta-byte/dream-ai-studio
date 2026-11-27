-- Installs the Style DNA image generation credential table on the existing
-- credential store (0001). Separate from the analysis engine table (0003):
-- its own provider list, version and AAD, no model column (generation models
-- are fixed in code). Keep this schema outside the Supabase Data API.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);

CREATE TABLE dream_gemini_credentials.style_dna_generation_credentials (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('byteplus')),
  version integer NOT NULL CHECK (version >= 1),
  key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 256),
  tag bytea NOT NULL CHECK (octet_length(tag) = 16),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, provider)
);
ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY own_style_dna_generation_credentials ON dream_gemini_credentials.style_dna_generation_credentials
  FOR ALL TO dream_gemini_app
  USING (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('dream_gemini.owner_id', true), '')::uuid);
REVOKE ALL ON TABLE dream_gemini_credentials.style_dna_generation_credentials FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE dream_gemini_credentials.style_dna_generation_credentials TO dream_gemini_app;
GRANT UPDATE (version,key_id,nonce,ciphertext,tag,updated_at)
  ON dream_gemini_credentials.style_dna_generation_credentials TO dream_gemini_app;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND a.grantee <> c.relowner
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type IN ('SELECT','INSERT') AND NOT a.is_grantable)
  ) OR EXISTS (
    SELECT FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
    WHERE t.attrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND t.attnum > 0
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type = 'UPDATE' AND NOT a.is_grantable
        AND t.attname IN ('version','key_id','nonce','ciphertext','tag','updated_at'))
  ) OR (
    SELECT count(*) FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
    WHERE t.attrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND t.attnum > 0
  ) <> 6 OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass) THEN
    RAISE EXCEPTION 'Style DNA generation credential store has unexpected privileges';
  END IF;
END
$verify$;
COMMIT;
