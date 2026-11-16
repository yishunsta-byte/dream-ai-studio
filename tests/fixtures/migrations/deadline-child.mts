// T-053/T-055 test helper run as a child process. The parent gives it an external deadline; a PASS needs this process
// to end on its own (status 0) after printing its JSON line.
// - endless modes: register and run one endless probe step and print how it ended (internal limit or refusal).
// - "ab-*" modes: one probe step used on two open databases A and B, three times each in turn; then a normal step on
//   both; then a 100 ms wait. An unhandled rejection left behind would end the process before "waitCompleted".
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
  // T-055: values the rejection handling must not touch (no then call, no Proxy trap).
  "thrown-then-loop":`${PROOF}module.exports.run=function(db){throw {then(){for(;;){}}};};`,
  "proxy-trap-loop":`${PROOF}module.exports.run=function(db){const loop=()=>{for(;;){}};return new Proxy(Promise.resolve(),{get:loop,getPrototypeOf:loop,defineProperty:loop,getOwnPropertyDescriptor:loop,has:loop});};`,
  "microtask-loop":`${PROOF}module.exports.run=function(db){const again=()=>Promise.resolve().then(again);again();};`,
  // T-054 originals and neighbours: rejected native promises returned or thrown, after a write that must roll back.
  "ab-reject-immediate":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(5)');return Promise.reject(new Error('ORDINARY_REJECTION'));};",
  "ab-reject-queued":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(6)');return Promise.resolve().then(()=>{throw new Error('ORDINARY_QUEUED_REJECTION');});};",
  "ab-reject-subclass":"class P extends Promise{}module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(7)');return P.reject(new Error('SUBCLASS_REJECTION'));};",
  "ab-reject-species-getter":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(8)');const p=Promise.reject(new Error('SPECIES'));Object.defineProperty(p,'constructor',{get(){return Promise;}});return p;};",
  "ab-throw-rejected":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(9)');throw Promise.reject(new Error('THROWN_REJECTION'));};",
  // Lookups that throw while the handler is attached: handled by the second attempt (own constructor: undefined).
  "ab-species-throw":"class P extends Promise{static get [Symbol.species](){throw new Error('SPECIES_THROW');}}module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(10)');return P.reject(new Error('R'));};",
  "ab-constructor-getter-throw":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(11)');const p=Promise.reject(new Error('R'));Object.defineProperty(p,'constructor',{get(){throw new Error('CTOR_THROW');},configurable:true});return p;};",
  // Stated limits, recorded as they really end (not counted as handled).
  "limit-frozen-species-throw":"class P extends Promise{static get [Symbol.species](){throw new Error('SPECIES_THROW');}}module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(12)');return Object.preventExtensions(P.reject(new Error('LIMIT_FROZEN')));};",
  "limit-nonconfigurable-constructor":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(13)');const p=Promise.reject(new Error('LIMIT_NONCONFIGURABLE'));Object.defineProperty(p,'constructor',{get(){throw new Error('CTOR_THROW');},configurable:false});return p;};",
  "limit-species-loop":"class P extends Promise{static get [Symbol.species](){for(;;){}}}module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(14)');return P.reject(new Error('LIMIT_SPECIES_LOOP'));};",
  "limit-floating":"module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(15)');Promise.reject(new Error('LIMIT_FLOATING'));};",
};
const BASE=migrationEntry(1,"0001_base.sql","CREATE TABLE proof (value INTEGER) STRICT;");
const write=(path:string,text:string)=>{const full=join(base,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);return {path,text:readFileSync(full,"utf8")};};
const register=(path:string,text:string)=>{const file=write(path,text);return codeMigration({version:2,name:"0002_probe.cjs",files:[path],sha256:codeMigrationSha256([file]),root:base,runTimeoutMs:200});};
const state=(db:{prepare:(sql:string)=>{all:()=>unknown[]};inTransaction:boolean})=>({rows:db.prepare("SELECT value FROM proof").all(),journal:db.prepare("SELECT version FROM __schema_migrations ORDER BY version").all().map(row=>(row as {version:number}).version),tx:db.inTransaction});
const started=Date.now(),out:Record<string,unknown>={mode};
try{
  if(mode.startsWith("ab-")||mode.startsWith("limit-")){
    const step=register("p/entry.cjs",SOURCES[mode]),good=register("p/good.cjs","module.exports.run=function(db){db.exec('INSERT INTO proof VALUES(1)');};");
    const a=new Database(":memory:"),b=new Database(":memory:");for(const db of [a,b])migrateDatabase(db,{migrations:[BASE],now:()=>0});
    const errors:string[]=[],states:unknown[]=[];
    for(let round=0;round<3;round++)for(const db of [a,b]){try{migrateDatabase(db,{migrations:[BASE,step],now:()=>0});errors.push("applied");}catch(error){errors.push(error instanceof Error?`${error.name}: ${error.message}`:"non-error");}states.push({a:state(a),b:state(b)});}
    out.errors=errors;out.states=states;
    for(const db of [a,b])migrateDatabase(db,{migrations:[BASE,good],now:()=>0});
    out.after={a:state(a),b:state(b)};
    await new Promise(resolve=>setTimeout(resolve,100));
    out.final={a:state(a),b:state(b)};out.waitCompleted=true;a.close();b.close();
  }else{
    const path="p/entry.cjs",full=join(base,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,SOURCES[mode]);
    out.phase="register";
    const step=codeMigration({version:2,name:"0002_probe.cjs",files:[path],sha256:codeMigrationSha256([{path,text:readFileSync(full,"utf8")}]),root:base,runTimeoutMs:200});
    out.phase="run";
    const db=new Database(":memory:");
    try{migrateDatabase(db,{migrations:[BASE],now:()=>0});migrateDatabase(db,{migrations:[BASE,step],now:()=>0});out.result="applied";}
    finally{out.journal=db.prepare("SELECT version FROM __schema_migrations ORDER BY version").all().map((row:{version:number})=>row.version);db.close();}
  }
}catch(error){out.errorName=error instanceof Error?error.name:typeof error;out.message=error instanceof Error?error.message:"non-error";}
out.elapsedMs=Date.now()-started;
console.log(JSON.stringify(out));
