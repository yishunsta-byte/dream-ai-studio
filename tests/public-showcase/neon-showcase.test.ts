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
  it("정상: 제목 하나, 대표 작품, 작품 6개, 예시 표시 없음(주인님 결정 R5 예외), 실제 로그인 화면 링크", () => {
    const html = render({ works: SAMPLE_WORKS });
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(html).toContain("NEON AFTER HOURS");
    expect(count(html, /<article/g)).toBe(6);
    // 2026-11-19 주인님 결정: 소개용 작품도 화면에는 '예시'를 표시하지 않는다(PLAN R5 예외).
    expect(html).not.toContain("예시");
    expect(html).toContain(">대표 작품</span>");
    expect(html).toMatch(/<p>DREAM · PUBLIC SHOWCASE<\/p>/);
    // 상세에 보이는 글(설명·부제·머리글)에도 '예시'가 없고, 머리글은 따옴표 없이 나온다.
    for (const work of SAMPLE_WORKS) expect([work.title, work.subtitle, work.description, work.format].join(" ")).not.toContain("예시");
    expect(read("components/public-showcase/neon-showcase.tsx")).toContain(">PUBLIC SHOWCASE</div>");
    expect(read("components/public-showcase/neon-showcase.tsx")).not.toContain('"PUBLIC SHOWCASE"</div>');
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

  it("T357(F255-R2): 장애·불러오는 중에는 대표·음악 영역도 목록과 같은 상태를 말하고, 빈 목록 문구를 섞지 않는다", () => {
    const EMPTY_HERO = "공개된 작품이 생기면 이곳에 대표 작품을 보여 드릴게요.";
    const EMPTY_MUSIC = "공개된 음악 작품이 생기면 이곳에 모아 보여 드릴게요.";
    const error = render({ works: [], status: "error" });
    expect(error).toContain("작품 목록을 불러오지 못했어요");
    expect(error).toContain("지금은 공개 작품을 불러오지 못했어요. 잠시 뒤 다시 찾아 주세요.");
    expect(error).toContain("음악 작품도 지금은 불러오지 못했어요.");
    for (const text of [EMPTY_HERO, EMPTY_MUSIC, "아직 공개된 작품이 없어요", "예시"]) expect(error).not.toContain(text);
    expect(count(error, /<h1[\s>]/g)).toBe(1);
    expect(error).toContain('href="/login"');
    expect(error).toContain('href="/admin/login"');

    const loading = render({ works: [], status: "loading" });
    expect(loading).toContain("대표 작품을 불러오고 있어요.");
    expect(loading).toContain("음악 작품을 불러오고 있어요.");
    for (const text of [EMPTY_HERO, EMPTY_MUSIC]) expect(loading).not.toContain(text);

    const none = render({ works: [] });
    expect(none).toContain(EMPTY_HERO);
    expect(none).toContain(EMPTY_MUSIC);
    expect(none).not.toContain("불러오지 못했어요");
  });

  it("실제 공개 작품(예시 아님)이면 예시 안내와 표시를 붙이지 않는다", () => {
    const real: ShowcaseWork[] = SAMPLE_WORKS.map((work) => ({ ...work, sample: false }));
    const html = render({ works: real, featuredId: "the-wild-coast", collectionIds: ["sunglass"] });
    expect(html).not.toContain("예시");
    expect(html).toMatch(/<h1[^>]*>THE WILD COAST<\/h1>/);
    expect(count(html, /음악 작품 자세히 보기/g)).toBe(1);
  });

  it("재생할 수 있는 작품과 소개용 작품이 섞여도 '예시' 표시는 없다", () => {
    const real: ShowcaseWork = {
      ...SAMPLE_WORKS[0],
      id: "public-film",
      title: "공개 영상",
      sample: false,
      media: { kind: "video", src: "/fixture.webm" },
    };
    const html = render({ works: [real, SAMPLE_WORKS[1]] });
    expect(html).toMatch(/<h1[^>]*>공개 영상<\/h1>/);
    expect(html).not.toContain("예시");
    expect(html).not.toContain("영상·음악은 아직 재생되지 않아요");
  });

  it("T360: 처음 그릴 때 표지 자리는 고정 바탕과 '표지 불러오는 중'이고, 재생 삼각형 대신 상세 화살표를 쓴다", () => {
    const real: ShowcaseWork[] = SAMPLE_WORKS.map((work) => ({ ...work, sample: false }));
    const html = render({ works: real });
    // 카드 6 + 음악 3 = 표지 바탕 9개, 대표는 제목 아래 한 줄.
    expect(count(html, /표지 불러오는 중<\/span>/g)).toBe(9);
    expect(html).toMatch(/표지 불러오는 중<\/div>/);
    // 카드 6개의 상세 화살표 + 9299c2d '뮤직 컬렉션 ↗' 링크의 장식 화살표 1개
    expect(count(html, /aria-hidden="true">↗<\/span>/g)).toBe(7);
    expect(html).not.toContain("▶");
    expect(html).toContain(">작품 자세히 보기</button>");
    // 이미지는 그대로 요청한다(주소 변경·새 요청 없음). 처음엔 실패 문구와 상태 설명 연결이 없다.
    for (const work of real) expect(html).toContain(work.image.src);
    expect(html).not.toContain("표지를 불러오지 못했어요");
    expect(html).not.toContain("aria-describedby");
    // 이름은 작품명 + 상세 열기로 유지한다.
    expect(html).toContain('aria-label="NEON AFTER HOURS 자세히 보기"');
    expect(count(html, /aria-hidden="true"><\/span>/g)).toBeGreaterThanOrEqual(9); // 장식 아이콘
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
      for (const path of imports) expect(path).toMatch(/^(react|next\/image|next\/link|@\/lib\/config\/app|@\/lib\/public-showcase\/works|@\/lib\/public-showcase\/showcase-guard-runtime|\.\/neon-showcase\.module\.css)$/);
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

  it("T-240-FIX: 사진 위 작은 문구는 불투명한 어두운 바탕 위에서 4.5:1 이상", () => {
    // F240-1: 390px에서 10px 문구가 밝은 건물 위에 걸려 실제 글자 대비 2.92:1이었다. 그림자가 아닌 불투명 바탕으로 보장한다.
    const rule = css.match(/\.heroCopy \.eyebrow \{([^}]*)\}/)![1];
    const color = rule.match(/(?:^|;)\s*color: (#[0-9a-f]{6})/i)?.[1];
    const background = rule.match(/background: (#[0-9a-f]{6})\s*;/i)?.[1];
    expect(color, "글자색").toBeTruthy();
    expect(background, "6자리 불투명 바탕색").toBeTruthy();
    expect(rule).toMatch(/display: inline-block/);
    const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [lum(color!), lum(background!)];
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    // 모바일 규칙이 바탕을 지우거나 투명하게 바꾸지 않는다.
    for (const [, body] of css.matchAll(/\.heroCopy \.eyebrow \{([^}]*)\}/g)) expect(body).not.toMatch(/background[^;]*(transparent|none|rgba)/);
  });

  it("누를 수 있는 요소는 44px 이상", () => {
    for (const rule of [/\.btn \{[^}]*min-height: 48px/, /\.link \{[^}]*min-height: 44px/, /\.iconBtn \{[^}]*width: 44px; height: 44px/, /\.filters button \{[^}]*min-height: 44px/, /\.nav a \{[^}]*min-height: 44px; min-width: 44px/, /\.brand \{[^}]*min-height: 44px/, /\.search input \{[^}]*height: 46px/, /\.skip \{[^}]*min-height: 44px/]) expect(css).toMatch(rule);
  });

  it("T360: 표지 대체 바탕·문구는 불투명 바탕 위 4.5:1 이상이고, 움직이는 효과를 쓰지 않는다", () => {
    const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x: string, y: string) => { const [a, b] = [lum(x), lum(y)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const plate = css.match(/\.coverPlate \{([^}]*)\}/)![1];
    expect(plate).toMatch(/position: absolute; inset: 0/);
    expect(plate).toMatch(/background: linear-gradient\(160deg, #242133, #171622\)/);
    expect(plate).toMatch(/color: #bcb6cd/);
    for (const background of ["#242133", "#171622"]) expect(ratio("#bcb6cd", background)).toBeGreaterThanOrEqual(4.5);
    expect(plate).not.toMatch(/animation|transition/);
    const status = css.match(/\.coverStatus:not\(:empty\) \{([^}]*)\}/)![1];
    expect(ratio(status.match(/color: (#[0-9a-f]{6})/i)![1], status.match(/background: (#[0-9a-f]{6})/i)![1])).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.coverStatus \{[^}]*min-height: 1\.6em/);
    expect(css).toMatch(/\.heroFallback \{ background: linear-gradient\(120deg, #261435, #15232d\); \}/);
    // 이미지가 바탕 위에 그려지도록 위치를 준다(카드·음악·상세).
    for (const rule of [/\.poster img \{ position: relative;/, /\.coverBox img \{ position: relative;/, /\.detailMedia img, \.detailMedia video \{ position: relative;/]) expect(css).toMatch(rule);
  });

  it("T360: 표지 실패는 이미지를 빼고 다시 요청하지 않으며, 재생 안내·영상 poster와 분리한다", () => {
    // 같은 주소 상태를 한곳에서 함께 쓰고, 실패는 되돌리지 않는다.
    expect(component).toMatch(/if \(previous === next \|\| previous === "error"\) return current;/);
    expect(count(component, /\.state === "error" \? null : \(/g)).toBe(4); // 카드·음악·대표·상세
    expect(component).toMatch(/image\?\.complete && image\.currentSrc/);
    expect(component).toMatch(/naturalWidth > 0 \? "loaded" : "error"/);
    // 미연결 신호가 없으므로 "표지 미연결"을 쓰지 않는다. 원인(HTTP 코드 등)도 화면에 넣지 않는다.
    expect(component).not.toContain("표지 미연결");
    expect(component.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")).not.toMatch(/404|HTTP/); // 주석 밖(화면 문구)만 본다
    expect(component).toContain("표지를 불러오지 못했어요");
    expect(component).toContain("표지 조회 실패");
    // 재생 안내는 대표 이미지를 전제하지 않는다.
    expect(component).toContain("파일이 아직 연결되지 않았어요.");
    expect(component).not.toContain("지금은 대표 이미지만 볼 수 있어요");
    // 영상 poster는 원래 주소를 쓰되, 재생 오류는 영상 자체 onError로만 정한다.
    // T360-F1: 이미 실패한 주소면 poster를 붙이지 않고(재요청 없음), 조작 줄을 비운 실패 바탕을 영상 위에 올렸다가 실제 재생이 시작되면 내린다.
    expect(component).toMatch(/poster=\{cover\.state === "error" \? undefined : work\.image\.src\}/);
    expect(component).toMatch(/\{cover\.state === "error" && !started \? <span className=\{styles\.mediaPlate\}><CoverPlate state="error" \/><\/span> : null\}\s*<video /);
    expect(component).toMatch(/onPlaying: \(event[^)]*\) => \{\s*setStarted\(true\);/);
    expect(css).toMatch(/\.mediaPlate \{[^}]*inset: 0 0 56px 0;[^}]*z-index: 1;[^}]*pointer-events: none;/);
    expect(count(component, /poster=/g)).toBe(1);
    expect(component).toMatch(/onError: \(\) => setState\("error"\)/);
    // 늦은 실패만 짧게 알리고 초점은 옮기지 않는다.
    expect(component).toMatch(/openedWhileLoading && cover\.state === "error"/);
  });

  it("상세는 닫힐 때 연 버튼(없으면 작품 영역)으로 포커스를 돌려준다", () => {
    expect(component).toMatch(/trigger\?\.isConnected && trigger\.getClientRects\(\)\.length > 0\) trigger\.focus\(\)/);
    expect(component).toMatch(/else document\.getElementById\(ids\.browse\)\?\.focus\(\)/);
    expect(component).toMatch(/onClose=\{onDialogClose\}/);
  });
});

describe("T369 후속: 화면 준비 전 첫 종류 클릭(Tester abb0f20)", () => {
  const railOf = (html: string) => { const start = html.indexOf('role="status"'); return html.slice(start, html.indexOf("</section>", start)); };
  it("종류 버튼은 GET 폼의 제출 버튼이라 화면 준비 전 클릭도 ?kind=로 서버에 전달된다", () => {
    const html = render({ works: SAMPLE_WORKS });
    const form = html.match(/<form\b[^>]*aria-label="콘텐츠 종류"[^>]*>[\s\S]*?<\/form>/)?.[0];
    expect(form).toBeDefined();
    expect(form).toMatch(/method="get"/);
    expect(form).toMatch(/action="#[^"]+"/);
    const buttons = [...form!.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
    expect(buttons.map((match) => match[2])).toEqual([...SHOWCASE_FILTERS]);
    for (const [, attrs, label] of buttons) {
      expect(attrs).toContain('type="submit"');
      expect(attrs).toContain('name="kind"');
      expect(attrs).toContain(`value="${label}"`);
    }
    expect(count(form!, /aria-pressed="true"/g)).toBe(1);
    expect(form).toMatch(/aria-pressed="true"[^>]*>전체</);
  });

  it("서버가 받은 정해진 종류는 첫 화면부터 반영하고, 그 밖의 값은 전체로 둔다", () => {
    const music = render({ works: SAMPLE_WORKS, requestedFilter: "음악" });
    expect(music).toMatch(/aria-pressed="true"[^>]*>음악</);
    expect(count(music, /aria-pressed="true"/g)).toBe(1);
    const rail = railOf(music);
    for (const id of ["LIQUID BLOOM", "CELESTIAL DRIFT", "SUNGLASS"]) expect(rail).toContain(id);
    for (const other of ["NEON AFTER HOURS", "DESERT MOTION", "THE WILD COAST"]) expect(rail).not.toContain(`${other} 자세히 보기`);
    for (const bad of ["music", "음악 ", "", ["음악", "영상"]] as const) {
      const html = render({ works: SAMPLE_WORKS, requestedFilter: bad as string | readonly string[] });
      expect(html).toMatch(/aria-pressed="true"[^>]*>전체</);
    }
  });

  it("준비 뒤 클릭은 제출을 막고 화면 안에서 바꾸며, 남은 ?kind=를 지운다", () => {
    const source = read("components/public-showcase/neon-showcase.tsx");
    expect(source).toContain("onClick={(event) => { event.preventDefault(); chooseFilter(item); }}");
    expect(source).toMatch(/searchParams\.delete\("kind"\)[\s\S]*history\.replaceState/);
    expect(read("app/(public)/page.tsx")).toMatch(/const kind = \(await props\.searchParams\)\?\.kind;/);
  });
});

describe("디자인 9299c2d: 뮤직 컬렉션 목적지", () => {
  it("주 메뉴 세 번째와 본문 링크가 같은 섹션으로 가고, 도착 제목이 같은 이름이다", () => {
    const html = render({ works: SAMPLE_WORKS });
    const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)?.[0] ?? "";
    const navLinks = [...nav.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
    expect(navLinks.map(([, label]) => label)).toEqual(["발견", "작품", "뮤직 컬렉션"]);
    const target = navLinks[2][0];
    expect(html).toMatch(new RegExp(`<a [^>]*href="#${target}"[^>]*>뮤직 컬렉션 <span aria-hidden="true">↗</span></a>`));
    const section = html.match(new RegExp(`<section\\b[^>]*id="${target}"[^>]*>`))?.[0];
    expect(section).toContain('tabindex="-1"');
    const labelled = section?.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(html).toMatch(new RegExp(`<h2 id="${labelled}">뮤직 컬렉션</h2>`));
    expect(html).toContain("<p>한 장의 커버, 무한한 상상.</p>");
    // 주 메뉴 마지막은 공개 분석 결과 페이지로 가는 일반 링크 하나다.
    expect([...nav.matchAll(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]])).toEqual([["/analysis-results", "분석 결과"]]);
    expect(nav).not.toContain(">크리에이터<");
    const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(footer).toMatch(/<a\b[^>]*href="\/login"[^>]*>크리에이터 로그인 ↗<\/a>/);
  });

  it("음악 카드가 0개여도 제목과 빈 목록 안내가 보인다", () => {
    const html = render({ works: SAMPLE_WORKS.filter((work) => work.kind !== "음악") });
    expect(html).toMatch(/<h2 id="[^"]+">뮤직 컬렉션<\/h2>/);
    expect(html).toContain("공개된 음악 작품이 생기면 이곳에 모아 보여 드릴게요.");
  });
});
