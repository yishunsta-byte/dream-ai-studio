BEGIN;
SET LOCAL search_path = pg_catalog;
CREATE ROLE dream_style_dna_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE SCHEMA dream_style_dna;
REVOKE ALL ON SCHEMA dream_style_dna FROM PUBLIC;
GRANT USAGE ON SCHEMA dream_style_dna TO dream_style_dna_app;

CREATE TABLE dream_style_dna.records (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 100),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX style_dna_records_created ON dream_style_dna.records (owner_id,created_at DESC,id);

CREATE TABLE dream_style_dna.media (
  owner_id uuid NOT NULL,
  record_id uuid NOT NULL,
  id uuid NOT NULL,
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 8388608),
  PRIMARY KEY (owner_id,record_id,id),
  FOREIGN KEY (owner_id,record_id) REFERENCES dream_style_dna.records (owner_id,id) ON DELETE RESTRICT
);

CREATE TABLE dream_style_dna.requests (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object'),
  PRIMARY KEY (owner_id,id)
);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['records','media','requests'] LOOP
    EXECUTE format('ALTER TABLE dream_style_dna.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE dream_style_dna.%I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY style_dna_owner ON dream_style_dna.%I FOR ALL TO dream_style_dna_app
      USING (owner_id = nullif(current_setting(''dream_style_dna.owner_id'',true),'''')::uuid)
      WITH CHECK (owner_id = nullif(current_setting(''dream_style_dna.owner_id'',true),'''')::uuid)',name);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON dream_style_dna.records, dream_style_dna.media, dream_style_dna.requests TO dream_style_dna_app;
GRANT UPDATE(revision,document) ON dream_style_dna.records TO dream_style_dna_app;
GRANT UPDATE(outcome) ON dream_style_dna.requests TO dream_style_dna_app;
COMMIT;
