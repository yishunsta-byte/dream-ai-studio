/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- code migration step: restricted .cjs format run by lib/db/code-migration.ts */
// Product step 0005 (P2-1, PLAN 11.2, T-060/T-061). Creates timeline_revisions and moves each project's current P1
// edit snapshot (settings "project.<id>.edit.current") to its first timeline revision r1. Synchronous code only.
// - Only the snapshot the pointer names is moved; settings rows stay as they are (read-only record, 0003 triggers).
// - Archived projects are moved the same way. A project without the pointer gets no row (its pointer stays null).
// - A broken pointer or snapshot stops the whole step (nothing is skipped silently).
// - content_revision of r1 is the snapshot's; projects.content_revision, stages, reviews and exports are unchanged.
// - Same database in, same rows out: ids come from the source keys, created_at is the snapshot's, no clock is read.
const shared = require("./0005_timeline_shared.cjs");

module.exports.sql = [
  "CREATE TABLE timeline_revisions (",
  "  id TEXT PRIMARY KEY NOT NULL,",
  "  project_id TEXT NOT NULL REFERENCES projects(id),",
  "  revision INTEGER NOT NULL CHECK (revision >= 1),",
  "  content_revision INTEGER NOT NULL CHECK (content_revision >= 1),",
  "  timeline_json TEXT NOT NULL CHECK (json_valid(timeline_json)),",
  "  timeline_sha256 TEXT NOT NULL CHECK (length(timeline_sha256) = 64),",
  "  source TEXT NOT NULL CHECK (source IN ('p1-migration','user','restore-version')),",
  "  restored_from_id TEXT REFERENCES timeline_revisions(id),",
  "  migrated_from_key TEXT,",
  "  created_at TEXT NOT NULL,",
  "  UNIQUE (project_id, revision),",
  "  CHECK ((source = 'restore-version') = (restored_from_id IS NOT NULL)),",
  "  CHECK ((source = 'p1-migration') = (migrated_from_key IS NOT NULL))",
  ") STRICT;",
  "CREATE INDEX timeline_revisions_project_idx ON timeline_revisions(project_id, revision);",
  "CREATE TRIGGER timeline_revisions_restore_guard BEFORE INSERT ON timeline_revisions",
  "WHEN NEW.restored_from_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM timeline_revisions t WHERE t.id = NEW.restored_from_id AND t.project_id = NEW.project_id)",
  "BEGIN SELECT RAISE(ABORT,'timeline restore must name a revision of the same project'); END;",
  "CREATE TRIGGER timeline_revisions_replace_guard BEFORE INSERT ON timeline_revisions",
  "WHEN EXISTS (SELECT 1 FROM timeline_revisions t WHERE t.id = NEW.id OR (t.project_id = NEW.project_id AND t.revision = NEW.revision))",
  "BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;",
  "CREATE TRIGGER timeline_revisions_update_guard BEFORE UPDATE ON timeline_revisions",
  "BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;",
  "CREATE TRIGGER timeline_revisions_delete_guard BEFORE DELETE ON timeline_revisions",
  "BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;",
  "CREATE TRIGGER projects_timeline_pointer_insert_guard BEFORE INSERT ON projects",
  "WHEN NEW.current_timeline_rev_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM timeline_revisions t WHERE t.id = NEW.current_timeline_rev_id AND t.project_id = NEW.id)",
  "BEGIN SELECT RAISE(ABORT,'timeline pointer must name a revision of the same project'); END;",
  "CREATE TRIGGER projects_timeline_pointer_update_guard BEFORE UPDATE OF current_timeline_rev_id, id ON projects",
  "WHEN NEW.current_timeline_rev_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM timeline_revisions t WHERE t.id = NEW.current_timeline_rev_id AND t.project_id = NEW.id)",
  "BEGIN SELECT RAISE(ABORT,'timeline pointer must name a revision of the same project'); END;",
].join("\n");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS = ["subtitle", "hook", "emphasis", "title", "ending", "disclosure"];
function fail(projectId, reason) {
  throw new Error("0005: project " + projectId + " P1 edit snapshot cannot be moved (" + reason + ")");
}
function parse(projectId, text, what) {
  try { return JSON.parse(text); } catch { return fail(projectId, what + " is not JSON"); }
}
function checkSnapshot(projectId, snapshot) {
  const ok = snapshot !== null && typeof snapshot === "object" && snapshot.schema_version === 1 &&
    Number.isSafeInteger(snapshot.content_revision) && snapshot.content_revision >= 1 &&
    typeof snapshot.created_at === "string" && Array.isArray(snapshot.sceneOrder) && Array.isArray(snapshot.layers) &&
    snapshot.sceneOrder.every((id) => typeof id === "string" && UUID.test(id)) &&
    snapshot.layers.every((layer) => layer !== null && typeof layer === "object" && typeof layer.id === "string" && UUID.test(layer.id) &&
      KINDS.includes(layer.kind) && typeof layer.content === "string" && Number.isInteger(layer.fontSize) && typeof layer.color === "string" &&
      Object.prototype.hasOwnProperty.call(shared.P1_Y, layer.position) && typeof layer.startSec === "number" && typeof layer.endSec === "number" &&
      typeof layer.locked === "boolean");
  if (!ok) fail(projectId, "snapshot shape");
}

module.exports.run = function run(sqlite) {
  const projects = sqlite.prepare("SELECT id, aspect FROM projects ORDER BY id").all();
  const setting = sqlite.prepare("SELECT value_json FROM settings WHERE key = ?");
  const scenesOf = sqlite.prepare("SELECT id, duration_sec, selected_version_id FROM scenes WHERE project_id = ? AND archived_at IS NULL ORDER BY position, id");
  const versionOf = sqlite.prepare("SELECT scene_id, kind, status, result_asset_id FROM scene_versions WHERE id = ?");
  const assetOf = sqlite.prepare("SELECT kind, duration_ms FROM assets WHERE id = ?");
  const insert = sqlite.prepare("INSERT INTO timeline_revisions (id, project_id, revision, content_revision, timeline_json, timeline_sha256, source, restored_from_id, migrated_from_key, created_at) VALUES (?, ?, 1, ?, ?, ?, 'p1-migration', NULL, ?, ?)");
  const point = sqlite.prepare("UPDATE projects SET current_timeline_rev_id = ? WHERE id = ?");
  for (const project of projects) {
    const pointer = setting.get("project." + project.id + ".edit.current");
    if (!pointer) continue;
    const snapshotId = parse(project.id, pointer.value_json, "pointer");
    if (typeof snapshotId !== "string" || !UUID.test(snapshotId)) fail(project.id, "pointer value");
    const key = "project." + project.id + ".edit." + snapshotId;
    const raw = setting.get(key);
    if (!raw) fail(project.id, "pointer names a missing snapshot");
    const snapshot = parse(project.id, raw.value_json, "snapshot");
    checkSnapshot(project.id, snapshot);
    // Scenes: the snapshot order for scenes that are still active, then other active scenes by position.
    const active = scenesOf.all(project.id), byId = new Map(active.map((scene) => [scene.id, scene]));
    const ordered = snapshot.sceneOrder.filter((id, index, list) => byId.has(id) && list.indexOf(id) === index).map((id) => byId.get(id));
    for (const scene of active) if (!ordered.includes(scene)) ordered.push(scene);
    const video = ordered.map((scene) => {
      const planFrames = scene.duration_sec * 30;
      const version = scene.selected_version_id ? versionOf.get(scene.selected_version_id) : undefined;
      const usable = version && version.scene_id === scene.id && version.status === "succeeded" && version.kind !== "speech" && version.result_asset_id;
      const asset = usable ? assetOf.get(version.result_asset_id) : undefined;
      const clip = { id: shared.derivedUuid("clip:" + key + "#" + scene.id), sceneId: scene.id, sceneVersionId: null, assetId: null, durationFrames: planFrames, trimInFrames: 0, trimOutFrames: 0, transition: { type: "cut", durationFrames: 0 } };
      if (!asset || (asset.kind !== "image" && asset.kind !== "video")) return clip;
      clip.sceneVersionId = scene.selected_version_id;
      clip.assetId = version.result_asset_id;
      if (asset.kind === "video" && Number.isSafeInteger(asset.duration_ms) && asset.duration_ms > 0) {
        const sourceFrames = Math.max(1, Math.floor((asset.duration_ms * 30 + 500) / 1000));
        clip.durationFrames = Math.min(sourceFrames, planFrames);
        clip.trimOutFrames = sourceFrames - clip.durationFrames;
      }
      return clip;
    });
    const timeline = { schemaVersion: 1, fps: 30, aspect: project.aspect, video: video, audio: [], text: snapshot.layers.map(shared.textFromP1) };
    const json = shared.canonicalJson(timeline);
    const id = shared.derivedUuid("row:" + key);
    insert.run(id, project.id, snapshot.content_revision, json, shared.sha256(json), key, snapshot.created_at);
    point.run(id, project.id);
  }
};
