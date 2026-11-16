import type Database from "better-sqlite3";
import { manifestSchema } from "@/lib/export/schema";

// P2-6 S2 (T-158): every export row read back through the manifest contract. Runs after 0010 is applied, after every
// live upgrade and on every restore (direct and right after a staging upgrade). It reads the rows themselves and does
// not trust the 0010 triggers to be present (a copied database file may have lost them).
export class ExportRowError extends Error{constructor(readonly exportId:string,readonly reason:string){super(`Export row differs: ${reason}`);this.name="ExportRowError";}}
type Row={id:string;project_id:string;content_revision:number;status:string;file_path:string|null;manifest_version:unknown;manifest_json:string|null;sha256:string|null;completed_at:string|null};
export function exportRowIssue(row:Row):string|null{
  if(typeof row.manifest_version!=="number"||![1,2].includes(row.manifest_version))return "manifest_version is not 1 or 2";
  if(!["running","succeeded","failed"].includes(row.status))return "status is not known";
  if(row.manifest_json===null){
    if(row.status==="succeeded")return "finished without a manifest";
    return row.manifest_version===1?null:"unfinished row with manifest_version 2";
  }
  let value:unknown;try{value=JSON.parse(row.manifest_json);}catch{return "manifest is not JSON";}
  const parsed=manifestSchema.safeParse(value);if(!parsed.success)return "manifest is not a known version";
  const manifest=parsed.data;
  if(manifest.manifestVersion!==row.manifest_version)return "manifest_version differs from the manifest";
  if(manifest.project.id!==row.project_id||manifest.contentRevision!==row.content_revision)return "manifest is not this row's";
  if(row.status==="succeeded"){
    if(!row.sha256||!/^[a-f0-9]{64}$/.test(row.sha256))return "finished without a file hash";
    if(row.file_path!==`projects/${row.project_id}/exports/${row.id}.zip`)return "file path differs";
    if(!row.completed_at)return "finished without a time";
  }
  return null;
}
export function checkExportRows(sqlite:Database.Database){
  for(const row of sqlite.prepare("SELECT id,project_id,content_revision,status,file_path,manifest_version,manifest_json,sha256,completed_at FROM exports ORDER BY id").all() as Row[]){
    const issue=exportRowIssue(row);if(issue)throw new ExportRowError(row.id,issue);
  }
}
// The succeeded rows whose ZIP must hold exactly the stored manifest (restore opens each one: hash binding).
export function exportManifests(sqlite:Database.Database){
  return (sqlite.prepare("SELECT id,file_path AS filePath,manifest_json AS manifestJson FROM exports WHERE status='succeeded' ORDER BY id").all() as {id:string;filePath:string;manifestJson:string}[])
    .map(row=>({id:row.id,filePath:row.filePath,manifest:manifestSchema.parse(JSON.parse(row.manifestJson))}));
}
