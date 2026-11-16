// T-127 measurement check on its own synthetic videos (OS temp folder): the pixel reader finds exactly the frames a
// box is drawn on (across a background colour change), a 1-frame shift stays inside 0.2 s and a 7-frame shift is
// reported as a failure, a band nothing enters reads 0 frames (no false positive), and a near-background change below
// the threshold is not counted. Also: the frame rule copy equals the product's, and the SRT parser reads the product SRT.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { mediaBinary } from "@/lib/media/tools";
import { secondsToFrames as productFrames, timelineSrt, type TimelineText } from "@/lib/edit/timeline";
import { band, bandCounts, CUES, detect, LIMIT_SEC, parseSrt, score, secondsToFrames } from "@/scripts/remotion/measure-subtitle";

const W=640,H=360;let dir:string;const ffmpeg=mediaBinary("ffmpeg");
// background 0x335577 then 0x6a4a2a from frame 60 (like the image → video cut); a white box on frames [from, to]
function video(name:string,boxes:{from:number;to:number;color?:string;y?:number}[]){
  const file=join(dir,`${name}.mp4`),filters=[`color=c=0x335577:s=${W}x${H}:r=30`,"drawbox=x=0:y=0:w=iw:h=ih:color=0x6a4a2a:t=fill:enable='gte(n,60)'",
    ...boxes.map(box=>`drawbox=x=200:y=${box.y??150}:w=200:h=40:color=${box.color??"white"}:t=fill:enable='between(n,${box.from},${box.to})'`)];
  execFileSync(ffmpeg,["-v","error","-f","lavfi","-i",filters.join(","),"-frames:v","120","-c:v","libx264","-pix_fmt","yuv420p","-crf","18",file]);return file;
}
const cueBand=band("cue",170/H,W,H),controlBand=band("control",0.88,W,H);
beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),"dream-t127-check-"));});
afterAll(()=>{rmSync(dir,{recursive:true,force:true});});

describe("측정 규칙",()=>{
  it("초→프레임은 제품 규칙과 같다(0~5초의 모든 밀리초)",()=>{
    for(let ms=0;ms<=5000;ms++)expect(secondsToFrames(ms/1000)).toBe(productFrames(ms/1000));
    expect(CUES.map(cue=>[secondsToFrames(cue.startSec),secondsToFrames(cue.endSec)])).toEqual([[11,46],[51,92],[17,73],[35,108]]);
  });
  it("표시 끝은 마지막 보인 프레임+1, 오차는 30fps 프레임 기대값 대비",()=>{
    expect(score({startSec:0.37,endSec:1.52},{first:11,last:45})).toMatchObject({startFrame:11,endFrame:46,detectedStartFrame:11,detectedEndFrame:46,maxErrorSec:0,pass:true});
    expect(score({startSec:0.37,endSec:1.52},{first:12,last:45}).maxErrorSec).toBe(0.033);
    expect(score({startSec:0.37,endSec:1.52},{first:17,last:45})).toMatchObject({maxErrorSec:0.2,pass:true});
    expect(score({startSec:0.37,endSec:1.52},{first:18,last:45})).toMatchObject({maxErrorSec:0.233,pass:false});
    expect(score({startSec:0.37,endSec:1.52},{first:null,last:null}).pass).toBe(false);expect(LIMIT_SEC).toBe(0.2);
  });
  it("제품 SRT를 읽어 글자로 짝짓는다(시작 순 정렬이어도)",()=>{
    const text=[{content:"뒤",timing:{startFrame:51,endFrame:92}},{content:"앞",timing:{startFrame:11,endFrame:46}}].map((item,n)=>({id:String(n),kind:"subtitle",...item})) as unknown as TimelineText[];
    expect(parseSrt(timelineSrt(text))).toEqual([{startMs:367,endMs:1533,text:"앞"},{startMs:1700,endMs:3067,text:"뒤"}]);
  });
});

describe("합성 영상으로 측정기 검증",()=>{
  it("그린 프레임을 정확히 찾고, 대조 띠는 0프레임",async()=>{
    const read=await bandCounts(ffmpeg,video("exact",[{from:11,to:45},{from:51,to:91,y:150}]),W,H,[cueBand,controlBand]);
    expect(read.frames).toBe(120);
    const found=detect(read.counts[0]);expect(found.runs).toEqual([[11,45],[51,91]]);
    expect(detect(read.counts[1]).shownFrames).toBe(0);
  },60000);
  it("1프레임 늦음은 0.033초로 통과, 7프레임 늦음은 0.233초로 실패",async()=>{
    const one=detect((await bandCounts(ffmpeg,video("shift1",[{from:12,to:46}]),W,H,[cueBand])).counts[0]);
    expect(score({startSec:0.37,endSec:1.52},one)).toMatchObject({detectedStartFrame:12,detectedEndFrame:47,maxErrorSec:0.033,pass:true});
    const seven=detect((await bandCounts(ffmpeg,video("shift7",[{from:18,to:52}]),W,H,[cueBand])).counts[0]);
    expect(score({startSec:0.37,endSec:1.52},seven)).toMatchObject({detectedStartFrame:18,detectedEndFrame:53,maxErrorSec:0.233,pass:false});
  },60000);
  it("배경과 거의 같은 색(임계값 아래)은 세지 않는다",async()=>{
    const read=await bandCounts(ffmpeg,video("faint",[{from:20,to:40,color:"0x3a5c7e"}]),W,H,[cueBand]);
    expect(detect(read.counts[0]).shownFrames).toBe(0);
  },60000);
});
