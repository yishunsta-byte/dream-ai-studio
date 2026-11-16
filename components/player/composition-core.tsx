import type { CSSProperties } from "react";
import type { PreviewText } from "@/lib/edit/preview";
import { fontStack } from "@/lib/edit/fonts";
import type { TextMotion } from "@/lib/edit/text-ops";

// P2-4b (T-101 2.4): the text drawing shared by the preview Player, the editor's off-screen measure and the PC render.
// Moved here unchanged from timeline-composition.tsx so all three draw the same pixels; no "use client", no server
// module, no app style sheet. CSS variables appear only in preview-only parts (chips, editor outlines) and in the
// Pretendard stack, which the render page defines itself.
export const FONT=fontStack("Pretendard");
export const fill:CSSProperties={width:"100%",height:"100%",objectFit:"contain"};
// A dashed chip inside the frame (composition px, scaled with the picture).
function Chip({children,scale}:{children:string;scale:number}){
  return <span style={{display:"inline-block",marginBottom:`${8*scale}px`,padding:`${4*scale}px ${12*scale}px`,border:`${2*scale}px dashed var(--line-strong)`,borderRadius:`${8*scale}px`,background:"var(--bg-surface)",color:"var(--fg-strong)",fontFamily:FONT,fontSize:`${24*scale}px`,fontWeight:600,lineHeight:1.4}}>{children}</span>;
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
