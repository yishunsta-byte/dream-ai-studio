-- Cross-table ownership and monotonic content revision safeguards.
CREATE TRIGGER approved_project_plan_insert_guard BEFORE INSERT ON projects
WHEN NEW.approved_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id=NEW.approved_plan_id AND project_id=NEW.id AND status='approved')
BEGIN SELECT RAISE(ABORT,'approved plan must belong to project'); END;

CREATE TRIGGER stage_plan_insert_guard BEFORE INSERT ON stage_states
WHEN NEW.approved_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id=NEW.approved_plan_id AND project_id=NEW.project_id AND status='approved')
BEGIN SELECT RAISE(ABORT,'stage plan must belong to project'); END;

CREATE TRIGGER stage_plan_update_guard BEFORE UPDATE OF approved_plan_id,project_id ON stage_states
WHEN NEW.approved_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id=NEW.approved_plan_id AND project_id=NEW.project_id AND status='approved')
BEGIN SELECT RAISE(ABORT,'stage plan must belong to project'); END;

CREATE TRIGGER scene_plan_insert_guard BEFORE INSERT ON scene_versions
WHEN NOT EXISTS (SELECT 1 FROM scenes JOIN plans ON scenes.project_id=plans.project_id WHERE scenes.id=NEW.scene_id AND plans.id=NEW.plan_id)
BEGIN SELECT RAISE(ABORT,'scene and plan must belong to same project'); END;

CREATE TRIGGER scene_plan_update_guard BEFORE UPDATE OF scene_id,plan_id ON scene_versions
WHEN NOT EXISTS (SELECT 1 FROM scenes JOIN plans ON scenes.project_id=plans.project_id WHERE scenes.id=NEW.scene_id AND plans.id=NEW.plan_id)
BEGIN SELECT RAISE(ABORT,'scene and plan must belong to same project'); END;

CREATE TRIGGER revision_monotonic BEFORE UPDATE OF content_revision ON projects
WHEN NEW.content_revision < OLD.content_revision
BEGIN SELECT RAISE(ABORT,'content revision cannot decrease'); END;

CREATE TRIGGER currency_insert_guard BEFORE INSERT ON generations
WHEN length(NEW.currency)<>3 OR NEW.currency GLOB '*[^A-Z]*'
BEGIN SELECT RAISE(ABORT,'currency must be a three-letter uppercase code'); END;

CREATE TRIGGER currency_update_guard BEFORE UPDATE OF currency ON generations
WHEN length(NEW.currency)<>3 OR NEW.currency GLOB '*[^A-Z]*'
BEGIN SELECT RAISE(ABORT,'currency must be a three-letter uppercase code'); END;
