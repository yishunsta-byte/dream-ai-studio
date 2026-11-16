import "server-only";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

// T-105: checks of stored render rows that SQL cannot express, used after migration/restore. The input hash is the
// sha256 of the exact stored input_json text (the service stores canonical JSON and hashes that same text).
export const renderInputSha256=(json:string)=>createHash("sha256").update(json).digest("hex");
export const hasRendersTable=(sqlite:Database.Database)=>!!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='renders'").get();
type Row={id:string;input_json:string;input_sha256:string;status:string;job_id:string;project_id:string;file_path:string|null};
export function checkRenderRows(sqlite:Database.Database){
  if(!hasRendersTable(sqlite))return;
  for(const row of sqlite.prepare("SELECT id,input_json,input_sha256,status,job_id,project_id,file_path FROM renders ORDER BY id").all() as Row[]){
    if(renderInputSha256(row.input_json)!==row.input_sha256)throw new Error("Render input differs from its hash");
    const job=sqlite.prepare("SELECT kind,ref_type,ref_id,project_id FROM jobs WHERE id=?").get(row.job_id) as {kind:string;ref_type:string;ref_id:string;project_id:string|null}|undefined;
    if(!job||job.kind!=="render"||job.ref_type!=="render"||job.ref_id!==row.id||job.project_id!==row.project_id)throw new Error("Render job differs");
  }
}
// Files the backup must hold for render rows: a verified success or a verified result that finished after cancel.
export function renderFileReferences(sqlite:Database.Database){
  if(!hasRendersTable(sqlite))return [];
  return sqlite.prepare("SELECT file_path AS filePath,sha256,size_bytes AS sizeBytes FROM renders WHERE file_path IS NOT NULL ORDER BY id").all() as {filePath:string;sha256:string;sizeBytes:number}[];
}
