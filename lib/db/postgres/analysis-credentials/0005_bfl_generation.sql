-- P2-02-STYLE-DNA-FLUX2-CREDENTIAL-SERVER: adds Black Forest Labs ('bfl', FLUX.2 pro) to the Style DNA
-- image generation credential table installed by 0004. Only the provider list changes; the table,
-- row security, grants and encryption layout stay exactly as 0004 left them. Re-running is safe.
-- Only two constraints are touched, each identified by name AND exact definition:
--   style_dna_generation_credentials_provider_check  0004's column CHECK (provider IN ('byteplus'))
--   style_dna_generation_provider                     this file's CHECK (provider IN ('byteplus','bfl'))
-- Any other CHECK on the table, even one that mentions provider, is left as it is.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);

DO $install$
DECLARE
  table_oid regclass := to_regclass('dream_gemini_credentials.style_dna_generation_credentials');
  base_def text;
  own_def text;
BEGIN
  IF table_oid IS NULL THEN RAISE EXCEPTION 'Install 0004_style_dna_generation.sql before 0005'; END IF;
  SELECT pg_get_constraintdef(oid) INTO base_def FROM pg_constraint
    WHERE conrelid = table_oid AND contype = 'c' AND conname = 'style_dna_generation_credentials_provider_check';
  SELECT pg_get_constraintdef(oid) INTO own_def FROM pg_constraint
    WHERE conrelid = table_oid AND contype = 'c' AND conname = 'style_dna_generation_provider';
  IF base_def IS NOT NULL AND base_def <> 'CHECK ((provider = ''byteplus''::text))' THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_0005_UNEXPECTED_BASE_CHECK';
  END IF;
  IF own_def IS NOT NULL AND own_def <> 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text])))' THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_0005_UNEXPECTED_OWN_CHECK';
  END IF;
  IF base_def IS NULL AND own_def IS NULL THEN RAISE EXCEPTION 'STYLE_DNA_GENERATION_0005_PROVIDER_CHECK_MISSING'; END IF;
  IF base_def IS NOT NULL THEN
    ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT style_dna_generation_credentials_provider_check;
  END IF;
  IF own_def IS NULL THEN
    ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials
      ADD CONSTRAINT style_dna_generation_provider CHECK (provider IN ('byteplus','bfl'));
  END IF;
END
$install$;

DO $verify$
BEGIN
  IF EXISTS (SELECT FROM pg_constraint
      WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass
        AND conname = 'style_dna_generation_credentials_provider_check')
  OR NOT EXISTS (SELECT FROM pg_constraint
      WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass
        AND conname = 'style_dna_generation_provider'
        AND pg_get_constraintdef(oid) = 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text])))')
  -- 0004 privileges are unchanged: app role SELECT/INSERT on the table and UPDATE on the six key columns only.
  OR EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND a.grantee <> c.relowner
      AND NOT (a.grantee = 'dream_gemini_app'::regrole AND a.privilege_type IN ('SELECT','INSERT') AND NOT a.is_grantable))
  OR (SELECT count(*) FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
    WHERE t.attrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND t.attnum > 0) <> 6
  OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass) THEN
    RAISE EXCEPTION 'Style DNA generation credential store has unexpected constraints or privileges';
  END IF;
END
$verify$;
COMMIT;
