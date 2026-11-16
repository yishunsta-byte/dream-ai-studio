// T-119: the shared ConfirmPanel keeps "취소" unless a screen names its close button (the render cancel confirm says
// "계속 만들기" / "취소하기"), and other job screens say "영상 만드는 중이라 기다려요" only when the jobs API says the
// queued job waits for a render (blockedBy "render"). Static HTML, no browser; the live flow is in the T-119 report.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{},push:()=>{}})}));
import { ConfirmPanel, ToastProvider } from "@/components/ui/interactive";
import { RenderWaitNote, renderWait } from "@/components/render-panel/render-wait";
import { JobsPanel } from "@/components/jobs-panel";
import type { JobsData } from "@/lib/services/jobs";

const text=(markup:string)=>markup.replace(/<[^>]+>/g," ").replace(/\s+/g," ");
type Job=JobsData["jobs"][number];
const job=(patch:Partial<Job>):Job=>({id:"j",status:"queued",projectId:"p1",projectTitle:"텀블러",sceneTitle:"장면 1",kind:"image",attempts:0,createdAt:"2026-11-17T01:00:00.000Z",finishedAt:null,cancelRequested:false,errorCode:null,errorMessage:null,retryable:false,blockedBy:null,provider:"mock",late:false,...patch} as Job);
const render=job({id:"r",status:"running",kind:"render",projectId:"p2",projectTitle:"핸드크림",sceneTitle:"영상 만들기",attempts:1});

describe("ConfirmPanel 닫기 버튼 이름",()=>{
  const panel=(extra:Record<string,unknown>={})=>renderToStaticMarkup(createElement(ConfirmPanel,{open:false,onDismiss:()=>{},onConfirm:()=>{},title:"보관할까요?",description:"설명",confirmLabel:"보관하기",...extra}));
  it("기존 사용처는 그대로 '취소'",()=>{const html=text(panel());expect(html).toContain("취소");expect(html).toContain("보관하기");expect(html).not.toContain("계속 만들기");});
  it("closeLabel을 주면 그 이름만 바뀐다",()=>{const html=text(panel({closeLabel:"계속 만들기",confirmLabel:"취소하기",tone:"danger"}));
    expect(html).toContain("계속 만들기");expect(html).toContain("취소하기");expect(html.replace("취소하기","")).not.toMatch(/(^|\s)취소(\s|$)/);});
});

describe("영상 대기 표시는 서버 값만 쓴다",()=>{
  it("queued·render 아닌 작업·blockedBy render일 때만, 실행 중 렌더의 프로젝트로 링크한다",()=>{
    const waiting=job({id:"a",blockedBy:"render"});
    expect(renderWait([render,waiting],"a")).toEqual({projectId:"p2",projectTitle:"핸드크림"});
    expect(renderWait([render,job({id:"a",blockedBy:"image"})],"a")).toBeNull();
    expect(renderWait([render,job({id:"a",blockedBy:null})],"a")).toBeNull();
    expect(renderWait([render,job({id:"a",status:"running",blockedBy:"render"})],"a")).toBeNull();
    expect(renderWait([render,job({id:"a",kind:"render",blockedBy:"render"})],"a")).toBeNull();
    expect(renderWait([render],"none")).toBeNull();
    // the server says render but the running row is not in the list: the note shows without a guessed link
    expect(renderWait([waiting],"a")).toEqual({projectId:null,projectTitle:null});
  });
  it("문구와 진행 화면 링크, 다른 프로젝트면 이름을 붙인다",()=>{
    const same=renderToStaticMarkup(createElement(RenderWaitNote,{wait:{projectId:"p2",projectTitle:"핸드크림"},currentProjectId:"p2"}));
    expect(text(same)).toContain("영상 만드는 중이라 기다려요. 영상이 끝나면 이어서 시작해요.");expect(same).toContain('href="/projects/p2/render"');expect(text(same)).not.toContain("(핸드크림)");
    const other=renderToStaticMarkup(createElement(RenderWaitNote,{wait:{projectId:"p2",projectTitle:"핸드크림"},currentProjectId:"p1"}));expect(text(other)).toContain("영상 만들기 진행 보기 (핸드크림)");
    const unknown=renderToStaticMarkup(createElement(RenderWaitNote,{wait:{projectId:null,projectTitle:null}}));expect(unknown).not.toContain("href");
  });
  it("작업 화면: 대기 카드에 안내, 렌더 작업은 '소리 없는 영상'과 영상 만들기 링크",()=>{
    const data={workerOnline:true,jobs:[render,job({id:"a",blockedBy:"render"}),job({id:"b",blockedBy:"image",sceneTitle:"장면 2"})]} as JobsData;
    const html=renderToStaticMarkup(createElement(ToastProvider,null,createElement(JobsPanel,{initial:data})));
    expect(text(html).match(/영상 만드는 중이라 기다려요/g)?.length).toBe(1);
    expect(html).toContain('href="/projects/p2/render"');expect(text(html)).toContain("소리 없는 영상");expect(text(html)).not.toMatch(/영상 만들기[^가-힣]*음성/);
  });
});
