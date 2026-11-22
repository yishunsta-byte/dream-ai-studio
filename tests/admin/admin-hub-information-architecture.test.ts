import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminHub } from "@/components/admin/admin-hub";
import { AdminOperationsHome } from "@/components/admin/admin-operations-home";
import type { AdminProjects } from "@/components/admin/admin-projects";
import { PublicationHttpQueue } from "@/components/admin/publication-http-queue";
import type { PublicationList } from "@/components/admin/publication-model";

vi.mock("server-only", () => ({}));

function markup(projects: AdminProjects, review: PublicationList) {
  return renderToStaticMarkup(createElement(AdminHub, {
    email: "admin@example.invalid", projects, home: createElement(AdminOperationsHome, { publications: review }), review: createElement(PublicationHttpQueue, { initial: review }),
  }));
}

describe("admin hub information architecture", () => {
  it("offers genuine, focusable in-page destinations in content order", () => {
    const html = markup({ kind: "unlinked" }, { kind: "closed" });
    const nav = html.match(/<nav\b[^>]*aria-label="관리 메뉴"[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeDefined();
    const operations = ["admin-image-analysis", "admin-music-analysis", "admin-shorts-analysis", "admin-project-list", "admin-review", "admin-render-queue", "admin-account", "admin-operations-availability", "admin-manual"];
    expect([...nav!.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])).toEqual(operations);
    expect(html).toContain('<h1 class="sr-only">관리 화면</h1>');
    expect(nav).not.toContain("콘텐츠 분석기");
    expect(html.indexOf(nav!)).toBeLessThan(html.indexOf('id="admin-image-analysis"'));
    expect(html).not.toContain(' id="admin-style-dna"');
    expect(html).toMatch(/<nav aria-label="이미지 분석 결과 공개"[^>]*><a [^>]*href="#admin-image-publication"/);
    expect(html).toMatch(/<nav aria-label="이미지 분석 결과 공개"[\s\S]*?href="\/admin\/style-dna"/);
    expect(nav).not.toContain("aria-current=");
    for (const id of [...operations, "admin-home", "admin-image-publication", "admin-analysis-results", "admin-api-integrations"]) {
      expect(html.match(new RegExp(`\\bid="${id}"`, "g"))).toHaveLength(1);
      expect(html).toMatch(new RegExp(`<[^>]+id="${id}"[^>]*tabindex="-1"`));
    }
    expect(html).not.toContain("admin-overview");
    const projectPanel = html.slice(html.indexOf('id="admin-project-list"'), html.indexOf('id="admin-image-publication"'));
    for (const href of ["/cloud/manage", "/cloud/projects"]) expect(projectPanel).toContain(`href="${href}"`);
    expect(html).toContain('href="/account/password"');
    expect(html.indexOf('id="admin-project-list"')).toBeLessThan(html.indexOf('id="admin-image-publication"'));
    expect(html.indexOf('id="admin-image-publication"')).toBeLessThan(html.indexOf('id="admin-review"'));
    expect(html.indexOf('id="admin-review"')).toBeLessThan(html.indexOf('id="admin-account"'));
  });

  it("renders dedicated program destinations and retires the legacy analysis and publication form", () => {
    const html = markup({ kind: "unlinked" }, { kind: "closed" });
    expect(html).toContain('aria-label="운영 메뉴"');
    expect(html).not.toContain('id="admin-program-navigation"');
    expect(html).toMatch(/이미지 분석<\/a>[\s\S]*오디오 분석<\/a>[\s\S]*영상 분석<\/a>[\s\S]*내 프로젝트<\/a>/);
    expect(html).toMatch(/id="admin-account"[^>]*>[\s\S]*?<h2 id="admin-menu" tabindex="-1">API키등록·플랫폼연동<\/h2>[\s\S]*?비밀번호 바꾸기[\s\S]*?<section id="admin-api-integrations"[^>]*><h3 id="admin-api-integrations-title" tabindex="-1">API연동<\/h3>/);
    expect(html).not.toMatch(/Style DNA|콘텐츠 분석·공개|>공개 준비<\/button>|id="admin-reference-analysis"/);
    expect(html).toContain("완성본 검수·게시");
    expect(html).toContain("분석 결과 관리");
    expect(html).toContain('<h2 id="admin-manual-heading" tabindex="-1">사용매뉴얼</h2>');
    expect(html).toContain("Gemini API연동");
    expect(html).toContain("플랫폼 이용 방법");
  });


  it("keeps missing operational suppliers as text with no actions or placeholder metrics", () => {
    const html = markup({ kind: "unlinked" }, { kind: "closed" });
    const level = html.match(/<section\b[^>]*id="admin-operations-availability"[\s\S]*?<\/section>/)?.[0];
    expect(level).toBeDefined();
    for (const label of ["작업 대기열", "자료 관리", "백업·복원", "운영 로그", "회원 관리", "서비스 상태"]) {
      expect(level).toContain(label);
    }
    // 디자인 75657a7: 6개 항목은 접힌 details 한 묶음 안에 있고, 펼침 조작 이름이 실제 개수를 말한다.
    const group = level!.match(/<details\b[^>]*>[\s\S]*<\/details>/)?.[0];
    expect(group).toBeDefined();
    expect(group).not.toMatch(/<details\b[^>]*\bopen\b/);
    const summary = group!.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "";
    expect(summary).toMatch(/<span[^>]*>미연결 기능 6개 보기<\/span>/);
    expect(summary).toMatch(/<span[^>]*>미연결 기능 6개 접기<\/span>/);
    const body = group!.slice(group!.indexOf("</summary>"));
    expect(body.match(/미연결/g)).toHaveLength(6);
    expect(level).not.toMatch(/href=|<button|\d+건|정상 작동/);
    expect(level!.replace(summary, "")).not.toMatch(/\d+개/);
    expect(html).toContain("이 환경에서 내 프로젝트를 조회하려면 운영 담당자의 연결 확인이 필요해요.");
    expect(html).toContain("관리자 게시·철회 서버 기능이 아직 연결되지 않았어요");
    expect(html).not.toContain("목록 다시 불러오기");
  });

  it("preserves linked empty and failed states from the project and review components", () => {
    const empty = markup({ kind: "empty", readAt: "2026-11-19T01:00:00.000Z" }, { kind: "ok", items: [] });
    expect(empty).toContain("내 프로젝트가 0개예요");
    expect(empty).toContain("검수할 완성본이 없어요");
    expect(empty).toContain("목록 다시 불러오기");
    expect(empty).not.toMatch(/운영 담당자의 연결 확인이 필요해요|게시·철회 서버 기능이 아직 연결되지 않았어요/);

    const failed = markup({ kind: "failed" }, { kind: "failed" });
    expect(failed).toContain("프로젝트 목록을 불러오지 못했어요");
    expect(failed).toContain("게시 목록을 불러오지 못했어요");
    expect(failed).not.toMatch(/내 프로젝트가 0개|조회 시각|검수할 완성본이 없어요/);
  });
});
