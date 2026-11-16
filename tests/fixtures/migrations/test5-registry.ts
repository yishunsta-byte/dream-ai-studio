// Test-only registry for code migration step 5 (T-048/T-051). Mirrors how a product code step is listed: the closed
// file list (entry first) and the declared source hash. There is no import of the step: `run` and `sql` are loaded by
// codeMigration from the very text whose hash matched the declaration.
import type Database from "better-sqlite3";
import { codeMigration } from "@/lib/db/code-migration";
export const TEST5_CODE_FILES=["tests/fixtures/migrations/test5-code.cjs","tests/fixtures/migrations/test5-ids.cjs"] as const;
export const TEST5_CODE_SHA256="dd41a479b6a35c64e0035706559e46a3b161d4f3b479a3d75cce811986af4316";
// The step's own data check: one timeline row per saved edit snapshot with the same content revision and text count.
export function test5CodeVerify(sqlite:Database.Database){
  const expected=(sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE key GLOB 'project.*.edit.*' AND key NOT GLOB '*.current'").get() as {n:number}).n;
  const moved=(sqlite.prepare("SELECT COUNT(*) AS n FROM test_k6_timeline t JOIN settings s ON s.key=json_extract(t.timeline_json,'$.from') WHERE t.content_revision=json_extract(s.value_json,'$.content_revision') AND json_array_length(t.timeline_json,'$.text')=json_array_length(s.value_json,'$.layers')").get() as {n:number}).n;
  if(moved!==expected)throw new Error("test code step 5 moved data differs");
}
export const test5Code=(options:{root?:string;sha256?:string;verify?:(sqlite:Database.Database)=>void;runTimeoutMs?:number}={})=>codeMigration({version:5,name:"0005_test_only_code.cjs",files:TEST5_CODE_FILES,sha256:options.sha256??TEST5_CODE_SHA256,verify:options.verify??test5CodeVerify,...(options.root?{root:options.root}:{}),...(options.runTimeoutMs?{runTimeoutMs:options.runTimeoutMs}:{})});
