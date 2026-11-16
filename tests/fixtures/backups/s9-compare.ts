// T156: fixed/restore byte identity is distinct from the explicitly bounded native-run comparison below.
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { openDatabase } from "@/lib/db/connection";
import type { BackupManifest } from "@/lib/backup/schema";
import { logicalHash, P_REGEN, schemaHash, snapshotDb } from "./s4-compare";
import type { S9Ids } from "./s9-build";
export type Digest={sha256:string;sizeBytes:number};
export type S9Record={fixture:"s9";generatorVersion:number;basis:string;license:string;zip:Digest;backupId:string;migrations:BackupManifest["migrations"];ids:S9Ids;tools:Record<string,string>;videoPackets:Record<string,string>;logical:{profile:"P_S9_REGEN";all:string;tables:Record<string,string>};schema:string;timelines:unknown[];renders:unknown[];audioSources:unknown[];files:BackupManifest["files"]};
export function describeS9(path:string,ids:S9Ids){const db=openDatabase(path,{readonly:true,fileMustExist:true});try{
  // Native execution uses real clocks. Normalize only well-formed SQL lifecycle clock text, keeping NULL/type
  // differences visible (archived vs not archived is meaningful). Never normalize user/timeline/input/verify JSON.
  const snapshot=snapshotDb(db.sqlite),clocks=new Set(["created_at","updated_at","started_at","finished_at","archived_at","heartbeat_at","lease_until","next_run_at","cancel_requested_at"]);
  for(const [table,data] of snapshot)for(const row of data.rows.values())for(const column of data.columns){const cell=row[column];
    if(clocks.has(column)&&cell&&"t" in cell&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(cell.t)&&Number.isFinite(Date.parse(cell.t)))row[column]={t:"<runtime-clock>"};
    if(table==="settings"&&column==="value_json"&&cell&&"t" in cell&&row.key&&"t" in row.key&&/^job\.01a1e8a4-.*\.startedAt$/.test(row.key.t)){
      const parsed:unknown=JSON.parse(cell.t);if(typeof parsed==="string"&&Number.isFinite(Date.parse(parsed)))row[column]={t:'"<runtime-job-start>"'};
    }
  }
  const logical=logicalHash(snapshot,(table,column,row)=>P_REGEN(table,column,row)||(table==="backups"&&column==="path"&&row.id!==null&&"t" in row.id&&row.id.t===ids.backup));
  return {logical,schema:schemaHash(db.sqlite),timelines:db.sqlite.prepare("SELECT id,revision,timeline_json,timeline_sha256 FROM timeline_revisions WHERE project_id=? ORDER BY revision").all(ids.project),renders:renderRows(db.sqlite),audioSources:db.sqlite.prepare("SELECT id,kind,title,file_path,mime,size_bytes,sha256,duration_ms,rights_note FROM assets WHERE id IN (?,?) ORDER BY id").all(ids.voice,ids.music)};
}finally{db.close();}}
export function renderRows(db:Database.Database){return db.prepare("SELECT id,timeline_rev_id,input_json,input_sha256,status,file_path,sha256,size_bytes,verify_json FROM renders ORDER BY name_seq").all();}
export const readS9=(path:string)=>JSON.parse(readFileSync(path,"utf8")) as S9Record;




// Master msg_2008113a6320: native runs need not be byte-identical. This comparator NEVER applies to the fixed ZIP
// or restore: those keep exact full digests/rows. A fresh run keeps exact inputs, source/tool/video identities and
// the original acceptance policy; its own mix/MP4 hashes are run evidence, not rewritten golden expectations.
import { renderAudioRecordSchema, renderInputSha256 } from "@/lib/db/render-data";
import { canonicalJson } from "@/lib/edit/timeline";
import type { RenderAudioRecord, VerifyItem, VerifyResult } from "@/lib/render/verify";
type NativeRow={id:string;timeline_rev_id:string;input_json:string;input_sha256:string;status:string;file_path:string;sha256:string;size_bytes:number;verify_json:string};
type NativeVerify=VerifyResult&{audio?:RenderAudioRecord};
export function nativeS9Issues(expected:S9Record,fresh:S9Record):string[]{
  const issues:string[]=[],same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b),fail=(ok:boolean,label:string)=>{if(!ok)issues.push(label);};
  for(const key of ["basis","generatorVersion","ids","migrations","schema","tools","timelines","audioSources","videoPackets"] as const)fail(same(expected[key],fresh[key]),key);
  const stableTables=(record:S9Record)=>Object.fromEntries(Object.entries(record.logical.tables).filter(([name])=>!["renders","activity_log"].includes(name)));fail(same(stableTables(expected),stableTables(fresh)),"stable logical tables");
  const oldRows=expected.renders as NativeRow[],rows=fresh.renders as NativeRow[];fail(rows.length===oldRows.length,"render count");
  const outputPaths=new Set(oldRows.map(row=>`storage/${row.file_path}`));fail(same(expected.files.filter(f=>!outputPaths.has(f.path)),fresh.files.filter(f=>!outputPaths.has(f.path))),"non-render file bytes");
  for(const old of oldRows){const row=rows.find(r=>r.id===old.id);if(!row){issues.push("missing render");continue;}
    for(const key of ["id","timeline_rev_id","input_json","input_sha256","status","file_path"] as const)fail(row[key]===old[key],`render ${key}`);
    fail(row.status==="succeeded"&&row.input_sha256===renderInputSha256(row.input_json),"render result/input hash");
    fail(/^[a-f0-9]{64}$/.test(row.sha256)&&Number.isSafeInteger(row.size_bytes)&&row.size_bytes>0,"native file digest shape");
    fail(fresh.files.some(f=>f.path===`storage/${row.file_path}`&&f.sha256===row.sha256&&f.sizeBytes===row.size_bytes),"native file/manifest binding");
    try{const a=JSON.parse(old.verify_json) as NativeVerify,b=JSON.parse(row.verify_json) as NativeVerify;
      fail(b.result==="passed"&&Array.isArray(b.items)&&b.items.every(item=>item.pass===true),"verify verdict");
      fail(same({...a.probe,sizeBytes:0},{...b.probe,sizeBytes:0})&&b.probe.sizeBytes===row.size_bytes,"codec/frame/probe");
      fail(b.probe.frames===120&&b.probe.durationSec===4&&b.probe.codec==="h264"&&b.probe.fps==="30/1","fixed output geometry");
      if(old.id===expected.ids.b){const audio=renderAudioRecordSchema.parse(b.audio),base=renderAudioRecordSchema.parse(a.audio);
        fail(audio.status==="normalized"&&audio.accepted===true&&audio.loudness!==null,"normalized verdict");
        fail(same(audio.tools,base.tools)&&same(audio.target,base.target)&&audio.profile===base.profile,"audio pins/profile/target");
        fail(same(audio.sources,base.sources),"decoded source identity");
        fail(audio.mix.samples===192000&&audio.output.decodedSamples===192000&&audio.mix.peak>0,"exact samples/mix");
        fail(same(audio.output,base.output)&&audio.output.videoStreamSha256===fresh.videoPackets[row.id],"video packet/padding identity");
        const m=audio.final;fail(typeof m.integrated==="number"&&Number.isFinite(m.integrated)&&Math.abs(m.integrated+14)<=1&&typeof m.truePeak==="number"&&Number.isFinite(m.truePeak)&&m.truePeak<=-1&&typeof m.range==="number"&&Number.isFinite(m.range)&&m.range>=0,"original loudness policy");
        fail(same(audio.childFinal,audio.final),"child/final measurement consistency");
        fail(audio.loudness!==null&&Object.entries(audio.loudness).every(([key,value])=>key==="normalizationType"?typeof value==="string"&&value.length>0:typeof value==="number"&&Number.isFinite(value)),"finite two-pass measurements");
        fail(b.items.length===a.items.length,"verify item count");
        for(const item of a.items){const next=b.items.find(v=>v.item===item.item);let value:VerifyItem["actual"]=item.actual;if(item.item==="sizeBytes")value=row.size_bytes;if(item.item==="loudnessIntegrated")value=audio.final.integrated;if(item.item==="truePeak")value=audio.final.truePeak;fail(!!next&&next.expected===item.expected&&next.actual===value&&next.pass===true,`verify item ${item.item}`);}
      }else{fail(b.audio===undefined&&b.probe.audioStreams===0,"A remains silent");const strip=(v:NativeVerify)=>({...v,probe:{...v.probe,sizeBytes:0},items:v.items.map(item=>item.item==="sizeBytes"?{...item,actual:0}:item)});fail(same(strip(a),strip(b)),"A verify identity");}
    }catch{issues.push("invalid native verify shape");}
  }
  return [...new Set(issues)];
}
