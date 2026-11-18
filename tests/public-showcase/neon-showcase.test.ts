import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeonShowcase } from "@/components/public-showcase/neon-showcase";
import { SAMPLE_WORKS, SHOWCASE_FILTERS, creatorInitials, filterWorks, isShowcaseFilter, type ShowcaseWork } from "@/lib/public-showcase/works";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const render = (props: Parameters<typeof NeonShowcase>[0]) => renderToStaticMarkup(createElement(NeonShowcase, props));
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("T-240 공개 작품 자료", () => {
  it("예시 6개는 모두 예시 표시·재생 파일 없음·허가 자산 경로만 쓴다", () => {
    expect(SAMPLE_WORKS).toHaveLength(6);
    expect(new Set(SAMPLE_WORKS.map((work) => work.id)).size).toBe(6);
    for (const work of SAMPLE_WORKS) {
      expect(work.sample).toBe(true);
      expect(work.media).toBeNull();
      expect(work.image.src).toMatch(/^\/showcase\/t240\/[a-z-]+\.png$/);
      expect(existsSync(resolve(root, "public", work.image.src.slice(1)))).toBe(true);
    }
    expect(Object.isFrozen(SAMPLE_WORKS)).toBe(true);
  });

  it("공개 이미지 6장은 T232 시안 자산과 바이트가 같다", () => {
    const names = ["neon-rooftop", "desert-motion", "wild-coast", "orchid", "celestial", "sunflower"];
    const hash = (path: string) => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
    for (const name of names) expect(hash(`public/showcase/t240/${name}.png`)).toBe(hash(`docs/design/t232-public-showcase/assets/${name}.png`));
  });

  it("종류와 검색을 함께 적용하고, 앞뒤 공백·대소문자를 무시한다", () => {
    expect(filterWorks(SAMPLE_WORKS, "전체", "").map((work) => work.id)).toHaveLength(6);
    expect(filterWorks(SAMPLE_WORKS, "음악", "").map((work) => work.id)).toEqual(["liquid-bloom", "celestial-drift", "sunglass"]);
    expect(filterWorks(SAMPLE_WORKS, "음악", "  ambient ".replace("ambient", "앰비언트")).map((work) => work.id)).toEqual(["celestial-drift"]);
    expect(filterWorks(SAMPLE_WORKS, "전체", "motion lab").map((work) => work.id)).toEqual(["desert-motion"]);
    expect(filterWorks(SAMPLE_WORKS, "여행", "neon")).toEqual([]);
    expect(filterWorks([], "전체", "x")).toEqual([]);
  });

  it("필터 값 확인과 크리에이터 머리글자", () => {
    expect(SHOWCASE_FILTERS).toEqual(["전체", "영상", "음악", "광고", "여행"]);
    expect(isShowcaseFilter("음악")).toBe(true);
    expect(isShowcaseFilter("공연")).toBe(false);
    expect(isShowcaseFilter(undefined)).toBe(false);
    expect(creatorInitials("DREAM ORIGINALS")).toBe("DO");
    expect(creatorInitials("  wave  room ")).toBe("WR");
  });
});

describe("T-240 NEON SCREEN 화면", () => {
  it("정상: 제목 하나, 대표 작품, 작품 6개, 예시 표시, 실제 로그인 화면 링크", () => {
    const html = render({ works: SAMPLE_WORKS });
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(html).toContain("NEON AFTER HOURS");
    expect(count(html, /<article/g)).toBe(6);
    expect(count(html, /예시 작품<\/span>/g)).toBe(6);
    expect(html).toContain("대표 작품 · 예시");
    expect(html).toContain("영상·음악은 아직 재생되지 않아요");
    expect(html).toContain('href="/login"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("작품 6개");
  });

  it("재생 파일이 없으면 영상·음악 요소를 만들지 않고, 조회수·좋아요·개발 용어를 보여 주지 않는다", () => {
    const html = render({ works: SAMPLE_WORKS });
    expect(html).not.toMatch(/<video|<audio|<iframe|autoplay/i);
    // 화면에 보이는 글자(태그 밖)와 aria-label만 본다. 클래스 해시·이미지 주소의 우연한 대문자는 제외.
    const visibleText = html.replace(/<[^>]*>/g, " ") + " " + [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]).join(" ");
    for (const word of ["시안", "시연", "조회수", "좋아요", "재생 중", "fixture", "mock", "storage"]) expect(visibleText).not.toContain(word);
    expect(visibleText).not.toMatch(/\b(UI|API|DB)\b/); // LIQUID 같은 단어 안의 글자는 제외
    expect(html).not.toMatch(/\/api\/|data\//);
  });

  it("불러오는 중·오류·다시 시도·작품 없음 상태", () => {
    const loading = render({ works: SAMPLE_WORKS, status: "loading" });
    expect(loading).toContain("작품을 불러오고 있어요");
    expect(loading).toContain('aria-busy="true"');
    expect(count(loading, /<article/g)).toBe(0);

    const errorWithRetry = render({ works: SAMPLE_WORKS, status: "error", onRetry: () => {} });
    expect(errorWithRetry).toContain("작품 목록을 불러오지 못했어요");
    expect(errorWithRetry).toContain(">다시 시도</button>");
    expect(render({ works: SAMPLE_WORKS, status: "error" })).not.toContain(">다시 시도</button>");

    const none = render({ works: [] });
    expect(none).toContain("아직 공개된 작품이 없어요");
    expect(count(none, /<h1[\s>]/g)).toBe(1);
    expect(none).not.toContain("예시");
  });

  it("실제 공개 작품(예시 아님)이면 예시 안내와 표시를 붙이지 않는다", () => {
    const real: ShowcaseWork[] = SAMPLE_WORKS.map((work) => ({ ...work, sample: false }));
    const html = render({ works: real, featuredId: "the-wild-coast", collectionIds: ["sunglass"] });
    expect(html).not.toContain("예시");
    expect(html).toMatch(/<h1[^>]*>THE WILD COAST<\/h1>/);
    expect(count(html, /음악 작품 자세히 보기/g)).toBe(1);
  });

  it("다른 로그인 주소를 넘기면 그 주소를 쓴다", () => {
    expect(render({ works: SAMPLE_WORKS, loginHref: "/login?next=%2F" })).toContain('href="/login?next=%2F"');
  });
});

describe("T-240 소스 경계", () => {
  const component = read("components/public-showcase/neon-showcase.tsx");
  const css = read("components/public-showcase/neon-showcase.module.css");
  const lib = read("lib/public-showcase/works.ts");

  it("개인 자료·서버 저장소·인증 모듈을 가져오지 않는다", () => {
    for (const source of [component, lib]) {
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
      for (const path of imports) expect(path).toMatch(/^(react|next\/image|next\/link|@\/lib\/public-showcase\/works|\.\/neon-showcase\.module\.css)$/);
      expect(source).not.toMatch(/fetch\(|process\.env|localStorage|autoPlay/);
    }
  });

  it("모든 CSS 규칙은 .root 범위 안 클래스나 @규칙이고, 동작 줄이기를 지원한다", () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .replace(/@media[^{]*\{/g, "").match(/[^{}]+(?=\{)/g)!.map((selector) => selector.trim()).filter(Boolean);
    for (const selector of selectors) for (const part of selector.split(",")) expect(part.trim()).toMatch(/^\./);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    // 전역 h2·h3·a 글자색(밝은 배경용)을 덮어써야 어두운 배경에서 읽힌다(T-240 실화면에서 발견).
    expect(css).toMatch(/\.root h1, \.root h2, \.root h3 \{[^}]*color: inherit/);
    expect(css).toMatch(/\.root a \{ color: inherit/);
  });

  it("누를 수 있는 요소는 44px 이상", () => {
    for (const rule of [/\.btn \{[^}]*min-height: 48px/, /\.link \{[^}]*min-height: 44px/, /\.iconBtn \{[^}]*width: 44px; height: 44px/, /\.filters button \{[^}]*min-height: 44px/, /\.nav a \{[^}]*min-height: 44px; min-width: 44px/, /\.brand \{[^}]*min-height: 44px/, /\.search input \{[^}]*height: 46px/, /\.skip \{[^}]*min-height: 44px/]) expect(css).toMatch(rule);
  });

  it("상세는 닫힐 때 연 버튼(없으면 작품 영역)으로 포커스를 돌려준다", () => {
    expect(component).toMatch(/trigger\?\.isConnected && trigger\.getClientRects\(\)\.length > 0\) trigger\.focus\(\)/);
    expect(component).toMatch(/else document\.getElementById\(ids\.browse\)\?\.focus\(\)/);
    expect(component).toMatch(/onClose=\{onDialogClose\}/);
  });
});
