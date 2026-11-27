-- Reverts 0005_bfl_generation.sql: the provider list goes back to 0004's CHECK (provider IN ('byteplus')),
-- restored under 0004's own constraint name so 0005 can be installed again.
-- Stops (nothing changes) while any account still has a saved BFL key. Remove those keys deliberately first;
-- this file never deletes credentials. Only 0005's own constraint (by name and exact definition) is dropped;
-- every other CHECK on the table, BytePlus rows and 0004 privileges are untouched.
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
  IF EXISTS (SELECT FROM dream_gemini_credentials.style_dna_generation_credentials WHERE provider <> 'byteplus') THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_ROLLBACK_BFL_KEYS';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO own_def FROM pg_constraint
    WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND contype = 'c'
      AND conname = 'style_dna_generation_provider';
  IF own_def IS NULL THEN RAISE EXCEPTION 'STYLE_DNA_GENERATION_ROLLBACK_NOT_INSTALLED'; END IF;
  IF own_def <> 'CHECK ((provider = ANY (ARRAY[''byteplus''::text, ''bfl''::text])))' THEN
    RAISE EXCEPTION 'STYLE_DNA_GENERATION_0005_UNEXPECTED_OWN_CHECK';
  END IF;
  ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials DROP CONSTRAINT style_dna_generation_provider;
  ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials
    ADD CONSTRAINT style_dna_generation_credentials_provider_check CHECK (provider IN ('byteplus'));
END
$rollback$;
ALTER TABLE dream_gemini_credentials.style_dna_generation_credentials FORCE ROW LEVEL SECURITY;
DO $verify$
BEGIN
  IF EXISTS (SELECT FROM pg_constraint
      WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass AND conname = 'style_dna_generation_provider')
  OR NOT EXISTS (SELECT FROM pg_constraint
      WHERE conrelid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass
        AND conname = 'style_dna_generation_credentials_provider_check' AND pg_get_constraintdef(oid) = 'CHECK ((provider = ''byteplus''::text))')
  OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'dream_gemini_credentials.style_dna_generation_credentials'::regclass) THEN
    RAISE EXCEPTION 'Style DNA generation credential rollback did not restore the 0004 provider list';
  END IF;
END
$verify$;
COMMIT;
