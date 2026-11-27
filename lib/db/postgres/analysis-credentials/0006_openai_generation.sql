-- P2-02 GPT Image: adds OpenAI ('openai', gpt-image-2.6-sunburst) to the Style DNA image generation credential
-- table. It needs 0005 and changes only 0005's own constraint style_dna_generation_provider, identified by name
-- AND exact definition; it keeps that name. Every other CHECK, row security, grants and the encryption layout stay.
-- An 'openai' generation key is its own row with its own version; it never reads or shares the analysis-engine
-- OpenAI key. Re-running is safe.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);

DO $install$
DECLARE
  table_oid regclass := to_regclass('dream_gemini_credentials.style_dna_generation_credentials');
  own_def text;
BEGIN
  IF table_oid IS NULL THEN RAISE EXCEPTION 'Install 0004 and 0005 before 0006'; END IF;
  SELECT pg_get_constraintdef(oid) INTO own_def FROM pg_constraint
    WHERE conrelid = table_oid AND contype = 'c' AND conname = 'style_dna_generation_provider';
  IF own_def IS NULL THEN RAISE EXCEPTION 'STYLE_DNA_GENERATION_0006_NEEDS_0005'; END IF;
  IF own_def = 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text, ''openai''::text])))' THEN RETURN; END IF;
  IF own_def <> 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text])))' THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_0006_UNEXPECTED_OWN_CHECK';
  END IF;
  ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT style_dna_generation_provider;
  ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials
    ADD CONSTRAINT style_dna_generation_provider CHECK (provider IN ('byteplus','bfl','openai'));
END
$install$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint
      WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass
        AND conname = 'style_dna_generation_provider'
        AND pg_get_constraintdef(oid) = 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text, ''openai''::text])))')
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
