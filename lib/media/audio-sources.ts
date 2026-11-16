// P2-6 S3 (T-162, T-154 D-6): one rule for "is this sound source still the file the timeline was saved with", shared
// by the render input (envelope B) and the editing bundle. Pure: the caller resolves the stored file and measures it.
// The order of the checks is the render's (T-137): row, kind, stored file and its recorded fields, bytes, range.
import { FPS } from "@/lib/edit/timeline";

export type AudioSourceReason="file_missing"|"not_audio"|"file_changed"|"range";
export type AudioSourceClip={id:string;assetId:string;sourceInFrame:number;durationFrames:number};
export type AudioSourceAsset={id:string;kind:string;filePath:string|null;sha256:string|null;sizeBytes:number|null;durationMs:number|null};
export type AudioSourceIssue={reason:AudioSourceReason;clipId:string;assetId:string};

// The distinct sources in a fixed order (assetId ascending): the render plan and the bundle number them the same way.
export const audioSourceIds=(clips:readonly AudioSourceClip[])=>[...new Set(clips.map(clip=>clip.assetId))].sort();
export const firstAudioClip=(clips:readonly AudioSourceClip[],assetId:string)=>clips.find(clip=>clip.assetId===assetId)!.id;
// Step 1: the row, its kind and its stored file. Returns the file to measure, or the issue.
export function audioSourceFile(clips:readonly AudioSourceClip[],assetId:string,asset:AudioSourceAsset|undefined,resolve:(path:string|null)=>string|null):{file:string}|{issue:AudioSourceIssue}{
  const where={clipId:firstAudioClip(clips,assetId),assetId};
  if(!asset)return {issue:{reason:"file_missing",...where}};
  if(asset.kind!=="audio")return {issue:{reason:"not_audio",...where}};
  const file=resolve(asset.filePath);
  if(!file||!asset.filePath||!asset.sha256||!asset.sizeBytes||!asset.durationMs)return {issue:{reason:"file_missing",...where}};
  return {file};
}
// Step 2: the measured bytes (null = could not be read). A size-only measurement (no sha256) checks the size alone.
export function audioSourceBytes(clips:readonly AudioSourceClip[],asset:AudioSourceAsset,measured:{sha256?:string;sizeBytes:number}|null):AudioSourceIssue|null{
  const where={clipId:firstAudioClip(clips,asset.id),assetId:asset.id};
  if(!measured)return {reason:"file_missing",...where};
  if((measured.sha256!==undefined&&measured.sha256!==asset.sha256)||measured.sizeBytes!==asset.sizeBytes)return {reason:"file_changed",...where};
  return null;
}
// Step 3: every clip of this source stays inside the recorded length.
export function audioSourceRange(clips:readonly AudioSourceClip[],asset:AudioSourceAsset):AudioSourceIssue|null{
  const available=Math.floor(asset.durationMs!*FPS/1000),over=clips.find(clip=>clip.assetId===asset.id&&clip.sourceInFrame+clip.durationFrames>available);
  return over?{reason:"range",clipId:over.id,assetId:asset.id}:null;
}
