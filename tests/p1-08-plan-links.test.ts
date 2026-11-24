import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudPlanPath } from "@/components/cloud/managed-plan-requests";

// P1-08 연결(Master msg_0702fd96f2b3): 브리프 승인 뒤·프로젝트 상세에서 /cloud/projects/{id}/plan으로.
// 관리형 기획 미지정·브리프 미승인·기획 잠김이면 링크 없음. 기존 조회·로컬 계약은 그대로.
const state = vi.hoisted(() => ({
  auth: { kind: "verified", userId: "u" } as unknown,
  read: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
  notFound: vi.fn(() => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: state.notFound }));
vi.mock("@/lib/auth/render", () => ({ getRenderAuth: async () => state.auth }));
vi.mock("@/lib/cloud/project-read-page", async (original) => ({ ...await original<object>(), readCloudProject: state.read }));
vi.mock("@/components/cloud/managed-brief-panel", () => ({
  ManagedBriefPanel: (props: { projectId: string; planHref?: string }) => createElement("i", { "data-project": props.projectId, "data-plan": props.planHref ?? "none" }),
}));

const P = "01936b2e-8f3a-7c4d-8e5f-1a2b3c4d5e6f";
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
const detailPage = async () => (await import("@/app/(cloud)/cloud/projects/[id]/page")).default({ params: Promise.resolve({ id: P }) });
const briefPage = async () => (await import("@/app/(cloud)/cloud/projects/[id]/brief/page")).default({ params: Promise.resolve({ id: P }) });
const KEYS = ["DREAM_PROJECT_PLAN_BACKEND", "DREAM_PROJECT_CORE_BACKEND"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } state.auth = { kind: "verified", userId: "u" }; vi.clearAllMocks(); });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const detail = (brief: string, plan: string) => ({ kind: "ok", data: { id: P, title: "제목", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-22T00:00:00.000Z",
  stages: [{ stage: "intake", label: "등록", status: "approved" }, { stage: "brief", label: "브리프", status: brief }, { stage: "plan", label: "기획", status: plan }] } });
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map(match => match[1]);

describe("프로젝트 상세 → 기획 링크", () => {
  it.each([
    [true, "approved", "todo", true], [true, "approved", "in_progress", true], [true, "approved", "needs_approval", true], [true, "approved", "approved", true],
    [true, "approved", "locked", false], [true, "todo", "locked", false], [false, "approved", "todo", false],
  ])("관리형 기획 %s · 브리프 %s · 기획 %s → 링크 %s", async (managed, brief, plan, linked) => {
    if (managed) process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    state.read.mockResolvedValue(detail(brief, plan));
    const links = hrefs(html(await detailPage()));
    expect(links.includes(cloudPlanPath(P))).toBe(linked);
    expect(links[0]).toBe("/cloud/projects");
  });
  it("브리프 확인 전 링크(P1-02)와 기획 링크는 서로 다른 조건", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    state.read.mockResolvedValue(detail("todo", "locked"));
    expect(hrefs(html(await detailPage()))).toEqual(["/cloud/projects", `/cloud/projects/${P}/brief`]);
    state.read.mockResolvedValue(detail("approved", "todo"));
    expect(hrefs(html(await detailPage()))).toEqual(["/cloud/projects", cloudPlanPath(P)]);
  });
  it("조회 장애·없음·로컬은 기존 그대로", async () => {
    process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    state.read.mockResolvedValue({ kind: "unavailable" });
    expect(hrefs(html(await detailPage()))).not.toContain(cloudPlanPath(P));
    state.read.mockResolvedValue({ kind: "local" });
    expect(html(await detailPage())).toContain("이 PC에서는 기존 작업실을 써요");
    state.read.mockResolvedValue({ kind: "notFound" });
    await expect(detailPage()).rejects.toMatchObject({ notFound: true });
  });
});

describe("브리프 화면 → 기획 주소 전달", () => {
  it("관리형 기획 지정일 때만 기획 주소를 넘긴다", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    expect(html(await briefPage())).toContain('data-plan="none"');
    process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    expect(html(await briefPage())).toContain(`data-plan="${cloudPlanPath(P)}"`);
  });
});

describe("P2-MANAGED-WORKSPACE-BRIEF-NEXT-STEP-COPY: 브리프 머리 안내는 기획 경로와 맞춘다", () => {
  const description = (markup: string) => markup.match(/<h1[^>]*>브리프 확인<\/h1>\s*(?:<[^>]+>)*([^<]+)/)?.[1] ?? "";
  it("기획 경로가 있으면 승인 뒤 기획 단계가 열린다고, 없으면 프로젝트 보기로 안내", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    const closed = html(await briefPage());
    expect(closed).toContain('data-plan="none"');
    expect(description(closed)).toBe("등록한 내용을 살펴보고 승인해요. 클라우드 기획 화면은 아직 준비 중이라 승인 뒤에는 프로젝트 보기에서 단계 상태를 확인할 수 있어요.");
    process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    const open = html(await briefPage());
    expect(open).toContain(`data-plan="${cloudPlanPath(P)}"`);
    expect(description(open)).toBe("등록한 내용을 살펴보고 승인하면 기획 단계가 열려요.");
    for (const markup of [closed, open]) {
      expect(hrefs(markup)).toEqual(["/cloud/projects"]);
      expect(markup).not.toMatch(/장면 제작|렌더/);
    }
  });
  it("인증·주소 정책은 그대로: 비로그인은 같은 브리프로 로그인, 형식 오류는 404, 이 PC는 로컬 안내", async () => {
    state.auth = { kind: "denied", status: 401 };
    await expect(briefPage()).rejects.toMatchObject({ to: `/login?next=${encodeURIComponent(`/cloud/projects/${P}/brief`)}` });
    state.auth = { kind: "local" };
    expect(html(await briefPage())).toContain("이 PC에서는 기존 작업실을 써요");
  });
});
