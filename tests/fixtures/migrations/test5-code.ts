// Test-only code migration step 5 (T-048), shaped like the planned P1 edit snapshot -> first timeline move:
// each saved edit snapshot becomes one timeline row with ids derived from the source keys. Old rows stay as they are.
import type Database from "better-sqlite3";
import { derivedId } from "./test5-ids";
export const entry="tests/fixtures/migrations/test5-code.ts";
export const sql="CREATE TABLE test_k6_timeline (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, content_revision INTEGER NOT NULL, timeline_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, revision)) STRICT;";
type Snapshot={content_revision:number;created_at:string;layers:{id:string;content:string}[]};
export function run(sqlite:Database.Database){
  const rows=sqlite.prepare("SELECT key, value_json FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current' ORDER BY key").all() as {key:string;value_json:string}[];
  const insert=sqlite.prepare("INSERT INTO test_k6_timeline (id, project_id, revision, content_revision, timeline_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const revisions=new Map<string,number>();
  for(const row of rows){
    const projectId=row.key.slice("project.".length,"project.".length+36),snapshot=JSON.parse(row.value_json) as Snapshot;
    const revision=(revisions.get(projectId)??0)+1;revisions.set(projectId,revision);
    const timeline={schemaVersion:1,from:row.key,text:snapshot.layers.map(layer=>({id:derivedId(`${row.key}#${layer.id}`),sourceLayerId:layer.id,content:layer.content}))};
    insert.run(derivedId(row.key),projectId,revision,snapshot.content_revision,JSON.stringify(timeline),"p1-migration",snapshot.created_at);
  }
}
