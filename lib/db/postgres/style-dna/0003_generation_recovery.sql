BEGIN;
SET LOCAL search_path = pg_catalog;

ALTER TABLE dream_style_dna.requests ADD COLUMN generation_record_id uuid;

CREATE UNIQUE INDEX style_dna_one_pending_generation
  ON dream_style_dna.requests (owner_id, generation_record_id)
  WHERE generation_record_id IS NOT NULL AND outcome IS NULL;

COMMIT;
