// Logical content (H3) and comparison profiles from T-034 §2. Values keep their SQLite type
// (`1` vs `'1'`, integer vs real) and text is compared code unit for code unit, never normalized.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { S4_INPUTS, type S4Ids, type S4InputKey } from "./s4-build";

export type Cell=null|{i:string}|{r:string}|{t:string}|{b:string};
export type Row=Record<string,Cell>;
export type TableSnap={columns:string[];pk:string[];rows:Map<string,Row>};
export type DbSnap=Map<string,TableSnap>;
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
function encode(value:unknown,type:string):Cell{
  if(type==="null")return null;
  if(type==="integer")return {i:String(value)};
  if(type==="real"){const buffer=Buffer.alloc(8);buffer.writeDoubleBE(Number(value));return {r:buffer.toString("hex")};}
  if(type==="text")return {t:String(value)};
  return {b:Buffer.from(value as Uint8Array).toString("hex")};
}
export function snapshotDb(sqlite:Database.Database):DbSnap{
  const snap:DbSnap=new Map();
  for(const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]){
    const info=sqlite.prepare(`PRAGMA table_info("${name}")`).all() as {cid:number;name:string;pk:number}[];
    const columns=info.sort((a,b)=>a.cid-b.cid).map(column=>column.name),pk=info.filter(column=>column.pk>0).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
    const statement=sqlite.prepare(`SELECT ${columns.map(column=>`"${column}", typeof("${column}")`).join(",")}${pk.length?"":", rowid"} FROM "${name}"`).raw(true).safeIntegers(true);
    const rows=new Map<string,Row>();
    for(const raw of statement.all() as unknown[][]){const row:Row={};columns.forEach((column,index)=>{row[column]=encode(raw[index*2],String(raw[index*2+1]));});rows.set(JSON.stringify(pk.length?pk.map(column=>row[column]):[String(raw[columns.length*2])]),row);}
    snap.set(name,{columns,pk,rows});
  }
  return snap;
}
export type Exclude=(table:string,column:string,row:Row)=>boolean;
const none:Exclude=()=>false;
export function logicalHash(snap:DbSnap,exclude:Exclude=none){
  const tables:Record<string,string>={};
  for(const [name,table] of [...snap].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const lines=[...table.rows.keys()].sort().map(key=>{const row=table.rows.get(key)!;return JSON.stringify(table.columns.map(column=>exclude(name,column,row)?"<excluded>":row[column]));});
    tables[name]=sha(`${name}\n${lines.join("\n")}\n`);
  }
  return {all:sha(Object.entries(tables).map(([name,hash])=>`${name}=${hash}`).join("\n")),tables};
}
export function schemaHash(sqlite:Database.Database){return sha(JSON.stringify(sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()));}

const version=(row:Row)=>Number((row.version as {i:string}|null)?.i);
// P_REGEN: a regenerated DB vs the record. migrateDatabase stamps rows 1–4 with the run time.
export const P_REGEN:Exclude=(table,column)=>table==="__schema_migrations"&&column==="applied_at";
// P_RESTORE / P_MIGRATE: rows 1–4 come from the backup and must match; only later steps are stamped now.
export const P_JOURNAL_AFTER_4:Exclude=(table,column,row)=>table==="__schema_migrations"&&column==="applied_at"&&version(row)>4;
export const isoCell=(cell:Cell)=>!!cell&&"t" in cell&&!Number.isNaN(Date.parse(cell.t))&&/Z$/.test(cell.t);

export const text=(cell:Cell|undefined)=>cell&&"t" in cell?cell.t:null;
export const int=(cell:Cell|undefined)=>cell&&"i" in cell?Number(cell.i):null;

// H3-U: where each user-entered value lives. Values are compared as UTF-8 bytes.
export function inputLocations(ids:S4Ids):{key:S4InputKey;table:string;pk:unknown[];column:string;path?:(value:unknown)=>unknown}[]{
  const t=(id:string)=>[{t:id}],j=(value:string)=>JSON.parse(value) as never;
  return [
    {key:"projectTitle",table:"projects",pk:t(ids.main),column:"title"},
    {key:"projectTitle",table:"projects",pk:t(ids.main),column:"inputs_json",path:value=>(j(value as string) as {title:string}).title},
    {key:"nfd",table:"projects",pk:t(ids.draft),column:"title"},
    {key:"nfc",table:"assets",pk:t(ids.up2),column:"title"},
    {key:"nfc",table:"projects",pk:t(ids.main),column:"inputs_json",path:value=>(j(value as string) as {nfc:string}).nfc},
    {key:"nfd",table:"projects",pk:t(ids.main),column:"inputs_json",path:value=>(j(value as string) as {nfd:string}).nfd},
    {key:"emoji",table:"characters",pk:t(ids.char1),column:"description"},
    {key:"longTitle",table:"projects",pk:t(ids.archived),column:"title"},
    {key:"script",table:"plans",pk:t(ids.plan2),column:"script"},
    {key:"jsonish",table:"scenes",pk:t(ids.s1),column:"description"},
    {key:"dialogue",table:"scenes",pk:t(ids.s1),column:"dialogue_json",path:value=>(j(value as string) as {text:string}[])[0].text},
    {key:"emptyDialogue",table:"scenes",pk:t(ids.s2),column:"dialogue_json",path:value=>(j(value as string) as {text:string}[])[0].text},
    {key:"reviewNote",table:"review_items",pk:t(ids.rv3),column:"note"},
    {key:"rightsNote",table:"assets",pk:t(ids.up1),column:"rights_note"},
    {key:"subtitle1",table:"settings",pk:[{t:`project.${ids.main}.edit.${ids.edit2}`}],column:"value_json",path:value=>(j(value as string) as {layers:{content:string}[]}).layers[1].content},
    {key:"subtitle2",table:"settings",pk:[{t:`project.${ids.main}.edit.${ids.edit2}`}],column:"value_json",path:value=>(j(value as string) as {layers:{content:string}[]}).layers[2].content},
  ];
}
export function checkInputs(snap:DbSnap,ids:S4Ids){
  const problems:string[]=[];
  for(const location of inputLocations(ids)){const row=snap.get(location.table)?.rows.get(JSON.stringify(location.pk));const raw=text(row?.[location.column]);const value=location.path&&raw!==null?location.path(raw):raw;
    if(typeof value!=="string"||Buffer.from(value,"utf8").toString("hex")!==Buffer.from(S4_INPUTS[location.key],"utf8").toString("hex"))problems.push(`${location.key}@${location.table}.${location.column}`);}
  return problems;
}
export function inputsDigest(){return sha(JSON.stringify(Object.entries(S4_INPUTS).map(([key,value])=>[key,Buffer.from(value,"utf8").toString("hex")])));}
