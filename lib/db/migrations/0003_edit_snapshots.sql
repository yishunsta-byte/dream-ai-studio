CREATE TRIGGER edit_snapshot_update_guard BEFORE UPDATE ON settings
WHEN OLD.key GLOB 'project.*.edit.*' AND OLD.key NOT GLOB '*.current'
BEGIN SELECT RAISE(ABORT,'edit snapshots are immutable'); END;
CREATE TRIGGER edit_snapshot_delete_guard BEFORE DELETE ON settings
WHEN OLD.key GLOB 'project.*.edit.*' AND OLD.key NOT GLOB '*.current'
BEGIN SELECT RAISE(ABORT,'edit snapshots are immutable'); END;
