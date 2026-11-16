import { v7 } from "uuid";
import { canonicalJson, FPS, type Timeline, type TimelineText } from "./timeline";
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
// A text that ends after the video is warned about (kept, never cut). A locked required disclosure is fixed to the
// plan length by rule, so a video shorter than the plan is a normal state with nothing to fix (T-084 B-2).
export const beyondVideo=(layer:Pick<TimelineText,"locked"|"timing">,videoFrames:number)=>!layer.locked&&layer.timing.endFrame>videoFrames;
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

// P2-3b timeline text row (T-079 6.4, T-033 3.2.1). "move" keeps the length and shifts the whole text; "end" changes
// only the end. Both stay inside 0..limit (the server's end limit for a new or changed text) and keep at least one
// frame. A text that already ends past the limit (kept from P1) comes back inside on its first move; a text longer
// than the limit cannot be moved (the same timing is returned).
export type TimingEdit="move"|"end";
export function shiftTiming(timing:TimelineText["timing"],delta:number,mode:TimingEdit,limit:number):TimelineText["timing"]{
  const {startFrame,endFrame}=timing;
  if(mode==="end"){const end=Math.min(limit,Math.max(startFrame+1,endFrame+delta));return end===endFrame||end<=startFrame?timing:{startFrame,endFrame:end};}
  const length=endFrame-startFrame,maxStart=limit-length;if(maxStart<0)return timing;
  const start=Math.min(maxStart,Math.max(0,startFrame+delta));return start===startFrame?timing:{startFrame:start,endFrame:start+length};
}
// Timeline keys (T-033 3.2.1, T-091 5장): what one key press does where. A clip key never seeks and the position bar
// never changes a text, so one key is one action (T-033 3.3 1-1).
type KeyInput={key:string;shiftKey:boolean;altKey:boolean;ctrlKey:boolean;metaKey:boolean};
export type ClipKeyAction={type:"move";mode:TimingEdit;delta:number}|{type:"locked"}|{type:"select";step:-1|1}|{type:"enter"}|{type:"toggle"}|{type:"cancel"}|{type:"dragging"};
// While a clip is being dragged only Esc works (it cancels the drag); the other clip keys wait, so a key never changes
// a text that the drag is about to set (T-093 F093-4).
const CLIP_KEYS=new Set(["Enter"," ","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]);
export function clipKeyAction(input:KeyInput,locked:boolean,dragging:boolean):ClipKeyAction|null{
  if(input.ctrlKey||input.metaKey)return null;
  if(input.key==="Escape")return dragging?{type:"cancel"}:null;
  if(dragging)return CLIP_KEYS.has(input.key)?{type:"dragging"}:null;
  if(input.key==="Enter")return {type:"enter"};
  if(input.key===" ")return {type:"toggle"};
  if(input.key==="ArrowUp"||input.key==="ArrowDown")return {type:"select",step:input.key==="ArrowUp"?-1:1};
  if(input.key!=="ArrowLeft"&&input.key!=="ArrowRight")return null;
  if(locked)return {type:"locked"};
  return {type:"move",mode:input.altKey?"end":"move",delta:(input.key==="ArrowLeft"?-1:1)*(input.shiftKey?FPS:1)};
}
export type BarKeyAction={type:"seek";frame:number}|{type:"toggle"};
export function barKeyAction(input:KeyInput,now:number,totalFrames:number):BarKeyAction|null{
  if(input.altKey||input.ctrlKey||input.metaKey)return null;if(input.key===" ")return {type:"toggle"};
  const step=input.shiftKey?FPS:1,target=input.key==="ArrowLeft"?now-step:input.key==="ArrowRight"?now+step:input.key==="Home"?0:input.key==="End"?totalFrames-1:null;
  return target===null?null:{type:"seek",frame:Math.min(totalFrames-1,Math.max(0,target))};
}
// Ruler ticks (T-091): every second, a label every 1/2/5/10 s (30/60 s for long videos) at least 48 px apart.
export function rulerSteps(totalFrames:number,widthPx:number){
  const seconds=Math.max(1,Math.ceil(totalFrames/FPS)),perSecond=widthPx/Math.max(1,totalFrames/FPS);
  const label=[1,2,5,10,30,60].find(step=>step*perSecond>=48)??120;
  return {seconds,label};
}

// The save of this screen arrived (T-093 F093-1): unchanged since sending → the saved version (as the server stored it)
// is the draft again; changed since sending → those later changes stay, as unsaved changes on top of the new version.
export function afterSave(current:Timeline,sent:Timeline,saved:Timeline):{draft:Timeline;kept:boolean}{
  const kept=canonicalJson(current)!==canonicalJson(sent);return {draft:kept?current:saved,kept};
}
// What was changed after a save was sent (T-096 F096-1, T-098): listed for the person when the version that came back
// is not this save's, never put into that version. Texts in the order of the newer draft; removed texts after them.
// Every field counts (words, time, look, box, motion, ...); the full data goes into the recovery file below.
export type TextPart="content"|"timing"|"style"|"box"|"animation"|"kind"|"locked"|"speakerCharacterId"|"other";
export const TEXT_PART_LABEL:Record<TextPart,string>={content:"문구",timing:"시간",style:"모양(글꼴·크기·색·외곽선·띠·그림자)",box:"위치",animation:"움직임",kind:"종류",locked:"잠금",speakerCharacterId:"말하는 사람",other:"그 밖의 설정"};
export type LaterChange={id:string;change:"changed"|"added"|"removed";kind:TextKind;content:string;timing:TimelineText["timing"];parts:TextPart[]};
export type LaterChanges={texts:LaterChange[];order:boolean;textOrder:boolean;other:boolean};
function changedParts(a:TimelineText,b:TimelineText):TextPart[]{
  const keys=new Set([...Object.keys(a),...Object.keys(b)]),parts=new Set<TextPart>();
  for(const key of keys){if(key==="id")continue;const x=(a as Record<string,unknown>)[key],y=(b as Record<string,unknown>)[key];
    if(canonicalJson(x??null)===canonicalJson(y??null))continue;parts.add(key in TEXT_PART_LABEL?key as TextPart:"other");}
  return [...parts];
}
export function laterChanges(sent:Timeline,later:Timeline):LaterChanges{
  const before=new Map(sent.text.map(layer=>[layer.id,layer])),now=new Set(later.text.map(layer=>layer.id)),texts:LaterChange[]=[];
  for(const layer of later.text){const old=before.get(layer.id);const parts=old?changedParts(old,layer):[];if(old&&!parts.length)continue;
    texts.push({id:layer.id,change:old?"changed":"added",kind:layer.kind,content:layer.content,timing:layer.timing,parts});}
  for(const layer of sent.text)if(!now.has(layer.id))texts.push({id:layer.id,change:"removed",kind:layer.kind,content:layer.content,timing:layer.timing,parts:[]});
  const kept=(timeline:Timeline)=>timeline.text.filter(layer=>before.has(layer.id)&&now.has(layer.id)).map(layer=>layer.id).join("\n");
  const rest=(timeline:Timeline)=>canonicalJson({...timeline,text:null,video:null});
  return {texts,order:canonicalJson(sent.video)!==canonicalJson(later.video),textOrder:kept(sent)!==kept(later),other:rest(sent)!==rest(later)};
}
export const hasLaterChanges=(changes:LaterChanges)=>changes.texts.length>0||changes.order||changes.textOrder||changes.other;
// The recovery file (T-098): everything this screen had when a newer version from elsewhere came back, so nothing typed
// is lost. It is only shown, copied or downloaded by the person; the app never saves or applies it.
type VersionRef={revision:number;timelineId:string|null;timelineRevision:number|null};
export type RecoveryInput={projectId:string;createdAt:string;sentFrom:VersionRef;ownSave:{revision:number;timelineId:string;timelineRevision:number|null};
  shown:VersionRef;sent:Timeline;draft:Timeline;timeFields:Readonly<Record<string,{raw:string;error:string}>>;selectedTextId:string|null;selectedAtSend:string|null;
  // T-149: sound fields typed but not valid yet ("<clipId>:<field>") and the chosen sound, when the screen had them.
  audioFields?:Readonly<Record<string,{raw:string;error:string}>>;selectedAudioId?:string|null;selectedAudioAtSend?:string|null};
export function recoveryJson(input:RecoveryInput):string{
  return JSON.stringify({format:"dream-ai-studio.timeline-recovery",version:1,
    note:"저장하는 동안 다른 창에서 더 새 버전을 저장해서, 저장을 보낸 뒤 고친 내용을 그 버전에 넣지 않았어요. draft가 이 화면의 마지막 내용 전체예요. 앱은 이 파일을 저장하거나 적용하지 않아요.",
    ...input},null,2)+"\n";
}
// Typed time fields ("<id>:start" / "<id>:end") count only for texts that are still there (T-093 F093-3A).
export function liveTimeFields<T>(fields:Readonly<Record<string,T>>,texts:readonly {id:string}[]):Record<string,T>{
  const ids=new Set(texts.map(text=>text.id));return Object.fromEntries(Object.entries(fields).filter(([key])=>ids.has(key.split(":")[0])));
}
// Recovery file name (T-098, design): dream-timeline-recovery-r{sent from}-to-r{shown}-{YYYYMMDD-HHmm}.json, local time.
export function recoveryFileName(from:number|null,to:number|null,at:Date):string{
  const two=(n:number)=>String(n).padStart(2,"0"),stamp=`${at.getFullYear()}${two(at.getMonth()+1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`;
  return `dream-timeline-recovery-r${from??"new"}-to-r${to??"new"}-${stamp}.json`;
}
