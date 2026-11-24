import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyApprovePlan, classifyPlanRead, classifySave, cloudPlanPath, initialScenes, planApiPath, sameDraft, savedByRead, totalSec, type PlanState,
} from "@/components/cloud/managed-plan-requests";

// P1-08 클라우드 기획 화면(Master msg_daf0eaf6b86c, Backend 4fba696 GET/POST /api/projects/:id/plan).
const state = vi.hoisted(() => ({
  auth: { kind: "verified", userId: "u" } as unknown,
  menus: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
  notFound: vi.fn(() => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: state.notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/render", () => ({ getRenderAuth: async () => state.auth }));
vi.mock("@/lib/menus/server", () => ({ getMenuConfig: state.menus, getMenuConfigState: state.menus }));

const P = "01936b2e-8f3a-7c4d-8e5f-1a2b3c4d5e6f";
const PLAN = "01936b2e-8f3a-7c4d-8e5f-00000000b001";
const scene = (title: string, durationSec: number) => ({ stepId: "hook", title, description: "설명", dialogue: "", durationSec, characterIds: [], assetIds: [] });
const plan = (patch: Partial<PlanState> = {}): PlanState => ({
  revision: 1, version: 1, planId: PLAN, draft: { script: "대본", scenes: [scene("첫 장면", 30)] }, writable: true, canApprove: true, approved: false,
  produceOpen: false, lengthSec: 30, steps: [{ id: "hook", label: "후킹" }], ...patch,
});
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
const settle = async (run: () => Promise<unknown>) => { try { return { value: await run() }; } catch (error) { return { error: error as Error & { to?: string; notFound?: boolean } }; } };
const planPage = async (id: string) => (await import("@/app/(cloud)/cloud/projects/[id]/plan/page")).default({ params: Promise.resolve({ id }) });
let backend: string | undefined;
beforeEach(() => { backend = process.env.DREAM_PROJECT_PLAN_BACKEND; delete process.env.DREAM_PROJECT_PLAN_BACKEND; state.auth = { kind: "verified", userId: "u" }; vi.clearAllMocks(); });
afterEach(() => { if (backend === undefined) delete process.env.DREAM_PROJECT_PLAN_BACKEND; else process.env.DREAM_PROJECT_PLAN_BACKEND = backend; });

describe("기획 읽기 분류", () => {
  it("200은 형식을 검사하고 409는 브리프 먼저, 404·401·403·503·그 밖", () => {
    expect(classifyPlanRead(200, plan())).toEqual({ kind: "ok", plan: plan() });
    expect(classifyPlanRead(200, { ...plan(), draft: null, planId: null, version: 0 }).kind).toBe("ok");
    expect(classifyPlanRead(200, { ...plan(), steps: [] })).toEqual({ kind: "failed" });
    expect(classifyPlanRead(200, { ...plan(), planId: "x" })).toEqual({ kind: "failed" });
    expect([409, 404, 401, 403, 503, 500].map(status => classifyPlanRead(status, {}).kind))
      .toEqual(["brief-first", "missing", "login", "forbidden", "unavailable", "failed"]);
  });
});

describe("초안 저장 분류와 응답 유실 판정", () => {
  it("201은 보낸 버전+1·UUIDv7 planId일 때만 저장, 409는 다시 읽기, 503·형식 오류는 결과 모름", () => {
    expect(classifySave(201, { revision: 1, version: 2, planId: PLAN }, { version: 1 })).toEqual({ kind: "saved", version: 2, planId: PLAN });
    expect(classifySave(201, { revision: 1, version: 3, planId: PLAN }, { version: 1 })).toEqual({ kind: "unknown" });
    expect(classifySave(201, { revision: 1, version: 2 }, { version: 1 })).toEqual({ kind: "unknown" });
    expect(classifySave(409, { code: "PLAN_MATERIALS_REQUIRED" }, { version: 1 })).toEqual({ kind: "conflict" });
    expect(classifySave(400, { error: "장면 확인" }, { version: 1 })).toEqual({ kind: "invalid", message: "장면 확인" });
    expect([413, 404, 401, 403, 503, 500].map(status => classifySave(status, {}, { version: 1 }).kind))
      .toEqual(["too-large", "missing", "login", "forbidden", "unknown", "unknown"]);
  });
  it("다시 읽은 최신이 버전+1이고 같은 내용(앞뒤 공백 무시)이면 저장된 것", () => {
    const draft = { script: "대본", scenes: [scene("첫 장면", 30)] };
    expect(savedByRead(plan({ version: 2, draft: { script: " 대본 ", scenes: [scene("첫 장면 ", 30)] } }), { version: 1, draft })).toBe(true);
    expect(savedByRead(plan({ version: 2, draft: { script: "남의 대본", scenes: [scene("첫 장면", 30)] } }), { version: 1, draft })).toBe(false);
    expect(savedByRead(plan({ version: 1, draft }), { version: 1, draft })).toBe(false);
    expect(sameDraft(draft, { ...draft, scenes: [scene("첫 장면", 31)] })).toBe(false);
  });
});

describe("기획 승인 분류", () => {
  const sent = { planId: PLAN, version: 2 };
  it("200은 approved·같은 planId·version일 때만, 제작 화면 준비 여부를 구분", () => {
    expect(classifyApprovePlan(200, { planId: PLAN, version: 2, approved: true, produceOpen: true, hostedProductionAvailable: false }, sent))
      .toEqual({ kind: "approved", produceOpen: true, hostedProduction: false });
    expect(classifyApprovePlan(200, { planId: PLAN, version: 2, approved: true, produceOpen: true }, sent))
      .toEqual({ kind: "approved", produceOpen: true, hostedProduction: true });
    expect(classifyApprovePlan(200, { planId: PLAN, version: 1, approved: true }, sent)).toEqual({ kind: "unknown" });
  });
  it("409를 바뀜·부가 자료·환경 미연결로 나누고, 503은 결과 모름(같은 요청 재시도)", () => {
    expect(classifyApprovePlan(409, { error: "x" }, sent)).toEqual({ kind: "conflict" });
    expect(classifyApprovePlan(409, { code: "PLAN_MATERIALS_STALE" }, sent)).toEqual({ kind: "materials-stale" });
    expect(classifyApprovePlan(409, { code: "PLAN_APPROVAL_UNAVAILABLE" }, sent)).toEqual({ kind: "not-here" });
    expect(classifyApprovePlan(503, { code: "MANAGED_PLAN_APPROVAL_UNAVAILABLE" }, sent)).toEqual({ kind: "unknown" });
    expect([404, 401, 403].map(status => classifyApprovePlan(status, {}, sent).kind)).toEqual(["missing", "login", "forbidden"]);
  });
});

describe("처음 초안과 길이", () => {
  it("메뉴 단계마다 장면 하나, 합이 목표 길이와 같다", () => {
    const steps = [{ id: "a", label: "후킹" }, { id: "b", label: "문제" }, { id: "c", label: "해결" }];
    const scenes = initialScenes(steps, 31);
    expect(scenes.map(item => [item.stepId, item.title, item.durationSec])).toEqual([["a", "후킹", 11], ["b", "문제", 10], ["c", "해결", 10]]);
    expect(totalSec(scenes)).toBe(31);
    expect(planApiPath(P)).toBe(`/api/projects/${P}/plan`);
    expect(cloudPlanPath(P)).toBe(`/cloud/projects/${P}/plan`);
  });
});

describe("/cloud/projects/:id/plan", () => {
  it("관리형 기획 미지정: 준비 안내만(편집 화면·요청 없음)", async () => {
    const markup = html(await planPage(P));
    expect([...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(["기획"]);
    expect(markup).toContain("아직 클라우드에서는 기획을 편집할 수 없어요");
    expect(markup).not.toMatch(/<textarea|<input|<button/);
  });
  it("관리형 기획 지정: 편집 화면(내용은 화면이 같은 출처로 읽음), 기술 용어 없음", async () => {
    process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    const markup = html(await planPage(P.toUpperCase()));
    expect(markup).toContain("기획을 불러오고 있어요.");
    expect(markup).not.toMatch(/postgres|DREAM_|API|storage/i);
    expect(state.menus).not.toHaveBeenCalled();
  });
  it("비로그인 → 로그인 뒤 같은 기획으로, 403·장애는 오류 안내, 형식 틀린 ID는 404, 이 PC는 로컬 안내", async () => {
    state.auth = { kind: "denied", status: 401 };
    expect((await settle(() => planPage(P.toUpperCase()))).error?.to).toBe(`/login?next=${encodeURIComponent(cloudPlanPath(P))}`);
    expect((await settle(() => planPage("x"))).error?.to).toBe("/login?next=%2Fcloud%2Fprojects");
    state.auth = { kind: "denied", status: 403 };
    expect((await settle(() => planPage(P))).error?.to).toBe("/login?error=forbidden");
    state.auth = { kind: "denied", status: 503 };
    expect((await settle(() => planPage(P))).error?.to).toBe("/login?error=unavailable");
    state.auth = { kind: "verified", userId: "u" };
    expect((await settle(() => planPage("00000000-0000-4000-8000-000000000001"))).error?.notFound).toBe(true);
    state.auth = { kind: "local" };
    expect(html(await planPage(P))).toContain("이 PC에서는 기존 작업실을 써요");
  });
});

describe("정적 경계", () => {
  it("화면 파일은 DB·서비스·관리형 서버 모듈을 가져오지 않고, 사용자 데이터를 기록·저장하지 않는다", () => {
    for (const file of ["app/(cloud)/cloud/projects/[id]/plan/page.tsx", "components/cloud/managed-plan-editor.tsx", "components/cloud/managed-plan-requests.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from "(?:@\/lib\/db|@\/lib\/services|@\/lib\/menus\/server|@\/lib\/cloud\/|pg|better-sqlite3)/);
      expect(source, file).not.toMatch(/console\.|localStorage|sessionStorage/);
    }
  });
  it("요청은 같은 출처·no-store, 승인은 명시 확인 값을 보낸다", () => {
    const source = readFileSync("components/cloud/managed-plan-editor.tsx", "utf8");
    expect(source.match(/credentials: "same-origin", cache: "no-store"/g)).toHaveLength(2);
    expect(source).toMatch(/action: "approve-plan", acknowledged: true, revision: plan\.revision, version: plan\.version, planId: plan\.planId/);
    expect(source).not.toMatch(/fetch\("https?:/);
  });
});
