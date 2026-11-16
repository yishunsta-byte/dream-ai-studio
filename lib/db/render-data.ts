import "server-only";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, timelineSchema } from "@/lib/edit/timeline";
import { ACCEPT, LOUDNESS, MAX_OUTPUT_FRAMES, MIN_NORMALIZE_FRAMES, PROFILE_ID, SAMPLES_PER_FRAME } from "@/lib/audio/profile";

// T-105/T-109: checks of stored render rows, run after a migration step (0007's data check) and on every restore
// that reads the current structure. They read every rule back from the stored rows instead of trusting that the
// insert triggers once ran: a repacked backup can hold rows no trigger ever saw.
// The input hash is the sha256 of the exact stored input_json text (the service stores canonical JSON).
export const renderInputSha256=(json:string)=>createHash("sha256").update(json).digest("hex");
export const hasRendersTable=(sqlite:Database.Database)=>!!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='renders'").get();
// T-111: the reason is one of these fixed sentences and the subject id is a UUID, so a caller may show both as they
// are (CLI diagnostics). No stored text (input JSON, file path, hash) is ever put into the error.
export const renderRowReasons=["input differs from its hash","input is not JSON","input schemaVersion is not 1","input names another project or timeline","saved timeline is missing","saved timeline binding differs","input timeline hash differs from the saved timeline","job differs","file fields are incomplete","verify record is not JSON","verify record is not an object","success without a verified file","late result without a kept file","file kept for an unfinished or failed render","failure without a code","finish time differs from status","more than one render in progress",
  // T-137 (0009): appended only, the earlier sentences and their order stay as they were.
  "input envelope is not known","input audio plan differs from its timeline","audio verify record differs"] as const;

// T-136/T-137 render input envelopes. The top-level schemaVersion stays 1 (0006 CHECK).
// A (unchanged since P2-4): no audioPlan key, output.audio "none", a v1 timeline. Stored rows are read as they are.
// B (0009): a v2 timeline with audioPlan 1, either mode "none" (no sound clips: silent video) or mode "mix" (AAC).
// The plan pins every sound file (stored path, hash, size, length) and the FFmpeg/ffprobe build used to process it.
const hex64s=z.string().regex(/^[0-9a-f]{64}$/);
const storedRel=z.string().min(1).max(400).refine(value=>!value.startsWith("/")&&!value.includes("\\")&&!value.includes(":")&&value.split("/").every(part=>part&&part!=="."&&part!==".."),{message:"relative path"});
export const audioSourcePinSchema=z.strictObject({assetId:z.uuid(),relPath:storedRel,sha256:hex64s,sizeBytes:z.number().int().min(1),durationMs:z.number().int().min(1),isMock:z.boolean()});
export const audioToolsPinSchema=z.strictObject({ffmpeg:z.string().min(1).max(200),ffmpegSha256:hex64s,ffprobeSha256:hex64s});
export const audioPlanSchema=z.discriminatedUnion("mode",[
  z.strictObject({schemaVersion:z.literal(1),mode:z.literal("none")}),
  z.strictObject({schemaVersion:z.literal(1),mode:z.literal("mix"),profile:z.literal(PROFILE_ID),outputFrames:z.number().int().min(1).max(MAX_OUTPUT_FRAMES),
    sources:z.array(audioSourcePinSchema).min(1).max(100),tools:audioToolsPinSchema}),
]);
export type AudioPlan=z.infer<typeof audioPlanSchema>;
// Rules between the plan, the output and the timeline (the request builds them; the row check reads them back).
export function audioPlanIssue(input:{timeline:{schemaVersion:number;audio:readonly {assetId:string}[]};output:{audio:string};durationInFrames:number;audioPlan:AudioPlan}):string|null{
  const {timeline,output,audioPlan:plan}=input;
  if(timeline.schemaVersion!==2)return "audio plan needs a v2 timeline";
  if(plan.mode==="none")return output.audio==="none"&&timeline.audio.length===0?null:"mode none with sound or an audio output";
  if(output.audio!=="aac"||timeline.audio.length===0)return "mode mix without sound or without an AAC output";
  if(plan.outputFrames!==input.durationInFrames)return "mix length differs from the video length";
  const ids=plan.sources.map(source=>source.assetId);
  if(ids.some((id,index)=>index>0&&ids[index-1]>=id))return "sources are not sorted and unique";
  const used=[...new Set(timeline.audio.map(clip=>clip.assetId))].sort();
  return used.length===ids.length&&used.every((id,index)=>id===ids[index])?null:"sources differ from the timeline's sound files";
}
type Envelope={kind:"A"}|{kind:"B";mode:"none"|"mix"};
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
// The envelope of a stored input, or the reason it is not one. A row without audioPlan is envelope A and keeps the
// rules of its time (0006/0007: schemaVersion 1 and the saved timeline binding); only a v2 timeline or an AAC output
// without a plan is refused there, since only envelope B may carry either.
export function renderEnvelope(record:Record<string,unknown>):Envelope|"input envelope is not known"|"input audio plan differs from its timeline"{
  const output=isRecord(record.output)?record.output:null,timeline=isRecord(record.timeline)?record.timeline:null;
  if(!("audioPlan" in record))return timeline?.schemaVersion===2||output?.audio==="aac"?"input envelope is not known":{kind:"A"};
  if(!output||!timeline)return "input envelope is not known";
  const plan=audioPlanSchema.safeParse(record.audioPlan),parsed=timelineSchema.safeParse(timeline);
  if(!plan.success||!parsed.success||parsed.data.schemaVersion!==2||!Number.isSafeInteger(record.durationInFrames)||(output.audio!=="none"&&output.audio!=="aac"))return "input envelope is not known";
  return audioPlanIssue({timeline:parsed.data,output:{audio:output.audio as string},durationInFrames:record.durationInFrames as number,audioPlan:plan.data})?"input audio plan differs from its timeline":{kind:"B",mode:plan.data.mode};
}
// T-144 (T-143 F137-1): verify_json.audio of a kept AAC file, read back by an exact schema and checked against the
// plan and the fixed profile: the tools and sources are the pinned ones, the target is the profile's, the mix and the
// decoded output are exactly the requested length, a normalized result is accepted only when its recorded final
// measurement is inside the acceptance (-14 ±1 LUFS, true peak <= -1 dBTP), and a silent / too-short result keeps
// accepted null and no loudness pass (silent: a zero peak; too short: under 3 s). Non-finite values are null.
const num=z.number().refine(Number.isFinite),nullableNum=num.nullable();
const measureSchema=z.strictObject({integrated:nullableNum,range:nullableNum,truePeak:nullableNum});
export const renderAudioRecordSchema=z.strictObject({
  mode:z.literal("aac"),profile:z.literal(PROFILE_ID),tools:z.strictObject({ffmpeg:z.string().min(1).max(200),ffmpegSha256:hex64s,ffprobeSha256:hex64s}),
  status:z.enum(["normalized","silent","too_short"]),accepted:z.boolean().nullable(),
  target:z.strictObject({integrated:num,truePeak:num,range:num,tolerance:num,truePeakMax:num}),
  sources:z.array(z.strictObject({assetId:z.uuid(),sha256:hex64s,channels:z.union([z.literal(1),z.literal(2)]),decodedSamples:z.number().int().min(1)})).min(1).max(100),
  mix:z.strictObject({sha256:hex64s,samples:z.number().int().min(1),peak:num}),
  loudness:z.strictObject({preGainDb:num,inputI:nullableNum,inputTp:nullableNum,inputLra:nullableNum,inputThresh:nullableNum,targetOffset:nullableNum,normalizationType:z.string().max(40),outputI:nullableNum,outputTp:nullableNum}).nullable(),
  final:measureSchema,childFinal:measureSchema,
  output:z.strictObject({decodedSamples:z.number().int().min(1),initialPadding:z.number().int().min(0).nullable(),videoStreamSha256:hex64s}),
});
function audioVerifyOk(audio:unknown,plan:Extract<AudioPlan,{mode:"mix"}>,frames:number){
  const parsed=renderAudioRecordSchema.safeParse(audio);if(!parsed.success)return false;const value=parsed.data;
  if(value.tools.ffmpegSha256!==plan.tools.ffmpegSha256||value.tools.ffprobeSha256!==plan.tools.ffprobeSha256)return false;
  const pinned=new Map(plan.sources.map(source=>[source.assetId,source.sha256]));
  if(value.sources.length!==pinned.size||value.sources.some(source=>pinned.get(source.assetId)!==source.sha256)||new Set(value.sources.map(source=>source.assetId)).size!==pinned.size)return false;
  const t=value.target;if(t.integrated!==LOUDNESS.integrated||t.truePeak!==LOUDNESS.truePeak||t.range!==LOUDNESS.range||t.tolerance!==ACCEPT.integratedTolerance||t.truePeakMax!==ACCEPT.truePeakMax)return false;
  const samples=frames*SAMPLES_PER_FRAME;if(value.mix.samples!==samples||value.output.decodedSamples!==samples)return false;
  if(value.status==="normalized"){const {integrated,truePeak}=value.final;
    return value.accepted===true&&value.loudness!==null&&frames>=MIN_NORMALIZE_FRAMES&&value.mix.peak>0&&integrated!==null&&truePeak!==null&&Math.abs(integrated-LOUDNESS.integrated)<=ACCEPT.integratedTolerance&&truePeak<=ACCEPT.truePeakMax;}
  if(value.accepted!==null||value.loudness!==null)return false;
  return value.status==="silent"?value.mix.peak===0:frames<MIN_NORMALIZE_FRAMES&&value.mix.peak>0;
}
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
  const envelope=renderEnvelope(record);if(typeof envelope==="string")fail(envelope);
  // Saved timeline binding (F107-3): the same project's saved revision with that number, content revision and hash.
  const timeline=sqlite.prepare("SELECT project_id,revision,content_revision,timeline_sha256 FROM timeline_revisions WHERE id=?").get(row.timeline_rev_id) as {project_id:string;revision:number;content_revision:number;timeline_sha256:string}|undefined;
  if(!timeline)fail("saved timeline is missing");
  if(timeline!.project_id!==row.project_id||timeline!.revision!==row.timeline_revision||timeline!.content_revision!==row.content_revision)fail("saved timeline binding differs");
  if(record.timelineSha256!==timeline!.timeline_sha256)fail("input timeline hash differs from the saved timeline");
  // T-144 (T-143 F137-2): an envelope B input carries the saved timeline itself; its canonical text must be the saved
  // revision's text (so its hash is the claimed one). Envelope A rows keep the rules of their time.
  if(typeof envelope!=="string"&&envelope.kind==="B"){
    const saved=sqlite.prepare("SELECT timeline_json FROM timeline_revisions WHERE id=?").get(row.timeline_rev_id) as {timeline_json:string};
    if(canonicalJson(record.timeline)!==saved.timeline_json||renderInputSha256(saved.timeline_json)!==record.timelineSha256)fail("input timeline hash differs from the saved timeline");
  }
  // Linked job (F107-1): kind, reference and project.
  const job=sqlite.prepare("SELECT kind,ref_type,ref_id,project_id FROM jobs WHERE id=?").get(row.job_id) as {kind:string;ref_type:string;ref_id:string;project_id:string|null}|undefined;
  if(!job||job.kind!=="render"||job.ref_type!=="render"||job.ref_id!==row.id||job.project_id!==row.project_id)fail("job differs");
  // File fields (F107-2): all absent, or all present and well formed; only a success or a result after cancel has one.
  const none=row.file_path===null&&row.sha256===null&&row.size_bytes===null;
  const full=row.file_path===`projects/${row.project_id}/renders/${row.id}.mp4`&&hex64(row.sha256)&&Number.isSafeInteger(row.size_bytes)&&row.size_bytes!>=1&&row.verify_json!==null;
  if(!none&&!full)fail("file fields are incomplete");
  let verify:unknown=null;
  if(row.verify_json!==null){try{verify=JSON.parse(row.verify_json);}catch{fail("verify record is not JSON");}if(!isObject(verify))fail("verify record is not an object");}
  if(row.status==="succeeded"&&(!full||row.canceled_late!==0||row.error_code!==null))fail("success without a verified file");
  if(row.canceled_late===1&&(row.status!=="canceled"||!full))fail("late result without a kept file");
  if(full&&row.status!=="succeeded"&&row.canceled_late!==1)fail("file kept for an unfinished or failed render");
  if(row.status==="failed"&&!row.error_code)fail("failure without a code");
  if((row.status==="queued"||row.status==="running")!==(row.finished_at===null))fail("finish time differs from status");
  // A kept file of a sound mix carries its processing record; every other verify record has none.
  const mix=typeof envelope!=="string"&&envelope.kind==="B"&&envelope.mode==="mix";
  if(isObject(verify)){const audio=(verify as Record<string,unknown>).audio;
    if(mix&&full){const plan=audioPlanSchema.parse(record.audioPlan) as Extract<AudioPlan,{mode:"mix"}>;
      // a kept AAC file passed every check when it was published
      if((verify as Record<string,unknown>).result!=="passed"||!audioVerifyOk(audio,plan,record.durationInFrames as number))fail("audio verify record differs");}
    else if(audio!==undefined&&!(mix&&!full))fail("audio verify record differs");}
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
