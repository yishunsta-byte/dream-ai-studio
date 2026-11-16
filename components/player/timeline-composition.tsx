"use client";
import { useState } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import type { PreviewClip, PreviewProps, PreviewText } from "@/lib/edit/preview";
import { textMotion } from "@/lib/edit/text-ops";
import { FONT, fill, TextView } from "./composition-core";
export { TextView };

// P2-2 preview composition (T-067 3.2). Drawn at the project's real pixel size and scaled by the Player, so text
// sizes are the stored px values. Imports only `remotion` and the pure preview module.
// Dark slot with one line in the middle (empty slot, missing file, text-only tail) — T-068 2.3, T-072 G-1. Dark so the
// usual white text stays readable over it (T-074, T-072 C-4); the saved text values are not touched.
function Slot({message,scale}:{message:string;scale:number}){
  return <AbsoluteFill style={{background:"var(--bg-sidebar)",color:"var(--fg-on-sidebar-muted)",alignItems:"center",justifyContent:"center",padding:`${48*scale}px`,textAlign:"center",fontFamily:FONT,fontSize:`${40*scale}px`,fontWeight:600}}><span data-preview-slot>{message}</span></AbsoluteFill>;
}
function ClipView({clip,failed,onFail,scale}:{clip:PreviewClip;failed:boolean;onFail:(sceneId:string)=>void;scale:number}){
  const missing=`장면 ${clip.sceneNumber} 결과 파일을 찾을 수 없어요.`;
  if(clip.source.type==="empty")return <Slot scale={scale} message={`장면 ${clip.sceneNumber} · 결과를 선택하지 않았어요.`}/>;
  if(clip.source.type==="missing"||failed)return <Slot scale={scale} message={missing}/>;
  // onError on both: without it a failed file stops the whole Player (cancelRender); with it only this clip turns gray.
  if(clip.source.type==="image")return <AbsoluteFill style={{background:"#000"}}><Img src={clip.source.src} alt="" pauseWhenLoading maxRetries={0} onError={()=>onFail(clip.sceneId)} onImageError={()=>onFail(clip.sceneId)} style={fill}/></AbsoluteFill>;
  // P2-2: picture only, muted (sound is P2-5, Master D-3).
  return <AbsoluteFill style={{background:"#000"}}><OffthreadVideo src={clip.source.src} trimBefore={clip.source.trimBefore>0?clip.source.trimBefore:undefined} muted pauseWhenBuffering onError={()=>onFail(clip.sceneId)} style={fill}/></AbsoluteFill>;
}

// Inside the Player: the frame is relative to the text's own Sequence.
function MovingText({text,props,scale}:{text:PreviewText;props:PreviewProps;scale:number}){
  const frame=useCurrentFrame();
  return <TextView text={text} scale={scale} motion={textMotion(frame,text.durationInFrames,text.animation,[...text.content].length,props.reducedMotion)}/>;
}

export function TimelineComposition(props:PreviewProps){
  const [failed,setFailed]=useState<ReadonlySet<string>>(()=>new Set());
  const fail=(sceneId:string)=>setFailed(old=>old.has(sceneId)?old:new Set([...old,sceneId]));
  // Chips and slot text are sized for a 1080px-wide frame and scaled with it.
  const scale=props.width/1080;
  return <AbsoluteFill style={{background:"var(--bg-sunken)",overflow:"hidden"}}>
    {props.clips.map(clip=><Sequence key={clip.sceneId} from={clip.from} durationInFrames={clip.durationInFrames} name={`장면 ${clip.sceneNumber}`}><ClipView clip={clip} failed={failed.has(clip.sceneId)} onFail={fail} scale={scale}/></Sequence>)}
    {props.durationInFrames>props.videoFrames&&<Sequence from={props.videoFrames} durationInFrames={props.durationInFrames-props.videoFrames} name="글자만 남은 구간"><Slot scale={scale} message="영상 끝 · 글자만 남은 구간"/></Sequence>}
    {props.texts.map(text=><Sequence key={text.id} from={text.from} durationInFrames={text.durationInFrames} layout="none" name="글자"><MovingText text={text} props={props} scale={scale}/></Sequence>)}
  </AbsoluteFill>;
}
