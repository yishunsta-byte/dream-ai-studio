import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isShortsView, SHORTS_FLOW, SHORTS_VIEWS, shortsAnalysisPath } from "@/components/admin/shorts-original/shorts-paths";

// P1-08-ORIGINAL-SHELL(Master msg_453c132f6c06, 배정 버전 3 msg_3322606329ff): 원본 Shorts Viral Studio v2.01 전용 화면 /admin/shorts-analysis.
// mock Auth 시험이며 실제 Supabase 계정이 아니다. 기대값 근거: /admin·/admin/style-dna·/admin/audio-analysis와 같은 서버 판정(getRenderAuth),
// 원본 src/components/layout/Sidebar.tsx FLOW_STEPS·src/lib/version.ts·src/components/studio/HomePanel.tsx.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/shorts-analysis" }));
const client = { auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => client }));
vi.mock("@/lib/auth/server", () => ({ createSupabaseServer: async () => client }));

const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } state.user = null; vi.clearAllMocks(); vi.resetModules(); });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
function ready(user: typeof state.user) {
  Object.assign(process.env, { DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
    DREAM_ALLOWED_EMAILS: "owner@example.com", VERCEL: "1" });
  state.user = user;
}
const ID = "0190a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b";
async function open() {
  const { default: Page } = await import("@/app/admin/shorts-analysis/page");
  try { return { element: await Page() }; } catch (error) { return { to: (error as { to?: string }).to, error }; }
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("전용 화면 주소와 원본 단계", () => {
  it("경로와 원본 6단계 순서·이름·설명", () => {
    expect(shortsAnalysisPath).toBe("/admin/shorts-analysis");
    expect(SHORTS_FLOW.map(item => [item.step, item.id, item.label, item.desc])).toEqual([
      [1, "search", "쇼츠 떡상 검색", "VPH & 대박 영상 탐지"],
      [2, "analyze", "바이럴 구조 해체", "첫 3초 훅 & 락인 공식"],
      [3, "ideate", "킬러 소재 발굴", "새 소재 6종 제안"],
      [4, "select", "주제·전략 확정", "타겟 시청층 & 훅 선택"],
      [5, "script", "15·30·60s 대본", "씬별 1문장 원칙 나레이션"],
      [6, "prompts", "9:16 비주얼 프롬프트", "미드저니 & 영상 NLE 직결"],
    ]);
    expect(SHORTS_VIEWS).toEqual(["home", "search", "analyze", "ideate", "select", "script", "prompts", "vault"]);
    expect([isShortsView("vault"), isShortsView("settings"), isShortsView("")]).toEqual([true, false, false]);
  });
});

describe("보호 경로 판정", () => {
  it("로그인 없음 → 관리자 로그인, 돌아올 곳은 이 화면", async () => {
    ready(null);
    expect((await open()).to).toBe("/admin/login?next=%2Fadmin%2Fshorts-analysis");
  });
  it("허용되지 않은 계정 → forbidden, 그리지 않음", async () => {
    ready({ id: ID, email: "other@example.invalid" });
    expect((await open()).to).toBe("/admin/login?error=forbidden");
  });
  it("로그인 꺼진 로컬 → 안내만(작업 화면 없음)", async () => {
    const { element } = await open();
    expect(isValidElement(element)).toBe(true);
    expect(renderToStaticMarkup(element!)).not.toContain("data-shorts-shell");
  });
  it("허용된 관리자 → 원본 셸: 브랜드·홈·6단계 메뉴·설정 및 가이드·계정, 첫 화면은 홈", async () => {
    ready({ id: ID, email: "owner@example.com" });
    const { element } = await open();
    const html = renderToStaticMarkup(element!);
    const plain = text(html);
    expect(html).toContain("data-shorts-shell");
    expect(html).toContain('<h1 class="sr-only">AI 쇼츠 떡상 분석 및 대본 자동화</h1>');
    expect(plain).toContain("AI 쇼츠 떡상 분석 대본 자동화 v2.01");
    expect(plain).toContain("owner@example.com");
    // 메뉴 순서: 홈 → 쇼츠 바이럴 파이프라인 6단계 → 설정 및 가이드
    const order = ["바이럴 스튜디오 홈", "쇼츠 바이럴 파이프라인", ...SHORTS_FLOW.map(item => item.label), "설정 및 가이드", "API키등록·플랫폼연동", "연동 & 사용 매뉴얼", "프롬프트 보관함", "관리자 홈으로"];
    const side = plain.slice(0, plain.indexOf("YOUTUBE SHORTS CREATOR STUDIO"));
    let at = -1;
    for (const label of order) { const next = side.indexOf(label, at + 1); expect(next, label).toBeGreaterThan(at); at = next; }
    expect(html).toMatch(/aria-current="page"[^>]*>.*?바이럴 스튜디오 홈/);
    // P1-08-SHORTS-STEPS: ③~⑥도 화면이 연결되어 메뉴에 '준비 중'이 없다.
    expect(SHORTS_FLOW.map(item => plain.includes(`${item.desc} · 준비 중`))).toEqual([false, false, false, false, false, false]);
    expect(html).toContain('href="/admin#admin-api-integrations"');
    expect(html).toContain('href="/admin#admin-manual"');
    expect(html).toContain('href="/admin"');
  });
  it("홈은 원본 배치(소개·워크플로우·보관함·9:16 뷰파인더)이고, 확인되지 않은 숫자·보관 기간은 보이지 않는다", async () => {
    ready({ id: ID, email: "owner@example.com" });
    const plain = text(renderToStaticMarkup((await open()).element!));
    for (const piece of ["YOUTUBE SHORTS CREATOR STUDIO v2.0", "⚡ 새 쇼츠 떡상 분석 시작", "🚀 6단계 올인원 제작 워크플로우", "01. 쇼츠 검색 & 떡상 탐지",
      "04. 씬당 1문장 원칙 대본", "📂 최근 작업 프로젝트 보관함", "9:16 쇼츠 뷰파인더 · 구성 예시", "첫 3초 시선강탈 훅"]) expect(plain, piece).toContain(piece);
    for (const made of ["14.2x", "42.8만", "1,420", "30일", "만료", "@바이럴크리에이터", "shorts-onestop-studio"]) expect(plain, made).not.toContain(made);
    // 보관함 칸은 서버 목록을 읽기 전(첫 그림)에는 불러오는 중만 보이고, 30일·만료는 서버 응답(expiresAt) 뒤에만 보인다.
    expect(plain).toContain("불러오는 중…");
    expect(plain).not.toContain("프로젝트 저장과 다시 열기는 서버 연결을 준비 중이에요.");
    expect(plain).not.toContain("이어서 작업하기"); // 고른 영상이 없으면 없음
  });
});

describe("단계 화면 표와 실행 준비 상태", () => {
  it("①·②는 기존 관리자 부품, ③~⑥·보관함은 P1-08-SHORTS-STEPS 화면이고 빈 자리는 없다(준비 화면은 남은 대체용)", async () => {
    const { shortsStepScreens, ShortsReadyStep } = await import("@/components/admin/shorts-original/shorts-steps");
    const { ShortsAnalyzeStep, ShortsSearchStep } = await import("@/components/admin/shorts-original/shorts-step-search");
    expect(shortsStepScreens.search).toBe(ShortsSearchStep);
    expect(shortsStepScreens.analyze).toBe(ShortsAnalyzeStep);
    expect(Object.entries(shortsStepScreens).filter(([, screen]) => screen === null).map(([key]) => key)).toEqual([]);
    const ideate = await import("@/components/admin/shorts-original/shorts-step-ideate");
    expect([shortsStepScreens.ideate, shortsStepScreens.select]).toEqual([ideate.ShortsIdeateStep, ideate.ShortsSelectStep]);
    expect(shortsStepScreens.script).toBe((await import("@/components/admin/shorts-original/shorts-step-script")).ShortsScriptStep);
    expect(shortsStepScreens.prompts).toBe((await import("@/components/admin/shorts-original/shorts-step-prompts")).ShortsPromptsStep);
    expect(shortsStepScreens.vault).toBe((await import("@/components/admin/shorts-original/shorts-step-vault")).ShortsVaultStep);
    for (const [view, label, needs] of [["ideate", "킬러 소재 발굴 실행", "② 바이럴 구조 해체 결과"], ["select", "주제·전략 확정 실행", "③ 킬러 소재 발굴에서 고른 소재"],
      ["script", "15·30·60s 대본 실행", "④ 주제·전략 확정 결과"], ["prompts", "9:16 비주얼 프롬프트 실행", "⑤ 대본"], ["vault", "보관함 열기", "⑥ 9:16 비주얼 프롬프트에서 저장한 세트"]] as const) {
      const html = renderToStaticMarkup(createElement(ShortsReadyStep, { view, goTo: () => {} }));
      expect(html, view).toContain("실행 준비 중");
      expect(html, view).toMatch(new RegExp(`<button type="button" class="[^"]*" disabled="" aria-describedby="[^"]+">${label}</button>`));
      expect(text(html), view).toContain(needs);
      expect(text(html), view).toContain("서버 연결 전이라 눌러도 실행되지 않아요.");
    }
  });
  it("② 분석: 검색에서 고른 영상은 원본 대상 카드에서 동의를 받고, 고른 것이 없으면 주소를 직접 입력한다", async () => {
    const { ShortsAnalyzeStep } = await import("@/components/admin/shorts-original/shorts-step-search");
    const { toPick } = await import("@/components/admin/shorts-source-steps/source-step-data");
    const id = "Fx02abcdefg";
    const url = `https://www.youtube.com/watch?v=${id}`;
    const { emptyShortsSession } = await import("@/components/admin/shorts-original/shorts-session");
    const work = { session: emptyShortsSession, setAnalysis: () => {} } as never;
    const base = { onPick: () => {}, goTo: () => {}, settingsHref: "/admin#admin-api-integrations", work };
    const pick = toPick({ id, url, title: "후보 3", channelId: "UC" + "a".repeat(22), channelTitle: "합성 채널",
      thumbnailUrl: null, publishedAt: "2026-11-20T00:00:00.000Z", durationSeconds: 30, views: 100, likes: 1, comments: 0, subscribers: 10 },
    { query: "캠핑", measuredAt: Date.UTC(2026, 10, 22), credentialVersion: 3 });
    const picked = renderToStaticMarkup(createElement(ShortsAnalyzeStep, { ...base, pick }));
    expect(picked).toContain('data-source-step="analyze"');
    expect(picked).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(text(picked)).toContain("후보 3");
    const empty = renderToStaticMarkup(createElement(ShortsAnalyzeStep, { ...base, pick: null }));
    expect(empty).toMatch(/<input[^>]*inputMode="url"[^>]*value=""/);
    expect(text(empty)).toContain("① 쇼츠 떡상 검색");
  });
  it("기존 호출 호환: initialUrl 없이 그린 분석 칸은 빈 주소로 시작한다", async () => {
    const { AdminShortsAnalysis } = await import("@/components/admin/admin-shorts-analysis");
    const html = renderToStaticMarkup(createElement(AdminShortsAnalysis, { appearance: "premiere" } as never));
    expect(html).toMatch(/<input[^>]*inputMode="url"[^>]*value=""/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });
});

describe("서버·클라이언트 경계와 진입 링크(정적)", () => {
  it("서버 페이지는 use client 모듈에서 컴포넌트만, 경로·이름은 지시어 없는 모듈에서 가져온다", () => {
    const page = readFileSync("app/admin/shorts-analysis/page.tsx", "utf8");
    expect(page).not.toMatch(/^\s*["']use client["']/);
    expect(page).toMatch(/import \{ ShortsStudio \} from "@\/components\/admin\/shorts-original\/shorts-studio";/);
    expect(page).toMatch(/import \{ shortsAnalysisPath, SHORTS_APP \} from "@\/components\/admin\/shorts-original\/shorts-paths";/);
    expect(readFileSync("components/admin/shorts-original/shorts-paths.ts", "utf8")).not.toMatch(/^\s*["']use (client|server)["']/m);
    expect(readFileSync("components/admin/shorts-original/shorts-studio.tsx", "utf8")).toMatch(/^"use client";/);
  });
  it("운영 작업실 쇼츠 칸(검색·단건 분석·공개 준비)은 그대로 두고 전용 화면 링크만 더한다", () => {
    const programs = readFileSync("components/admin/admin-premiere-programs.tsx", "utf8");
    expect(programs).toMatch(/import \{ shortsAnalysisPath \} from "\.\/shorts-original\/shorts-paths";/);
    expect(programs).toMatch(/<a className=\{hub\.link\} href=\{shortsAnalysisPath\}>쇼츠 분석 작업실\(원본 v2\.01\) 열기<\/a>/);
    expect(programs).toMatch(/<AdminShortsAnalysis onSourceChange=\{setUrl\} onPrepare=\{onPrepare\} appearance="premiere" \/>/);
  });
});

// P1-08-SHORTS-EMBED-SHELL: 보호된 관리자 페이지 안에 끼우는 모드. 부모의 경계·main·본문 가림·계정 메뉴를 그대로 쓰고, 셸은 그것들을 다시 그리지 않는다.
describe("끼운 모드(layout=embedded)", () => {
  it("main·계정 메뉴·숨은 h1·관리자 홈 링크 없이, 홈·6단계·설정 및 가이드·보관함 메뉴는 같은 순서로 그린다", async () => {
    const { ShortsStudio } = await import("@/components/admin/shorts-original/shorts-studio");
    const html = renderToStaticMarkup(createElement(ShortsStudio, { layout: "embedded" }));
    const plain = text(html);
    expect(html).toContain('data-layout="embedded"');
    expect(html).not.toMatch(/<main\b/);
    expect(html).not.toContain('id="main-content"');
    expect(html).not.toMatch(/<h1\b/);
    expect(plain).not.toContain("로그인 계정");
    expect(plain).not.toContain("관리자 홈으로");
    expect(plain).not.toContain("로그아웃");
    expect(html).toMatch(/<section class="[^"]*" aria-label="AI 쇼츠 떡상 분석 및 대본 자동화">/);
    const order = ["바이럴 스튜디오 홈", "쇼츠 바이럴 파이프라인", ...SHORTS_FLOW.map(item => item.label), "설정 및 가이드", "API키등록·플랫폼연동", "연동 & 사용 매뉴얼", "프롬프트 보관함"];
    const side = plain.slice(0, plain.indexOf("YOUTUBE SHORTS CREATOR STUDIO"));
    let at = -1;
    for (const label of order) { const next = side.indexOf(label, at + 1); expect(next, label).toBeGreaterThan(at); at = next; }
    expect(html).toContain('href="/admin#admin-api-integrations"');
    expect(plain).toContain("⚡ 새 쇼츠 떡상 분석 시작");
  });

  it("보호된 부모(경계·main·ProtectedContent) 안에 넣으면 main은 부모 하나뿐이고, 전용 화면(page)은 그대로 main·계정 메뉴를 그린다", async () => {
    const { ShortsStudio } = await import("@/components/admin/shorts-original/shorts-studio");
    const { SessionBoundary, ProtectedContent } = await import("@/components/auth/session-boundary");
    const parent = renderToStaticMarkup(createElement(SessionBoundary, { account: "owner@example.com", children:
      createElement("main", { id: "main-content" }, createElement(ProtectedContent, null, createElement(ShortsStudio, { layout: "embedded" }))) }));
    expect(parent.match(/<main\b/g)).toHaveLength(1);
    expect(parent.match(/id="main-content"/g)).toHaveLength(1);
    expect(text(parent)).not.toContain("로그인 계정");
    ready({ id: ID, email: "owner@example.com" });
    const page = renderToStaticMarkup((await open()).element!);
    expect(page).toContain('data-layout="page"');
    expect(page.match(/<main\b/g)).toHaveLength(1);
    expect(text(page)).toContain("로그인 계정");
    expect(text(page)).toContain("관리자 홈으로");
  });

  it("끼운 모드 스타일은 화면 높이·고정 위치를 쓰지 않고, 넓은 메뉴는 작업실 상자 폭(컨테이너 1024px)으로 정한다", () => {
    const css = readFileSync("components/admin/shorts-original/shorts-studio.module.css", "utf8");
    const embed = css.slice(css.indexOf("/* P1-08-SHORTS-EMBED-SHELL"));
    expect(embed.length).toBeGreaterThan(100);
    expect(embed.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/100d?vh|sticky|fixed|max-height:\s*\d+vh/);
    expect(embed).toMatch(/\.embedHost \{ container: shorts-embed \/ inline-size;/);
    expect(embed).toMatch(/@container shorts-embed \(min-width: 1024px\) \{[^}]*\.embedded \{ flex-direction: row; \}/);
    expect(embed).toMatch(/\.embedded \.side \{ position: static; height: auto;/);
    expect(embed).toMatch(/\.embedded \.mobile \{ position: static;/);
    // 전용 화면 규칙(전체 높이·sticky 왼쪽 메뉴)은 그대로다.
    expect(css).toMatch(/\.app \{\s*display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh;/);
    expect(css).toMatch(/position: sticky; top: 0; z-index: 30;/);
  });
});

// P1-08-SHORTS-HOME-RESUME(Master msg_608a06b381d7 배정 1): 홈 '이어서 작업하기'는 지금 작업의 마지막 단계로 옮기기만 한다.
// 실제 셸에서 누를 때의 요청 수·초점·두 폭은 브라우저 확인(인계 문서).
describe("홈 이어서 작업하기", () => {
  const load = async () => {
    const session = await import("@/components/admin/shorts-original/shorts-session");
    const home = await import("@/components/admin/shorts-original/shorts-home");
    const { projectDocument } = await import("../reference-analysis/admin-shorts-vault-fixture");
    return { ...session, ...home, saved: projectDocument };
  };
  const pick = { title: "  합성 쇼츠 Aa · 캠핑 한 끼 도전 " };

  it("빈 작업은 단추 없음, 영상만 고르면 ② 분석, 진행한 작업은 마지막 단계(고른 영상보다 먼저), 제목은 소재 → 키워드 → 영상", async () => {
    const { emptyShortsSession, resumeOf, sessionFromProject, saved, selectionOf } = await load();
    expect(resumeOf(emptyShortsSession, null)).toBeNull();
    expect(resumeOf(emptyShortsSession, pick)).toEqual({ step: 2, view: "analyze", title: "합성 쇼츠 Aa · 캠핑 한 끼 도전" });
    expect(resumeOf(emptyShortsSession, { title: " " })).toEqual({ step: 2, view: "analyze", title: null });
    const full = sessionFromProject(saved(6));
    const steps = [
      { session: { ...full, ideas: [], selected: null, script: null, scenePrompts: null }, step: 2, view: "analyze", title: "영상 편집" },
      { session: { ...full, selected: null, script: null, scenePrompts: null }, step: 3, view: "ideate", title: "영상 편집" },
      { session: { ...full, selected: selectionOf(full.ideas[1]), script: null, scenePrompts: null }, step: 4, view: "select", title: "영상 편집 전후 2" },
      { session: { ...full, scenePrompts: null }, step: 5, view: "script", title: "영상 편집 전후" },
      { session: full, step: 6, view: "prompts", title: "영상 편집 전후" },
    ];
    for (const { session, step, view, title } of steps) {
      expect(resumeOf(session, null)).toEqual({ step, view, title });
      expect(resumeOf(session, pick), "고른 영상이 있어도 진행한 작업이 먼저").toEqual({ step, view, title });
    }
    expect(resumeOf({ ...full, selected: null, keyword: "", script: null, scenePrompts: null }, pick)?.title).toBeNull();
  });

  it("저장 프로젝트를 다시 연 뒤 홈: 다시 연 단계와 같은 곳(viewOfStep(문서 step))", async () => {
    const { resumeOf, sessionFromProject, saved, viewOfStep } = await load();
    const document = saved(6);
    const resume = resumeOf(sessionFromProject(document), null);
    expect(resume).toEqual({ step: document.step, view: viewOfStep(document.step), title: "영상 편집 전후" });
  });

  it("단추 문구와 누르기: 단계 번호·이름·제목, 누르면 goTo(그 단계)만 부르고 요청·초기화·열기 없음, 빈 작업은 단추 없음", async () => {
    const { ShortsHome, resumeLabel, resumeOf, sessionFromProject, saved } = await load();
    const resume = resumeOf(sessionFromProject(saved(6)), null)!;
    expect(resumeLabel(resume)).toBe("이어서 작업하기 · 6. 9:16 비주얼 프롬프트 · 영상 편집 전후");
    expect(resumeLabel({ step: 2, view: "analyze", title: null })).toBe("이어서 작업하기 · 2. 바이럴 구조 해체");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const goTo = vi.fn(); const onOpen = vi.fn(); const onNew = vi.fn();
    const find = (node: unknown): { props: Record<string, unknown> } | null => {
      if (!isValidElement(node)) return Array.isArray(node) ? node.map(find).find(Boolean) ?? null : null;
      const props = node.props as Record<string, unknown>;
      if (props["data-resume-step"] !== undefined) return { props };
      return find(props.children);
    };
    const tree = ShortsHome({ resume, goTo, onOpen, onNew, currentId: null });
    const button = find(tree)!;
    expect(button.props["data-resume-step"]).toBe(6);
    (button.props.onClick as () => void)();
    expect(goTo.mock.calls).toEqual([["prompts"]]);
    expect(fetch).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled(); expect(onNew).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    expect(find(ShortsHome({ resume: null, goTo, onOpen, onNew, currentId: null }))).toBeNull();
    expect(text(renderToStaticMarkup(createElement(ShortsHome, { resume, goTo, onOpen, onNew, currentId: null })))).toContain(resumeLabel(resume));
  });
});
