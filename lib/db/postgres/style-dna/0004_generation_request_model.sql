-- Existing rows keep NULL: their fingerprints and outcomes carry no authoritative request model.
BEGIN;
SET LOCAL search_path=pg_catalog;
ALTER TABLE dream_style_dna.requests
  ADD COLUMN generation_model text,
  ADD CONSTRAINT style_dna_generation_model_bound CHECK (
    generation_model IS NULL OR (generation_record_id IS NOT NULL AND generation_model IN ('seedream-5.5','flux-2-pro'))
  );

CREATE FUNCTION dream_style_dna.guard_generation_model() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
  IF NEW.generation_model IS DISTINCT FROM OLD.generation_model
    OR (OLD.generation_model IS NOT NULL AND (NEW.owner_id,NEW.id,NEW.generation_record_id)
      IS DISTINCT FROM (OLD.owner_id,OLD.id,OLD.generation_record_id)) THEN
    RAISE EXCEPTION 'style dna generation model binding is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION dream_style_dna.guard_generation_model() FROM PUBLIC;
CREATE TRIGGER style_dna_generation_model_guard
  BEFORE UPDATE OF owner_id,id,generation_record_id,generation_model ON dream_style_dna.requests
  FOR EACH ROW EXECUTE FUNCTION dream_style_dna.guard_generation_model();
COMMIT;
