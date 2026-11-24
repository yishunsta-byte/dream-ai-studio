import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyOlder, classifyRegister, classifyScenes, classifySelect, cloudScenesPath, mergeVersions, olderVersionsApiPath, pendingKey, registerContent, runWrite, selectContent,
  withRequestId, writeGate, type PendingWrites, type SceneVersion,
} from "@/components/cloud/managed-scene-requests";
import {
  clearPending, loadPending, PENDING_MAX, PENDING_MAX_AGE_MS, pendingStorageKey, restoredLabel, savePending,
} from "@/components/cloud/managed-scene-pending-store";

// P2-MANAGED-SOURCE-SCENE-PANEL(Master msg_bd14483e7077): 관리형 장면 화면의 판정·요청 본문·진입점·경계.
const state = vi.hoisted(() => ({
  auth: { kind: "verified", userId: "u", email: "a@example.invalid" } as unknown,
  read: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
  notFound: vi.fn(() => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true }); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect, notFound: state.notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/render", () => ({ getRenderAuth: async () => state.auth }));
vi.mock("@/lib/cloud/project-read-page", async (original) => ({ ...await original<object>(), readCloudProject: state.read }));
vi.mock("@/components/cloud/managed-plan-editor", () => ({
  ManagedPlanEditor: (props: { projectId: string; scenesHref?: string }) => createElement("i", { "data-editor": props.projectId, "data-scenes": props.scenesHref ?? "none" }),
}));

const P = "01936b2e-8f3a-7c4d-8e5f-1a2b3c4d5e6f";
const S1 = "01936b2e-8f3a-7c4d-8e5f-000000000001";
const S2 = "01936b2e-8f3a-7c4d-8e5f-000000000002";
const PLAN = "01936b2e-8f3a-7c4d-8e5f-0000000000aa";
const A = "01936b2e-8f3a-7c4d-8e5f-0000000000bb";
const html = (node: unknown) => isValidElement(node) ? renderToStaticMarkup(node) : "";
const settle = async (run: () => Promise<unknown>) => { try { return { value: await run() }; } catch (error) { return { error: error as Error & { to?: string; notFound?: boolean } }; } };
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
const v = (n: number, extra: Partial<SceneVersion> = {}): SceneVersion => ({ id: `01936b2e-8f3a-7c4d-8e5f-1000000000${String(n).padStart(2, "0")}`, version: n, kind: "image",
  status: "succeeded", origin: "direct", planId: PLAN, resultAssetId: A, createdAt: "2026-11-24T00:00:00.000Z", ...extra });
const view = (over: Record<string, unknown> = {}) => ({ projectId: P, revision: 3, approvedPlanId: PLAN, approvedPlanVersion: 2, stages: { plan: "approved", produce: "todo" },
  scenes: [{ id: S1, position: 0, selectedVersionId: v(2).id, selectedVersion: v(2), recentVersions: [v(3), v(2), v(1)], olderCursor: null },
    { id: S2, position: 1, selectedVersionId: null, selectedVersion: null, recentVersions: [], olderCursor: null }], ...over });

const KEYS = ["DREAM_SCENE_READ_BACKEND", "DREAM_SCENE_RESULT_BACKEND", "DREAM_SCENE_SELECT_BACKEND", "DREAM_PROJECT_CORE_BACKEND", "DREAM_PROJECT_PLAN_BACKEND"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } state.auth = { kind: "verified", userId: "u", email: "a@example.invalid" }; vi.clearAllMocks(); });
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

describe("GET /scenes 판정", () => {
  it("200은 형식을 검사하고, 404·401·403·503(연결 전·장애)·422(한도)·그 밖을 나눈다", () => {
    expect(classifyScenes(200, view())).toMatchObject({ kind: "ok", view: { revision: 3, scenes: [{ id: S1 }, { id: S2 }] } });
    expect(classifyScenes(200, { ...view(), scenes: [{ id: "x" }] })).toEqual({ kind: "failed" });
    expect(classifyScenes(200, { ...view(), scenes: [{ ...view().scenes[0], recentVersions: [v(1, { status: "weird" as never })] }] })).toEqual({ kind: "failed" });
    expect([404, 401, 403, 503, 422, 500].map(status => classifyScenes(status, {}).kind)).toEqual(["missing", "login", "forbidden", "unlinked", "limit", "failed"]);
  });
  it("이전 결과: 같은 장면만 받고, 400 INVALID_CURSOR·404는 다시 읽기, 401·403은 로그인", () => {
    const page = { projectId: P, sceneId: S1, revision: 3, versions: [v(1)], olderCursor: null };
    expect(classifyOlder(200, page, S1.toUpperCase())).toMatchObject({ kind: "ok", versions: [{ version: 1 }], olderCursor: null });
    expect(classifyOlder(200, { ...page, sceneId: S2 }, S1)).toEqual({ kind: "failed" });
    expect([400, 404, 401, 403, 503].map(status => classifyOlder(status, {}, S1).kind)).toEqual(["reload", "reload", "login", "login", "failed"]);
    expect(olderVersionsApiPath(P, S1, "ab_c-1")).toBe(`/api/projects/${P}/scenes?scene=${S1}&cursor=ab_c-1`);
  });
  it("선택·최근·이전 결과는 ID로 한 번만, 버전 번호 내림차순", () => {
    const selected = v(2), recent = [v(5), v(4), v(3), v(2), v(1)], older = [v(1), v(0, { id: v(1).id }), v(-1 + 2)];
    const merged = mergeVersions(selected ? [selected] : [], mergeVersions(recent, older));
    expect(merged.map(item => item.version)).toEqual([5, 4, 3, 2, 1]);
    expect(new Set(merged.map(item => item.id)).size).toBe(merged.length);
  });
});

describe("POST /scene-results · /scene-selection 판정", () => {
  const created = { projectId: P, sceneId: S1, assetId: A, versionId: v(4).id, version: 4, outcome: "created" };
  it("등록: 201 created·200 replayed만 완료, 상태와 결과가 어긋나거나 다른 장면이면 결과 모름", () => {
    expect(classifyRegister(201, created, S1)).toEqual({ kind: "done", replayed: false });
    expect(classifyRegister(200, { ...created, outcome: "replayed" }, S1)).toEqual({ kind: "done", replayed: true });
    expect(classifyRegister(200, created, S1)).toEqual({ kind: "unknown" });
    expect(classifyRegister(201, { ...created, sceneId: S2 }, S1)).toEqual({ kind: "unknown" });
  });
  it.each([
    [409, "CONFLICT", "conflict", "다른 변경이 먼저 저장됐어요"], [409, "PLAN_NOT_APPROVED", "conflict", "기획이 승인된 상태가 아니에요"],
    [409, "STAGE_LOCKED", "conflict", "장면 제작 단계가 열려 있지 않아요"], [409, "ASSET_NOT_READY", "conflict", "이 자료는 지금 쓸 수 없어요"],
    [404, "NOT_FOUND", "missing", ""], [401, "AUTH_REQUIRED", "login", ""], [403, "AUTH_FORBIDDEN", "forbidden", ""], [403, "ORIGIN_FORBIDDEN", "invalid", ""],
    [400, "INVALID_INPUT", "invalid", ""], [413, "PAYLOAD_TOO_LARGE", "invalid", ""], [503, "SCENE_RESULT_UNAVAILABLE", "unknown", ""], [500, "X", "unknown", ""],
  ])("등록 %i %s → %s", (status, code, kind, text) => {
    const outcome = classifyRegister(status, { error: "서버 문구", code }, S1);
    expect(outcome.kind).toBe(kind);
    if (text) expect(outcome).toMatchObject({ message: expect.stringContaining(text) });
  });
  it("선택: 200이고 고른 버전이 선택돼 돌아올 때만 완료, REQUEST_REUSED는 새 번호, INVALID_VERSION은 다시 읽기", () => {
    const body = { projectId: P, sceneId: S1, selectedVersionId: v(3).id, revision: 4, outcome: "selected" };
    expect(classifySelect(200, body, S1, v(3).id)).toEqual({ kind: "done", replayed: false });
    expect(classifySelect(200, { ...body, outcome: "replayed" }, S1, v(3).id)).toEqual({ kind: "done", replayed: true });
    expect(classifySelect(200, body, S1, v(2).id)).toEqual({ kind: "unknown" });
    expect(classifySelect(201, body, S1, v(3).id)).toEqual({ kind: "unknown" });
    expect(classifySelect(409, { code: "REQUEST_REUSED" }, S1, v(3).id)).toEqual({ kind: "reused" });
    expect(classifySelect(409, { code: "INVALID_VERSION" }, S1, v(3).id)).toMatchObject({ kind: "conflict", code: "INVALID_VERSION" });
    expect(classifySelect(409, { code: "CONFLICT" }, S1, v(3).id)).toMatchObject({ kind: "conflict" });
  });
});

describe("요청 번호와 본문: 서버 엄격 검사와 같은 키만", () => {
  it("결과 모름 작업은 내용·개정이 바뀌어도 처음 번호·내용을 그대로 보내고, 결과가 정해진 뒤에는 새 번호", async () => {
    let n = 0; const key = () => `00000000-0000-4000-8000-00000000000${++n}`;
    const sent: string[] = [];
    let status = 503;
    const fetcher = async (_input: string, init: RequestInit) => { sent.push(String(init.body)); return { status, json: async () => ({ code: "SCENE_RESULT_UNAVAILABLE" }) }; };
    const first = await runWrite(P, {}, { kind: "register", sceneId: S1, content: registerContent(3, S1, A), target: A, label: "자료" }, fetcher, key);
    expect(first.outcome.kind).toBe("unknown");
    const second = await runWrite(P, first.pendings, { kind: "register", sceneId: S1, content: registerContent(4, S1, A), target: A, label: "자료" }, fetcher, key);
    expect(second.retried).toBe(true);
    expect(sent[1]).toBe(sent[0]);
    expect(JSON.parse(sent[1])).toMatchObject({ requestId: "00000000-0000-4000-8000-000000000001", revision: 3 });
    status = 409;
    const settled = await runWrite(P, second.pendings, { kind: "register", sceneId: S1, content: registerContent(4, S1, A), target: A, label: "자료" }, fetcher, key);
    expect(settled.outcome.kind).toBe("conflict");
    expect(settled.pendings).toEqual({});
    await runWrite(P, settled.pendings, { kind: "register", sceneId: S1, content: registerContent(4, S1, A), target: A, label: "자료" }, fetcher, key);
    expect(JSON.parse(sent[3])).toMatchObject({ requestId: "00000000-0000-4000-8000-000000000002", revision: 4 });
  });
  it("등록·선택 본문은 실제 서버 스키마를 통과하고, sha·소유자·영수증·projectId 같은 값은 없다", async () => {
    const { sceneResultRegisterBodySchema } = await import("@/lib/services/postgres/scene-result-register");
    const { sceneSelectBodySchema } = await import("@/lib/services/postgres/scene-select");
    const register = JSON.parse(withRequestId("01936b2e-8f3a-7c4d-8e5f-0000000000cc", registerContent(3, S1, A)));
    expect(Object.keys(register).sort()).toEqual(["assetId", "requestId", "revision", "sceneId"]);
    expect(sceneResultRegisterBodySchema.safeParse(register).success).toBe(true);
    const select = JSON.parse(withRequestId("01936b2e-8f3a-7c4d-8e5f-0000000000dd", selectContent(3, S1, v(3).id, null)));
    expect(Object.keys(select).sort()).toEqual(["expectedVersionId", "requestId", "revision", "sceneId", "versionId"]);
    expect(sceneSelectBodySchema.safeParse(select).success).toBe(true);
    expect(sceneSelectBodySchema.safeParse(JSON.parse(withRequestId("01936b2e-8f3a-7c4d-8e5f-0000000000dd", selectContent(3, S1, v(3).id, v(2).id)))).success).toBe(true);
  });
});

describe("/cloud/projects/:id/scenes 페이지", () => {
  const page = async (id = P) => (await import("@/app/(cloud)/cloud/projects/[id]/scenes/page")).default({ params: Promise.resolve({ id }) });
  it("장면 조회 미지정이면 준비 안내만(요청 없는 서버 화면), 지정이면 장면 화면을 연다", async () => {
    const closed = html(await page());
    expect(closed).toContain("아직 클라우드에서는 장면 결과를 볼 수 없어요");
    expect(closed).not.toContain("장면을 불러오고 있어요");
    process.env.DREAM_SCENE_READ_BACKEND = "supabase-postgres";
    const open = html(await page(P.toUpperCase()));
    expect([...open.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(["장면 결과"]);
    expect(open).toContain('role="status"');
    expect(open).toContain("장면을 불러오고 있어요.");
    // RETRY: 지금 되는 일과 아직 연결 전인 장면 제작·편집·렌더를 나눠 말한다. 조회만 열린 설정이라 등록·선택은 말하지 않는다(SCENE-PAGE-CAPABILITY-COPY).
    expect(open).toContain("승인된 기획의 장면마다 이미 있는 결과를 볼 수 있어요. 결과를 새로 만드는 장면 제작과 편집·렌더는 아직 클라우드에 연결되지 않아");
    expect(open).not.toMatch(/등록하거나|등록할 수 있어요|고를 수 있어요/);
    expect(hrefs(open)).toEqual([`/cloud/projects/${P}`]);
    expect(open).not.toMatch(/<input|<select|<textarea/);
  });
  it("등록·선택 버튼 조건은 각 경로 환경과 같다", async () => {
    const { ManagedScenePanel } = await import("@/components/cloud/managed-scene-panel");
    const props = async () => { const node = await page(); const children = (node as { props: { children: unknown[] } }).props.children;
      const panel = children.flat().find(child => isValidElement(child) && child.type === ManagedScenePanel) as { props: { register: boolean; select: boolean } } | undefined;
      return panel?.props; };
    process.env.DREAM_SCENE_READ_BACKEND = "supabase-postgres";
    expect(await props()).toMatchObject({ register: false, select: false });
    process.env.DREAM_SCENE_RESULT_BACKEND = "supabase-postgres";
    expect(await props()).toMatchObject({ register: false });
    process.env.DREAM_PROJECT_CORE_BACKEND = "supabase-postgres";
    process.env.DREAM_SCENE_SELECT_BACKEND = "supabase-postgres";
    expect(await props()).toMatchObject({ register: true, select: true });
  });
  it("비로그인은 로그인 뒤 같은 장면 화면으로, 403·장애는 오류 안내, 형식 틀린 ID는 404, 이 PC는 로컬 안내", async () => {
    state.auth = { kind: "denied", status: 401 };
    expect((await settle(() => page(P.toUpperCase()))).error?.to).toBe(`/login?next=${encodeURIComponent(cloudScenesPath(P))}`);
    expect((await settle(() => page("x"))).error?.to).toBe("/login?next=%2Fcloud%2Fprojects");
    state.auth = { kind: "denied", status: 403 };
    expect((await settle(() => page())).error?.to).toBe("/login?error=forbidden");
    state.auth = { kind: "denied", status: 503 };
    expect((await settle(() => page())).error?.to).toBe("/login?error=unavailable");
    state.auth = { kind: "verified", userId: "u" };
    expect((await settle(() => page("00000000-0000-4000-8000-000000000001"))).error?.notFound).toBe(true);
    state.auth = { kind: "local" };
    expect(html(await page())).toContain("이 PC에서는 기존 작업실을 써요");
  });

  // P2-MANAGED-UI-SCENE-PAGE-CAPABILITY-COPY: 환경값 5개의 32조합마다 머리말·준비 안내가 이 화면의 실제 동작(패널 열림·등록·선택 단추)과 같다.
  // 기대 모드는 페이지 코드를 읽지 않고 경로 조건(조회 = SCENE_READ, 등록 = SCENE_RESULT + PROJECT_CORE, 선택 = SCENE_SELECT)으로 따로 계산한다.
  const ORDER = ["DREAM_SCENE_READ_BACKEND", "DREAM_SCENE_RESULT_BACKEND", "DREAM_PROJECT_CORE_BACKEND", "DREAM_SCENE_SELECT_BACKEND", "DREAM_PROJECT_PLAN_BACKEND"] as const;
  type Mode = "unavailable" | "read-only" | "register-only" | "select-only" | "register-and-select";
  const WHEN = "기획이 승인되고 장면 제작 단계가 시작 전이거나 진행 중일 때만 돼요.";
  const HEAD: Record<Mode, string> = {
    unavailable: "승인된 기획의 장면별 결과를 보는 화면이에요.",
    "read-only": "승인된 기획의 장면마다 이미 있는 결과를 볼 수 있어요.",
    "register-only": `승인된 기획의 장면마다 이미 있는 결과를 보고, 확인된 내 자료를 결과로 등록할 수 있어요. 등록은 ${WHEN}`,
    "select-only": `승인된 기획의 장면마다 이미 있는 결과를 보고 쓸 결과를 고를 수 있어요. 선택은 ${WHEN}`,
    "register-and-select": `승인된 기획의 장면마다 이미 있는 결과를 보고, 확인된 내 자료를 결과로 등록하거나 쓸 결과를 고를 수 있어요. 등록·선택은 ${WHEN}`,
  };
  const TAIL = " 결과를 새로 만드는 장면 제작과 편집·렌더는 아직 클라우드에 연결되지 않아 내 PC 작업실에서 해 주세요.";
  const modeOf = (on: readonly string[]): Mode => {
    if (!on.includes("DREAM_SCENE_READ_BACKEND")) return "unavailable";
    const register = on.includes("DREAM_SCENE_RESULT_BACKEND") && on.includes("DREAM_PROJECT_CORE_BACKEND"), select = on.includes("DREAM_SCENE_SELECT_BACKEND");
    return register && select ? "register-and-select" : register ? "register-only" : select ? "select-only" : "read-only";
  };
  const combos = Array.from({ length: 2 ** ORDER.length }, (_unused, mask) => ORDER.filter((_flag, pos) => mask & (1 << pos)));
  it.each(combos.map(on => [on.map(flag => flag.replace(/^DREAM_|_BACKEND$/g, "")).join("+") || "모두 꺼짐", modeOf(on), on] as const))(
    "%s → %s: 머리말·준비 안내가 패널 단추와 같은 동작만 말한다", async (_name, mode, on) => {
      for (const flag of on) process.env[flag] = "supabase-postgres";
      const { ManagedScenePanel } = await import("@/components/cloud/managed-scene-panel");
      const node = await page();
      const panel = (node as { props: { children: unknown[] } }).props.children.flat()
        .find(child => isValidElement(child) && child.type === ManagedScenePanel) as { props: { register: boolean; select: boolean } } | undefined;
      const actual = { read: !!panel, register: !!panel?.props.register, select: !!panel?.props.select };
      expect(actual).toEqual({ read: mode !== "unavailable", register: mode === "register-only" || mode === "register-and-select", select: mode === "select-only" || mode === "register-and-select" });
      const text = html(node).replace(/<[^>]+>/g, "");
      expect(text).toContain(HEAD[mode] + TAIL);
      // 말한 동작 = 열린 동작. 조회가 꺼져 있으면 보기·등록·선택 어느 것도 약속하지 않고 준비 안내만 둔다.
      expect({ read: /결과를 (?:볼 수 있어요|보고)/.test(text), register: /결과로 등록(?:하거나|할 수 있어요)/.test(text), select: text.includes("쓸 결과를 고를 수 있어요") }).toEqual(actual);
      expect(text.includes("아직 클라우드에서는 장면 결과를 볼 수 없어요")).toBe(mode === "unavailable");
      if (mode === "unavailable") expect(text).toContain("지금은 장면 결과를 내 PC 작업실에서 확인해 주세요.");
      // 등록·선택을 말하면 쓰기 조건(기획 승인·장면 제작 단계)을, 등록을 말하면 확인된 자료 조건을 함께 밝힌다.
      if (actual.register || actual.select) expect(text).toContain(WHEN); else expect(text).not.toContain(WHEN);
      if (actual.register) expect(text).toContain("확인된 내 자료를 결과로 등록");
      expect(text).not.toMatch(/(?:새로 만들|편집|렌더)[^.]*(?:할 수 있어요|만들 수 있어요)|연결됐|연결 성공|연결되면|postgres|DREAM_/i);
      expect(hrefs(html(node))).toEqual(mode === "unavailable" ? [`/cloud/projects/${P}`, `/cloud/projects/${P}`] : [`/cloud/projects/${P}`]);
    });
});

describe("진입점: 상세·기획에서 장면 결과로", () => {
  const detail = async () => (await import("@/app/(cloud)/cloud/projects/[id]/page")).default({ params: Promise.resolve({ id: P }) });
  const planPage = async () => (await import("@/app/(cloud)/cloud/projects/[id]/plan/page")).default({ params: Promise.resolve({ id: P }) });
  const project = (produce: string) => ({ kind: "ok", data: { id: P, title: "제목", menuLabel: "쇼핑숏츠", aspect: "9:16", lengthSec: 30, updatedAt: "2026-11-22T00:00:00.000Z",
    stages: [["intake", "approved"], ["brief", "approved"], ["plan", "approved"], ["produce", produce]].map(([stage, status]) => ({ stage, label: stage, status })) } });
  it.each([[true, "todo", true], [true, "in_progress", true], [true, "locked", false], [false, "todo", false]])("상세: 장면 조회 %s · 장면 제작 %s → 링크 %s", async (managed, produce, linked) => {
    if (managed) process.env.DREAM_SCENE_READ_BACKEND = "supabase-postgres";
    state.read.mockResolvedValue(project(produce));
    const markup = html(await detail());
    expect(hrefs(markup).includes(cloudScenesPath(P))).toBe(linked);
    expect(markup.includes("장면 결과 보기")).toBe(linked);
  });
  it("기획: 장면 조회가 지정됐을 때만 장면 주소를 넘긴다(승인·장면 제작 열림은 화면이 다시 읽은 값으로)", async () => {
    process.env.DREAM_PROJECT_PLAN_BACKEND = "supabase-postgres";
    expect(html(await planPage())).toContain('data-scenes="none"');
    process.env.DREAM_SCENE_READ_BACKEND = "supabase-postgres";
    expect(html(await planPage())).toContain(`data-scenes="${cloudScenesPath(P)}"`);
    const editor = readFileSync("components/cloud/managed-plan-editor.tsx", "utf8");
    expect(editor).toMatch(/scenesHref && plan\.approved && plan\.produceOpen && <Link className="action-link" href=\{scenesHref\}>장면 결과 보기<\/Link>/);
  });
});

describe("정적 경계", () => {
  it("화면 파일은 DB·서비스·legacy를 가져오지 않고, 같은 출처 상대 경로로만 요청하며 저장소·콘솔을 쓰지 않는다", () => {
    for (const file of ["components/cloud/managed-scene-panel.tsx", "components/cloud/managed-scene-requests.ts", "app/(cloud)/cloud/projects/[id]/scenes/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from "(?:@\/lib\/db|@\/lib\/services|@\/lib\/menus\/server|@\/lib\/cloud\/managed-|pg|better-sqlite3)/);
      expect(source, file).not.toMatch(/console\.|localStorage|sessionStorage|fetch\("https?:/);
    }
    const panel = readFileSync("components/cloud/managed-scene-panel.tsx", "utf8");
    expect(panel.match(/fetch\(/g)).toHaveLength(4);
    expect(panel).toContain("runWrite(projectId, pendings, request, (input, init) => fetch(input, init), () => v7(),");
    // RECOVERY: 저장소는 보관 모듈 한 곳에서 이 탭 sessionStorage만 쓴다(localStorage·요청·콘솔 없음). 화면·요청·페이지 파일은 저장소를 직접 쓰지 않는다.
    const store = readFileSync("components/cloud/managed-scene-pending-store.ts", "utf8");
    expect(store.match(/sessionStorage/g)?.length).toBeGreaterThan(0);
    expect(store).toContain("window.sessionStorage");
    expect(store).not.toMatch(/localStorage|indexedDB|document\.cookie|console\.|fetch\(|from "@\/lib/);
    expect(panel).toContain("savePending(storage, pendingScope, projectId, next)");
    // 자동 재전송 없음: 타이머·반복 재시도가 없고, 결과 모름 다시 확인은 버튼(write(pending, …))으로만.
    expect(panel).not.toMatch(/setTimeout|setInterval|retry\(|while \(/);
    expect(panel).toContain("onClick={() => void write(pending, number)}>같은 요청으로 다시 확인</Button>");
    expect(panel).toMatch(/fetch\(scenesApiPath\(projectId\), \{ \.\.\.sameOrigin, signal \}\)/);
    expect(panel).toMatch(/fetch\(assetChoicesPath\(cursor\), \{ \.\.\.sameOrigin, signal \}\)/);
    expect(panel).not.toContain("nextAttempt");
    expect(panel).not.toMatch(/<input[^>]*type="text"|<textarea/);
    // 키보드: 자료 고르기는 이름표와 묶인 기본 select, 등록·선택·이전 결과·다시 불러오기는 모두 기본 button(type="button"), 결과 안내는 status/alert로 읽힌다.
    expect(panel).toContain("<label htmlFor={selectId}>등록할 자료</label>");
    expect(panel).toContain("<select id={selectId}");
    expect(panel.match(/<Button type="button"/g)?.length).toBe(8);
    expect(panel).not.toMatch(/onClick=\{[^}]*\}[^>]*<(?:div|span|li)|<(?:div|span|li)[^>]*onClick/);
    // RETRY: 안내 제목·본문을 한 알림 영역(aria-live)에 두고 새 안내가 생기면 그 영역으로 초점을 옮긴다(처리 뒤 버튼이 사라져도 초점이 문서 처음으로 빠지지 않게).
    expect(panel).toContain('<div ref={messageRef} tabIndex={-1} aria-live="polite">');
    expect(panel).toContain("requestAnimationFrame(() => messageRef.current?.focus())");
    expect(panel).toContain("await reload(true);");
    expect(panel).toMatch(/const sameOrigin = \{ credentials: "same-origin", cache: "no-store" \} as const/);
  });
});

// RETRY(독립 검수 5df82e92 5절 1·2): 서버 영수증 규칙을 따르는 시험용 응답으로 실제 runWrite·판정을 돌린다.
// 등록: 같은 requestId·같은 장면/자료면 개정과 상관없이 200 replayed(서버 입력 지문에 개정 없음), 새 번호면 개정 확인 뒤 201 created.
// 선택: 같은 requestId·같은 내용이면 200 replayed, 다른 내용이면 409 REQUEST_REUSED, 새 번호면 개정·기대 선택 확인 뒤 200 selected(개정 +1).
function fakeServer() {
  const s = { revision: 3, versions: new Map<string, string[]>(), selected: new Map<string, string | null>(), receipts: new Map<string, string>(),
    lose: "" as "" | "before" | "after", calls: 0 };
  const fetcher = async (input: string, init: RequestInit) => {
    s.calls++;
    const lose = s.lose; s.lose = "";
    if (lose === "before") throw new TypeError("network");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const scene = String(body.sceneId);
    let result: { status: number; body: unknown };
    if (input.endsWith("/scene-results")) {
      const fingerprint = `${scene}|${body.assetId}`;
      const prior = s.receipts.get(String(body.requestId));
      if (prior) result = prior === fingerprint ? { status: 200, body: { projectId: P, sceneId: scene, assetId: body.assetId, versionId: v(1).id, version: 1, outcome: "replayed" } }
        : { status: 409, body: { code: "CONFLICT" } };
      else if (body.revision !== s.revision) result = { status: 409, body: { code: "CONFLICT" } };
      else {
        const list = s.versions.get(scene) ?? []; list.push(String(body.assetId)); s.versions.set(scene, list); s.receipts.set(String(body.requestId), fingerprint);
        result = { status: 201, body: { projectId: P, sceneId: scene, assetId: body.assetId, versionId: v(list.length).id, version: list.length, outcome: "created" } };
      }
    } else {
      const fingerprint = `${scene}|${body.versionId}|${body.expectedVersionId}`;
      const prior = s.receipts.get(String(body.requestId));
      const ok = (outcome: string) => ({ status: 200, body: { projectId: P, sceneId: scene, selectedVersionId: body.versionId, revision: s.revision, outcome } });
      if (prior) result = prior === fingerprint ? ok("replayed") : { status: 409, body: { code: "REQUEST_REUSED" } };
      else if (body.revision !== s.revision || (s.selected.get(scene) ?? null) !== body.expectedVersionId) result = { status: 409, body: { code: "CONFLICT" } };
      else { s.selected.set(scene, String(body.versionId)); s.revision++; s.receipts.set(String(body.requestId), fingerprint); result = ok("selected"); }
    }
    if (lose === "after") throw new TypeError("network");
    return { status: result.status, json: async () => result.body };
  };
  return { s, fetcher };
}
let ids = 0;
const newId = () => `01936b2e-8f3a-7c4d-9e5f-${String(++ids).padStart(12, "0")}`;
const reg = (sceneId: string, revision: number, assetId = A) => ({ kind: "register" as const, sceneId, content: registerContent(revision, sceneId, assetId), target: assetId, label: "자료" });
const sel = (sceneId: string, revision: number, versionId: string, expected: string | null) =>
  ({ kind: "select" as const, sceneId, content: selectContent(revision, sceneId, versionId, expected), target: versionId, label: "결과" });

describe("RETRY: 결과 모름 뒤 다시 확인 — 복수 장면·개정 변경·응답 유실에서도 중복 등록 없음", () => {
  it("P3 재연: 장면 2 등록 응답 유실(서버 처리됨) → 장면 1 선택으로 개정 3→4 → 장면 2 다시 확인은 원래 번호로 replayed, 버전 1개", async () => {
    const { s, fetcher } = fakeServer();
    s.lose = "after";
    let run = await runWrite(P, {}, reg(S2, 3), fetcher, newId);
    expect(run.outcome.kind).toBe("unknown");
    expect(Object.keys(run.pendings)).toEqual([pendingKey("register", S2)]);
    run = await runWrite(P, run.pendings, sel(S1, 3, v(1).id, null), fetcher, newId);
    expect(run.outcome).toEqual({ kind: "done", replayed: false });
    expect(s.revision).toBe(4);
    expect(Object.keys(run.pendings)).toEqual([pendingKey("register", S2)]);
    run = await runWrite(P, run.pendings, reg(S2, 4), fetcher, newId);
    expect(run).toMatchObject({ retried: true, outcome: { kind: "done", replayed: true } });
    expect(run.pendings).toEqual({});
    expect(s.versions.get(S2)).toHaveLength(1);
  });
  it("P4 재연: 장면 1·장면 2 등록이 차례로 결과 모름 → 각자 다시 확인해도 장면마다 버전 1개", async () => {
    const { s, fetcher } = fakeServer();
    s.lose = "after"; let run = await runWrite(P, {}, reg(S1, 3), fetcher, newId);
    s.lose = "after"; run = await runWrite(P, run.pendings, reg(S2, 3), fetcher, newId);
    expect(Object.keys(run.pendings).sort()).toEqual([pendingKey("register", S1), pendingKey("register", S2)].sort());
    run = await runWrite(P, run.pendings, reg(S1, 3), fetcher, newId);
    expect(run.outcome).toEqual({ kind: "done", replayed: true });
    run = await runWrite(P, run.pendings, reg(S2, 3), fetcher, newId);
    expect(run.outcome).toEqual({ kind: "done", replayed: true });
    expect([s.versions.get(S1)?.length, s.versions.get(S2)?.length]).toEqual([1, 1]);
    expect(run.pendings).toEqual({});
  });
  it("비교: 같은 상황에서 새 번호로 보내면(987d640 방식) 시험 서버가 실제로 중복 버전을 만든다 — 시험 서버가 중복을 잡아낼 수 있음을 확인", async () => {
    const { s, fetcher } = fakeServer();
    s.lose = "after"; await runWrite(P, {}, reg(S2, 3), fetcher, newId);
    await runWrite(P, {}, sel(S1, 3, v(1).id, null), fetcher, newId);
    const fresh = await runWrite(P, {}, reg(S2, 4), fetcher, newId);
    expect(fresh.outcome).toEqual({ kind: "done", replayed: false });
    expect(s.versions.get(S2)).toHaveLength(2);
  });
  it("보내기 전에 끊김(서버 미처리) + 개정 변경 → 다시 확인은 원래 개정이라 409로 끝나고 기록을 지운다 → 새 등록은 새 번호로 1개만", async () => {
    const { s, fetcher } = fakeServer();
    s.lose = "before"; let run = await runWrite(P, {}, reg(S2, 3), fetcher, newId);
    expect(run.outcome.kind).toBe("unknown");
    run = await runWrite(P, run.pendings, sel(S1, 3, v(1).id, null), fetcher, newId);
    run = await runWrite(P, run.pendings, reg(S2, 4), fetcher, newId);
    expect(run).toMatchObject({ retried: true, outcome: { kind: "conflict", code: "CONFLICT" } });
    expect(run.pendings).toEqual({});
    const sentBefore = run.sent.requestId;
    run = await runWrite(P, run.pendings, reg(S2, 4), fetcher, newId);
    expect(run).toMatchObject({ retried: false, outcome: { kind: "done", replayed: false } });
    expect(run.sent.requestId).not.toBe(sentBefore);
    expect(s.versions.get(S2)).toHaveLength(1);
  });
  it("선택 결과 모름 → 같은 장면 등록도 결과 모름 → 다시 확인은 각자 원래 번호로 replayed, 개정은 한 번만. 등록 기록과 선택 기록은 따로", async () => {
    const { s, fetcher } = fakeServer();
    s.lose = "after"; let run = await runWrite(P, {}, sel(S1, 3, v(1).id, null), fetcher, newId);
    expect(s.revision).toBe(4);
    s.lose = "after"; run = await runWrite(P, run.pendings, reg(S1, 4), fetcher, newId);
    expect(Object.keys(run.pendings).sort()).toEqual([pendingKey("register", S1), pendingKey("select", S1)].sort());
    run = await runWrite(P, run.pendings, sel(S1, 4, v(2).id, v(1).id), fetcher, newId);
    expect(run).toMatchObject({ retried: true, outcome: { kind: "done", replayed: true } });
    expect(s.revision).toBe(4);
    expect(Object.keys(run.pendings)).toEqual([pendingKey("register", S1)]);
    run = await runWrite(P, run.pendings, reg(S1, 4), fetcher, newId);
    expect(run.outcome).toEqual({ kind: "done", replayed: true });
    expect(s.versions.get(S1)).toHaveLength(1);
  });
  it("결과 모름(503)이 이어지면 기록을 그대로 두고 같은 번호를 쓴다(자동 재전송 없음: 부를 때만 보냄)", async () => {
    const calls: string[] = [];
    const down = async (_input: string, init: RequestInit) => { calls.push(String(init.body)); return { status: 503, json: async () => ({ code: "SCENE_RESULT_UNAVAILABLE" }) }; };
    let run = await runWrite(P, {}, reg(S1, 3), down, newId);
    expect(calls).toHaveLength(1);
    run = await runWrite(P, run.pendings, reg(S1, 3), down, newId);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
    expect(Object.keys(run.pendings)).toEqual([pendingKey("register", S1)]);
  });
  it("409 갱신·기존 오류: CONFLICT·ASSET_NOT_READY·STAGE_LOCKED·REQUEST_REUSED·404는 기록을 지우고, 안내는 코드별로(401·403은 RECOVERY-AUTH에서 유지)", async () => {
    const { writeMessage } = await import("@/components/cloud/managed-scene-panel");
    for (const [status, code, kind] of [[409, "CONFLICT", "conflict"], [409, "ASSET_NOT_READY", "conflict"], [409, "STAGE_LOCKED", "conflict"], [409, "REQUEST_REUSED", "reused"],
      [404, "NOT_FOUND", "missing"]] as const) {
      const pendings: PendingWrites = { [pendingKey("register", S1)]: { kind: "register", sceneId: S1, requestId: newId(), content: registerContent(3, S1, A), target: A, label: "자료" } };
      const run = await runWrite(P, pendings, reg(S1, 5), async () => ({ status, json: async () => ({ code }) }), newId);
      expect([code, run.outcome.kind, run.pendings]).toEqual([code, kind, {}]);
      const message = writeMessage(run.outcome, run.sent, 1);
      expect([code, message?.reloadChoices ?? false]).toEqual([code, code === "ASSET_NOT_READY"]);
    }
    const lost = writeMessage({ kind: "unknown" }, { kind: "register", label: "자료" }, 2);
    expect(lost?.body).toContain("자동으로 다시 보내지 않아요");
    expect(lost?.body).toContain("장면 2의 ‘같은 요청으로 다시 확인’");
  });
  it("제작 닫힘의 쓰기 가림: 기획 승인 + 장면 제작 시작 전·진행 중일 때만 쓰기", () => {
    const gate = (plan: string, produce: string, approvedPlanId: string | null = PLAN) => writeGate({ approvedPlanId, stages: { plan: plan as never, produce: produce as never } });
    expect(["todo", "in_progress", "needs_approval", "approved", "locked", "failed"].map(produce => gate("approved", produce))).toEqual([true, true, false, false, false, false]);
    expect(gate("todo", "todo")).toBe(false);
    expect(gate("approved", "todo", null)).toBe(false);
  });
});

// RECOVERY(Master msg_bf8c231669b1): 새로고침 뒤에도 결과 모름 작업을 같은 요청 번호로 다시 확인한다. 저장은 계정·프로젝트 범위 해시 키의 탭 저장소.
function memoryStorage() {
  const map = new Map<string, string>();
  const flags = { failSet: false, failGet: false };
  const storage = {
    getItem: (key: string) => { if (flags.failGet) throw new Error("blocked"); return map.has(key) ? map.get(key)! : null; },
    setItem: (key: string, value: string) => { if (flags.failSet) throw new Error("quota"); map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
  return { storage, map, flags };
}
const U_A = "01936b2e-8f3a-7c4d-8e5f-0000000000a1", U_B = "01936b2e-8f3a-7c4d-8e5f-0000000000b2", P2 = "01936b2e-8f3a-7c4d-8e5f-1a2b3c4d5e70";
const scopeOf = (userId: string, projectId: string) => createHash("sha256").update(`dream-scene-pending/v1\n${userId}\n${projectId}`).digest("hex");
const SA = scopeOf(U_A, P), SB = scopeOf(U_B, P);

describe("RECOVERY: 새로고침 뒤 같은 요청 번호로 다시 확인", () => {
  it("응답 유실 → 다른 장면 선택(개정 3→4) → 새로고침(새 화면이 저장소에서 읽음) → 다시 확인은 원래 번호로 replayed, 버전 1개, 기록 지움", async () => {
    const { s, fetcher } = fakeServer();
    const { storage, map } = memoryStorage();
    const persist = (next: PendingWrites) => { savePending(storage, SA, P, next); };
    s.lose = "after";
    let run = await runWrite(P, {}, reg(S2, 3), fetcher, newId, persist);
    savePending(storage, SA, P, run.pendings);
    const firstId = run.sent.requestId;
    run = await runWrite(P, run.pendings, sel(S1, 3, v(1).id, null), fetcher, newId, persist);
    savePending(storage, SA, P, run.pendings);
    expect(s.revision).toBe(4);
    // 새로고침: 메모리 상태는 사라지고 저장소만 남는다.
    const restored = loadPending(storage, SA, P);
    expect(restored.dropped).toBe(false);
    expect(restored.pendings[pendingKey("register", S2)]).toMatchObject({ requestId: firstId, label: restoredLabel.register });
    run = await runWrite(P, restored.pendings, reg(S2, 4), fetcher, newId, persist);
    savePending(storage, SA, P, run.pendings);
    expect(run).toMatchObject({ retried: true, outcome: { kind: "done", replayed: true } });
    expect(run.sent.requestId).toBe(firstId);
    expect(s.versions.get(S2)).toHaveLength(1);
    expect(map.size).toBe(0);
  });
  it("보내기 전에 보관한다: 서버가 요청을 받는 순간 이미 저장소에 같은 요청 번호가 있다(응답 전 새로고침 대비)", async () => {
    const { storage } = memoryStorage();
    const seen: string[] = [];
    const fetcher = async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { requestId: string };
      seen.push(loadPending(storage, SA, P).pendings[pendingKey("register", S1)]?.requestId === body.requestId ? "보관됨" : "없음");
      throw new TypeError("network");
    };
    await runWrite(P, {}, reg(S1, 3), fetcher, newId, next => { savePending(storage, SA, P, next); });
    expect(seen).toEqual(["보관됨"]);
  });
  it("계정·프로젝트 경계: B 계정·다른 프로젝트는 A 기록을 읽지 않고, B의 쓰기는 새 번호이며 A 기록을 건드리지 않는다", async () => {
    const { storage, map } = memoryStorage();
    const a = await runWrite(P, {}, reg(S1, 3), async () => { throw new TypeError("network"); }, newId, next => { savePending(storage, SA, P, next); });
    const rawA = map.get(pendingStorageKey(SA));
    expect(loadPending(storage, SB, P)).toEqual({ pendings: {}, dropped: false });
    expect(loadPending(storage, scopeOf(U_A, P2), P2)).toEqual({ pendings: {}, dropped: false });
    const b = await runWrite(P, loadPending(storage, SB, P).pendings, reg(S1, 3), async () => { throw new TypeError("network"); }, newId, next => { savePending(storage, SB, P, next); });
    expect(b.sent.requestId).not.toBe(a.sent.requestId);
    expect(map.get(pendingStorageKey(SA))).toBe(rawA);
    // 다시 A로 로그인하면 A 기록 그대로.
    expect(loadPending(storage, SA, P).pendings[pendingKey("register", S1)]?.requestId).toBe(a.sent.requestId);
    // A 기록을 다른 프로젝트 범위 키로 옮겨 놓아도 내용의 프로젝트가 달라 쓰지 않는다.
    map.set(pendingStorageKey(scopeOf(U_A, P2)), rawA!);
    expect(loadPending(storage, scopeOf(U_A, P2), P2)).toEqual({ pendings: {}, dropped: true });
    // 범위 값이 없거나 형식이 틀리면 읽지도 쓰지도 않는다(로그아웃·서버 그리기).
    expect(loadPending(storage, undefined, P)).toEqual({ pendings: {}, dropped: false });
    expect(savePending(storage, "u", P, a.pendings)).toBe(false);
    expect(savePending(null, SA, P, a.pendings)).toBe(false);
  });
  it("잘못된 기록은 쓰지 않는다: 깨진 글·다른 키·내용 장면 불일치·대상 불일치·기한 지남·미래 시각·중복 작업 → dropped, clearPending으로 지움", () => {
    const now = Date.UTC(2026, 10, 24);
    const good = { kind: "register", sceneId: S1, requestId: newId(), content: registerContent(3, S1, A), target: A, savedAt: now - 1000 };
    const cases: unknown[] = [
      "{깨짐",
      { v: 1, projectId: P, writes: [good], extra: 1 },
      { v: 2, projectId: P, writes: [good] },
      { v: 1, projectId: P, writes: [{ ...good, content: registerContent(3, S2, A) }] },
      { v: 1, projectId: P, writes: [{ ...good, target: v(1).id }] },
      { v: 1, projectId: P, writes: [{ ...good, savedAt: now - PENDING_MAX_AGE_MS - 1 }] },
      { v: 1, projectId: P, writes: [{ ...good, savedAt: now + 60_000 }] },
      { v: 1, projectId: P, writes: [good, { ...good, requestId: newId() }] },
      { v: 1, projectId: P, writes: [{ ...good, label: "이름" }] },
      { v: 1, projectId: P, writes: [{ ...good, content: JSON.stringify({ revision: 3, sceneId: S1, assetId: A, owner: "x" }) }] },
    ];
    for (const value of cases) {
      const { storage, map } = memoryStorage();
      map.set(pendingStorageKey(SA), typeof value === "string" ? value : JSON.stringify(value));
      expect(loadPending(storage, SA, P, now)).toEqual({ pendings: {}, dropped: true });
      expect(map.size).toBe(1); // 읽기는 저장소를 바꾸지 않는다
      clearPending(storage, SA);
      expect(map.size).toBe(0);
    }
    const { storage, map } = memoryStorage();
    map.set(pendingStorageKey(SA), JSON.stringify({ v: 1, projectId: P, writes: [good] }));
    expect(loadPending(storage, SA, P, now).pendings[pendingKey("register", S1)]?.requestId).toBe(good.requestId);
  });
  it("저장 내용은 최소: 계정 번호·이메일·자료 이름 없이 작업 정보와 보관 시각만, 처음 보관 시각은 다시 저장해도 유지", () => {
    const { storage, map } = memoryStorage();
    const first: PendingWrites = { [pendingKey("register", S1)]: { kind: "register", sceneId: S1, requestId: newId(), content: registerContent(3, S1, A), target: A, label: "내 비밀 제목.png" } };
    expect(savePending(storage, SA, P, first, 1000)).toBe(true);
    const second: PendingWrites = { ...first, [pendingKey("select", S2)]: { kind: "select", sceneId: S2, requestId: newId(), content: selectContent(4, S2, v(1).id, null), target: v(1).id, label: "결과 v1" } };
    expect(savePending(storage, SA, P, second, 5000)).toBe(true);
    const raw = map.get(pendingStorageKey(SA))!;
    expect(raw).not.toMatch(/내 비밀 제목|결과 v1|example\.invalid|0000000000a1/);
    const parsed = JSON.parse(raw) as { writes: Array<Record<string, unknown>> };
    expect(Object.keys(parsed).sort()).toEqual(["projectId", "v", "writes"]);
    expect(parsed.writes.map(write => Object.keys(write).sort().join(","))).toEqual(Array(2).fill("content,kind,requestId,savedAt,sceneId,target"));
    expect(parsed.writes.map(write => write.savedAt)).toEqual([1000, 5000]);
    expect(savePending(storage, SA, P, {}, 6000)).toBe(true);
    expect(map.size).toBe(0);
  });
  it("저장소 쓰기 실패: 보관은 false지만 요청은 그대로 보내고 메모리 기록으로 다시 확인할 수 있다. 안내는 새로고침하면 사라진다고 알린다", async () => {
    const { writeMessage } = await import("@/components/cloud/managed-scene-panel");
    const { storage, flags } = memoryStorage();
    flags.failSet = true;
    let kept = true;
    const { s, fetcher } = fakeServer();
    s.lose = "after";
    const run = await runWrite(P, {}, reg(S1, 3), fetcher, newId, next => { kept = savePending(storage, SA, P, next); });
    expect([kept, run.outcome.kind, s.calls]).toEqual([false, "unknown", 1]);
    const again = await runWrite(P, run.pendings, reg(S1, 3), fetcher, newId);
    expect(again.outcome).toEqual({ kind: "done", replayed: true });
    expect(writeMessage({ kind: "unknown" }, run.sent, 1, false)?.body).toContain("새로고침하거나 탭을 닫으면 확인 기록이 사라져요");
    expect(writeMessage({ kind: "unknown" }, run.sent, 1, true)?.body).toContain("이 탭에서 새로고침해도 확인 기록이 남아요");
    flags.failSet = false; flags.failGet = true;
    expect(loadPending(storage, SA, P)).toEqual({ pendings: {}, dropped: false });
  });
  it("페이지: 확인된 계정 번호와 프로젝트로 만든 범위 해시만 화면에 넘기고(원문 없음), 계정·프로젝트마다 다르다", async () => {
    process.env.DREAM_SCENE_READ_BACKEND = "supabase-postgres";
    const find = (node: unknown): Record<string, unknown> | undefined => {
      if (!isValidElement(node)) return Array.isArray(node) ? node.map(find).find(Boolean) : undefined;
      const props = node.props as Record<string, unknown>;
      return "pendingScope" in props ? props : find(props.children);
    };
    const scopeFor = async (userId: string, id: string) => {
      state.auth = { kind: "verified", userId, email: "a@example.invalid" };
      return find(await (await import("@/app/(cloud)/cloud/projects/[id]/scenes/page")).default({ params: Promise.resolve({ id }) }));
    };
    const a = await scopeFor(U_A, P.toUpperCase());
    expect(a).toMatchObject({ projectId: P, pendingScope: SA });
    expect(JSON.stringify(a)).not.toMatch(/0000000000a1|example\.invalid/);
    expect((await scopeFor(U_B, P))?.pendingScope).toBe(SB);
    expect((await scopeFor(U_A, P2))?.pendingScope).toBe(scopeOf(U_A, P2));
    expect(new Set([SA, SB, scopeOf(U_A, P2)]).size).toBe(3);
  });
});

// RECOVERY-AUTH(Master msg_a553466e6f63, 독립 검수 4bd06aa6 Q3): 401·403은 결과를 확정하지 못한 것으로 보고 기록을 유지한다.
// 시험용 서버에 세션 상태를 더한다: expired면 401, forbidden이면 403 AUTH_FORBIDDEN(둘 다 처리 전 거절).
function authServer() {
  const inner = fakeServer();
  const auth = { state: "ok" as "ok" | "expired" | "forbidden" | "origin" };
  const fetcher = async (input: string, init: RequestInit) => {
    if (auth.state === "expired") { inner.s.calls++; return { status: 401, json: async () => ({ code: "AUTH_REQUIRED" }) }; }
    if (auth.state === "forbidden") { inner.s.calls++; return { status: 403, json: async () => ({ code: "AUTH_FORBIDDEN" }) }; }
    if (auth.state === "origin") { inner.s.calls++; return { status: 403, json: async () => ({ code: "AUTH_ORIGIN_REJECTED" }) }; }
    return inner.fetcher(input, init);
  };
  return { s: inner.s, auth, fetcher };
}

describe("RECOVERY-AUTH: 세션 만료·접근 거절이면 기록을 유지하고 다시 로그인한 같은 계정에서만 원래 요청을 확인", () => {
  it("검수 Q3 재연: 응답 유실(처리됨) → 세션 만료 상태에서 다시 확인 401 → 기록 유지(저장소 포함) → 같은 계정 재로그인·새로고침 → 원래 번호 replayed, 버전 1개", async () => {
    const { s, auth, fetcher } = authServer();
    const { storage, map } = memoryStorage();
    const persist = (next: PendingWrites) => { savePending(storage, SA, P, next); };
    s.lose = "after";
    let run = await runWrite(P, {}, reg(S2, 3), fetcher, newId, persist);
    savePending(storage, SA, P, run.pendings);
    const firstId = run.sent.requestId;
    auth.state = "expired";
    run = await runWrite(P, run.pendings, reg(S2, 3), fetcher, newId, persist);
    savePending(storage, SA, P, run.pendings);
    expect(run).toMatchObject({ outcome: { kind: "login" }, held: true, retried: true });
    expect(run.sent.requestId).toBe(firstId);
    expect(run.pendings[pendingKey("register", S2)]?.requestId).toBe(firstId);
    expect(map.size).toBe(1);
    // 다시 로그인(같은 계정) → 새 화면이 저장소에서 읽음
    auth.state = "ok";
    const restored = loadPending(storage, SA, P);
    expect(restored.pendings[pendingKey("register", S2)]?.requestId).toBe(firstId);
    run = await runWrite(P, restored.pendings, reg(S2, 3), fetcher, newId, persist);
    savePending(storage, SA, P, run.pendings);
    expect(run).toMatchObject({ outcome: { kind: "done", replayed: true }, held: false });
    expect(run.sent.requestId).toBe(firstId);
    expect(s.versions.get(S2)).toHaveLength(1);
    expect(map.size).toBe(0);
  });
  it("403 계정 거절·출처 거절도 기록 유지, 다른 계정(B)은 기록을 못 보고 새 번호로만 쓰며 A 기록을 바꾸지 않는다. A로 돌아오면 원래 번호로 replayed", async () => {
    const { s, auth, fetcher } = authServer();
    const { storage, map } = memoryStorage();
    s.lose = "after";
    let run = await runWrite(P, {}, reg(S1, 3), fetcher, newId, next => { savePending(storage, SA, P, next); });
    const firstId = run.sent.requestId;
    for (const state of ["forbidden", "origin"] as const) {
      auth.state = state;
      run = await runWrite(P, loadPending(storage, SA, P).pendings, reg(S1, 3), fetcher, newId, next => { savePending(storage, SA, P, next); });
      savePending(storage, SA, P, run.pendings);
      expect([state, run.outcome.kind, run.held, run.sent.requestId]).toEqual([state, state === "forbidden" ? "forbidden" : "invalid", true, firstId]);
    }
    const rawA = map.get(pendingStorageKey(SA));
    auth.state = "ok";
    // B 계정: A 기록이 보이지 않고, B의 등록은 새 번호(서버 기준 다른 소유자라 별개)
    expect(loadPending(storage, SB, P)).toEqual({ pendings: {}, dropped: false });
    const b = await runWrite(P, loadPending(storage, SB, P).pendings, reg(S1, 3), async () => ({ status: 401, json: async () => ({ code: "AUTH_REQUIRED" }) }), newId,
      next => { savePending(storage, SB, P, next); });
    expect(b.sent.requestId).not.toBe(firstId);
    expect(map.get(pendingStorageKey(SA))).toBe(rawA);
    // A로 다시
    run = await runWrite(P, loadPending(storage, SA, P).pendings, reg(S1, 3), fetcher, newId, next => { savePending(storage, SA, P, next); });
    expect(run).toMatchObject({ outcome: { kind: "done", replayed: true } });
    expect(run.sent.requestId).toBe(firstId);
    expect(s.versions.get(S1)).toHaveLength(1);
  });
  it("처음 보낸 쓰기가 401이어도 기록을 남기고, 다시 로그인한 뒤 같은 번호로 한 번만 처리된다(자동 재전송 없음: 부를 때만 요청)", async () => {
    const { s, auth, fetcher } = authServer();
    auth.state = "expired";
    let run = await runWrite(P, {}, sel(S1, 3, v(1).id, null), fetcher, newId);
    expect([run.outcome.kind, run.held, s.calls]).toEqual(["login", true, 1]);
    await Promise.resolve();
    expect(s.calls).toBe(1);
    auth.state = "ok";
    const id = run.sent.requestId;
    run = await runWrite(P, run.pendings, sel(S1, 3, v(1).id, null), fetcher, newId);
    expect(run).toMatchObject({ outcome: { kind: "done", replayed: false }, held: false, retried: true });
    expect(run.sent.requestId).toBe(id);
    expect(s.revision).toBe(4);
  });
  it("실제 결과의 확정·거절은 기존 규칙: 완료·409·404·400·413·415면 기록을 지운다", async () => {
    for (const [status, code] of [[200, "ok"], [409, "CONFLICT"], [409, "PLAN_NOT_APPROVED"], [404, "NOT_FOUND"], [400, "INVALID_BODY"], [413, "TOO_LARGE"], [415, "UNSUPPORTED"]] as const) {
      const pendings: PendingWrites = { [pendingKey("register", S1)]: { kind: "register", sceneId: S1, requestId: newId(), content: registerContent(3, S1, A), target: A, label: "자료" } };
      const body = status === 200 ? { projectId: P, sceneId: S1, assetId: A, versionId: v(1).id, version: 1, outcome: "replayed" } : { code };
      const run = await runWrite(P, pendings, reg(S1, 3), async () => ({ status, json: async () => body }), newId);
      expect([status, code, run.held, run.pendings]).toEqual([status, code, false, {}]);
    }
  });
  it("안내: 401·403 기록 유지 안내는 같은 계정 재로그인·원래 번호 확인을 말하고 로그인 링크를 붙인다. 저장소를 못 쓰면 사라질 수 있다고 알린다", async () => {
    const { writeMessage } = await import("@/components/cloud/managed-scene-panel");
    const sent = { kind: "register" as const, label: "자료" };
    const login = writeMessage({ kind: "login" }, sent, 2, true, true);
    expect(login).toMatchObject({ login: true, title: "장면 2: 로그인이 끝나 등록됐는지 확인하지 못했어요" });
    expect(login?.body).toContain("같은 계정으로 다시 로그인한 뒤 장면 2의 ‘같은 요청으로 다시 확인’");
    expect(login?.body).toContain("처음 요청 번호는 이 탭에 남겨 뒀어요");
    const forbidden = writeMessage({ kind: "forbidden" }, sent, 1, true, true);
    expect(forbidden?.body).toContain("다른 계정에서는 이 기록이 보이지 않아요");
    expect(writeMessage({ kind: "invalid", message: "같은 화면에서 다시 시도해 주세요." }, sent, 1, true, true)?.title).toBe("장면 1: 등록됐는지 확인하지 못했어요");
    expect(writeMessage({ kind: "login" }, sent, 1, false, true)?.body).toContain("저장소를 쓸 수 없어");
    // held가 아닌 경우(기존 안내 유지)
    expect(writeMessage({ kind: "login" }, sent, 1)?.title).toBe("다시 로그인해 주세요");
  });
  it("보관 정책은 그대로: 20개·7일", () => {
    expect([PENDING_MAX, PENDING_MAX_AGE_MS]).toEqual([20, 7 * 24 * 60 * 60 * 1000]);
  });
});
