import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioRegisteredAnalysisPage } from "../../components/reference-analysis/studio-registered-analysis-page";

// 콘텐츠 분석 보호 셸의 제품 미연결 안내(분석 종류·입력 예정 범위·게시물 주소 미지원·다음 행동).
const html = renderToStaticMarkup(createElement(StudioRegisteredAnalysisPage));
const source = readFileSync("components/reference-analysis/studio-registered-analysis-page.tsx", "utf8");
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("콘텐츠 분석 미연결 안내", () => {
  it("실행할 수 없다는 상태를 먼저 알리고, 분석 종류 세 가지와 등록 자료 입력 범위를 밝힌다", () => {
    expect(text).toContain("등록 자료 분석을 준비 중이에요.");
    expect(text).toContain("아직 분석을 실행할 수 없고");
    expect(text).toContain("프로젝트에 등록한 자료에서 관찰 근거를 확인하고 초안을 다듬어요.");
    expect(html.indexOf("등록 자료 분석을 준비 중이에요")).toBeLessThan(html.indexOf("<select"));
    expect(html.indexOf("분석 준비 상태")).toBeLessThan(html.indexOf("등록 자료 분석</h2>"));
    // 클라우드 실측은 등록 PNG뿐: 나머지는 목표 범위로만 표기한다.
    for (const kind of ["이미지 · 예: PNG · 클라우드 연결 시험에서 확인", "음악 · 예: M4A · 목표 범위", "영상·쇼츠 · 예: MP4 · 목표 범위"]) {
      expect(text).toContain(kind);
    }
    expect(text).toContain("내 프로젝트에 등록하고 사용 권한을 확인한 자료 한 개를 골라 분석해요.");
  });

  it("게시물 주소 미지원과 다음 행동(내 프로젝트로 이동)을 안내한다", () => {
    expect(text).toContain("게시물 주소는 지원하지 않아요");
    expect(text).toContain("YouTube·Instagram·TikTok 같은 게시물 주소로는 분석하지 않아요.");
    expect(html).toContain('<a href="/cloud/projects">내 프로젝트로 이동</a>');
  });

  it("자료명·예시 결과·누를 수 있는 실행 버튼이 없다", () => {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toContain('disabled=""');
    expect(html).toMatch(/<select[^>]+disabled=""/);
    expect(html.match(/<option/g)).toHaveLength(1);
    expect(text).not.toMatch(/직접 관찰|분석 추정|내 수정본|예시 데이터|\.png|\.m4a|\.mp4|\.wav/i);
    expect(html).not.toMatch(/<input|<textarea/);
  });

  it("T317 보호 셸 계약(props 없음·목록 요청 없음)을 그대로 지킨다", () => {
    expect(createElement(StudioRegisteredAnalysisPage).props).toEqual({});
    expect(source).toContain("export function StudioRegisteredAnalysisPage() {");
    expect(source).not.toMatch(/fetch\(|useEffect|materials=|provider=/);
    expect(source).toContain("<StudioRegisteredAnalysis />");
  });
});
