import { useEffect, useState, type CSSProperties } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { fill, TextView } from "@/components/player/composition-core";
import { textMotion } from "@/lib/edit/text-ops";
import type { PreviewText } from "@/lib/edit/preview";
import type { RenderFont, RenderProps } from "@/lib/render/props";

// P2-4b PC render composition (T-101 2.4). Same text drawing as the preview (composition-core TextView) at the real
// pixel size; scenes are the stored image/video files served by the job file server. Nothing preview-only is drawn:
// no empty-slot or missing-file card, no chips, no outlines. Anything that cannot load stops the render.
// Fonts: each family the texts use is registered from its pinned file under its spec name, and every weight in use
// must load before the first frame; a failed face stops the render with FONT_MISSING.
export const FONT_MISSING_PREFIX="FONT_MISSING:";
function useFonts(fonts:readonly RenderFont[]){
  const [handle]=useState(()=>delayRender("글꼴 불러오기",{timeoutInMilliseconds:60000}));
  useEffect(()=>{let live=true;
    void (async()=>{
      for(const font of fonts){
        try{const face=await new FontFace(font.family,`url("${font.url}")`,{weight:font.weight,display:"block"}).load();document.fonts.add(face);
          for(const weight of font.weights.length?font.weights:[400]){const faces=await document.fonts.load(`${weight} 64px "${font.family}"`,"가A1");if(!faces.length)throw new Error("no face");}}
        catch{if(live)cancelRender(new Error(`${FONT_MISSING_PREFIX}${font.family}`));return;}
      }
      if(live)continueRender(handle);
    })();
    return ()=>{live=false;};
  },[fonts,handle]);
}
function MovingText({text}:{text:PreviewText}){
  const frame=useCurrentFrame();
  return <TextView text={text} scale={1} showChips={false} motion={textMotion(frame,text.durationInFrames,text.animation,[...text.content].length,false)}/>;
}
export function RenderComposition(props:RenderProps){
  useFonts(props.fonts);
  // fontStack("Pretendard") names var(--font-pretendard) (next/font in the app); here it is the registered face.
  const root={background:"#000000",overflow:"hidden","--font-pretendard":"\"Pretendard\""} as CSSProperties;
  return <AbsoluteFill style={root}>
    {props.clips.map(clip=><Sequence key={clip.sceneId} from={clip.from} durationInFrames={clip.durationInFrames} name="장면">
      <AbsoluteFill style={{background:"#000000"}}>{clip.kind==="image"
        ?<Img src={clip.src} style={fill}/>
        :<OffthreadVideo src={clip.src} trimBefore={clip.trimBefore>0?clip.trimBefore:undefined} muted style={fill}/>}</AbsoluteFill>
    </Sequence>)}
    {props.texts.map(text=><Sequence key={text.id} from={text.from} durationInFrames={text.durationInFrames} layout="none" name="글자"><MovingText text={text}/></Sequence>)}
  </AbsoluteFill>;
}
