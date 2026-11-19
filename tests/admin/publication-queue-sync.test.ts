import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAction, type PublicationItem } from "@/components/admin/publication-model";
import { createMemoryPublicationProvider } from "@/components/admin/publication-provider";
import { createSyncGate, rowsAfterList, type Row } from "@/components/admin/publication-queue";

// T289-F1(F289-1): 늦은 목록 응답이 성공한 작업·처리 미확정 재시도 상태를 덮지 않는다.
// 기대값 근거: T289-R 재현 — v0 목록 조회 보류 중 준비 성공(v1) 뒤 보류 응답이 화면을 v0으로 되돌림.
const ME = "10000000-0000-4000-8000-000000000289";
const base: PublicationItem = { slug: "neon", title: "합성", kind: "image", version: "0", pendingGeneration: null, activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" };
const row = (extra: Partial<Row>): Row => ({ rights: false, confirmRevoke: false, notice: null, retry: null, retryBase: null, stale: false, ...extra });

describe("T289-F1 조회·쓰기 순서 판정(createSyncGate)", () => {
  it("검수 재현 순서: 조회 시작 → 준비 쓰기 시작·성공 → 늦은 조회 응답은 버린다", () => {
    const gate = createSyncGate();
    const ticket = gate.beginLoad();
    const write = gate.beginWrite();
    expect(gate.endWrite(write)).toBe(true);
    expect(gate.accepts(ticket)).toBe(false);
  });
  it("쓰기 실패(처리 미확정)도 같다: 조회 뒤 시작된 쓰기가 있으면 그 조회는 반영하지 않는다", () => {
    const gate = createSyncGate();
    const ticket = gate.beginLoad();
    gate.endWrite(gate.beginWrite());
    expect(gate.accepts(ticket)).toBe(false);
  });
  it("쓰기가 진행 중일 때 시작한 조회도, 끝난 뒤 받더라도 쓰기가 끝나기 전 상태일 수 있어 버린다", () => {
    const gate = createSyncGate();
    const write = gate.beginWrite();
    const ticket = gate.beginLoad();
    expect(gate.accepts(ticket)).toBe(false);
    gate.endWrite(write);
    expect(gate.accepts(ticket)).toBe(true); // 쓰기 시작 뒤에 조회가 시작됐으므로 쓰기 결과를 포함할 수 있다 — 화면은 조회를 쓰기 중에 막는다
  });
  it("더 새 조회가 있으면 이전 조회는 버린다(늦은 성공·실패 목록 모두)", () => {
    const gate = createSyncGate();
    const first = gate.beginLoad();
    const second = gate.beginLoad();
    expect(gate.accepts(first)).toBe(false);
    expect(gate.accepts(second)).toBe(true);
  });
  it("공급자 교체 뒤에는 이전 공급자의 조회·쓰기 응답을 모두 버리고 진행 중 쓰기 수를 비운다", () => {
    const gate = createSyncGate();
    gate.restart("load-a", "apply-a");
    const ticket = gate.beginLoad();
    const write = gate.beginWrite();
    gate.restart("load-b", "apply-a");
    expect(gate.accepts(ticket)).toBe(false);
    expect(gate.endWrite(write)).toBe(false);
    expect(gate.accepts(gate.beginLoad())).toBe(true);
  });
  it("방해 없는 명시 새로고침은 반영한다", () => {
    const gate = createSyncGate();
    expect(gate.accepts(gate.beginLoad())).toBe(true);
  });
});

describe("T289-F1 새 목록 뒤 줄 상태(rowsAfterList)", () => {
  const retry = buildAction({ ...base, version: "1", pendingGeneration: "1" }, "complete", "00000000-0000-4000-8000-0000000000aa", true)!;
  it("처리 미확정 재시도는 버전이 그대로면 같은 요청·안내와 함께 남는다", () => {
    const notice = { tone: "warning" as const, text: "같은 요청", reload: false, retry: true };
    const kept = rowsAfterList({ neon: row({ retry, retryBase: "1", notice, rights: true }) }, [{ ...base, version: "1", pendingGeneration: "1" }]);
    expect(kept.neon).toMatchObject({ retry, retryBase: "1", notice, rights: false });
  });
  it("버전이 바뀌었으면(서버가 이미 처리) 재시도를 지운다, 목록에서 빠진 줄도 지운다", () => {
    expect(rowsAfterList({ neon: row({ retry, retryBase: "1" }) }, [{ ...base, version: "2", activeGeneration: "1", approvedMs: "5" }])).toEqual({});
    expect(rowsAfterList({ gone: row({ retry, retryBase: "1" }) }, [base])).toEqual({});
  });
  it("재시도가 없는 줄(권리 체크·충돌 표시)은 새 목록 기준으로 초기화", () => {
    expect(rowsAfterList({ neon: row({ rights: true, stale: true }) }, [base])).toEqual({});
  });
});

describe("T289-F1 공급자와의 일관성", () => {
  it("검수 재현을 공급자로: v0 목록을 읽어 둔 사이 준비가 커밋되면, 그 v0 목록은 공급자 현재 상태와 다르다(버려야 할 응답)", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [{ slug: "neon", owner: ME, title: "합성", kind: "image", rights: "confirmed", source: { revision: 1, finished: true } }] });
    const gate = createSyncGate();
    const ticket = gate.beginLoad();
    const held = await memory.provider.list(); // 보류된 v0 응답
    const write = gate.beginWrite();
    const item = held.kind === "ok" ? held.items[0] : base;
    expect(await memory.provider.apply(buildAction(item, "prepare", "00000000-0000-4000-8000-0000000000bb", true)!)).toMatchObject({ status: "prepared", version: "1" });
    gate.endWrite(write);
    const now = await memory.provider.list();
    expect(now.kind === "ok" && now.items[0].version).toBe("1");
    expect(held.kind === "ok" && held.items[0].version).toBe("0");
    expect(gate.accepts(ticket)).toBe(false);
  });
  it("화면 소스: 조회 중에는 체크·동작·재시도를 막고, 쓰기 중에는 조회 버튼을 막으며, 상단 새로고침은 44px 클래스", () => {
    const source = readFileSync("components/admin/publication-queue.tsx", "utf8");
    expect(source).toContain("const commands = loading || r.stale");
    expect(source).toContain("disabled={!!busy || loading}");
    expect(source).toContain('{r.retry && <Button variant="secondary" disabled={loading || !!busy}');
    expect(source).toMatch(/className=\{styles\.reload\} onClick=\{reload\} loading=\{loading\}[^>]*disabled=\{anyBusy\}/);
    expect(source).not.toContain('size="sm"');
    expect(readFileSync("components/admin/publication-queue.module.css", "utf8")).toMatch(/\.reload \{ min-height: 44px; \}/);
  });
});
