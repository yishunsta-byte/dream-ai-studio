-- Reverts 0006_openai_generation.sql: style_dna_generation_provider goes back to 0005's list ('byteplus','bfl').
-- Stops (nothing changes) while any account still has a saved OpenAI generation key; remove those keys deliberately
-- first, this file never deletes credentials. Only that constraint (by name and exact definition) changes.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(175840031, 2);
-- Row security is forced on the table, so the owner check below would see no rows. Lift it for this transaction only.
ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials NO FORCE ROW LEVEL SECURITY;
DO $rollback$
DECLARE
  own_def text;
BEGIN
  IF EXISTS (SELECT FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider = 'openai') THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_ROLLBACK_OPENAI_KEYS';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO own_def FROM pg_constraint
    WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND contype = 'c'
      AND conname = 'style_dna_generation_provider';
  IF own_def = 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text])))' THEN RAISE EXCEPTION 'STYLE_DNA_GENERATION_ROLLBACK_0006_NOT_INSTALLED'; END IF;
  IF own_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text, ''openai''::text])))' THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_0006_UNEXPECTED_OWN_CHECK';
  END IF;
  ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT style_dna_generation_provider;
  ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials
    ADD CONSTRAINT style_dna_generation_provider CHECK (provider IN ('byteplus','bfl'));
END
$rollback$;
ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials FORCE ROW LEVEL SECURITY;
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint
      WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass
        AND conname = 'style_dna_generation_provider' AND pg_get_constraintdef(oid) = 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text])))')
  OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass) THEN
    RAISE EXCEPTION 'Style DNA generation credential rollback did not restore the 0005 provider list';
  END IF;
END
$verify$;
COMMIT;
