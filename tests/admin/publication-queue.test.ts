import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  allowedCommands, applyOutcome, buildAction, isPublicationItem, isPublicationOutcome, outcomeNotice, stageOf,
  type PublicationItem, type PublicationList,
} from "@/components/admin/publication-model";
import { CLOSED_PUBLICATION_PROVIDER, createMemoryPublicationProvider, type MemorySeed } from "@/components/admin/publication-provider";
import { PublicationQueue } from "@/components/admin/publication-queue";

// T289 관리자 완성본 검수·게시·철회 큐. 격리 주입 메모리 공급자 시험이며 실제 DB·Supabase·Storage로 실행한 것이 아니다.
// 기대값 근거: Master msg_173852d57289 + T253 apply_command 규칙(게시자 허용, 소유자 범위, 요청 UUID 원장·지문, 기대 버전·세대, 원본 완결).
const ME = "10000000-0000-4000-8000-000000000289";
const OTHER = "20000000-0000-4000-8000-000000000289";
const seed = (slug: string, owner = ME, extra: Partial<MemorySeed> = {}): MemorySeed =>
  ({ slug, owner, title: `합성 ${slug}`, kind: "image", rights: "confirmed", source: { revision: 3, finished: true }, ...extra });
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
async function items(provider: { list(): Promise<PublicationList> }) {
  const list = await provider.list();
  if (list.kind !== "ok") throw new Error("expected ok");
  return list.items;
}
const one = async (provider: { list(): Promise<PublicationList> }, slug: string) => (await items(provider)).find((item) => item.slug === slug)!;

describe("T289 상태·명령 판정", () => {
  it("단계: 검수 대기 → 준비 → 게시 중 → 새 세대 준비, 게시·준비가 없으면 version과 무관하게 검수 대기", () => {
    const base: PublicationItem = { slug: "a", title: "t", kind: "image", version: "0", pendingGeneration: null, activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" };
    expect(stageOf(base)).toBe("candidate");
    expect(stageOf({ ...base, version: "1", pendingGeneration: "1" })).toBe("prepared");
    expect(stageOf({ ...base, version: "2", activeGeneration: "1", approvedMs: "1" })).toBe("published");
    expect(stageOf({ ...base, version: "3", activeGeneration: "1", approvedMs: "1", pendingGeneration: "3" })).toBe("republishing");
    expect(stageOf({ ...base, version: "3" })).toBe("candidate");
  });
  it("권리 확인 체크 없이는 준비·게시를 만들지 않고, 권리 미확인·미완성 원본은 체크해도 막는다. 철회는 권리와 무관", () => {
    const item: PublicationItem = { slug: "a", title: "t", kind: "image", version: "1", pendingGeneration: "1", activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" };
    expect(allowedCommands(item, false)).toEqual(["revoke"]);
    expect(allowedCommands(item, true)).toEqual(["complete", "revoke"]);
    expect(allowedCommands({ ...item, rights: "unconfirmed" }, true)).toEqual(["revoke"]);
    expect(allowedCommands({ ...item, source: { revision: "1", finished: false } }, true)).toEqual(["revoke"]);
    expect(buildAction(item, "complete", "r", false)).toBeNull();
    expect(buildAction(item, "complete", "r", true)).toEqual({ requestId: "r", command: "complete", slug: "a", expectedVersion: "1", generation: "1", rightsConfirmed: true });
    expect(buildAction(item, "revoke", "r", true)).toMatchObject({ generation: "1", rightsConfirmed: false });
  });
  it("결과가 요청과 다르면(다른 세대·뒤로 간 버전·다른 명령) 반영하지 않는다", () => {
    const item: PublicationItem = { slug: "a", title: "t", kind: "image", version: "1", pendingGeneration: "1", activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" };
    const action = buildAction(item, "complete", "r", true)!;
    expect(applyOutcome(item, action, { status: "published", version: "2", generation: "9" }, 5)).toBeNull();
    expect(applyOutcome(item, action, { status: "published", version: "1", generation: "1" }, 5)).toBeNull();
    expect(applyOutcome(item, action, { status: "revoked", version: "2", generation: "1" }, 5)).toBeNull();
    expect(applyOutcome(item, action, { status: "published", version: "2", generation: "1" }, 5)).toMatchObject({ version: "2", activeGeneration: "1", pendingGeneration: null, approvedMs: "5" });
  });
  it("목록·결과 형식 검사: 비공개 키·잘못된 숫자·예약 slug·추가 키를 받지 않는다", () => {
    const good = { slug: "a-1", title: "t", kind: "video", version: "2", pendingGeneration: null, activeGeneration: "1", approvedMs: "10", source: { revision: "1", finished: true }, rights: "confirmed" };
    expect(isPublicationItem(good)).toBe(true);
    for (const bad of [{ ...good, slug: "signed" }, { ...good, version: "01" }, { ...good, activeGeneration: "3" }, { ...good, approvedMs: null }, { ...good, rights: "maybe" }, { ...good, kind: "doc" }])
      expect(isPublicationItem(bad), JSON.stringify(bad)).toBe(false);
    expect(isPublicationOutcome({ status: "conflict" })).toBe(true);
    expect(isPublicationOutcome({ status: "conflict", detail: "x" })).toBe(false);
    expect(isPublicationOutcome({ status: "published", version: 2, generation: "1" })).toBe(false);
  });
  it("결과 안내: 충돌·원본·잘못된 요청은 다시 불러오기, 처리 못 함만 같은 요청 재시도", () => {
    const item: PublicationItem = { slug: "a", title: "t", kind: "image", version: "3", pendingGeneration: "3", activeGeneration: "2", approvedMs: "5", source: { revision: "1", finished: true }, rights: "confirmed" };
    expect(outcomeNotice(item, "complete", { status: "conflict" })).toMatchObject({ reload: true, retry: false });
    expect(outcomeNotice(item, "prepare", { status: "source-unavailable" })).toMatchObject({ reload: true, retry: false });
    expect(outcomeNotice(item, "revoke", { status: "denied" })).toMatchObject({ tone: "danger", reload: false, retry: false });
    expect(outcomeNotice(item, "complete", { status: "unavailable" })).toMatchObject({ reload: false, retry: true });
    expect(outcomeNotice(item, "revoke", { status: "unavailable" })).toMatchObject({ text: expect.stringContaining("게시 준비 취소"), retry: true });
  });

  it("준비를 취소하면 기존 공개를 유지하고, 공개 세대를 철회하면 해당 세대를 내렸다고 안내한다", () => {
    const live: PublicationItem = { slug: "a", title: "t", kind: "image", version: "3", pendingGeneration: null, activeGeneration: "2", approvedMs: "5", source: { revision: "1", finished: true }, rights: "confirmed" };
    const pending = { ...live, pendingGeneration: "3" };
    const cancelled = { status: "revoked", version: "4", generation: "3" } as const;
    const withdrawn = { ...cancelled, generation: "2" };
    expect(buildAction(pending, "revoke", "r", false)?.generation).toBe("3");
    expect(applyOutcome(pending, buildAction(pending, "revoke", "r", false)!, cancelled, 10)).toMatchObject({ activeGeneration: "2", pendingGeneration: null });
    expect(outcomeNotice(pending, "revoke", cancelled).text).toBe("세대 3의 게시 준비를 취소했어요. 게시 중인 2번 세대는 계속 공개돼요.");
    expect(applyOutcome(live, buildAction(live, "revoke", "r", false)!, withdrawn, 10)).toMatchObject({ activeGeneration: null });
    expect(outcomeNotice(live, "revoke", withdrawn).text).toBe("세대 2의 공개를 철회했어요. 공개 목록과 해당 세대의 표지 주소에서 내려갔어요.");
  });
});

describe("T289 격리 주입 공급자로 조회→검수→게시→철회", () => {
  it("정상 흐름: 준비(세대1) → 게시 → 새 세대 준비(3) → 새 세대 게시 → 철회, 화면 반영이 공급자 목록과 같다", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [seed("first")], now: () => 1000 });
    let item = await one(memory.provider, "first");
    for (const command of ["prepare", "complete", "prepare", "complete", "revoke"] as const) {
      const action = buildAction(item, command, id(), true)!;
      expect(action, command).not.toBeNull();
      const outcome = await memory.provider.apply(action);
      const next = applyOutcome(item, action, outcome, 1000);
      expect(next, `${command} ${JSON.stringify(outcome)}`).not.toBeNull();
      expect(next).toEqual(await one(memory.provider, "first"));
      item = next!;
    }
    expect(item).toMatchObject({ version: "5", activeGeneration: null, pendingGeneration: null, approvedMs: null });
    expect(stageOf(item)).toBe("candidate");
  });
  it("중복: 같은 요청 UUID 재전송은 당시 결과를 그대로 돌려주고 상태를 두 번 바꾸지 않는다. 같은 UUID에 다른 내용은 invalid", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [seed("dup")] });
    const item = await one(memory.provider, "dup");
    const action = buildAction(item, "prepare", id(), true)!;
    const first = await memory.provider.apply(action);
    expect(await memory.provider.apply(action)).toEqual(first);
    expect((await one(memory.provider, "dup")).version).toBe("1");
    expect(await memory.provider.apply({ ...action, expectedVersion: "1" })).toEqual({ status: "invalid" });
  });
  it("충돌: 다른 곳에서 바뀐 뒤의 늦은 요청, 이미 준비된 항목에 다시 준비, 지난 세대 게시·철회는 conflict", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [seed("race")] });
    const stale = await one(memory.provider, "race");
    await memory.provider.apply(buildAction(stale, "prepare", id(), true)!);
    expect(await memory.provider.apply(buildAction(stale, "prepare", id(), true)!)).toEqual({ status: "conflict" });
    const prepared = await one(memory.provider, "race");
    await memory.provider.apply(buildAction(prepared, "revoke", id(), false)!);
    expect(await memory.provider.apply(buildAction(prepared, "complete", id(), true)!)).toEqual({ status: "conflict" });
    expect(await memory.provider.apply(buildAction(prepared, "revoke", id(), false)!)).toEqual({ status: "conflict" });
  });
  it("원본이 준비 뒤 바뀌거나 미완성이 되면 게시는 source-unavailable", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [seed("src")] });
    await memory.provider.apply(buildAction(await one(memory.provider, "src"), "prepare", id(), true)!);
    memory.changeSource("src", { revision: 4, finished: true });
    const prepared = await one(memory.provider, "src");
    expect(await memory.provider.apply(buildAction(prepared, "complete", id(), true)!)).toEqual({ status: "source-unavailable" });
  });
  it("타계정: 목록에 다른 소유자 행이 없고, 그 slug로 직접 요청해도 denied. 게시자 허용 밖 계정은 자기 행도 denied", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [seed("mine"), seed("theirs", OTHER)] });
    expect((await items(memory.provider)).map((item) => item.slug)).toEqual(["mine"]);
    const forged = { requestId: id(), command: "prepare" as const, slug: "theirs", expectedVersion: "0", generation: null, rightsConfirmed: true };
    expect(await memory.provider.apply(forged)).toEqual({ status: "denied" });
    const outsider = createMemoryPublicationProvider({ actor: ME, publishers: [], seeds: [seed("mine")] });
    expect(await outsider.provider.apply(buildAction(await one(outsider.provider, "mine"), "prepare", id(), true)!)).toEqual({ status: "denied" });
  });
  it("비정상 전이: 권리 확인 없는 준비 요청, 준비 없는 게시, 세대 범위 밖 철회는 invalid/conflict로 상태를 바꾸지 않는다", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [seed("odd")] });
    expect(await memory.provider.apply({ requestId: id(), command: "prepare", slug: "odd", expectedVersion: "0", generation: null, rightsConfirmed: false })).toEqual({ status: "invalid" });
    expect(await memory.provider.apply({ requestId: id(), command: "complete", slug: "odd", expectedVersion: "0", generation: null, rightsConfirmed: true })).toEqual({ status: "invalid" });
    expect(await memory.provider.apply({ requestId: id(), command: "revoke", slug: "odd", expectedVersion: "0", generation: "1", rightsConfirmed: false })).toEqual({ status: "invalid" });
    expect((await one(memory.provider, "odd")).version).toBe("0");
  });
  it("닫힌 공급자: 목록은 closed, 어떤 요청도 unavailable(실행 없음)", async () => {
    expect(await CLOSED_PUBLICATION_PROVIDER.list()).toEqual({ kind: "closed" });
    expect(await CLOSED_PUBLICATION_PROVIDER.apply({ requestId: id(), command: "revoke", slug: "a", expectedVersion: "1", generation: "1", rightsConfirmed: false })).toEqual({ status: "unavailable" });
  });
});

describe("T289 화면 첫 상태", () => {
  const render = (initial: PublicationList, source: "server" | "synthetic" = "server") =>
    renderToStaticMarkup(createElement(PublicationQueue, { source, initial, load: async () => initial, apply: async () => ({ status: "unavailable" as const }), newRequestId: () => "x" }));
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const item: PublicationItem = { slug: "neon-1", title: "합성 네온", kind: "image", version: "2", pendingGeneration: null, activeGeneration: "1", approvedMs: "1000", source: { revision: "3", finished: true }, rights: "confirmed" };
  it("미연결(닫힘): 미연결 안내만, 버튼·체크 없음", () => {
    const html = render({ kind: "closed" });
    expect(text(html)).toContain("게시 서버 미연결");
    expect(html).not.toMatch(/<button|<input/);
  });
  it("실패·형식 오류·중복 slug는 목록을 그리지 않고 실패 안내", () => {
    expect(text(render({ kind: "failed" }))).toContain("게시 목록을 불러오지 못했어요");
    expect(text(render({ kind: "ok", items: [{ ...item, version: "x" }] }))).toContain("게시 목록을 불러오지 못했어요");
    expect(text(render({ kind: "ok", items: [item, item] }))).toContain("게시 목록을 불러오지 못했어요");
    expect(text(render({ kind: "ok", items: [] }))).toContain("검수할 완성본이 없어요");
  });
  it("게시 중 항목: 상태·대상 리비전·세대·권리, 권리 체크 전에는 철회만 누를 수 있다", () => {
    const html = render({ kind: "ok", items: [item] });
    const t = text(html);
    for (const part of ["게시 중", "대상 리비전 v2", "게시 중 세대 1", "준비된 세대 없음", "원본 리비전 3 · 완성본", "권리 증빙 확인됨"]) expect(t).toContain(part);
    expect(html).toMatch(/type="checkbox"/);
    expect(t).toContain("공개 철회…");
    expect(t).toContain("권리를 확인하면 새 세대를 게시 준비할 수 있어요");
    // 권리 체크 전에는 준비 버튼이 없다(체크박스 문구의 "게시 준비"는 버튼이 아님)
    expect(html).not.toMatch(/<button[^>]*>[^<]*게시 준비/);
    expect(t).not.toContain("합성 시험 데이터");
  });
  it("합성 데이터는 큐 머리와 줄마다 합성 표시(운영 작품처럼 보이지 않음)", () => {
    const t = text(render({ kind: "ok", items: [item] }, "synthetic"));
    expect(t).toContain("합성 시험 데이터예요");
    expect(t).toContain("합성 네온 합성");
  });
  it("준비된 항목은 권리를 다시 확인해야 게시할 수 있다고 안내", () => {
    const t = text(render({ kind: "ok", items: [{ ...item, version: "3", pendingGeneration: "3" }] }));
    expect(t).toContain("권리를 다시 확인하면 세대 3을 게시할 수 있어요");
    expect(t).toContain("게시 준비 취소…");
    expect(t).not.toContain("공개 철회…");
  });
  it("권리 미확인 항목은 체크박스 없이 막힌 이유", () => {
    const html = render({ kind: "ok", items: [{ ...item, rights: "unconfirmed", activeGeneration: null, approvedMs: null, version: "0" }] });
    expect(text(html)).toContain("권리 증빙이 확인되지 않아 게시할 수 없어요");
    expect(html).not.toMatch(/type="checkbox"|<button[^>]*>[^<]*게시/);
  });
  it("경계: 화면 모듈은 서버 전용·DB·요청·저장 코드를 두지 않고, /admin에는 T297 HTTP 큐로만 연결한다", () => {
    for (const path of ["components/admin/publication-queue.tsx", "components/admin/publication-model.ts", "components/admin/publication-provider.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/server-only|from "pg"|supabase|fetch\(|localStorage|service_role|process\.env/i);
    }
    // T297: 실제 /admin은 서버 경계 목록 + 동일 출처 HTTP 공급자만 쓰고, 메모리(합성) 공급자는 쓰지 않는다.
    const page = readFileSync("app/admin/page.tsx", "utf8");
    expect(page).toContain("<PublicationHttpQueue initial={publications} />");
    expect(page).not.toMatch(/createMemoryPublicationProvider|publication-provider|synthetic/);
    expect(readFileSync("components/admin/admin-hub.tsx", "utf8")).not.toMatch(/publication/i);
  });
});
