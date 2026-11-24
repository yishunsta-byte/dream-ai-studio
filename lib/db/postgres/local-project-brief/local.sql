BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
  IF current_database()<>'dream_test_t367' OR current_setting('server_version_num')::int/10000<>17
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR current_setting('dream.t367_owned',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'OWNED_BRIEF_TARGET';
  END IF;
END $$;
CREATE ROLE local_project_brief NOLOGIN;
GRANT USAGE ON SCHEMA dream TO local_project_brief;
GRANT EXECUTE ON FUNCTION dream.actor_id() TO local_project_brief;
GRANT SELECT(owner_id,id,menu_id,archived_at,title,goal,target,aspect,length_sec,inputs_json,content_revision),
  UPDATE(approved_plan_id) ON dream.projects TO local_project_brief;
CREATE POLICY brief_project_read ON dream.projects FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL);
CREATE POLICY brief_project_lock ON dream.projects FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id()) WITH CHECK(false);
GRANT SELECT(owner_id,project_id,stage,status), UPDATE(status,approved_at,approved_revision)
  ON dream.stage_states TO local_project_brief;
CREATE POLICY brief_stages_read ON dream.stage_states FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id() AND stage IN ('intake','brief','plan'));
CREATE POLICY brief_stages_update ON dream.stage_states FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND ((stage='brief' AND status='todo') OR (stage='plan' AND status='locked')))
  WITH CHECK(owner_id=dream.actor_id() AND ((stage='brief' AND status='approved') OR (stage='plan' AND status='todo')));
GRANT INSERT ON dream.activity_log TO local_project_brief;
CREATE POLICY brief_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='brief.confirm' AND actor='local-user');

GRANT SELECT(approved_plan_id,template_snapshot_json) ON dream.projects TO local_project_brief;
CREATE POLICY plan_production_read ON dream.stage_states FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id() AND stage='produce');
GRANT SELECT(owner_id,id,project_id,version,steps_json,script,status),
  INSERT(owner_id,id,project_id,version,steps_json,script,status,created_at)
  ON dream.plans TO local_project_brief;
CREATE POLICY plan_read ON dream.plans FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id());
CREATE POLICY plan_draft_insert ON dream.plans FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND status='draft'
    AND EXISTS (SELECT 1 FROM dream.projects p WHERE p.owner_id=plans.owner_id AND p.id=plans.project_id
      AND p.menu_id='shopping-shorts' AND p.archived_at IS NULL AND p.approved_plan_id IS NULL)
    AND 3 = (SELECT count(*) FROM dream.stage_states s WHERE s.owner_id=plans.owner_id AND s.project_id=plans.project_id
      AND ((s.stage='brief' AND s.status='approved')
        OR (s.stage='plan' AND s.status IN ('todo','in_progress','needs_approval'))
        OR (s.stage='produce' AND s.status='locked'))));
CREATE POLICY plan_draft_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='plan.draft' AND actor='local-user');

CREATE POLICY plan_link_project ON dream.projects FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL AND approved_plan_id IS NULL)
  WITH CHECK(owner_id=dream.actor_id() AND menu_id='shopping-shorts' AND archived_at IS NULL AND approved_plan_id IS NOT NULL);

GRANT UPDATE(status,approved_at,approved_scene_snapshot_json) ON dream.plans TO local_project_brief;
CREATE POLICY plan_approve_draft ON dream.plans FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND status='draft'
    AND EXISTS (SELECT 1 FROM dream.projects p WHERE p.owner_id=plans.owner_id AND p.id=plans.project_id
      AND p.menu_id='shopping-shorts' AND p.archived_at IS NULL AND p.approved_plan_id IS NULL))
  WITH CHECK(owner_id=dream.actor_id() AND status='approved' AND approved_at IS NOT NULL
    AND approved_scene_snapshot_json IS NOT NULL);

GRANT SELECT(owner_id,project_id,archived_at),
  INSERT(owner_id,project_id,id,position,title,description,dialogue_json,character_ids_json,duration_sec)
  ON dream.scenes TO local_project_brief;
CREATE POLICY plan_scene_read ON dream.scenes FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id());
CREATE POLICY plan_scene_insert ON dream.scenes FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id()
    AND EXISTS (SELECT 1 FROM dream.projects p WHERE p.owner_id=scenes.owner_id AND p.id=scenes.project_id
      AND p.menu_id='shopping-shorts' AND p.archived_at IS NULL AND p.approved_plan_id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM dream.stage_states s WHERE s.owner_id=scenes.owner_id AND s.project_id=scenes.project_id
      AND s.stage='plan' AND s.status IN ('todo','in_progress','needs_approval')));

GRANT UPDATE(approved_plan_id) ON dream.stage_states TO local_project_brief;
CREATE POLICY plan_open_production ON dream.stage_states FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND ((stage='plan' AND status IN ('todo','in_progress','needs_approval'))
    OR (stage='produce' AND status='locked')))
  WITH CHECK(owner_id=dream.actor_id() AND ((stage='plan' AND status='approved' AND approved_plan_id IS NOT NULL)
    OR (stage='produce' AND status='todo'))
    AND EXISTS (SELECT 1 FROM dream.projects p WHERE p.owner_id=stage_states.owner_id AND p.id=stage_states.project_id
      AND p.menu_id='shopping-shorts' AND p.archived_at IS NULL AND p.approved_plan_id IS NOT NULL
      AND (stage_states.stage='produce' OR p.approved_plan_id=stage_states.approved_plan_id)));
CREATE POLICY plan_approve_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='plan.approve' AND actor='local-user');

GRANT SELECT(approved_plan_id) ON dream.stage_states TO local_project_brief;
GRANT SELECT(id,position,title,description,duration_sec,needs_recheck,selected_version_id) ON dream.scenes TO local_project_brief;
GRANT SELECT(owner_id,scene_id,id,status) ON dream.scene_versions TO local_project_brief;
CREATE POLICY production_selected_version ON dream.scene_versions FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id());

GRANT SELECT(owner_id,project_id,asset_id,purpose) ON dream.project_assets TO local_project_brief;
CREATE POLICY production_source_link ON dream.project_assets FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id() AND purpose IN ('productAssets','productionImage'));
GRANT SELECT(owner_id,id,title,kind,mime,archived_at,rights_note,sha256) ON dream.assets TO local_project_brief;
CREATE POLICY production_source_asset ON dream.assets FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id() AND kind='image' AND mime='image/png');
GRANT SELECT(asset_id,owner_id,status) ON dream.asset_receipt_state TO local_project_brief;
CREATE POLICY production_source_receipt ON dream.asset_receipt_state FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id());
GRANT UPDATE(id) ON dream.scenes TO local_project_brief;
CREATE POLICY production_scene_lock ON dream.scenes FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND archived_at IS NULL) WITH CHECK(false);
GRANT SELECT(version,plan_id,kind,result_asset_id),
  INSERT(owner_id,id,scene_id,plan_id,version,kind,input_snapshot_json,result_asset_id,status,created_at)
  ON dream.scene_versions TO local_project_brief;
CREATE POLICY production_register_png ON dream.scene_versions FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND status='succeeded' AND kind='image'
    AND EXISTS (SELECT 1 FROM dream.scenes scene
      JOIN dream.projects project ON (project.owner_id,project.id)=(scene.owner_id,scene.project_id)
      JOIN dream.stage_states stage ON (stage.owner_id,stage.project_id)=(project.owner_id,project.id)
        AND stage.stage='produce' AND stage.status IN ('todo','in_progress')
      JOIN dream.project_assets link ON (link.owner_id,link.project_id)=(project.owner_id,project.id)
        AND link.asset_id=scene_versions.result_asset_id AND link.purpose IN ('productAssets','productionImage')
      WHERE (scene.owner_id,scene.id)=(scene_versions.owner_id,scene_versions.scene_id)
        AND scene.archived_at IS NULL AND project.archived_at IS NULL AND project.menu_id='shopping-shorts'
        AND project.approved_plan_id=scene_versions.plan_id));
CREATE POLICY production_register_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='scene.result_registered' AND actor='local-user');

GRANT SELECT(current_timeline_rev_id), UPDATE(content_revision,updated_at) ON dream.projects TO local_project_brief;
CREATE POLICY production_selection_revision ON dream.projects FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND archived_at IS NULL AND menu_id='shopping-shorts'
    AND approved_plan_id IS NOT NULL AND current_timeline_rev_id IS NULL)
  WITH CHECK(owner_id=dream.actor_id() AND archived_at IS NULL AND menu_id='shopping-shorts'
    AND approved_plan_id IS NOT NULL AND current_timeline_rev_id IS NULL
    AND EXISTS (SELECT 1 FROM dream.stage_states stage
      WHERE stage.owner_id=projects.owner_id AND stage.project_id=projects.id
        AND stage.stage='produce' AND stage.status IN ('todo','in_progress')));
GRANT UPDATE(selected_version_id,needs_recheck) ON dream.scenes TO local_project_brief;
CREATE POLICY production_selection ON dream.scenes FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND archived_at IS NULL)
  WITH CHECK(owner_id=dream.actor_id() AND archived_at IS NULL AND needs_recheck=0
    AND EXISTS (SELECT 1 FROM dream.projects project
      JOIN dream.stage_states stage ON (stage.owner_id,stage.project_id)=(project.owner_id,project.id)
        AND stage.stage='produce' AND stage.status IN ('todo','in_progress')
      JOIN dream.scene_versions v ON v.owner_id=project.owner_id AND v.plan_id=project.approved_plan_id
        AND v.id=scenes.selected_version_id AND v.scene_id=scenes.id AND v.status='succeeded' AND v.kind='image'
      WHERE (project.owner_id,project.id)=(scenes.owner_id,scenes.project_id)
        AND project.menu_id='shopping-shorts' AND project.archived_at IS NULL AND project.current_timeline_rev_id IS NULL));
CREATE POLICY production_selection_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='scene.select' AND actor='local-user');

GRANT SELECT(approved_scene_snapshot_json) ON dream.plans TO local_project_brief;
CREATE POLICY production_edit_read ON dream.stage_states FOR SELECT TO local_project_brief
  USING(owner_id=dream.actor_id() AND stage='edit');
CREATE POLICY production_approval ON dream.stage_states FOR UPDATE TO local_project_brief
  USING(owner_id=dream.actor_id() AND ((stage='produce' AND status IN ('todo','in_progress'))
    OR (stage='edit' AND status='locked')))
  WITH CHECK(owner_id=dream.actor_id()
    AND EXISTS (SELECT 1 FROM dream.projects p WHERE (p.owner_id,p.id)=(stage_states.owner_id,stage_states.project_id)
      AND p.archived_at IS NULL AND p.menu_id='shopping-shorts' AND p.current_timeline_rev_id IS NULL
      AND p.approved_plan_id IS NOT NULL AND
        ((stage_states.stage='produce' AND stage_states.status='approved' AND stage_states.approved_at IS NOT NULL
          AND stage_states.approved_plan_id=p.approved_plan_id AND stage_states.approved_revision=p.content_revision)
        OR (stage_states.stage='edit' AND stage_states.status='todo'))));
CREATE POLICY production_approval_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='produce.approve' AND actor='local-user');

GRANT INSERT(owner_id,project_id,asset_id,purpose) ON dream.project_assets TO local_project_brief;
CREATE POLICY production_attach_png ON dream.project_assets FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND purpose='productionImage'
    AND EXISTS (SELECT 1 FROM dream.projects p JOIN dream.stage_states s
      ON (s.owner_id,s.project_id)=(p.owner_id,p.id) AND s.stage='produce' AND s.status IN ('todo','in_progress')
      WHERE (p.owner_id,p.id)=(project_assets.owner_id,project_assets.project_id)
        AND p.menu_id='shopping-shorts' AND p.archived_at IS NULL AND p.approved_plan_id IS NOT NULL
        AND p.current_timeline_rev_id IS NULL)
    AND EXISTS (SELECT 1 FROM dream.assets a JOIN dream.asset_receipt_state r
      ON (r.owner_id,r.asset_id)=(a.owner_id,a.id) AND r.status='ready'
      WHERE (a.owner_id,a.id)=(project_assets.owner_id,project_assets.asset_id)
        AND a.kind='image' AND a.mime='image/png' AND a.archived_at IS NULL));
CREATE POLICY production_attach_log ON dream.activity_log FOR INSERT TO local_project_brief
  WITH CHECK(owner_id=dream.actor_id() AND action='production.png_attached' AND actor='local-user');
COMMIT;
