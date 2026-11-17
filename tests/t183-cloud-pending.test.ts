import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ canStart: false, account: null as string | null }));
vi.mock("@/lib/services/startup", () => ({
  checkStartup: () => ({ canStart: state.canStart, checks: [{ id: "data", label: "data 폴더", status: state.canStart ? "pass" : "fail", message: "파일을 저장할 수 없어요." }] }),
}));
vi.mock("@/lib/auth/render", () => ({ currentAccountEmail: async () => state.account }));
vi.mock("@/lib/menus/server", () => ({ getMenuConfig: () => ({ groups: [], menus: [], workspaces: [] }) }));

const saved = process.env.VERCEL;
beforeEach(() => { delete process.env.VERCEL; state.canStart = false; state.account = null; });
afterEach(() => { if (saved === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved; });

async function layout() {
  const { StudioLayout } = await import("@/components/studio-layout");
  return renderToStaticMarkup(await StudioLayout({ children: createElement("p", null, "작업 화면") }));
}

describe("T-183 저장 폴더 점검 위치와 클라우드 준비 화면", () => {
  it("루트 레이아웃은 저장 폴더 점검을 하지 않는다(로그인 화면이 막히지 않게)", () => {
    const source = readFileSync("app/layout.tsx", "utf8");
    expect(source).not.toMatch(/checkStartup|SetupReport/);
  });
  it("이 PC에서 저장 폴더가 실패하면 지금처럼 시작 점검을 보여 주고 작업 화면은 열지 않는다", async () => {
    const html = await layout();
    expect(html).toContain("시작 점검");
    expect(html).not.toContain("작업 화면");
    expect(html).not.toContain("클라우드 작업실");
  });
  it("Vercel에서는 준비 중 안내를 보여 주고, 로그인했으면 계정과 로그아웃을 보여 준다", async () => {
    process.env.VERCEL = "1";
    state.account = "owner@example.com";
    const html = await layout();
    expect(html).toContain("클라우드 작업실을 준비하고 있어요");
    expect(html).toContain("아직 여기서는 작업을 저장할 수 없어요");
    expect(html).toContain("owner@example.com");
    expect(html).toContain("로그아웃");
    expect(html).not.toContain("시작 점검");
    expect(html).not.toContain("작업 화면");
  });
  it("로그인 정보가 없으면 계정·로그아웃 없이 안내만 보여 준다", async () => {
    process.env.VERCEL = "1";
    const html = await layout();
    expect(html).toContain("클라우드 작업실을 준비하고 있어요");
    expect(html).not.toContain("로그아웃");
    expect(html).not.toContain("로그인은 됐어요");
  });
});
