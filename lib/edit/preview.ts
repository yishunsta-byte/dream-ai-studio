import { FPS, totalFrames, type Timeline, type TimelineText } from "./timeline";

// P2-2 preview (T-067 3.1, T-068): the timeline on screen (saved + unsaved edits) turned into Player input. Pure and
// client-safe: no server modules, inputs are never changed, nothing here is saved anywhere.
export type PreviewAspect=Timeline["aspect"];
export const PREVIEW_ASPECTS=["9:16","16:9","1:1"] as const satisfies readonly PreviewAspect[];
export const PREVIEW_SIZE={"9:16":{width:1080,height:1920},"16:9":{width:1920,height:1080},"1:1":{width:1080,height:1080}} as const;
// spec text-presets.json safeArea (tests compare these with the spec file).
export const SAFE_AREA={"9:16":{top:0.12,bottom:0.2,right:0.12,left:0},"16:9":{top:0.05,bottom:0.05,right:0.05,left:0.05},"1:1":{top:0.05,bottom:0.05,right:0.05,left:0.05}} as const;

export type PreviewAsset={kind:string;available:boolean;isMock?:boolean};
export type PreviewSource={type:"empty"}|{type:"missing"}|{type:"image";src:string}|{type:"video";src:string;trimBefore:number};
export type PreviewClip={sceneId:string;sceneNumber:number;from:number;durationInFrames:number;source:PreviewSource};
// P2-3: animation drawn per frame, fontMissing per text (its family could not be loaded), mark = editor outline.
export type PreviewText={id:string;content:string;style:TimelineText["style"];box:TimelineText["box"];animation:TimelineText["animation"];from:number;durationInFrames:number;movedForPreview:boolean;animated:boolean;fontMissing:boolean;mark:"selected"|"warning"|null};
export type PreviewProps={fps:typeof FPS;aspect:PreviewAspect;width:number;height:number;durationInFrames:number;videoFrames:number;clips:PreviewClip[];texts:PreviewText[];reducedMotion:boolean;sample:boolean;fontMissing:boolean};

const assetSrc=(id:string)=>`/api/assets/${encodeURIComponent(id)}`;
const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),max);

// Only when the preview aspect differs from the saved one: a text box (center anchor, one line as its height) that
// leaves that aspect's safe area is shown moved inside it. The real outline is measured on screen (spec rule).
function boxForPreview(text:TimelineText,aspect:PreviewAspect,height:number):{box:TimelineText["box"];moved:boolean}{
  const safe=SAFE_AREA[aspect],box=text.box;if(box.anchor!=="center")return {box,moved:false};
  const half=Math.min(box.widthRatio,1-safe.left-safe.right)/2,halfH=text.style.fontSize*text.style.lineHeight/2/height;
  const x=box.widthRatio>1-safe.left-safe.right?safe.left+(1-safe.left-safe.right)/2:clamp(box.x,safe.left+half,1-safe.right-half);
  const y=clamp(box.y,safe.top+halfH,Math.max(safe.top+halfH,1-safe.bottom-halfH));
  const moved=Math.abs(x-box.x)>1e-9||Math.abs(y-box.y)>1e-9;
  return moved?{box:{...box,x,y},moved}:{box,moved};
}

// null = nothing to show (no scene and no text): the "비어 있음" state, no Player (durationInFrames must be > 0).
export function previewProps(timeline:Timeline,assets:ReadonlyMap<string,PreviewAsset>,options:{aspect:PreviewAspect;reducedMotion:boolean;fontMissing?:boolean;missingFamilies?:readonly string[];selectedTextId?:string|null;warnings?:ReadonlySet<string>}):PreviewProps|null{
  const size=PREVIEW_SIZE[options.aspect],videoFrames=totalFrames(timeline.video);
  if(timeline.video.length===0)return null;
  let from=0,sample=false;
  const clips=timeline.video.map((clip,index):PreviewClip=>{
    const asset=clip.assetId?assets.get(clip.assetId):undefined;if(asset?.isMock)sample=true;
    const source:PreviewSource=clip.assetId===null?{type:"empty"}:!asset||!asset.available?{type:"missing"}:asset.kind==="image"?{type:"image",src:assetSrc(clip.assetId)}:asset.kind==="video"?{type:"video",src:assetSrc(clip.assetId),trimBefore:clip.trimInFrames}:{type:"missing"};
    const value={sceneId:clip.sceneId,sceneNumber:index+1,from,durationInFrames:clip.durationFrames,source};from+=clip.durationFrames;return value;
  });
  const differs=options.aspect!==timeline.aspect;
  const texts=timeline.text.map((text):PreviewText=>{
    const placed=differs?boxForPreview(text,options.aspect,size.height):{box:text.box,moved:false};
    const animated=text.animation.in!=="none"||text.animation.out!=="none"||text.animation.emphasis!=="none";
    const fontMissing=(options.fontMissing??false)||(options.missingFamilies??[]).includes(text.style.fontFamily);
    // Warnings count only in the saved aspect (T-080 6.1); a warning outline wins over the selected one (6.3).
    const mark=!differs&&options.warnings?.has(text.id)?"warning":options.selectedTextId===text.id?"selected":null;
    return {id:text.id,content:text.content,style:text.style,box:placed.box,animation:text.animation,from:text.timing.startFrame,durationInFrames:text.timing.endFrame-text.timing.startFrame,movedForPreview:placed.moved,animated,fontMissing,mark};
  });
  const durationInFrames=Math.max(videoFrames,...timeline.text.map(text=>text.timing.endFrame));
  return {fps:FPS,aspect:options.aspect,width:size.width,height:size.height,durationInFrames,videoFrames,clips,texts,reducedMotion:options.reducedMotion,sample,fontMissing:(options.fontMissing??false)||(options.missingFamilies??[]).length>0};
}

// T-068 3장: MM:SS.FF (FF 00~29), H:MM:SS.FF from one hour.
export function formatFrameTime(frame:number){
  const value=Math.max(0,Math.floor(frame)),frames=value%FPS,seconds=Math.floor(value/FPS),pad=(n:number)=>String(n).padStart(2,"0");
  const hours=Math.floor(seconds/3600),rest=`${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)}.${pad(frames)}`;
  return hours>0?`${hours}:${rest}`:rest;
}
// The words a screen reader hears (T-068 3장): "8초 10프레임", "1분 2초 3프레임".
export function spokenFrameTime(frame:number){
  const value=Math.max(0,Math.floor(frame)),seconds=Math.floor(value/FPS),minutes=Math.floor(seconds/60);
  return `${minutes?`${minutes}분 `:""}${seconds%60}초 ${value%FPS}프레임`;
}
// Seek target kept inside 0 … last frame.
export const clampFrame=(frame:number,durationInFrames:number)=>clamp(Math.round(frame),0,Math.max(0,durationInFrames-1));
