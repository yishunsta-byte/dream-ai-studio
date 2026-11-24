-- Synthetic adapter candidate. Install after the fixed T253 fixture in the same disposable cluster.
DO $$ BEGIN
  IF session_user <> 't293_bootstrap' OR current_database() !~ '^t253_[a-f0-9]{32}$'
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
     OR to_regnamespace('t253_showcase') IS NULL THEN
    RAISE EXCEPTION 'T293 requires the owned loopback PG17 fixture';
  END IF;
END $$;

CREATE ROLE t293_app NOLOGIN NOBYPASSRLS;
CREATE ROLE t293_gateway NOLOGIN NOBYPASSRLS;
GRANT t253_publish TO t293_gateway;
CREATE SCHEMA t293;
REVOKE ALL ON SCHEMA t293 FROM PUBLIC;
GRANT USAGE ON SCHEMA t293 TO t293_app, t293_gateway, t253_write_owner;

CREATE FUNCTION t293.actor() RETURNS uuid LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE session_user
    WHEN 't293_actor_a' THEN '10000000-0000-4000-8000-0000000000a1'::uuid
    WHEN 't293_actor_b' THEN '10000000-0000-4000-8000-0000000000b1'::uuid
  END WHERE current_setting('t293.actor', true) = CASE session_user
    WHEN 't293_actor_a' THEN '10000000-0000-4000-8000-0000000000a1'
    WHEN 't293_actor_b' THEN '10000000-0000-4000-8000-0000000000b1'
  END
$$;
REVOKE ALL ON FUNCTION t293.actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.actor() TO t293_app, t293_gateway, t253_write_owner;

CREATE FUNCTION t293.can_publish() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid := t293.actor();
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  PERFORM set_config('t253.actor', actor::text, true);
  RETURN EXISTS (SELECT 1 FROM t253_showcase.publishers WHERE publishers.actor = t293.actor());
END $$;
ALTER FUNCTION t293.can_publish() OWNER TO t253_write_owner;
REVOKE ALL ON FUNCTION t293.can_publish() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.can_publish() TO t293_app, t293_gateway;

CREATE FUNCTION t293.approved_ms(target_slug text, target_generation bigint) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  SELECT approved_ms::text FROM t253_showcase.slots WHERE slug=target_slug
    AND active_generation=target_generation AND owner_id=t293.actor()
$$;
ALTER FUNCTION t293.approved_ms(text,bigint) OWNER TO t253_write_owner;
REVOKE ALL ON FUNCTION t293.approved_ms(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.approved_ms(text,bigint) TO t293_app;

CREATE FUNCTION t293.apply_t253(request_id uuid, command text, slug text, version bigint, generation bigint, manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
BEGIN
  IF NOT t293.can_publish() THEN RAISE EXCEPTION 'publisher denied' USING ERRCODE = '42501'; END IF;
  RETURN t253_showcase.apply_command(request_id, command, slug, version, generation, manifest);
END $$;
ALTER FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) OWNER TO t293_gateway;
REVOKE ALL ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION t293.apply_t253(uuid,text,text,bigint,bigint,jsonb) TO t293_app;

CREATE TABLE t293.works (
  owner_id uuid NOT NULL, slug text PRIMARY KEY, state jsonb NOT NULL,
  UNIQUE (owner_id, slug),
  CHECK ((state->>'ownerId')::uuid IS NOT DISTINCT FROM owner_id AND state->>'slug' IS NOT DISTINCT FROM slug)
);
CREATE TABLE t293.evidence (
  owner_id uuid NOT NULL, slug text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(owner_id, slug),
  FOREIGN KEY(owner_id, slug) REFERENCES t293.works(owner_id, slug)
);
CREATE TABLE t293.cover_objects (
  owner_id uuid NOT NULL, object_key text NOT NULL, bytes bytea NOT NULL, PRIMARY KEY(owner_id, object_key),
  CHECK (octet_length(bytes) BETWEEN 1 AND 5242880)
);
CREATE TABLE t293.manifests (
  owner_id uuid NOT NULL, slug text NOT NULL, generation bigint NOT NULL CHECK (generation > 0), value jsonb NOT NULL,
  PRIMARY KEY(owner_id, slug, generation), FOREIGN KEY(owner_id, slug) REFERENCES t293.works(owner_id, slug)
);
CREATE TABLE t293.app_requests (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, slug text NOT NULL, entry jsonb NOT NULL,
  manifest_generation bigint, PRIMARY KEY(owner_id, request_id),
  FOREIGN KEY(owner_id, slug) REFERENCES t293.works(owner_id, slug),
  FOREIGN KEY(owner_id, slug, manifest_generation) REFERENCES t293.manifests(owner_id, slug, generation)
);
CREATE TABLE t293.audit (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, value jsonb NOT NULL, PRIMARY KEY(owner_id, request_id),
  FOREIGN KEY(owner_id, request_id) REFERENCES t293.app_requests(owner_id, request_id)
);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['works','evidence','cover_objects','manifests','app_requests','audit'] LOOP
    EXECUTE format('ALTER TABLE t293.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE t293.%I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY scoped_actor ON t293.%I TO t293_app USING (owner_id = t293.actor()) WITH CHECK (owner_id = t293.actor())',name);
  END LOOP;
END $$;
GRANT SELECT ON t293.works,t293.evidence,t293.cover_objects,t293.manifests,t293.app_requests,t293.audit TO t293_app;
GRANT UPDATE (state) ON t293.works TO t293_app;
GRANT INSERT ON t293.manifests,t293.app_requests,t293.audit TO t293_app;
