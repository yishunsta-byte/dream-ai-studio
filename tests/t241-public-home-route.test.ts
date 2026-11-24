import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_SHOWCASE_ASSETS, isAnonymousPublicPath, isPublicPath } from "@/lib/auth/config";

// T-241 공개 메인 "/" + 작업실 "/studio". mock Auth 시험이며 실제 Supabase 사용자로 실행한 것이 아니다.
const { auth, menus, startup } = vi.hoisted(() => ({
  auth: { user: null as null | { email: string }, getUser: 0 },
  menus: { state: { ok: true } as unknown },
  startup: { calls: 0 },
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => { auth.getUser++; return { data: { user: auth.user } }; } } }),
}));
vi.mock("@/lib/menus/server", () => ({ getMenuConfigState: () => menus.state, getMenuConfig: () => { throw new Error("not used"); } }));
vi.mock("@/lib/auth/legacy-page-gate", () => ({ legacyPageGate: async () => null }));
vi.mock("@/lib/auth/render", () => ({ currentAccountEmail: async () => null }));
vi.mock("@/lib/services/startup", () => ({ checkStartup: () => { startup.calls++; return { canStart: true }; } }));

const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } auth.user = null; auth.getUser = 0; startup.calls = 0; menus.state = { ok: true }; });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

function ready() {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.com";
}
async function run(path: string) {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(path, "https://studio.test")));
}
const passed = (response: Response) => response.headers.get("x-middleware-next") === "1";

const EXACT = ["/", ...PUBLIC_SHOWCASE_ASSETS];
const NEAR = ["/studio", "/index", "/showcase", "/showcase/", "/showcase/t240", "/showcase/t240/", "/showcase/t240/other.png", "/showcase/t240/orchid.png/", "/showcase/t240/ORCHID.png", "/showcase/t240/orchid.png.map", "/showcase/t241/orchid.png", "/fonts/PretendardVariable.woff2", "/api/projects", "/cloud/projects", "/files/x"];

describe("T-241 공개 경로 판정: 정확한 루트와 고정 이미지 6개만", () => {
  it("정확한 7개만 익명 공개이고 하위 폴더·비슷한 이름은 아니다", () => {
    expect(PUBLIC_SHOWCASE_ASSETS).toHaveLength(6);
    expect(Object.isFrozen(PUBLIC_SHOWCASE_ASSETS)).toBe(true);
    for (const path of EXACT) { expect(isAnonymousPublicPath(path), path).toBe(true); expect(isPublicPath(path), path).toBe(true); }
    for (const path of NEAR) { expect(isAnonymousPublicPath(path), path).toBe(false); expect(isPublicPath(path), path).toBe(false); }
  });
});

describe("T-241 proxy", () => {
  it("로그인 설정이 빠져도 공개 루트·이미지는 열리고, 나머지는 기존처럼 503", async () => {
    process.env.VERCEL = "1";
    for (const path of EXACT) expect(passed(await run(path)), path).toBe(true);
    for (const path of ["/studio", "/showcase/t240/other.png", "/showcase/t240/"]) expect((await run(path)).status, path).toBe(503);
    const api = await run("/api/projects");
    expect(api.status).toBe(503);
    expect((await api.json()).code).toBe("AUTH_UNAVAILABLE");
  });

  it("공개 경로는 세션 확인(getUser)·쿠키 쓰기 없이 통과한다", async () => {
    ready();
    for (const path of EXACT) {
      const response = await run(path);
      expect(passed(response), path).toBe(true);
      expect(response.headers.get("set-cookie"), path).toBeNull();
    }
    expect(auth.getUser).toBe(0);
  });

  it("로그인 전: 작업실은 /login?next=%2Fstudio, 보호 API는 401, 비슷한 경로도 보호", async () => {
    ready();
    const studio = await run("/studio");
    expect(studio.status).toBe(307);
    const target = new URL(studio.headers.get("location")!, "https://studio.test");
    expect(`${target.pathname}${target.search}`).toBe("/login?next=%2Fstudio");
    expect((await run("/api/projects")).status).toBe(401);
    expect((await run("/showcase/t240/other.png")).status).toBe(307);
    expect((await run("/cloud/projects")).status).toBe(307);
    expect(auth.getUser).toBeGreaterThan(0);
  });

  it("허용 밖 계정은 작업실·API가 막히고 공개 루트는 그대로 열린다", async () => {
    ready();
    auth.user = { email: "other@example.invalid" };
    const studio = await run("/studio");
    expect(new URL(studio.headers.get("location")!, "https://studio.test").search).toBe("?error=forbidden");
    expect((await run("/api/projects")).status).toBe(403);
    expect(passed(await run("/"))).toBe(true);
  });

  it("로그인 꺼짐(이 PC)은 기존처럼 모두 통과", async () => {
    for (const path of ["/", "/studio", "/api/projects"]) expect(passed(await run(path)), path).toBe(true);
  });
});

describe("T-241 공개 메인 페이지와 메뉴 설정 오류", () => {
  it("공개 메인은 예시 작품과 작업실로 돌아오는 로그인 링크만 그린다", async () => {
    const { default: Page } = await import("@/app/(public)/page");
    const markup = renderToStaticMarkup(await Page({})); // T-255: 공개 메인이 비동기 서버 컴포넌트가 됨
    expect(markup).toContain("NEON AFTER HOURS");
    expect(markup).toContain('href="/login?next=%2Fstudio"');
    expect(markup).not.toMatch(/메뉴 설정|menus\.json|docs\/spec/);
  });

  it("공개 메인·루트 레이아웃은 개인 자료·메뉴 설정·인증 사용자 모듈을 가져오지 않는다", () => {
    const page = readFileSync("app/(public)/page.tsx", "utf8");
    const imports = [...page.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["next", "@/components/public-showcase/neon-showcase", "@/components/public-showcase/showcase-guard",
      "@/lib/public-showcase/publication-runtime", "@/lib/public-showcase/showcase-feed"]);
    const root = readFileSync("app/layout.tsx", "utf8");
    expect(root).not.toMatch(/menus\/server|getMenuConfig|issues|lib\/services|lib\/db|lib\/auth/);
  });

  it("메뉴 설정이 깨지면 작업실은 기존과 같은 안내로 막고(시작 점검·자식 없음), 그 안내는 작업실 레이아웃에만 있다", async () => {
    menus.state = { ok: false, issues: [{ path: "docs/spec/menus.json", message: "읽을 수 없음" }] };
    const { StudioLayout } = await import("@/components/studio-layout");
    const node = await StudioLayout({ children: "작업 화면" });
    const markup = isValidElement(node) ? renderToStaticMarkup(node) : "";
    expect(markup).toContain("메뉴 설정을 확인해 주세요");
    expect(markup).toContain("docs/spec/menus.json");
    expect(markup).not.toContain("작업 화면");
    expect(startup.calls).toBe(0);
    // 같은 상태에서 공개 메인은 안내 없이 예시를 그린다.
    const { default: Page } = await import("@/app/(public)/page");
    const publicMarkup = renderToStaticMarkup(await Page({}));
    expect(publicMarkup).toContain("NEON AFTER HOURS");
    expect(publicMarkup).not.toMatch(/메뉴 설정|menus\.json/);
  });
});

describe("T-241 작업실 주소 /studio", () => {
  it("작업실 홈은 /studio로 옮겨졌고 / 아래에 작업실 페이지가 없다", () => {
    expect(readFileSync("app/(studio)/studio/page.tsx", "utf8")).toMatch(/legacyPageGate\(\);if\(blocked\)return blocked;/);
    expect(() => readFileSync("app/(studio)/page.tsx", "utf8")).toThrow();
  });
  it("작업실 메뉴·안내 링크는 /studio를 가리킨다", () => {
    const shell = readFileSync("components/studio-shell.tsx", "utf8");
    expect(shell).toContain('<Link href="/studio" className={styles.brand}');
    expect(shell).toContain('navLink("/studio", "작업실"');
    expect(shell).not.toMatch(/navLink\("\/",|href="\/"/);
    expect(readFileSync("components/cloud/project-list-readonly.tsx", "utf8")).toContain('<Link href="/studio">작업실로 가기');
    expect(readFileSync("app/not-found.tsx", "utf8")).toContain('<Link href="/studio">');
    for (const path of ["app/login/page.tsx", "app/account/password/page.tsx"]) expect(readFileSync(path, "utf8"), path).toContain('if (authMode() === "off") redirect("/studio");');
  });
});
