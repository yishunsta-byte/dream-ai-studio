import {beforeEach,describe,expect,it,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("next/navigation",()=>({usePathname:vi.fn(()=>"/settings")}));
import {usePathname} from "next/navigation";
import {StudioShell,type NavigationData} from "@/components/studio-shell";
const navigation:NavigationData={groups:[],menus:[],workspaces:[]};
const header=(markup:string)=>markup.match(/<header[^>]*>([\s\S]*?)<\/header>/)![1];
beforeEach(()=>vi.mocked(usePathname).mockReturnValue("/settings"));

describe("T188 header information remains accessible",()=>{
 it("keeps title, sample meaning and the account's logout name in distinct areas",()=>{
  const markup=header(renderToStaticMarkup(createElement(StudioShell,{navigation,sampleMode:true,account:"owner@example.test",children:createElement("h1",null,"설정")})));
  expect(markup).toContain('<strong title="설정">설정</strong>');
  expect(markup).toContain('role="group" aria-label="작업 상태와 계정"');
  expect(markup).toContain("샘플 모드");expect(markup).toContain('aria-label="로그아웃 (owner@example.test)"');
 });
 it("does not add an empty status row for a local workspace without sample or account",()=>{
  const markup=header(renderToStaticMarkup(createElement(StudioShell,{navigation,sampleMode:false,children:null})));
  expect(markup).toContain('<strong title="설정">설정</strong>');expect(markup).not.toContain('aria-label="작업 상태와 계정"');
 });
 it("preserves a full long menu title in the DOM and title attribute",()=>{
  const title="아주 긴 프로젝트의 제작 장면과 편집 기록을 확인하는 메뉴";
  vi.mocked(usePathname).mockReturnValue("/menus/long");
  const markup=header(renderToStaticMarkup(createElement(StudioShell,{navigation:{...navigation,menus:[{id:"long",label:title,group:"content",phase:"P2",availability:"active"}]},sampleMode:true,children:null})));
  expect(markup).toContain(`<strong title="${title}">${title}</strong>`);
 });
});
