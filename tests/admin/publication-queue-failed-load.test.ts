import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAction, type PublicationAction, type PublicationItem } from "@/components/admin/publication-model";
import { createMemoryPublicationProvider } from "@/components/admin/publication-provider";
import { createSyncGate, rowsAfterFailedLoad, rowsAfterList, type Row } from "@/components/admin/publication-queue";

// T289-F2: F289-F1-A(목록 실패가 미확정 UUID 삭제), F289-F1-B(initial만 교체 시 이전 응답이 새 화면을 덮음).
// 기대값 근거: T289-F1-R 재현 순서. 미확정 요청은 권위 있는 새 버전·삭제·실제 공급자 교체에서만 지운다.
const ME = "10000000-0000-4000-8000-000000000289";
const v1: PublicationItem = { slug: "neon", title: "합성", kind: "image", version: "1", pendingGeneration: "1", activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" };
const row = (extra: Partial<Row>): Row => ({ rights: false, confirmRevoke: false, notice: null, retry: null, retryBase: null, stale: false, ...extra });
const UUID = "00000000-0000-4000-8000-0000000000c1";
const publish = buildAction(v1, "complete", UUID, true)!;
const notice = { tone: "warning" as const, text: "같은 요청으로 다시 시도할 수 있어요.", reload: false, retry: true };

describe("T289-F2 A — 목록 실패는 미확정 요청을 지우지 않는다", () => {
  it("실패 → 같은 버전(v1) 복구 순서에서 같은 요청·UUID가 남는다", () => {
    let rows: Record<string, Row> = { neon: row({ retry: publish, retryBase: "1", notice, rights: true }) };
    rows = rowsAfterFailedLoad(rows);
    expect(rows.neon).toMatchObject({ retry: publish, retryBase: "1", notice, rights: false });
    rows = rowsAfterList(rows, [v1]);
    expect(rows.neon.retry).toBe(publish);
    expect(rows.neon.retry!.requestId).toBe(UUID);
  });
  it("실패가 여러 번 이어져도 남고, 권리 체크 같은 임시 상태만 지운다(진행 중 쓰기 잠금은 줄 상태 밖, T289-F3)", () => {
    const rows = rowsAfterFailedLoad(rowsAfterFailedLoad({ neon: row({ retry: publish, retryBase: "1" }), other: row({ rights: true, stale: true }) }));
    expect(Object.keys(rows)).toEqual(["neon"]);
  });
  it("권위 있는 새 버전(v2)이나 삭제(목록에서 빠짐)일 때만 지운다", () => {
    const rows = { neon: row({ retry: publish, retryBase: "1" }) };
    expect(rowsAfterList(rows, [{ ...v1, version: "2", pendingGeneration: null, activeGeneration: "1", approvedMs: "5" }])).toEqual({});
    expect(rowsAfterList(rows, [])).toEqual({});
  });
  it("공급자로 재현: 게시가 커밋 전 실패 → 목록 실패 → v1 복구 → 같은 UUID 재전송은 한 번만 게시", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [{ slug: "neon", owner: ME, title: "합성", kind: "image", rights: "confirmed", source: { revision: 1, finished: true } }] });
    const list = async () => { const l = await memory.provider.list(); if (l.kind !== "ok") throw new Error("ok"); return l.items; };
    await memory.provider.apply(buildAction((await list())[0], "prepare", "00000000-0000-4000-8000-0000000000c0", true)!);
    const prepared = (await list())[0];
    const action: PublicationAction = buildAction(prepared, "complete", UUID, true)!;
    // 응답 유실(커밋 전) → 화면은 재시도 상태
    let rows: Record<string, Row> = { neon: row({ retry: action, retryBase: prepared.version, notice }) };
    rows = rowsAfterFailedLoad(rows);              // 목록 실패
    rows = rowsAfterList(rows, await list());       // 복구: 같은 v1
    expect(rows.neon.retry).toBe(action);
    expect(await memory.provider.apply(rows.neon.retry!)).toMatchObject({ status: "published", version: "2" });
    expect(await memory.provider.apply(rows.neon.retry!)).toMatchObject({ status: "published", version: "2" }); // 원장 재생
    expect((await list())[0].version).toBe("2");
  });
});

describe("T289-F2 B — initial만 교체해도 이전 조회 응답은 새 화면을 덮지 않는다", () => {
  it("initial만 바뀐 재시작: 이전 조회는 버리고, 같은 공급자의 진행 중 쓰기 결과는 받는다", () => {
    const gate = createSyncGate();
    gate.restart("load", "apply");
    const ticket = gate.beginLoad();
    const write = gate.beginWrite();
    gate.restart("load", "apply"); // initial만 교체
    expect(ticket.view).not.toBe(gate.viewNow());
    expect(gate.accepts(ticket)).toBe(false);
    expect(gate.endWrite(write)).toBe(true);
  });
  it("실제 공급자 교체: 조회·쓰기 응답을 모두 버린다", () => {
    const gate = createSyncGate();
    gate.restart("load", "apply");
    const ticket = gate.beginLoad();
    const write = gate.beginWrite();
    gate.restart("load", "apply-2");
    expect(gate.accepts(ticket)).toBe(false);
    expect(gate.endWrite(write)).toBe(false);
    const fresh = gate.beginLoad();
    expect(gate.accepts(fresh)).toBe(true);
  });
  it("initial만 교체된 새 목록은 권위 있는 목록: 같은 버전의 미확정은 남기고 새 버전이면 지운다", () => {
    const rows = { neon: row({ retry: publish, retryBase: "1" }) };
    expect(rowsAfterList(rows, [v1]).neon.retry).toBe(publish);
    expect(rowsAfterList(rows, [{ ...v1, version: "5" }])).toEqual({});
  });
  it("화면 소스: 재시작 조건과 응답 세대 증가 조건이 같은 provided 상태이고, 조회 응답은 화면 세대로 거른다", () => {
    const source = readFileSync("components/admin/publication-queue.tsx", "utf8");
    expect(source).toContain("if (provided.initial !== initial || provided.load !== load || provided.apply !== apply) {");
    expect(source).toContain("useLayoutEffect(() => { if (gate.restart(provided.load, provided.apply)) inflight.current.clear(); }, [gate, provided]);");
    expect(source).toContain("if (ticket.view !== gate.viewNow()) return;");
    expect(source).toContain('rowsAfterList(current, next.items) : rowsAfterFailedLoad(current)');
    expect(source).not.toMatch(/: \{\}\);\n\s*\}\n\n\s*async function send/);
  });
});
