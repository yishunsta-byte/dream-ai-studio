// Test-only registry for code migration step 5 (T-048). Mirrors how a product code step would be listed:
// a static import of the step module, its closed file list, and the declared source hash.
import type Database from "better-sqlite3";
import { codeMigration } from "@/lib/db/code-migration";
import * as step from "./test5-code";
export const TEST5_CODE_FILES=["tests/fixtures/migrations/test5-code.ts","tests/fixtures/migrations/test5-ids.ts"] as const;
export const TEST5_CODE_SHA256="e20c30e4b4972193b1f782ae4ed578b168afc1291c444473b0525029a3c9a5b5";
// The step's own data check: one timeline row per saved edit snapshot with the same content revision and text count.
export function test5CodeVerify(sqlite:Database.Database){
  const expected=(sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").get() as {n:number}).n;
  const moved=(sqlite.prepare("SELECT COUNT(*) AS n FROM test_k6_timeline t JOIN settings s ON s.key=json_extract(t.timeline_json,'$.from') WHERE t.content_revision=json_extract(s.value_json,'$.content_revision') AND json_array_length(t.timeline_json,'$.text')=json_array_length(s.value_json,'$.layers')").get() as {n:number}).n;
  if(moved!==expected)throw new Error("test code step 5 moved data differs");
}
export const test5Code=(options:{root?:string;sha256?:string;verify?:(sqlite:Database.Database)=>void}={})=>codeMigration({version:5,name:"0005_test_only_code.ts",module:step,files:TEST5_CODE_FILES,sql:step.sql,sha256:options.sha256??TEST5_CODE_SHA256,verify:options.verify??test5CodeVerify,...(options.root?{root:options.root}:{})});
