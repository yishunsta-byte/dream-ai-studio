import { v7 } from "uuid";
import { FPS, type Timeline, type TimelineText } from "./timeline";
import { presetFor, type TextKind } from "./presets";
import { SAFE_AREA } from "./preview";

// P2-3a text editor operations (T-079 2.2, T-080). Pure and client-safe: each returns a new value and never changes
// its input, and a field the user did not touch keeps its saved value exactly (P1 values included).

// A new text gets the spec preset of its kind (style, box, animation, lock). Time: 3 s from the play position, moved
// earlier near the video end so it still gets 3 s when the video is that long (T-083 E-4). A required disclosure runs over the whole plan and is stacked below the earlier ones.
export function newTextLayer(kind:TextKind,{startFrame,videoFrames,plannedFrames,content="",stack=0}:{startFrame:number;videoFrames:number;plannedFrames:number;content?:string;stack?:number}):TimelineText{
  const preset=presetFor(kind);
  const timing=kind==="disclosure"?{startFrame:0,endFrame:Math.max(1,plannedFrames)}:(()=>{const start=Math.max(0,Math.min(Math.round(startFrame),videoFrames-3*FPS,videoFrames-1));return {startFrame:start,endFrame:Math.max(start+1,Math.min(start+3*FPS,videoFrames))};})();
  const box=kind==="disclosure"?{...preset.box,y:Math.min(0.9,preset.box.y+stack*0.04)}:{...preset.box};
  return {id:v7(),kind,content,speakerCharacterId:null,style:structuredClone(preset.style),box,timing,animation:{...preset.animation},locked:preset.locked};
}
export const replaceText=(timeline:Timeline,id:string,next:(layer:TimelineText)=>TimelineText):Timeline=>({...timeline,text:timeline.text.map(layer=>layer.id===id?next(layer):layer)});
// Quick look (T-080 5.3): style and animation only; the box only when "기본 위치도 함께" is on. Text, time, kind and
// lock stay. Never for a locked disclosure.
export function applyPreset(layer:TimelineText,kind:TextKind,withBox:boolean):TimelineText{
  if(layer.locked)return layer;const preset=presetFor(kind);
  return {...layer,style:structuredClone(preset.style),animation:{...preset.animation},box:withBox?{...preset.box}:layer.box};
}
// Changing the kind keeps the look; only the line limit (a warning threshold) follows the new kind.
export function changeKind(layer:TimelineText,kind:TextKind):TimelineText{
  if(layer.locked||layer.kind===kind)return layer;
  return {...layer,kind,style:{...layer.style,maxLines:presetFor(kind).style.maxLines}};
}
// Drawing order: later texts are drawn on top. `direction` +1 = forward (later), −1 = back.
export function moveText(timeline:Timeline,id:string,direction:1|-1):Timeline{
  const index=timeline.text.findIndex(layer=>layer.id===id),to=index+direction;if(index<0||to<0||to>=timeline.text.length)return timeline;
  const text=[...timeline.text];[text[index],text[to]]=[text[to],text[index]];return {...timeline,text};
}
export function removeText(timeline:Timeline,id:string):Timeline{
  const layer=timeline.text.find(item=>item.id===id);if(!layer||layer.locked)return timeline;
  return {...timeline,text:timeline.text.filter(item=>item.id!==id)};
}
export function insertText(timeline:Timeline,layer:TimelineText,index=timeline.text.length):Timeline{
  const text=[...timeline.text];text.splice(Math.max(0,Math.min(index,text.length)),0,layer);return {...timeline,text};
}

// "MM:SS.FF" or "H:MM:SS.FF" (FF 00–29) → frames (the inverse of formatFrameTime).
export function parseFrameTime(value:string):{frame:number}|{error:"format"|"frame"}{
  const match=/^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{2})$/.exec(value.trim());if(!match)return {error:"format"};
  const [hours,minutes,seconds,frames]=[Number(match[1]??0),Number(match[2]),Number(match[3]),Number(match[4])];
  if(minutes>59||seconds>59)return {error:"format"};if(frames>=FPS)return {error:"frame"};
  return {frame:((hours*60+minutes)*60+seconds)*FPS+frames};
}

// Measured outer box of a drawn text in composition px (glyphs + stroke + shadow + band, T-080 2.2).
export type MeasuredRect={left:number;top:number;right:number;bottom:number};
export type SafeSide="top"|"bottom"|"left"|"right";
const TOLERANCE=0.5;
export function safeAreaRect(aspect:Timeline["aspect"],width:number,height:number):MeasuredRect{
  const safe=SAFE_AREA[aspect];return {left:width*safe.left,top:height*safe.top,right:width*(1-safe.right),bottom:height*(1-safe.bottom)};
}
export function safeViolations(rect:MeasuredRect,aspect:Timeline["aspect"],width:number,height:number):SafeSide[]{
  const inner=safeAreaRect(aspect,width,height),sides:SafeSide[]=[];
  if(rect.top<inner.top-TOLERANCE)sides.push("top");if(rect.bottom>inner.bottom+TOLERANCE)sides.push("bottom");
  if(rect.left<inner.left-TOLERANCE)sides.push("left");if(rect.right>inner.right+TOLERANCE)sides.push("right");
  return sides;
}
// "안전 영역 안으로 옮기기": the smallest move of x/y that brings the measured box inside; null when it cannot fit.
export function moveInsideSafeArea(box:TimelineText["box"],rect:MeasuredRect,aspect:Timeline["aspect"],width:number,height:number):TimelineText["box"]|null{
  const inner=safeAreaRect(aspect,width,height);
  if(rect.right-rect.left>inner.right-inner.left||rect.bottom-rect.top>inner.bottom-inner.top)return null;
  const shift=(low:number,high:number,min:number,max:number)=>low<min?min-low+TOLERANCE/2:high>max?max-high-TOLERANCE/2:0;
  const dx=shift(rect.left,rect.right,inner.left,inner.right),dy=shift(rect.top,rect.bottom,inner.top,inner.bottom);
  if(dx===0&&dy===0)return box;
  const round=(value:number)=>Math.round(value*1e6)/1e6;
  return {...box,x:round(Math.min(1,Math.max(0,box.x+dx/width))),y:round(Math.min(1,Math.max(0,box.y+dy/height)))};
}

// Text motion at a frame inside its own span (T-080 5.7, spec animationLabels). Reduced motion = shown as is.
export type TextMotion={opacity:number;translateX:number;translateY:number;scale:number;visibleChars:number|null};
const STILL:TextMotion={opacity:1,translateX:0,translateY:0,scale:1,visibleChars:null};
const ease=(name:TimelineText["animation"]["easing"],t:number)=>{const x=Math.min(1,Math.max(0,t));return name==="linear"?x:name==="ease-out"?1-(1-x)**3:x<0.5?4*x**3:1-(-2*x+2)**3/2;};
export function textMotion(frame:number,span:number,animation:TimelineText["animation"],length:number,reducedMotion:boolean):TextMotion{
  if(reducedMotion)return STILL;const motion={...STILL},d=animation.durationFrames;
  // The first and last frames of the saved time are never fully invisible (T-083 E-2). Typewriter shows letters at an
  // even pace (no easing).
  if(d>0&&animation.in!=="none"&&frame<d){const p=ease(animation.easing,(frame+1)/d);
    if(animation.in==="fade")motion.opacity=p;else if(animation.in==="pop"){motion.opacity=p;motion.scale=0.7+0.3*p;}else if(animation.in==="slide-up"){motion.opacity=p;motion.translateY=48*(1-p);}else if(animation.in==="typewriter")motion.visibleChars=Math.ceil(length*Math.min(1,(frame+1)/d));}
  if(d>0&&animation.out!=="none"&&frame>=span-d){const q=ease(animation.easing,(frame-(span-d))/d);
    motion.opacity=Math.min(motion.opacity,1-q);if(animation.out==="slide-down")motion.translateY+=48*q;}
  if(animation.emphasis!=="none"){const wave=Math.sin(frame/FPS*2*Math.PI);
    if(animation.emphasis==="bounce")motion.translateY-=12*Math.abs(wave);else if(animation.emphasis==="shake")motion.translateX+=6*Math.sin(frame/FPS*8*Math.PI);else motion.scale*=1+0.06*wave;}
  return motion;
}
