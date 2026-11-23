import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminNavigation } from "@/components/admin/admin-navigation";
import { AdminPlatformGuides, analysisKeysHeadingId, platformGuides, platformListHeadingId, youtubeSearchKeyHeadingId } from "@/components/admin/admin-platform-guides";
import { AdminPlatformIntegrations } from "@/components/admin/admin-platform-integrations";

// P1-00-ADMIN-PLATFORM-CONSOLE-OPTION3(Master msg_6096c0b281cd 배정 1, 주인님 선택 3안 · CMD-20261123-030)
// 화면 동작(키보드 이동·초점·좁은 화면 배치·넘침·현재 위치)은 인계 문서의 합성 실제 Next 브라우저 결과를 본다.
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const count = (text: string, part: string) => text.split(part).length - 1;

describe("P1-00 3안 연동 콘솔", () => {
  const html = renderToStaticMarkup(createElement(AdminPlatformGuides));

  it("왼쪽 목록은 네 플랫폼 탭(Threads·Instagram·YouTube·Google Drive)이고 처음에는 Threads만 고른 상태다", () => {
    expect(platformGuides.map(platform => platform.name)).toEqual(["Threads", "Instagram", "YouTube", "Google Drive"]);
    expect(html).toContain('role="tablist" aria-label="연동 플랫폼" aria-orientation="vertical"');
    expect(count(html, 'role="tab"')).toBe(4);
    expect(count(html, 'aria-selected="true"')).toBe(1);
    expect(html).toMatch(/aria-selected="true" tabindex="0" data-platform="threads"/);
    for (const slug of ["instagram", "youtube", "drive"]) expect(html).toMatch(new RegExp(`aria-selected="false" tabindex="-1" data-platform="${slug}"`));
    // 탭과 칸이 서로 가리킨다.
    for (const slug of ["threads", "instagram", "youtube", "drive"]) {
      const tab = new RegExp(`id="([^"]+-tab-${slug})" aria-controls="([^"]+-panel-${slug})"`).exec(html);
      expect(tab).not.toBeNull();
      expect(html).toContain(`id="${tab![2]}" role="tabpanel" aria-labelledby="${tab![1]}"`);
    }
  });

  it("오른쪽 상세는 네 칸을 모두 그리고 고르지 않은 세 칸만 숨긴다. 각 칸에 준비 상태·항목·설정 순서·권한·가이드가 있다", () => {
    expect(count(html, 'role="tabpanel"')).toBe(4);
    expect(count(html, 'role="tabpanel" aria-labelledby')).toBe(4);
    expect(count(html, ' hidden="" data-platform-panel=')).toBe(3);
    expect(html).not.toMatch(/hidden="" data-platform-panel="threads"/);
    expect(count(html, "계정 연결 준비 중")).toBe(4);
    expect(count(html, ">연결에 필요한 항목</h5>")).toBe(4);
    expect(count(html, ">설정 순서</h5>")).toBe(4);
    for (const { name, href, fields, steps } of platformGuides) {
      expect(html).toContain(`href="${href}" target="_blank" rel="noreferrer">${name} 설정 가이드`);
      for (const field of fields) expect(html).toContain(`<label>${field}<input`);
      for (const step of steps) {
        expect(html).toContain(`<strong>${step.title}</strong>`);
        for (const value of step.values ?? []) expect(html).toContain(`aria-label="${value} 복사"`);
      }
    }
  });

  it("계정 연결(OAuth)이 없으므로 입력 항목은 비활성이고 값을 받거나 보내지 않는다(비밀번호 칸·이름·폼 전송·요청 없음)", () => {
    expect(count(html, "<fieldset")).toBe(4);
    expect(count(html, "disabled=\"\" aria-label=")).toBe(4);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/<input[^>]* name=/);
    expect(html).not.toMatch(/<input[^>]* value=/);
    const source = read("components/admin/admin-platform-guides.tsx");
    expect(source).not.toMatch(/fetch\(|["'`]\/api\/|localStorage|sessionStorage|location\.hash|history\./);
    expect(html).toContain("계정 연결이 제공되면 입력할 수 있어요.");
  });

  it("YouTube 칸에만 공개 검색 키 등록으로 가는 단추가 있고, 그 칸의 제목 id가 실제 등록 칸 제목과 같다", () => {
    expect(count(html, "공개 쇼츠 검색 키는 같은 화면의")).toBe(1);
    const youtube = html.slice(html.indexOf('data-platform-panel="youtube"'), html.indexOf('data-platform-panel="drive"'));
    expect(youtube).toContain('<button type="button">YouTube Data API v3 등록</button>');
    expect(read("components/admin/admin-platform-integrations.tsx")).toContain(`<h3 id="${youtubeSearchKeyHeadingId}">YouTube Data API v3 등록</h3>`);
  });

  it("단독 /admin/integrations 화면은 기존 키 등록 칸 순서를 지키고 연동 방법 칸 안에 콘솔을 둔다", () => {
    const page = renderToStaticMarkup(createElement(AdminPlatformIntegrations, { email: "fixture@example.invalid" }));
    const headings = ["AI 분석 엔진", "이미지·음악·영상 생성 API", "YouTube Data API v3 등록", "내 채널 및 저장소 연동 방법"];
    const positions = headings.map(heading => page.indexOf(`>${heading}</h3>`));
    expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))).toBe(true);
    expect(page.indexOf("data-platform-console")).toBeGreaterThan(positions[3]);
    for (const label of ["OpenAI 키·모델", "Claude 키·모델", "Gemini 키·모델"]) expect(page).toContain(label);
    expect(page).toContain('href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"');
  });

  it("좁은 화면(720px 이하)은 목록을 위 2열로 두고 목록의 '준비 중' 표시를 감춘다. 좁을 때 키는 좌우 화살표다", () => {
    const css = read("components/admin/admin-platform-integrations.module.css");
    expect(css).toMatch(/\.platformConsole \{[^}]*grid-template-columns: minmax\(220px, \.31fr\) minmax\(0, 1fr\);/);
    const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(narrow).toMatch(/\.platformConsole \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(narrow).toMatch(/\.platformPicker \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    expect(narrow).toMatch(/\.listStatus \{ display: none; \}/);
    const source = read("components/admin/admin-platform-guides.tsx");
    expect(source).toContain('const narrowQuery = "(max-width: 720px)";');
    expect(source).toContain('const forward = narrow ? "ArrowRight" : "ArrowDown";');
    expect(source).toContain('if (event.key === "Home") next = 0;');
  });
});

describe("P1-00 3안 상단 분석 세 버튼", () => {
  it("이미지·오디오·영상 분석 세 링크만 보라 개별 테두리 표시를 받고 다른 메뉴는 그대로다", () => {
    const nav = renderToStaticMarkup(createElement(AdminNavigation));
    expect(count(nav, 'data-analysis="true"')).toBe(3);
    for (const id of ["admin-image-analysis", "admin-music-analysis", "admin-shorts-analysis"]) {
      expect(nav).toMatch(new RegExp(`href="#${id}"[^>]*data-analysis="true"`));
    }
    for (const id of ["admin-project-list", "admin-review", "admin-render-queue", "admin-account", "admin-operations-availability", "admin-manual"]) {
      expect(nav).toMatch(new RegExp(`href="#${id}"(?![^>]*data-analysis)`));
    }
    const css = read("components/admin/admin.module.css");
    expect(css).toContain(".navigation a[data-analysis] { border: 1px solid #75619b; background: #352650; color: #e9e1ff; }");
    expect(css).toContain('.navigation a[data-analysis][aria-current="location"] { border-color: #dac7ff;');
  });
});

// 배정 2(Master msg_29398cc5eb62, 독립 검수 msg_79e716cbb40b 진입 동선 FAIL): 키 등록 칸은 위에 그대로, 설정 맨 위에 두 영역 바로가기.
describe("P1-00 3안 배정 2 설정 바로가기", () => {
  const page = renderToStaticMarkup(createElement(AdminPlatformIntegrations, { email: "fixture@example.invalid" }));

  it("설정 맨 위(첫 칸 앞)에 '분석 API 설정'·'채널·저장소 연동' 바로가기가 있고 키 등록 칸은 그대로 다음에 온다", () => {
    const group = page.indexOf('role="group" aria-label="설정 바로가기"');
    expect(group).toBeGreaterThan(page.indexOf("<h1>API키등록·플랫폼연동</h1>"));
    expect(group).toBeLessThan(page.indexOf(">AI 분석 엔진</h3>"));
    const shortcuts = page.slice(group, page.indexOf("</div>", group));
    expect(shortcuts).toContain('<button type="button">분석 API 설정</button><button type="button">채널·저장소 연동</button>');
    for (const label of ["OpenAI 키·모델", "Claude 키·모델", "Gemini 키·모델"]) expect(page.indexOf(label)).toBeGreaterThan(group);
  });

  it("바로가기 대상 id가 실제 칸 제목과 같고, 플랫폼 제목은 목록 바로 위·복귀 단추는 콘솔 뒤다", () => {
    expect(page).toContain(`<h3 id="${analysisKeysHeadingId}">AI 분석 엔진</h3>`);
    expect(page).toContain(`<h3 id="${platformListHeadingId}">내 채널 및 저장소 연동 방법</h3>`);
    const heading = page.indexOf(`id="${platformListHeadingId}"`);
    const tablist = page.indexOf('role="tablist" aria-label="연동 플랫폼"');
    expect(tablist).toBeGreaterThan(heading);
    // 제목과 목록 사이에 초점이 갈 요소가 없다(제목 다음 Tab이 고른 플랫폼 탭).
    expect(page.slice(heading, tablist)).not.toMatch(/<(button|a|input|select|textarea)[\s>]/);
    const back = page.indexOf("분석 API 설정으로 돌아가기");
    expect(back).toBeGreaterThan(page.lastIndexOf('role="tabpanel"'));
  });

  it("바로가기는 해시·주소를 바꾸지 않고 제목에 초점을 먼저 준 뒤 스크롤한다(YouTube 이동과 같은 함수)", () => {
    const source = read("components/admin/admin-platform-guides.tsx");
    const jump = source.slice(source.indexOf("function focusSectionHeading"), source.indexOf("// P1-00-ADMIN-PLATFORM-CONSOLE-OPTION3 배정 2"));
    expect(jump.indexOf("heading.focus({ preventScroll: true });")).toBeLessThan(jump.indexOf('heading.scrollIntoView({ block: "start" });'));
    expect(source).not.toMatch(/location\.|history\.|router|href=\{?["'`]#/);
    expect(count(source, "focusSectionHeading(")).toBe(5);
  });
});
