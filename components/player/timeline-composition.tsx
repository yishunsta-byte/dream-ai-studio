"use client";
import { useState, type CSSProperties } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence } from "remotion";
import type { PreviewClip, PreviewProps, PreviewText } from "@/lib/edit/preview";

// P2-2 preview composition (T-067 3.2). Drawn at the project's real pixel size and scaled by the Player, so text
// sizes are the stored px values. Imports only `remotion` and the pure preview module.
const FONT="var(--font-pretendard), system-ui, sans-serif";
// Gray slot with one line in the middle (empty slot, missing file, text-only tail) — T-068 2.3, T-072 G-1.
function Slot({message,scale}:{message:string;scale:number}){
  return <AbsoluteFill style={{background:"var(--bg-sunken)",color:"var(--fg-muted)",alignItems:"center",justifyContent:"center",padding:`${48*scale}px`,textAlign:"center",fontFamily:FONT,fontSize:`${40*scale}px`,fontWeight:600}}><span data-preview-slot>{message}</span></AbsoluteFill>;
}
// A dashed chip inside the frame (composition px, scaled with the picture).
function Chip({children,scale}:{children:string;scale:number}){
  return <span style={{display:"inline-block",marginBottom:`${8*scale}px`,padding:`${4*scale}px ${12*scale}px`,border:`${2*scale}px dashed var(--line-strong)`,borderRadius:`${8*scale}px`,background:"var(--bg-surface)",color:"var(--fg-strong)",fontFamily:FONT,fontSize:`${24*scale}px`,fontWeight:600,lineHeight:1.4}}>{children}</span>;
}

function ClipView({clip,failed,onFail,scale}:{clip:PreviewClip;failed:boolean;onFail:(sceneId:string)=>void;scale:number}){
  const missing=`장면 ${clip.sceneNumber} 결과 파일을 찾을 수 없어요.`,fill:CSSProperties={width:"100%",height:"100%",objectFit:"contain"};
  if(clip.source.type==="empty")return <Slot scale={scale} message={`장면 ${clip.sceneNumber} · 결과를 선택하지 않았어요.`}/>;
  if(clip.source.type==="missing"||failed)return <Slot scale={scale} message={missing}/>;
  // onError on both: without it a failed file stops the whole Player (cancelRender); with it only this clip turns gray.
  if(clip.source.type==="image")return <AbsoluteFill style={{background:"#000"}}><Img src={clip.source.src} alt="" pauseWhenLoading maxRetries={0} onError={()=>onFail(clip.sceneId)} onImageError={()=>onFail(clip.sceneId)} style={fill}/></AbsoluteFill>;
  // P2-2: picture only, muted (sound is P2-5, Master D-3).
  return <AbsoluteFill style={{background:"#000"}}><OffthreadVideo src={clip.source.src} trimBefore={clip.source.trimBefore>0?clip.source.trimBefore:undefined} muted pauseWhenBuffering onError={()=>onFail(clip.sceneId)} style={fill}/></AbsoluteFill>;
}

function TextView({text,props,scale}:{text:PreviewText;props:PreviewProps;scale:number}){
  const {style,box}=text,hex=(color:string,opacity:number)=>`${color}${Math.round(opacity*255).toString(16).padStart(2,"0")}`;
  const chips=[text.movedForPreview?"미리보기 위치":null,props.fontMissing?"글꼴 없음 · 대신 보여요":null].filter((chip):chip is string=>chip!==null);
  return <div data-text-layer={text.id} style={{position:"absolute",left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.widthRatio*100}%`,transform:`${box.anchor==="center"?"translate(-50%,-50%) ":""}rotate(${box.rotation}deg)`,textAlign:style.align}}>
    {chips.length>0&&<div style={{textAlign:"left"}}>{chips.map(chip=><Chip key={chip} scale={scale}>{chip}</Chip>)}</div>}
    <div data-text-body style={{display:"inline-block",maxWidth:"100%",fontFamily:FONT,fontSize:`${style.fontSize}px`,fontWeight:style.fontWeight,color:style.color,lineHeight:style.lineHeight,letterSpacing:`${style.letterSpacing}em`,whiteSpace:"pre-wrap",overflowWrap:"anywhere",
      WebkitTextStroke:style.stroke?`${style.stroke.width}px ${style.stroke.color}`:undefined,paintOrder:style.stroke?"stroke fill":undefined,
      textShadow:style.shadow?`${style.shadow.x}px ${style.shadow.y}px ${style.shadow.blur}px ${hex(style.shadow.color,style.shadow.opacity)}`:undefined,
      background:style.background?hex(style.background.color,style.background.opacity):undefined,padding:style.background?`${style.background.paddingY}px ${style.background.paddingX}px`:undefined,borderRadius:style.background?`${style.background.radius}px`:undefined}}>{text.content}</div>
  </div>;
}

export function TimelineComposition(props:PreviewProps){
  const [failed,setFailed]=useState<ReadonlySet<string>>(()=>new Set());
  const fail=(sceneId:string)=>setFailed(old=>old.has(sceneId)?old:new Set([...old,sceneId]));
  // Chips and slot text are sized for a 1080px-wide frame and scaled with it.
  const scale=props.width/1080;
  return <AbsoluteFill style={{background:"var(--bg-sunken)",overflow:"hidden"}}>
    {props.clips.map(clip=><Sequence key={clip.sceneId} from={clip.from} durationInFrames={clip.durationInFrames} name={`장면 ${clip.sceneNumber}`}><ClipView clip={clip} failed={failed.has(clip.sceneId)} onFail={fail} scale={scale}/></Sequence>)}
    {props.durationInFrames>props.videoFrames&&<Sequence from={props.videoFrames} durationInFrames={props.durationInFrames-props.videoFrames} name="글자만 남은 구간"><Slot scale={scale} message="영상 끝 · 글자만 남은 구간"/></Sequence>}
    {props.texts.map(text=><Sequence key={text.id} from={text.from} durationInFrames={text.durationInFrames} layout="none" name="글자"><TextView text={text} props={props} scale={scale}/></Sequence>)}
  </AbsoluteFill>;
}
