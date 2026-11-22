import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminHub } from "@/components/admin/admin-hub";
import { AdminOperationsHome, readHomeQueue, queueValue, reviewStat } from "@/components/admin/admin-operations-home";
import { PublicationHttpQueue } from "@/components/admin/publication-http-queue";
import type { PublicationItem, PublicationList } from "@/components/admin/publication-model";

vi.mock("server-only", () => ({}));

// 관리자 홈 2안(Master msg_d8399b51662f·msg_5ec7848cc1ad·msg_0e494ddbfe2f): 작업 상태 카드 → 배너 3개 → 전폭 최근 분석 기록.
const markup = (publications: PublicationList) => renderToStaticMarkup(createElement(AdminHub, {
  email: "admin@example.invalid", projects: { kind: "unlinked" }, home: createElement(AdminOperationsHome, { publications }), review: createElement(PublicationHttpQueue, { initial: publications }),
}));
const item = (slug: string, pending: string | null, active: string | null): PublicationItem => ({
  slug, title: slug, kind: "image", version: "1", pendingGeneration: pending, activeGeneration: active, approvedMs: null,
  source: { revision: "1", finished: true }, rights: "confirmed",
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("관리자 홈 2안 서버 렌더", () => {
  it("/admin 기본 칸은 운영 현황 홈이고, 기존 분석 결과 공개 준비 칸과 다른 id다", () => {
    const html = markup({ kind: "closed" });
    expect(html).toMatch(/<section id="admin-home" tabindex="-1" aria-labelledby="admin-home-heading" class="[^"]*defaultPanel[^"]*">/);
    expect(html.match(/defaultPanel/g)).toHaveLength(1);
    expect(html).toContain('<h2 id="admin-home-heading" tabindex="-1">관리자 운영 현황</h2>');
    expect(html.match(/\bid="admin-analysis-results"/g)).toHaveLength(1);
    expect(html.indexOf('id="admin-home"')).toBeLessThan(html.indexOf('id="admin-project-list"'));
  });

  it("서버 렌더: 검수 대기는 페이지가 읽은 실제 목록 값, 렌더·기록은 조회 전 상태이고, 배너는 이미지=전용 화면·오디오·쇼츠=기존 칸", () => {
    const html = markup({ kind: "ok", items: [item("waiting", null, null), item("live", null, "2")] });
    const home = html.slice(html.indexOf('<section id="admin-home"'), html.indexOf('id="admin-project-list"'));
    const stats = home.match(/<section [^>]*aria-label="작업 상태"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect([...stats.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1])).toEqual(["#admin-review", "#admin-render-queue", "#admin-render-queue"]);
    expect(stats).toMatch(/검수 대기<\/span><strong[^>]*>1건<\/strong><small[^>]*>화면을 연 시점의 완성본 2건 기준/);
    expect(stats.match(/확인 중/g)).toHaveLength(2);
    const banners = home.match(/<ul [^>]*class="[^"]*banners[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect([...banners.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1])).toEqual(["/admin/style-dna", "#admin-music-analysis", "#admin-shorts-analysis"]);
    for (const picture of ["orchid", "neon-rooftop", "desert-motion"]) expect(banners).toContain(`showcase%2Ft240%2F${picture}.png`);
    expect(banners).toMatch(/alt=""/);
    expect(home).toContain("최근 이미지 분석 기록을 불러오고 있어요.");
    expect(home).toMatch(/href="#admin-analysis-results">분석 결과 공개·게시 관리/);
    expect(home.indexOf("작업 상태")).toBeLessThan(home.indexOf("분석 프로그램"));
    expect(home.indexOf("분석 프로그램")).toBeLessThan(home.indexOf("최근 분석 기록"));
    expect(home).not.toMatch(/예시/);
  });

  it("미연결 게시 저장소는 숫자 대신 연결 안 됨으로 그린다", () => {
    const html = markup({ kind: "closed" });
    expect(html).toMatch(/검수 대기<\/span><strong[^>]*>연결 안 됨<\/strong>/);
  });

  it("홈에서는 분석 프로그램 줄을 숨기고(배너만 진입점), 메뉴의 '콘텐츠 분석기'가 현재다", () => {
    const html = markup({ kind: "closed" });
    expect(html).toMatch(/<nav id="admin-program-navigation"[^>]*\bhidden(?:="")?/);
    expect(html).toMatch(/<a href="#admin-home" aria-current="location">[\s\S]*?콘텐츠 분석기<\/a>/);
  });
});

describe("작업 상태 카드 값(예시 숫자 없음)", () => {
  it("검수 대기는 게시 큐의 검수 대기 단계만 세고, 미연결·실패는 그대로 말한다", () => {
    expect(reviewStat({ kind: "ok", items: [item("a", null, null), item("b", "2", null), item("c", null, "3"), item("d", null, null)] }))
      .toEqual({ value: "2건", detail: "화면을 연 시점의 완성본 4건 기준" });
    expect(reviewStat({ kind: "ok", items: [] }).value).toBe("0건");
    expect(reviewStat({ kind: "closed" }).value).toBe("연결 안 됨");
    expect(reviewStat({ kind: "failed" }).value).toBe("불러오지 못함");
  });

  it("렌더 카드는 최근 작업(최대 50건)에서 대기·실행과 실패만 세고, 503·권한·형식 오류는 숫자를 만들지 않는다", async () => {
    const jobs = ["queued", "running", "failed", "succeeded", "canceled", "failed"].map(status => ({ status }));
    const ready = await readHomeQueue(json(200, { jobs }));
    expect(ready).toEqual({ kind: "ready", total: 6, active: 2, failed: 2 });
    expect([queueValue(ready, "active"), queueValue(ready, "failed")]).toEqual(["2건", "2건"]);
    expect(await readHomeQueue(json(503, { code: "unavailable" }))).toEqual({ kind: "unavailable" });
    expect(queueValue({ kind: "unavailable" }, "active")).toBe("연결 안 됨");
    for (const status of [401, 403]) expect(await readHomeQueue(json(status, {}))).toEqual({ kind: "denied" });
    expect(await readHomeQueue(json(500, {}))).toEqual({ kind: "failed" });
    expect(await readHomeQueue(json(200, { jobs: [{ status: "mystery" }] }))).toEqual({ kind: "failed" });
    expect(await readHomeQueue(json(200, { jobs: Array.from({ length: 51 }, () => ({ status: "queued" })) }))).toEqual({ kind: "failed" });
    expect(await readHomeQueue(json(200, { items: [] }))).toEqual({ kind: "failed" });
  });

  it("홈 부품은 시안의 예시 숫자·제목을 담지 않고, 사용자 데이터를 기록에 남기지 않는다", () => {
    const source = readFileSync("components/admin/admin-operations-home.tsx", "utf8");
    expect(source).not.toMatch(/네온 오키드|루프 사운드|사막 질주|오늘의 작업 예시|3건|2건|1건/);
    expect(source).not.toMatch(/console\./);
  });
});
