// T-053 test helper run as a child process: registers and runs one endless probe step and prints how it ended.
// The parent gives it an external deadline; a PASS needs this process to end on its own with the internal limit.
// argv: <repo root> <empty temp folder> <mode>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const [repo,base,mode]=process.argv.slice(2);
const load=(path:string)=>import(pathToFileURL(join(repo,path)).href);
const {codeMigration,codeMigrationSha256}=await load("lib/db/code-migration.ts");
const {migrateDatabase,migrationEntry}=await load("lib/db/migrate.ts");
const Database=createRequire(join(repo,"package.json"))("better-sqlite3");
const PROOF="module.exports.sql='CREATE TABLE proof2 (value INTEGER) STRICT;';\n";
const SOURCES:Record<string,string>={
  "module-loop":"for(;;){}\nmodule.exports.run=function(db){};",
  "entry-run-getter":"Object.defineProperty(module.exports,'run',{get(){for(;;){}}});",
  "entry-sql-getter":"module.exports.run=function(db){};Object.defineProperty(module.exports,'sql',{get(){for(;;){}}});",
  "run-loop":`${PROOF}module.exports.run=function(db){for(;;){}};`,
  "then-loop":`${PROOF}module.exports.run=function(db){return {then(){for(;;){}}};};`,
  "then-getter-loop":`${PROOF}module.exports.run=function(db){return {get then(){for(;;){}}};};`,
  "error-getter-loop":`${PROOF}module.exports.run=function(db){throw {get message(){for(;;){}}};};`,
  "microtask-loop":`${PROOF}module.exports.run=function(db){const again=()=>Promise.resolve().then(again);again();};`,
};
const started=Date.now(),out:Record<string,unknown>={mode};
try{
  const path="p/entry.cjs",full=join(base,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,SOURCES[mode]);
  out.phase="register";
  const step=codeMigration({version:2,name:"0002_probe.cjs",files:[path],sha256:codeMigrationSha256([{path,text:readFileSync(full,"utf8")}]),root:base,runTimeoutMs:200});
  out.phase="run";
  const db=new Database(":memory:");
  const baseStep=migrationEntry(1,"0001_base.sql","CREATE TABLE proof (value INTEGER) STRICT;");
  try{migrateDatabase(db,{migrations:[baseStep],now:()=>0});migrateDatabase(db,{migrations:[baseStep,step],now:()=>0});out.result="applied";}
  finally{out.journal=db.prepare("SELECT version FROM __schema_migrations ORDER BY version").all().map((row:{version:number})=>row.version);db.close();}
}catch(error){out.errorName=error instanceof Error?error.name:typeof error;out.message=error instanceof Error?error.message:"non-error";}
out.elapsedMs=Date.now()-started;
console.log(JSON.stringify(out));
