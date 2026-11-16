import "server-only";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { types } from "node:util";
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
// - Recorded sha256 = sha256 of the lines "dream-code-migration/v2", "entry\0<path of the first listed file>" and,
//   per file sorted by path, "file\0<repo-relative posix path>\0<sha256 of the text with CRLF→LF>", joined with
//   "\n". The entry line binds which file is executed: the same files with another entry give another hash. Only the
//   order of the helper files after the entry does not matter. The source files fully define the step (its SQL is
//   inside the entry file), so nothing has to run to compute the hash.
// - `codeMigration` reads each file once, hashes those strings and compares with the `sha256` declared in the
//   registry. Only after that match does it execute the very same strings. There is no way to pass a function in:
//   `run` and `sql` always come from the hashed text.
// - Execution happens in a fresh node:vm context with this loader's `require` only: a listed file by its exact
//   relative path (with `.cjs`, no extension guessing), and "node:crypto" as a facade exposing createHash("sha256").
//   Everything else fails. `import`/`export` syntax is a syntax error and dynamic import() has no loader, so there is
//   no second module graph next to the hashed one. String code generation and wasm are off; Date, Math.random,
//   Intl, Temporal, WeakRef/FinalizationRegistry, SharedArrayBuffer/Atomics and WebAssembly are blocked or removed.
// - Every use gets a fresh context: registration loads once to check the entry and read its `sql`, and each `run`
//   loads the same captured strings again. Module top level runs under LOAD_TIMEOUT_MS; `run` runs synchronously
//   under RUN_TIMEOUT_MS inside the migration transaction. Microtasks queued by step code drain inside that timed
//   evaluation (afterEvaluate), and the context is never evaluated again, so nothing can reach a later database.
// - `run` must return undefined. The check is a primitive comparison inside the VM; any other value (a Promise, a
//   thenable, any object) is refused without being read, and the transaction rolls back. Reading the entry exports,
//   the async-function check and turning an error into name/message text all happen inside timed evaluations with
//   intrinsics captured before step code runs; the host only ever receives primitive strings. A timeout is
//   recognised from the timeout error's own `code` data property only.
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

// `files` in list order: the first one is the entry that is executed.
export function codeMigrationSha256(files:readonly {path:string;text:string}[]){
  if(!files.length)throw new MigrationSourceError("원문 파일 목록이 비어 있어요");
  const sorted=[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return sha([CODE_MIGRATION_FORMAT,`entry\0${files[0].path}`,...sorted.map(file=>`file\0${file.path}\0${sha(lf(file.text))}`)].join("\n"));
}

// Runs in every fresh context before any step code. It blocks clocks/randomness, takes the host bridge off the global
// object, and keeps private helpers built from intrinsics captured now, so step code cannot change how the entry
// exports, the result of `run` or an error are read. Helpers return only primitive strings and are called from inside
// a timed evaluation; after this point the host never writes to, or reads from, the context's global object.
const PRELUDE=`"use strict";(()=>{const g=globalThis;const blocked=name=>Object.freeze(function(){throw new Error(name+" is not available in a code migration");});
const apply=Reflect.apply,toStr=Object.prototype.toString,S=String,define=Object.defineProperty,freeze=Object.freeze,promiseThen=Promise.prototype.then,ignore=()=>undefined;
// A returned or thrown native Promise is refused like any other value, but its rejection must not outlive the step as
// an unhandled rejection. Only values the host's internal-slot check (util.types.isPromise: no traps, no getters)
// calls a native Promise are touched, so a plain thenable or a Proxy never has its then/getters called. The captured
// intrinsic then attaches a no-op rejection handler; its constructor/Symbol.species lookups run here, inside the
// timed evaluation. If that lookup throws, an own constructor property set to undefined is defined on the promise (the default
// %Promise% is then used, no species lookup) and the handler is attached again. A promise that is non-extensible with a
// throwing lookup, or has a non-configurable throwing constructor property, still cannot be handled (stated limit). The
// derived promise settles with undefined, so it is never an unhandled rejection itself.
const settle=value=>{if(!apply(host.isPromise,undefined,[value]))return;
  try{apply(promiseThen,value,[undefined,ignore]);return;}catch(_){}
  try{define(value,"constructor",{value:undefined,writable:true,configurable:true,enumerable:false});apply(promiseThen,value,[undefined,ignore]);}catch(_){}};
const host=g.__dreamHost;delete g.__dreamHost;
define(g,"Date",{value:blocked("Date"),writable:false,configurable:false,enumerable:false});
define(Math,"random",{value:blocked("Math.random"),writable:false,configurable:false,enumerable:false});freeze(Math);
for(const name of ["Intl","Temporal","WeakRef","FinalizationRegistry","SharedArrayBuffer","Atomics","WebAssembly","eval"])delete g[name];
const describe=e=>{try{if(e!==null&&(typeof e==="object"||typeof e==="function"))return S(e.name)+"\\0"+S(e.message);return "Error\\0"+S(e);}catch(_){return "Error\\0unreadable error";}};
let run;
define(g,"__dream",{value:freeze({
  load(){try{const entry=apply(host.loadEntry,undefined,[]);const r=entry.run,sql=entry.sql;
    if(typeof r!=="function")return "fail\\0module.exports.run이 없어요";
    if(apply(toStr,r,[])!=="[object Function]")return "fail\\0run은 동기 함수여야 해요";
    if(sql!==undefined&&typeof sql!=="string")return "fail\\0module.exports.sql은 문자열이어야 해요";
    run=r;return "ok\\0"+(sql===undefined?"":sql);}catch(e){return "error\\0"+describe(e);}},
  run(){let result;try{result=apply(run,undefined,[apply(host.database,undefined,[])]);}catch(e){settle(e);return "error\\0"+describe(e);}
    if(result===undefined)return "ok\\0";
    settle(result);return "fail\\0run은 undefined만 돌려줄 수 있어요 (Promise·객체 반환 거부)";},
}),writable:false,configurable:false,enumerable:false});
return ()=>({exports:{}});})();`;
const cryptoFacade=Object.freeze({createHash:(algorithm:unknown)=>{if(algorithm!=="sha256")throw new MigrationSourceError("node:crypto는 createHash(\"sha256\")만 쓸 수 있어요");return createHash("sha256");}});
const LOAD_SCRIPT=new vm.Script("__dream.load()"),RUN_SCRIPT=new vm.Script("__dream.run()");

// A timed evaluation that did not return: the timeout error is created in the context realm, so only its own data
// property `code` is read (no getter or prototype lookup); any other escape is reported without reading it.
function stopped(error:unknown,limitMs:number){
  const code=typeof error==="object"&&error!==null?Object.getOwnPropertyDescriptor(error,"code"):undefined;
  const timedOut=!!code&&"value" in code&&code.value==="ERR_SCRIPT_EXECUTION_TIMEOUT";
  const failure=new Error(timedOut?`코드 마이그레이션이 시간 제한 ${limitMs}ms 안에 끝나지 않았어요 (ERR_SCRIPT_EXECUTION_TIMEOUT)`:"코드 마이그레이션 실행이 중단됐어요");
  failure.name=timedOut?"MigrationTimeoutError":"MigrationStoppedError";return failure;
}
// Error from a timed evaluation, rebuilt from primitives only.
function failure(outcome:string,where:string){
  const [kind,first,...rest]=outcome.split("\0");
  if(kind==="fail")return new MigrationSourceError(`${where}: ${first}`);
  const error=new Error(rest.join("\0"));error.name=first||"Error";return error;
}

// One fresh context per use: load the verified texts (LOAD_TIMEOUT_MS) and, when `sqlite` is given, run the step
// (runTimeoutMs). Microtasks queued by step code drain inside these evaluations (afterEvaluate); the context is never
// evaluated again afterwards, so nothing queued in it can reach a later database. Never called before the hash matched.
// A loader refusal (out-of-list require, bad format) is final even if step code caught it.
function execute(files:readonly {path:string;text:string}[],options:{runTimeoutMs:number;sqlite?:Database.Database}){
  const texts=new Map(files.map(file=>[file.path,file.text])),cache=new Map<string,{exports:unknown}>(),entryPath=files[0].path;
  let sourceError:MigrationSourceError|undefined,database:Database.Database|undefined;
  const refuse=(error:MigrationSourceError)=>{sourceError??=error;throw error;};
  const requireFrom=(from:string)=>(specifier:unknown)=>{
    if(specifier==="node:crypto")return cryptoFacade;
    if(typeof specifier!=="string"||!/^\.\.?\//.test(specifier))return refuse(new MigrationSourceError(`${from}: 목록 밖 의존 ${typeof specifier==="string"?specifier:`(${typeof specifier})`}`));
    const target=posix.normalize(posix.join(posix.dirname(from),specifier));
    if(!texts.has(target))return refuse(new MigrationSourceError(`${from}: 목록 밖 의존 ${specifier}`));
    return loadModule(target);
  };
  // Host bridge, handed over before any step code runs and then removed from the global object by the prelude.
  const bridge=Object.freeze({loadEntry:()=>loadModule(entryPath),database:()=>database,isPromise:(value:unknown)=>types.isPromise(value)});
  const context=vm.createContext({__dreamHost:bridge},{name:"dream-code-migration",codeGeneration:{strings:false,wasm:false},microtaskMode:"afterEvaluate"});
  const newRecord=new vm.Script(PRELUDE).runInContext(context,{timeout:LOAD_TIMEOUT_MS}) as ()=>{exports:unknown};
  // Runs only inside a timed evaluation: through __dream.load, or when step code calls require.
  const loadModule=(path:string):unknown=>{
    const hit=cache.get(path);if(hit)return hit.exports;
    let fn:(...args:unknown[])=>unknown;
    try{fn=vm.compileFunction(texts.get(path)!,["exports","require","module"],{parsingContext:context,filename:path}) as (...args:unknown[])=>unknown;}
    catch(error){return refuse(new MigrationSourceError(`${path}: 정해진 .cjs 형식이 아니에요 (${error instanceof SyntaxError?"SyntaxError":"문법"})`));}
    const record=newRecord();cache.set(path,record);
    fn(record.exports,requireFrom(path),record);
    return record.exports;
  };
  let loaded:string;
  try{loaded=LOAD_SCRIPT.runInContext(context,{timeout:LOAD_TIMEOUT_MS}) as string;}
  catch(error){throw sourceError??new MigrationSourceError(`${entryPath}: 불러오는 중 실패 (${stopped(error,LOAD_TIMEOUT_MS).message})`);}
  if(sourceError)throw sourceError;
  if(!loaded.startsWith("ok\0")){const error=failure(loaded,entryPath);throw error instanceof MigrationSourceError?error:new MigrationSourceError(`${entryPath}: 불러오는 중 실패 (${error.name}: ${error.message})`);}
  const sql=loaded.slice(3);
  if(!options.sqlite)return sql;
  database=options.sqlite;
  let outcome:string;
  try{outcome=RUN_SCRIPT.runInContext(context,{timeout:options.runTimeoutMs}) as string;}
  catch(error){throw sourceError??stopped(error,options.runTimeoutMs);}
  finally{database=undefined;}
  if(sourceError)throw sourceError;
  if(outcome!=="ok\0")throw failure(outcome,entryPath);
  return sql;
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
  //    A validation load in its own context gives the entry shape and its SQL (a string); that context is dropped.
  const sql=execute(read,{runTimeoutMs});
  checkSqlText(`${files[0]} sql`,sql);
  //    Each run loads the same captured strings again in a fresh context; the SQL must still be the registered one.
  const run=(sqlite:Database.Database)=>{if(execute(read,{runTimeoutMs,sqlite})!==sql)throw new MigrationSourceError(`${files[0]}: 실행할 때 sql이 등록 때와 달라요`);};
  const migration:Migration=Object.freeze({version:definition.version,name:definition.name,sql:lf(sql),sha256,kind:"code" as const,sources:Object.freeze([...files]),run,...(definition.verify?{verify:definition.verify}:{})});
  certified.add(migration);
  return migration;
}
