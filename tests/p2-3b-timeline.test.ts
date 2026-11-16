// T-090 P2-3b timeline text row: time edits (move keeps length, end only, 0..limit, at least one frame), one key = one
// action (a clip key never seeks, the position bar never changes a text — T-033 3.3 1-1, T-091 TL-5), ruler steps,
// the frame store, and the boundaries (no page-wide keys, no server code, no fetch in the row).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { barKeyAction, clipKeyAction, rulerSteps, shiftTiming } from "@/lib/edit/text-ops";
import { createFrameStore } from "@/components/player/frame-store";

const key=(name:string,mods:Partial<{shiftKey:boolean;altKey:boolean;ctrlKey:boolean;metaKey:boolean}>={})=>({key:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,...mods});
const t=(startFrame:number,endFrame:number)=>({startFrame,endFrame});

describe("시간 바꾸기 (shiftTiming)",()=>{
  it("옮기기: 길이 그대로, 0과 상한에서 멈춤, 못 움직이면 같은 객체",()=>{
    expect(shiftTiming(t(30,90),1,"move",900)).toEqual(t(31,91));expect(shiftTiming(t(30,90),-30,"move",900)).toEqual(t(0,60));
    expect(shiftTiming(t(30,90),-100,"move",900)).toEqual(t(0,60));expect(shiftTiming(t(840,900),5,"move",900)).toEqual(t(840,900));
    const at0=t(0,60);expect(shiftTiming(at0,-1,"move",900)).toBe(at0);const atEnd=t(840,900);expect(shiftTiming(atEnd,1,"move",900)).toBe(atEnd);
  });
  it("끝만: 시작 그대로, 최소 1프레임, 상한까지",()=>{
    expect(shiftTiming(t(30,90),30,"end",900)).toEqual(t(30,120));expect(shiftTiming(t(30,90),-100,"end",900)).toEqual(t(30,31));
    expect(shiftTiming(t(30,890),30,"end",900)).toEqual(t(30,900));const one=t(30,31);expect(shiftTiming(one,-1,"end",900)).toBe(one);
  });
  it("P1에서 옮긴 상한 밖 글자는 처음 옮길 때 안으로 들어오고, 상한보다 긴 글자는 옮기지 않음",()=>{
    expect(shiftTiming(t(800,950),-1,"move",900)).toEqual(t(750,900));expect(shiftTiming(t(800,950),1,"end",900)).toEqual(t(800,900));
    const long=t(0,1000);expect(shiftTiming(long,-1,"move",900)).toBe(long);
  });
});

describe("한 키 = 한 동작 (T-033 1-1, T-091 TL-5·TL-7·TL-8)",()=>{
  const arrows=["ArrowLeft","ArrowRight"],mods=[{},{shiftKey:true},{altKey:true},{altKey:true,shiftKey:true}];
  it("고른 클립의 ←/→는 시간만(재생 위치 이동 없음), 잠긴 표기는 시간도 그대로",()=>{
    for(const arrow of arrows)for(const mod of mods){const action=clipKeyAction(key(arrow,mod),false,false)!;expect(action.type).toBe("move");
      const sign=arrow==="ArrowLeft"?-1:1;expect(action).toEqual({type:"move",mode:mod.altKey?"end":"move",delta:sign*(mod.shiftKey?30:1)});
      expect(clipKeyAction(key(arrow,mod),true,false)).toEqual({type:"locked"});}
  });
  it("재생 위치 막대의 키는 seek·재생만(글자 시간 없음), 범위 안",()=>{
    for(const arrow of arrows)for(const mod of [{},{shiftKey:true}]){const action=barKeyAction(key(arrow,mod),100,300)!;expect(action.type).toBe("seek");}
    expect(barKeyAction(key("ArrowLeft"),0,300)).toEqual({type:"seek",frame:0});expect(barKeyAction(key("ArrowRight",{shiftKey:true}),290,300)).toEqual({type:"seek",frame:299});
    expect(barKeyAction(key("Home"),120,300)).toEqual({type:"seek",frame:0});expect(barKeyAction(key("End"),0,300)).toEqual({type:"seek",frame:299});
    expect(barKeyAction(key(" "),0,300)).toEqual({type:"toggle"});expect(barKeyAction(key("ArrowLeft",{altKey:true}),10,300)).toBeNull();
  });
  it("↑/↓ 고르기, Enter 편집 칸, Space 재생, Esc는 끄는 중에만, Ctrl·Meta 조합은 건드리지 않음",()=>{
    expect(clipKeyAction(key("ArrowUp"),false,false)).toEqual({type:"select",step:-1});expect(clipKeyAction(key("ArrowDown"),true,false)).toEqual({type:"select",step:1});
    expect(clipKeyAction(key("Enter"),true,false)).toEqual({type:"enter"});expect(clipKeyAction(key(" "),false,false)).toEqual({type:"toggle"});
    expect(clipKeyAction(key("Escape"),false,false)).toBeNull();expect(clipKeyAction(key("Escape"),false,true)).toEqual({type:"cancel"});
    expect(clipKeyAction(key("ArrowLeft",{ctrlKey:true}),false,false)).toBeNull();expect(clipKeyAction(key("Tab"),false,false)).toBeNull();
  });
});

describe("눈금·재생 위치 저장소",()=>{
  it("눈금 글자 간격은 1·2·5·10초 중 48px 이상인 가장 작은 값",()=>{
    expect(rulerSteps(900,1200).label).toBe(2);expect(rulerSteps(900,3000).label).toBe(1);expect(rulerSteps(900,600).label).toBe(5);expect(rulerSteps(1800,500).label).toBe(10);
  });
  it("같은 프레임은 알리지 않고, 구독 해제 뒤에는 부르지 않음",()=>{
    const store=createFrameStore(),listener=vi.fn(),off=store.subscribe(listener);store.set(0);expect(listener).not.toHaveBeenCalled();
    store.set(5);expect(store.get()).toBe(5);expect(listener).toHaveBeenCalledTimes(1);off();store.set(6);expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("경계",()=>{
  it("타임라인 줄은 문서 전체 키·fetch·서버 모듈이 없고 키 판단은 순수 함수를 씀, 휴대폰에서는 숨김, 명시 저장 그대로",()=>{
    const row=readFileSync("components/text-editor/text-timeline.tsx","utf8"),panel=readFileSync("components/editing-panel.tsx","utf8");
    expect(row).not.toMatch(/(document|window)\.addEventListener/);expect(row).not.toMatch(/fetch\(/);expect(row).not.toMatch(/from "(server-only|@\/lib\/(db|repo|services|fonts)\/)/);
    expect(row).toContain("clipKeyAction(event");expect(row).toContain("barKeyAction(event");
    expect(panel).toMatch(/<div className=\{styles\.pcOnly\}><Card><div className="stack"><h2>타임라인<\/h2>/);
    expect(panel).not.toMatch(/setInterval|autosave/i);expect(panel.match(/fetch\(`\/api\/projects\/\$\{data\.projectId\}\/timeline`/g)).toHaveLength(1);
    // Changes made while a save is on its way come back on top of the new version (T-033 1-2).
    expect(panel).toContain("draft:canonicalJson(draftRef.current)!==canonicalJson(sent)?draftRef.current:null");expect(panel).toContain("저장하는 동안 고친 내용은 아직 저장하지 않았어요.");
  });
});
