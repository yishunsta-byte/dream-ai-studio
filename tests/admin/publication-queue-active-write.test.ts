import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PublicationItem } from "@/components/admin/publication-model";
import { createSyncGate, retryDecision, type QueueView } from "@/components/admin/publication-queue";

// T289-F3: F289-F2-A(줄이 빠지면 진행 중 쓰기 잠금이 풀림), F289-F2-B(늦은 미확정 결과가 v5 줄에 v0 재시도를 되살림),
// 진행 중 같은 재시도의 중복 클릭. 기대값 근거: T289-F2-R 재현과 Master msg_619f0a035b82.
const v = (version: string, slug = "neon"): PublicationItem => ({ slug, title: "합성", kind: "image", version, pendingGeneration: null, activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" });
const ok = (...items: PublicationItem[]): QueueView => ({ kind: "ok", items });

describe("T289-F3 B — 늦은 미확정 결과는 최신 권위 목록의 같은 줄·같은 버전일 때만 재시도로 남는다", () => {
  it("같은 줄·같은 버전이면 keep(같은 UUID 재시도 표시)", () => {
    expect(retryDecision(ok(v("0")), "neon", "0")).toBe("keep");
  });
  it("initial이 v5로 바뀐 뒤 v0 결과는 notice(재시도·결과 반영 없이 안내만)", () => {
    expect(retryDecision(ok(v("5")), "neon", "0")).toBe("notice");
  });
  it("줄이 삭제된(빈 목록·다른 줄만) 최신 목록이면 drop(되살리지 않음)", () => {
    expect(retryDecision(ok(), "neon", "0")).toBe("drop");
    expect(retryDecision(ok(v("0", "other")), "neon", "0")).toBe("drop");
  });
  it("최신 화면이 실패·미연결(권위 없음)이면 keep — 다음 권위 목록에서 rowsAfterList가 같은 버전 여부로 판단", () => {
    expect(retryDecision({ kind: "failed" }, "neon", "0")).toBe("keep");
    expect(retryDecision({ kind: "closed" }, "neon", "0")).toBe("keep");
  });
});

describe("T289-F3 A — 진행 중 쓰기 잠금은 줄 상태와 분리", () => {
  it("게이트: initial만 바꿔(같은 공급자) 줄이 사라져도 진행 중 쓰기가 있으면 조회를 받지 않는다", () => {
    const gate = createSyncGate();
    gate.restart("load", "apply");
    const write = gate.beginWrite();
    expect(gate.restart("load", "apply")).toBe(false); // initial만 교체 = 공급자 교체 아님
    expect(gate.accepts(gate.beginLoad())).toBe(false);
    gate.endWrite(write);
    expect(gate.accepts(gate.beginLoad())).toBe(true);
  });
  it("게이트: 실제 공급자 교체는 true를 돌려주고(화면이 잠금 맵을 비움) 이전 쓰기 응답을 버린다", () => {
    const gate = createSyncGate();
    gate.restart("load", "apply");
    const write = gate.beginWrite();
    expect(gate.restart("load", "apply-2")).toBe(true);
    expect(gate.endWrite(write)).toBe(false);
  });
  it("화면 소스: 잠금은 inflight 맵·writes 상태로만 계산하고, 조회·쓰기 시작은 맵을 동기 확인한다", () => {
    const source = readFileSync("components/admin/publication-queue.tsx", "utf8");
    expect(source).toContain("const anyBusy = Object.keys(writes).length > 0;");
    expect(source).toContain("if (inflight.current.size > 0 || anyBusy || loading) return;");
    expect(source).toContain("if (loading || inflight.current.has(item.slug)) return;");
    expect(source).toContain("if (swapped) setWrites({});");
    expect(source).toContain("if (gate.restart(provided.load, provided.apply)) inflight.current.clear();");
    expect(source).not.toMatch(/r\.busy|busy: action\.command|busy: null/);
  });
  it("화면 소스: 진행 중 같은 줄의 재시도 버튼은 꺼지고, 늦은 결과는 retryDecision으로 거른다", () => {
    const source = readFileSync("components/admin/publication-queue.tsx", "utf8");
    expect(source).toContain("disabled={loading || !!busy} onClick={() => void send(item, r.retry!)}");
    expect(source).toContain("const decision = retryDecision(viewRef.current, item.slug, item.version);");
    expect(source).toContain('if (decision === "drop") return;');
  });
});
