import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildAction, isPublicationItem, type PublicationItem } from "@/components/admin/publication-model";
import { createMemoryPublicationProvider } from "@/components/admin/publication-provider";
import { PublicationQueue, ownEntry, retryDecision, rowsAfterFailedLoad, rowsAfterList, type Row } from "@/components/admin/publication-queue";

// T289-F4(F289-F3-1): 허용 주소 이름 constructor 줄이 쓰기 없이 "undefined 요청 중"으로 잠김.
// 기대값 근거: 모델 isPublicationItem·T253 SQL이 constructor를 허용하므로, 화면도 다른 주소와 똑같이 다뤄야 한다.
const ME = "10000000-0000-4000-8000-000000000289";
const SLUGS = ["constructor", "tostring", "valueof", "hasownproperty", "isprototypeof", "propertyisenumerable", "tolocalestring"];
const item = (slug: string, version = "0"): PublicationItem => ({ slug, title: `합성 ${slug}`, kind: "image", version, pendingGeneration: null, activeGeneration: null, approvedMs: null, source: { revision: "1", finished: true }, rights: "confirmed" });
const row = (extra: Partial<Row>): Row => ({ rights: false, confirmRevoke: false, notice: null, retry: null, retryBase: null, stale: false, ...extra });
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("T289-F4 상속 속성 이름의 주소", () => {
  it("모델은 constructor를 허용 주소로 받는다(화면이 따로 거르지 않음)", () => {
    expect(isPublicationItem(item("constructor"))).toBe(true);
  });
  it("ownEntry는 자체 키만 읽는다", () => {
    expect(ownEntry({}, "constructor")).toBeUndefined();
    expect(ownEntry({}, "toString")).toBeUndefined();
    expect(ownEntry({ constructor: 1 }, "constructor")).toBe(1);
  });
  it("유휴 화면: constructor 줄도 권리 체크가 켜져 있고 진행 표시·undefined가 없다", () => {
    const html = renderToStaticMarkup(createElement(PublicationQueue, {
      source: "synthetic", initial: { kind: "ok", items: SLUGS.map((slug) => item(slug)) },
      load: async () => ({ kind: "closed" as const }), apply: async () => ({ status: "unavailable" as const }), newRequestId: () => "x",
    }));
    expect(html).not.toContain("undefined");
    expect(text(html)).not.toContain("요청 중");
    expect(html.match(/type="checkbox"/g)?.length).toBe(SLUGS.length);
    expect(html).not.toMatch(/type="checkbox"[^>]*disabled/);
    expect(text(html)).not.toMatch(/같은 .* 요청 다시 시도/);
  });
  it("줄 상태 정리: 상속 이름 줄에 상태가 없으면 아무것도 만들지 않고, 있으면 자기 것만 유지", () => {
    expect(rowsAfterList({}, SLUGS.map((slug) => item(slug)))).toEqual({});
    const retry = buildAction(item("constructor"), "prepare", "00000000-0000-4000-8000-0000000000d1", true)!;
    const own = { constructor: row({ retry, retryBase: "0" }) } as Record<string, Row>;
    expect(rowsAfterList(own, [item("constructor")]).constructor).toMatchObject({ retry, retryBase: "0" });
    expect(rowsAfterList(own, [item("constructor", "1")])).toEqual({});
    expect(Object.keys(rowsAfterFailedLoad(own))).toEqual(["constructor"]);
    expect(retryDecision({ kind: "ok", items: [item("constructor")] }, "constructor", "0")).toBe("keep");
  });
  it("공급자 흐름: constructor 줄 준비 → 게시 → 커밋 전 실패 재시도는 같은 UUID로 한 번만 반영", async () => {
    const memory = createMemoryPublicationProvider({ actor: ME, publishers: [ME], seeds: [{ slug: "constructor", owner: ME, title: "합성", kind: "image", rights: "confirmed", source: { revision: 1, finished: true } }] });
    const list = async () => { const l = await memory.provider.list(); if (l.kind !== "ok") throw new Error("ok"); return l.items[0]; };
    expect(await memory.provider.apply(buildAction(await list(), "prepare", "00000000-0000-4000-8000-0000000000d2", true)!)).toMatchObject({ status: "prepared", version: "1" });
    const publish = buildAction(await list(), "complete", "00000000-0000-4000-8000-0000000000d3", true)!;
    expect(await memory.provider.apply(publish)).toMatchObject({ status: "published", version: "2" });
    expect(await memory.provider.apply(publish)).toMatchObject({ status: "published", version: "2" });
    expect((await list()).version).toBe("2");
  });
  it("화면 소스: 줄·쓰기 상태를 slug로 직접 인덱싱하지 않는다", () => {
    const source = readFileSync("components/admin/publication-queue.tsx", "utf8");
    expect(source).not.toMatch(/\b(rows|writes|all)\[(item\.)?slug\]/);
    expect(source).toContain("const busy = ownEntry(writes, item.slug) ?? null;");
  });
});
