// T-127 measurement check on its own synthetic videos (OS temp folder): the pixel reader finds exactly the frames a
// box is drawn on (across a background colour change), a 1-frame shift stays inside 0.2 s and a 7-frame shift is
// reported as a failure, a band nothing enters reads 0 frames (no false positive), and a near-background change below
// the threshold is not counted. Also: the frame rule copy equals the product's, and the SRT parser reads the product SRT.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { mediaBinary } from "@/lib/media/tools";
import { secondsToFrames as productFrames, timelineSrt, type TimelineText } from "@/lib/edit/timeline";
import { assertRect, band, bandCounts, CUES, detect, EXIT, LIMIT_SEC, MeasureInputError, parseArgs, parseSrt, score, secondsToFrames, srtErrorSec } from "@/scripts/remotion/measure-subtitle";

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

// T-129: invalid input is rejected (never read as "nothing shown"), the command line is strict, a failed or invalid run
// does not exit 0, and the SRT error is reported exactly.
describe("입력 검증·종료 상태 (T-129)",()=>{
  const invalid=(fn:()=>unknown)=>expect(fn).toThrow(MeasureInputError);
  it("치수·띠 위치·사각형: 정수·양수·프레임 안만, 행 넘김 사각형 거부",()=>{
    for(const [w,h] of [[0,360],[640,0],[-640,360],[640.5,360],[Number.NaN,360],[640,Number.POSITIVE_INFINITY]])invalid(()=>band("x",0.5,w,h));
    for(const y of [0,1,-0.1,1.2,Number.NaN])invalid(()=>band("x",y,W,H));
    expect(band("x",0.5,W,H).roi).toEqual({x:128,y:155,w:384,h:50});
    for(const rect of [{x:840,y:164,w:200,h:30},{x:500,y:150,w:200,h:30},{x:0,y:340,w:10,h:30},{x:0,y:0,w:0,h:10},{x:-1,y:0,w:10,h:10},{x:0.5,y:0,w:10,h:10}])
      invalid(()=>assertRect(rect,W,H,"roi"));
    expect(()=>assertRect({x:0,y:0,w:W,h:H},W,H,"full")).not.toThrow();
  });
  it("임계값 0~254 정수, 최소 화소 1 이상 정수, 개수는 음 아닌 정수",async()=>{
    for(const threshold of [-1,255,256,1.5,Number.NaN])await expect(bandCounts(ffmpeg,"none.mp4",W,H,[cueBand],threshold)).rejects.toThrow(MeasureInputError);
    await expect(bandCounts(ffmpeg,"none.mp4",W,H,[])).rejects.toThrow(MeasureInputError);
    await expect(bandCounts(ffmpeg,"none.mp4",W,H,[{id:"wrap",roi:{x:540,y:150,w:200,h:30},ref:{x:0,y:150,w:10,h:30}}])).rejects.toThrow(/outside/);
    for(const minPixels of [0,-1,1.5,Number.NaN])invalid(()=>detect([0,0,0],minPixels));
    for(const counts of [[-1],[Number.NaN],[1.5]])invalid(()=>detect(counts));
    expect(detect([0,0,0],1).shownFrames).toBe(0);
  });
  it("프레임 바이트가 맞지 않거나 개수가 다르면 거부, 맞으면 읽는다",async()=>{
    const file=video("bytes",[{from:11,to:45}]);
    await expect(bandCounts(ffmpeg,file,W,H+1,[cueBand])).rejects.toThrow(/left over/);
    await expect(bandCounts(ffmpeg,file,W,H,[cueBand],48,119)).rejects.toThrow(/decoded 120 frames, expected 119/);
    expect((await bandCounts(ffmpeg,file,W,H,[cueBand],48,120)).frames).toBe(120);
  },60000);
  it("점수 입력: 자막 시각과 검출 프레임 모양을 확인한다",()=>{
    for(const cue of [{startSec:1,endSec:1},{startSec:2,endSec:1},{startSec:-1,endSec:1},{startSec:Number.NaN,endSec:1}])invalid(()=>score(cue,{first:null,last:null}));
    for(const found of [{first:1,last:null},{first:null,last:1},{first:5,last:4},{first:-1,last:4},{first:1.5,last:4}])invalid(()=>score({startSec:0.37,endSec:1.52},found as never));
    expect(score({startSec:0.37,endSec:1.52},{first:11,last:45})).toMatchObject({maxErrorFrames:0,pass:true});
    expect(score({startSec:0.37,endSec:1.52},{first:17,last:45})).toMatchObject({maxErrorFrames:6,pass:true});
    expect(score({startSec:0.37,endSec:1.52},{first:18,last:45})).toMatchObject({maxErrorFrames:7,pass:false});
  });
  it("SRT 오차는 정확값: 밀리초 SRT는 프레임 경계에서 최대 1/3000초가 남는다",()=>{
    expect(srtErrorSec(367,11)).toBeCloseTo(1/3000,12);expect(srtErrorSec(1700,51)).toBe(0);
    expect(srtErrorSec(367,11)).toBeGreaterThan(0);expect(Math.round(srtErrorSec(367,11)*1000)/1000).toBe(0);
  });
  it("명령줄: --out 값·--keep만, 모르는 옵션·값 없음·중복은 거부",()=>{
    expect(parseArgs([])).toEqual({out:null,keep:false});expect(parseArgs(["--out","a.json","--keep"])).toEqual({out:"a.json",keep:true});
    for(const argv of [["--bogus"],["--out"],["--out","--keep"],["--out",""],["--out","a","--out","b"],["--keep","--keep"],["extra"]])invalid(()=>parseArgs(argv));
  });
  it("잘못된 명령줄은 아무것도 만들지 않고 종료 코드 2",async()=>{
    for(const argv of [["--bogus"],["--out"],["--out","--keep"]]){
      const result=await promisify(execFile)(process.execPath,["--import","tsx","scripts/remotion/measure-subtitle.ts",...argv],{windowsHide:true,timeout:60000}).then(()=>({code:0,stderr:""}),(error:{code:number;stderr:string})=>({code:error.code,stderr:String(error.stderr)}));
      expect(result.code,argv.join(" ")).toBe(EXIT.invalid);expect(result.stderr).toContain("usage: measure-subtitle.ts");
    }
    expect(EXIT).toEqual({pass:0,fail:1,invalid:2});
  },120000);
  it("실행 중 오류(도구 없음)는 결과 파일 없이 종료 코드 1",async()=>{
    const out=join(dir,"never.json"),missing=join(dir,"no-ffmpeg.exe"),before=new Set(readdirSync(tmpdir()).filter(name=>name.startsWith("dream-t127-measure-")));
    const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","scripts/remotion/measure-subtitle.ts","--out",out],{windowsHide:true,timeout:120000,env:{...process.env,FFMPEG_PATH:missing}})
      .then(()=>({code:0}),(error:{code:number})=>({code:error.code}));
    expect(result.code).toBe(EXIT.fail);expect(existsSync(out)).toBe(false);
    // its own OS-temp work folder is removed on failure too
    expect(readdirSync(tmpdir()).filter(name=>name.startsWith("dream-t127-measure-")&&!before.has(name))).toEqual([]);
  },180000);
});
