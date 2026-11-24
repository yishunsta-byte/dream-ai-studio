import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId, type VerifiedActor } from "@/lib/db/postgres/types";
import { postgresProjectCreate, isProjectCreateError, preparePostgresProjectCreate } from "@/lib/services/postgres/project-create";
import type { ActorTransaction } from "@/lib/db/postgres/types";
import { parseMenuConfig } from "@/lib/menus/parse";
import { snapshotForMenu, type menuSnapshotSchema } from "@/lib/menus/snapshot";
import type { z } from "zod";
vi.mock("server-only", () => ({}));
let snapshot: z.infer<typeof menuSnapshotSchema>;
let topicSnapshot: z.infer<typeof menuSnapshotSchema>;
const actor = actorFromVerifiedUserId("00000000-0000-4000-8000-000000000001");
beforeAll(async () => {
  const result = parseMenuConfig(await readFile(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
  if (!result.ok) throw new Error("Synthetic menu config invalid");
  snapshot = snapshotForMenu(result.config, result.config.menus.find(m => m.id === "shopping-shorts")!);
  topicSnapshot = snapshotForMenu(result.config, result.config.menus.find(m => m.id === "topic-shorts")!);
});
describe("B12 creation rejects invalid request before any connection", () => {
  it.each([null, "owner@email.invalid", { id: actor.id }])("requires branded verified actor (%j)", async value => {
    const pool = { connect: vi.fn() };
    await expect(postgresProjectCreate(pool, { assetAvailable: () => true }).create(value as VerifiedActor, "shopping-shorts", {}, snapshot)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each([{ title: "" }, { title: "ok", owner: actor.id }, { apiKey: "never-store" }, null])("validates inputs with existing rules (%j)", async input => {
    const pool = { connect: vi.fn() };
    try { await postgresProjectCreate(pool, { assetAvailable: () => true }).create(actor, "shopping-shorts", input, snapshot); throw new Error("Expected validation error"); }
    catch (e) { expect(isProjectCreateError(e)).toBe(true); expect(e).toMatchObject({ code: "INVALID_INPUT", status: 400 }); }
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("rejects menu mismatch/inactive menu and invalid server snapshot", async () => {
    const pool = { connect: vi.fn() }, service = postgresProjectCreate(pool, { assetAvailable: () => true });
    await expect(service.create(actor, "other", {}, snapshot)).rejects.toMatchObject({ code: "STAGE_LOCKED", status: 409 });
    await expect(service.create(actor, "shopping-shorts", {}, { ...snapshot, menu: { ...snapshot.menu, availability: "skeleton" } })).rejects.toMatchObject({ code: "STAGE_LOCKED" });
    await expect(service.create(actor, "shopping-shorts", {}, {})).rejects.toMatchObject({ code: "PROJECT_CREATE_UNAVAILABLE", status: 503 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("does not accept caller-forged domain errors", () => {
    expect(isProjectCreateError(Object.assign(new Error("private driver detail"), { code: "INVALID_INPUT", status: 400 }))).toBe(false);
  });
});

describe("주제별 쇼츠 생성 입력", () => {
  const common = { title: "주제 쇼츠", goal: "목표", target: "대상", aspect: "9:16", lengthSec: 30 };
  const valid = { ...common, topic: "겨울철 실내 습도", keyMessage: "습도 40~60%를 지키면 감기 예방에 도움이 된다." };
  const invalid = (menuId: string, snap: unknown, input: unknown) => {
    try { preparePostgresProjectCreate(actor, menuId, input, snap, () => true); }
    catch (e) { expect(isProjectCreateError(e)).toBe(true); return (e as { code: string; errors?: Record<string, string> }); }
    throw new Error("Expected validation error");
  };
  it("메뉴 스냅샷에 길이 선택지를 그대로 담는다", () => {
    expect(topicSnapshot.menu.lengthOptions).toEqual([10, 20, 30, 40, 50, 60]);
    expect(snapshot.menu.lengthOptions).toBeUndefined();
  });
  it.each([
    ["주제 없음", { ...valid, topic: "" }, "topic"],
    ["주제 81자", { ...valid, topic: "가".repeat(81) }, "topic"],
    ["핵심 메시지 없음", { ...valid, keyMessage: undefined }, "keyMessage"],
    ["기본 100자 초과", { ...valid, keyMessage: "나".repeat(101) }, "keyMessage"],
    ["50자 선택에 51자", { ...valid, keyMessageLength: "50", keyMessage: "나".repeat(51) }, "keyMessage"],
    ["200자 선택에 201자", { ...valid, keyMessageLength: "200", keyMessage: "나".repeat(201) }, "keyMessage"],
    ["300자 선택에 301자", { ...valid, keyMessageLength: "300", keyMessage: "나".repeat(301) }, "keyMessage"],
    ["선택지 밖 글자 수 75", { ...valid, keyMessageLength: "75" }, "keyMessageLength"],
    ["선택지 밖 글자 수 400", { ...valid, keyMessageLength: "400", keyMessage: "나".repeat(350) }, "keyMessageLength"],
    ["숫자형 글자 수", { ...valid, keyMessageLength: 100 }, "keyMessageLength"],
    ["사실 출처(뺀 항목)", { ...valid, factSources: "출처" }, "_form"],
    ["목록 밖 길이 45초", { ...valid, lengthSec: 45 }, "lengthSec"],
    ["목록 밖 길이 120초", { ...valid, lengthSec: 120 }, "lengthSec"],
    ["대상 없음", { ...valid, target: "" }, "target"],
    ["쇼핑 전용 항목", { ...valid, productName: "상품" }, "_form"],
    ["자료 형식", { ...valid, referenceAssets: ["not-a-uuid"] }, "referenceAssets"],
  ])("%s는 저장 전에 거부한다", (_label, input, field) => {
    const error = invalid("topic-shorts", topicSnapshot, input);
    expect(error).toMatchObject({ code: "INVALID_INPUT" });
    expect(Object.keys(error.errors ?? {})).toContain(field);
  });
  it.each([
    [10, undefined, 100], [20, "50", 50], [30, "100", 100], [40, "200", 200], [50, "300", 300], [60, "", 100],
  ] as const)("길이 %i초·글자 수 %j에서 상한(%i자)에 닿은 메시지와 주제 80자는 자료 없이 저장한다", async (lengthSec, keyMessageLength, limit) => {
    const queries: { sql: string; values: unknown[] }[] = [];
    const tx = { actorId: actor.id, query: vi.fn(async (sql: string, values: unknown[] = []) => { queries.push({ sql, values }); return { rows: [], rowCount: 1 }; }) };
    const assetAvailable = vi.fn(() => true);
    const input = { ...valid, topic: "가".repeat(80), keyMessage: ` ${"나".repeat(limit)} `, lengthSec, ...(keyMessageLength !== undefined && { keyMessageLength }) };
    const insert = preparePostgresProjectCreate(actor, "topic-shorts", input, topicSnapshot, assetAvailable);
    await insert(tx as unknown as ActorTransaction);
    const project = queries.find(q => q.sql.includes("INSERT INTO dream.projects"))!;
    expect(project.values[2]).toBe("topic-shorts");
    expect(project.values[10]).toBe(lengthSec);
    // 잘라서 저장하지 않는다: 앞뒤 공백만 기존 규칙대로 지우고 미지정·빈 값은 기본 100자를 저장한다.
    expect(JSON.parse(project.values[5] as string)).toEqual({ ...common, lengthSec, isAd: false, realisticAi: false, virtualHumanEndorsement: false, usesMusic: false, topic: "가".repeat(80), keyMessage: "나".repeat(limit),
      keyMessageLength: String(limit), referenceAssets: [] });
    expect(JSON.parse(project.values[4] as string).menu.lengthOptions).toEqual([10, 20, 30, 40, 50, 60]);
    expect(queries.some(q => q.sql.includes("dream.project_assets"))).toBe(false);
    expect(assetAvailable).not.toHaveBeenCalled();
  });
  it("쇼핑숏츠의 상품 자료·권리 요구, 사실 출처 입력과 공통 길이 범위는 그대로다", () => {
    const shopping = { ...common, productName: "상품", facts: "확인된 장점", usageRights: "직접 촬영" };
    expect(Object.keys(invalid("shopping-shorts", snapshot, shopping).errors ?? {})).toContain("productAssets");
    expect(Object.keys(invalid("shopping-shorts", snapshot, { ...shopping, usageRights: undefined, productAssets: ["00000000-0000-7000-8000-000000000001"] }).errors ?? {})).toContain("usageRights");
    // 목록이 없는 쇼핑숏츠는 45초·7200초도 기존처럼 허용한다(자료 확인 전 단계까지 통과).
    for (const lengthSec of [45, 7200]) {
      expect(typeof preparePostgresProjectCreate(actor, "shopping-shorts", { ...shopping, lengthSec, productAssets: ["00000000-0000-7000-8000-000000000001"] }, snapshot, () => true)).toBe("function");
    }
    const kept = preparePostgresProjectCreate(actor, "shopping-shorts", { ...shopping, factSources: "제조사 자료", productAssets: ["00000000-0000-7000-8000-000000000001"] }, snapshot, () => true);
    expect(typeof kept).toBe("function");
    expect(Object.keys(invalid("shopping-shorts", snapshot, { ...shopping, keyMessageLength: "100", productAssets: ["00000000-0000-7000-8000-000000000001"] }).errors ?? {})).toContain("_form");
    expect(Object.keys(invalid("shopping-shorts", snapshot, { ...shopping, lengthSec: 7201, productAssets: ["00000000-0000-7000-8000-000000000001"] }).errors ?? {})).toContain("lengthSec");
  });
  it("스냅샷과 다른 메뉴 ID는 잠긴 분야로 거부한다", () => {
    expect(invalid("shopping-shorts", topicSnapshot, valid)).toMatchObject({ code: "STAGE_LOCKED" });
  });
});
