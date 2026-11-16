// T-081 P2-3a text editor: pure editor operations, spec presets, fonts (readable vs selectable), the server rules for
// fonts and required disclosures, explicit save on the fixed backup s4/s5 copy (never real data), the bundle additions
// for new versions, and the unchanged P1-moved r1. Everything runs in OS temp folders.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { checkP1MigratedRow, checkTimelineRows, P1SourceMismatchError, readTimelineRow, timelineSha256, type TimelineRow } from "@/lib/db/timeline-data";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { fileDigest } from "@/lib/export/zip";
import { READABLE_FONT_FAMILIES, SPEC_FONTS, type FontRef } from "@/lib/edit/fonts";
import { PRESETS, QUICK_LOOK_KINDS, presetFor } from "@/lib/edit/presets";
import { SAFE_AREA, formatFrameTime, PREVIEW_SIZE } from "@/lib/edit/preview";
import { applyPreset, changeKind, insertText, moveInsideSafeArea, moveText, newTextLayer, parseFrameTime, removeText, replaceText, safeViolations, textMotion } from "@/lib/edit/text-ops";
import { canonicalJson, TEXT_KINDS, textFromP1, timelineSchema, type Timeline, type TimelineText } from "@/lib/edit/timeline";
import { fontStatuses, licenseOk, selectableFonts } from "@/lib/fonts/registry";
import { jobsRepository } from "@/lib/repo/jobs";
import { editingService } from "@/lib/services/editing";
import { bundleLayout } from "@/lib/services/exports";
import { FONT_UNAVAILABLE, FONT_WEIGHT_UNAVAILABLE, timelineService } from "@/lib/services/timeline";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";

const ids=s4Ids();
let root:string,committed:{sha256:string;sizeBytes:number};const handles:DatabaseHandle[]=[];
beforeAll(async()=>{committed=await fileDigest(S4_ZIP);});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed);});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-p23-")));});
afterEach(()=>{for(const handle of handles.splice(0))handle.close();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
async function migratedS4(){const into=join(root,"s5");const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,into);const file=join(into,"data/app.db");const sqlite=new Database(file);try{sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");migrateDatabase(sqlite,{migrations:productMigrations(),now:()=>Date.parse("2026-11-16T09:00:00Z")});}finally{sqlite.close();}return file;}
function open(file:string){const handle=openDatabase(file,{fileMustExist:true});handles.push(handle);return handle;}
const revisionOf=(handle:DatabaseHandle)=>jobsRepository(handle).project(ids.main)!.contentRevision;
const thrown=(fn:()=>unknown)=>{try{fn();}catch(error){return error as Error&{code?:string};}throw new Error("expected a throw");};
const rows=(handle:DatabaseHandle)=>handle.sqlite.prepare("SELECT * FROM timeline_revisions ORDER BY revision").all() as TimelineRow[];
const freeze=<T>(value:T):T=>{if(value&&typeof value==="object"){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
const ONLY_PRETENDARD:FontRef[]=[{family:"Pretendard",role:"기본",weights:[400,600,700,800],url:"/fonts/PretendardVariable.woff2"}];

describe("글꼴 목록 (읽기 목록 ⊇ spec, 고를 수 있는 목록 = spec ∩ 설치 ∩ 라이선스)",()=>{
  it("읽기 목록은 spec 8종을 모두 포함하고 스키마가 그 이름을 받는다",()=>{
    expect(SPEC_FONTS.map(font=>font.family).every(family=>(READABLE_FONT_FAMILIES as readonly string[]).includes(family))).toBe(true);
    const layer=newTextLayer("subtitle",{startFrame:0,videoFrames:300,plannedFrames:300,content:"가"});
    for(const family of READABLE_FONT_FAMILIES)expect(timelineSchema.shape.text.element.safeParse({...layer,style:{...layer.style,fontFamily:family}}).success).toBe(true);
    expect(timelineSchema.shape.text.element.safeParse({...layer,style:{...layer.style,fontFamily:"Comic Sans"}}).success).toBe(false);
  });
  it("가짜 글꼴 폴더: 라이선스 없음·본문 다름·파일 0개·2개는 빠지고, CRLF 원문 라이선스는 통과",()=>{
    const fake=join(root,"fonts"),put=(folder:string,files:Record<string,string>)=>{const dir=join(fake,"public","fonts",folder);mkdirSync(dir,{recursive:true});for(const [name,body] of Object.entries(files))writeFileSync(join(dir,name),body);};
    const ofl="Copyright x\r\n\r\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\r\n";
    put("",{"PretendardVariable.woff2":"x","OFL.txt":ofl});put("noto-sans-kr",{"NotoSansKR[wght].ttf":"x"});put("noto-serif-kr",{"a.ttf":"x","OFL.txt":"MIT License"});
    put("black-han-sans",{"OFL.txt":ofl});put("do-hyeon",{"a.ttf":"x","b.otf":"x","OFL.txt":ofl});put("jua",{"Jua-Regular.ttf":"x","OFL.txt":ofl.replace(/\r\n/g," \n ")});
    const byFamily=Object.fromEntries(fontStatuses(fake).map(font=>[font.family,font]));
    expect(byFamily["Pretendard"]).toMatchObject({installed:true,url:"/fonts/PretendardVariable.woff2"});
    expect(byFamily["Noto Sans KR"]).toMatchObject({installed:false,reason:"라이선스 파일(OFL.txt)이 없어요."});
    expect(byFamily["Noto Serif KR"]).toMatchObject({installed:false,reason:"라이선스 파일에 OFL 1.1 본문이 없어요."});
    expect(byFamily["Black Han Sans"]).toMatchObject({installed:false,reason:"글꼴 파일이 없어요."});
    expect(byFamily["Do Hyeon"]).toMatchObject({installed:false,reason:"글꼴 파일이 두 개 이상이에요."});
    expect(byFamily["Jua"]).toMatchObject({installed:true,url:"/fonts/jua/Jua-Regular.ttf"});
    expect(selectableFonts(fake).map(font=>font.family)).toEqual(["Pretendard","Jua"]);
    expect(licenseOk("sil  OPEN font\r\nlicense ... version\n1.1")).toBe(true);
  });
  it("저장소의 실제 글꼴(T-082): 8종 모두 설치·라이선스 통과, 대괄호 파일 이름은 URL에서 인코딩",()=>{
    const statuses=fontStatuses();expect(statuses.filter(font=>!font.installed).map(font=>[font.family,font.reason])).toEqual([]);
    expect(statuses.find(font=>font.family==="Noto Sans KR")!.url).toBe("/fonts/noto-sans-kr/NotoSansKR%5Bwght%5D.ttf");
    for(const font of statuses)expect(readdirSync(dirname(font.file!)).filter(name=>/\.(ttf|otf|woff2)$/i.test(name))).toHaveLength(1);
  });
});

describe("프리셋·편집 함수 (순수, 입력 불변)",()=>{
  it("새 글자 8종 = spec 프리셋 값 그대로, 기본 위치는 모든 비율의 안전 영역 안(숫자), 빠른 모양 7개(표기 없음)",()=>{
    expect(QUICK_LOOK_KINDS).toEqual(["subtitle","hook","emphasis","title","ending","lyric","brand"]);
    const spec=JSON.parse(readFileSync("docs/spec/text-presets.json","utf8")) as {presets:{kind:string;style:unknown;box:unknown;animation:unknown;locked:boolean}[]};
    for(const kind of TEXT_KINDS){const layer=newTextLayer(kind,{startFrame:30,videoFrames:600,plannedFrames:900,content:"가"}),preset=spec.presets.find(item=>item.kind===kind)!;
      expect({style:layer.style,animation:layer.animation,locked:layer.locked}).toEqual({style:preset.style,animation:preset.animation,locked:preset.locked});
      if(kind!=="disclosure")expect(layer.box).toEqual(preset.box);
      expect(layer.timing).toEqual(kind==="disclosure"?{startFrame:0,endFrame:900}:{startFrame:30,endFrame:120});
      expect(timelineSchema.shape.text.element.safeParse(layer).success).toBe(true);
      for(const aspect of ["9:16","16:9","1:1"] as const){const safe=SAFE_AREA[aspect],box=PRESETS[kind].box,left=box.anchor==="center"?box.x-box.widthRatio/2:box.x,right=left+box.widthRatio;
        expect(left).toBeGreaterThanOrEqual(safe.left-1e-9);expect(right).toBeLessThanOrEqual(1-safe.right+1e-9);expect(box.y).toBeGreaterThanOrEqual(safe.top);expect(box.y).toBeLessThanOrEqual(1-safe.bottom);}
    }
    // Two required disclosures do not sit on top of each other.
    expect(newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:900,content:"AI 생성",stack:1}).box.y).toBeCloseTo(PRESETS.disclosure.box.y+0.04);
  });
  it("새 글자 시간: 재생 위치부터 3초, 영상 끝 근처면 3초가 되도록 앞당김, 영상이 3초보다 짧으면 영상 길이",()=>{
    const time=(startFrame:number,videoFrames:number)=>newTextLayer("subtitle",{startFrame,videoFrames,plannedFrames:videoFrames}).timing;
    expect(time(0,300)).toEqual({startFrame:0,endFrame:90});expect(time(280,300)).toEqual({startFrame:210,endFrame:300});expect(time(10,45)).toEqual({startFrame:0,endFrame:45});
  });
  it("빠른 모양 = style·animation만(기본 위치는 체크할 때만), 종류 바꾸기 = maxLines만, 잠긴 표기는 그대로",()=>{
    const p1=freeze(textFromP1({id:ids.layer2,kind:"subtitle",content:"자막",fontFamily:"Pretendard",fontSize:40,color:"#FFFFFF",position:"bottom",startSec:0.125,endSec:2.5,locked:false}));
    const hook=applyPreset(p1,"hook",false);expect(hook.style).toEqual(PRESETS.hook.style);expect(hook.animation).toEqual(PRESETS.hook.animation);
    expect({...hook,style:p1.style,animation:p1.animation}).toEqual(p1);expect(applyPreset(p1,"hook",true).box).toEqual(PRESETS.hook.box);
    const kind=changeKind(p1,"emphasis");expect(kind.kind).toBe("emphasis");expect({...kind.style,maxLines:p1.style.maxLines}).toEqual(p1.style);expect(kind.style.maxLines).toBe(1);
    const locked=freeze(newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:900,content:"광고"}));expect(applyPreset(locked,"hook",true)).toBe(locked);expect(changeKind(locked,"subtitle")).toBe(locked);
  });
  it("고친 칸만 바뀌고 나머지는 바이트 단위 그대로, 순서 이동·빼기·되돌려 넣기, 잠긴 글자는 빠지지 않음",()=>{
    const a=newTextLayer("subtitle",{startFrame:0,videoFrames:300,plannedFrames:300,content:"하나"}),b=newTextLayer("title",{startFrame:0,videoFrames:300,plannedFrames:300,content:"둘"}),d=newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:300,content:"광고"});
    const timeline=freeze({schemaVersion:1,fps:30,aspect:"9:16",video:[],audio:[],text:[d,a,b]} as Timeline);
    const edited=replaceText(timeline,a.id,layer=>({...layer,content:"고침"}));expect(canonicalJson({...edited.text[1],content:"하나"})).toBe(canonicalJson(a));expect(edited.text[2]).toBe(b);
    expect(moveText(timeline,a.id,1).text.map(layer=>layer.id)).toEqual([d.id,b.id,a.id]);expect(moveText(timeline,d.id,-1)).toBe(timeline);
    expect(removeText(timeline,d.id)).toBe(timeline);const removed=removeText(timeline,a.id);expect(removed.text.map(layer=>layer.id)).toEqual([d.id,b.id]);
    expect(insertText(removed,a,1).text).toEqual(timeline.text);
  });
  it("MM:SS.FF 시간: 왕복 정확, 형식·프레임 오류 구분",()=>{
    for(const frame of [0,1,29,30,31,75,158,1799,1800,107999,108000])expect(parseFrameTime(formatFrameTime(frame))).toEqual({frame});
    expect(parseFrameTime("00:02.15")).toEqual({frame:75});expect(parseFrameTime("00:01.30")).toEqual({error:"frame"});expect(parseFrameTime("2.5")).toEqual({error:"format"});expect(parseFrameTime("00:61.00")).toEqual({error:"format"});
  });
  it("안전 영역 판정(0.5px)·안으로 옮기기(최소 이동, 너무 크면 null)",()=>{
    const {width,height}=PREVIEW_SIZE["9:16"],bottom=height*0.8;
    expect(safeViolations({left:100,right:900,top:300,bottom},"9:16",width,height)).toEqual([]);
    expect(safeViolations({left:100,right:900,top:300,bottom:bottom+0.6},"9:16",width,height)).toEqual(["bottom"]);
    expect(safeViolations({left:-1,right:951,top:200,bottom:400},"9:16",width,height)).toEqual(["top","left","right"]);
    expect(safeViolations({left:40,right:1040,top:40,bottom:500},"1:1",1080,1080)).toEqual(["top","left","right"]);
    const box={x:0.5,y:0.85,anchor:"center" as const,widthRatio:0.7,rotation:0};
    const moved=moveInsideSafeArea(box,{left:200,right:880,top:1580,bottom:1690},"9:16",width,height)!;
    expect(moved.x).toBe(0.5);expect(moved.y).toBeLessThan(0.85);const shift=(0.85-moved.y)*height;expect(shift).toBeGreaterThanOrEqual(1690-bottom);expect(shift).toBeLessThan(1690-bottom+1);
    expect(moveInsideSafeArea(box,{left:0,right:1000,top:300,bottom:400},"9:16",width,height)).toBeNull();
  });
  it("움직임: 저장 시간의 첫·마지막 프레임은 완전히 투명하지 않음(표시 규칙), 움직임 줄이기는 그대로",()=>{
    const fade={in:"fade",out:"fade",emphasis:"none",durationFrames:4,easing:"ease-out"} as const;
    expect(textMotion(0,60,fade,4,false).opacity).toBeGreaterThan(0);expect(textMotion(59,60,fade,4,false).opacity).toBeGreaterThan(0);
    expect(textMotion(3,60,fade,4,false).opacity).toBe(1);expect(textMotion(30,60,fade,4,false).opacity).toBe(1);
    expect(textMotion(0,60,{...fade,in:"typewriter",durationFrames:8},8,false).visibleChars).toBe(1);expect(textMotion(7,60,{...fade,in:"typewriter",durationFrames:8},8,false).visibleChars).toBe(8);
    expect(textMotion(0,60,{...fade,emphasis:"bounce"},4,true)).toEqual({opacity:1,translateX:0,translateY:0,scale:1,visibleChars:null});
    expect(textMotion(10,60,{in:"none",out:"none",emphasis:"none",durationFrames:0,easing:"linear"},4,false)).toEqual({opacity:1,translateX:0,translateY:0,scale:1,visibleChars:null});
  });
});

describe("옮긴 s4 프로젝트 (서버 규칙·저장·묶음)",()=>{
  it("P2-3 이전 경로는 자간 0·외곽선·띠·그림자 null만 썼고, 넓힌 스키마에서도 r1 바이트·해시·0005 대조가 그대로",async()=>{
    const handle=open(await migratedS4()),[r1]=rows(handle);expect(r1.source).toBe("p1-migration");
    const timeline=readTimelineRow(r1);expect(canonicalJson(timeline)).toBe(r1.timeline_json);expect(timelineSha256(r1.timeline_json)).toBe(r1.timeline_sha256);
    expect(timeline.text.every(layer=>layer.style.letterSpacing===0&&layer.style.stroke===null&&layer.style.background===null&&layer.style.shadow===null&&layer.style.fontFamily==="Pretendard")).toBe(true);
    expect(()=>checkTimelineRows(handle.sqlite)).not.toThrow();expect(()=>checkP1MigratedRow(handle.sqlite,r1,timeline)).not.toThrow();
    const otherFont={...timeline,text:timeline.text.map((layer,index)=>index===1?{...layer,style:{...layer.style,fontFamily:"Jua" as const}}:layer)};
    expect(()=>checkP1MigratedRow(handle.sqlite,r1,otherFont)).toThrow(P1SourceMismatchError);
    // The editor starts from the saved texts exactly; reading writes nothing.
    const before=JSON.stringify(rows(handle)),data=editingService(handle).get(ids.main);expect(canonicalJson(data.draft.text)).toBe(canonicalJson(timeline.text));expect(JSON.stringify(rows(handle))).toBe(before);
    expect(data.fonts.map(font=>font.family)).toEqual(SPEC_FONTS.map(font=>font.family));expect(data.requiredDisclosures).toEqual(["광고"]);expect(data.p1Times?.[ids.layer2]).toEqual({startSec:0.125,endSec:2.5});
  });
  it("글꼴: 설치 안 된 글꼴·없는 굵기는 거절, 저장값 그대로인 글꼴은 설치가 없어도 통과",async()=>{
    const handle=open(await migratedS4()),rev=revisionOf(handle),only=timelineService(handle,()=>ONLY_PRETENDARD),all=timelineService(handle),data=all.get(ids.main),base=data.timeline!,id=data.current!.id;
    const withFont=(family:TimelineText["style"]["fontFamily"],weight:number):Timeline=>({...base,text:base.text.map((layer,index)=>index===1?{...layer,style:{...layer.style,fontFamily:family,fontWeight:weight}}:layer)});
    expect(thrown(()=>only.save(ids.main,rev,id,withFont("Black Han Sans",400))).message).toBe(FONT_UNAVAILABLE);
    expect(thrown(()=>all.save(ids.main,rev,id,withFont("Black Han Sans",700))).message).toBe(FONT_WEIGHT_UNAVAILABLE);
    const saved=all.save(ids.main,rev,id,withFont("Black Han Sans",400));expect(saved.created).toBe(true);
    // Later the font is gone: a change to another text keeps the saved Black Han Sans text as it is.
    const now=all.get(ids.main),next={...now.timeline!,text:now.timeline!.text.map((layer,index)=>index===2?{...layer,content:"다른 자막"}:layer)};
    expect(only.save(ids.main,saved.revision,saved.timelineId,next)).toMatchObject({created:true});
    expect(all.get(ids.main).timeline!.text[1].style).toMatchObject({fontFamily:"Black Han Sans",fontWeight:400});
  });
  it("필수 표기(새로 필요해진 것): P1 모양 또는 spec 표기 모양 그대로·기획 전체 시간·새 id만, 섞인 모양·중복·기존 글자 id 재사용은 거절",async()=>{
    const handle=open(await migratedS4());
    // Temp copy only: the project now also needs "AI 생성", which the saved r1 does not have yet.
    const inputs=JSON.parse((handle.sqlite.prepare("SELECT inputs_json FROM projects WHERE id=?").get(ids.main) as {inputs_json:string}).inputs_json);
    handle.sqlite.prepare("UPDATE projects SET inputs_json=? WHERE id=?").run(JSON.stringify({...inputs,realisticAi:true}),ids.main);
    const rev=revisionOf(handle),timelines=timelineService(handle),data=timelines.get(ids.main),base=data.timeline!,id=data.current!.id;
    const planned=editingService(handle).get(ids.main).plannedFrames,fresh=newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:planned,content:"AI 생성",stack:1});
    const p1Look={...fresh,style:{...fresh.style,fontFamily:"Pretendard" as const,fontSize:64,fontWeight:700,color:"#FFFFFF",stroke:null,shadow:null,background:null,align:"center" as const,letterSpacing:0,lineHeight:1.3,maxLines:1},animation:{in:"none" as const,out:"none" as const,emphasis:"none" as const,durationFrames:0,easing:"ease-out" as const}};
    const add=(...layers:TimelineText[]):Timeline=>({...base,text:[...base.text,...layers]});
    expect(thrown(()=>timelines.save(ids.main,rev,id,base)).message).toMatch("필수 표기");
    for(const bad of [add({...fresh,style:{...fresh.style,fontSize:30}}),add({...fresh,style:{...fresh.style,color:"#000000"}}),add({...fresh,timing:{startFrame:0,endFrame:planned-30}}),add({...fresh,locked:false}),
      add({...p1Look,style:{...p1Look.style,shadow:{color:"#000000",opacity:1,blur:100,x:100,y:100}}}),add({...p1Look,animation:fresh.animation}),add(fresh,{...fresh,id:"019b8b74-0000-7000-8000-00000000a1a2"}),{...base,text:base.text.map((layer,index)=>index===1?{...fresh,id:layer.id}:layer)}])
      expect(thrown(()=>timelines.save(ids.main,rev,id,bad)).message).toMatch("필수 표기");
    expect(handle.sqlite.prepare("SELECT count(*) n FROM timeline_revisions").get()).toEqual({n:1});
    expect(timelines.save(ids.main,rev,id,add({...p1Look,box:{...p1Look.box,y:0.2}}))).toMatchObject({created:true});
  });
  it("필수 표기(새로 필요해진 것): spec 표기 모양으로도 만들 수 있음",async()=>{
    const handle=open(await migratedS4()),inputs=JSON.parse((handle.sqlite.prepare("SELECT inputs_json FROM projects WHERE id=?").get(ids.main) as {inputs_json:string}).inputs_json);
    handle.sqlite.prepare("UPDATE projects SET inputs_json=? WHERE id=?").run(JSON.stringify({...inputs,realisticAi:true}),ids.main);
    const rev=revisionOf(handle),timelines=timelineService(handle),data=timelines.get(ids.main),base=data.timeline!;
    const fresh=newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:editingService(handle).get(ids.main).plannedFrames,content:"AI 생성",stack:1});
    expect(timelines.save(ids.main,rev,data.current!.id,{...base,text:[...base.text,fresh]})).toMatchObject({created:true});
  });
  it("필수 표기(저장된 것, F085-2): 같은 id·box 외 전부 그대로여야 함 — P1 모양·spec 모양으로 바꾸기·id 바꿔치기도 거절, box만 저장, P1 크기 보존",async()=>{
    const handle=open(await migratedS4()),rev=revisionOf(handle),timelines=timelineService(handle),data=timelines.get(ids.main),base=data.timeline!,id=data.current!.id,old=base.text[0];
    expect(old).toMatchObject({kind:"disclosure",content:"광고",locked:true});expect(old.style.fontSize).not.toBe(64);
    const planned=editingService(handle).get(ids.main).plannedFrames,spec=newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:planned,content:"광고"});
    const swap=(layer:TimelineText):Timeline=>({...base,text:[layer,...base.text.slice(1)]}),rows0=JSON.stringify(rows(handle)),rev0=revisionOf(handle);
    for(const bad of [{...old,style:{...old.style,fontSize:64,color:"#FFFFFF",shadow:{color:"#000000",opacity:1,blur:100,x:100,y:100}}},{...old,style:{...old.style,fontSize:64,color:"#FFFFFF"},timing:{startFrame:0,endFrame:planned}},
      {...spec,id:old.id},{...spec},{...old,id:spec.id},{...old,content:"유료 광고 포함"},{...old,locked:false},{...old,kind:"subtitle" as const},{...old,animation:spec.animation},{...old,timing:{...old.timing,endFrame:old.timing.endFrame-1}},{...old,style:{...old.style,fontFamily:"Jua" as const,fontWeight:400}}])
      expect(thrown(()=>timelines.save(ids.main,rev,id,swap(bad))).message).toMatch("필수 표기");
    expect(thrown(()=>timelines.save(ids.main,rev,id,{...base,text:base.text.slice(1)})).message).toMatch("필수 표기");
    expect(thrown(()=>timelines.save(ids.main,rev,id,{...base,text:[...base.text,{...spec}]})).message).toMatch("필수 표기");
    expect(JSON.stringify(rows(handle))).toBe(rows0);expect(revisionOf(handle)).toBe(rev0);
    const saved=timelines.save(ids.main,rev,id,swap({...old,box:{...old.box,y:0.3}}));expect(saved).toMatchObject({created:true});
    expect(canonicalJson({...timelines.get(ids.main).timeline!.text[0],box:null})).toBe(canonicalJson({...old,box:null}));
    const [r1]=rows(handle);expect(timelineSha256(r1.timeline_json)).toBe(r1.timeline_sha256);expect(()=>checkTimelineRows(handle.sqlite)).not.toThrow();
  });
  it("글자만 바꿔 저장: 장면 결과·선택·자료 그대로, 새 타임라인·내용 버전, 검수 다시(잠김)",async()=>{
    const handle=open(await migratedS4()),rev=revisionOf(handle),timelines=timelineService(handle),data=timelines.get(ids.main);
    const scenes=()=>JSON.stringify([handle.sqlite.prepare("SELECT * FROM scene_versions ORDER BY id").all(),handle.sqlite.prepare("SELECT id,selected_version_id FROM scenes ORDER BY id").all(),handle.sqlite.prepare("SELECT * FROM assets ORDER BY id").all()]);
    const before=scenes(),next={...data.timeline!,video:data.clips,text:[...data.timeline!.text,newTextLayer("hook",{startFrame:0,videoFrames:300,plannedFrames:900,content:"새 훅"})]};
    const saved=timelines.save(ids.main,rev,data.current!.id,next);expect(saved).toMatchObject({created:true,revision:rev+1,timelineRevision:2});
    expect(scenes()).toBe(before);expect(handle.sqlite.prepare("SELECT status FROM stage_states WHERE project_id=? AND stage='review'").get(ids.main)).toEqual({status:"locked"});
    expect(timelines.save(ids.main,rev+1,saved.timelineId,timelines.get(ids.main).timeline!)).toMatchObject({created:false});
  });
  it("묶음: 옮긴 r1은 P1 배치 그대로(timeline.json·새 글꼴 없음), 새 버전은 timeline.json 원문과 쓴 글꼴·라이선스",async()=>{
    const handle=open(await migratedS4()),rev=revisionOf(handle),timelines=timelineService(handle),project=()=>jobsRepository(handle).project(ids.main)!;
    const layout=()=>{const value=project(),plan=jobsRepository(handle).plan(value.approvedPlanId!)!;return bundleLayout(handle,{project:value,plan,edit:timelines.editView(ids.main),revision:value.contentRevision,reviews:[],selected:[]});};
    const p1=layout();expect(p1.map(entry=>entry.path)).not.toContain("edit/timeline.json");expect(p1.some(entry=>entry.path.startsWith("fonts/")&&entry.path!=="fonts/PretendardVariable.woff2")).toBe(false);
    expect(p1.find(entry=>entry.path==="README.txt")).toMatchObject({text:expect.stringMatching(/^P1 편집용 묶음입니다\./)});
    const data=timelines.get(ids.main),next={...data.timeline!,text:data.timeline!.text.map((layer,index)=>index===1?{...layer,style:{...layer.style,fontFamily:"Noto Serif KR" as const,fontWeight:600}}:layer)};
    timelines.save(ids.main,rev,data.current!.id,next);const row=rows(handle).at(-1)!,entries=layout(),paths=entries.map(entry=>entry.path);
    const json=entries.find(entry=>entry.path==="edit/timeline.json");expect(json&&json.source==="text"?json.text:null).toBe(row.timeline_json);expect(timelineSha256(row.timeline_json)).toBe(row.timeline_sha256);
    expect(paths).toEqual(expect.arrayContaining(["fonts/PretendardVariable.woff2","LICENSES/Pretendard-OFL.txt","fonts/noto-serif-kr/NotoSerifKR[wght].ttf","LICENSES/noto-serif-kr-OFL.txt"]));
    const font=entries.find(entry=>entry.path==="fonts/noto-serif-kr/NotoSerifKR[wght].ttf");expect(font).toMatchObject({source:"file",mime:"font/ttf",filename:resolve("public/fonts/noto-serif-kr/NotoSerifKR[wght].ttf")});
    const license=entries.find(entry=>entry.path==="LICENSES/noto-serif-kr-OFL.txt");expect(license&&license.source==="text"?license.text:null).toBe(readFileSync("public/fonts/noto-serif-kr/OFL.txt","utf8"));
    expect(entries.find(entry=>entry.path==="README.txt")).toMatchObject({text:expect.stringMatching(/^편집용 묶음입니다\.[\s\S]*edit\/timeline\.json에 있어요/)});
    // text_overlays.json and the SRT stay on the P1-shaped view (same paths as before).
    expect(paths.filter(path=>path.startsWith("edit/")||path.startsWith("subtitles/"))).toEqual(["edit/text_overlays.json","subtitles/manual.srt","edit/timeline.json"]);
  });
});

describe("경계 (T-079 6.2-11)",()=>{
  it("글자 편집기 폴더는 서버 모듈·문서 전체 키 처리·쓰기 요청을 갖지 않고, 미리보기·실측은 같은 TextView를 쓴다",()=>{
    for(const name of readdirSync("components/text-editor").filter(file=>file.endsWith(".tsx"))){const source=readFileSync(join("components/text-editor",name),"utf8");
      expect(source).not.toMatch(/from "(server-only|@\/lib\/(db|repo|services|fonts)\/|node:|better-sqlite3)/);expect(source).not.toMatch(/(document|window)\.addEventListener\(\s*"key/);expect(source).not.toMatch(/fetch\(/);}
    const panel=readFileSync("components/editing-panel.tsx","utf8").replace(/\r\n/g,"\n");expect(panel).not.toMatch(/(document|window)\.addEventListener\(\s*"key/);expect(panel).not.toContain("Ctrl");
    expect(readFileSync("components/player/text-measure.tsx","utf8")).toContain("import { TextView } from \"./timeline-composition\"");
    // T-114: TextView moved to the shared core (preview and render draw the same text).
    const composition=readFileSync("components/player/composition-core.tsx","utf8");expect(composition).toContain("letterSpacing:`${style.letterSpacing}px`");expect(composition).toContain("`${style.stroke.width*2}px ${style.stroke.color}`");
    expect(presetFor("hook").style.letterSpacing).toBe(-1);
  });
});
