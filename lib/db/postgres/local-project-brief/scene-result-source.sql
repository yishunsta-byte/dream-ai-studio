BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
  IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
     OR obj_description(to_regnamespace('private_image_create_v1'),'pg_namespace')
        IS DISTINCT FROM 'T368 owned PostgreSQL 17 candidate v1' THEN
    RAISE EXCEPTION 'OWNED_SCENE_RESULT_TARGET';
  END IF;
END $$;
-- The upload verifier's existing predicate keeps receipt, policy and identity
-- share locks through the scene-result transaction.
CREATE FUNCTION private_image_create_v1.verified_scene_png(asset uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
AS $$ SELECT private_image_create_v1.current_png(asset) $$;
ALTER FUNCTION private_image_create_v1.verified_scene_png(uuid) OWNER TO t368_create_guard;
REVOKE ALL ON FUNCTION private_image_create_v1.verified_scene_png(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private_image_create_v1 TO local_project_brief;
GRANT EXECUTE ON FUNCTION private_image_create_v1.verified_scene_png(uuid) TO local_project_brief;
COMMIT;
