import { Composition, registerRoot } from "remotion";
import { RenderComposition } from "./render-composition";
import type { RenderProps } from "@/lib/render/props";

// P2-4b render entry (T-101 2.4). Bundled only by the render child (never by Next); the size, length and frame rate
// come from the fixed input through the props.
const EMPTY:RenderProps={width:1080,height:1920,fps:30,durationInFrames:1,videoFrames:1,clips:[],texts:[],fonts:[]};
function Root(){
  return <Composition id="DreamTimeline" component={RenderComposition} durationInFrames={1} fps={30} width={1080} height={1920} defaultProps={EMPTY}
    calculateMetadata={({props})=>({durationInFrames:props.durationInFrames,width:props.width,height:props.height,fps:props.fps})}/>;
}
registerRoot(Root);
