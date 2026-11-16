"use client";
import { useState, type CSSProperties } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import type { PreviewClip, PreviewProps, PreviewText } from "@/lib/edit/preview";
import { fontStack } from "@/lib/edit/fonts";
import { textMotion, type TextMotion } from "@/lib/edit/text-ops";

// P2-2 preview composition (T-067 3.2). Drawn at the project's real pixel size and scaled by the Player, so text
// sizes are the stored px values. Imports only `remotion` and the pure preview module.
const FONT=fontStack("Pretendard");
// Dark slot with one line in the middle (empty slot, missing file, text-only tail) — T-068 2.3, T-072 G-1. Dark so the
// usual white text stays readable over it (T-074, T-072 C-4); the saved text values are not touched.
function Slot({message,scale}:{message:string;scale:number}){
  return <AbsoluteFill style={{background:"var(--bg-sidebar)",color:"var(--fg-on-sidebar-muted)",alignItems:"center",justifyContent:"center",padding:`${48*scale}px`,textAlign:"center",fontFamily:FONT,fontSize:`${40*scale}px`,fontWeight:600}}><span data-preview-slot>{message}</span></AbsoluteFill>;
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

// One text, drawn at composition px (spec units: size, stroke, letter spacing and band padding are all "short side
// 1080 px", T-080 2.2). The stroke is the width seen outside the glyph: -webkit-text-stroke draws half inside, so it is
// drawn at 2×width under the fill (paint-order), and the wrap width leaves room for it (spec units.box: widthRatio is the
// outer width). The editor measures this same component (text-measure.tsx).
export function TextView({text,scale,motion,showChips=true}:{text:PreviewText;scale:number;motion?:TextMotion;showChips?:boolean}){
  const {style,box}=text,hex=(color:string,opacity:number)=>`${color}${Math.round(opacity*255).toString(16).padStart(2,"0")}`;
  const chips=showChips?[text.movedForPreview?"미리보기 위치":null,text.fontMissing?"글꼴 없음 · 대신 보여요":null].filter((chip):chip is string=>chip!==null):[];
  const content=motion?.visibleChars!=null?[...text.content].slice(0,motion.visibleChars).join(""):text.content;
  // Editor outlines (preview only): 2px line + 1px dark edge at the shown size (stage ≤ 360px wide, T-080 6.3).
  const unit=scale*3,mark=text.mark==="warning"?{outline:`${2*unit}px dashed var(--st-warning-line)`,boxShadow:`0 0 0 ${3*unit}px var(--bg-sidebar)`}:text.mark==="selected"?{outline:`${2*unit}px solid var(--accent-bar)`,boxShadow:`0 0 0 ${3*unit}px var(--bg-sidebar)`}:{};
  const moved=motion?{opacity:motion.opacity,transform:`translate(${motion.translateX}px,${motion.translateY}px) scale(${motion.scale})`}:{};
  return <div data-text-layer={text.id} style={{position:"absolute",left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.widthRatio*100}%`,transform:`${box.anchor==="center"?"translate(-50%,-50%) ":""}rotate(${box.rotation}deg)`,textAlign:style.align}}>
    {chips.length>0&&<div style={{textAlign:"left"}}>{chips.map(chip=><Chip key={chip} scale={scale}>{chip}</Chip>)}</div>}
    <div data-text-body style={{display:"inline-block",maxWidth:style.stroke?`calc(100% - ${style.stroke.width*2}px)`:"100%",boxSizing:"border-box",fontFamily:fontStack(style.fontFamily),fontSize:`${style.fontSize}px`,fontWeight:style.fontWeight,color:style.color,lineHeight:style.lineHeight,letterSpacing:`${style.letterSpacing}px`,whiteSpace:"pre-wrap",overflowWrap:"anywhere",
      WebkitTextStroke:style.stroke?`${style.stroke.width*2}px ${style.stroke.color}`:undefined,paintOrder:style.stroke?"stroke fill":undefined,
      textShadow:style.shadow?`${style.shadow.x}px ${style.shadow.y}px ${style.shadow.blur}px ${hex(style.shadow.color,style.shadow.opacity)}`:undefined,
      background:style.background?hex(style.background.color,style.background.opacity):undefined,padding:style.background?`${style.background.paddingY}px ${style.background.paddingX}px`:undefined,borderRadius:style.background?`${style.background.radius}px`:undefined,
      transformOrigin:"center",...moved,...mark}}>{content}</div>
  </div>;
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
