import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudioRegisteredAnalysis, type RegisteredAnalysisProvider } from "../../components/reference-analysis/studio-registered-analysis";
import { neutralMaterials, ProtectedMaterialsView } from "../../components/reference-analysis/studio-protected-materials-analysis";

// 보호 목록 격리 연결 전용 사용 권리 확인. 실제 선택·해제 동작은 격리 브라우저 검증(인계 문서)에서 본다.
const material = { projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012", label: "등록 자료 1" };
const provider = (): RegisteredAnalysisProvider => ({ materials: [material], analyze: vi.fn() });
const source = readFileSync("components/reference-analysis/studio-registered-analysis.tsx", "utf8");

describe("사용 권리 확인", () => {
  it("기본값(꺼짐)인 기존 호출자에게는 체크 칸이 없고 화면이 그대로다", () => {
    for (const element of [createElement(StudioRegisteredAnalysis), createElement(StudioRegisteredAnalysis, { provider: provider() })]) {
      const html = renderToStaticMarkup(element);
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain("분석할 권리가 있어요");
    }
    expect(source).toContain("requireRightsConfirmation = false");
  });

  it("켜면 선택 전에는 체크 칸과 실행이 모두 꺼져 있다", () => {
    const html = renderToStaticMarkup(createElement(StudioRegisteredAnalysis, { provider: provider(), requireRightsConfirmation: true }));
    expect(html).toMatch(/<input type="checkbox" disabled=""[^>]*>이 자료를 분석할 권리가 있어요\./);
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>분석 실행/);
    expect(html.indexOf('type="checkbox"')).toBeLessThan(html.indexOf("분석 실행"));
  });

  it("확인 없이는 분석을 요청하지 않고, 확인은 그 공급자·그 선택에만 묶인다", () => {
    expect(source).toContain("if (!provider || selectedIndex < 0 || !confirmed || activeJob.current) return;");
    expect(source).toContain("rights?.provider === provider && rights?.key === key");
    expect(source).toMatch(/disabled=\{selectedIndex < 0 \|\| !confirmed\}/);
    // 결과는 확인된 선택에서만 보인다.
    expect(source).toContain("const current = confirmed && view?.job.provider === provider");
  });

  it("선택을 바꾸거나 해제하면 진행 중 요청을 취소하고 결과·확인을 지운다", () => {
    const change = source.slice(source.indexOf("function changeSelection"), source.indexOf("function changeRights"));
    expect(change).toContain("job?.controller.abort();");
    expect(change).toContain("setRights(undefined);");
    const rights = source.slice(source.indexOf("function changeRights"), source.indexOf("async function run"));
    expect(rights).toContain("activeJob.current = null;");
    expect(rights).toContain("job?.controller.abort();");
    expect(rights).toContain("setView(undefined);");
  });

  it("보호 목록 어댑터는 확인을 켜서 기존 화면을 쓴다", () => {
    const materials = neutralMaterials({ materials: [{ ...material, label: "서버 이름" }] })!;
    const html = renderToStaticMarkup(createElement(ProtectedMaterialsView, {
      state: { kind: "ready", materials }, notice: null, provider: { materials, analyze: vi.fn() }, loginHref: "/login",
    }));
    expect(html).toMatch(/<input type="checkbox" disabled=""[^>]*>이 자료를 분석할 권리가 있어요\./);
    expect(readFileSync("components/reference-analysis/studio-protected-materials-analysis.tsx", "utf8"))
      .toContain("<StudioRegisteredAnalysis provider={provider} requireRightsConfirmation />");
  });
});
