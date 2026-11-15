CREATE TRIGGER activity_update_guard BEFORE UPDATE ON activity_log
BEGIN SELECT RAISE(ABORT,'activity history is append only'); END;
CREATE TRIGGER activity_delete_guard BEFORE DELETE ON activity_log
BEGIN SELECT RAISE(ABORT,'activity history is append only'); END;
CREATE TRIGGER finished_backup_update_guard BEFORE UPDATE ON backups WHEN OLD.status='succeeded'
BEGIN SELECT RAISE(ABORT,'verified backups are immutable'); END;
CREATE TRIGGER finished_backup_delete_guard BEFORE DELETE ON backups WHEN OLD.status='succeeded'
BEGIN SELECT RAISE(ABORT,'verified backups are immutable'); END;
CREATE TRIGGER backup_meta_update_guard BEFORE UPDATE ON settings WHEN OLD.key GLOB 'backup.*.meta'
BEGIN SELECT RAISE(ABORT,'backup metadata is immutable'); END;
CREATE TRIGGER backup_meta_delete_guard BEFORE DELETE ON settings WHEN OLD.key GLOB 'backup.*.meta'
BEGIN SELECT RAISE(ABORT,'backup metadata is immutable'); END;
CREATE TRIGGER generation_input_update_guard BEFORE UPDATE OF provider,model,params_json,reference_snapshot_json,seed ON generations
BEGIN SELECT RAISE(ABORT,'generation inputs are immutable'); END;

-- REPLACE performs an implicit DELETE. With recursive_triggers enabled on every
-- connection, protect the earlier UPDATE-only immutable records as well.
CREATE TRIGGER completed_version_delete_guard BEFORE DELETE ON scene_versions WHEN OLD.status='succeeded'
BEGIN SELECT RAISE(ABORT,'completed version is immutable'); END;
CREATE TRIGGER completed_export_delete_guard BEFORE DELETE ON exports WHEN OLD.status='succeeded'
BEGIN SELECT RAISE(ABORT,'completed export is immutable'); END;
CREATE TRIGGER approved_plan_delete_guard BEFORE DELETE ON plans WHEN OLD.status='approved'
BEGIN SELECT RAISE(ABORT,'approved plan is immutable'); END;
