import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminHub } from "@/components/admin/admin-hub";
import type { AdminProjects } from "@/components/admin/admin-projects";
import { PublicationHttpQueue } from "@/components/admin/publication-http-queue";
import type { PublicationList } from "@/components/admin/publication-model";

vi.mock("server-only", () => ({}));

function markup(projects: AdminProjects, review: PublicationList) {
  return renderToStaticMarkup(createElement(AdminHub, {
    email: "admin@example.invalid", projects, review: createElement(PublicationHttpQueue, { initial: review }),
  }));
}

describe("admin hub information architecture", () => {
  it("offers genuine, focusable in-page destinations in content order", () => {
    const html = markup({ kind: "unlinked" }, { kind: "closed" });
    const nav = html.match(/<nav\b[^>]*aria-label="관리 메뉴"[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeDefined();
    const targets = ["admin-overview", "admin-project-list", "admin-review", "admin-render-queue", "admin-account"];
    expect([...nav!.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])).toEqual(targets);
    expect(nav).toMatch(/href="#admin-project-list" aria-current="location"/);
    expect(nav!.match(/aria-current=/g)).toHaveLength(1);
    for (const id of targets) {
      expect(html.match(new RegExp(`\\bid="${id}"`, "g"))).toHaveLength(1);
      expect(html).toMatch(new RegExp(`<[^>]+id="${id}"[^>]*tabindex="-1"`));
    }
    for (const href of ["/cloud/manage", "/cloud/projects", "/account/password"]) expect(html).toContain(`href="${href}"`);
    expect(html.indexOf('id="admin-project-list"')).toBeLessThan(html.indexOf('id="admin-review"'));
    expect(html.indexOf('id="admin-review"')).toBeLessThan(html.indexOf('id="admin-account"'));
  });

  it("keeps missing operational suppliers as text with no actions or placeholder metrics", () => {
    const html = markup({ kind: "unlinked" }, { kind: "closed" });
    const level = html.match(/<section\b[^>]*aria-labelledby="admin-unlinked"[\s\S]*?<\/section>/)?.[0];
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
    expect(level).not.toMatch(/href=|<button|tabindex|\d+건|정상 작동/);
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
