import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeonShowcase } from "@/components/public-showcase/neon-showcase";
import { SAMPLE_WORKS } from "@/lib/public-showcase/works";
import { ShowcaseGated, ShowcaseGuard, ShowcaseScriptFallback } from "@/components/public-showcase/showcase-guard";
import { SHOWCASE_FALLBACK_ID, SHOWCASE_GATED_ID, SHOWCASE_GUARD_FLAG, SHOWCASE_GUARD_JS, SHOWCASE_REVEAL_JS, installShowcaseGuard } from "@/lib/public-showcase/showcase-guard-runtime";

// T-255-F1 공개 홈 탐색. 검수 F255-R1: 앱 안(클라이언트 라우터) 뒤로 가기가 서버 재조회 없이 철회 카드를 다시 보여 줌.
// 기대값 근거: 설계 c9d5674 §2(홈 진입 사전 로드 끄기·이전 RSC 재사용 금지), Master 지시 msg_0d917548a402.
// 홈을 오가는 링크는 모두 일반 <a>(새 문서)여야 하고, 홈은 bfcache 복원 때 서버에서 다시 읽어야 한다. 실제 브라우저 확인은 보고서 참고.
const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(resolve(root, path)).isDirectory() ? tsxFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("T-255-F1 공개 홈을 오가는 링크", () => {
  it("공개 홈 화면은 next/link를 쓰지 않고 로그인·관리자·홈 링크가 모두 일반 링크다", () => {
    const source = read("components/public-showcase/neon-showcase.tsx");
    expect(source).not.toMatch(/from "next\/link"|<Link[\s>]/);
    const markup = renderToStaticMarkup(createElement(NeonShowcase, { works: SAMPLE_WORKS, loginHref: "/login?next=%2Fstudio" }));
    for (const href of ['href="/"', 'href="/login?next=%2Fstudio"', 'href="/admin/login"']) expect(markup, href).toContain(href);
  });

  it("앱 어디에도 공개 홈('/')으로 가는 next/link가 없다", () => {
    const offenders: string[] = [];
    for (const path of [...tsxFiles("app"), ...tsxFiles("components")]) {
      for (const match of read(path).matchAll(/<Link\b[^>]*\bhref=(?:"\/"|\{"\/"\}|\{'\/'\})/g)) offenders.push(`${path}: ${match[0]}`);
      if (/router\.(push|replace|prefetch)\(\s*["']\/["']/.test(read(path))) offenders.push(`${path}: router to /`);
    }
    expect(offenders).toEqual([]);
    // 로그인 화면의 CSS 클래스는 바뀔 수 있다. 링크 종류·목적지·표시 문구가 계약이다.
    expect(read("app/admin/login/page.tsx")).toMatch(/<a\s+(?:className=\{[\w.]+\}\s+)?href="\/">← 공개 메인으로<\/a>/);
    expect(read("components/admin/admin-local-notice.tsx")).toContain('<a className={admin.link} href="/">공개 메인으로</a>');
  });

  it("홈 화면 컴포넌트는 가드를 직접 구현하지 않고 공용 런타임(installShowcaseGuard)만 부른다", () => {
    const source = read("components/public-showcase/neon-showcase.tsx");
    expect(source).not.toMatch(/pagehide|pageshow|location\.reload/);
  });
});

// T-255-F2/F3: 검수 F1-R(앱 번들 실패 시 가드 없음), F2-R(인라인 스크립트·스타일 CSP 동시 차단 시 승인 카드가 가드 없이 보임).
// 기대값 근거: Master 지시 msg_0bd1931b2b88, msg_fe2fec8db9c4(초기 숨김을 인라인 스타일과 분리, 가드 설치 뒤에만 표시, 실패 시 안내·로그인 유지).
type Listener = (event: { persisted: boolean }) => void;
function fakeWindow() {
  const listeners: Record<string, Listener[]> = {};
  const fallback = { hidden: false };
  const gated = { hidden: true };
  const root = { style: { visibility: "" } };
  let reloads = 0;
  const win: Record<string, unknown> = {
    document: { documentElement: root, getElementById: (id: string) => (id === SHOWCASE_GATED_ID ? gated : id === SHOWCASE_FALLBACK_ID ? fallback : null) },
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); },
    location: { reload: () => { reloads += 1; } },
  };
  const runInline = (code: string) => new Function("window", "document", "addEventListener", "location", code)(win, win.document, win.addEventListener, win.location);
  const fire = (type: string, persisted: boolean) => (listeners[type] ?? []).forEach((fn) => fn({ persisted }));
  return { win, listeners, fallback, gated, root, runInline, fire, reloads: () => reloads };
}

describe("T-255-F2/F3 공개 홈 철회 가드", () => {
  it("인라인 가드는 복원 리스너를 설치한 뒤에만 설치 표시를 남기고, 드러내기는 그 표시가 있을 때만 한다", () => {
    const w = fakeWindow();
    w.runInline(SHOWCASE_REVEAL_JS); // 가드 전 드러내기 시도 → 아무것도 안 함
    expect([w.fallback.hidden, w.gated.hidden]).toEqual([false, true]);
    w.runInline(SHOWCASE_GUARD_JS);
    expect(Object.keys(w.listeners).sort()).toEqual(["pagehide", "pageshow"]);
    expect(SHOWCASE_GUARD_JS.indexOf("pageshow")).toBeLessThan(SHOWCASE_GUARD_JS.indexOf(`window.${SHOWCASE_GUARD_FLAG}=true`));
    w.runInline(SHOWCASE_REVEAL_JS);
    expect([w.fallback.hidden, w.gated.hidden]).toEqual([true, false]);
    w.fire("pageshow", false);
    expect(w.reloads()).toBe(0);
    w.fire("pagehide", true);
    expect(w.root.style.visibility).toBe("hidden");
    w.root.style.visibility = "";
    w.fire("pageshow", true);
    expect([w.root.style.visibility, w.reloads()]).toEqual(["hidden", 1]);
  });

  it("앱 번들 경로(installShowcaseGuard)는 인라인이 막혀도 같은 가드를 설치하고 드러내며, 인라인 뒤에는 중복 설치하지 않는다", () => {
    const a = fakeWindow();
    installShowcaseGuard(a.win as unknown as Window);
    expect(Object.keys(a.listeners).sort()).toEqual(["pagehide", "pageshow"]);
    expect([a.fallback.hidden, a.gated.hidden, a.win[SHOWCASE_GUARD_FLAG]]).toEqual([true, false, true]);
    a.fire("pageshow", true);
    expect(a.reloads()).toBe(1);
    const b = fakeWindow();
    b.runInline(SHOWCASE_GUARD_JS);
    installShowcaseGuard(b.win as unknown as Window);
    b.runInline(SHOWCASE_GUARD_JS);
    expect([b.listeners.pagehide.length, b.listeners.pageshow.length]).toEqual([1, 1]);
    expect(read("components/public-showcase/neon-showcase.tsx")).toContain("useEffect(() => { installShowcaseGuard(window); }, []);");
  });

  it("승인 목록 문서: 가드 → 대체 안내 → hidden 승인 영역 → 드러내기 순서이고 초기 숨김에 스타일을 쓰지 않는다", () => {
    const markup = renderToStaticMarkup(createElement(Fragment, null,
      createElement(ShowcaseGuard),
      createElement(ShowcaseScriptFallback, { loginHref: "/login?next=%2Fstudio" }),
      createElement(ShowcaseGated, null, createElement("p", null, "APPROVED"))));
    const guard = markup.indexOf(`<script>${SHOWCASE_GUARD_JS}</script>`);
    const fallback = markup.indexOf(`id="${SHOWCASE_FALLBACK_ID}"`);
    const gated = markup.indexOf(`<div id="${SHOWCASE_GATED_ID}" hidden=""><p>APPROVED</p></div>`);
    const reveal = markup.indexOf(`<script>${SHOWCASE_REVEAL_JS}</script>`);
    expect(guard).toBe(0);
    expect(fallback).toBeGreaterThan(guard);
    expect(gated).toBeGreaterThan(fallback);
    expect(reveal).toBeGreaterThan(gated);
    expect(markup).not.toMatch(/<style|style="/);
    const fallbackHtml = markup.slice(markup.indexOf("<div", fallback - 40), gated);
    for (const href of ['href="/"', 'href="/login?next=%2Fstudio"', 'href="/admin/login"']) expect(fallbackHtml, href).toContain(href);
    expect(fallbackHtml).toContain("공개 작품을 보여 드릴 수 없어요");
    expect(fallbackHtml).not.toMatch(/<img|APPROVED|cover\.webp| hidden=/);
    expect(read("app/(public)/page.tsx")).toMatch(/<ShowcaseGuard \/>\s*<ShowcaseScriptFallback loginHref=\{LOGIN_HREF\} \/>\s*<ShowcaseGated><NeonShowcase works=\{feed\.works\} loginHref=\{LOGIN_HREF\} requestedFilter=\{kind\} \/><\/ShowcaseGated>/);
  });
});
