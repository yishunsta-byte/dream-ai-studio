import "server-only";
import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import type { DatabaseHandle } from "@/lib/db/connection";
import { readTimelineRow } from "@/lib/db/timeline-data";
import { canonicalJson, FPS, timelineSchema, totalFrames, type Timeline } from "@/lib/edit/timeline";
import { PREVIEW_SIZE } from "@/lib/edit/preview";
import { fontStatuses, type FontStatus } from "@/lib/fonts/registry";
import { jobsRepository } from "@/lib/repo/jobs";
import { timelineRepository } from "@/lib/repo/timeline";
import { workflowRepository } from "@/lib/repo/workflow";
import { resolveStoredFile } from "@/lib/storage/paths";
import { runtimeRoot } from "@/lib/config/runtime";
import { currentClips } from "@/lib/db/timeline-data";
import { sameClip } from "@/lib/edit/timeline";
import { assertPreviousApproved, WorkflowError, type StageState } from "@/lib/domain/stages";
import { checkBrowser, compositionSourceSha256, fileSha256, REMOTION_VERSION, type BrowserCheck } from "./tools";

// P2-4b fixed render input (T-101 2.2). Built once when a render is requested and stored in renders.input_json as
// canonical JSON; input_sha256 is the sha256 of that exact text. The worker and the child read only this record:
// every file it names is measured again before rendering, and anything that differs stops the render.
const hex64=z.string().regex(/^[0-9a-f]{64}$/);
const relPath=z.string().min(1).max(400).refine(value=>!value.startsWith("/")&&!value.includes("\\")&&!value.includes(":")&&value.split("/").every(part=>part&&part!=="."&&part!==".."),{message:"relative path"});
export const renderMediaSchema=z.strictObject({assetId:z.uuid(),kind:z.enum(["image","video"]),relPath,sha256:hex64,sizeBytes:z.number().int().min(1),isMock:z.boolean()});
export const renderFontSchema=z.strictObject({family:z.string().min(1).max(80),relPath,sha256:hex64,sizeBytes:z.number().int().min(1),weightMin:z.number().int().min(1).max(1000),weightMax:z.number().int().min(1).max(1000)});
export const renderInputSchema=z.strictObject({
  schemaVersion:z.literal(1),projectId:z.uuidv7(),contentRevision:z.number().int().min(1),timelineRevId:z.uuid(),timelineRevision:z.number().int().min(1),timelineSha256:hex64,
  timeline:timelineSchema,
  output:z.strictObject({codec:z.literal("h264"),pixelFormat:z.literal("yuv420p"),colorSpace:z.literal("bt709"),fps:z.literal(FPS),width:z.number().int().min(16),height:z.number().int().min(16),audio:z.literal("none")}),
  durationInFrames:z.number().int().min(1),videoFrames:z.number().int().min(1),
  media:z.array(renderMediaSchema),fonts:z.array(renderFontSchema),
  renderer:z.strictObject({remotion:z.literal(REMOTION_VERSION),browser:z.string(),browserSha256:hex64,compositionSourceSha256:hex64}),
  sample:z.boolean(),
});
export type RenderInput=z.infer<typeof renderInputSchema>;
export const renderInputJson=(input:RenderInput)=>canonicalJson(renderInputSchema.parse(input));
export const sha256Text=(text:string)=>createHash("sha256").update(text).digest("hex");

// Pre-check results (T-101 2.2 order, T-102 14장 blockers[] = every reason, not only the first).
export type RenderBlocker=
  |{code:"RENDER_INPUT_MISSING";params:{reason:"no_timeline"|"no_scenes"}}
  |{code:"RENDER_INPUT_MISSING";params:{reason:"empty_slot"|"file_missing"|"file_changed"|"unsupported_media";sceneId:string;sceneNumber:number;sceneTitle:string}}
  |{code:"FONT_MISSING";params:{family:string;reason:string|null;texts:{id:string;preview:string}[]}}
  |{code:"TIMELINE_STALE";params:{scenes:{sceneId:string;sceneTitle:string}[]}}
  |{code:"RENDER_BROWSER_MISSING";params:{reason:"missing"|"mismatch";version:string}}
  |{code:"DISK_FULL";params:{where:"storage";needBytes:number;freeBytes:number}}
  |{code:"RENDER_ACTIVE";params:{renderId:string}};

// Space a render may use: frames, browser profile and the encoded file, all in the work folder under storage/tmp
// (the child's TEMP points there) and then the published file under storage (T-101 2.7).
// Upper bounds, not estimates of the final size: about 0.25 byte per pixel per frame plus 256 MB.
export const RENDER_SPACE_MARGIN=256*1024*1024;
export const neededBytes=(frames:number,width:number,height:number)=>Math.ceil(frames*width*height*0.25)+RENDER_SPACE_MARGIN;
export async function freeBytes(path:string){const stats=await statfs(/*turbopackIgnore: true*/path);return Number(stats.bavail)*Number(stats.bsize);}

export type PrepareDeps={fonts?:()=>FontStatus[];browser?:()=>Promise<BrowserCheck>;source?:()=>string;free?:(path:string)=>Promise<number>};
const textPreview=(content:string)=>{const chars=[...content.trim()];return chars.length>20?`${chars.slice(0,20).join("")}…`:chars.join("");};

// Reads the saved timeline of the project and everything it uses. Returns every blocker; the input only when none.
export async function prepareRender(handle:DatabaseHandle,projectId:string,deps:PrepareDeps={}){
  const jobs=jobsRepository(handle),timelines=timelineRepository(handle),states=workflowRepository(handle);
  const project=jobs.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);
  assertPreviousApproved("edit",states.stages(projectId) as StageState[]);
  const blockers:RenderBlocker[]=[];
  const row=project.currentTimelineRevId?timelines.row(project.currentTimelineRevId):undefined;
  if(!row||row.project_id!==projectId){blockers.push({code:"RENDER_INPUT_MISSING",params:{reason:"no_timeline"}});return {project,row:null,blockers,input:null};}
  const timeline:Timeline=readTimelineRow(row);
  if(!timeline.video.length){blockers.push({code:"RENDER_INPUT_MISSING",params:{reason:"no_scenes"}});return {project,row,blockers,input:null};}
  const scenes=new Map(timeline.video.map((clip,index)=>[clip.sceneId,{number:index+1,title:jobs.scene(clip.sceneId)?.title??`장면 ${index+1}`}]));
  // Clips: a chosen result for every slot, a stored image or video whose bytes are still the registered ones.
  const assets=new Map(jobs.assets([...new Set(timeline.video.flatMap(clip=>clip.assetId?[clip.assetId]:[]))]).map(asset=>[asset.id,asset]));
  const media:RenderInput["media"]=[];
  for(const clip of timeline.video){
    const scene=scenes.get(clip.sceneId)!,where={sceneId:clip.sceneId,sceneNumber:scene.number,sceneTitle:scene.title};
    if(!clip.assetId){blockers.push({code:"RENDER_INPUT_MISSING",params:{reason:"empty_slot",...where}});continue;}
    if(media.some(item=>item.assetId===clip.assetId))continue;
    const asset=assets.get(clip.assetId);
    if(!asset||(asset.kind!=="image"&&asset.kind!=="video")){blockers.push({code:"RENDER_INPUT_MISSING",params:{reason:asset?"unsupported_media":"file_missing",...where}});continue;}
    const file=resolveStoredFile(asset.filePath);if(!file||!asset.filePath||!asset.sha256||!asset.sizeBytes){blockers.push({code:"RENDER_INPUT_MISSING",params:{reason:"file_missing",...where}});continue;}
    const digest=await fileSha256(file);if(digest.sha256!==asset.sha256||digest.sizeBytes!==asset.sizeBytes){blockers.push({code:"RENDER_INPUT_MISSING",params:{reason:"file_changed",...where}});continue;}
    media.push({assetId:asset.id,kind:asset.kind,relPath:asset.filePath,sha256:digest.sha256,sizeBytes:digest.sizeBytes,isMock:asset.isMock});
  }
  // Fonts: every family the texts use must be installed (with its license) now; its file is pinned by hash.
  const statuses=new Map((deps.fonts??fontStatuses)().map(font=>[font.family,font])),fonts:RenderInput["fonts"]=[],fontsRoot=join(/*turbopackIgnore: true*/process.cwd(),"public","fonts");
  for(const family of [...new Set(timeline.text.map(text=>text.style.fontFamily))].sort()){
    const status=statuses.get(family),texts=timeline.text.filter(text=>text.style.fontFamily===family).slice(0,5).map(text=>({id:text.id,preview:textPreview(text.content)}));
    if(!status?.installed||!status.file){blockers.push({code:"FONT_MISSING",params:{family,reason:status?.reason??null,texts}});continue;}
    try{const digest=await fileSha256(status.file);fonts.push({family,relPath:relative(fontsRoot,status.file).replaceAll("\\","/"),sha256:digest.sha256,sizeBytes:digest.sizeBytes,weightMin:Math.min(...status.weights),weightMax:Math.max(...status.weights)});}
    catch{blockers.push({code:"FONT_MISSING",params:{family,reason:null,texts}});}
  }
  // The saved clips must still be the current selection (the edit screen saves again first).
  const current=new Map(currentClips(handle.sqlite,projectId,timeline.video.map(clip=>clip.sceneId)).map(clip=>[clip.sceneId,clip]));
  const stale=timeline.video.filter(clip=>{const now=current.get(clip.sceneId);return !now||!sameClip(clip,{...now,id:clip.id});}).map(clip=>({sceneId:clip.sceneId,sceneTitle:scenes.get(clip.sceneId)!.title}));
  for(const sceneId of current.keys())if(!scenes.has(sceneId))stale.push({sceneId,sceneTitle:jobs.scene(sceneId)?.title??"새 장면"});
  if(stale.length)blockers.push({code:"TIMELINE_STALE",params:{scenes:stale}});
  const browser=await (deps.browser??(()=>checkBrowser()))();
  if(!browser.ok)blockers.push({code:"RENDER_BROWSER_MISSING",params:{reason:browser.reason,version:browser.version}});
  const size=PREVIEW_SIZE[timeline.aspect],videoFrames=totalFrames(timeline.video),durationInFrames=Math.max(videoFrames,...timeline.text.map(text=>text.timing.endFrame));
  const need=neededBytes(durationInFrames,size.width,size.height),free=deps.free??freeBytes;
  {const available=await free(join(/*turbopackIgnore: true*/runtimeRoot(),"storage")).catch(()=>null);// unknown space: the render reports a real ENOSPC
    if(available!==null&&available<need)blockers.push({code:"DISK_FULL",params:{where:"storage",needBytes:need,freeBytes:available}});}
  if(blockers.length||!browser.ok)return {project,row,blockers,input:null};
  const input=renderInputSchema.parse({schemaVersion:1,projectId,contentRevision:row.content_revision,timelineRevId:row.id,timelineRevision:row.revision,timelineSha256:row.timeline_sha256,timeline,
    output:{codec:"h264",pixelFormat:"yuv420p",colorSpace:"bt709",fps:FPS,width:size.width,height:size.height,audio:"none"},durationInFrames,videoFrames,media,fonts,
    renderer:{remotion:REMOTION_VERSION,browser:browser.version,browserSha256:browser.sha256,compositionSourceSha256:(deps.source??compositionSourceSha256)()},sample:media.some(item=>item.isMock)});
  return {project,row,blockers,input};
}
