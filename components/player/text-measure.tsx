"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PREVIEW_SIZE, type PreviewAspect, type PreviewText } from "@/lib/edit/preview";
import type { FontRef } from "@/lib/edit/fonts";
import type { MeasuredRect } from "@/lib/edit/text-ops";
import type { TimelineText } from "@/lib/edit/timeline";
import { TextView } from "./timeline-composition";
import { fontKey, fontUses, loadFonts, type FontState } from "./font-loader";

// P2-3 real-font measurement (T-079 4.1, T-080 6.1, spec safeArea.rule·textFit). The texts are drawn off screen at the
// saved aspect's composition size with the same TextView as the Player, without motion, chips or outlines, after their
// fonts are loaded. Outer box = drawn box (band padding included) + stroke width (seen outside) + shadow reach.
export type Measured={rect:MeasuredRect;lines:number;font:FontState|"checking"};
export type MeasureResult={width:number;height:number;texts:Record<string,Measured>};
function outer(body:HTMLElement,frame:DOMRect,style:TimelineText["style"]):MeasuredRect{
  const box=body.getBoundingClientRect(),stroke=style.stroke?.width??0,shadow=style.shadow;
  const reach=(offset:number)=>shadow?Math.max(0,shadow.blur+offset):0;
  return {left:box.left-frame.left-stroke-(shadow?reach(-shadow.x):0),right:box.right-frame.left+stroke+(shadow?reach(shadow.x):0),
    top:box.top-frame.top-stroke-(shadow?reach(-shadow.y):0),bottom:box.bottom-frame.top+stroke+(shadow?reach(shadow.y):0)};
}
// Lines = distinct line boxes of the text (Range rects grouped by their top).
function lineCount(body:HTMLElement){
  const range=document.createRange();range.selectNodeContents(body);const tops:number[]=[];
  for(const rect of range.getClientRects()){if(rect.width<=0&&rect.height<=0)continue;if(!tops.some(top=>Math.abs(top-rect.top)<2))tops.push(rect.top);}
  return tops.length;
}
export function TextMeasure({texts,aspect,fonts,onResult}:{texts:readonly TimelineText[];aspect:PreviewAspect;fonts:readonly FontRef[];onResult:(result:MeasureResult)=>void}){
  const frameRef=useRef<HTMLDivElement>(null),size=PREVIEW_SIZE[aspect];
  const key=useMemo(()=>fontKey(fontUses(texts)),[texts]);
  const [fontResult,setFontResult]=useState<{key:string;states:Record<string,FontState>}|null>(null);
  useEffect(()=>{let live=true;const uses=new Map(key?key.split("|").map(part=>{const [family,weights]=part.split(":");return [family,weights.split("/").map(Number)] as const;}):[]);
    void loadFonts(uses,fonts).then(states=>{if(live)setFontResult({key,states});});return ()=>{live=false;};},[key,fonts]);
  const drawn=useMemo(()=>texts.map((text):PreviewText=>({id:text.id,content:text.content,style:text.style,box:text.box,animation:text.animation,from:0,durationInFrames:1,movedForPreview:false,animated:false,fontMissing:false,mark:null})),[texts]);
  const settled=fontResult?.key===key;
  // Measured after layout and after the fonts are in; a family still loading is reported as "checking".
  useLayoutEffect(()=>{
    const frame=frameRef.current;if(!frame)return;const id=requestAnimationFrame(()=>{
      const rect=frame.getBoundingClientRect(),result:Record<string,Measured>={};
      for(const text of texts){const body=frame.querySelector<HTMLElement>(`[data-text-layer="${CSS.escape(text.id)}"] [data-text-body]`);if(!body)continue;
        const font=settled?fontResult!.states[text.style.fontFamily]??"missing":"checking";
        result[text.id]={rect:outer(body,rect,text.style),lines:text.content.trim()?lineCount(body):0,font};}
      onResult({width:size.width,height:size.height,texts:result});
    });return ()=>cancelAnimationFrame(id);
  },[drawn,texts,settled,fontResult,size.width,size.height,onResult]);
  return <div ref={frameRef} aria-hidden="true" data-text-measure style={{position:"fixed",left:-40000,top:0,width:size.width,height:size.height,visibility:"hidden",pointerEvents:"none",overflow:"hidden",contain:"strict"}}>
    {drawn.map(text=><TextView key={text.id} text={text} scale={size.width/1080} showChips={false}/>)}
  </div>;
}
