// T-177 (T126 C1, plan A of T-176): a Button blocked with a shown reason names that reason as its description
// (aria-describedby → the reason element's id). The render action opts into staying in the Tab order.
import { describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{},push:()=>{}})}));
import { Button } from "@/components/ui/primitives";
import { RenderEntry } from "@/components/render-panel/entry";
import { RenderPanel } from "@/components/render-panel/render-panel";

// The test runs without a DOM: a small reader over the static markup (attributes as React writes them).
type Btn={attrs:string;text:string;disabled:boolean;describedBy:string|null};
const unescape=(value:string)=>value.replace(/&quot;/g,"\"").replace(/&#x27;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const attr=(attrs:string,name:string)=>{const found=new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);return found?unescape(found[1]):null;};
const buttons=(markup:string):Btn[]=>Array.from(markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)).map(([,attrs,inner])=>({attrs,text:inner.replace(/<[^>]+>/g,""),disabled:/\sdisabled=""/.test(attrs),describedBy:attr(attrs,"aria-describedby")}));
const byId=(markup:string,id:string)=>{const all=Array.from(markup.matchAll(/<(\w+)([^>]*)>([^<]*)<\/\1>/g)).filter(([,,attrs])=>attr(attrs,"id")===id);expect(all,id).toHaveLength(1);return unescape(all[0][3]);};
// The description a screen reader would get: the text of every element named in aria-describedby, in this markup.
const description=(markup:string,button:Btn)=>(button.describedBy??"").split(/\s+/).filter(Boolean).map(id=>byId(markup,id)).join(" ");

describe("공용 Button: 막힌 이유를 버튼 설명으로 잇는다",()=>{
  it("이유가 있으면 disabled 그대로, aria-describedby가 보이는 이유 글을 가리킨다",()=>{
    const markup=renderToStaticMarkup(createElement(Button,{disabledReason:"소리 파일을 골라 주세요."},"넣기")),[button]=buttons(markup);
    expect(button.disabled).toBe(true);expect(button.describedBy).toBeTruthy();expect(description(markup,button)).toBe("소리 파일을 골라 주세요.");
  });
  it("이유가 없으면(보통·loading·disabled만) 설명 속성이 없다",()=>{
    for(const props of [{},{loading:true},{disabled:true}]){const [button]=buttons(renderToStaticMarkup(createElement(Button,props,"저장")));expect(button.describedBy,JSON.stringify(props)).toBeNull();}
  });
  it("호출한 쪽의 aria-describedby는 지우지 않고 이유를 덧붙인다",()=>{
    const markup=renderToStaticMarkup(createElement(Fragment,null,createElement("p",{id:"help"},"도움말"),createElement(Button,{"aria-describedby":"help",disabledReason:"저장이 끝난 뒤 넣을 수 있어요."},"넣기"))),[button]=buttons(markup);
    expect(button.describedBy!.split(" ")[0]).toBe("help");expect(description(markup,button)).toBe("도움말 저장이 끝난 뒤 넣을 수 있어요.");
    const [plain]=buttons(renderToStaticMarkup(createElement(Button,{"aria-describedby":"help"},"넣기")));expect(plain.describedBy).toBe("help");
  });
  it("한 화면의 여러 막힌 버튼은 서로 다른 이유를 가리킨다",()=>{
    const markup=renderToStaticMarkup(createElement(Fragment,null,createElement(Button,{disabledReason:"첫 이유"},"하나"),createElement(Button,{disabledReason:"둘째 이유"},"둘"))),[a,b]=buttons(markup);
    expect(a.describedBy).not.toBe(b.describedBy);expect(description(markup,a)).toBe("첫 이유");expect(description(markup,b)).toBe("둘째 이유");
  });
  it("T123 C1 지점: 편집 머리 '영상 만들기'(dirty)와 영상 만들기 화면의 막힌 버튼",()=>{
    const entry=renderToStaticMarkup(createElement(RenderEntry,{projectId:"p1",dirty:true})),[button]=buttons(entry);
    expect(button.disabled).toBe(true);expect(description(entry,button)).toBe("편집에서 저장하지 않은 변경이 있어요. 영상은 저장한 타임라인으로만 만들어요.");
    const panel=renderToStaticMarkup(createElement(RenderPanel,{projectId:"p1",saved:{revision:5,aspect:"9:16",audioMode:"none",audioClips:0},
      data:{workerOnline:true,contentRevision:7,timelineId:"019b0000-0000-7000-8000-000000000001",check:{ready:false,blockers:[{code:"DISK_FULL",params:{where:"storage",needBytes:2*1024**3,freeBytes:0.5*1024**3}}]},renders:[]}}));
    const make=buttons(panel).find(item=>item.text==="영상 만들기")!;
    expect(make).toBeTruthy();
    expect(make.disabled).toBe(false);
    expect(attr(make.attrs,"aria-disabled")).toBe("true");
    expect(description(panel,make)).toBe("위 이유를 고치면 만들 수 있어요.");
  });
});
