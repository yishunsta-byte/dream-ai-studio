// P2-4 subtitle boundary measurement (T-127, PLAN 18장 P2 종료 기준, T-057 검증 방법; input checks T-129).
//
// Error = |shown boundary − expected boundary|, where the expected boundary is the manually chosen cue time (seconds)
// turned into 30 fps timeline frames by the product rule (secondsToFrames), and "shown" is
//   ① the SRT and WebVTT boundaries the product writes, and
//   ② the first/last frame where the cue is actually visible in a real render of a virtual test video
//      (render child + composition + pinned browser, the same path the worker uses), found by reading pixels.
// Pass: every maximum absolute error ≤ 0.2 s (6 frames). The meaning-level sync with a voice and playback on a real phone are not measured here.
//
// Pixel rule: each cue has its own horizontal band (ROI) on a solid, non-white background; a reference strip at the
// band's left edge (never covered by text) gives the background colour of that frame; a pixel "differs" when its
// largest channel difference from that colour is above THRESHOLD; a frame shows the cue when at least MIN_PIXELS
// differ. A control band that no cue ever enters must show nothing (no false positive).
// Scope (T-128): this is an image-difference detector for the fixed controlled matrix (solid backgrounds, known cue
// bands). It is not a text recognizer and not a calibrated human-visibility measure: any object with enough contrast
// in a cue band counts as "shown". Its PASS covers only the fixed 3-aspect, 4-cue matrix at THRESHOLD/MIN_PIXELS; with
// threshold 96 the fade cue's end is 7/30 s early (FAIL), kept in the sensitivity rows.
//
// Exit status: 0 = every check passed; 1 = the measurement ran and failed (report.pass false) or a runtime error;
// 2 = invalid command line or measurement input (nothing was judged). Automation must not read 0 from a failed run.
//
// Usage (repository root):
//   node --conditions=react-server --import tsx scripts/remotion/measure-subtitle.ts [--out <file.json>] [--keep]
// Only OS temp files are written besides --out; nothing in data/ or storage/ is read or written.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

export const USAGE="usage: measure-subtitle.ts [--out <file.json>] [--keep]";
export const FPS=30;
export const LIMIT_SEC=0.2;
export const LIMIT_FRAMES=Math.round(LIMIT_SEC*FPS);
export const THRESHOLD=48;
export const MIN_PIXELS=40;
export const EXIT={pass:0,fail:1,invalid:2} as const;
export type Rect={x:number;y:number;w:number;h:number};
export type Band={id:string;roi:Rect;ref:Rect};
export type CueSpec={id:string;label:string;animation:"none"|"fade"|"typewriter";startSec:number;endSec:number;y:number;content:string};

// Invalid input (size, rectangle, threshold, minimum, frame data, command line): never read as "nothing shown".
export class MeasureInputError extends Error{constructor(message:string){super(message);this.name="MeasureInputError";}}
const safeInt=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value);
export function assertFrameSize(width:number,height:number){
  if(!safeInt(width)||!safeInt(height)||width<=0||height<=0)throw new MeasureInputError(`frame size must be positive integers (${width}x${height})`);
  if(width*height*3>512*1024*1024)throw new MeasureInputError(`frame too large (${width}x${height})`);
}
// A rectangle inside the frame: integers, not empty, no part outside (a row must never wrap into the next one).
export function assertRect(rect:Rect,width:number,height:number,name:string){
  const {x,y,w,h}=rect??({} as Partial<Rect>);
  if(![x,y,w,h].every(safeInt))throw new MeasureInputError(`${name}: rectangle values must be integers`);
  if(x<0||y<0||w<=0||h<=0||x+w>width||y+h>height)throw new MeasureInputError(`${name}: rectangle ${x},${y},${w}x${h} is empty or outside ${width}x${height}`);
}
// A pixel differs when its largest channel difference is ABOVE the threshold: 0…254 (255 can never be exceeded).
export function assertThreshold(threshold:number){if(!safeInt(threshold)||threshold<0||threshold>254)throw new MeasureInputError(`threshold must be an integer 0-254 (${threshold})`);}
export function assertMinPixels(minPixels:number){if(!safeInt(minPixels)||minPixels<1)throw new MeasureInputError(`minimum pixels must be a positive integer (${minPixels})`);}
// --out <file> (once, a value that is not another option) and --keep (once); anything else is rejected.
export function parseArgs(argv:readonly string[]){
  let out:string|null=null,keep=false;
  for(let index=0;index<argv.length;index++){
    const arg=argv[index];
    if(arg==="--out"){const value=argv[index+1];if(out!==null)throw new MeasureInputError("--out given twice");
      if(value===undefined||value===""||value.startsWith("--"))throw new MeasureInputError("--out needs a file path");out=value;index++;}
    else if(arg==="--keep"){if(keep)throw new MeasureInputError("--keep given twice");keep=true;}
    else throw new MeasureInputError(`unknown argument: ${arg}`);
  }
  return {out,keep};
}

// spec secondsToFrames (lib/edit/timeline.ts): round(seconds × 30) on whole milliseconds, 0.5 up. Kept identical here so
// the measurement needs no product import; a test checks both give the same frames.
export function secondsToFrames(seconds:number){const ms=Math.round(seconds*1000);return Math.floor((ms*FPS+500)/1000);}

// Fixed virtual cues: start/end times not on frame boundaries, one crossing the image → video cut at 2.0 s.
export const CUES:CueSpec[]=[
  {id:"c1",label:"애니메이션 없음",animation:"none",startSec:0.37,endSec:1.52,y:0.14,content:"첫 자막 시험"},
  {id:"c2",label:"애니메이션 없음·장면 경계 걸침",animation:"none",startSec:1.71,endSec:3.08,y:0.32,content:"둘째 자막 시험"},
  {id:"c3",label:"페이드 들어옴·나감",animation:"fade",startSec:0.55,endSec:2.43,y:0.5,content:"페이드 자막"},
  {id:"c4",label:"타자기",animation:"typewriter",startSec:1.18,endSec:3.61,y:0.68,content:"한 글자씩 나와요"},
];
export const CONTROL_Y=0.88;
export const DURATION_FRAMES=120;

// Band around a text centre y (fraction of height): ±7 % of the height, x from 20 % to 80 %; reference strip at 2–5 %.
export function band(id:string,y:number,width:number,height:number):Band{
  assertFrameSize(width,height);
  if(typeof y!=="number"||!Number.isFinite(y)||y<=0||y>=1)throw new MeasureInputError(`${id}: band centre must be inside (0, 1)`);
  const half=Math.round(height*0.07),top=Math.max(0,Math.round(height*y)-half);
  const value={id,roi:{x:Math.round(width*0.2),y:top,w:Math.round(width*0.6),h:half*2},ref:{x:Math.round(width*0.02),y:top,w:Math.round(width*0.03),h:half*2}};
  assertRect(value.roi,width,height,`${id} roi`);assertRect(value.ref,width,height,`${id} reference`);
  return value;
}

// Frame-by-frame count of differing pixels per band, read from the decoded video (rgb24, full size). The decoded
// stream must be whole frames (no bytes left over) and, when given, exactly expectedFrames of them.
export async function bandCounts(ffmpeg:string,file:string,width:number,height:number,bands:Band[],threshold=THRESHOLD,expectedFrames?:number){
  assertFrameSize(width,height);assertThreshold(threshold);
  if(!Array.isArray(bands)||bands.length===0)throw new MeasureInputError("at least one band is needed");
  for(const item of bands){assertRect(item.roi,width,height,`${item.id} roi`);assertRect(item.ref,width,height,`${item.id} reference`);}
  if(expectedFrames!==undefined&&(!safeInt(expectedFrames)||expectedFrames<1))throw new MeasureInputError(`expected frames must be a positive integer (${expectedFrames})`);
  const frameBytes=width*height*3,counts=bands.map(()=>[] as number[]);let buffer=Buffer.alloc(0),frames=0;
  const measure=(frame:Buffer)=>{
    bands.forEach((item,index)=>{
      const rs:number[]=[],gs:number[]=[],bs:number[]=[];
      for(let y=item.ref.y;y<item.ref.y+item.ref.h;y+=2)for(let x=item.ref.x;x<item.ref.x+item.ref.w;x+=2){const at=(y*width+x)*3;rs.push(frame[at]);gs.push(frame[at+1]);bs.push(frame[at+2]);}
      const median=(values:number[])=>values.sort((a,b)=>a-b)[values.length>>1];const r=median(rs),g=median(gs),b=median(bs);
      let count=0;
      for(let y=item.roi.y;y<item.roi.y+item.roi.h;y++){let at=(y*width+item.roi.x)*3;for(let x=0;x<item.roi.w;x++,at+=3){
        if(Math.max(Math.abs(frame[at]-r),Math.abs(frame[at+1]-g),Math.abs(frame[at+2]-b))>threshold)count++;}}
      counts[index].push(count);
    });
  };
  await new Promise<void>((done,fail)=>{
    const child=spawn(ffmpeg,["-v","error","-i",file,"-f","rawvideo","-pix_fmt","rgb24","-"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let err="";child.stderr.on("data",chunk=>{err+=String(chunk);});
    child.stdout.on("data",(chunk:Buffer)=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=frameBytes){measure(buffer.subarray(0,frameBytes));buffer=buffer.subarray(frameBytes);frames++;}});
    child.on("error",fail);child.on("close",code=>code===0?done():fail(new Error(`ffmpeg ${code}: ${err.slice(0,200)}`)));
  });
  if(buffer.length!==0)throw new MeasureInputError(`decoded data is not whole ${width}x${height} frames (${buffer.length} bytes left over): wrong size`);
  if(frames===0)throw new MeasureInputError("no frame was decoded");
  if(expectedFrames!==undefined&&frames!==expectedFrames)throw new MeasureInputError(`decoded ${frames} frames, expected ${expectedFrames}`);
  return {frames,counts};
}

// Shown frames → first and last (null when never shown); every separate run is reported too.
export function detect(counts:number[],minPixels=MIN_PIXELS){
  assertMinPixels(minPixels);
  if(!Array.isArray(counts)||counts.some(count=>!safeInt(count)||count<0))throw new MeasureInputError("counts must be non-negative integers");
  const shown=counts.map(count=>count>=minPixels),runs:[number,number][]=[];
  shown.forEach((on,frame)=>{if(!on)return;const last=runs.at(-1);if(last&&last[1]===frame-1)last[1]=frame;else runs.push([frame,frame]);});
  return {first:runs[0]?.[0]??null,last:runs.at(-1)?.[1]??null,runs,shownFrames:shown.filter(Boolean).length,peak:Math.max(0,...counts)};
}
const round=(value:number)=>Math.round(value*1000)/1000;
// One cue: expected [startFrame, endFrame) against the detected first shown frame and (last shown frame + 1).
// Errors are whole frames (exact); seconds are shown rounded to 1 ms; the verdict compares frames (0.2 s = 6 frames).
export function score(cue:{startSec:number;endSec:number},detected:{first:number|null;last:number|null}){
  if(![cue?.startSec,cue?.endSec].every(value=>typeof value==="number"&&Number.isFinite(value)&&value>=0)||cue.endSec<=cue.startSec)throw new MeasureInputError("cue times must be finite, >= 0, and end after start");
  const {first,last}=detected;
  if((first===null)!==(last===null)||(first!==null&&last!==null&&(!safeInt(first)||!safeInt(last)||first<0||last<first)))throw new MeasureInputError("detected frames must be both null or 0 <= first <= last");
  const startFrame=secondsToFrames(cue.startSec),endFrame=secondsToFrames(cue.endSec);
  if(first===null||last===null)return {startFrame,endFrame,detectedStartFrame:null,detectedEndFrame:null,startErrorFrames:null,endErrorFrames:null,maxErrorFrames:null,startErrorSec:null,endErrorSec:null,maxErrorSec:null,errorVsManualSec:null,pass:false};
  const shownStart=first,shownEnd=last+1;
  const startErrorFrames=Math.abs(shownStart-startFrame),endErrorFrames=Math.abs(shownEnd-endFrame),maxErrorFrames=Math.max(startErrorFrames,endErrorFrames);
  const startErrorSec=round(startErrorFrames/FPS),endErrorSec=round(endErrorFrames/FPS),maxErrorSec=Math.max(startErrorSec,endErrorSec);
  return {startFrame,endFrame,detectedStartFrame:shownStart,detectedEndFrame:shownEnd,detectedStartSec:round(shownStart/FPS),detectedEndSec:round(shownEnd/FPS),startErrorFrames,endErrorFrames,maxErrorFrames,startErrorSec,endErrorSec,maxErrorSec,
    errorVsManualSec:round(Math.max(Math.abs(shownStart/FPS-cue.startSec),Math.abs(shownEnd/FPS-cue.endSec))),pass:maxErrorFrames<=LIMIT_FRAMES};
}
// SRT exact error against frames: SRT keeps whole milliseconds and a frame is 33.33… ms, so up to 1/3000 s remains.
export function srtErrorSec(ms:number,frame:number){return Math.abs(ms*FPS-frame*1000)/(1000*FPS);}
// SRT text → {startMs, endMs, text}[] (the product writes HH:MM:SS,mmm, sorted by start; matched to cues by their
// unique one-line text — enough for this fixed matrix, not a general SRT parser).
export function parseSrt(text:string){
  const ms=(value:string)=>{const [h,m,rest]=value.split(":");const [s,f]=rest.split(",");return ((Number(h)*60+Number(m))*60+Number(s))*1000+Number(f);};
  return [...text.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\r?\n([^\r\n]*)/g)].map(match=>({startMs:ms(match[1]),endMs:ms(match[2]),text:match[3]}));
}
// Measure the product's single-line WebVTT fixture by layer ID against the manual cues.
export function measureVtt(source:string|null, layerIds:readonly string[]){
  const blocks=(source??"").trimEnd().split("\n\n");
  const header=blocks.shift();
  const byId=new Map<string,{startMs:number;endMs:number;text:string}>();
  const stamp=(value:string)=>{
    const match=/^(\d{2}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
    return match ? ((Number(match[1])*60+Number(match[2]))*60+Number(match[3]))*1000+Number(match[4]) : NaN;
  };
  for(const block of blocks){
    const lines=block.split("\n");
    const bounds=lines[1]?.split(" --> ");
    if(lines.length!==3||bounds?.length!==2)continue;
    const startMs=stamp(bounds[0]),endMs=stamp(bounds[1]);
    if(endMs>startMs)byId.set(lines[0],{startMs,endMs,text:lines[2]});
  }
  const rows=CUES.map((cue,index)=>{
    const found=byId.get(layerIds[index]);
    if(!found||found.text!==cue.content)return {id:cue.id,maxErrorSec:null};
    const startErrorSec=srtErrorSec(found.startMs,secondsToFrames(cue.startSec));
    const endErrorSec=srtErrorSec(found.endMs,secondsToFrames(cue.endSec));
    return {id:cue.id,startMs:found.startMs,endMs:found.endMs,startErrorSec,endErrorSec,maxErrorSec:Math.max(startErrorSec,endErrorSec)};
  });
  const complete=header==="WEBVTT"&&blocks.length===CUES.length&&rows.every(row=>row.maxErrorSec!==null);
  const maxErrorSec=complete?Math.max(...rows.map(row=>row.maxErrorSec!)):null;
  return {rows,maxErrorSec,pass:maxErrorSec!==null&&maxErrorSec<=LIMIT_SEC};
}
export const sha256File=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");

// ───────────────────────────── real run ─────────────────────────────
async function main(argv:readonly string[]){
  const options=parseArgs(argv);// before anything is generated or rendered
  const {execFileSync}=await import("node:child_process");
  const {mkdirSync,mkdtempSync,rmSync,writeFileSync,statSync}=await import("node:fs");
  const {tmpdir}=await import("node:os");const {join,resolve,dirname}=await import("node:path");
  const {mediaBinary}=await import("@/lib/media/tools");
  const {startFileServer}=await import("@/lib/render/file-server");
  const {renderProps}=await import("@/lib/render/props");
  const {runRenderAttempt,descendants}=await import("@/lib/render/run");
  const {verifyRender}=await import("@/lib/render/verify");
  const {checkBrowser,compositionSourceSha256,COMPOSITION_ID,REMOTION_VERSION}=await import("@/lib/render/tools");
  const {PREVIEW_SIZE}=await import("@/lib/edit/preview");
  const timeline=await import("@/lib/edit/timeline");
  const out=resolve(options.out??"tmp/t127-evidence/measure.json"),keep=options.keep;
  const app=resolve("."),ffmpeg=mediaBinary("ffmpeg"),work=mkdtempSync(join(tmpdir(),"dream-t127-measure-"));
  // the work folder is removed on every exit (pass, fail, error) unless --keep
  try{return await measure();}finally{if(keep)console.log("kept work folder (OS temp)");else rmSync(work,{recursive:true,force:true});}
  async function measure(){
  const browser=await checkBrowser({fresh:true});if(!browser.ok)throw new Error("pinned render browser is not installed (scripts/remotion/install-browser.ps1)");
  const font={family:"Pretendard",rel:"PretendardVariable.woff2",abs:join(app,"public/fonts/PretendardVariable.woff2")};
  const sha=compositionSourceSha256(),aspects=["9:16","16:9","1:1"] as const,results=[];
  // the copy of the frame rule must give the product's frames (every millisecond of the first 5 s)
  const sameFrames=Array.from({length:5001},(_,ms)=>ms/1000).every(value=>secondsToFrames(value)===timeline.secondsToFrames(value));
  for(const aspect of aspects){
    const size=PREVIEW_SIZE[aspect],dir=join(work,aspect.replace(":","x"));mkdirSync(dir,{recursive:true});
    // sources: a still image (scene 1, 0–2 s) and a video clip (scene 2, 2–4 s), both solid non-white colours; the files
    // differ per aspect (own size), only the font file is shared
    const png=join(dir,"scene.png"),mp4=join(dir,"clip.mp4");
    execFileSync(ffmpeg,["-v","error","-f","lavfi","-i",`color=c=0x335577:s=${size.width}x${size.height}`,"-frames:v","1",png]);
    execFileSync(ffmpeg,["-v","error","-f","lavfi","-i",`color=c=0x6a4a2a:s=${size.width}x${size.height}:r=30`,"-frames:v","90","-c:v","libx264","-pix_fmt","yuv420p","-color_range","tv","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709",mp4]);
    const id=(n:number)=>`019b9127-0000-7000-8000-${String(n).padStart(12,"0")}`;
    const text=CUES.map((cue,n)=>({id:id(100+n),kind:"subtitle" as const,content:cue.content,speakerCharacterId:null,
      style:{fontFamily:"Pretendard" as const,fontSize:64,fontWeight:700,color:"#FFFFFF",stroke:{color:"#000000",width:3},shadow:null,background:null,align:"center" as const,letterSpacing:0,lineHeight:1.2,maxLines:1},
      box:{x:0.5,y:cue.y,anchor:"center" as const,widthRatio:0.6,rotation:0},timing:{startFrame:secondsToFrames(cue.startSec),endFrame:secondsToFrames(cue.endSec)},
      animation:{in:cue.animation,out:cue.animation==="fade"?"fade" as const:"none" as const,emphasis:"none" as const,durationFrames:10,easing:"ease-out" as const},locked:false}));
    const input={timeline:{aspect,video:[{id:id(1),sceneId:id(2),sceneVersionId:id(3),assetId:id(4),durationFrames:60,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}},
      {id:id(5),sceneId:id(6),sceneVersionId:id(7),assetId:id(8),durationFrames:60,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}}],text},
      output:{width:size.width,height:size.height},durationInFrames:DURATION_FRAMES,videoFrames:DURATION_FRAMES,
      media:[{assetId:id(4),kind:"image"},{assetId:id(8),kind:"video"}],fonts:[{family:font.family,relPath:font.rel,weightMin:100,weightMax:900}]};
    const served=(path:string,mime:string)=>({absolute:path,mime,sizeBytes:statSync(path).size});
    const server=await startFileServer([served(png,"image/png"),served(mp4,"video/mp4")],[served(font.abs,"font/woff2")]);
    const output=join(dir,"render.mp4"),started=Date.now();let child=0;
    const attempt=await runRenderAttempt({appRoot:app,bundleRoot:join(work,"bundles"),sourceSha256:sha,workBundle:join(dir,"bundle"),fileBase:server.base,browserPath:browser.path,output,compositionId:COMPOSITION_ID,
      props:renderProps(input as never,{media:server.mediaUrl,font:server.fontUrl}),tempDir:(mkdirSync(join(dir,"os-tmp"),{recursive:true}),join(dir,"os-tmp")),onChild:pid=>{child=pid;}});
    await server.close();
    if(!attempt.ok){results.push({aspect,render:{ok:false,code:attempt.code,detail:attempt.detail.slice(0,160)},pass:false});continue;}
    const verify=await verifyRender(output,{width:size.width,height:size.height,fps:30,frames:DURATION_FRAMES});
    const bands=[...CUES.map(cue=>band(cue.id,cue.y,size.width,size.height)),band("control",CONTROL_Y,size.width,size.height)];
    const read=await bandCounts(ffmpeg,output,size.width,size.height,bands,THRESHOLD,DURATION_FRAMES);
    const cues=CUES.map((cue,index)=>{const found=detect(read.counts[index]);return {id:cue.id,label:cue.label,animation:cue.animation,manualStartSec:cue.startSec,manualEndSec:cue.endSec,roi:bands[index].roi,ref:bands[index].ref,
      runs:found.runs,peakPixels:found.peak,...score(cue,found)};});
    const control=detect(read.counts.at(-1)!);
    // sensitivity: the same frames read with other thresholds (a fade's last frames are faint; the verdict uses THRESHOLD)
    const sensitivity=[];
    for(const threshold of [16,32,96]){const other=await bandCounts(ffmpeg,output,size.width,size.height,bands,threshold,DURATION_FRAMES);
      sensitivity.push({threshold,cues:CUES.map((cue,index)=>{const found=detect(other.counts[index]),scored=score(cue,found);return {id:cue.id,detectedStartFrame:scored.detectedStartFrame,detectedEndFrame:scored.detectedEndFrame,maxErrorFrames:scored.maxErrorFrames,maxErrorSec:scored.maxErrorSec,pass:scored.pass};}),controlShownFrames:detect(other.counts.at(-1)!).shownFrames});}
    // ① SRT the product writes from the same timeline text
    const srt=timeline.timelineSrt(text),srtCues=parseSrt(srt);
    const srtRows=CUES.map(cue=>{const found=srtCues.find(item=>item.text===cue.content);
      if(!found)return {id:cue.id,srtStartMs:null,srtEndMs:null,startErrorSec:null,endErrorSec:null,maxErrorSec:Infinity,maxErrorSecDisplay:null};
      const startFrame=secondsToFrames(cue.startSec),endFrame=secondsToFrames(cue.endSec),startErrorSec=srtErrorSec(found.startMs,startFrame),endErrorSec=srtErrorSec(found.endMs,endFrame),maxErrorSec=Math.max(startErrorSec,endErrorSec);
      return {id:cue.id,srtStartMs:found.startMs,srtEndMs:found.endMs,startErrorSec,endErrorSec,maxErrorSec,maxErrorSecDisplay:round(maxErrorSec)};});
    const vtt=measureVtt(timeline.timelineVtt(text),text.map(layer=>layer.id));
    const maxVideo=Math.max(...cues.map(cue=>cue.maxErrorSec??Infinity)),maxVideoFrames=Math.max(...cues.map(cue=>cue.maxErrorFrames??Infinity)),maxSrt=Math.max(...srtRows.map(row=>row.maxErrorSec));
    results.push({aspect,width:size.width,height:size.height,render:{ok:true,seconds:Math.round((Date.now()-started)/100)/10,descendantsLeft:(await descendants(child,started)).length},
      sources:{imageSha256:sha256File(png),videoSha256:sha256File(mp4),fontSha256:sha256File(font.abs)},output:{sha256:sha256File(output),sizeBytes:statSync(output).size,verify:verify.result,probe:verify.probe},
      read:{framesDecoded:read.frames,range:`0-${read.frames-1}`,threshold:THRESHOLD,minPixels:MIN_PIXELS},cues,control:{roi:bands.at(-1)!.roi,shownFrames:control.shownFrames,peakPixels:control.peak},sensitivity,
      vtt,srt:{rows:srtRows,maxErrorSec:maxSrt,maxErrorSecDisplay:round(maxSrt)},maxVideoErrorSec:maxVideo,maxVideoErrorFrames:maxVideoFrames,
      pass:vtt.pass&&cues.every(cue=>cue.pass)&&maxSrt<=LIMIT_SEC&&control.shownFrames===0&&verify.result==="passed"});
    console.log(JSON.stringify({aspect,maxVideoErrorFrames:maxVideoFrames,maxVideoErrorSec:maxVideo,maxSrtErrorSec:maxSrt,maxVttErrorSec:vtt.maxErrorSec,control:control.shownFrames,verify:verify.result,cues:cues.map(cue=>`${cue.id} ${cue.startFrame}-${cue.endFrame} -> ${cue.detectedStartFrame}-${cue.detectedEndFrame}`)}));
  }
  const report={task:"T-127/T-129",measuredAt:new Date().toISOString(),definition:"expected = secondsToFrames(manual cue seconds) at 30 fps; shown = first visible frame, last visible frame + 1",limitSec:LIMIT_SEC,limitFrames:LIMIT_FRAMES,
    detector:"image difference in fixed bands on solid backgrounds; not a text recognizer, not a human-visibility measure",
    renderer:{remotion:REMOTION_VERSION,browser:browser.version,browserSha256:browser.sha256,compositionSourceSha256:sha,path:"render child + composition (lib/render/run.ts runRenderAttempt), no database"},
    secondsToFramesSameAsProduct:sameFrames,notMeasured:["voice / meaning-level sync","playback on a real phone","videos made by users (the screen keeps 측정 전)"],
    results,pass:sameFrames&&results.length===3&&results.every(row=>row.pass===true)};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,out:out.replace(app,".")}));
  return report.pass;
  }
}
if(/measure-subtitle\.ts$/.test(process.argv[1]??""))main(process.argv.slice(2)).then(pass=>{process.exitCode=pass?EXIT.pass:EXIT.fail;},error=>{
  if(error instanceof MeasureInputError){console.error(`${error.message}\n${USAGE}`);process.exitCode=EXIT.invalid;return;}
  console.error(error);process.exitCode=EXIT.fail;});
