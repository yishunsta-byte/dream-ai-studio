import "server-only";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { z } from "zod";
import { addClip } from "../edit/audio-ops";
import { canonicalJson, outputFrames, textEndLimit, timelineSchema, totalFrames, type Timeline } from "../edit/timeline";
import { lockSceneResults, readScenes, scenesMatchTimeline } from "./local-timeline-scenes";
import { rejectCrossSite } from "../auth/config";
import { applySubtitles, subtitleItems, subtitlesSchema } from "./local-subtitle-edits";
import { readBoundedUpload } from "./read-bounded-upload";
import { localWavTransaction, openLocalWavAccess } from "./local-wav-access";

const inputSchema=z.strictObject({
  assetId:z.uuidv7(), expectedContentRevision:z.number().int().positive(), expectedTimelineId:z.uuid().nullable()
});
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const conflict=(code:string)=>reply({code},409);

type Keys = [owner: string, project: string];
type Project = { current_timeline_rev_id: string | null; content_revision: string; aspect: Timeline["aspect"];
  length_sec: string; inputs_json: string };
type Saved = { timeline_json: string; timeline_sha256: string; revision: string; content_revision: string };

async function readProject(client: Client, keys: Keys, lock: boolean) {
  const { rows: [project] } = await client.query<Project>(`SELECT current_timeline_rev_id,content_revision,aspect,length_sec,inputs_json
    FROM dream.projects WHERE owner_id=$1 AND id=$2 AND archived_at IS NULL AND menu_id='shopping-shorts'${lock ? " FOR UPDATE" : ""}`, keys);
  return project;
}

async function readSavedTimeline(client: Client, keys: Keys, project: Project) {
  const { rows: [base] } = await client.query<Saved>(`SELECT timeline_json,timeline_sha256,revision,content_revision
    FROM dream.timeline_revisions WHERE owner_id=$1 AND project_id=$2 AND id=$3`, [...keys, project.current_timeline_rev_id]);
  if (!base || hash(base.timeline_json) !== base.timeline_sha256) return null;
  const parsed = timelineSchema.safeParse(JSON.parse(base.timeline_json));
  return parsed.success && canonicalJson(parsed.data) === base.timeline_json && parsed.data.aspect === project.aspect
    ? { timeline: parsed.data, json: base.timeline_json, timelineRevision: Number(base.revision), contentRevision: Number(base.content_revision) }
    : null;
}

export async function readProjectSubtitles(request: Request, params: Promise<{ id: string }>) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const { id } = await params;
  if (!z.uuidv7().safeParse(id).success) return reply({ code: "PROJECT_MISSING" }, 404);
  return localWavTransaction(access, "local_audio_edit", false, async client => {
    const keys: Keys = [access.owner, id];
    const current = await readProject(client, keys, false);
    if (!current) return reply({ code: "PROJECT_MISSING" }, 404);
    const { rows: [produce] } = await client.query<{ status: string }>(
      "SELECT status FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2 AND stage='produce'", keys);
    const timelineId = current.current_timeline_rev_id;
    const contentRevision = Number(current.content_revision);
    const saved = timelineId ? await readSavedTimeline(client, keys, current) : null;
    const timeline = saved?.timeline;
    let blockedReason = produce?.status !== "approved" ? "PRODUCE_APPROVAL_REQUIRED" :
      !timelineId ? "BASE_TIMELINE_REQUIRED" : !saved ? "INVALID_BASE_TIMELINE" : null;
    if (!blockedReason && saved && (saved.contentRevision !== contentRevision ||
        !scenesMatchTimeline(await readScenes(client, ...keys, false), saved.timeline))) blockedReason = "BASE_TIMELINE_STALE";
    return reply({ timelineId, contentRevision, timelineRevision: saved?.timelineRevision ?? null,
      subtitles: timeline ? subtitleItems(timeline) : [], videoFrames: timeline ? totalFrames(timeline.video) : 0,
      maxEndFrame: timeline ? textEndLimit(timeline.video, Number(current.length_sec)) : 0, blockedReason });
  });
}

const subtitleInput = inputSchema.omit({ assetId: true }).extend({ expectedTimelineId: z.uuid(), subtitles: subtitlesSchema });

export async function saveProjectTimeline(request:Request,params:Promise<{id:string}>,operation:"initial"|"audio"|"subtitles") {
  const access=await openLocalWavAccess(request);
  if(access instanceof Response)return access;
  const owner=access.owner;
  const {id:project}=await params;
  const requestId=request.headers.get("idempotency-key");
  if(!z.uuidv7().safeParse(project).success)return reply({code:"PROJECT_MISSING"},404);
  let raw: unknown;
  if (operation === "subtitles") {
    const denied = rejectCrossSite(request, { json: true });
    if (denied) return denied;
    const bytes = await readBoundedUpload(request, 384 * 1024).catch(() => undefined);
    try { raw = JSON.parse(bytes?.toString("utf8") ?? ""); }
    catch { return reply({ code: "INVALID_REQUEST" }, 400); }
  } else {
    raw = await request.json().catch(() => null);
  }
  const schema = operation === "initial" ? inputSchema.omit({ assetId: true }).extend({ expectedTimelineId: z.null() }) :
    operation === "subtitles" ? subtitleInput : inputSchema;
  const input = schema.safeParse(raw);
  if(!input.success || !z.uuidv7().safeParse(requestId).success)return reply({code:"INVALID_REQUEST"},400);
  const {expectedContentRevision,expectedTimelineId}=input.data;
  const assetId="assetId" in input.data ? String(input.data.assetId) : null;
  const action = operation === "initial" ? "timeline.initialize" :
    operation === "subtitles" ? "timeline.subtitles.save" : "timeline.audio.add";
  const fingerprint=hash(canonicalJson({action,project,...input.data}));
  return localWavTransaction(access,"local_audio_edit",true,async client=>{
    const key: Keys = [owner, project];
    const current = await readProject(client, key, true);
    if(!current)return reply({code:"PROJECT_MISSING"},404);
    const {rows:[previous]}=await client.query(`SELECT detail_json::jsonb AS detail FROM dream.activity_log
      WHERE owner_id=$1 AND project_id=$2 AND action=$4 AND detail_json::jsonb->>'requestId'=$3`,[...key,requestId,action]);
    if(previous)return previous.detail.fingerprint===fingerprint ? reply(previous.detail.result) : conflict("REQUEST_CONFLICT");
    if(Number(current.content_revision)!==expectedContentRevision || current.current_timeline_rev_id!==expectedTimelineId)
      return conflict("CURRENT_TIMELINE_CONFLICT");
    const {rows:stages}=await client.query("SELECT stage,status FROM dream.stage_states WHERE owner_id=$1 AND project_id=$2 ORDER BY stage FOR SHARE",key);
    const reasons=[];
    if(!stages.some(s=>s.stage==="produce" && s.status==="approved"))reasons.push("PRODUCE_APPROVAL_REQUIRED");
    if(operation==="audio" && !expectedTimelineId)reasons.push("BASE_TIMELINE_REQUIRED");
    if(reasons.length)return reply({code:"EDIT_NOT_READY",reasons},409);
    const scenes=await readScenes(client,owner,project);
    let timeline:Timeline;
    let clipId:string|undefined;
    let saved: Awaited<ReturnType<typeof readSavedTimeline>> = null;
    if(operation==="initial"){
      if(!scenes.length || scenes.some(scene=>scene.recheck || !scene.ready))return conflict("SCENE_RESULTS_REQUIRED");
      await lockSceneResults(client,owner,scenes);
      const locked=await readScenes(client,owner,project);
      if(canonicalJson(locked)!==canonicalJson(scenes))return conflict("BASE_TIMELINE_STALE");
      timeline={schemaVersion:1,fps:30,aspect:current.aspect,text:[],audio:[],video:scenes.map(({clip})=>({...clip,id:v7()}))};
    } else {
      saved = await readSavedTimeline(client, key, current);
      if (!saved) return conflict("INVALID_BASE_TIMELINE");
      if (!outputFrames(saved.timeline)) return conflict("OUTPUT_LENGTH_REQUIRED");
      if (!scenesMatchTimeline(scenes, saved.timeline)) return conflict("BASE_TIMELINE_STALE");
      if ("subtitles" in input.data) {
        if (saved.contentRevision !== expectedContentRevision) return conflict("BASE_TIMELINE_STALE");
        const inputs = z.record(z.string(), z.unknown()).parse(JSON.parse(current.inputs_json));
        const plannedFrames = scenes.reduce((sum, scene) => sum + scene.plannedFrames, 0);
        const applied = applySubtitles(saved.timeline, input.data.subtitles, inputs, plannedFrames,
          totalFrames(saved.timeline.video), textEndLimit(saved.timeline.video, Number(current.length_sec)));
        if ("code" in applied) return conflict(applied.code);
        timeline = applied.timeline;
      } else {
        const {rows:[source]}=await client.query(`SELECT a.id,a.title,a.rights_note,a.duration_ms FROM dream.assets a
          JOIN local_wav.files f ON f.owner_id=a.owner_id AND f.asset_id=a.id AND f.digest=a.sha256
            AND f.size_bytes=a.size_bytes AND f.duration_ms=a.duration_ms
          JOIN dream.project_assets l ON l.owner_id=a.owner_id AND l.asset_id=a.id AND l.project_id=$2 AND l.purpose='productionAudio'
          WHERE a.owner_id=$1 AND a.id=$3 AND a.archived_at IS NULL AND a.kind='audio' AND a.mime='audio/wav'
            AND a.file_path=a.owner_id::text||'/assets/'||a.id::text||'/'||f.digest||'.wav' FOR SHARE OF a,l`,[...key,assetId]);
        if(!source)return reply({code:"SOURCE_UNAVAILABLE"},404);
        const added=addClip(saved.timeline,{id:source.id,title:source.title,kind:"audio",mime:"audio/wav",durationMs:Number(source.duration_ms),
          isMock:false,archived:false,available:true,sourceUrl:null,rightsNote:source.rights_note},"music");
        if("error" in added)return reply({code:"CLIP_UNAVAILABLE",error:added.error},409);
        timeline=added.timeline;
        clipId=added.clipId;
      }
    }
    const next=timelineSchema.safeParse(timeline);
    if(!next.success)return conflict("INVALID_TIMELINE");
    const json=canonicalJson(next.data);
    if(Buffer.byteLength(json)>1024*1024)return conflict("TIMELINE_TOO_LARGE");
    const remember = async (result: object) => {
      await client.query(`INSERT INTO dream.activity_log(owner_id,project_id,id,actor,action,detail_json,created_at)
        VALUES($1,$2,$3,'local-user',$5,$4,clock_timestamp())`,[...key,v7(),JSON.stringify({requestId,fingerprint,result}),action]);
      return reply(result);
    };
    if (operation === "subtitles" && saved && saved.json === json) {
      return remember({ timelineId: expectedTimelineId, timelineRevision: saved.timelineRevision,
        contentRevision: expectedContentRevision, changed: false });
    }
    const {rows:[number]}=await client.query("SELECT COALESCE(MAX(revision),0)+1 AS next FROM dream.timeline_revisions WHERE owner_id=$1 AND project_id=$2",key);
    if(operation==="initial" && Number(number.next)!==1)return conflict("CURRENT_TIMELINE_CONFLICT");
    const result={timelineId:v7(),timelineRevision:Number(number.next),contentRevision:expectedContentRevision+1,...(clipId && {clipId}), ...(operation === "subtitles" && {changed:true})};
    await client.query(`INSERT INTO dream.timeline_revisions(owner_id,project_id,id,revision,content_revision,timeline_json,timeline_sha256,source,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'user',clock_timestamp())`,[...key,result.timelineId,result.timelineRevision,result.contentRevision,json,hash(json)]);
    const updated=await client.query(`UPDATE dream.projects SET content_revision=$3,current_timeline_rev_id=$4,updated_at=clock_timestamp()
      WHERE owner_id=$1 AND id=$2`,[...key,result.contentRevision,result.timelineId]);
    const invalidated=await client.query(`UPDATE dream.stage_states SET status=CASE WHEN stage='edit' THEN 'in_progress' ELSE 'locked' END,
      approved_at=NULL,approved_revision=NULL,approved_plan_id=NULL WHERE owner_id=$1 AND project_id=$2 AND stage IN ('edit','review','export')`,key);
    if(updated.rowCount!==1 || invalidated.rowCount!==3)throw new Error("Incomplete timeline save");
    return remember(result);
  });
}
