-- P1-08-SHORTS-VAULT: Shorts prompt sets (kept until the owner deletes them, at most 200)
-- and 30-day exploration projects. Same shape as dream_style_dna: one schema, one NOLOGIN
-- application role made LOGIN by the operator after install, owner rows by forced RLS.
-- Documents hold YouTube video IDs and this product's own generated text only.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regnamespace('dream_shorts_vault') IS NOT NULL
    OR EXISTS (SELECT FROM pg_roles WHERE rolname = 'dream_shorts_vault_app')
  THEN RAISE EXCEPTION 'SHORTS_VAULT_INSTALL_TARGET'; END IF;
END $$;

CREATE ROLE dream_shorts_vault_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
CREATE SCHEMA dream_shorts_vault;
REVOKE ALL ON SCHEMA dream_shorts_vault FROM PUBLIC;
GRANT USAGE ON SCHEMA dream_shorts_vault TO dream_shorts_vault_app;

CREATE TABLE dream_shorts_vault.prompt_sets (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX shorts_vault_prompt_sets_created ON dream_shorts_vault.prompt_sets (owner_id, created_at DESC, id);

CREATE TABLE dream_shorts_vault.projects (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 1000000),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 524288),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = created_at + interval '30 days'),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX shorts_vault_projects_updated ON dream_shorts_vault.projects (owner_id, updated_at DESC, id);
CREATE INDEX shorts_vault_projects_expiry ON dream_shorts_vault.projects (owner_id, expires_at);

-- Idempotent create: the same request id with the same input returns the first outcome.
CREATE TABLE dream_shorts_vault.requests (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('prompt_set', 'project')),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object' AND octet_length(outcome::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX shorts_vault_requests_created ON dream_shorts_vault.requests (owner_id, created_at);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['prompt_sets', 'projects', 'requests'] LOOP
    EXECUTE format('ALTER TABLE dream_shorts_vault.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE dream_shorts_vault.%I FORCE ROW LEVEL SECURITY', name);
  END LOOP;
END $$;
-- Owner is the transaction-local setting written by the server after it verifies the session.
CREATE POLICY shorts_vault_owner ON dream_shorts_vault.prompt_sets FOR ALL TO dream_shorts_vault_app
  USING (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid);
CREATE POLICY shorts_vault_owner ON dream_shorts_vault.requests FOR ALL TO dream_shorts_vault_app
  USING (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid);
-- Expired projects can no longer be created or overwritten. SELECT stays owner-only (not expiry-filtered)
-- because DELETE ... WHERE also applies SELECT policies and the server must still purge expired rows;
-- every server transaction purges the owner's expired rows first and every read filters expires_at.
CREATE POLICY shorts_vault_project_read ON dream_shorts_vault.projects FOR SELECT TO dream_shorts_vault_app
  USING (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid);
CREATE POLICY shorts_vault_project_insert ON dream_shorts_vault.projects FOR INSERT TO dream_shorts_vault_app
  WITH CHECK (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid AND expires_at > clock_timestamp());
CREATE POLICY shorts_vault_project_update ON dream_shorts_vault.projects FOR UPDATE TO dream_shorts_vault_app
  USING (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid AND expires_at > clock_timestamp())
  WITH CHECK (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid AND expires_at > clock_timestamp());
CREATE POLICY shorts_vault_project_delete ON dream_shorts_vault.projects FOR DELETE TO dream_shorts_vault_app
  USING (owner_id = nullif(current_setting('dream_shorts_vault.owner_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON dream_shorts_vault.prompt_sets TO dream_shorts_vault_app;
GRANT SELECT, INSERT, DELETE ON dream_shorts_vault.projects TO dream_shorts_vault_app;
GRANT UPDATE (revision, document, updated_at) ON dream_shorts_vault.projects TO dream_shorts_vault_app;
GRANT SELECT, INSERT, DELETE ON dream_shorts_vault.requests TO dream_shorts_vault_app;
COMMIT;
