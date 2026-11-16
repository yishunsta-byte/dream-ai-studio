// T-086 (T-084 B-1·B-2): font states in the browser with a fake FontFace — a big file past 20 s is "timeout" and is
// updated when it arrives late, a failed file is "failed" and is fetched again on retry, a font that is not selectable
// is "unavailable" without a fetch. Also the beyond-video rule for locked required disclosures.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FontRef } from "@/lib/edit/fonts";
import { beyondVideo, newTextLayer } from "@/lib/edit/text-ops";

type Pending={family:string;url:string;resolve:()=>void;reject:()=>void};
let pending:Pending[]=[];const added:string[]=[];
class FakeFontFace{family:string;url:string;status="unloaded";constructor(family:string,source:string){this.family=family;this.url=source;}
  load(){return new Promise<FakeFontFace>((resolve,reject)=>pending.push({family:this.family,url:this.url,resolve:()=>{this.status="loaded";resolve(this);},reject}));}}
const font=(family:string):FontRef=>({family:family as FontRef["family"],role:"",weights:[400,700],url:`/fonts/${family}.ttf`});
const FONTS=[font("Noto Serif KR"),font("Jua")];
let loader:typeof import("@/components/player/font-loader");
beforeEach(async()=>{vi.useFakeTimers();pending=[];added.length=0;vi.resetModules();
  vi.stubGlobal("FontFace",FakeFontFace);
  vi.stubGlobal("document",{fonts:{add:(face:FakeFontFace)=>added.push(face.family),load:async(spec:string)=>added.some(family=>spec.includes(`"${family}"`))?[{status:"loaded"}]:[]},documentElement:{}});
  loader=await import("@/components/player/font-loader");});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const uses=(...families:string[])=>new Map(families.map(family=>[family,[400]]));

describe("글꼴 상태 (가짜 FontFace)",()=>{
  it("20초 안에 안 오면 timeout, 늦게 도착하면 결과 뒤에 ok로 알려 줌",async()=>{
    const late:[string,string][]=[],result=loader.loadFonts(uses("Noto Serif KR"),FONTS,(family,state)=>late.push([family,state]));
    await vi.advanceTimersByTimeAsync(loader.FONT_TIMEOUT_MS);expect(await result).toEqual({"Noto Serif KR":"timeout"});expect(late).toEqual([]);
    pending[0].resolve();await vi.advanceTimersByTimeAsync(0);expect(late).toEqual([["Noto Serif KR","ok"]]);
  });
  it("늦게 실패하면 failed로 알려 주고, 다시 불러오면 파일을 새로 받음",async()=>{
    const late:[string,string][]=[],result=loader.loadFonts(uses("Jua"),FONTS,(family,state)=>late.push([family,state]));
    await vi.advanceTimersByTimeAsync(loader.FONT_TIMEOUT_MS);expect(await result).toEqual({Jua:"timeout"});
    pending[0].reject();await vi.advanceTimersByTimeAsync(0);expect(late).toEqual([["Jua","failed"]]);
    const again=loader.loadFonts(uses("Jua"),FONTS);await vi.advanceTimersByTimeAsync(0);expect(pending).toHaveLength(2);
    pending[1].resolve();await vi.advanceTimersByTimeAsync(0);expect(await again).toEqual({Jua:"ok"});
  });
  it("바로 실패는 failed, 고를 수 없는 글꼴은 받지 않고 unavailable, 받는 중인 파일은 한 번만 받음",async()=>{
    const first=loader.loadFonts(uses("Jua","Do Hyeon"),FONTS),second=loader.loadFonts(uses("Jua"),FONTS);await vi.advanceTimersByTimeAsync(0);
    expect(pending.map(item=>item.family)).toEqual(["Jua"]);pending[0].reject();await vi.advanceTimersByTimeAsync(0);
    expect(await first).toEqual({Jua:"failed","Do Hyeon":"unavailable"});expect(await second).toEqual({Jua:"failed"});
  });
  it("20초 전에 끝난 글꼴은 그 자리에서 ok (늦은 알림 없음)",async()=>{
    const late=vi.fn(),result=loader.loadFonts(uses("Noto Serif KR"),FONTS,late);await vi.advanceTimersByTimeAsync(5000);
    pending[0].resolve();await vi.advanceTimersByTimeAsync(0);expect(await result).toEqual({"Noto Serif KR":"ok"});
    await vi.advanceTimersByTimeAsync(loader.FONT_TIMEOUT_MS);expect(late).not.toHaveBeenCalled();
  });
  it("화면 문구: '미리보기를 다시 불러와 보세요' 없음, 실패에만 '글꼴 다시 불러오기', 미리보기와 실측이 같은 상태 훅을 씀",()=>{
    const panel=readFileSync("components/player/player-panel.tsx","utf8"),measure=readFileSync("components/player/text-measure.tsx","utf8");
    expect(panel).not.toContain("미리보기를 다시 불러와 보세요");expect(panel).toContain("글꼴을 아직 다 불러오지 못했어요.");expect(panel).toContain("다 받으면 저절로 바뀌어요.");
    expect(panel).toMatch(/named\("failed"\)[^\n]*onClick=\{retryFonts\}>글꼴 다시 불러오기/);expect(panel).not.toMatch(/named\("timeout"\)[^\n]*retryFonts/);
    expect(panel).toContain("useFontStates(");expect(measure).toContain("useFontStates(");
  });
});

describe("영상보다 긴 글자 (T-084 B-2)",()=>{
  it("잠긴 필수 표기는 기획 길이가 영상보다 길어도 경고하지 않고, 일반 글자는 경고",()=>{
    const disclosure=newTextLayer("disclosure",{startFrame:0,videoFrames:0,plannedFrames:900,content:"광고"}),subtitle={...newTextLayer("subtitle",{startFrame:0,videoFrames:900,plannedFrames:900,content:"가"}),timing:{startFrame:0,endFrame:900}};
    expect(beyondVideo(disclosure,270)).toBe(false);expect(beyondVideo(subtitle,270)).toBe(true);expect(beyondVideo(subtitle,900)).toBe(false);
    const editor=readFileSync("components/text-editor/text-editor.tsx","utf8"),panel=readFileSync("components/editing-panel.tsx","utf8");
    expect(editor).toContain("표기는 기획 길이만큼 보여요. 영상이 이보다 짧아도 고칠 것은 없어요.");expect(panel).toContain("beyond:beyondVideo(layer,videoFrames)");
    expect(editor).toContain("문구를 적으면 줄 수를 알려 드려요.");
  });
});
