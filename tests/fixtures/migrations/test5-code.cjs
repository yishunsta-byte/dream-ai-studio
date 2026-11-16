/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- code migration step: restricted .cjs format run by lib/db/code-migration.ts */
// Test-only code migration step 5 (T-048/T-051), shaped like the planned P1 edit snapshot -> first timeline move:
// each saved edit snapshot becomes one timeline row with ids derived from the source keys. Old rows stay as they are.
const { derivedId } = require("./test5-ids.cjs");
module.exports.sql = "CREATE TABLE test_k6_timeline (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, content_revision INTEGER NOT NULL, timeline_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, revision)) STRICT;";
module.exports.run = function run(sqlite) {
  const rows = sqlite.prepare("SELECT key, value_json FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current' ORDER BY key").all();
  const insert = sqlite.prepare("INSERT INTO test_k6_timeline (id, project_id, revision, content_revision, timeline_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const revisions = new Map();
  for (const row of rows) {
    const projectId = row.key.slice("project.".length, "project.".length + 36), snapshot = JSON.parse(row.value_json);
    const revision = (revisions.get(projectId) ?? 0) + 1;
    revisions.set(projectId, revision);
    const timeline = { schemaVersion: 1, from: row.key, text: snapshot.layers.map((layer) => ({ id: derivedId(`${row.key}#${layer.id}`), sourceLayerId: layer.id, content: layer.content })) };
    insert.run(derivedId(row.key), projectId, revision, snapshot.content_revision, JSON.stringify(timeline), "p1-migration", snapshot.created_at);
  }
};
