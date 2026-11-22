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
  it("운영 허브 음악 칸(공개 준비 포함)은 그대로 두고 작업실 링크만 더한다", () => {
    const programs = readFileSync("components/admin/admin-premiere-programs.tsx", "utf8");
    expect(programs).toMatch(/<a className=\{hub\.link\} href=\{audioAnalysisPath\}>오디오 분석 작업실\(원본 v1\.15\) 열기<\/a>/);
    expect(programs).toMatch(/<AdminMusicSemantic file=\{selected\} onPrepare=\{onPrepare\} \/>/);
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
