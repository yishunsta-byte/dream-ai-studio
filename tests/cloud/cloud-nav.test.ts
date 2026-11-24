import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 로그인한 클라우드 화면의 길잡이(내 프로젝트·콘텐츠 분석)와 콘텐츠 분석 진입.
const state = vi.hoisted(() => ({ pathname: "/cloud/projects" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

const layout = readFileSync("app/(cloud)/layout.tsx", "utf8");
const page = readFileSync("app/(cloud)/cloud/reference-analysis/page.tsx", "utf8");
const css = readFileSync("app/(cloud)/cloud.module.css", "utf8");

async function nav(pathname: string | null) {
  state.pathname = pathname;
  const { CloudNav } = await import("@/app/(cloud)/cloud-nav");
  return renderToStaticMarkup(createElement(CloudNav));
}

describe("클라우드 길잡이", () => {
  beforeEach(() => { state.pathname = "/cloud/projects"; });

  it("내 프로젝트·콘텐츠 분석 두 링크를 이름 붙은 nav 목록으로 그린다", async () => {
    const html = await nav("/cloud/projects");
    expect(html).toContain('<nav class="');
    expect(html).toContain('aria-label="클라우드 메뉴"');
    expect(html).toContain('href="/cloud/projects"');
    expect(html).toContain(">내 프로젝트</a>");
    expect(html).toContain('href="/cloud/reference-analysis"');
    expect(html).toContain(">콘텐츠 분석</a>");
    expect(html.indexOf("내 프로젝트")).toBeLessThan(html.indexOf("콘텐츠 분석"));
  });

  it.each([
    ["/cloud/projects", "내 프로젝트"],
    ["/cloud/projects/01900000-0000-7000-8000-000000000001/render", "내 프로젝트"],
    ["/cloud/reference-analysis", "콘텐츠 분석"],
  ])("%s에서는 %s만 현재 위치다", async (path, label) => {
    const html = await nav(path);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>${label}</a>`));
  });

  it("다른 클라우드 경로(개인 관리)나 비슷한 접두어에서는 현재 위치가 없다", async () => {
    for (const path of ["/cloud/manage", "/cloud/projectsX", null]) {
      expect(await nav(path)).not.toContain("aria-current");
    }
  });

  it("레이아웃은 로그인했을 때만 길잡이를 보이고 기존 세션 경계를 그대로 둔다", () => {
    expect(layout).toContain("{account && <CloudNav />}");
    expect(layout).toContain("{account && <AccountMenu email={account} />}");
    expect(layout).toMatch(/<main id="main-content" className="content"><ProtectedContent>\{children\}<\/ProtectedContent><\/main>/);
    expect(layout.indexOf("<SessionBoundary account={account}>")).toBeLessThan(layout.indexOf("<CloudNav />"));
  });

  it("좁은 화면에서는 길잡이가 한 줄을 차지하고, 링크는 44px 터치 높이다", () => {
    expect(css).toContain("min-height:44px");
    expect(css).toMatch(/@media \(max-width: 480px\) \{ \.nav \{ order:3; flex-basis:100%; \} \}/);
  });
});

describe("콘텐츠 분석 진입 페이지", () => {
  it("제목을 콘텐츠 분석으로 바꾸되 인증·로컬 판정과 연결 안 된 셸은 그대로 둔다", () => {
    expect(page).toContain('export const metadata: Metadata = { title: "콘텐츠 분석 · Dream AI Studio" };');
    expect(page).toContain('<PageHeader title="콘텐츠 분석" />');
    expect(page).toContain('if (auth.status === 401) redirect(loginPath({ next: "/cloud/reference-analysis" }));');
    expect(page).toContain("<StudioRegisteredAnalysisPage />");
    expect(page).not.toMatch(/materials=|kind="connected"/);
  });
});
