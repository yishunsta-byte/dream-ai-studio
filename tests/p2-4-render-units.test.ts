// P2-4b (T-114) render parts that need no database: file name, output check (app ffprobe on the fixed s6 inputs and
// item-by-item failures), the job file server (token, allowlist by index, GET/HEAD, Range, no path from the request),
// composition props, error classification of the child, composition source hash, and the code boundary (the app never
// imports the renderer, the bundler or render/).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mediaBinary } from "@/lib/media/tools";
vi.mock("server-only",()=>({}));
import { renderFileName, renderSlug } from "@/lib/render/name";
import { judge, verifyRender } from "@/lib/render/verify";
import { startFileServer, type FileServer } from "@/lib/render/file-server";
import { renderProps } from "@/lib/render/props";
import { compositionSources, compositionSourceSha256 } from "@/lib/render/tools";
import { RENDER_MESSAGES, RENDER_RETRYABLE, renderRetryable } from "@/lib/render/errors";
import { classify, chromiumFlags } from "@/render/child";
import type { RenderInput } from "@/lib/render/input";

// The fixed s6 input has no colour tags (made before T-108); a tagged 30-frame H.264 is made fresh in the OS temp folder.
const UNTAGGED="tests/fixtures/backups/s6-inputs/render-passed.mp4";let PASSED:string,sampleDir:string;
beforeAll(()=>{sampleDir=mkdtempSync(join(tmpdir(),"dream-t114-verify-"));PASSED=join(sampleDir,"tagged.mp4");
  execFileSync(mediaBinary("ffmpeg"),["-v","error","-f","lavfi","-i","color=c=0x335577:s=1080x1920:r=30","-frames:v","30","-c:v","libx264","-pix_fmt","yuv420p","-color_range","tv","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709","-an",PASSED],{windowsHide:true});});
afterAll(()=>{rmSync(sampleDir,{recursive:true,force:true});});
describe("파일 이름 (D-6, T-102 13장)",()=>{
  it("한글을 유지하고 금지 문자·예약어·길이를 처리하며 받기·목록이 같은 함수를 쓴다",()=>{
    expect(renderFileName({title:"[가상] 텀블러 소개",aspect:"9:16",timelineRevision:3,isSample:true,seq:1})).toBe("[가상] 텀블러 소개_9x16_r3_SAMPLE.mp4");
    expect(renderFileName({title:"a/b:c*d?\"e<f>g|h\\i",aspect:"16:9",timelineRevision:1,isSample:false,seq:2})).toBe("a_b_c_d__e_f_g_h_i_16x9_r1-2.mp4");
    expect(renderSlug("CON")).toBe("_CON");expect(renderSlug("  ...  ")).toBe("영상");expect(renderSlug("\u0007제어")).toBe("_제어");
    const long=renderFileName({title:"가".repeat(300),aspect:"1:1",timelineRevision:999999,isSample:true,seq:99});
    expect([...long].length).toBeLessThanOrEqual(120);expect(long).toMatch(/_1x1_r999999_SAMPLE-99\.mp4$/);expect(long).not.toMatch(/[\\/:*?"<>|]/);
    expect(()=>renderFileName({title:"x",aspect:"1:1",timelineRevision:0,isSample:false,seq:1})).toThrow();
  });
});

describe("앱 ffprobe 확인 (T-101 2.5, D-3)",()=>{
  const expectPassed={width:1080,height:1920,fps:30,frames:30};
  it("bt709·tv로 표시한 H.264 30프레임은 모든 항목을 통과하고 항목별 기대값·실제값을 남긴다",async()=>{
    const result=await verifyRender(PASSED,expectPassed);
    expect(result.result,JSON.stringify(result.items.filter(item=>!item.pass))).toBe("passed");
    expect(result.items.map(item=>item.item)).toEqual(["container","videoStreams","codec","pixelFormat","colorRange","colorSpace","width","height","frameRate","averageFrameRate","frames","durationSec","audioStreams","otherStreams","sizeBytes"]);
    expect(result.probe).toMatchObject({codec:"h264",pixFmt:"yuv420p",audioStreams:0,frames:30});
  });
  it("크기·프레임 수가 다르면 그 항목만 실패한다",async()=>{
    const result=await verifyRender(PASSED,{...expectPassed,width:720,frames:31});
    expect(result.result).toBe("failed");expect(result.items.filter(item=>!item.pass).map(item=>item.item).sort()).toEqual(["durationSec","frames","width"]);
    expect(result.items.find(item=>item.item==="width")).toEqual({item:"width",expected:720,actual:1080,pass:false});
  });
  it("색 정보가 없는 파일(고정 s6 입력)은 색 범위·색 공간에서 실패한다 (T-108)",async()=>{
    const result=await verifyRender(UNTAGGED,{...expectPassed,frames:900});expect(result.items.filter(item=>!item.pass).map(item=>item.item)).toEqual(["colorRange","colorSpace"]);
  });
  it("yuvj420p·전체 범위·bt601·오디오 트랙·다른 프레임률·두 번째 영상은 실패다",()=>{
    const good={streams:[{codec_type:"video",codec_name:"h264",pix_fmt:"yuv420p",width:1080,height:1920,r_frame_rate:"30/1",avg_frame_rate:"30/1",nb_read_frames:"30",color_range:"tv",color_space:"bt709"}],format:{format_name:"mov,mp4,m4a,3gp,3g2,mj2",duration:"1.000000"}};
    expect(judge(good,expectPassed,10).result).toBe("passed");
    const failing=(patch:Record<string,unknown>,extra:object[]=[])=>judge({...good,streams:[{...good.streams[0],...patch},...extra]},expectPassed,10).items.filter(item=>!item.pass).map(item=>item.item);
    expect(failing({pix_fmt:"yuvj420p"})).toEqual(["pixelFormat"]);expect(failing({color_range:"pc"})).toEqual(["colorRange"]);expect(failing({color_space:"bt470bg"})).toEqual(["colorSpace"]);
    expect(failing({r_frame_rate:"25/1",avg_frame_rate:"25/1"})).toEqual(["frameRate","averageFrameRate"]);
    expect(failing({},[{codec_type:"audio",codec_name:"aac"}])).toEqual(["audioStreams"]);expect(failing({},[{codec_type:"video",codec_name:"h264"}])).toEqual(["videoStreams"]);
    expect(judge({streams:[]},expectPassed,0).result).toBe("failed");
  });
});

describe("작업 파일 서버 (T-101 2.9)",()=>{
  let dir:string,server:FileServer,media:string,font:string;const bytes=Buffer.from(Array.from({length:4096},(_,index)=>index%251));
  beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),"dream-t114-fs-"));media=join(dir,"clip.mp4");font=join(dir,"font.woff2");writeFileSync(media,bytes);writeFileSync(font,"font");writeFileSync(join(dir,"secret.txt"),"secret");
    server=await startFileServer([{absolute:media,mime:"video/mp4",sizeBytes:bytes.length}],[{absolute:font,mime:"font/woff2",sizeBytes:4}]);});
  afterAll(async()=>{await server.close();rmSync(dir,{recursive:true,force:true});});
  it("127.0.0.1과 64자리 토큰 경로만 쓰고 목록의 파일만 색인으로 준다",async()=>{
    expect(server.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}$/);
    const full=await fetch(server.mediaUrl(0));expect(full.status).toBe(200);expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");expect(full.headers.get("cache-control")).toBe("no-store");expect(full.headers.get("content-type")).toBe("video/mp4");
    expect((await fetch(server.fontUrl(0))).status).toBe(200);
    const base=server.base,origin=new URL(base).origin,token=base.slice(-64);
    for(const path of [`${base}/m/1`,`${base}/f/1`,`${base}/x/0`,`${origin}/${"0".repeat(64)}/m/0`,`${origin}/m/0`,`${base}/m/0/..%2F..%2Fsecret.txt`,`${origin}/${token}/..%2Fsecret.txt`,`${base}/m/-1`,`${base}/m/0x0`])
      expect((await fetch(path)).status,path).toBe(404);
    // raw paths the client would normalize: sent as they are
    const raw=(path:string)=>new Promise<number>((done,fail)=>{const url=new URL(base);const req=httpRequest({host:"127.0.0.1",port:url.port,path,method:"GET"},response=>{response.resume();done(response.statusCode??0);});req.on("error",fail);req.end();});
    for(const path of [`/${token}/m/../f/0`,`/${token}/m/0/../../secret.txt`,`/${token}/../secret.txt`,`/${token}/m/0?x=/../secret.txt`,`/${token}/m//0`,`/${token}/m%5C0`,`/${token}%5Cm%5C0`])expect(await raw(path),path).toBe(path.includes("?x=")?200:404);
  });
  it("GET·HEAD만 받고 Range는 206·416으로 답한다",async()=>{
    expect((await fetch(server.mediaUrl(0),{method:"POST"})).status).toBe(405);
    const head=await fetch(server.mediaUrl(0),{method:"HEAD"});expect(head.status).toBe(200);expect(head.headers.get("content-length")).toBe(String(bytes.length));
    const part=await fetch(server.mediaUrl(0),{headers:{range:"bytes=100-199"}});expect(part.status).toBe(206);expect(part.headers.get("content-range")).toBe(`bytes 100-199/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(100,200))).toBe(true);
    expect((await fetch(server.mediaUrl(0),{headers:{range:"bytes=9999-"}})).status).toBe(416);
    expect(server.requests().every(entry=>!/[0-9a-f]{64}/.test(entry.path))).toBe(true);
  });
  it("등록된 크기와 다르면 409이고 닫으면 연결을 받지 않는다",async()=>{
    const other=await startFileServer([{absolute:media,mime:"video/mp4",sizeBytes:1}],[]);
    expect((await fetch(other.mediaUrl(0))).status).toBe(409);await other.close();
    await expect(fetch(other.mediaUrl(0))).rejects.toThrow();
  });
});

describe("컴포지션 값·자식 오류 분류",()=>{
  const clip=(assetId:string,frames:number,trim=0)=>({id:"c",sceneId:`s-${assetId}`,sceneVersionId:null,assetId,durationFrames:frames,trimInFrames:trim,trimOutFrames:0,transition:{type:"cut",durationFrames:0}});
  const input={output:{width:1080,height:1920},durationInFrames:100,videoFrames:90,timeline:{aspect:"9:16",video:[clip("a",30),clip("b",60,12)],text:[{id:"t",content:"글",kind:"subtitle",style:{fontFamily:"Pretendard",fontWeight:700},box:{},animation:{in:"fade",out:"none",emphasis:"none"},timing:{startFrame:10,endFrame:100}}]},
    media:[{assetId:"a",kind:"image"},{assetId:"b",kind:"video"}],fonts:[{family:"Pretendard",weightMin:100,weightMax:900}]} as unknown as RenderInput;
  it("파일 서버 주소만 쓰고 저장된 글자를 미리보기 표시 없이 넘긴다",()=>{
    const props=renderProps(input,{media:index=>`http://127.0.0.1:1/t/m/${index}`,font:index=>`http://127.0.0.1:1/t/f/${index}`});
    expect(props.clips).toEqual([{sceneId:"s-a",from:0,durationInFrames:30,kind:"image",src:"http://127.0.0.1:1/t/m/0",trimBefore:0},{sceneId:"s-b",from:30,durationInFrames:60,kind:"video",src:"http://127.0.0.1:1/t/m/1",trimBefore:12}]);
    expect(props.texts[0]).toMatchObject({from:10,durationInFrames:90,movedForPreview:false,fontMissing:false,mark:null,animated:true});
    expect(props.fonts).toEqual([{family:"Pretendard",url:"http://127.0.0.1:1/t/f/0",weight:"100 900",weights:[700]}]);
    expect(()=>renderProps({...input,timeline:{...input.timeline,video:[clip("zzz",30)]}} as RenderInput,{media:String,font:String})).toThrow();
  });
  it("취소·글꼴·공간·브라우저 없음·충돌·기타를 구분하고 재시도는 충돌·일시 저장 오류만이다",()=>{
    expect(classify(new Error("renderMedia() got cancelled")).code).toBe("RENDER_CANCELED");
    expect(classify(new Error("x\nFONT_MISSING:Noto Sans KR\ny"))).toEqual({code:"FONT_MISSING",detail:"Noto Sans KR"});
    expect(classify(Object.assign(new Error("write"),{code:"ENOSPC"})).code).toBe("DISK_FULL");
    expect(classify(new Error("RENDER_BROWSER_MISSING: spawn UNKNOWN")).code).toBe("RENDER_BROWSER_MISSING");
    expect(classify(new Error("Target closed")).code).toBe("RENDER_BROWSER_CRASHED");expect(classify(new Error("Compositor exited with code 1")).code).toBe("RENDER_BROWSER_CRASHED");
    expect(classify(new Error("Could not find composition")).code).toBe("RENDER_FAILED");
    expect([...RENDER_RETRYABLE].sort()).toEqual(["RENDER_BROWSER_CRASHED","STORAGE_FAILED"]);
    for(const code of ["RENDER_VERIFY_FAILED","RENDER_INPUT_CHANGED","FONT_MISSING","RENDER_INPUT_MISSING","RENDER_BROWSER_MISSING","DISK_FULL","TIMEOUT","RENDER_INTERRUPTED"])expect(renderRetryable(code),code).toBe(false);
    for(const message of Object.values(RENDER_MESSAGES))expect(message).toMatch(/요\.$/);
  });
  it("브라우저는 loopback만 닿도록 이름 해석과 프록시를 막는다",()=>{
    const flags=chromiumFlags(null);expect(flags["host-resolver-rules"]).toBe("MAP localhost 127.0.0.1 , MAP * ~NOTFOUND , EXCLUDE 127.0.0.1");
    expect(flags["proxy-server"]).toBe("http://127.0.0.1:9");expect(flags["log-net-log"]).toBeUndefined();
  });
});

describe("소스 해시·코드 경계 (T-101 2.4·2.9)",()=>{
  it("렌더 진입점이 가져오는 앱 파일만 해시하고 서버 모듈은 들어가지 않는다",()=>{
    const files=compositionSources();
    expect(files).toEqual(expect.arrayContaining(["render/entry.tsx","render/render-composition.tsx","components/player/composition-core.tsx","lib/edit/text-ops.ts"]));
    expect(files.filter(file=>/^lib\/(db|repo|services|jobs|storage)\//.test(file)||file==="lib/render/input.ts")).toEqual([]);
    expect(compositionSourceSha256()).toMatch(/^[0-9a-f]{64}$/);expect(compositionSourceSha256()).toBe(compositionSourceSha256());
  });
  it("app·components·lib는 렌더러·번들러·render/를 가져오지 않는다",()=>{
    const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):/\.(ts|tsx)$/.test(entry.name)?[join(dir,entry.name)]:[]);
    for(const file of [...walk("app"),...walk("components"),...walk("lib"),...walk("worker")]){
      const text=readFileSync(file,"utf8").split(/\r?\n/).filter(line=>/^\s*(import|export)\s/.test(line)&&!/^\s*(import|export)\s+type\s/.test(line)).join("\n");
      expect(text,file).not.toMatch(/@remotion\/(renderer|bundler)|["']@\/render\/|["'](\.\.\/)+render\//);
    }
    expect(statSync("render/child.ts").isFile()).toBe(true);
    expect(createHash("sha256").update(readFileSync("render/entry.tsx")).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });
});
