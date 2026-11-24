-- T281 isolated PG17 candidate only. Never load as a product migration.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'dream_test_t281' OR current_user <> 't281_bootstrap'
      OR current_setting('server_version_num')::integer / 10000 <> 17
      OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
      OR current_setting('rea_t281.synthetic', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'T281_ISOLATED_TARGET_REQUIRED';
  END IF;
END $$;

CREATE ROLE t281_guard NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE t281_operator NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE SCHEMA rea_t281 AUTHORIZATION t281_guard;
REVOKE ALL ON SCHEMA rea_t281 FROM PUBLIC;
GRANT USAGE ON SCHEMA rea_t281 TO dream_api, t281_operator;
GRANT USAGE ON SCHEMA dream TO t281_guard;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO t281_guard;

CREATE TABLE rea_t281.owner_state (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id),
  enabled boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0)
);
CREATE TABLE rea_t281.scope_state (
  owner_id uuid NOT NULL REFERENCES rea_t281.owner_state(owner_id),
  project_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  link_generation bigint NOT NULL DEFAULT 0 CHECK (link_generation >= 0),
  permission_generation bigint NOT NULL DEFAULT 0 CHECK (permission_generation >= 0),
  active boolean NOT NULL DEFAULT false,
  PRIMARY KEY (owner_id,project_id,asset_id),
  FOREIGN KEY (owner_id,project_id) REFERENCES dream.projects(owner_id,id),
  FOREIGN KEY (owner_id,asset_id) REFERENCES dream.assets(owner_id,id)
);
INSERT INTO rea_t281.owner_state(owner_id)
  SELECT DISTINCT owner_id FROM dream.project_assets WHERE purpose = 'rea-reference';
INSERT INTO rea_t281.scope_state(owner_id,project_id,asset_id)
  SELECT owner_id,project_id,asset_id FROM dream.project_assets WHERE purpose = 'rea-reference';

ALTER TABLE rea_t281.owner_state OWNER TO t281_guard;
ALTER TABLE rea_t281.scope_state OWNER TO t281_guard;
ALTER TABLE rea_t281.owner_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE rea_t281.owner_state FORCE ROW LEVEL SECURITY;
ALTER TABLE rea_t281.scope_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE rea_t281.scope_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA rea_t281 FROM PUBLIC, dream_api, dream_worker, t281_operator;
GRANT SELECT ON rea_t281.owner_state, rea_t281.scope_state TO dream_api;
CREATE POLICY owner_read ON rea_t281.owner_state FOR SELECT TO dream_api USING (owner_id = (SELECT dream.actor_id()));
CREATE POLICY scope_read ON rea_t281.scope_state FOR SELECT TO dream_api USING (owner_id = (SELECT dream.actor_id()));
CREATE POLICY owner_guard ON rea_t281.owner_state FOR ALL TO t281_guard
  USING (owner_id = (SELECT dream.actor_id())) WITH CHECK (owner_id = (SELECT dream.actor_id()));
CREATE POLICY scope_guard ON rea_t281.scope_state FOR ALL TO t281_guard
  USING (owner_id = (SELECT dream.actor_id())) WITH CHECK (owner_id = (SELECT dream.actor_id()));

-- Intentionally broad revokes for this disposable probe. Product column-by-column ACL migration is separate.
REVOKE INSERT,UPDATE,DELETE ON dream.project_assets FROM dream_api,dream_worker;
REVOKE UPDATE,DELETE ON dream.projects,dream.assets FROM dream_api,dream_worker;
GRANT SELECT ON dream.projects,dream.assets,dream.project_assets TO t281_guard;
GRANT UPDATE(id) ON dream.projects,dream.assets TO t281_guard;
GRANT INSERT,DELETE ON dream.project_assets TO t281_guard;
CREATE POLICY t281_project_read ON dream.projects FOR SELECT TO t281_guard USING (owner_id = (SELECT dream.actor_id()));
CREATE POLICY t281_project_lock ON dream.projects FOR UPDATE TO t281_guard
  USING (owner_id = (SELECT dream.actor_id())) WITH CHECK (false);
CREATE POLICY t281_asset_read ON dream.assets FOR SELECT TO t281_guard USING (owner_id = (SELECT dream.actor_id()));
CREATE POLICY t281_asset_lock ON dream.assets FOR UPDATE TO t281_guard
  USING (owner_id = (SELECT dream.actor_id())) WITH CHECK (false);
CREATE POLICY t281_link_read ON dream.project_assets FOR SELECT TO t281_guard USING (owner_id = (SELECT dream.actor_id()));
CREATE POLICY t281_link_add ON dream.project_assets FOR INSERT TO t281_guard WITH CHECK (owner_id = (SELECT dream.actor_id()));
CREATE POLICY t281_link_remove ON dream.project_assets FOR DELETE TO t281_guard USING (owner_id = (SELECT dream.actor_id()));

CREATE FUNCTION rea_t281.lock_owner() RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid := dream.actor_id();
BEGIN
  IF actor IS NULL OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'T281_ACTOR_OR_ISOLATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  INSERT INTO rea_t281.owner_state(owner_id) VALUES (actor) ON CONFLICT(owner_id) DO NOTHING;
  PERFORM 1 FROM rea_t281.owner_state WHERE owner_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'T281_OWNER_LOCK_REQUIRED'; END IF;
  RETURN actor;
END $$;

-- Project rows precede asset rows, with a stable ID order for movement.
CREATE FUNCTION rea_t281.lock_targets(actor uuid, projects uuid[], assets uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE target_id uuid;
BEGIN
  FOR target_id IN SELECT DISTINCT unnest(projects) ORDER BY 1 LOOP
    PERFORM 1 FROM dream.projects WHERE owner_id = actor AND id = target_id AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'T281_TARGET_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
  END LOOP;
  FOR target_id IN SELECT DISTINCT unnest(assets) ORDER BY 1 LOOP
    PERFORM 1 FROM dream.assets WHERE owner_id = actor AND id = target_id AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'T281_TARGET_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION rea_t281.bump_link(actor uuid, project uuid, asset uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
  INSERT INTO rea_t281.scope_state(owner_id,project_id,asset_id,link_generation)
    VALUES (actor,project,asset,1)
  ON CONFLICT(owner_id,project_id,asset_id) DO UPDATE
    SET link_generation = scope_state.link_generation + 1, active = false
$$;

CREATE FUNCTION rea_t281.owner_permission(allow boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid;
BEGIN
  actor := rea_t281.lock_owner();
  IF allow IS NULL THEN RAISE EXCEPTION 'T281_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  UPDATE rea_t281.owner_state SET enabled = allow, generation = generation + 1
    WHERE owner_id = actor AND enabled <> allow;
  IF NOT FOUND THEN RAISE SQLSTATE 'R2810'; END IF;
  IF NOT allow THEN
    UPDATE rea_t281.scope_state SET active = false, permission_generation = permission_generation + 1
      WHERE owner_id = actor AND active;
  END IF;
  RETURN true;
EXCEPTION WHEN SQLSTATE 'R2810' THEN
  -- A denial releases tentative rows and locks acquired inside this block.
  RETURN false;
END $$;

CREATE FUNCTION rea_t281.scope_permission(project uuid, asset uuid, allow boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid;
BEGIN
  actor := rea_t281.lock_owner();
  IF allow IS NULL THEN RAISE EXCEPTION 'T281_INVALID_TRANSITION' USING ERRCODE = '22023'; END IF;
  PERFORM rea_t281.lock_targets(actor, ARRAY[project], ARRAY[asset]);
  IF allow AND NOT (
    EXISTS (SELECT 1 FROM rea_t281.owner_state WHERE owner_id = actor AND enabled)
    AND EXISTS (SELECT 1 FROM dream.project_assets
      WHERE owner_id = actor AND project_id = project AND asset_id = asset AND purpose = 'rea-reference')
  ) THEN RAISE SQLSTATE 'R2810'; END IF;
  INSERT INTO rea_t281.scope_state(owner_id,project_id,asset_id) VALUES (actor,project,asset)
    ON CONFLICT(owner_id,project_id,asset_id) DO NOTHING;
  UPDATE rea_t281.scope_state SET active = allow, permission_generation = permission_generation + 1
    WHERE owner_id = actor AND project_id = project AND asset_id = asset AND active <> allow;
  IF NOT FOUND THEN RAISE SQLSTATE 'R2810'; END IF;
  RETURN true;
EXCEPTION WHEN SQLSTATE 'R2810' THEN
  -- A denial releases tentative rows and locks acquired inside this block.
  RETURN false;
END $$;

CREATE FUNCTION rea_t281.change_link(
  old_project uuid, old_asset uuid, old_purpose text, new_project uuid, new_asset uuid, new_purpose text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $$
DECLARE actor uuid := rea_t281.lock_owner();
BEGIN
  IF (old_project IS NULL AND new_project IS NULL)
      OR (old_project IS NULL) <> (old_asset IS NULL)
      OR (old_project IS NULL) <> (old_purpose IS NULL)
      OR (new_project IS NULL) <> (new_asset IS NULL)
      OR (new_project IS NULL) <> (new_purpose IS NULL)
      OR (old_purpose IS NOT NULL AND old_purpose !~ '^[a-z][a-z0-9-]{0,63}$')
      OR (new_purpose IS NOT NULL AND new_purpose !~ '^[a-z][a-z0-9-]{0,63}$') THEN
    RAISE EXCEPTION 'T281_INVALID_TRANSITION' USING ERRCODE = '22023';
  END IF;
  PERFORM rea_t281.lock_targets(actor, array_remove(ARRAY[old_project,new_project],NULL),
    array_remove(ARRAY[old_asset,new_asset],NULL));
  IF old_project IS NOT NULL THEN
    DELETE FROM dream.project_assets WHERE owner_id = actor AND project_id = old_project
      AND asset_id = old_asset AND purpose = old_purpose;
    IF NOT FOUND THEN RETURN false; END IF;
    IF old_purpose = 'rea-reference' THEN PERFORM rea_t281.bump_link(actor,old_project,old_asset); END IF;
  END IF;
  IF new_project IS NOT NULL THEN
    INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose)
      VALUES (actor,new_project,new_asset,new_purpose);
    IF new_purpose = 'rea-reference' THEN PERFORM rea_t281.bump_link(actor,new_project,new_asset); END IF;
  END IF;
  RETURN true;
END $$;

ALTER FUNCTION rea_t281.lock_owner() OWNER TO t281_guard;
ALTER FUNCTION rea_t281.lock_targets(uuid,uuid[],uuid[]) OWNER TO t281_guard;
ALTER FUNCTION rea_t281.bump_link(uuid,uuid,uuid) OWNER TO t281_guard;
ALTER FUNCTION rea_t281.owner_permission(boolean) OWNER TO t281_guard;
ALTER FUNCTION rea_t281.scope_permission(uuid,uuid,boolean) OWNER TO t281_guard;
ALTER FUNCTION rea_t281.change_link(uuid,uuid,text,uuid,uuid,text) OWNER TO t281_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rea_t281 FROM PUBLIC, dream_api, dream_worker, t281_operator;
GRANT EXECUTE ON FUNCTION rea_t281.owner_permission(boolean), rea_t281.scope_permission(uuid,uuid,boolean) TO t281_operator;
GRANT EXECUTE ON FUNCTION rea_t281.change_link(uuid,uuid,text,uuid,uuid,text) TO dream_api;
COMMIT;
