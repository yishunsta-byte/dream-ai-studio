BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

-- Match record receipts and the legacy test/comparison receipts by their stored identifiers.
CREATE INDEX style_dna_request_outcome_record
  ON dream_style_dna.requests (owner_id,
    (COALESCE(outcome#>>'{body,record,id}', outcome#>>'{body,test,id}', outcome#>>'{body,comparison,baseline,testId}')))
  WHERE outcome IS NOT NULL;

GRANT DELETE ON dream_style_dna.records, dream_style_dna.media TO dream_style_dna_app;

COMMIT;
