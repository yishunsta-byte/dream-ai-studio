// P2-4 subtitle boundary measurement (T-127, PLAN 18장 P2 종료 기준, T-057 검증 방법).
//
// Error = |shown boundary − expected boundary|, where the expected boundary is the manually chosen cue time (seconds)
// turned into 30 fps timeline frames by the product rule (secondsToFrames), and "shown" is
//   ① the SRT boundary the product writes (timelineSrt), and
//   ② the first/last frame where the cue is actually visible in a real render of a virtual test video
//      (render child + composition + pinned browser, the same path the worker uses), found by reading pixels.
// Pass: every maximum absolute error ≤ 0.2 s. VTT is not produced by the product (recorded as not implemented). The
// meaning-level sync with a voice and playback on a real phone are not measured here.
//
// Pixel rule: each cue has its own horizontal band (ROI) on a solid, non-white background; a reference strip at the
// band's left edge (never covered by text) gives the background colour of that frame; a pixel "differs" when its
// largest channel difference from that colour is above THRESHOLD; a frame shows the cue when at least MIN_PIXELS
// differ. A control band that no cue ever enters must show nothing (no false positive).
//
// Usage (repository root):
//   node --conditions=react-server --import tsx scripts/remotion/measure-subtitle.ts [--out <file.json>] [--keep]
// Only OS temp files are written besides --out; nothing in data/ or storage/ is read or written.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

export const FPS=30;
export const LIMIT_SEC=0.2;
export const THRESHOLD=48;
export const MIN_PIXELS=40;
export type Rect={x:number;y:number;w:number;h:number};
export type Band={id:string;roi:Rect;ref:Rect};
export type CueSpec={id:string;label:string;animation:"none"|"fade"|"typewriter";startSec:number;endSec:number;y:number;content:string};
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
  const half=Math.round(height*0.07),top=Math.max(0,Math.round(height*y)-half);
  return {id,roi:{x:Math.round(width*0.2),y:top,w:Math.round(width*0.6),h:half*2},ref:{x:Math.round(width*0.02),y:top,w:Math.round(width*0.03),h:half*2}};
}

// Frame-by-frame count of differing pixels per band, read from the decoded video (rgb24, full size).
export async function bandCounts(ffmpeg:string,file:string,width:number,height:number,bands:Band[],threshold=THRESHOLD){
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
  return {frames,counts};
}

// Shown frames → first and last (null when never shown); every separate run is reported too.
export function detect(counts:number[],minPixels=MIN_PIXELS){
  const shown=counts.map(count=>count>=minPixels),runs:[number,number][]=[];
  shown.forEach((on,frame)=>{if(!on)return;const last=runs.at(-1);if(last&&last[1]===frame-1)last[1]=frame;else runs.push([frame,frame]);});
  return {first:runs[0]?.[0]??null,last:runs.at(-1)?.[1]??null,runs,shownFrames:shown.filter(Boolean).length,peak:Math.max(0,...counts)};
}
const round=(value:number)=>Math.round(value*1000)/1000;
// One cue: expected [startFrame, endFrame) against the detected first shown frame and (last shown frame + 1).
export function score(cue:{startSec:number;endSec:number},detected:{first:number|null;last:number|null}){
  const startFrame=secondsToFrames(cue.startSec),endFrame=secondsToFrames(cue.endSec);
  if(detected.first===null||detected.last===null)return {startFrame,endFrame,detectedStartFrame:null,detectedEndFrame:null,startErrorSec:null,endErrorSec:null,maxErrorSec:null,errorVsManualSec:null,pass:false};
  const shownStart=detected.first,shownEnd=detected.last+1;
  const startErrorSec=round(Math.abs(shownStart-startFrame)/FPS),endErrorSec=round(Math.abs(shownEnd-endFrame)/FPS),maxErrorSec=Math.max(startErrorSec,endErrorSec);
  return {startFrame,endFrame,detectedStartFrame:shownStart,detectedEndFrame:shownEnd,detectedStartSec:round(shownStart/FPS),detectedEndSec:round(shownEnd/FPS),startErrorSec,endErrorSec,maxErrorSec,
    errorVsManualSec:round(Math.max(Math.abs(shownStart/FPS-cue.startSec),Math.abs(shownEnd/FPS-cue.endSec))),pass:maxErrorSec<=LIMIT_SEC};
}
// SRT text → {startMs, endMs, text}[] (the product writes HH:MM:SS,mmm, sorted by start; matched to cues by text).
export function parseSrt(text:string){
  const ms=(value:string)=>{const [h,m,rest]=value.split(":");const [s,f]=rest.split(",");return ((Number(h)*60+Number(m))*60+Number(s))*1000+Number(f);};
  return [...text.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\r?\n([^\r\n]*)/g)].map(match=>({startMs:ms(match[1]),endMs:ms(match[2]),text:match[3]}));
}
export const sha256File=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");

// ───────────────────────────── real run ─────────────────────────────
async function main(){
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
  const args=process.argv.slice(2),outArg=args.indexOf("--out"),out=resolve(outArg>=0?args[outArg+1]:"tmp/t127-evidence/measure.json"),keep=args.includes("--keep");
  const app=resolve("."),ffmpeg=mediaBinary("ffmpeg"),work=mkdtempSync(join(tmpdir(),"dream-t127-measure-"));
  const browser=await checkBrowser({fresh:true});if(!browser.ok)throw new Error("pinned render browser is not installed (scripts/remotion/install-browser.ps1)");
  const font={family:"Pretendard",rel:"PretendardVariable.woff2",abs:join(app,"public/fonts/PretendardVariable.woff2")};
  const sha=compositionSourceSha256(),aspects=["9:16","16:9","1:1"] as const,results=[];
  // the copy of the frame rule must give the product's frames (every millisecond of the first 5 s)
  const sameFrames=Array.from({length:5001},(_,ms)=>ms/1000).every(value=>secondsToFrames(value)===timeline.secondsToFrames(value));
  for(const aspect of aspects){
    const size=PREVIEW_SIZE[aspect],dir=join(work,aspect.replace(":","x"));mkdirSync(dir,{recursive:true});
    // sources: a still image (scene 1, 0–2 s) and a video clip (scene 2, 2–4 s), both solid non-white colours
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
    if(!attempt.ok){results.push({aspect,render:{ok:false,code:attempt.code,detail:attempt.detail.slice(0,160)}});continue;}
    const verify=await verifyRender(output,{width:size.width,height:size.height,fps:30,frames:DURATION_FRAMES});
    const bands=[...CUES.map(cue=>band(cue.id,cue.y,size.width,size.height)),band("control",CONTROL_Y,size.width,size.height)];
    const read=await bandCounts(ffmpeg,output,size.width,size.height,bands);
    const cues=CUES.map((cue,index)=>{const found=detect(read.counts[index]);return {id:cue.id,label:cue.label,animation:cue.animation,manualStartSec:cue.startSec,manualEndSec:cue.endSec,roi:bands[index].roi,ref:bands[index].ref,
      runs:found.runs,peakPixels:found.peak,...score(cue,found)};});
    const control=detect(read.counts.at(-1)!);
    // sensitivity: the same frames read with other thresholds (a fade's last frames are faint; the verdict uses THRESHOLD)
    const sensitivity=[];
    for(const threshold of [16,32,96]){const other=await bandCounts(ffmpeg,output,size.width,size.height,bands,threshold);
      sensitivity.push({threshold,cues:CUES.map((cue,index)=>{const found=detect(other.counts[index]),scored=score(cue,found);return {id:cue.id,detectedStartFrame:scored.detectedStartFrame,detectedEndFrame:scored.detectedEndFrame,maxErrorSec:scored.maxErrorSec};}),controlShownFrames:detect(other.counts.at(-1)!).shownFrames});}
    // ① SRT the product writes from the same timeline text
    const srt=timeline.timelineSrt(text as never),srtCues=parseSrt(srt);
    const srtRows=CUES.map(cue=>{const found=srtCues.find(item=>item.text===cue.content);
      if(!found)return {id:cue.id,srtStartMs:null,srtEndMs:null,startErrorSec:null,endErrorSec:null,maxErrorSec:Infinity};const {startMs,endMs}=found;const startFrame=secondsToFrames(cue.startSec),endFrame=secondsToFrames(cue.endSec);
      const startErrorSec=round(Math.abs(startMs/1000-startFrame/FPS)),endErrorSec=round(Math.abs(endMs/1000-endFrame/FPS));return {id:cue.id,srtStartMs:startMs,srtEndMs:endMs,startErrorSec,endErrorSec,maxErrorSec:Math.max(startErrorSec,endErrorSec)};});
    const maxVideo=Math.max(...cues.map(cue=>cue.maxErrorSec??Infinity)),maxSrt=Math.max(...srtRows.map(row=>row.maxErrorSec));
    results.push({aspect,width:size.width,height:size.height,render:{ok:true,seconds:Math.round((Date.now()-started)/100)/10,descendantsLeft:(await descendants(child,started)).length},
      sources:{imageSha256:sha256File(png),videoSha256:sha256File(mp4),fontSha256:sha256File(font.abs)},output:{sha256:sha256File(output),sizeBytes:statSync(output).size,verify:verify.result,probe:verify.probe},
      read:{framesDecoded:read.frames,range:`0–${read.frames-1}`,threshold:THRESHOLD,minPixels:MIN_PIXELS},cues,control:{roi:bands.at(-1)!.roi,shownFrames:control.shownFrames,peakPixels:control.peak},sensitivity,
      srt:{rows:srtRows,maxErrorSec:maxSrt},maxVideoErrorSec:maxVideo,pass:maxVideo<=LIMIT_SEC&&maxSrt<=LIMIT_SEC&&control.shownFrames===0&&verify.result==="passed"});
    console.log(JSON.stringify({aspect,maxVideoErrorSec:maxVideo,maxSrtErrorSec:maxSrt,control:control.shownFrames,verify:verify.result,cues:cues.map(cue=>`${cue.id} ${cue.startFrame}-${cue.endFrame} → ${cue.detectedStartFrame}-${cue.detectedEndFrame}`)}));
  }
  const report={task:"T-127",measuredAt:new Date().toISOString(),definition:"expected = secondsToFrames(manual cue seconds) at 30 fps; shown = first visible frame, last visible frame + 1",limitSec:LIMIT_SEC,
    renderer:{remotion:REMOTION_VERSION,browser:browser.version,browserSha256:browser.sha256,compositionSourceSha256:sha,path:"render child + composition (lib/render/run.ts runRenderAttempt), no database"},
    secondsToFramesSameAsProduct:sameFrames,vtt:"not implemented in the product (not measured)",notMeasured:["voice / meaning-level sync","playback on a real phone","videos made by users (the screen keeps 측정 전)"],
    results,pass:results.length===3&&results.every(row=>"pass" in row&&row.pass)};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,out:out.replace(app,".")}));
  if(keep)console.log("kept work folder (OS temp)");else rmSync(work,{recursive:true,force:true});
}
if(/measure-subtitle\.ts$/.test(process.argv[1]??""))main().catch(error=>{console.error(error);process.exit(1);});
