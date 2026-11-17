import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginForm } from "@/components/auth/login-form";

// T-197: 로그인 실패 뒤 '비밀번호 찾기' 안내. 상호작용은 실제 브라우저로 확인했고(보고서), 여기서는 고정할 규칙만 본다.
const source = readFileSync("components/auth/login-form.tsx", "utf8");

describe("T-197 로그인 실패 뒤 비밀번호 찾기 안내", () => {
  it("처음 화면에는 안내·전환 버튼이 없다", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { next: "/" }));
    expect(html).not.toContain("비밀번호 찾기로 정하기");
    expect(html).not.toContain("비밀번호를 정한 적이 없다면");
    expect(html).toContain("비밀번호 찾기");
  });
  it("링크 오류 등 서버가 넘긴 처음 오류에도 전환 버튼은 붙지 않는다", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { next: "/", initialError: "메일 링크가 만료됐어요." }));
    expect(html).toContain("메일 링크가 만료됐어요.");
    expect(html).not.toContain("비밀번호 찾기로 정하기");
  });
  it("안내는 로그인 화면의 INVALID_CREDENTIALS에만 붙고, 계정·허용 여부를 따로 말하지 않는다", () => {
    expect(source).toMatch(/offerReset = mode === "login" && code === "INVALID_CREDENTIALS"/);
    expect(source).not.toMatch(/AUTH_FORBIDDEN|허용 목록|가입하지 않은|없는 계정/);
  });
  it("화면을 바꿀 때 이메일만 옮기고 비밀번호는 옮기지 않는다", () => {
    expect(source).toMatch(/setDraftEmail\(currentEmail\(\)\)/);
    expect(source).not.toMatch(/setDraft\w*\(.*password/i);
    expect(source.match(/defaultValue=\{draftEmail\}/g)?.length).toBe(2);
    expect(source).not.toMatch(/defaultValue=\{[^}]*[Pp]assword/);
  });
  it("전환은 화면 상태만 바꾸고 요청을 보내지 않는다(요청은 submit 안에서만)", () => {
    const switchBody = source.slice(source.indexOf("function switchTo"), source.indexOf("function onTabKey"));
    expect(switchBody).not.toMatch(/fetch|post\(/);
  });
});
