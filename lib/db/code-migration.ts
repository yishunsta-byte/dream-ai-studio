import "server-only";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type Database from "better-sqlite3";
import type { Migration } from "./migrate";

// K-6 ⑤ / T-017 3.4 (T-048): a data migration done in code is bound to its number and name by the hash of the exact
// source that runs it, so "exact prefix of the journal" also covers code steps.
//
// Contract (format "dream-code-migration/v1"):
// - A code step is an explicit, closed list of repository files. The first is the step module (entry); it exports
//   `entry` (its own path, the same string) and `run(sqlite)`. Every other listed file is a local module it imports.
// - The recorded sha256 is sha256 over the lines
//     dream-code-migration/v1
//     sql\0<sha256 of the step's schema SQL, CRLF→LF>
//     file\0<repo-relative posix path>\0<sha256 of the file text, CRLF→LF>     (one line per file, sorted by path)
//   joined with "\n". Changing any listed file, the SQL, a path, or the format changes the hash.
// - The hash is computed from the files on disk when the list is built and must equal the `sha256` declared next to
//   the static import of the module. The declared value ships in the same build as the imported `run`; a source tree
//   that differs from the build (or a stale declaration) therefore refuses to build the list, before any DB access.
// - Hidden dependencies are refused: a listed file may import only other listed files, `node:crypto` and type-only
//   imports. Dynamic import/require, clocks, randomness (also SQL 'now'/random()), environment and global access
//   are refused, so the same input gives the same output.
// - `migrateDatabase` runs `run` only for a migration object created here (identity-checked), right after the
//   step's SQL and inside the same transaction; `verify` stays a check that runs after all steps.
export const CODE_MIGRATION_FORMAT="dream-code-migration/v1";
export class MigrationSourceError extends Error{constructor(readonly reason:string){super(`코드 마이그레이션 원문을 확인하지 못했어요: ${reason}`);this.name="MigrationSourceError";}}
export type CodeStepModule={readonly entry:string;readonly run:(sqlite:Database.Database)=>void};
export type CodeStepDefinition={version:number;name:string;module:CodeStepModule;files:readonly string[];sql?:string;sha256:string;verify?:Migration["verify"];root?:string};

const certified=new WeakSet<Migration>();
export const isCertifiedCodeMigration=(migration:Migration)=>certified.has(migration);
const lf=(text:string)=>text.replace(/\r\n/g,"\n");
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const ALLOWED_PACKAGES=new Set(["node:crypto"]);
// SQL clocks and randomness, in the step SQL and in SQL text inside listed files.
const SQL_FORBIDDEN:[RegExp,string][]=[[/\b(?:random|randomblob)\s*\(/i,"SQL randomness"],[/['"]now['"]|\bcurrent_(?:timestamp|date|time)\b/i,"SQL clock"]];
const FORBIDDEN:[RegExp,string][]=[
  [/\brequire\s*\(/,"require"],[/\bimport\s*\(/,"dynamic import"],[/\bimport\.meta\b/,"import.meta"],
  [/\bDate\b/,"clock (Date)"],[/\bperformance\b/,"clock (performance)"],[/\bMath\.random\b/,"randomness (Math.random)"],
  [/\b(?:randomUUID|randomBytes|randomInt|getRandomValues)\b/,"randomness (crypto)"],[/\bprocess\b/,"process/environment"],
  [/\bglobalThis\b|\bwindow\b|\bglobal\b/,"global object"],[/\beval\b|\bFunction\s*\(/,"code evaluation"],
  ...SQL_FORBIDDEN,
];
const IMPORT=/\b(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?["']([^"']+)["']/g;

export function codeMigrationSha256(input:{sql:string;files:readonly {path:string;text:string}[]}){
  const files=[...input.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return sha([CODE_MIGRATION_FORMAT,`sql\0${sha(lf(input.sql))}`,...files.map(file=>`file\0${file.path}\0${sha(lf(file.text))}`)].join("\n"));
}

function resolveImport(from:string,specifier:string,listed:ReadonlySet<string>){
  const base=specifier.startsWith("@/")?specifier.slice(2):specifier.startsWith(".")?posix.join(posix.dirname(from),specifier):null;
  if(base===null)return null;
  return [base,`${base}.ts`,`${base}/index.ts`].find(candidate=>listed.has(candidate))??null;
}
// Throws MigrationSourceError when a listed file reaches outside the list or can vary between runs.
export function checkCodeStepSource(path:string,text:string,listed:ReadonlySet<string>){
  for(const [pattern,label] of FORBIDDEN)if(pattern.test(text))throw new MigrationSourceError(`${path}: ${label} 사용`);
  for(const match of text.matchAll(IMPORT)){
    const [,,typeOnly,specifier]=match;
    if(typeOnly||ALLOWED_PACKAGES.has(specifier))continue;
    if(!resolveImport(path,specifier,listed))throw new MigrationSourceError(`${path}: 목록에 없는 의존 ${specifier}`);
  }
}

export function codeMigration(definition:CodeStepDefinition):Migration{
  const root=definition.root??process.cwd(),files=definition.files;
  if(!files.length)throw new MigrationSourceError("원문 파일 목록이 비어 있어요");
  const listed=new Set(files);
  if(listed.size!==files.length)throw new MigrationSourceError("같은 파일이 두 번 있어요");
  for(const path of files)if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.ts$/.test(path)||path.split("/").some(part=>part==="."||part===".."))throw new MigrationSourceError(`${path}: 저장소 기준 상대 경로(.ts)가 아니에요`);
  if(definition.module.entry!==files[0])throw new MigrationSourceError(`실행 모듈 ${definition.module.entry}이 목록의 첫 파일 ${files[0]}과 달라요`);
  if(typeof definition.module.run!=="function")throw new MigrationSourceError(`${files[0]}: run이 없어요`);
  const read=files.map(path=>{
    const full=join(/*turbopackIgnore: true*/root,...path.split("/"));
    let text:string;
    try{const stat=lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("not a file");text=readFileSync(full,"utf8");}
    catch{throw new MigrationSourceError(`${path}: 파일을 읽지 못했어요`);}
    checkCodeStepSource(path,text,listed);
    return {path,text};
  });
  const sql=definition.sql??"";
  for(const [pattern,label] of SQL_FORBIDDEN)if(pattern.test(sql))throw new MigrationSourceError(`${definition.version} ${definition.name}: ${label} 사용`);
  const sha256=codeMigrationSha256({sql,files:read});
  if(sha256!==definition.sha256)throw new MigrationSourceError(`${definition.version} ${definition.name}: 원문 해시 ${sha256}가 선언 ${definition.sha256}와 달라요`);
  const migration:Migration=Object.freeze({version:definition.version,name:definition.name,sql:lf(sql),sha256,kind:"code" as const,sources:Object.freeze([...files]),run:definition.module.run,...(definition.verify?{verify:definition.verify}:{})});
  certified.add(migration);
  return migration;
}
