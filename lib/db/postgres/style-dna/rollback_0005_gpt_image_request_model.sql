-- Reverts 0005_gpt_image_request_model.sql: style_dna_generation_model_bound goes back to 0004's list.
-- Stops (nothing changes) while any request is bound to 'gpt-image-2.6'; this file never deletes ledger rows.
-- Only that one constraint (by name and exact definition) changes. Other CHECKs, the trigger and grants stay.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
LOCK TABLE dream_style_dna.requests IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE style_dna_gpt_image_shape (generation_model text, generation_record_id uuid,
  CONSTRAINT v0004 CHECK (generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro'))),
  CONSTRAINT v0005 CHECK (generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro','gpt-image-2.6'))))
  ON COMMIT DROP;
-- Row security is forced, so the history check below would see no rows. Lift it for this transaction only.
ALTER TABLE dream_style_dna.requests NO FORCE ROW LEVEL SECURITY;
DO $rollback$
DECLARE
  old_def text; new_def text; current_def text;
BEGIN
  IF EXISTS (SELECT FROM dream_style_dna.requests WHERE generation_model = 'gpt-image-2.6') THEN
    RAISE EXCEPTION 'STYLE_DNA_GPT_IMAGE_HAS_HISTORY';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO old_def FROM pg_constraint WHERE conrelid = 'pg_temp.style_dna_gpt_image_shape'::regclass AND conname = 'v0004';
  SELECT pg_get_constraintdef(oid) INTO new_def FROM pg_constraint WHERE conrelid = 'pg_temp.style_dna_gpt_image_shape'::regclass AND conname = 'v0005';
  SELECT pg_get_constraintdef(oid) INTO current_def FROM pg_constraint
    WHERE conrelid = 'dream_style_dna.requests'::regclass AND contype = 'c' AND conname = 'style_dna_generation_model_bound';
  IF current_def IS DISTINCT FROM new_def THEN
    RAISE EXCEPTION '%', CASE WHEN current_def = old_def THEN 'STYLE_DNA_GPT_IMAGE_ROLLBACK_NOT_INSTALLED' ELSE 'STYLE_DNA_GPT_IMAGE_UNEXPECTED_CHECK' END;
  END IF;
  ALTER TABLE dream_style_dna.requests DROP CONSTRAINT style_dna_generation_model_bound;
  ALTER TABLE dream_style_dna.requests ADD CONSTRAINT style_dna_generation_model_bound CHECK (
    generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro')));
END
$rollback$;
ALTER TABLE dream_style_dna.requests FORCE ROW LEVEL SECURITY;
DO $verify$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'dream_style_dna.requests'::regclass AND conname = 'style_dna_generation_model_bound')
    IS DISTINCT FROM (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'pg_temp.style_dna_gpt_image_shape'::regclass AND conname = 'v0004')
  OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid = 'dream_style_dna.requests'::regclass AND tgname = 'style_dna_generation_model_guard')
  OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dream_style_dna.requests'::regclass) THEN
    RAISE EXCEPTION 'Style DNA request ledger rollback did not restore the 0004 model list';
  END IF;
END
$verify$;
COMMIT;
