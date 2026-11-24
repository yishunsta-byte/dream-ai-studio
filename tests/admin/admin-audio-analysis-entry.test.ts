import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioAnalysisHref, audioAnalysisPath } from "@/components/admin/audio-analysis-path";

// P1-07 오디오 원본(v1.15) 전용 화면 /admin/audio-analysis(Master msg_79224ef211df, 운영 33ff5a0 위 선별 이식 msg_1950802cfa80). mock Auth 시험이며 실제 Supabase 계정이 아니다.
// 기대값 근거: /admin·/admin/integrations와 같은 서버 판정(getRenderAuth). 401은 로그인(돌아올 곳은 이 화면 + 작업실 문맥), 403·503은 오류 안내, local은 안내만.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/audio-analysis" }));
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
const P = "0190a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b", S = "0190a2b3-c4d5-7e6f-9a9b-0c1d2e3f4a5c";
async function open(query: Record<string, string | string[] | undefined> = {}) {
  const { default: Page } = await import("@/app/admin/audio-analysis/page");
  try { return { element: await Page({ searchParams: Promise.resolve(query) }) }; } catch (error) { return { to: (error as { to?: string }).to, error }; }
}

describe("전용 화면 주소", () => {
  it("작업실 문맥은 project·scene이 하나씩 있을 때만 두 값만 옮긴다", () => {
    expect(audioAnalysisPath).toBe("/admin/audio-analysis");
    expect(audioAnalysisHref()).toBe("/admin/audio-analysis");
    expect(audioAnalysisHref({ project: P, scene: S, other: "x" })).toBe(`/admin/audio-analysis?project=${P}&scene=${S}`);
    expect(audioAnalysisHref(new URLSearchParams({ project: P, scene: S }))).toBe(`/admin/audio-analysis?project=${P}&scene=${S}`);
    for (const bad of [{ project: P }, { scene: S }, { project: [P, P], scene: S }, { project: "", scene: S }]) expect(audioAnalysisHref(bad)).toBe("/admin/audio-analysis");
    expect(audioAnalysisHref(new URLSearchParams(`project=${P}&project=${P}&scene=${S}`))).toBe("/admin/audio-analysis");
  });
});

describe("보호 경로 판정", () => {
  it("로그인 없음 → 관리자 로그인, 돌아올 곳은 이 화면과 작업실 문맥", async () => {
    ready(null);
    expect((await open()).to).toBe("/admin/login?next=%2Fadmin%2Faudio-analysis");
    expect((await open({ project: P, scene: S })).to).toBe(`/admin/login?next=${encodeURIComponent(`/admin/audio-analysis?project=${P}&scene=${S}`)}`);
  });
  it("허용되지 않은 계정 → forbidden, 그리지 않음", async () => {
    ready({ id: P, email: "other@example.invalid" });
    expect((await open()).to).toBe("/admin/login?error=forbidden");
  });
  it("로그인 꺼진 로컬 → 안내만(작업 화면 없음)", async () => {
    const { element } = await open();
    expect(isValidElement(element)).toBe(true);
    expect(renderToStaticMarkup(element!)).not.toContain("오디오 분석</h1>");
  });
  it("허용된 관리자 → 공통 머리(계정 메뉴)와 가림 경계 안의 오디오 작업 화면", async () => {
    ready({ id: P, email: "owner@example.com" });
    const { element } = await open();
    const html = renderToStaticMarkup(element!);
    expect(html).toContain('<h1 class="sr-only">오디오 분석</h1>');
    expect(html).toContain('href="/admin#admin-music-analysis"');
    expect(html).toContain("owner@example.com");
  });
});

describe("서버·클라이언트 경계(정적)", () => {
  it("서버 페이지는 use client 모듈에서 컴포넌트만 가져오고, 경로는 지시어 없는 모듈에서 가져온다", () => {
    const page = readFileSync("app/admin/audio-analysis/page.tsx", "utf8");
    expect(page).not.toMatch(/^\s*["']use client["']/);
    expect(page).toMatch(/import \{ AudioStudio \} from "@\/components\/admin\/audio-original\/audio-studio";/);
    expect(page).toMatch(/import \{ AdminStudioReturn \} from "@\/components\/admin\/admin-studio-return";/);
    expect(page).toMatch(/<AdminStudioReturn kind="audio" \/>/);
    expect(page).toMatch(/import \{ audioAnalysisHref \} from "@\/components\/admin\/audio-analysis-path";/);
    expect(readFileSync("components/admin/audio-analysis-path.ts", "utf8")).not.toMatch(/^\s*["']use (client|server)["']/m);
    expect(page).toMatch(/<main id="main-content" className="content">\s*<ProtectedContent>/);
  });
  it("운영 오디오 탭은 내장 작업실과 공개 준비·복귀 진입을 제공한다", () => {
    const programs = readFileSync("components/admin/admin-premiere-programs.tsx", "utf8");
    const studio = readFileSync("components/admin/audio-original/audio-studio.tsx", "utf8");
    expect(programs).toContain("<AudioStudio embedded onPrepare={onPrepare} />");
    expect(programs).toContain('<AdminStudioReturn kind="audio" />');
    expect(programs).not.toContain("href={audioAnalysisPath}");
    expect(programs).not.toContain("오디오 분석 작업실(원본 v1.15) 열기");
    expect(studio).toMatch(/<AdminMusicSemantic file=\{selected\}[^>]*onPrepare=\{onPrepare\}/);
    expect(studio).not.toMatch(/<main\b/);
  });
});

describe("작업실 문맥 판정(Master msg_99235b334697)", () => {
  const context = { projectId: P, sceneId: S };
  const production = { scenes: [{ id: S, position: 3, title: "셋째 장면" }] };
  it("200이고 응답에 그 장면이 있을 때만 확인, 없으면 지움", async () => {
    const { productionCheck } = await import("@/components/admin/admin-studio-return");
    expect(productionCheck(context, 200, production)).toEqual({ kind: "verified", scene: { ...context, position: 3, title: "셋째 장면" } });
    expect(productionCheck(context, 200, { scenes: [] })).toEqual({ kind: "forget" });
    expect(productionCheck(context, 200, undefined)).toEqual({ kind: "forget" });
  });
  it("403·404·400은 지우고(정보 노출 방지), 401·5xx는 문맥을 두고 다시 확인", async () => {
    const { productionCheck } = await import("@/components/admin/admin-studio-return");
    for (const status of [400, 403, 404, 409]) expect(productionCheck(context, status), String(status)).toEqual({ kind: "forget" });
    for (const status of [401, 500, 502, 503, 504]) expect(productionCheck(context, status), String(status)).toEqual({ kind: "retry" });
  });
  it("서버 렌더에서는 장면 이름·다시 확인 없이 아무것도 그리지 않는다", async () => {
    const { AdminStudioReturn } = await import("@/components/admin/admin-studio-return");
    const { createElement } = await import("react");
    expect(renderToStaticMarkup(createElement(AdminStudioReturn, { kind: "audio" } as never))).toBe("");
  });
});

describe("P1-07-AUDIO-ORIGINAL-PARITY-UI G1 이용 가이드 창", () => {
  it("원본 GuideModal 구성(제목·판·소개·음성 4·음악 4·키 안내·확인 및 닫기)을 이름 있는 dialog 하나로 그린다", async () => {
    const { AudioGuide, GUIDE_SPEECH, GUIDE_MUSIC } = await import("@/components/admin/audio-original/audio-guide");
    const { createElement } = await import("react");
    const html = renderToStaticMarkup(createElement(AudioGuide, { id: "g", open: false, onClose: () => {}, onNavigate: () => {}, settingsHref: "/admin#admin-api-integrations" }));
    expect(html.match(/<dialog\b/g)).toHaveLength(1);
    expect(html).toContain('<dialog id="g" class=');
    expect(html).toContain('aria-labelledby="g-title"');
    expect(html).toContain('<h2 id="g-title">AI Audio분석 자동화 이용 가이드</h2>');
    expect(html).toContain("Version v1.15");
    expect(html).toContain("소리의 숨겨진 통찰을 발견하는 AI Audio 랩");
    expect(html).toContain("1. 음성 인텔리전스 (Speech Intelligence)");
    expect(html).toContain("2. 음악 분석 &amp; Suno v6 역설계 (Music Lab)");
    expect(GUIDE_SPEECH.map(item => item.title)).toEqual(["화자 분리 및 점유율 시각화", "타임라인 전사 및 질문 추출", "감정 어조 & 비언어적 요소", "원클릭 회의록 & 인터뷰 보고서"]);
    expect(GUIDE_MUSIC.map(item => item.title)).toEqual(["Suno AI v6 Reverse Prompt", "오디오 포렌식 & 음질 추정", "4대 스템(Stem) 청각 묘사", "곡 구조 & 코드 진행 채보"]);
    for (const { title } of [...GUIDE_SPEECH, ...GUIDE_MUSIC]) expect(html).toContain(title.replace(/&/g, "&amp;"));
    expect(html).toContain('aria-label="이용 가이드 닫기"');
    expect(html).toContain(">확인 및 닫기</button>");
    expect(html).toContain('href="/admin#admin-api-integrations"');
    expect(html).toContain("API키등록·플랫폼연동 열기");
    expect(html).toContain('tabindex="0" role="region" aria-label="이용 가이드 내용"');
  });
  it("키 안내는 관리자 API연동·서버 암호화 보관·실행마다 동의로 바꾸고, 회원 키·평문 저장·지금 화면과 다른 원본 주장은 남기지 않는다", async () => {
    const { AudioGuide, GUIDE_KEY_TEXT } = await import("@/components/admin/audio-original/audio-guide");
    const { createElement } = await import("react");
    const html = renderToStaticMarkup(createElement(AudioGuide, { id: "g", open: false, onClose: () => {}, onNavigate: () => {}, settingsHref: "#admin-api-integrations" }));
    expect(GUIDE_KEY_TEXT).toContain("API키등록·플랫폼연동에 등록하고, 서버가 암호화해 보관해요");
    expect(GUIDE_KEY_TEXT).toContain("분석할 때마다 파일 전송에 따로 동의해야");
    expect(html).toContain("관리자 키 연동 원칙");
    for (const banned of ["회원", "Rule 00", "Google AI Studio", "평문", "localStorage", "똑같은", "전문을 기록", "Cut-off를 감지", "뻥튀기"]) expect(html, banned).not.toContain(banned);
  });
  it("사이드바·상단 바·히어로 세 단추가 같은 창을 열고(aria-haspopup=dialog), 창은 스튜디오 안에 하나만 있다", async () => {
    const { AudioStudio } = await import("@/components/admin/audio-original/audio-studio");
    const { createElement } = await import("react");
    const html = renderToStaticMarkup(createElement(AudioStudio, { embedded: true } as never));
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
    expect(html).toContain("📖 연동 &amp; 사용 매뉴얼");
    expect(html).toContain("<span aria-hidden=\"true\">📖</span>사용 매뉴얼</button>");
    expect(html).toContain("<span aria-hidden=\"true\">📖</span>사용 매뉴얼 보기</button>");
    expect(html.match(/<dialog\b/g)).toHaveLength(1);
    expect(html).toContain('href="#admin-api-integrations"');
    const source = readFileSync("components/admin/audio-original/audio-studio.tsx", "utf8");
    expect(source).toMatch(/const openGuide = \(event: \{ currentTarget: HTMLElement \}\) => \{ guideFrom\.current = event\.currentTarget; closeMenu\(false\); setGuide\(true\); \};/);
    expect(source).toMatch(/\[from, menuButton\.current, sideGuide\.current\]\.find\(visible\)\?\.focus\(\)/);
  });
});
