/// <reference types="vite/client" />
// T-220(F216-1): 계정 확인 전·변경 확정 뒤에는 이메일뿐 아니라 보호 본문도 가리고 조작을 막는다.
import { readFileSync } from "node:fs";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProtectedContent, SessionBoundary, SessionBoundaryContext } from "@/components/auth/session-boundary";
import type { SessionView } from "@/components/auth/use-session-watch";

const body = h("section", null, h("h2", null, "이전 계정 프로젝트"), h("a", { href: "/cloud/projects/00000000-0000-4000-8000-000000000010" }, "상세"), h("form", null, h("input", { name: "x" }), h("button", { type: "submit" }, "저장")));
const guard = (children: ReactNode) => h(ProtectedContent, null, children);
function render(view: SessionView | null, cleared = false) {
  const tree = guard(body);
  return renderToStaticMarkup(view === null ? tree : h(SessionBoundaryContext.Provider, { value: { view, cleared, epoch: 1, retry: () => {}, setPaused: () => {} } }, tree));
}
const protectedPart = (markup: string) => markup.match(/<div data-protected-content=""[^>]*>[\s\S]*<\/div>$/)?.[0] ?? "";

describe("ProtectedContent 상태별 화면", () => {
  it("경계 밖(감시 없음, 예: 로그인 꺼진 이 PC): 본문을 그대로 통과", () => {
    expect(render(null)).toBe(renderToStaticMarkup(body));
  });
  it("확인됨(current): 본문 표시, 안내 없음", () => {
    const markup = render("current");
    expect(markup).toContain("이전 계정 프로젝트");
    expect(markup).not.toMatch(/hidden|inert|data-session-notice/);
  });
  it.each(["checking", "offline", "unavailable"] as const)("의심(%s, 확정 전): 안내 + 본문은 hidden·inert로 표시·포커스·클릭·제출 차단(같음 확인 뒤 복원용)", (view) => {
    const markup = render(view);
    expect(markup).toMatch(/<div tabindex="-1" role="status" data-session-notice=""/);
    const hiddenPart = protectedPart(markup);
    expect(hiddenPart).toMatch(/^<div data-protected-content="" hidden="" inert="">/);
    expect(hiddenPart).toContain("이전 계정 프로젝트");
    // 안내 영역에는 이전 본문·링크·폼이 없다
    const noticePart = markup.slice(0, markup.indexOf("<div data-protected-content"));
    expect(noticePart).not.toMatch(/이전 계정 프로젝트|\/cloud\/projects\/|<form|<input/);
    expect(noticePart.includes("다시 확인")).toBe(view !== "checking");
  });
  it.each([["stale", "다른 창에서 로그인 계정이 바뀌었어요"], ["checking", "로그인 상태를 확인하고 있어요"], ["offline", "로그인 상태를 확인하지 못했어요"], ["unavailable", "로그인 상태를 확인하지 못했어요"]] as const)(
    "변경 확정(cleared, %s): 본문을 아예 그리지 않고 안내만", (view, title) => {
      const markup = render(view, true);
      expect(markup).toContain(title === "로그인 상태를 확인하지 못했어요" ? "로그인 상태를 확인하고 있어요" : title);
      expect(markup).not.toMatch(/이전 계정 프로젝트|\/cloud\/projects\/|<form|<input|data-protected-content/);
      expect(markup).not.toContain("다시 확인");
      expect(markup.includes("새로 고침")).toBe(view === "stale");
    });
  it("SessionBoundary(account 없음)는 감시 없이 통과", () => {
    expect(renderToStaticMarkup(h(SessionBoundary, { account: null, children: guard(body) }))).toBe(renderToStaticMarkup(body));
  });
  it("SessionBoundary(account 있음) 첫 화면은 확인됨 상태로 본문 표시(서버가 이미 인증한 렌더)", () => {
    const markup = renderToStaticMarkup(h(SessionBoundary, { account: "a@example.invalid", children: guard(body) }));
    expect(markup).toContain("이전 계정 프로젝트");
    expect(markup).not.toMatch(/hidden|inert/);
  });
});

describe("연결 inventory(정적)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("AccountMenu를 그리는 제품 파일은 모두 같은 경계 안에서 본문을 ProtectedContent로 감싼다", () => {
    const users = Object.keys(import.meta.glob(["../app/**/*.tsx", "../components/**/*.tsx"]))
      .map((path) => path.replace("../", ""))
      .filter((path) => path !== "components/auth/account-menu.tsx" && /<AccountMenu\b/.test(read(path)));
    // T-243: 관리 허브(app/admin/page.tsx)가 AccountMenu를 새로 그려 목록에 들어온다. 같은 경계·ProtectedContent 조건을 그대로 요구한다.
    // P1-06: 원본 Style DNA 전체 화면 껍데기(사이드바 계정 메뉴)도 같은 조건: 페이지가 경계를 두고, 껍데기의 main 안에서 본문을 가린다.
    expect(users.sort()).toEqual([
      "app/(cloud)/layout.tsx", "app/admin/audio-analysis/page.tsx", "app/admin/page.tsx", "components/admin/admin-platform-integrations.tsx",
      "components/admin/shorts-original/shorts-studio.tsx", "components/admin/style-dna-original/studio-shell.tsx",
      "components/auth/cloud-pending.tsx", "components/studio-shell.tsx",
    ]);
    const integrations = read("components/admin/admin-platform-integrations.tsx");
    expect(integrations).toMatch(/<SessionBoundary account=\{email\}>/);
    expect(integrations).toMatch(/<main id="main-content"[^>]*>\s*<ProtectedContent>/);
    expect(read("app/admin/style-dna/page.tsx")).toMatch(/<SessionBoundary account=\{account\}>\s*<AdminStyleDnaWorkflow layout="original"/);
    const dnaShell = read("components/admin/style-dna-original/studio-shell.tsx");
    expect(dnaShell).toMatch(/const Content = props\.embedded \? "div" : "main";/);
    expect(dnaShell).toMatch(/<Content className=\{s\.main\} id=\{props\.embedded \? undefined : "main-content"\}>\s*<div className=\{s\.inner\}>\{props\.embedded \? children : <ProtectedContent>\{children\}<\/ProtectedContent>\}<\/div>/);
    expect(read("app/admin/shorts-analysis/page.tsx")).toMatch(/<SessionBoundary account=\{account\}>\s*<ShortsStudio account=\{account\} \/>/);
    expect(read("components/admin/shorts-original/shorts-studio.tsx")).toMatch(/<main className=\{s\.main\} id="main-content">\s*<div className=\{s\.inner\}><ProtectedContent>/);
    // P1-07 운영 이식: 오디오 전용 화면도 같은 경계·ProtectedContent 조건.
    for (const path of ["app/(cloud)/layout.tsx", "app/admin/audio-analysis/page.tsx", "app/admin/page.tsx", "components/auth/cloud-pending.tsx"]) {
      const source = read(path);
      expect(source, path).toMatch(/<SessionBoundary account=\{account\}>/);
      expect(source, path).toMatch(/<ProtectedContent>/);
    }
    expect(read("app/(cloud)/layout.tsx")).toMatch(/<main id="main-content" className="content"><ProtectedContent>\{children\}<\/ProtectedContent><\/main>/);
    expect(read("components/studio-shell.tsx")).toMatch(/<main id="main-content"[^>]*><ProtectedContent>\{children\}<\/ProtectedContent><\/main>/);
    expect(read("components/studio-layout.tsx")).toMatch(/<SessionBoundary account=\{account\}><StudioShell /);
  });
  it("AccountMenu는 경계 상태를 우선 쓰고 경계 밖에서만 자체 감시(중복 감시 없음), 로그아웃 중에는 경계 감시를 멈춘다", () => {
    const menu = read("components/auth/account-menu.tsx");
    expect(menu).toMatch(/const boundary = useSessionBoundary\(\);/);
    expect(menu).toMatch(/useSessionWatch\(email, busy, !boundary\)/);
    expect(menu).toMatch(/boundary\?\.setPaused\(busy\)/);
  });
  it("감시 훅: 변경 확정 뒤 같음 답이 와도 본문을 되살리지 않고, 감시 끄기·타이머 없음 유지", () => {
    const hook = read("components/auth/use-session-watch.ts");
    expect(hook).toMatch(/if \(clearedRef\.current && decision\.view === "current"\) \{ setView\("stale"\); return; \}/);
    expect(hook).toMatch(/if \(decision\.go\) \{ clearedRef\.current = true; setCleared\(true\); \}/);
    expect(hook).toMatch(/if \(!enabled\) return;/);
    expect(hook).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    const boundary = read("components/auth/session-boundary.tsx");
    expect(boundary).not.toMatch(/setInterval|setTimeout|opacity|aria-hidden/);
    expect(boundary).toMatch(/hidden=\{!shown \|\| undefined\} inert=\{!shown \|\| undefined\}/);
  });
});

describe("T-224 상태 보존·사이드바 경계(F221-1·F221-2)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("확인됨과 의심에서 본문은 같은 자리의 같은 div(마지막 자식)이고 안내만 앞자리에 더해진다 → 다시 만들지 않음", () => {
    const current = render("current"), checking = render("checking");
    expect(current).toMatch(/^<div data-protected-content="">/);
    const tail = checking.slice(checking.indexOf("<div data-protected-content"));
    expect(tail.replace(' hidden="" inert=""', "")).toBe(current);
    const boundary = read("components/auth/session-boundary.tsx");
    // 상태마다 다른 감싸개를 돌려주는 분기(이전 T-220 구조)가 없다
    expect(boundary).not.toMatch(/if \(view === "current"\) return/);
    expect(boundary).toMatch(/\{!boundary\.cleared && <div ref=\{body\} data-protected-content=""/);
  });
  it("포커스: 가릴 때 안내로 옮기고, 같은 계정 확인 뒤 옮겼던 경우에만 원래 요소로 돌려준다", () => {
    const boundary = read("components/auth/session-boundary.tsx");
    expect(boundary).toMatch(/notice\.current\?\.focus\(\)/);
    expect(boundary).toMatch(/if \(moved\.current && target && target\.isConnected && body\.current\?\.contains\(target\)/);
  });
  it("감시 훅: 다른 탭 신호마다 epoch를 올린다", () => {
    expect(read("components/auth/use-session-watch.ts")).toMatch(/setView\("checking"\); setEpoch\(\(value\) => value \+ 1\);/);
  });
  it("작업실 셸: 사이드바 숨김+inert, 메뉴 버튼 잠금·서랍 닫기, 작업 수는 확인됨+같은 epoch만, 확인 전 갱신 중지, 제목 일반화", () => {
    const shell = read("components/studio-shell.tsx");
    expect(shell).toMatch(/<aside className=\{styles\.desktop\} inert=\{!confirmed \|\| undefined\} style=\{confirmed \? undefined : \{ visibility: "hidden" \}\}>/);
    expect(shell).toMatch(/aria-expanded=\{open\} disabled=\{!confirmed\}/);
    expect(shell).toMatch(/useEffect\(\(\)=>\{if\(!confirmed\)drawer\.current\?\.close\(\);\},\[confirmed\]\);/);
    expect(shell).toMatch(/const counts=confirmed&&received&&received\.epoch===epoch\?received:null;/);
    expect(shell).toMatch(/useEffect\(\(\)=>\{if\(!confirmed\)return;let disposed=false/);
    expect(shell).toMatch(/\},\[pathname,confirmed,epoch\]\);/);
    expect(shell).toMatch(/const title = !confirmed \? "작업실" :/);
    // 작업 수를 쓰는 곳은 모두 걸러진 counts만 본다
    expect(shell.match(/received/g)?.length).toBe(4);
  });
});
