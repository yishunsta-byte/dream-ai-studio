-- P2-02 GPT Image: lets the request ledger bind 'gpt-image-2.6' (OpenAI gpt-image-2.6-sunburst) next to the
-- fixed-price models. Only 0004's own constraint style_dna_generation_model_bound changes; it is replaced under the
-- same name only when its definition is exactly 0004's (or already this file's). Every other CHECK, the immutability
-- trigger, row security and grants stay as they are. Re-running is safe.
-- The expected definitions are rendered by PostgreSQL itself from a throwaway temp table (no hand-written deparse text).
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
LOCK TABLE dream_style_dna.requests IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE style_dna_gpt_image_shape (generation_model text, generation_record_id uuid,
  CONSTRAINT v0004 CHECK (generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro'))),
  CONSTRAINT v0005 CHECK (generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro','gpt-image-2.6'))))
  ON COMMIT DROP;
DO $install$
DECLARE
  old_def text; new_def text; current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_def FROM pg_constraint WHERE conrelid = 'pg_temp.style_dna_gpt_image_shape'::regclass AND conname = 'v0004';
  SELECT pg_get_constraintdef(oid) INTO new_def FROM pg_constraint WHERE conrelid = 'pg_temp.style_dna_gpt_image_shape'::regclass AND conname = 'v0005';
  SELECT pg_get_constraintdef(oid) INTO current_def FROM pg_constraint
    WHERE conrelid = 'dream_style_dna.requests'::regclass AND contype = 'c' AND conname = 'style_dna_generation_model_bound';
  IF current_def IS NULL THEN RAISE EXCEPTION 'STYLE_DNA_GPT_IMAGE_0004_MISSING'; END IF;
  IF current_def = new_def THEN RETURN; END IF;
  IF current_def <> old_def THEN RAISE EXCEPTION 'STYLE_DNA_GPT_IMAGE_UNEXPECTED_CHECK'; END IF;
  ALTER TABLE dream_style_dna.requests DROP CONSTRAINT style_dna_generation_model_bound;
  ALTER TABLE dream_style_dna.requests ADD CONSTRAINT style_dna_generation_model_bound CHECK (
    generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro','gpt-image-2.6')));
END
$install$;
DO $verify$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'dream_style_dna.requests'::regclass AND conname = 'style_dna_generation_model_bound')
    IS DISTINCT FROM (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'pg_temp.style_dna_gpt_image_shape'::regclass AND conname = 'v0005')
  OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid = 'dream_style_dna.requests'::regclass AND tgname = 'style_dna_generation_model_guard')
  OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dream_style_dna.requests'::regclass) THEN
    RAISE EXCEPTION 'Style DNA request ledger did not reach the GPT Image model list';
  END IF;
END
$verify$;
COMMIT;
