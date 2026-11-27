-- Restore pre-0004 only while no authoritative model binding would be lost.
BEGIN;
SET LOCAL search_path=pg_catalog;
LOCK TABLE dream_style_dna.requests IN ACCESS EXCLUSIVE MODE;
ALTER TABLE dream_style_dna.requests NO FORCE ROW LEVEL SECURITY;
DO $rollback$
BEGIN
  IF EXISTS (SELECT FROM dream_style_dna.requests WHERE generation_model IS NOT NULL)
  THEN RAISE EXCEPTION 'STYLE_DNA_GENERATION_MODEL_HAS_HISTORY'; END IF;
END $rollback$;
DROP TRIGGER style_dna_generation_model_guard ON dream_style_dna.requests;
DROP FUNCTION dream_style_dna.guard_generation_model();
ALTER TABLE dream_style_dna.requests DROP COLUMN generation_model;
ALTER TABLE dream_style_dna.requests FORCE ROW LEVEL SECURITY;
COMMIT;
