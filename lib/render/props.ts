import type { PreviewText } from "@/lib/edit/preview";
import type { RenderInput } from "./input";

// P2-4b composition props (T-101 2.4). Built by the render child from the fixed input and the job file server's URLs:
// no app route, no relative URL, nothing the browser could fetch from elsewhere. Pure (types only), so the child can
// import it without the server-only modules.
export type RenderClip={sceneId:string;from:number;durationInFrames:number;kind:"image"|"video";src:string;trimBefore:number};
export type RenderFont={family:string;url:string;weight:string;weights:number[]};
export type RenderProps={width:number;height:number;fps:30;durationInFrames:number;videoFrames:number;clips:RenderClip[];texts:PreviewText[];fonts:RenderFont[]};
export function renderProps(input:RenderInput,urls:{media:(index:number)=>string;font:(index:number)=>string}):RenderProps{
  const index=new Map(input.media.map((item,n)=>[item.assetId,{item,n}]));let from=0;
  const clips=input.timeline.video.map(clip=>{const found=clip.assetId?index.get(clip.assetId):undefined;if(!found)throw new Error("render input has an empty or unknown clip");
    const value:RenderClip={sceneId:clip.sceneId,from,durationInFrames:clip.durationFrames,kind:found.item.kind,src:urls.media(found.n),trimBefore:found.item.kind==="video"?clip.trimInFrames:0};from+=clip.durationFrames;return value;});
  // Texts exactly as stored: no preview move, no chips, no outline (the render draws only what was saved).
  const texts=input.timeline.text.map((text):PreviewText=>({id:text.id,content:text.content,style:text.style,box:text.box,animation:text.animation,from:text.timing.startFrame,durationInFrames:text.timing.endFrame-text.timing.startFrame,
    movedForPreview:false,animated:text.animation.in!=="none"||text.animation.out!=="none"||text.animation.emphasis!=="none",fontMissing:false,mark:null}));
  const fonts=input.fonts.map((font,n)=>{const weights=[...new Set(input.timeline.text.filter(text=>text.style.fontFamily===font.family).map(text=>text.style.fontWeight))].sort((a,b)=>a-b);
    return {family:font.family,url:urls.font(n),weight:font.weightMin===font.weightMax?String(font.weightMin):`${font.weightMin} ${font.weightMax}`,weights};});
  return {width:input.output.width,height:input.output.height,fps:30,durationInFrames:input.durationInFrames,videoFrames:input.videoFrames,clips,texts,fonts};
}
