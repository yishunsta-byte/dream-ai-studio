import "server-only";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

// T-105/T-109: checks of stored render rows, run after a migration step (0007's data check) and on every restore
// that reads the current structure. They read every rule back from the stored rows instead of trusting that the
// insert triggers once ran: a repacked backup can hold rows no trigger ever saw.
// The input hash is the sha256 of the exact stored input_json text (the service stores canonical JSON).
export const renderInputSha256=(json:string)=>createHash("sha256").update(json).digest("hex");
export const hasRendersTable=(sqlite:Database.Database)=>!!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='renders'").get();
// T-111: the reason is one of these fixed sentences and the subject id is a UUID, so a caller may show both as they
// are (CLI diagnostics). No stored text (input JSON, file path, hash) is ever put into the error.
export const renderRowReasons=["input differs from its hash","input is not JSON","input schemaVersion is not 1","input names another project or timeline","saved timeline is missing","saved timeline binding differs","input timeline hash differs from the saved timeline","job differs","file fields are incomplete","verify record is not JSON","verify record is not an object","success without a verified file","late result without a kept file","file kept for an unfinished or failed render","failure without a code","finish time differs from status","more than one render in progress"] as const;
export type RenderRowReason=typeof renderRowReasons[number];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class RenderRowError extends Error{
  readonly subjectId:string|null;
  constructor(readonly subject:"render"|"project",id:string,readonly reason:RenderRowReason){const safe=typeof id==="string"&&uuid.test(id)?id:null;super(`${subject==="render"?"Render row":"Project"} ${safe??"(id not a UUID)"}: ${reason}`);this.subjectId=safe;this.name="RenderRowError";}
}
type Row={id:string;project_id:string;job_id:string;timeline_rev_id:string;timeline_revision:number;content_revision:number;input_json:string;input_sha256:string;status:string;file_path:string|null;sha256:string|null;size_bytes:number|null;verify_json:string|null;canceled_late:number;error_code:string|null;finished_at:string|null};
const hex64=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
export function checkRenderRow(sqlite:Database.Database,row:Row){
  const fail=(reason:RenderRowReason)=>{throw new RenderRowError("render",row.id,reason);};
  // Input record: its own hash, and the identity it names is the row's identity.
  if(renderInputSha256(row.input_json)!==row.input_sha256)fail("input differs from its hash");
  let input:unknown;try{input=JSON.parse(row.input_json);}catch{fail("input is not JSON");}
  if(!isObject(input)||input.schemaVersion!==1)fail("input schemaVersion is not 1");
  const record=input as Record<string,unknown>;
  if(record.projectId!==row.project_id||record.timelineRevId!==row.timeline_rev_id||record.timelineRevision!==row.timeline_revision||record.contentRevision!==row.content_revision)fail("input names another project or timeline");
  // Saved timeline binding (F107-3): the same project's saved revision with that number, content revision and hash.
  const timeline=sqlite.prepare("SELECT project_id,revision,content_revision,timeline_sha256 FROM timeline_revisions WHERE id=?").get(row.timeline_rev_id) as {project_id:string;revision:number;content_revision:number;timeline_sha256:string}|undefined;
  if(!timeline)fail("saved timeline is missing");
  if(timeline!.project_id!==row.project_id||timeline!.revision!==row.timeline_revision||timeline!.content_revision!==row.content_revision)fail("saved timeline binding differs");
  if(record.timelineSha256!==timeline!.timeline_sha256)fail("input timeline hash differs from the saved timeline");
  // Linked job (F107-1): kind, reference and project.
  const job=sqlite.prepare("SELECT kind,ref_type,ref_id,project_id FROM jobs WHERE id=?").get(row.job_id) as {kind:string;ref_type:string;ref_id:string;project_id:string|null}|undefined;
  if(!job||job.kind!=="render"||job.ref_type!=="render"||job.ref_id!==row.id||job.project_id!==row.project_id)fail("job differs");
  // File fields (F107-2): all absent, or all present and well formed; only a success or a result after cancel has one.
  const none=row.file_path===null&&row.sha256===null&&row.size_bytes===null;
  const full=row.file_path===`projects/${row.project_id}/renders/${row.id}.mp4`&&hex64(row.sha256)&&Number.isSafeInteger(row.size_bytes)&&row.size_bytes!>=1&&row.verify_json!==null;
  if(!none&&!full)fail("file fields are incomplete");
  if(row.verify_json!==null){let verify:unknown;try{verify=JSON.parse(row.verify_json);}catch{fail("verify record is not JSON");}if(!isObject(verify))fail("verify record is not an object");}
  if(row.status==="succeeded"&&(!full||row.canceled_late!==0||row.error_code!==null))fail("success without a verified file");
  if(row.canceled_late===1&&(row.status!=="canceled"||!full))fail("late result without a kept file");
  if(full&&row.status!=="succeeded"&&row.canceled_late!==1)fail("file kept for an unfinished or failed render");
  if(row.status==="failed"&&!row.error_code)fail("failure without a code");
  if((row.status==="queued"||row.status==="running")!==(row.finished_at===null))fail("finish time differs from status");
}
export function checkRenderRows(sqlite:Database.Database){
  if(!hasRendersTable(sqlite))return;
  for(const row of sqlite.prepare("SELECT id,project_id,job_id,timeline_rev_id,timeline_revision,content_revision,input_json,input_sha256,status,file_path,sha256,size_bytes,verify_json,canceled_late,error_code,finished_at FROM renders ORDER BY id").all() as Row[])checkRenderRow(sqlite,row);
  const active=sqlite.prepare("SELECT project_id FROM renders WHERE status IN ('queued','running') GROUP BY project_id HAVING COUNT(*)>1").get() as {project_id:string}|undefined;
  if(active)throw new RenderRowError("project",active.project_id,"more than one render in progress");
}
// Files the backup must hold for render rows: a verified success or a verified result that finished after cancel.
export function renderFileReferences(sqlite:Database.Database){
  if(!hasRendersTable(sqlite))return [];
  return sqlite.prepare("SELECT file_path AS filePath,sha256,size_bytes AS sizeBytes FROM renders WHERE file_path IS NOT NULL ORDER BY id").all() as {filePath:string;sha256:string;sizeBytes:number}[];
}
