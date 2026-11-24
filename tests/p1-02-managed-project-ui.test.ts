import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeManagedMenus, assetChoicesPath, classifyApprove, classifyBriefRead, classifyChoices, classifyCreate, cloudBriefPath, createBody, keyMessageCheck, lengthChoices,
  managedMenuName, mergeChoices, nextAttempt,
} from "@/components/cloud/managed-project-requests";
import { BriefSummary } from "@/components/cloud/managed-brief-panel";

// P1-02 관리형 프로젝트 생성·브리프 화면(Master msg_ff678d34d472, Backend e91a89c·681e757 계약, Tester UI-PREFLIGHT).
const state = vi.hoisted(() => ({
  auth: { kind: "verified", userId: "u", email: "a@example.invalid" } as unknown,
  read: vi.fn(),
  list: vi.fn(),
  menus: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
  notFound: vi.fn(() => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: state.notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/render", () => ({ getRenderAuth: async () => state.auth }));
vi.mock("@/lib/menus/server", () => ({ getMenuConfig: state.menus, getMenuConfigState: state.menus }));
vi.mock("@/lib/cloud/project-read-page", async (original) => ({ ...await original<object>(), readCloudProject: state.read, readCloudProjects: state.list }));

const V7 = "01936b2e-8f3a-7c4d-8e5f-1a2b3c4d5e6f";
const V7B = "01936b2e-8f3a-7c4d-8e5f-1a2b3c4d5e70";
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
const settle = async (run: () => Promise<unknown>) => { try { return { value: await run() }; } catch (error) { return { error: error as Error & { to?: string; notFound?: boolean } }; } };
const newPage = async () => (await import("@/app/(cloud)/cloud/projects/new/page")).default({ searchParams: Promise.resolve({}) });
const briefPage = async (id: string) => (await import("@/app/(cloud)/cloud/projects/[id]/brief/page")).default({ params: Promise.resolve({ id }) });
const detailPage = async (id: string) => (await import("@/app/(cloud)/cloud/projects/[id]/page")).default({ params: Promise.resolve({ id }) });
const listPage = async () => (await import("@/app/(cloud)/cloud/projects/(list)/page")).default();
let backend: string | undefined;
let planBackend: string | undefined;
beforeEach(() => { planBackend = process.env.DREAM_PROJECT_PLAN_BACKEND; delete process.env.DREAM_PROJECT_PLAN_BACKEND; })
afterEach(() => { if (planBackend === undefined) delete process.env.DREAM_PROJECT_PLAN_BACKEND; else process.env.DREAM_PROJECT_PLAN_BACKEND = planBackend; });
beforeEach(() => { backend = process.env.DREAM_PROJECT_CORE_BACKEND; delete process.env.DREAM_PROJECT_CORE_BACKEND; state.auth = { kind: "verified", userId: "u", email: "a@example.invalid" }; vi.clearAllMocks(); });
afterEach(() => { if (backend === undefined) delete process.env.DREAM_PROJECT_CORE_BACKEND; else process.env.DREAM_PROJECT_CORE_BACKEND = backend; });

describe("요청 키: 결과를 모르는 같은 내용만 같은 키로 다시 보낸다", () => {
  it("같은 본문은 같은 키, 바뀐 본문·결과가 정해진 뒤에는 새 키", () => {
    let n = 0; const key = () => `k${++n}`;
    const first = nextAttempt(undefined, "a", key);
    expect(first).toEqual({ key: "k1", body: "a" });
    expect(nextAttempt(first, "a", key)).toBe(first);
    expect(nextAttempt(first, "b", key)).toEqual({ key: "k2", body: "b" });
    expect(nextAttempt(undefined, "a", key)).toEqual({ key: "k3", body: "a" });
  });
  it("입력 필드 순서가 달라도 같은 본문", () => {
    expect(createBody("shopping-shorts", { b: 1, a: [V7] })).toBe(createBody("shopping-shorts", { a: [V7], b: 1 }));
    expect(JSON.parse(createBody("shopping-shorts", { b: 1 }))).toEqual({ menuId: "shopping-shorts", inputs: { b: 1 } });
  });
});

describe("생성 응답 분류: 201 UUIDv7만 저장 완료", () => {
  it.each([
    [201, { id: V7.toUpperCase() }, { kind: "created", id: V7 }],
    [201, { id: "00000000-0000-4000-8000-000000000001" }, { kind: "unknown" }],
    [201, null, { kind: "unknown" }],
    [400, { code: "INVALID_INPUT", errors: { productAssets: "자료를 확인해 주세요." } }, { kind: "invalid", errors: { productAssets: "자료를 확인해 주세요." } }],
    [400, null, { kind: "invalid", errors: { _form: "입력 항목을 확인해 주세요." } }],
    [401, {}, { kind: "login" }], [403, {}, { kind: "forbidden" }],
    [409, { code: "IDEMPOTENCY_CONFLICT" }, { kind: "key-conflict" }],
    [409, { code: "STAGE_LOCKED" }, { kind: "locked" }],
    [503, { code: "PROJECT_CORE_UNAVAILABLE" }, { kind: "unknown" }],
    [500, {}, { kind: "unknown" }], [404, {}, { kind: "unknown" }],
  ])("%i %j", (status, body, expected) => expect(classifyCreate(status, body)).toEqual(expected));
  it("413은 입력 오류로 말한다", () => expect(classifyCreate(413, {})).toMatchObject({ kind: "invalid" }));
});

describe("브리프 읽기·승인 분류", () => {
  const brief = { title: "t", goal: "g", target: "x", aspect: "9:16", lengthSec: 30, revision: 3, facts: "f", product: "p", rights: "r", sources: null,
    stages: { intake: "approved", brief: "todo", plan: "locked" } };
  it("200은 형식을 검사하고, 404·401·403·503·그 밖을 나눈다", () => {
    expect(classifyBriefRead(200, brief)).toEqual({ kind: "ok", brief });
    expect(classifyBriefRead(200, { ...brief, revision: 0 })).toEqual({ kind: "failed" });
    expect(classifyBriefRead(200, { ...brief, stages: { ...brief.stages, plan: "mystery" } })).toEqual({ kind: "failed" });
    expect([404, 401, 403, 503, 500].map(status => classifyBriefRead(status, {}).kind)).toEqual(["missing", "login", "forbidden", "unavailable", "failed"]);
  });
  it("승인 200은 stage=plan·같은 revision일 때만, 409 BRIEF_CONFLICT는 다시 읽기, 503은 결과 모름", () => {
    expect(classifyApprove(200, { stage: "plan", revision: 3 }, 3)).toEqual({ kind: "approved", revision: 3 });
    expect(classifyApprove(200, { stage: "plan", revision: 4 }, 3)).toEqual({ kind: "unknown" });
    expect(classifyApprove(409, { code: "BRIEF_CONFLICT" }, 3)).toEqual({ kind: "stale" });
    expect(classifyApprove(409, { code: "IDEMPOTENCY_CONFLICT" }, 3)).toEqual({ kind: "key-conflict" });
    expect(classifyApprove(503, {}, 3)).toEqual({ kind: "unknown" });
    expect(classifyApprove(400, { errors: { _form: "확인" } }, 3)).toEqual({ kind: "invalid", message: "확인" });
    expect([404, 401, 403].map(status => classifyApprove(status, {}, 3).kind)).toEqual(["missing", "login", "forbidden"]);
  });
});

describe("확인된 자료 목록(681e757 GET /api/projects/asset-choices)", () => {
  it("200 형식·커서, 404·503은 연결 전, 400·형식 오류는 실패", () => {
    const item = { id: V7, title: "제품 사진", kind: "image" as const };
    expect(classifyChoices(200, { assets: [item], nextCursor: V7B })).toEqual({ kind: "ok", assets: [item], nextCursor: V7B });
    expect(classifyChoices(200, { assets: [] })).toEqual({ kind: "ok", assets: [] });
    expect(classifyChoices(200, { assets: [{ ...item, kind: "audio" }] })).toEqual({ kind: "failed" });
    expect(classifyChoices(200, { assets: Array.from({ length: 101 }, () => item) })).toEqual({ kind: "failed" });
    expect([404, 503, 401, 403, 400, 500].map(status => classifyChoices(status, {}).kind)).toEqual(["unlinked", "unlinked", "login", "forbidden", "failed", "failed"]);
    expect(assetChoicesPath()).toBe("/api/projects/asset-choices");
    expect(assetChoicesPath(V7)).toBe(`/api/projects/asset-choices?cursor=${V7}`);
    expect(mergeChoices([item], [item, { ...item, id: V7B }]).map(entry => entry.id)).toEqual([V7, V7B]);
    expect(cloudBriefPath(V7)).toBe(`/cloud/projects/${V7}/brief`);
  });
});

describe("/cloud/projects/new: 관리형 생성 경로일 때만 폼", () => {
  it("관리형 미지정이면 기존 준비 안내(폼·입력 없음)", async () => {
    const markup = html(await newPage());
    expect(markup).toContain("아직 클라우드에서는 새 프로젝트를 만들 수 없어요");
    expect(markup).not.toMatch(/<form|<input|<select/);
  });
  it("관리형 지정: 쇼핑숏츠 폼, 자료 목록을 읽기 전에는 제출·자료 선택 잠김, 캐릭터 입력 없음, 파일 읽는 메뉴 설정 미사용", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    const markup = html(await newPage());
    expect([...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(["새 프로젝트"]);
    expect(markup).toMatch(/<form[^>]*novalidate/i);
    expect(markup).toContain("확인된 내 자료 목록을 불러오고 있어요.");
    const assets = markup.match(/<select id="input-productAssets"[^>]*>/)?.[0] ?? "";
    expect(assets).toMatch(/\bmultiple\b/);
    expect(assets).toMatch(/\bdisabled\b/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    for (const id of ["title", "goal", "target", "aspect", "lengthSec", "productName", "facts", "usageRights"]) expect(markup).toContain(`id="input-${id}"`);
    expect(markup).not.toContain('id="input-characters"');
    expect(markup).not.toContain("아직 클라우드에서는 새 프로젝트를 만들 수 없어요");
    expect(markup).not.toMatch(/postgres|DREAM_|API|storage/i);
    expect(state.menus).not.toHaveBeenCalled();
  });
  it("비로그인은 로그인 뒤 같은 주소로, 이 PC는 로컬 안내", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    state.auth = { kind: "denied", status: 401 };
    expect((await settle(newPage)).error?.to).toBe("/login?next=%2Fcloud%2Fprojects%2Fnew");
    state.auth = { kind: "local" };
    expect(html(await newPage())).toContain("이 PC에서는 기존 작업실을 써요");
  });
});

describe("/cloud/projects/:id/brief", () => {
  it("로그인 사용자: 제목과 브리프 화면(내용은 화면이 같은 출처로 읽음)", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    const markup = html(await briefPage(V7.toUpperCase()));
    expect([...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(["브리프 확인"]);
    expect(markup).toContain("브리프를 불러오고 있어요.");
  });
  it("비로그인 → 로그인 뒤 같은 브리프로, 403·장애는 오류 안내, 형식 틀린 ID는 404, 이 PC는 로컬 안내", async () => {
    state.auth = { kind: "denied", status: 401 };
    expect((await settle(() => briefPage(V7.toUpperCase()))).error?.to).toBe(`/login?next=${encodeURIComponent(cloudBriefPath(V7))}`);
    expect((await settle(() => briefPage("x"))).error?.to).toBe("/login?next=%2Fcloud%2Fprojects");
    state.auth = { kind: "denied", status: 403 };
    expect((await settle(() => briefPage(V7))).error?.to).toBe("/login?error=forbidden");
    state.auth = { kind: "denied", status: 503 };
    expect((await settle(() => briefPage(V7))).error?.to).toBe("/login?error=unavailable");
    state.auth = { kind: "verified", userId: "u" };
    expect((await settle(() => briefPage("00000000-0000-4000-8000-000000000001"))).error?.notFound).toBe(true);
    state.auth = { kind: "local" };
    expect(html(await briefPage(V7))).toContain("이 PC에서는 기존 작업실을 써요");
  });
});

describe("P2-MANAGED-BRIEF-CORE-CAPABILITY: 브리프 직접 주소는 관리형 설정이 있을 때만 패널을 연다", () => {
  const READY = "아직 클라우드에서는 브리프를 확인할 수 없어요";
  // P2-MANAGED-BRIEF-UNAVAILABLE-HEADER: 머리말(h1 바로 뒤 설명)도 실제 준비 상태와 같아야 한다.
  const UNAVAILABLE = "클라우드 브리프 확인은 아직 준비 중이에요. 진행 상태는 프로젝트 보기에서 확인할 수 있어요.";
  const header = (markup: string) => markup.match(/<h1[^>]*>브리프 확인<\/h1>\s*(?:<[^>]+>)*([^<]+)/)?.[1] ?? "";
  it.each([
    ["설정 없음 · 기획 없음", false, false],
    ["설정 없음 · 기획 있음", false, true],
  ] as const)("%s: 패널·요청 없이 준비 안내와 프로젝트 보기", async (_name, _core, plan) => {
    if (plan) process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    const markup = html(await briefPage(V7.toUpperCase()));
    expect([...markup.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(["브리프 확인"]);
    expect(markup).toContain(READY);
    // 머리말은 준비 상태만 말하고, 기획 설정이 있어도 승인·기획 단계를 약속하지 않는다.
    expect(header(markup)).toBe(UNAVAILABLE);
    expect(header(markup)).not.toMatch(/승인|기획/);
    expect(markup).toContain(`href="/cloud/projects/${V7}"`);
    expect(markup).toContain('href="/cloud/projects"');
    // 패널(같은 출처 읽기·승인)이 없으니 불러오기·오류·승인 단추·기획 링크도 없다.
    expect(markup).not.toContain("브리프를 불러오고 있어요.");
    expect(markup).not.toContain("프로젝트 저장소에 연결할 수 없어요");
    expect(markup).not.toContain("다시 불러오기");
    expect(markup).not.toContain(`/cloud/projects/${V7}/plan`);
    expect(markup).not.toMatch(/<form|<button/);
  });
  it.each([
    ["설정 있음 · 기획 없음", false, "클라우드 기획 화면은 아직 준비 중이라"],
    ["설정 있음 · 기획 있음", true, "승인하면 기획 단계가 열려요"],
  ] as const)("%s: 기존 패널과 기획별 머리말 그대로", async (_name, plan, description) => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    if (plan) process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    const markup = html(await briefPage(V7));
    expect(markup).toContain("브리프를 불러오고 있어요.");
    expect(header(markup)).toContain(description);
    expect(header(markup)).not.toBe(UNAVAILABLE);
    expect(markup).not.toContain(READY);
  });
  it("설정 있음에서도 비로그인 복귀·권한 거절·형식 오류 404·이 PC 안내는 그대로", async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    state.auth = { kind: "denied", status: 401 };
    expect((await settle(() => briefPage(V7.toUpperCase()))).error?.to).toBe(`/login?next=${encodeURIComponent(cloudBriefPath(V7))}`);
    state.auth = { kind: "denied", status: 403 };
    expect((await settle(() => briefPage(V7))).error?.to).toBe("/login?error=forbidden");
    state.auth = { kind: "verified", userId: "u" };
    expect((await settle(() => briefPage("00000000-0000-4000-8000-000000000001"))).error?.notFound).toBe(true);
    state.auth = { kind: "local" };
    expect(html(await briefPage(V7))).toContain("이 PC에서는 기존 작업실을 써요");
  });
  it("정적: 화면은 설정만 보고 고르며 패널 조건 밖에서 요청 코드를 부르지 않는다", () => {
    const source = readFileSync("app/(cloud)/cloud/projects/[id]/brief/page.tsx", "utf8");
    expect(source).toMatch(/const coreReady = process\.env\.DREAM_PROJECT_CORE_BACKEND !== undefined;/);
    expect(source).toMatch(/const description = !coreReady \? "클라우드 브리프 확인은 아직 준비 중이에요\./);
    expect(source).toMatch(/\{!coreReady\s*\?\s*<Callout/);
    expect(source).toMatch(/:\s*<ManagedBriefPanel projectId=\{projectId\} planHref=\{planHref\} \/>\}/);
    expect(source).not.toMatch(/fetch\(/);
  });
});

describe("상세 화면 브리프 링크: 관리형이고 브리프가 확인 전일 때만", () => {
  const project = (brief: string) => ({ kind: "ok", data: { id: V7, title: "제목", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-22T00:00:00.000Z",
    stages: [{ stage: "intake", label: "등록", status: "approved" }, { stage: "brief", label: "브리프", status: brief }] } });
  it.each([
    [true, "todo", true], [true, "approved", false], [false, "todo", false],
  ])("관리형 %s · 브리프 %s → 링크 %s", async (managed, brief, linked) => {
    if (managed) process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    state.read.mockResolvedValue(project(brief));
    const hrefs = [...html(await detailPage(V7)).matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(hrefs.includes(cloudBriefPath(V7))).toBe(linked);
  });
});

describe("정적 경계", () => {
  it("화면 파일은 DB·legacy 서비스·파일 읽는 메뉴 설정을 가져오지 않고, 사용자 데이터를 기록하지 않는다", () => {
    for (const file of ["app/(cloud)/cloud/projects/new/page.tsx", "app/(cloud)/cloud/projects/[id]/brief/page.tsx", "app/(cloud)/cloud/projects/[id]/page.tsx",
      "components/cloud/managed-project-form.tsx", "components/cloud/managed-brief-panel.tsx", "components/cloud/managed-project-requests.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from "(?:@\/lib\/db|@\/lib\/services|@\/lib\/menus\/server|@\/lib\/cloud\/managed-project-core|pg|better-sqlite3)/);
      expect(source, file).not.toMatch(/console\.|localStorage|sessionStorage/);
    }
  });
  it("요청은 같은 출처·no-store·UUIDv7 요청 키 헤더로만 보낸다", () => {
    for (const file of ["components/cloud/managed-project-form.tsx", "components/cloud/managed-brief-panel.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/"idempotency-key": attempt\.key/);
      expect(source).toMatch(/import \{ v7 \} from "uuid"/);
      expect(source).not.toMatch(/fetch\("https?:/);
    }
  });
});

describe("P2-MANAGED-WORKSPACE-CAPABILITY-COPY: 목록·상세 안내는 실제로 열리는 화면과 같다", () => {
  const card = { id: V7, title: "합성 카드", menuLabel: "쇼핑숏츠·제품 광고", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-24T00:00:00.000Z", status: "queued", nextStageLabel: "장면 제작" };
  const approved = { kind: "ok", data: { id: V7, title: "제목", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-22T00:00:00.000Z",
    stages: [["intake", "등록", "approved"], ["brief", "요구 확인", "approved"], ["plan", "기획", "approved"], ["produce", "장면 제작", "todo"], ["edit", "수정·조립", "locked"],
      ["review", "검수", "locked"], ["export", "내보내기", "locked"]].map(([stage, label, status]) => ({ stage, label, status })) } };
  const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
  const links = (markup: string) => [...markup.matchAll(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(match => [match[1], text(match[2])]);
  const set = (core: boolean, plan: boolean) => {
    if (core) process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres"; else delete process.env.DREAM_PROJECT_CORE_BACKEND;
    if (plan) process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres"; else delete process.env.DREAM_PROJECT_PLAN_BACKEND;
  };
  const listNote = {
    off: "클라우드에서는 지금 보기만 할 수 있어요. 만들기·수정은 아직 내 PC 작업실에서 해 주세요.",
    core: "클라우드에서 새 쇼핑숏츠 프로젝트를 만들고 브리프 확인까지 할 수 있어요. 기획·장면 제작·렌더는 아직 내 PC 작업실에서 해 주세요.",
    both: "클라우드에서 새 쇼핑숏츠 프로젝트를 만들고 브리프 확인과 기획 초안 작성까지 할 수 있어요. 기획 승인 가능 여부는 기획 화면에서 확인해 주세요. 장면 제작·렌더는 아직 내 PC 작업실에서 해 주세요.",
    plan: "클라우드에서는 브리프가 승인된 프로젝트의 기획 초안을 확인·작성할 수 있어요. 기획 승인 가능 여부는 기획 화면에서 확인해 주세요. 만들기와 장면 제작·렌더는 아직 내 PC 작업실에서 해 주세요.",
  };
  it.each([
    ["비활성(관리형 미지정)", false, false, listNote.off, "새 프로젝트 만들기 안내 →"],
    ["생성만 활성", true, false, listNote.core, "새 프로젝트 만들기 →"],
    ["생성·기획 활성", true, true, listNote.both, "새 프로젝트 만들기 →"],
    ["기획만 활성", false, true, listNote.plan, "새 프로젝트 만들기 안내 →"],
  ])("목록 %s: 머리 안내와 같은 주소의 링크 이름", async (_name, core, plan, note, linkName) => {
    set(core, plan); state.list.mockResolvedValue({ kind: "ok", data: [card] });
    const markup = html(await listPage());
    expect(text(markup)).toContain(note);
    expect(links(markup)).toEqual([["/cloud/projects/new", linkName], [`/cloud/projects/${V7}`, "합성 카드"], ["/cloud/manage", "개인 관리 보기 →"]]);
    // 장면 제작·렌더를 클라우드에서 할 수 있다고 말하지 않고, 연결 성공·DB 같은 말도 없다.
    expect(text(markup)).not.toMatch(/장면 제작·렌더(?:를|까지)? (?:할 수|만들 수)|연결됐|연결되어|연결 성공|postgres|DREAM_/i);
    // 배정 2: 기획 승인은 승인 구성·권한·저장 초안 조건을 따르므로 목록에서 약속하지 않는다.
    expect(text(markup)).not.toMatch(/기획 승인까지|승인할 수 있어요|작성하고 승인/);
    // 같은 화면 열림 조건: 새 프로젝트 화면이 폼을 여는지와 링크 이름이 맞는다.
    expect(html(await newPage()).includes("<form")).toBe(core);
  });
  it("빈 목록: 생성이 열리면 만들기로 시작하라는 안내, 아니면 예전 옮기기 안내", async () => {
    state.list.mockResolvedValue({ kind: "ok", data: [] });
    set(true, true);
    const open = text(html(await listPage()));
    expect(open).toContain("아직 클라우드 프로젝트가 없어요");
    expect(open).toContain("‘새 프로젝트 만들기’로 쇼핑숏츠 프로젝트를 시작할 수 있어요.");
    set(false, false);
    const closed = text(html(await listPage()));
    expect(closed).toContain("아직 클라우드에 옮긴 프로젝트가 없어요");
    expect(closed).toContain("보기만");
  });
  it.each([
    ["비활성", false, false, "클라우드에서는 지금 보기만 할 수 있어요. 만들기·수정은 아직 내 PC 작업실에서 해 주세요.", false],
    ["생성만", true, false, "클라우드에서는 브리프 확인까지 할 수 있어요. 기획·장면 제작·렌더는 아직 내 PC 작업실에서 해 주세요.", false],
    ["생성·기획", true, true, "클라우드에서는 브리프 확인과 기획 초안 작성까지 할 수 있어요. 기획 승인 가능 여부는 기획 화면에서 확인해 주세요. 장면 제작·렌더는 아직 내 PC 작업실에서 해 주세요.", true],
    ["기획만", false, true, "클라우드에서는 브리프가 승인된 프로젝트의 기획 초안을 확인·작성할 수 있어요. 기획 승인 가능 여부는 기획 화면에서 확인해 주세요. 만들기와 장면 제작·렌더는 아직 내 PC 작업실에서 해 주세요.", true],
  ])("상세 %s: 머리 안내, 기획 링크는 기존 조건 그대로", async (_name, core, plan, note, planLink) => {
    set(core, plan); state.read.mockResolvedValue(approved);
    const markup = html(await detailPage(V7));
    expect(text(markup)).toContain(note);
    expect(links(markup).map(([href]) => href)).toEqual(["/cloud/projects", ...(planLink ? [`/cloud/projects/${V7}/plan`] : [])]);
    expect(text(markup)).toMatch(/장면 제작\s*할 일/);
    expect(text(markup)).not.toMatch(/연결됐|연결 성공|postgres|DREAM_/i);
    expect(text(markup)).not.toMatch(/기획 승인까지|승인할 수 있어요|작성하고 승인/);
  });
  it("장애: 관리형 설정이어도 불러오기 실패 중에는 '할 수 있어요'를 말하지 않고, 실패 안내·다시 시도는 그대로", async () => {
    set(true, true);
    state.list.mockResolvedValue({ kind: "unavailable" }); state.read.mockResolvedValue({ kind: "unavailable" });
    for (const markup of [html(await listPage()), html(await detailPage(V7))]) {
      expect(text(markup)).toContain("프로젝트를 불러오지 못했어요");
      expect(links(markup).some(([href, name]) => href === "/cloud/projects" && name === "다시 시도")).toBe(true);
      expect(text(markup)).not.toMatch(/할 수 있어요|보기만/);
    }
    set(false, false);
    expect(text(html(await listPage()))).toContain("보기만");
  });
  it("정적: 상태 판단은 환경값과 묶인 메뉴 설정만 읽고 DB·네트워크·파일 읽는 메뉴 설정을 쓰지 않는다", () => {
    for (const file of ["components/cloud/project-list-readonly.tsx", "components/cloud/project-detail-readonly.tsx", "app/(cloud)/cloud/projects/(list)/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from "(?:@\/lib\/db|@\/lib\/services|@\/lib\/menus\/server|@\/lib\/cloud\/managed-project-(?:core|plan)|pg|better-sqlite3)/);
      expect(source, file).not.toMatch(/fetch\(/);
    }
    expect(state.menus).not.toHaveBeenCalled();
  });
});

describe("P2-MANAGED-WORKSPACE-BRIEF-NEXT-STEP-COPY: 브리프 승인 뒤 다음 할 일", () => {
  const OPEN = "기획 단계가 열렸어요. ‘기획하러 가기’에서 이어 갈 수 있어요.";
  const NO_PLAN = "클라우드 기획 화면은 아직 준비 중이라 프로젝트 보기에서 단계 상태를 확인할 수 있어요.";
  const LOCKED = "기획 단계는 아직 열리지 않았어요. 프로젝트 보기에서 단계 상태를 확인해 주세요.";
  it.each([
    ["기획 경로 있음 · 기획 열림", "/cloud/projects/x/plan", "todo", true, OPEN],
    ["기획 경로 있음 · 기획 진행 중", "/cloud/projects/x/plan", "in_progress", true, OPEN],
    ["기획 경로 있음 · 기획 잠김", "/cloud/projects/x/plan", "locked", false, LOCKED],
    ["기획 경로 없음 · 기획 열림", undefined, "todo", false, NO_PLAN],
    ["기획 경로 없음 · 기획 잠김", undefined, "locked", false, LOCKED],
  ] as const)("%s", async (_name, planHref, plan, planLink, body) => {
    const { briefNextStep } = await import("@/components/cloud/managed-brief-panel");
    expect(briefNextStep(planHref, plan)).toEqual({ planLink, body });
    // 링크가 없는 안내는 '기획하러 가기'를 말하지 않고, 렌더·장면 제작을 약속하지 않는다.
    if (!planLink) expect(body).not.toContain("기획하러 가기");
    // 배정 2: 기획 링크가 없으면 클라우드에서 이어 갈 수 있다는 인상을 주는 '기획 단계가 열렸어요'를 말하지 않는다.
    if (!planLink) expect(body).not.toContain("기획 단계가 열렸어요");
    expect(body).not.toMatch(/장면 제작|렌더|승인할 수 있어요/);
  });
  it("정적: 성공 안내는 다시 읽은 최신 단계로 고르고, 링크·승인 요청·멱등·409 처리는 그대로", () => {
    const source = readFileSync("components/cloud/managed-brief-panel.tsx", "utf8");
    expect(source).toMatch(/latest\.brief\.stages\.brief === "approved"\s*\?\s*\{ tone: "info", title: "브리프를 승인했어요", body: briefNextStep\(planHref, latest\.brief\.stages\.plan\)\.body \}/);
    expect(source).not.toContain('body: "기획 단계가 열렸어요." }');
    expect(source).toMatch(/next\.planLink && planHref && <Link className="action-link" href=\{planHref\}>기획하러 가기<\/Link>/);
    expect(source).toMatch(/"idempotency-key": attempt\.key/);
    expect(source).toContain('title: "프로젝트가 바뀌었어요"');
    expect(source).toContain('title: "승인됐는지 확인하지 못했어요"');
    expect(source.match(/fetch\(/g)).toHaveLength(2);
  });
});

describe("P2-MANAGED-UI-SCENE-CAPABILITY-COPY: 목록·상세 장면 안내는 장면 결과 화면이 실제로 여는 동작만 말한다", () => {
  // 장면 결과 화면이 패널·단추를 여는 조건(scenes/page.tsx)과 안내 판단(cloudWorkspaceCapability)이 읽는 환경값 다섯 개.
  const FLAGS = ["DREAM_SCENE_READ_BACKEND", "DREAM_SCENE_RESULT_BACKEND", "DREAM_PROJECT_CORE_BACKEND", "DREAM_SCENE_SELECT_BACKEND", "DREAM_PROJECT_PLAN_BACKEND"] as const;
  const saved: Partial<Record<(typeof FLAGS)[number], string>> = {};
  beforeEach(() => { for (const flag of FLAGS) { saved[flag] = process.env[flag]; delete process.env[flag]; } });
  afterEach(() => { for (const flag of FLAGS) if (saved[flag] === undefined) delete process.env[flag]; else process.env[flag] = saved[flag]; });
  const card = { id: V7, title: "합성 카드", menuLabel: "쇼핑숏츠·제품 광고", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-24T00:00:00.000Z", status: "queued", nextStageLabel: "장면 제작" };
  const approved = { kind: "ok", data: { id: V7, title: "제목", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-22T00:00:00.000Z",
    stages: [["intake", "등록", "approved"], ["brief", "요구 확인", "approved"], ["plan", "기획", "approved"], ["produce", "장면 제작", "todo"], ["edit", "수정·조립", "locked"],
      ["review", "검수", "locked"], ["export", "내보내기", "locked"]].map(([stage, label, status]) => ({ stage, label, status })) } };
  const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
  const scenesPage = async () => (await import("@/app/(cloud)/cloud/projects/[id]/scenes/page")).default({ params: Promise.resolve({ id: V7 }) });
  type Found = { type: unknown; props: { register?: boolean; select?: boolean; children?: unknown } };
  const find = (node: unknown, type: unknown): Found | undefined => {
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child, type); if (hit) return hit; } return undefined; }
    if (!isValidElement(node)) return undefined;
    const element = node as unknown as Found;
    return element.type === type ? element : find(element.props.children, type);
  };
  // 안내가 약속하는 동작. 등록·선택 판정은 그 동작을 '할 수 있다'고 말하는 구절만 본다('가능 여부는 장면 화면에서 확인' 문장은 약속이 아님).
  const promised = (note: string) => ({
    read: note.includes("장면 결과 화면에서"),
    register: /결과로 등록(?:하거나|할 수 있어요)/.test(note),
    select: note.includes("쓸 결과를 고를 수 있어요"),
  });
  const combos = Array.from({ length: 2 ** FLAGS.length }, (_unused, bits) => FLAGS.filter((_flag, pos) => bits & (1 << pos)));
  it.each(combos.map(on => [on.map(flag => flag.replace(/^DREAM_|_BACKEND$/g, "")).join("+") || "모두 꺼짐", on] as const))(
    "%s: 목록·상세 안내가 장면 화면의 열림·등록·선택과 같고, 새로 만들기·편집·렌더를 약속하지 않는다", async (_name, on) => {
      for (const flag of on) process.env[flag] = "supabase-postgres";
      const { ManagedScenePanel } = await import("@/components/cloud/managed-scene-panel");
      const panel = find(await scenesPage(), ManagedScenePanel);
      const actual = { read: !!panel, register: !!panel?.props.register, select: !!panel?.props.select };
      state.list.mockResolvedValue({ kind: "ok", data: [card] }); state.read.mockResolvedValue(approved);
      const notes = { list: text(html(await listPage())), detail: text(html(await detailPage(V7))) };
      for (const [place, note] of Object.entries(notes)) {
        expect(promised(note), place).toEqual(actual);
        // 장면 화면이 열려 있으면 남은 일을 '장면 새로 만들기·편집·렌더'로 좁히고, 아니면 예전 '장면 제작·렌더' 그대로다.
        if (actual.read) expect(note, place).toContain("장면 새로 만들기·편집·렌더는 아직 내 PC 작업실에서 해 주세요.");
        else expect(note, place).not.toContain("장면 결과");
        // 기획 승인·확인된 자료·쓰기 가능 상태 같은 추가 조건을 지운 약속을 하지 않는다.
        if (actual.read) expect(note, place).toContain("기획이 승인된 프로젝트는 장면 결과 화면에서");
        if (actual.register) expect(note, place).toContain("확인된 내 자료를 결과로 등록");
        if (actual.register || actual.select) expect(note, place).toMatch(/(?:등록·선택|등록|선택) 가능 여부는 장면 화면에서 확인해 주세요\./);
        expect(note, place).not.toMatch(/(?:새로 만들|만들기|편집|렌더)[^.]*(?:할 수 있어요|만들 수 있어요)|연결됐|연결되어|연결 성공|postgres|DREAM_/i);
      }
      // 조회 꺼짐이면 장면 안내가 없고, 관리형 화면이 하나도 열리지 않으면 예전 '보기만' 안내 그대로다.
      const anyManaged = actual.read || process.env.DREAM_PROJECT_CORE_BACKEND !== undefined || process.env.DREAM_PROJECT_PLAN_BACKEND !== undefined;
      expect(notes.list.includes("클라우드에서는 지금 보기만 할 수 있어요.")).toBe(!anyManaged);
    });
  it.each([
    ["조회만", ["DREAM_SCENE_READ_BACKEND"],
      "클라우드에서 기획이 승인된 프로젝트는 장면 결과 화면에서 이미 있는 결과를 볼 수 있어요. 만들기·기획과 장면 새로 만들기·편집·렌더는 아직 내 PC 작업실에서 해 주세요."],
    ["선택만", ["DREAM_SCENE_READ_BACKEND", "DREAM_SCENE_SELECT_BACKEND"],
      "클라우드에서 기획이 승인된 프로젝트는 장면 결과 화면에서 결과를 보고 쓸 결과를 고를 수 있어요. 선택 가능 여부는 장면 화면에서 확인해 주세요. 만들기·기획과 장면 새로 만들기·편집·렌더는 아직 내 PC 작업실에서 해 주세요."],
    ["기획·등록만", ["DREAM_SCENE_READ_BACKEND", "DREAM_SCENE_RESULT_BACKEND", "DREAM_PROJECT_CORE_BACKEND", "DREAM_PROJECT_PLAN_BACKEND"],
      "클라우드에서 새 쇼핑숏츠 프로젝트를 만들고 브리프 확인과 기획 초안 작성까지 할 수 있어요. 기획 승인 가능 여부는 기획 화면에서 확인해 주세요. 기획이 승인된 프로젝트는 장면 결과 화면에서 결과를 보고, 확인된 내 자료를 결과로 등록할 수 있어요. 등록 가능 여부는 장면 화면에서 확인해 주세요. 장면 새로 만들기·편집·렌더는 아직 내 PC 작업실에서 해 주세요."],
    ["모두", [...FLAGS],
      "클라우드에서 새 쇼핑숏츠 프로젝트를 만들고 브리프 확인과 기획 초안 작성까지 할 수 있어요. 기획 승인 가능 여부는 기획 화면에서 확인해 주세요. 기획이 승인된 프로젝트는 장면 결과 화면에서 결과를 보고, 확인된 내 자료를 결과로 등록하거나 쓸 결과를 고를 수 있어요. 등록·선택 가능 여부는 장면 화면에서 확인해 주세요. 장면 새로 만들기·편집·렌더는 아직 내 PC 작업실에서 해 주세요."],
  ] as const)("목록 문장 %s", async (_name, on, sentence) => {
    for (const flag of on) process.env[flag] = "supabase-postgres";
    state.list.mockResolvedValue({ kind: "ok", data: [card] });
    expect(text(html(await listPage()))).toContain(sentence);
  });
  it("장애 중에는 장면 화면만 열려 있어도 '할 수 있어요'를 말하지 않는다", async () => {
    process.env.DREAM_SCENE_READ_BACKEND = "supabase-postgres"; process.env.DREAM_SCENE_SELECT_BACKEND = "supabase-postgres";
    state.list.mockResolvedValue({ kind: "unavailable" }); state.read.mockResolvedValue({ kind: "unavailable" });
    for (const markup of [html(await listPage()), html(await detailPage(V7))]) {
      expect(text(markup)).toContain("프로젝트를 불러오지 못했어요");
      expect(text(markup)).not.toMatch(/할 수 있어요|보기만/);
    }
  });
});

// P2-MANAGED-TOPIC-SHORTS-ENTRY-FRONT 배정 1·2(CMD-20261125-005·007·008·009): 쇼핑숏츠·주제별 쇼츠 고르기, 길이 10~60초(기본 30),
// 9:16 기본, 참고 자료는 선택이라 목록 없이도 저장, 사실 출처 없음, 핵심 메시지 글자 수 상한(50·100·200·300, 기본 100).
// 서버 설정(topic-shorts active·lengthOptions)은 Backend 몫이라, 여기서는 메뉴 설정 읽기를 합성 설정으로 바꿔 화면만 본다.
describe("주제별 쇼츠 진입(합성 설정)", () => {
  const real = JSON.parse(readFileSync("docs/spec/menus.json", "utf8"));
  const shop = real.menus.find((menu: { id: string }) => menu.id === "shopping-shorts");
  const topicMenu = { ...shop, id: "topic-shorts", label: "주제별 쇼츠", description: "주제·대상·핵심 메시지로 만드는 일반 쇼츠", defaultAspect: "9:16", defaultLengthSec: 30,
    inputs: [
      { id: "topic", label: "주제", type: "text", required: true, maxLength: 80 },
      { id: "keyMessageLength", label: "핵심 메시지 글자 수", type: "select", required: true, options: ["50", "100", "200", "300"] },
      { id: "keyMessage", label: "핵심 메시지", type: "textarea", required: true, maxLength: 300 },
      { id: "references", label: "참고 자료(선택)", type: "assets", required: false, accept: ["image", "video"] },
    ] };
  const config = { ...real, menus: [...real.menus, topicMenu] };
  const withTopic = async <T,>(load: () => Promise<T>) => {
    vi.resetModules();
    vi.doMock("@/lib/menus/parse", () => ({ parseMenuConfig: () => ({ ok: true, config }) }));
    try { return await load(); } finally { vi.doUnmock("@/lib/menus/parse"); vi.resetModules(); }
  };
  const topicPage = (menu?: string) => withTopic(async () => {
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    const page = (await import("@/app/(cloud)/cloud/projects/new/page")).default;
    return html(await page({ searchParams: Promise.resolve(menu ? { menu } : {}) }));
  });
  const submitTag = (markup: string) => markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
  const selectOf = (markup: string, id: string) => markup.match(new RegExp(`<select id="input-${id}"[^>]*>(.*?)</select>`))?.[1] ?? "";

  it("분야가 둘이면 먼저 고르기: 쇼핑숏츠·주제별 쇼츠 링크, 폼 없음", async () => {
    const markup = await topicPage();
    const nav = markup.match(/<nav aria-label="만들 분야"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
    expect([...nav.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map(match => [match[1], match[2]])).toEqual([
      ["/cloud/projects/new?menu=shopping-shorts", "쇼핑숏츠"], ["/cloud/projects/new?menu=topic-shorts", "주제별 쇼츠"]]);
    expect(nav).not.toContain("aria-current");
    expect(markup).toContain("만들 분야를 골라 주세요");
    expect(markup).not.toContain("<form");
    // 모르는 분야 주소도 고르기 화면
    expect(await topicPage("travel-shorts")).not.toContain("<form");
  });
  it("주제별 쇼츠: 주소 복귀, 길이 10~60초 기본 30, 9:16 기본, 글자 수 기본 100, 사실 출처 없음, 자료 목록 전에도 저장 열림", async () => {
    const markup = await topicPage("topic-shorts");
    expect(markup).toMatch(/<a[^>]*href="\/cloud\/projects\/new\?menu=topic-shorts"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/cloud\/projects\/new\?menu=topic-shorts"/);
    expect(markup).toMatch(/<form[^>]*novalidate/i);
    expect([...selectOf(markup, "lengthSec").matchAll(/<option value="(\d+)"( selected="")?>(\d+)초<\/option>/g)].map(match => [match[3], !!match[2]]))
      .toEqual([["10", false], ["20", false], ["30", true], ["40", false], ["50", false], ["60", false]]);
    expect(selectOf(markup, "aspect")).toMatch(/<option selected="">9:16<\/option>/);
    expect(selectOf(markup, "aspect")).toContain("1:1");
    expect(selectOf(markup, "aspect")).toContain("16:9");
    expect(selectOf(markup, "keyMessageLength")).toMatch(/^<option>50<\/option><option selected="">100<\/option><option>200<\/option><option>300<\/option>$/);
    expect(markup).toContain("0 / 100자");
    expect(markup).toContain('id="input-topic"');
    expect(markup).not.toMatch(/factSources|사실 출처|productName|상품명/);
    expect(submitTag(markup)).not.toMatch(/\bdisabled\b/);
    expect(markup).not.toContain("확인된 제품 사진이나 영상이 필요해요");
  });
  it("쇼핑숏츠를 고르면 기존 폼 그대로: 필수 자료 목록 전에는 저장 잠김", async () => {
    const markup = await topicPage("shopping-shorts");
    expect(markup).toContain('id="input-productName"');
    expect(markup).toContain("확인된 내 자료 목록을 불러오고 있어요.");
    expect(submitTag(markup)).toMatch(/\bdisabled\b/);
    expect(selectOf(markup, "lengthSec")).toBe("");
  });
  it("목록 안내도 두 분야 이름", async () => {
    const markup = await withTopic(async () => {
      const { CloudReadOnlyNote } = await import("@/components/cloud/project-list-readonly");
      return renderToStaticMarkup(CloudReadOnlyNote({ capability: { create: true, plan: false }, place: "list" }));
    });
    expect(markup).toContain("클라우드에서 새 쇼핑숏츠·주제별 쇼츠 프로젝트를 만들고 브리프 확인까지 할 수 있어요.");
  });
});

describe("주제별 쇼츠 규칙: 길이 선택지와 핵심 메시지 글자 수", () => {
  it("길이: topic-shorts는 10~60초, 설정의 lengthOptions가 있으면 그것, 쇼핑은 숫자 입력", () => {
    expect(lengthChoices({ id: "topic-shorts" })).toEqual([10, 20, 30, 40, 50, 60]);
    expect(lengthChoices({ id: "topic-shorts", lengthOptions: [15, 30] })).toEqual([15, 30]);
    expect(lengthChoices({ id: "topic-shorts", lengthOptions: [0, "x"] })).toEqual([10, 20, 30, 40, 50, 60]);
    expect(lengthChoices({ id: "shopping-shorts" })).toBeUndefined();
  });
  it("글자 수: 서버와 같은 trim().length — 50자 상한에서 50자는 저장 가능, 51자는 차단, 이모지는 2자, 앞뒤 공백 제외", () => {
    const options = ["50", "100", "200", "300"];
    expect(keyMessageCheck(options, "50", "가".repeat(50))).toEqual({ max: 50, count: 50, over: false });
    expect(keyMessageCheck(options, "50", "가".repeat(51))).toEqual({ max: 50, count: 51, over: true });
    expect(keyMessageCheck(options, "100", "😀".repeat(100))).toEqual({ max: 100, count: 200, over: true });
    expect(keyMessageCheck(options, "50", "가".repeat(49) + "😀")).toEqual({ max: 50, count: 51, over: true });
    expect(keyMessageCheck(options, "50", "  " + "가".repeat(50) + "\n\t ")).toEqual({ max: 50, count: 50, over: false });
    expect(keyMessageCheck(options, "50", "가 " + "가".repeat(49)).over).toBe(true); // 가운데 공백은 센다
    expect(keyMessageCheck(options, "100", "a".repeat(101)).over).toBe(true);
    expect(keyMessageCheck(options, "75", "a".repeat(200))).toEqual({ max: undefined, count: 200, over: false });
    expect(keyMessageCheck(undefined, "50", "a".repeat(200)).over).toBe(false);
  });
  it("관리형 분야 순서와 이름", () => {
    const menus = [{ id: "topic-shorts", availability: "active" }, { id: "travel-shorts", availability: "active" }, { id: "shopping-shorts", availability: "active" }];
    expect(activeManagedMenus(menus).map(menu => menu.id)).toEqual(["shopping-shorts", "topic-shorts"]);
    expect(activeManagedMenus([{ id: "topic-shorts", availability: "skeleton" }])).toEqual([]);
    expect([managedMenuName("shopping-shorts"), managedMenuName("topic-shorts")]).toEqual(["쇼핑숏츠", "주제별 쇼츠"]);
  });
});

describe("주제별 쇼츠 브리프: 주제·핵심 메시지, 예전 응답 호환", () => {
  const base = { title: "제목", goal: "목표", target: "대상", aspect: "9:16", lengthSec: 30, revision: 1, stages: { intake: "approved", brief: "todo", plan: "locked" } };
  it("topic-shorts 응답: 주제·핵심 메시지 줄, 상품·출처 줄 없음", () => {
    const read = classifyBriefRead(200, { ...base, menuId: "topic-shorts", topic: "출근길 스트레칭", keyMessage: "3분이면 충분해요", product: null, facts: null, rights: null, sources: null });
    expect(read.kind).toBe("ok");
    const markup = renderToStaticMarkup(BriefSummary({ brief: (read as { brief: Parameters<typeof BriefSummary>[0]["brief"] }).brief }));
    const labels = [...markup.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1]);
    expect(labels).toEqual(["제목", "목표", "보는 사람(타깃)", "주제", "핵심 메시지", "화면 비율", "목표 길이"]);
  });
  it("예전 쇼핑 응답(menuId·topic 없음)도 그대로 읽고 상품 줄을 보임", () => {
    const read = classifyBriefRead(200, { ...base, product: "텀블러", facts: "보온 6시간", rights: "직접 촬영", sources: "제조사 표" });
    expect(read.kind).toBe("ok");
    const markup = renderToStaticMarkup(BriefSummary({ brief: (read as { brief: Parameters<typeof BriefSummary>[0]["brief"] }).brief }));
    expect([...markup.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1]))
      .toEqual(["제목", "목표", "보는 사람(타깃)", "화면 비율", "목표 길이", "상품명", "확인된 장점", "장점 출처", "제품 이미지 사용권"]);
  });
});
