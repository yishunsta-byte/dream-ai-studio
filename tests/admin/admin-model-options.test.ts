// 주인님 지시(2026-11-24): API연동 카드의 '저장된 모델 · 모델 ID · 목록에 없는 모델은 직접 입력하세요' 칸을 없애고 선택지로만 고른다.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminModelOptions } from "@/components/admin/admin-model-options";

const render = (value: string) => renderToStaticMarkup(createElement(AdminModelOptions, {
  name: "m", label: "모델 선택", options: ["a-1", "b-2"], value, onChange: () => {}, id: "focus-me" }));

describe("model choice without a free-text model ID box", () => {
  it("marks the saved model and puts the focus id on it", () => {
    const html = render("b-2");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/id="focus-me"[^>]*checked|checked[^>]*id="focus-me"/);
  });

  it("keeps a saved model that is not in the list as one more choice", () => {
    const html = render("custom-9");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain("custom-9");
  });

  it("removes the model ID box from both settings cards", () => {
    for (const file of ["components/admin/admin-gemini-settings.tsx", "components/admin/admin-style-dna-engine-settings.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("목록에 없는 모델은 직접 입력하세요");
      expect(source, file).not.toContain("저장된 모델 <strong>");
      expect(source, file).not.toMatch(/>모델 ID</);
      expect(source, file).not.toMatch(/modelId=\{</);
    }
  });
});
