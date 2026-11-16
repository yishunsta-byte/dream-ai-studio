import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{},push:()=>{}})}));
import type { RenderView } from "@/lib/services/renders";
import { RenderPanel, type RendersData } from "@/components/render-panel/render-panel";
import { RenderEntry } from "@/components/render-panel/entry";
import { blockerLines, failureCopy, progressCopy, verifyReasons, canceledCopy, duration } from "@/components/render-panel/copy";

// The render screen from API values (T-102 3~9장, T-114 2장). Static HTML, no browser; the real flow is checked
// in the browser run of the T-117 report.
const base:RenderView={id:"r1",jobId:"j1",status:"succeeded",stage:null,progress:null,renderedFrames:900,totalFrames:900,createdAt:"2026-11-17T01:00:00.000Z",startedAt:"2026-11-17T01:00:01.000Z",finishedAt:"2026-11-17T01:01:00.000Z",elapsedSec:59,attempt:1,maxAttempts:3,cancelRequested:false,waiting:null,
  timelineRevision:5,contentRevision:7,stale:false,isSample:false,fileName:"핸드크림_9x16_r5.mp4",sizeBytes:13002342,fileExists:true,width:1080,height:1920,fps:30,codec:"h264",durationSec:30,audioStreams:0,
  verify:{result:"passed",items:[]},canceledLate:false,cleanupLeft:[],errorCode:null,errorMessage:null,error:null,subtitleMeasure:null,phonePlayback:null,textOnlyChange:null,etaSec:null,audioMode:"none",audio:null};
const view=(patch:Partial<RenderView>):RenderView=>({...base,...patch});
const data=(patch:Partial<RendersData>={}):RendersData=>({workerOnline:true,contentRevision:7,timelineId:"019b0000-0000-7000-8000-000000000001",check:{ready:true,blockers:[]},renders:[],...patch});
const html=(value:RendersData,saved:{revision:number;aspect:string}|null={revision:5,aspect:"9:16"})=>renderToStaticMarkup(createElement(RenderPanel,{projectId:"p1",data:value,saved}));
const text=(markup:string)=>markup.replace(/<[^>]+>/g," ").replace(/&quot;/g,"\"").replace(/&amp;/g,"&").replace(/\s+/g," ");

describe("영상 만들기 화면", ()=>{
  it("막는 이유를 전부, 장면은 묶어서, 갈 곳과 함께 보여 주고 버튼을 막는다", ()=>{
    const blockers=[
      {code:"RENDER_INPUT_MISSING" as const,params:{reason:"empty_slot" as const,sceneId:"s3",sceneNumber:3,sceneTitle:"마무리"}},
      {code:"RENDER_INPUT_MISSING" as const,params:{reason:"empty_slot" as const,sceneId:"s4",sceneNumber:4,sceneTitle:"끝"}},
      {code:"RENDER_INPUT_MISSING" as const,params:{reason:"file_missing" as const,sceneId:"s2",sceneNumber:2,sceneTitle:"사용"}},
      {code:"FONT_MISSING" as const,params:{family:"Do Hyeon",reason:"missing",texts:[{id:"t1",preview:"촉촉한 하루"},{id:"t2",preview:"끝"}]}},
      {code:"TIMELINE_STALE" as const,params:{scenes:[{sceneId:"s1",sceneTitle:"시작"}]}},
      {code:"RENDER_BROWSER_MISSING" as const,params:{reason:"mismatch" as const,version:"158.0.8127.2"}},
      {code:"DISK_FULL" as const,params:{where:"storage" as const,needBytes:2*1024**3,freeBytes:0.5*1024**3}},
    ];
    const lines=blockerLines(blockers);expect(lines).toHaveLength(6);
    const page=text(html(data({check:{ready:false,blockers}})));
    expect(page).toContain("만들기 전에 고칠 것 6개");
    expect(page).toContain("결과를 고르지 않은 장면이 2개 있어요: 장면 3, 장면 4.");
    expect(page).toContain("장면 2의 결과 파일을 찾지 못했어요.");
    expect(page).toContain('Do Hyeon 글꼴 파일을 찾지 못했어요. 이 글꼴을 쓰는 글자: "촉촉한 하루" 외 1개.');
    expect(page).toContain("정해진 버전(158.0.8127.2)");
    expect(page).toContain("필요 약 2.0GB · 남은 0.5GB");
    expect(page).toContain("위 이유를 고치면 만들 수 있어요.");
    const markup=html(data({check:{ready:false,blockers}}));
    expect(markup).toContain('href="/projects/p1/produce"');expect(markup).toContain('href="/projects/p1/edit"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>영상 만들기<\/button>/);
    expect(blockerLines([{code:"RENDER_INPUT_MISSING",params:{reason:"no_timeline"}}])[0]).toMatchObject({text:"아직 저장한 타임라인이 없어요. 편집에서 한 번 저장해 주세요.",link:"edit"});
  });
  it("막는 이유가 없으면 버튼을 켜고, 처리기가 꺼져 있으면 알려 준다", ()=>{
    const markup=html(data({workerOnline:false}));
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>영상 만들기<\/button>/);expect(markup).not.toMatch(/disabled=""[^>]*>영상 만들기/);
    expect(text(markup)).toContain("작업 처리기가 꺼져 있어요. 지금 요청해 두면 처리기가 켜질 때 시작해요.");
    expect(text(markup)).toContain("저장한 타임라인 r5 · 9:16으로 만들어요");
    expect(text(markup)).toContain("아직 만든 영상이 없어요");
    expect(text(markup)).toContain("소리를 붙이는 단계(P2-5)와 자막 파일(P2-6)이 끝나면 열려요");
  });
  it("대기·처리기 꺼짐·다른 작업 뒤·다시 시작·취소 중 문구가 서버 값 그대로다", ()=>{
    const queued=view({status:"queued",finishedAt:null,startedAt:null,elapsedSec:null,attempt:0,verify:null,sizeBytes:null,fileExists:false,codec:null,audioStreams:null});
    expect(progressCopy({...queued,waiting:{reason:"worker_off"}}).body).toBe("작업 처리기가 켜지면 시작해요. 창을 닫아도 작업은 남아 있어요.");
    expect(progressCopy({...queued,waiting:{reason:"behind_job",kind:"image"}}).body).toBe("다른 작업(장면 이미지 만들기)이 끝나면 시작해요.");
    expect(progressCopy({...queued,attempt:1}).pill).toBe("다시 시작해요 · 2/3번째");
    expect(progressCopy({...queued,cancelRequested:true})).toEqual({pill:"취소하는 중",body:"지금 단계가 끝나는 대로 멈춰요."});
    const page=html(data({check:{ready:false,blockers:[{code:"RENDER_ACTIVE",params:{renderId:"r1"}}]},renders:[{...queued,waiting:{reason:"worker_off"}}]}));
    expect(text(page)).toContain("영상 만드는 중 · 타임라인 r5 · 9:16");expect(text(page)).toContain("이 내용으로 만들고 있어요.");
    expect(page).not.toContain("<progress");expect(page).toContain('tabindex="-1"');
  });
  it("합치는 중은 프레임 기준 막대, 파일 확인 중은 퍼센트 없이 '확인 중'이고 live 글은 비어 있다", ()=>{
    const compose=view({status:"running",stage:"compose",progress:0.64,renderedFrames:576,finishedAt:null,elapsedSec:100,verify:null,fileExists:false});
    const markup=html(data({renders:[compose]}));
    expect(markup).toMatch(/<progress[^>]*max="100"[^>]*value="64"[^>]*aria-valuetext="64% · 1분 40초 지남"/);
    expect(text(markup)).toContain("끝남: 1. 준비");expect(text(markup)).toContain("지금: 2. 장면과 글자 합치기");expect(text(markup)).toContain("남음: 3. 파일 확인");
    expect(markup).toMatch(/<p class="sr-only" aria-live="polite"><\/p>/);expect(markup.match(/aria-live/g)).toHaveLength(1);
    const verify=html(data({renders:[{...compose,stage:"verify",progress:null}]}));
    expect(verify).not.toContain("<progress");expect(text(verify)).toContain("확인 중");expect(text(verify)).not.toMatch(/100%/);
    expect(text(verify)).toContain("확인을 통과해야 완성으로 쳐요.");
  });
  it("확인 통과 행만 재생·내려받기가 있고, 크기·소리 없음·측정 전·확인 전을 보여 준다", ()=>{
    const markup=html(data({renders:[base]})),page=text(markup);
    expect(page).toContain("파일 확인 통과");expect(page).toContain("1080×1920 · 30.0초 · H.264 · 30fps · 소리 없음 · 다음 단계에서 붙여요");
    expect(page).toContain("확인 안 한 것: 자막 표시 오차 측정 전 · 휴대폰 재생 확인 전");
    expect(page).toContain("영상 보기");expect(markup).not.toContain(">재생<");
    expect(markup).toContain('href="/api/renders/r1/file?download"');expect(page).toContain("내려받기 · 12.4MB");expect(markup).toContain('download="핸드크림_9x16_r5.mp4"');
    expect(markup).toContain('aria-expanded="false"');expect(page).not.toContain("완성 영상이에요");
  });
  it("예전 버전은 보관만, 샘플은 표시, 파일이 없으면 오류로 보여 준다", ()=>{
    const page=text(html(data({renders:[view({id:"r2",stale:true,isSample:true,fileName:"핸드크림_9x16_r4_SAMPLE.mp4",timelineRevision:4}),view({id:"r3",fileExists:false})]})));
    expect(page).toContain("지금 내용과 다름 · 타임라인 r4");expect(page).toContain("보관만 해요.");expect(page).toContain("지금 내용으로 만들기");expect(page).toContain("샘플");
    expect(page).toContain("파일 없음");expect(page).toContain("영상 파일을 찾지 못했어요. 백업에 함께 들어가는 파일이라 원래 있어야 해요.");
  });
  it("확인 실패는 실패 행이고 틀린 항목을 말하며 재생·받기가 없다", ()=>{
    const items=[{item:"colorRange",expected:"tv",actual:null,pass:false},{item:"colorSpace",expected:"bt709",actual:null,pass:false},{item:"durationSec",expected:30,actual:29.2,pass:false},{item:"width",expected:1080,actual:1080,pass:true},{item:"audioStreams",expected:0,actual:1,pass:false}];
    expect(verifyReasons(items)).toEqual(["색 정보 표시가 기준(bt709·tv)과 달라요","길이가 30초가 아니라 29.2초예요","소리 트랙이 들어 있어요(소리 없는 영상이어야 해요)"]);
    const failed=view({status:"failed",errorCode:"RENDER_VERIFY_FAILED",verify:{result:"failed",items},error:{code:"RENDER_VERIFY_FAILED",retryable:false,attempts:1,maxAttempts:3},fileExists:false,sizeBytes:null});
    const markup=html(data({renders:[failed]})),page=text(markup);
    expect(page).toContain("파일은 만들었지만 색 정보 표시가 기준(bt709·tv)과 달라요, 길이가 30초가 아니라 29.2초예요");expect(page).toContain("그래서 완성으로 치지 않았어요.");
    expect(page).toContain("RENDER_VERIFY_FAILED · 1/3번 시도");expect(page).toContain("다시 만들기");
    expect(markup).not.toContain("/file?download");expect(page).not.toContain("파일 확인 통과");expect(markup).not.toContain(">영상 보기<");
  });
  it("실패 문구는 원인·자동 재시도 횟수를 따르고, 취소는 정리 결과를 말한다", ()=>{
    const failed=(code:string,attempts:number,message:string|null=null)=>view({status:"failed",errorCode:code,errorMessage:message,error:{code,retryable:code==="RENDER_BROWSER_CRASHED"||code==="STORAGE_FAILED",attempts,maxAttempts:3}});
    expect(failureCopy(failed("RENDER_BROWSER_CRASHED",3))).toEqual({text:"영상 만들기 도구가 3번 멈춰서 그만뒀어요. PC를 다시 켠 뒤 다시 만들어 주세요.",autoRetried:true});
    expect(failureCopy(failed("STORAGE_FAILED",3)).text).toBe("영상 파일을 저장하지 못했어요(3번 시도). 잠시 뒤 다시 만들어 주세요.");
    expect(failureCopy(failed("DISK_FULL",1)).text).toContain("공간을 비운 뒤 다시 만들기를 눌러 주세요");
    expect(failureCopy(failed("RENDER_INPUT_CHANGED",1)).text).toBe("만드는 동안 장면 파일이 바뀌어 멈췄어요. 다시 만들어 주세요.");
    expect(failureCopy(failed("TIMEOUT",1)).text).toBe("30분 안에 끝나지 않아 멈췄어요. 이미 만든 영상은 그대로예요.");
    expect(failureCopy(failed("RENDER_INTERRUPTED",3)).text).toContain("3번 중단돼");
    expect(canceledCopy(view({status:"canceled"}))).toBe("취소했어요. 만들던 임시 파일은 정리했어요. 이미 만든 영상은 그대로예요.");
    expect(canceledCopy(view({status:"canceled",cleanupLeft:["storage/tmp/render-x-1"]}))).toContain("임시 파일을 정리하지 못했어요: storage/tmp/render-x-1");
    const lateMarkup=html(data({renders:[view({status:"canceled",canceledLate:true,verify:{result:"passed",items:[]}})]})),late=text(lateMarkup);
    expect(late).toContain("취소 뒤 끝남");expect(late).toContain("보관만 하고 자동으로 쓰지 않아요");expect(lateMarkup).not.toContain("/file");
    expect(duration(100)).toBe("1분 40초");expect(duration(59)).toBe("59초");
  });
  it("편집 진입 버튼은 저장하지 않은 변경이 있으면 막힌다", ()=>{
    expect(renderToStaticMarkup(createElement(RenderEntry,{projectId:"p1",dirty:false}))).toContain('href="/projects/p1/render"');
    const blocked=renderToStaticMarkup(createElement(RenderEntry,{projectId:"p1",dirty:true}));
    expect(blocked).toContain("disabled");expect(blocked).toContain("저장하지 않은 변경이 있어요");
  });
  it("새 토큰·전역 스타일 없이 기존 토큰만 쓰고 터치 높이를 지킨다", ()=>{
    const css=readFileSync(new URL("../components/render-panel/render-panel.module.css",import.meta.url),"utf8");
    const tokens=new Set(readFileSync(new URL("../docs/design/tokens.css",import.meta.url),"utf8").match(/--[a-z0-9-]+(?=:)/g));
    for(const used of css.match(/var\((--[a-z0-9-]+)\)/g)??[])expect(tokens.has(used.slice(4,-1))).toBe(true);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);expect(css).toContain("min-height:var(--touch-min)");expect(css).toContain("overflow-wrap:anywhere");
  });
});
