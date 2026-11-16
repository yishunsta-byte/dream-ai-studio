import "server-only";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import vm from "node:vm";
import type Database from "better-sqlite3";
import type { Migration } from "./migrate";

// K-6 ⑤ / T-017 3.4 (T-048, T-051): a data migration done in code is bound to its number and name by the hash of
// the exact source text that is executed.
//
// Contract "dream-code-migration/v2" (v1 was test-only and never recorded by the product; v1 records are not
// reinterpreted, a v2 list simply has a different hash):
// - A code step is an explicit, closed list of repository files in a restricted CommonJS-shaped `.cjs` format. The
//   first file is the entry; it sets `module.exports.run` (a synchronous function) and may set
//   `module.exports.sql` (the step's schema SQL, run right before `run`).
// - Recorded sha256 = sha256 of the lines "dream-code-migration/v2" and, per file sorted by path,
//   "file\0<repo-relative posix path>\0<sha256 of the text with CRLF→LF>", joined with "\n". The source files fully
//   define the step (its SQL is inside the entry file), so nothing has to run to compute the hash.
// - `codeMigration` reads each file once, hashes those strings and compares with the `sha256` declared in the
//   registry. Only after that match does it execute the very same strings. There is no way to pass a function in:
//   `run` and `sql` always come from the hashed text.
// - Execution happens in a fresh node:vm context with this loader's `require` only: a listed file by its exact
//   relative path (with `.cjs`, no extension guessing), and "node:crypto" as a facade exposing createHash("sha256").
//   Everything else fails. `import`/`export` syntax is a syntax error and dynamic import() has no loader, so there is
//   no second module graph next to the hashed one. String code generation and wasm are off; Date, Math.random,
//   Intl, Temporal, WeakRef/FinalizationRegistry, SharedArrayBuffer/Atomics and WebAssembly are blocked or removed.
// - Module top level runs under LOAD_TIMEOUT_MS. `run` runs synchronously under RUN_TIMEOUT_MS inside the
//   migration transaction; queued microtasks of the context are drained before it returns, and an async `run` or a
//   thenable result is refused (so the transaction rolls back and no write lands after it).
// - This is a trusted-migration loader, not a security sandbox: the host `sqlite` object handed to `run` can reach
//   the host realm. It catches wrong registrations, stale or edited sources and ordinary hidden inputs; it does not
//   prove that arbitrary hostile code is deterministic.
// - SQL clock/randomness is detected by the text rules in SQL_RULES only (see there). Determinism of a step is proved
//   per step by running it on the same input at different times and comparing, plus review.
// - Hash inputs do not include Node/V8/SQLite/better-sqlite3 versions or `verify`. Same input → same output is
//   assumed only on the versions in package-lock.json and Node 26; `verify` is a read-only check (query_only).
export const CODE_MIGRATION_FORMAT="dream-code-migration/v2";
export const LOAD_TIMEOUT_MS=1000;
export const RUN_TIMEOUT_MS=600000;
export class MigrationSourceError extends Error{constructor(readonly reason:string){super(`코드 마이그레이션 원문을 확인하지 못했어요: ${reason}`);this.name="MigrationSourceError";}}
export type CodeStepDefinition={version:number;name:string;files:readonly string[];sha256:string;verify?:Migration["verify"];root?:string;runTimeoutMs?:number};
const DEFINITION_KEYS=new Set(["version","name","files","sha256","verify","root","runTimeoutMs"]);

const certified=new WeakSet<Migration>();
export const isCertifiedCodeMigration=(migration:Migration)=>certified.has(migration);
const lf=(text:string)=>text.replace(/\r\n/g,"\n");
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const PATH=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.cjs$/;

// Detection rules for SQL clocks and randomness in any listed file and in the entry's `sql`. A rule list, not a proof.
export const SQL_RULES:readonly [RegExp,string][]=[
  [/\b(?:random|randomblob)\s*\(/i,"SQL randomness"],
  [/['"`]\s*now\s*['"`]/i,"SQL clock ('now')"],
  [/\bcurrent_(?:timestamp|date|time)\b/i,"SQL clock (CURRENT_*)"],
  [/\b(?:date|time|datetime|julianday|unixepoch)\s*\(\s*\)/i,"SQL clock (time value omitted)"],
  [/\bstrftime\s*\(\s*(?:'(?:[^']|'')*'|"(?:[^"]|"")*")\s*\)/i,"SQL clock (strftime time value omitted)"],
];
export function checkSqlText(where:string,text:string){for(const [pattern,label] of SQL_RULES)if(pattern.test(text))throw new MigrationSourceError(`${where}: ${label} 사용`);}

export function codeMigrationSha256(files:readonly {path:string;text:string}[]){
  const sorted=[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return sha([CODE_MIGRATION_FORMAT,...sorted.map(file=>`file\0${file.path}\0${sha(lf(file.text))}`)].join("\n"));
}

const PRELUDE=`"use strict";(()=>{const g=globalThis;const blocked=name=>Object.freeze(function(){throw new Error(name+" is not available in a code migration");});
Object.defineProperty(g,"Date",{value:blocked("Date"),writable:false,configurable:false,enumerable:false});
Object.defineProperty(Math,"random",{value:blocked("Math.random"),writable:false,configurable:false,enumerable:false});Object.freeze(Math);
for(const name of ["Intl","Temporal","WeakRef","FinalizationRegistry","SharedArrayBuffer","Atomics","WebAssembly","eval"])delete g[name];})();`;
const cryptoFacade=Object.freeze({createHash:(algorithm:unknown)=>{if(algorithm!=="sha256")throw new MigrationSourceError("node:crypto는 createHash(\"sha256\")만 쓸 수 있어요");return createHash("sha256");}});
const isThenable=(value:unknown)=>(typeof value==="object"||typeof value==="function")&&value!==null&&typeof (value as {then?:unknown}).then==="function";

type Loaded={run:(sqlite:Database.Database)=>void;sql:string};
// Executes the already verified texts. Never called before the declared hash matched.
function load(files:readonly {path:string;text:string}[],runTimeoutMs:number):Loaded{
  const context=vm.createContext({},{name:"dream-code-migration",codeGeneration:{strings:false,wasm:false},microtaskMode:"afterEvaluate"});
  new vm.Script(PRELUDE).runInContext(context,{timeout:LOAD_TIMEOUT_MS});
  const texts=new Map(files.map(file=>[file.path,file.text])),cache=new Map<string,{exports:Record<string,unknown>}>();
  const slot=context as Record<string,unknown>;
  // Calls `fn` from inside an evaluation of the context so the timeout applies and the context's microtasks drain.
  const call=(fn:unknown,args:unknown[],timeout:number)=>{slot.__dreamCall=fn;slot.__dreamArgs=args;try{return new vm.Script("__dreamCall(...__dreamArgs)").runInContext(context,{timeout});}finally{delete slot.__dreamCall;delete slot.__dreamArgs;}};
  const requireFrom=(from:string)=>(specifier:unknown)=>{
    if(specifier==="node:crypto")return cryptoFacade;
    if(typeof specifier!=="string"||!/^\.\.?\//.test(specifier))throw new MigrationSourceError(`${from}: 목록 밖 의존 ${String(specifier)}`);
    const target=posix.normalize(posix.join(posix.dirname(from),specifier));
    if(!texts.has(target))throw new MigrationSourceError(`${from}: 목록 밖 의존 ${specifier}`);
    return loadModule(target);
  };
  const loadModule=(path:string)=>{
    const hit=cache.get(path);if(hit)return hit.exports;
    const record=vm.runInContext("({exports:{}})",context) as {exports:Record<string,unknown>};cache.set(path,record);
    let fn:unknown;
    try{fn=vm.compileFunction(texts.get(path)!,["exports","require","module"],{parsingContext:context,filename:path});}
    catch(error){throw new MigrationSourceError(`${path}: 정해진 .cjs 형식이 아니에요 (${error instanceof Error?error.name:"문법"})`);}
    call(fn,[record.exports,requireFrom(path),record],LOAD_TIMEOUT_MS);
    return record.exports;
  };
  let entry:Record<string,unknown>;
  try{entry=loadModule(files[0].path);}catch(error){if(error instanceof MigrationSourceError)throw error;throw new MigrationSourceError(`${files[0].path}: 불러오는 중 실패 (${error instanceof Error?error.message:String(error)})`);}
  const run=entry.run,sql=entry.sql??"";
  if(typeof run!=="function")throw new MigrationSourceError(`${files[0].path}: module.exports.run이 없어요`);
  if(Object.prototype.toString.call(run)!=="[object Function]")throw new MigrationSourceError(`${files[0].path}: run은 동기 함수여야 해요`);
  if(typeof sql!=="string")throw new MigrationSourceError(`${files[0].path}: module.exports.sql은 문자열이어야 해요`);
  return {sql,run:(sqlite)=>{
    const result=call(run,[sqlite],runTimeoutMs);
    // Queued work already drained inside the evaluation above; mark the result handled and refuse it (rollback).
    if(isThenable(result)){try{(result as {then:(a:()=>void,b:()=>void)=>unknown}).then(()=>{},()=>{});}catch{/* refused below either way */}throw new MigrationSourceError(`${files[0].path}: run이 Promise를 돌려줬어요`);}
  }};
}

export function codeMigration(definition:CodeStepDefinition):Migration{
  for(const key of Object.keys(definition))if(!DEFINITION_KEYS.has(key))throw new MigrationSourceError(`알 수 없는 항목 ${key} (실행 함수는 원문에서만 가져와요)`);
  const root=definition.root??process.cwd(),files=definition.files,runTimeoutMs=definition.runTimeoutMs??RUN_TIMEOUT_MS;
  if(!Number.isInteger(runTimeoutMs)||runTimeoutMs<1||runTimeoutMs>RUN_TIMEOUT_MS)throw new MigrationSourceError("runTimeoutMs가 범위 밖이에요");
  if(!files.length)throw new MigrationSourceError("원문 파일 목록이 비어 있어요");
  if(new Set(files).size!==files.length)throw new MigrationSourceError("같은 파일이 두 번 있어요");
  for(const path of files)if(!PATH.test(path)||path.split("/").some(part=>part==="."||part===".."))throw new MigrationSourceError(`${path}: 저장소 기준 상대 경로(.cjs)가 아니에요`);
  const read=files.map(path=>{
    const full=join(/*turbopackIgnore: true*/root,...path.split("/"));
    try{const stat=lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("not a file");return {path,text:readFileSync(full,"utf8")};}
    catch{throw new MigrationSourceError(`${path}: 파일을 읽지 못했어요`);}
  });
  // 1) hash the strings just read and compare with the declaration; nothing has been executed yet.
  const sha256=codeMigrationSha256(read);
  if(sha256!==definition.sha256)throw new MigrationSourceError(`${definition.version} ${definition.name}: 원문 해시 ${sha256}가 선언 ${definition.sha256}와 달라요`);
  for(const file of read)checkSqlText(file.path,file.text);
  // 2) only now execute those same strings.
  const loaded=load(read,runTimeoutMs);
  checkSqlText(`${files[0]} sql`,loaded.sql);
  const migration:Migration=Object.freeze({version:definition.version,name:definition.name,sql:lf(loaded.sql),sha256,kind:"code" as const,sources:Object.freeze([...files]),run:loaded.run,...(definition.verify?{verify:definition.verify}:{})});
  certified.add(migration);
  return migration;
}
