import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{},push:()=>{}})}));
import type { RenderView } from "@/lib/services/renders";
import { RenderPanel, type SavedRenderTimeline } from "@/components/render-panel/render-panel";
import { announceStage, audioResultCopy, progressCopy, stagesFor } from "@/components/render-panel/copy";

const base:RenderView={id:"audio-result",jobId:"job",status:"succeeded",stage:null,progress:null,renderedFrames:900,totalFrames:900,createdAt:"2026-11-17T00:00:00Z",startedAt:"2026-11-17T00:00:00Z",finishedAt:"2026-11-17T00:01:00Z",elapsedSec:60,attempt:1,maxAttempts:3,cancelRequested:false,waiting:null,timelineRevision:3,contentRevision:5,stale:false,isSample:false,fileName:"audio.mp4",sizeBytes:1024,fileExists:true,width:1080,height:1920,fps:30,codec:"h264",durationSec:30,audioStreams:1,verify:{result:"passed",items:[]},canceledLate:false,cleanupLeft:[],errorCode:null,errorMessage:null,error:null,subtitleMeasure:null,phonePlayback:null,textOnlyChange:false,etaSec:null,audioMode:"aac",audio:{status:"normalized",accepted:true,integrated:-14.3,truePeak:-3.7,range:0,target:{integrated:-14,tolerance:1,truePeakMax:-1},profile:"p2-5-local-v1",ffmpeg:"test-tool",clips:2,hasMusic:true}};
const saved:SavedRenderTimeline={revision:3,aspect:"9:16",audioMode:"aac",audioClips:2};
const html=(renders:RenderView[],timeline=saved)=>renderToStaticMarkup(createElement(RenderPanel,{projectId:"p",saved:timeline,data:{workerOnline:true,contentRevision:5,timelineId:"t",check:{ready:true,blockers:[]},renders}}));
const plain=(value:string)=>value.replace(/<[^>]*>/g," ").replace(/\s+/g," ");

describe("T147 audio render UI",()=>{
  it("AAC compose stays indeterminate even with an old frame percentage/ETA",()=>{
    const running:RenderView={...base,status:"running",stage:"compose",progress:0.8,etaSec:0,verify:null,audio:null,finishedAt:null};
    const markup=html([running]),text=plain(markup);
    expect(text).toContain("장면·글자·소리 합치는 중");
    expect(text).toContain("지금: 2. 장면·글자·소리 합치기");
    expect(text).toContain("지난 시간 1분");
    expect(markup).not.toContain("<progress");
    expect(text).not.toContain("80%");expect(text).not.toContain("남은 시간");
    expect(progressCopy(running).pill).not.toContain("준비");
    expect(announceStage(running)).toContain("소리 합치기");
    expect(stagesFor(running).map(stage=>stage.key)).toEqual(["prepare","compose","verify"]);
  });
  it("AAC prepare/verify, queue and cancellation retain their distinct priority",()=>{
    expect(progressCopy({...base,stage:"prepare"}).body).toContain("소리 파일을 준비");
    expect(progressCopy({...base,stage:"verify"}).pill).toBe("파일과 소리 확인 중");
    expect(announceStage({...base,stage:"verify"})).toBe("파일과 소리를 확인하고 있어요.");
    expect(progressCopy({...base,status:"queued",stage:"compose",attempt:0,waiting:{reason:"worker_off"}}).body).toContain("작업 처리기가 켜지면");
    expect(progressCopy({...base,status:"running",stage:"compose",cancelRequested:true}).pill).toBe("취소하는 중");
  });
  it("saved mode is independent of historic rows and describes unsupported v1 honestly",()=>{
    const silent={...base,audioMode:"none" as const,audioStreams:0,audio:null};
    expect(plain(html([silent]))).toContain("저장한 소리 2개를 함께 합쳐요");
    expect(plain(html([base],{...saved,audioMode:"none",audioClips:0}))).toContain("저장한 타임라인으로 소리 없는 영상을 만들어요");
    expect(plain(html([],{...saved,audioMode:"unsupported"}))).toContain("예전 형식의 소리 설정");
    expect(plain(html([base]))).not.toContain("소리는 다음 단계에서 붙여요");
  });
  it("normalized uses actual measurements, target remains separate and failures get no success badge",()=>{
    const text=plain(html([base]));
    expect(text).toContain("음량 기준 충족 · 측정 음량 -14.3 LUFS · 최대 피크 -3.7 dBTP");
    expect(text).toContain("기준: 음량 -14 LUFS ±1 LU · 최대 피크 -1 dBTP");
    expect(text).toContain("AAC · 소리 1트랙");
    const failed=html([{...base,status:"failed",audio:null,verify:null,errorCode:"AUDIO_LOUDNESS_FAILED",fileExists:false}]);
    expect(failed).not.toContain("음량 기준 충족");expect(failed).not.toContain("/file?download");expect(failed).not.toContain("측정 음량");
  });
  it.each(["silent","too_short"] as const)("%s accepted null is usable, without a normalized badge",status=>{
    const render={...base,audio:{...base.audio!,status,accepted:null,integrated:null,truePeak:null,range:null}};
    const markup=html([render]),text=plain(markup);
    expect(text).toContain(status==="silent"?"소리 트랙 포함 · 무음 신호":"소리 포함 · 3초 미만");
    expect(text).not.toContain("음량 기준 충족");expect(text).not.toContain("0.0 LUFS");
    expect(markup).toContain("/file?download");
  });
  it("missing, null and non-finite measurements are never fabricated as success or zero",()=>{
    for(const audio of [null,{...base.audio!,status:null,accepted:null,integrated:null,truePeak:null},{...base.audio!,integrated:NaN,truePeak:Infinity}]){
      const copy=audioResultCopy({...base,audio});
      expect(copy.summary).toBe("최종 음량 · 측정 전/기록 없음");
      expect(copy.measurement??"").not.toMatch(/NaN|Infinity|0.0/);
    }
    expect(audioResultCopy({...base,verify:null}).badge).toBe("소리 확인 전");
  });
  it("none has no loudness claim; cleanup warning preserves usable output; late and missing stay unavailable",()=>{
    expect(audioResultCopy({...base,audioMode:"none",audioStreams:0,audio:null})).toMatchObject({badge:"소리 트랙 없음",summary:"음량 맞춤 · 해당 없음",measurement:null});
    const cleanup=html([{...base,cleanupLeft:["tmp/owned-file"]}]);
    expect(plain(cleanup)).toContain("영상은 만들었지만 임시 파일 정리를 확인해 주세요");expect(cleanup).toContain("/file?download");
    for(const patch of [{canceledLate:true},{fileExists:false}]){
      const markup=html([{...base,...patch}]);expect(markup).not.toContain("/file?download");expect(markup).not.toContain(">영상 보기<");
    }
    expect(plain(cleanup)).toContain("휴대폰 재생 확인 전");
    expect(plain(cleanup)).toContain("남은 단계의 확인이 끝나면 열려요");
  });
});
