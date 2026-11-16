// T-071 (P2-2): preview input is a pure function of the timeline on screen (T-067 6장 T1·T2·T3).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clampFrame, formatFrameTime, previewProps, SAFE_AREA, spokenFrameTime, type PreviewAsset } from "@/lib/edit/preview";
import { textFromP1, type Timeline } from "@/lib/edit/timeline";

const id=(n:number)=>`0190a000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const clip=(n:number,frames:number,asset:string|null,trimIn=0)=>({id:id(100+n),sceneId:id(200+n),sceneVersionId:asset?id(300+n):null,assetId:asset,durationFrames:frames,trimInFrames:trimIn,trimOutFrames:0,transition:{type:"cut" as const,durationFrames:0 as const}});
const text=(n:number,start:number,end:number,position:"top"|"middle"|"bottom"="bottom")=>textFromP1({id:id(400+n),kind:"subtitle",content:`글자 ${n}`,fontFamily:"Pretendard",fontSize:64,color:"#FFFFFF",position,startSec:start,endSec:end,locked:false});
function deepFreeze<T>(value:T):T{if(value&&typeof value==="object"){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}
const timeline:Timeline=deepFreeze({schemaVersion:1,fps:30,aspect:"9:16",audio:[],
  video:[clip(1,90,id(501)),clip(2,60,null),clip(3,120,id(503),15),clip(4,30,id(504))],
  text:[text(1,0,2),text(2,9,10.5)]});
const assets:ReadonlyMap<string,PreviewAsset>=new Map([[id(501),{kind:"image",available:true}],[id(503),{kind:"video",available:true,isMock:true}],[id(504),{kind:"image",available:false}]]);

describe("previewProps (T1)",()=>{
  it("클립 위치는 앞 클립 길이의 합, 영상은 trimBefore, 빈 자리·없는 파일은 요청하지 않음",()=>{
    const props=previewProps(timeline,assets,{aspect:"9:16",reducedMotion:false})!;
    expect(props).toMatchObject({fps:30,width:1080,height:1920,videoFrames:300,sample:true,fontMissing:false});
    expect(props.clips.map(item=>[item.sceneNumber,item.from,item.durationInFrames])).toEqual([[1,0,90],[2,90,60],[3,150,120],[4,270,30]]);
    expect(props.clips.map(item=>item.source)).toEqual([{type:"image",src:`/api/assets/${id(501)}`},{type:"empty"},{type:"video",src:`/api/assets/${id(503)}`,trimBefore:15},{type:"missing"}]);
  });
  it("전체 길이 = max(영상 합계, 글자 끝) — 영상보다 긴 글자도 보임(T-072 G-1)",()=>{
    expect(previewProps(timeline,assets,{aspect:"9:16",reducedMotion:false})!.durationInFrames).toBe(315);
    expect(previewProps({...timeline,text:[text(1,0,2)]},assets,{aspect:"9:16",reducedMotion:false})!.durationInFrames).toBe(300);
  });
  it("장면이 없으면 null(비어 있음, Player 없음)",()=>{
    expect(previewProps({...timeline,video:[]},assets,{aspect:"9:16",reducedMotion:false})).toBeNull();
  });
  it("자료 목록에 없는 자료는 없는 파일로 보여 줌",()=>{
    expect(previewProps(timeline,new Map(),{aspect:"9:16",reducedMotion:false})!.clips.map(item=>item.source.type)).toEqual(["missing","empty","missing","missing"]);
  });
  it("미리보기 비율은 크기와 화면용 위치만 바꾸고 입력(저장 값)은 그대로",()=>{
    const before=JSON.stringify(timeline);
    const wide={...timeline,text:[{...text(3,0,1),box:{...text(3,0,1).box,y:0.99}}]};
    for(const aspect of ["16:9","1:1"] as const){
      const props=previewProps(wide,assets,{aspect,reducedMotion:true})!;
      expect([props.width,props.height]).toEqual(aspect==="16:9"?[1920,1080]:[1080,1080]);
      expect(props.reducedMotion).toBe(true);
      const moved=props.texts[0];expect(moved.movedForPreview).toBe(true);
      expect(moved.box.y).toBeLessThanOrEqual(1-SAFE_AREA[aspect].bottom);expect(moved.box.x).toBe(wide.text[0].box.x);
    }
    const same=previewProps(wide,assets,{aspect:"9:16",reducedMotion:false})!;expect(same.texts[0].movedForPreview).toBe(false);expect(same.texts[0].box).toBe(wide.text[0].box);
    // P1 default boxes stay inside every safe area (spec rule), so they are never moved.
    for(const aspect of ["16:9","1:1"] as const)expect(previewProps(timeline,assets,{aspect,reducedMotion:false})!.texts.every(item=>!item.movedForPreview)).toBe(true);
    expect(JSON.stringify(timeline)).toBe(before);
  });
  it("글자 시간은 프레임 그대로",()=>{
    expect(previewProps(timeline,assets,{aspect:"9:16",reducedMotion:false})!.texts.map(item=>[item.from,item.durationInFrames])).toEqual([[0,60],[270,45]]);
  });
  it("SAFE_AREA가 spec text-presets.json safeArea와 같음",()=>{
    const spec=JSON.parse(readFileSync("docs/spec/text-presets.json","utf8")).safeArea as Record<string,Record<string,number>>;
    for(const [aspect,value] of Object.entries(SAFE_AREA))expect(value).toEqual({top:spec[aspect].top,bottom:spec[aspect].bottom,right:spec[aspect].right,left:spec[aspect].left});
  });
});

describe("시간 표시 (T2, T-068 3장)",()=>{
  it("MM:SS.FF",()=>{
    expect([0,31,254,749,750].map(formatFrameTime)).toEqual(["00:00.00","00:01.01","00:08.14","00:24.29","00:25.00"]);
    expect(formatFrameTime(3600*30+61)).toBe("1:00:02.01");
    expect(spokenFrameTime(250)).toBe("8초 10프레임");expect(spokenFrameTime(30*62+3)).toBe("1분 2초 3프레임");
  });
  it("seek는 0 ~ 마지막 프레임",()=>{expect([clampFrame(-5,750),clampFrame(749,750),clampFrame(800,750),clampFrame(31,750)]).toEqual([0,749,749,31]);});
});

// T3: the preview code reaches no server module, directly or through other imports.
describe("import 경계 (T3)",()=>{
  const forbidden=[/^server-only$/,/^@\/lib\/db(\/|$)/,/^@\/lib\/repo(\/|$)/,/^@\/lib\/services(\/|$)/,/^better-sqlite3$/,/^node:/];
  function file(base:string){for(const ext of ["",".ts",".tsx","/index.ts","/index.tsx"]){try{readFileSync(base+ext);return base+ext;}catch{/* next */}}return null;}
  function walk(start:string,seen=new Set<string>(),found:string[]=[]){
    if(seen.has(start))return found;seen.add(start);
    for(const match of readFileSync(start,"utf8").matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"|import\("([^"]+)"\)/g)){
      const spec=match[1]??match[2];if(match[0].startsWith("import type")||/^export type/.test(match[0]))continue;
      if(forbidden.some(rule=>rule.test(spec)))found.push(`${start} → ${spec}`);
      const target=spec.startsWith("@/")?file(resolve(spec.slice(2))):spec.startsWith(".")?file(resolve(dirname(start),spec)):null;
      if(target&&!target.endsWith(".css"))walk(target,seen,found);
    }
    return found;
  }
  it("lib/edit/preview.ts와 components/player/*는 서버 모듈을 불러오지 않음",()=>{
    const roots=["lib/edit/preview.ts",...readdirSync("components/player").filter(name=>name.endsWith(".tsx")).map(name=>join("components/player",name))];
    expect(roots.length).toBeGreaterThanOrEqual(4);
    for(const root of roots)expect(walk(resolve(root))).toEqual([]);
  });
  it("Player 기본 키·조작은 끄고 문서 전체 키 처리기가 없음",()=>{
    const panel=readFileSync("components/player/player-panel.tsx","utf8");
    for(const setting of ["controls={false}","spaceKeyToPlayOrPause={false}","clickToPlay={false}","acknowledgeRemotionLicense","numberOfSharedAudioTags={0}"])expect(panel).toContain(setting);
    for(const source of [panel,readFileSync("components/player/timeline-composition.tsx","utf8"),readFileSync("components/player/player-loader.tsx","utf8")]){
      expect(source).not.toMatch(/(document|window)\.addEventListener\(\s*"key/);expect(source).not.toMatch(/fetch\(|method:\s*"(POST|PATCH|PUT|DELETE)"/);
    }
    expect(readFileSync("components/player/player-loader.tsx","utf8")).toContain("ssr:false");
    expect(readFileSync("components/player/timeline-composition.tsx","utf8")).toMatch(/OffthreadVideo[^>]*muted/);
  });
  // T-075 (F073-1): a render error before the event listeners are attached must still reach the panel.
  it("Player 오류 대체 화면이 비어 있지 않고 effect로 패널에 알림(최초·비율 재마운트·재시도)",()=>{
    // T-077 (F076-1): the same check on an LF or a CRLF checkout — only the line endings of the read text are unified.
    const panel=readFileSync("components/player/player-panel.tsx","utf8").replace(/\r\n/g,"\n");
    expect(panel).not.toContain("ErrorFallback=()=>null");expect(panel).not.toContain("errorFallback={()=>null}");
    expect(panel).toContain("function PlayerFailed({onFailed}:{onFailed:()=>void}){\n  useEffect(()=>{onFailed();},[onFailed]);");
    expect(panel).toContain("errorFallback={fallback}");expect(panel).toContain("onFailed={failed}");
  });
  it("패키지는 remotion·@remotion/player 4.0.543 정확 고정 두 개만",()=>{
    const pkg=JSON.parse(readFileSync("package.json","utf8")) as {dependencies:Record<string,string>;devDependencies:Record<string,string>};
    const all={...pkg.dependencies,...pkg.devDependencies},remotion=Object.entries(all).filter(([name])=>name==="remotion"||name.startsWith("@remotion/"));
    expect(Object.fromEntries(remotion)).toEqual({"remotion":"4.0.543","@remotion/player":"4.0.543"});
  });
});
