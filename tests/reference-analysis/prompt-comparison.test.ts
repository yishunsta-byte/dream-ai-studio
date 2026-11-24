import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromptComparison } from "../../components/reference-analysis/prompt-comparison";

const render = (original: string, edited: string) => renderToStaticMarkup(createElement(PromptComparison, { original, edited }));

describe("local prompt comparison", () => {
  it("preserves the original and identifies a replacement inside unchanged text", () => {
    const html = render("장면 🎹 빠르게 재생", "장면 🎬 느리게 재생");
    expect(html).toContain("장면 🎹 빠르게 재생");
    expect(html).toContain("<span>🎹 빠르</span>");
    expect(html).toContain("<strong>🎬 느리</strong>");
  });
  it("handles insertions, clearing the draft, and restoring the original", () => {
    expect(render("원문", "원문 추가")).toContain("<strong> 추가</strong>");
    expect(render("원문", "")).toContain("<span>원문</span>");
    expect(render("원문", "원문")).toContain("분석 초안과 같아요.");
  });
  it("identifies the generated draft and explains unchanged text between two edits", () => {
    const html = render("A 그대로 B", "X 그대로 Y");
    expect(html).toContain("분석으로 생성한 초안");
    expect(html).toContain("제작자가 공개한 프롬프트는 확인되지 않았어요.");
    expect(html).toContain("첫 수정부터 마지막 수정까지");
    expect(html).toContain("중간에 그대로인 문구");
    expect(html).toContain("<strong>X 그대로 Y</strong>");
  });
});
