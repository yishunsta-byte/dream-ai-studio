import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageSemanticReport } from "@/components/admin/admin-image-semantic";
import { ADMIN_SETTINGS_HREF, SettingsLink } from "@/components/admin/admin-settings-link";
import { StyleDnaReport } from "@/components/admin/admin-style-dna-report";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const notConfigured = { status: "unavailable", reason: "not_configured" } as const;

describe("분석 부품 설정 링크", () => {
  it("기본은 관리자 API연동, 주소를 주면 그 주소, null이면 숨긴다", () => {
    expect(ADMIN_SETTINGS_HREF).toBe("#admin-api-integrations");
    expect(html(createElement(SettingsLink, { href: "/workspace/settings#gemini" }))).toBe('<a href="/workspace/settings#gemini">API연동 보기</a>');
    expect(html(createElement(SettingsLink, { href: null }))).toBe("");
  });
  it("이미지 리포트: 생략하면 지금처럼 관리자 링크", () => {
    expect(html(createElement(ImageSemanticReport, { semantic: notConfigured }))).toContain('href="#admin-api-integrations"');
    expect(html(createElement(StyleDnaReport, { semantic: notConfigured }))).toContain('href="#admin-api-integrations"');
  });
  it("Style DNA 리포트가 받은 설정 주소를 안쪽 안내까지 넘긴다", () => {
    const custom = html(createElement(StyleDnaReport, { semantic: notConfigured, settingsHref: "/workspace/settings" }));
    expect(custom).toContain('href="/workspace/settings"');
    expect(custom).not.toContain("#admin-api-integrations");
    const hidden = html(createElement(StyleDnaReport, { semantic: notConfigured, settingsHref: null }));
    expect(hidden).not.toContain("API연동 보기");
    expect(hidden).toContain("Gemini 설정이 필요해요"); // 안내 문구는 그대로
  });
  it("미설정이 아닌 실패에는 설정 링크를 붙이지 않는다", () => {
    expect(html(createElement(ImageSemanticReport, { semantic: { status: "unavailable", reason: "timed_out" } }))).not.toContain("API연동 보기");
  });
});
