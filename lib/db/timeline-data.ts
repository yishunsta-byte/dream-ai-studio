import "server-only";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { editSnapshotSchema, type TextLayer as P1TextLayer } from "@/lib/edit/schema";
import { canonicalJson, sameClip, textFromP1, timelineSchema, type Timeline, type TimelineClip } from "@/lib/edit/timeline";

// Host-side timeline rules shared by the timeline service, the 0005 data check and the post-migration/restore checks.
export type ClipData=Omit<TimelineClip,"id">;
export const timelineSha256=(json:string)=>createHash("sha256").update(json).digest("hex");
type SceneRow={id:string;duration_sec:number;selected_version_id:string|null};

// The clip each active scene gets from its current selection (the same rules as 0005): a succeeded image or video
// result of that scene; images and empty slots last the planned seconds × 30; a video lasts min(its own frames, plan)
// and the rest is trimmed at the end. A speech result or any other selection gives an empty slot (audio is P2-5).
export function clipFor(sqlite:Database.Database,scene:SceneRow):ClipData{
  const planFrames=scene.duration_sec*30;
  const clip:ClipData={sceneId:scene.id,sceneVersionId:null,assetId:null,durationFrames:planFrames,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}};
  const version=scene.selected_version_id?sqlite.prepare("SELECT scene_id,kind,status,result_asset_id FROM scene_versions WHERE id=?").get(scene.selected_version_id) as {scene_id:string;kind:string;status:string;result_asset_id:string|null}|undefined:undefined;
  if(!version||version.scene_id!==scene.id||version.status!=="succeeded"||version.kind==="speech"||!version.result_asset_id)return clip;
  const asset=sqlite.prepare("SELECT kind,duration_ms FROM assets WHERE id=?").get(version.result_asset_id) as {kind:string;duration_ms:number|null}|undefined;
  if(!asset||(asset.kind!=="image"&&asset.kind!=="video"))return clip;
  const filled:ClipData={...clip,sceneVersionId:scene.selected_version_id,assetId:version.result_asset_id};
  if(asset.kind==="video"&&Number.isSafeInteger(asset.duration_ms)&&asset.duration_ms!>0){
    const sourceFrames=Math.max(1,Math.floor((asset.duration_ms!*30+500)/1000)),durationFrames=Math.min(sourceFrames,planFrames);
    return {...filled,durationFrames,trimOutFrames:sourceFrames-durationFrames};
  }
  return filled;
}
// Active scenes in the given order first (unknown and repeated ids ignored), then the rest by position.
export function currentClips(sqlite:Database.Database,projectId:string,order:readonly string[]=[]):ClipData[]{
  const active=sqlite.prepare("SELECT id,duration_sec,selected_version_id FROM scenes WHERE project_id=? AND archived_at IS NULL ORDER BY position,id").all(projectId) as SceneRow[];
  const byId=new Map(active.map(scene=>[scene.id,scene])),ordered:SceneRow[]=[];
  for(const id of order){const scene=byId.get(id);if(scene&&!ordered.includes(scene))ordered.push(scene);}
  for(const scene of active)if(!ordered.includes(scene))ordered.push(scene);
  return ordered.map(scene=>clipFor(sqlite,scene));
}
export type TimelineRow={id:string;project_id:string;revision:number;content_revision:number;timeline_json:string;timeline_sha256:string;source:"p1-migration"|"user"|"restore-version";restored_from_id:string|null;migrated_from_key:string|null;created_at:string};
// A stored revision is valid when its JSON passes the schema, is stored in canonical form and matches its hash.
export function readTimelineRow(row:TimelineRow):Timeline{
  const timeline=timelineSchema.parse(JSON.parse(row.timeline_json));
  if(canonicalJson(timeline)!==row.timeline_json||timelineSha256(row.timeline_json)!==row.timeline_sha256)throw new Error("Timeline revision content differs from its hash");
  return timeline;
}
// The ids 0005 derives from the snapshot key (same text rule as derivedUuid in 0005_timeline_shared.cjs).
export function derived0005Id(source:string){const hex=createHash("sha256").update("dream-0005:"+source).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-${((parseInt(hex[16],16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export class P1SourceMismatchError extends Error{constructor(reason:string){super(`P1-moved timeline differs from its source: ${reason}`);this.name="P1SourceMismatchError";}}
const KEY=/^project\.([0-9a-f-]{36})\.edit\.([0-9a-f-]{36})$/;
// F065-1: a p1-migration row is accepted as "that P1 snapshot" only when everything the snapshot fixes still holds,
// whatever the selection is today: its own project's key, the ids 0005 derives from that key, revision/time, aspect,
// no audio, the texts moved by the spec rules and the scene order (snapshot order first; scenes 0005 appended after).
// A hash-consistent row with another order or other clips is refused here, never read as the snapshot.
export function checkP1MigratedRow(sqlite:Database.Database,row:TimelineRow,timeline:Timeline){
  const fail=(reason:string)=>{throw new P1SourceMismatchError(reason);};
  const key=row.migrated_from_key??"",match=KEY.exec(key);
  if(row.source!=="p1-migration"||!match||match[1]!==row.project_id||row.revision!==1||row.restored_from_id!==null||row.id!==derived0005Id("row:"+key))fail("record");
  const raw=sqlite.prepare("SELECT value_json FROM settings WHERE key=?").get(key) as {value_json:string}|undefined;if(!raw)fail("source snapshot missing");
  const stored=JSON.parse(raw!.value_json) as {layers:P1TextLayer[]},snapshot=editSnapshotSchema.parse(stored);
  if(row.content_revision!==snapshot.content_revision||row.created_at!==snapshot.created_at)fail("revision");
  const project=sqlite.prepare("SELECT aspect FROM projects WHERE id=?").get(row.project_id) as {aspect:string}|undefined;
  if(!project||timeline.aspect!==project.aspect||timeline.audio.length)fail("aspect or audio");
  if(canonicalJson(timeline.text)!==canonicalJson(stored.layers.map(layer=>textFromP1(layer))))fail("text");
  if(timeline.video.some(clip=>clip.id!==derived0005Id(`clip:${key}#${clip.sceneId}`)))fail("clip ids");
  const order=snapshot.sceneOrder.filter((id,index,list)=>list.indexOf(id)===index),listed=new Set(order),ids=timeline.video.map(clip=>clip.sceneId);
  const head=ids.filter(id=>listed.has(id));
  if(ids.slice(0,head.length).some(id=>!listed.has(id))||canonicalJson(head)!==canonicalJson(order.filter(id=>ids.includes(id))))fail("scene order");
  return {key,snapshot,stored};
}
// After a migration or a restore: every revision readable, every pointer names a revision of its own project, and
// every P1-moved row still matches its source snapshot.
export function checkTimelineRows(sqlite:Database.Database){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='timeline_revisions'").get())return;
  for(const row of sqlite.prepare("SELECT * FROM timeline_revisions ORDER BY project_id,revision").all() as TimelineRow[]){const timeline=readTimelineRow(row);if(row.source==="p1-migration")checkP1MigratedRow(sqlite,row,timeline);}
  const broken=sqlite.prepare("SELECT COUNT(*) AS n FROM projects p WHERE p.current_timeline_rev_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM timeline_revisions t WHERE t.id=p.current_timeline_rev_id AND t.project_id=p.id)").get() as {n:number};
  if(broken.n)throw new Error("Timeline pointer differs");
}

// 0005 data check (verify, read-only): one r1 per project with a P1 current snapshot, made with the same rules here.
export function verifyTimelineMigration(sqlite:Database.Database){
  checkTimelineRows(sqlite);
  const projects=sqlite.prepare("SELECT id,aspect,current_timeline_rev_id FROM projects ORDER BY id").all() as {id:string;aspect:string;current_timeline_rev_id:string|null}[];
  const rows=sqlite.prepare("SELECT * FROM timeline_revisions ORDER BY project_id,revision").all() as TimelineRow[];
  let moved=0;
  for(const project of projects){
    const pointer=sqlite.prepare("SELECT value_json FROM settings WHERE key=?").get(`project.${project.id}.edit.current`) as {value_json:string}|undefined;
    const own=rows.filter(row=>row.project_id===project.id);
    if(!pointer){if(own.length||project.current_timeline_rev_id!==null)throw new Error("0005 moved a project without a P1 snapshot");continue;}
    const key=`project.${project.id}.edit.${JSON.parse(pointer.value_json) as string}`;
    const raw=sqlite.prepare("SELECT value_json FROM settings WHERE key=?").get(key) as {value_json:string}|undefined;
    if(!raw)throw new Error("0005 source snapshot missing");
    if(own.length!==1)throw new Error("0005 expected one revision per moved project");
    const row=own[0],timeline=readTimelineRow(row);
    if(row.migrated_from_key!==key||project.current_timeline_rev_id!==row.id)throw new Error("0005 revision record differs");
    const {snapshot}=checkP1MigratedRow(sqlite,row,timeline);
    const clips=currentClips(sqlite,project.id,snapshot.sceneOrder);
    if(clips.length!==timeline.video.length||clips.some((clip,index)=>!sameClip({...clip,id:timeline.video[index].id},timeline.video[index])))throw new Error("0005 scenes differ from the current selection");
    moved++;
  }
  if(moved!==rows.length)throw new Error("0005 moved rows differ");
}
