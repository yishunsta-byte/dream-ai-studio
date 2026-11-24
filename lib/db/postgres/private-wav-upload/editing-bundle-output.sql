BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
  IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on'
     OR to_regrole('local_editing_bundle_read') IS NULL THEN
    RAISE EXCEPTION 'OWNED_EDITING_BUNDLE_OUTPUT_TARGET';
  END IF;
END $$;

CREATE ROLE local_editing_bundle_export NOLOGIN;
CREATE SCHEMA local_editing_bundle;
REVOKE ALL ON SCHEMA local_editing_bundle FROM PUBLIC;
GRANT USAGE ON SCHEMA dream,local_editing_bundle TO local_editing_bundle_export;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_editing_bundle_export;
GRANT EXECUTE ON FUNCTION dream.valid_object_key(text,uuid) TO local_editing_bundle_export;
GRANT USAGE ON DOMAIN dream.sha256,dream.safe_positive TO local_editing_bundle_export;

CREATE TABLE local_editing_bundle.claims (
  owner_id uuid NOT NULL, export_id uuid NOT NULL, project_id uuid NOT NULL, timeline_id uuid NOT NULL,
  content_revision dream.safe_positive NOT NULL, timeline_sha256 dream.sha256 NOT NULL, plan_id uuid NOT NULL,
  attempt_id uuid NOT NULL, lease_until timestamptz,
  PRIMARY KEY(owner_id,export_id),
  UNIQUE(owner_id,project_id,content_revision,timeline_id),
  FOREIGN KEY(owner_id,export_id) REFERENCES dream.exports(owner_id,id),
  FOREIGN KEY(owner_id,project_id) REFERENCES dream.projects(owner_id,id),
  FOREIGN KEY(owner_id,timeline_id) REFERENCES dream.timeline_revisions(owner_id,id),
  FOREIGN KEY(owner_id,plan_id) REFERENCES dream.plans(owner_id,id)
);
CREATE TABLE local_editing_bundle.keys (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, export_id uuid NOT NULL,
  PRIMARY KEY(owner_id,request_id),
  FOREIGN KEY(owner_id,export_id) REFERENCES local_editing_bundle.claims(owner_id,export_id)
);
CREATE TABLE local_editing_bundle.outputs (
  owner_id uuid NOT NULL, export_id uuid NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content)>0),
  sha256 text GENERATED ALWAYS AS (encode(sha256(content),'hex')) STORED,
  size_bytes integer GENERATED ALWAYS AS (octet_length(content)) STORED,
  PRIMARY KEY(owner_id,export_id),
  FOREIGN KEY(owner_id,export_id) REFERENCES local_editing_bundle.claims(owner_id,export_id)
);
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['claims','keys','outputs'] LOOP
    EXECUTE format('ALTER TABLE local_editing_bundle.%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE local_editing_bundle.%I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY owned_bundle_select ON local_editing_bundle.%I FOR SELECT TO local_editing_bundle_export
      USING (owner_id=dream.actor_id())',relation);
    EXECUTE format('CREATE POLICY owned_bundle_insert ON local_editing_bundle.%I FOR INSERT TO local_editing_bundle_export
      WITH CHECK (owner_id=dream.actor_id())',relation);
    EXECUTE format('GRANT SELECT,INSERT ON local_editing_bundle.%I TO local_editing_bundle_export',relation);
  END LOOP;
END $$;
GRANT UPDATE(attempt_id,lease_until) ON local_editing_bundle.claims TO local_editing_bundle_export;
CREATE POLICY owned_bundle_claim_update ON local_editing_bundle.claims FOR UPDATE TO local_editing_bundle_export
  USING(owner_id=dream.actor_id()) WITH CHECK(owner_id=dream.actor_id());

GRANT SELECT(id,owner_id,menu_id,archived_at,content_revision,current_timeline_rev_id,approved_plan_id),UPDATE(id)
  ON dream.projects TO local_editing_bundle_export;
GRANT SELECT(owner_id,project_id,stage,status,approved_revision,approved_plan_id),UPDATE(status,approved_revision,approved_at,approved_plan_id)
  ON dream.stage_states TO local_editing_bundle_export;
GRANT SELECT(owner_id,project_id,id,content_revision,timeline_sha256)
  ON dream.timeline_revisions TO local_editing_bundle_export;
GRANT SELECT(owner_id,project_id,id,content_revision,status,file_path,manifest_version,manifest_json,sha256,created_at,completed_at,error),
  INSERT(owner_id,project_id,id,content_revision,status,created_at),
  UPDATE(status,file_path,manifest_version,manifest_json,sha256,completed_at,error) ON dream.exports TO local_editing_bundle_export;
GRANT INSERT(owner_id,id,project_id,actor,action,detail_json,created_at) ON dream.activity_log TO local_editing_bundle_export;
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['projects','stage_states','timeline_revisions','exports'] LOOP
    EXECUTE format('CREATE POLICY owned_bundle_read ON dream.%I FOR SELECT TO local_editing_bundle_export
      USING (owner_id=dream.actor_id())',relation);
  END LOOP;
END $$;
CREATE POLICY owned_bundle_project_lock ON dream.projects FOR UPDATE TO local_editing_bundle_export
  USING(owner_id=dream.actor_id()) WITH CHECK(false);
CREATE POLICY owned_bundle_stage_update ON dream.stage_states FOR UPDATE TO local_editing_bundle_export
  USING(owner_id=dream.actor_id() AND stage='export') WITH CHECK(owner_id=dream.actor_id() AND stage='export' AND status='approved');
CREATE POLICY owned_bundle_record_insert ON dream.exports FOR INSERT TO local_editing_bundle_export
  WITH CHECK(owner_id=dream.actor_id() AND status='running');
CREATE POLICY owned_bundle_record_update ON dream.exports FOR UPDATE TO local_editing_bundle_export
  USING(owner_id=dream.actor_id() AND status IN ('running','failed'))
  WITH CHECK(owner_id=dream.actor_id() AND status IN ('running','failed','succeeded'));
CREATE POLICY owned_bundle_audit ON dream.activity_log FOR INSERT TO local_editing_bundle_export
  WITH CHECK(owner_id=dream.actor_id() AND action='export.succeeded');
COMMIT;
