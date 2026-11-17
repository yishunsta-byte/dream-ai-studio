// T-175 (T126 C3): the render progress shows the server attempt count as it is. A queued render that has not started
// (attempt 0) is not "시도 1/3"; a queued retry names the next attempt (same as its pill); a running one its own.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{},push:()=>{}})}));
import type { RenderView } from "@/lib/services/renders";
import { RenderPanel, type RendersData } from "@/components/render-panel/render-panel";
import { attemptLine, progressCopy } from "@/components/render-panel/copy";

const base:RenderView={id:"r1",jobId:"j1",status:"queued",stage:null,progress:null,renderedFrames:0,totalFrames:900,createdAt:"2026-11-17T01:00:00.000Z",startedAt:null,finishedAt:null,elapsedSec:null,attempt:0,maxAttempts:3,cancelRequested:false,waiting:null,
  timelineRevision:5,contentRevision:7,stale:false,isSample:false,fileName:"핸드크림_9x16_r5.mp4",sizeBytes:null,fileExists:false,width:1080,height:1920,fps:30,codec:null,durationSec:30,audioStreams:null,
  verify:null,canceledLate:false,cleanupLeft:[],errorCode:null,errorMessage:null,error:null,subtitleMeasure:null,phonePlayback:null,textOnlyChange:null,etaSec:null,audioMode:"none",audio:null};
const view=(patch:Partial<RenderView>):RenderView=>({...base,...patch});
const page=(render:RenderView)=>renderToStaticMarkup(createElement(RenderPanel,{projectId:"p1",saved:{revision:5,aspect:"9:16",audioMode:"none",audioClips:0},
  data:{workerOnline:true,contentRevision:7,timelineId:"019b0000-0000-7000-8000-000000000001",check:{ready:false,blockers:[{code:"RENDER_ACTIVE",params:{renderId:"r1"}}]},renders:[render]} satisfies RendersData})).replace(/<[^>]+>/g," ").replace(/\s+/g," ");

describe("영상 만들기 진행 칸의 시도 표시",()=>{
  it("한 번도 시작하지 않은 대기(시도 0)는 '시도 1/3'이 아니라 시작 전이다",()=>{
    const queued=view({});expect(attemptLine(queued)).toBe("아직 시작 전 · 최대 3번 시도");
    const text=page(queued);expect(text).toContain("아직 시작 전 · 최대 3번 시도");expect(text).not.toMatch(/시도 \d\/3/);
    expect(page(view({waiting:{reason:"worker_off"}}))).toContain("아직 시작 전 · 최대 3번 시도");
  });
  it("다시 기다리는 렌더는 다음 시도를 말하고 알약 문구와 같은 번호다",()=>{
    const retry=view({attempt:1});expect(attemptLine(retry)).toBe("다음 시도 2/3");expect(progressCopy(retry).pill).toBe("다시 시작해요 · 2/3번째");
    expect(page(retry)).toContain("다음 시도 2/3");expect(attemptLine(view({attempt:2}))).toBe("다음 시도 3/3");
  });
  it("만드는 중은 지금 시도 번호 그대로다",()=>{
    const running=view({status:"running",stage:"compose",progress:0.5,startedAt:"2026-11-17T01:00:01.000Z",elapsedSec:10,attempt:2});
    expect(attemptLine(running)).toBe("시도 2/3");expect(page(running)).toContain("시도 2/3");
    expect(attemptLine(view({status:"running",attempt:1}))).toBe("시도 1/3");
  });
});
