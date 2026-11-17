-- Run as the migration owner, never as an application credential.
-- Roles intentionally have NOLOGIN; provisioning passwords/membership is a separate operation.
-- Do not grant these roles to Supabase anon/authenticated/authenticator.
BEGIN;
CREATE ROLE dream_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE dream_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE FUNCTION dream.actor_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
 SELECT nullif(current_setting('dream.actor_id',true),'')::uuid
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dream FROM PUBLIC;
GRANT USAGE ON SCHEMA dream TO dream_api,dream_worker;
GRANT USAGE ON DOMAIN dream.safe_uint,dream.safe_positive,dream.sha256 TO dream_api,dream_worker;
GRANT EXECUTE ON FUNCTION dream.actor_id(),dream.valid_object_key(text,uuid) TO dream_api,dream_worker;
-- Trigger invocation does not confer SECURITY DEFINER privileges. Cross-table checks run as the caller.

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['activity_log','assets','backups','characters','exports','generations','jobs','plans',
   'project_assets','project_characters','projects','review_items','scene_versions','scenes','settings','stage_states',
   'timeline_revisions','renders'] LOOP
   EXECUTE format('REVOKE ALL ON TABLE dream.%I FROM PUBLIC',t);
   EXECUTE format('ALTER TABLE dream.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE dream.%I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE dream.%I TO dream_api',t);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE dream.%I TO dream_worker',t);
   EXECUTE format('CREATE POLICY owner_access ON dream.%I FOR ALL TO dream_api USING (owner_id=(SELECT dream.actor_id())) WITH CHECK (owner_id=(SELECT dream.actor_id()))',t);
   EXECUTE format('CREATE POLICY worker_access ON dream.%I FOR ALL TO dream_worker USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
-- Neither role gets TRUNCATE, REFERENCES, schema CREATE, role management, or table ownership.
-- Actor must be set with set_config('dream.actor_id',verified_user_uuid,true) inside EACH transaction.
-- Only the trusted backend owns dream_api's database connection; this is not a browser/RPC parameter.
-- dream_worker is a trusted cross-owner worker principal, not an RLS tenant identity.
COMMIT;
