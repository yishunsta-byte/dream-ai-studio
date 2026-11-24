import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowcaseListStore, ShowcaseSource } from "@/lib/public-showcase/showcase-source";
import { SAMPLE_WORKS } from "@/lib/public-showcase/works";

// T-251/T-255 공개 메인 목록 상태. 합성 스냅숏·시험 주입만 쓰며 실제 DB·Storage·게시는 없다.
// 기대값 근거: 설계 c9d5674 §5(예시 모드·정상 0건·승인·장애, 25행 검사 후 24건, ms/ASCII 정렬), T-253 list_approved() 모양,
// Master 지시 msg_5eccfc9b52be(운영은 명시 예시 모드, 잘못된 목록·공급원 오류는 예시로 숨기지 않고 로그인 링크 유지).
const hoisted = vi.hoisted(() => ({ source: null as null | ShowcaseSource }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/public-showcase/publication-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-showcase/publication-runtime")>();
  return { ...actual, async getPublicationPublicReaders() {
    const readers = await actual.getPublicationPublicReaders();
    return hoisted.source ? { ...readers, showcaseSource: hoisted.source } : readers;
  } };
});

const { loadShowcaseFeed } = await import("@/lib/public-showcase/showcase-feed");
const sourceModule = await import("@/lib/public-showcase/showcase-source");
const root = resolve(__dirname, "../..");
const NOW = 1_763_452_800_000; // 2025-11-18T08:00:00.000Z

type Row = { slug: string; generation: string; approvedMs: string; display: Record<string, unknown> };
function row(slug: string, approvedMs: number, display: Record<string, unknown> = {}, generation = "1"): Row {
  return {
    slug, generation, approvedMs: String(approvedMs),
    display: { kind: "영상", title: `WORK ${slug.toUpperCase()}`, subtitle: "공개 승인 작품", creator: "DREAM CREW", genre: "신스웨이브", format: "뮤직 필름", description: "합성 시험 작품이에요.", width: 1600, height: 900, ...display },
  };
}
const snapshot = (rows: unknown[], nowMs = NOW) => ({ nowMs: String(nowMs), rows });
const fixed = (value: unknown): ShowcaseListStore => ({ listApproved: async () => value });
const active = (store: ShowcaseListStore | null): ShowcaseSource => ({ mode: "active", store });

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => { hoisted.source = null; errors = vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { errors.mockRestore(); });

describe("T-255 운영 공급원", () => {
  it("운영은 명시적 예시 모드이고 예시 6개를 그대로 보여 준다", async () => {
    expect(sourceModule.SHOWCASE_SOURCE).toEqual({ mode: "sample" });
    expect(Object.isFrozen(sourceModule.SHOWCASE_SOURCE)).toBe(true);
    const feed = await loadShowcaseFeed();
    expect(feed.state).toBe("sample");
    expect(feed.works).toBe(SAMPLE_WORKS);
    const source = readFileSync(resolve(root, "lib/public-showcase/showcase-source.ts"), "utf8");
    expect(source).toContain('export const SHOWCASE_SOURCE: ShowcaseSource = Object.freeze({ mode: "sample" });');
  });
});

describe("T-255 정상 공급원", () => {
  it("정상 0건은 예시 6개(empty)", async () => {
    const feed = await loadShowcaseFeed(active(fixed(snapshot([]))));
    expect(feed.state).toBe("empty");
    expect(feed.works).toBe(SAMPLE_WORKS);
  });

  it("승인 1건은 그 작품만, 커버는 정규 공개 주소, 예시 표시 없음, 내부 값 미노출", async () => {
    const feed = await loadShowcaseFeed(active(fixed(snapshot([row("neon-demo", NOW - 60_000, {}, "7")]))));
    expect(feed.state).toBe("published");
    expect(feed.works).toHaveLength(1);
    const [work] = feed.works;
    expect(work).toMatchObject({ id: "neon-demo", title: "WORK NEON-DEMO", sample: false, media: null, kind: "영상" });
    expect(work.image).toEqual({ src: "/media/public/neon-demo/7/cover.webp", width: 1600, height: 900 });
    const json = JSON.stringify(feed);
    for (const leak of ["approvedMs", "nowMs", String(NOW), "rightsConfirmed", "publication", "objectKey", "failure"]) expect(json, leak).not.toContain(leak);
    expect(Object.isFrozen(feed) && Object.isFrozen(feed.works)).toBe(true);
  });

  it("철회는 다음 요청에 바로 반영된다(캐시 없음): 2건 → 1건 → 0건(예시)", async () => {
    let rows = [row("alpha", NOW - 1000), row("beta", NOW - 2000)];
    let calls = 0;
    const source = active({ listApproved: async () => { calls++; return snapshot(rows); } });
    expect((await loadShowcaseFeed(source)).works.map((work) => work.id)).toEqual(["alpha", "beta"]);
    rows = [row("beta", NOW - 2000)];
    expect((await loadShowcaseFeed(source)).works.map((work) => work.id)).toEqual(["beta"]);
    rows = [];
    const last = await loadShowcaseFeed(source);
    expect(last.state).toBe("empty");
    expect(last.works).toBe(SAMPLE_WORKS);
    expect(calls).toBe(3);
  });

  it("25행을 모두 검사하고 상위 24건만 보여 준다(24·25번째 승인 ms 동률은 slug ASCII 순)", async () => {
    const rows = Array.from({ length: 23 }, (_, index) => row(`work-${String(index).padStart(2, "0")}`, NOW - 10_000 - index));
    rows.push(row("tie-a", NOW - 50_000), row("tie-b", NOW - 50_000));
    const feed = await loadShowcaseFeed(active(fixed(snapshot(rows))));
    expect(feed.state).toBe("published");
    expect(feed.works).toHaveLength(24);
    expect(feed.works.at(-1)?.id).toBe("tie-a");
    expect(feed.works.some((work) => work.id === "tie-b")).toBe(false);
    // 25번째 행도 같은 계약으로 검사한다: 거기만 깨져도 장애.
    const broken = [...rows.slice(0, 24), row("tie-b", NOW - 50_000, { title: "" })];
    expect((await loadShowcaseFeed(active(fixed(snapshot(broken))))).state).toBe("unavailable");
    // 정확히 24행이면 24건, 26행은 계약 오류.
    expect((await loadShowcaseFeed(active(fixed(snapshot(rows.slice(0, 24)))))).works).toHaveLength(24);
    expect((await loadShowcaseFeed(active(fixed(snapshot([...rows, row("tie-c", NOW - 50_000)]))))).state).toBe("unavailable");
  });

  it("ms 정밀도와 ASCII slug 순서가 T-249 정렬과 일치한다", async () => {
    const rows = [row("late", NOW - 1), row("early", NOW - 2), row("z-9", NOW - 3), row("z10", NOW - 3), row("z9", NOW - 3)];
    const feed = await loadShowcaseFeed(active(fixed(snapshot(rows))));
    expect(feed.works.map((work) => work.id)).toEqual(["late", "early", "z-9", "z10", "z9"]);
    const sameMs = await loadShowcaseFeed(active(fixed(snapshot([row("b", NOW)]))));
    expect(sameMs.state).toBe("published");
  });
});

describe("T-255 장애는 예시로 숨기지 않는다", () => {
  async function failure(source: ShowcaseSource, deadlineMs?: number) {
    const feed = await loadShowcaseFeed(source, deadlineMs);
    expect(feed.state).toBe("unavailable");
    expect(feed.works).toEqual([]);
    return feed.state === "unavailable" ? feed.failure : null;
  }

  it("설정 누락·조회 실패·권한 거부·시간 초과", async () => {
    expect(await failure(active(null))).toBe("config");
    expect(await failure(active({ listApproved: async () => { throw new Error("db down"); } }))).toBe("query");
    expect(await failure(active({ listApproved: async () => { throw Object.assign(new Error("denied"), { code: "42501" }); } }))).toBe("permission");
    let aborted = false;
    const slow: ShowcaseListStore = { listApproved: (signal) => new Promise((resolveList) => { signal.addEventListener("abort", () => { aborted = true; resolveList(snapshot([])); }); }) };
    expect(await failure(active(slow), 30)).toBe("timeout");
    expect(aborted).toBe(true);
  });

  it("계약 위반 스냅숏은 모두 contract", async () => {
    const good = row("good", NOW - 10);
    const cases: [string, unknown][] = [
      ["null", null], ["array", []], ["missing rows", { nowMs: String(NOW) }], ["extra key", { ...snapshot([]), more: 1 }],
      ["nowMs number", { nowMs: NOW, rows: [] }], ["nowMs lead zero", { nowMs: `0${NOW}`, rows: [] }], ["rows object", { nowMs: String(NOW), rows: {} }],
      ["26 rows", snapshot(Array.from({ length: 26 }, (_, index) => row(`r${String(index).padStart(2, "0")}`, NOW - 100)))],
      ["row extra key", snapshot([{ ...good, ownerEmail: "owner@example.com" }])],
      ["row missing key", snapshot([{ slug: "good", generation: "1", approvedMs: String(NOW) }])],
      ["bad slug", snapshot([row("Bad", NOW - 10)])], ["reserved slug", snapshot([row("private", NOW - 10)])],
      ["generation 0", snapshot([row("good", NOW - 10, {}, "0")])], ["generation number", snapshot([{ ...good, generation: 1 }])],
      ["approvedMs number", snapshot([{ ...good, approvedMs: NOW - 10 }])], ["approvedMs future", snapshot([row("good", NOW + 1)])],
      ["approvedMs beyond year 9999", snapshot([row("good", 253_402_300_800_000)], 253_402_300_800_001)],
      ["unsorted ms", snapshot([row("a", NOW - 20), row("b", NOW - 10)])], ["tie wrong order", snapshot([row("b", NOW - 10), row("a", NOW - 10)])],
      ["duplicate slug", snapshot([row("a", NOW - 10), row("a", NOW - 20)])],
      ["display missing key", snapshot([{ ...good, display: { ...good.display, genre: undefined } }])],
      ["display extra key", snapshot([{ ...good, display: { ...good.display, image: { src: "/x.png" } } }])],
      ["width 4097", snapshot([row("good", NOW - 10, { width: 4097 })])], ["height 0", snapshot([row("good", NOW - 10, { height: 0 })])],
      ["empty title", snapshot([row("good", NOW - 10, { title: "  " })])], ["long title", snapshot([row("good", NOW - 10, { title: "x".repeat(81) })])],
      ["control char", snapshot([row("good", NOW - 10, { description: "a\u0007b" })])], ["email", snapshot([row("good", NOW - 10, { creator: "owner@example.com" })])],
      ["unknown kind", snapshot([row("good", NOW - 10, { kind: "드라마" })])],
      ["one bad among good", snapshot([row("good", NOW - 10), row("worse", NOW - 20, { title: 7 })])],
    ];
    for (const [name, value] of cases) {
      const display = value as { rows?: { display?: Record<string, unknown> }[] };
      if (name === "display missing key") delete display.rows?.[0]?.display?.genre;
      expect(await failure(active(fixed(value))), name).toBe("contract");
    }
  });

  it("서버 진단은 분류 코드와 개수만 남긴다", async () => {
    await loadShowcaseFeed(active(fixed(snapshot([row("secret-slug", NOW - 10, { title: "x".repeat(81), creator: "owner@example.com" })]))));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]).toEqual(["[showcase] unavailable code=contract rows=1"]);
  });
});

describe("T-255 공개 메인 화면 상태", () => {
  async function page(source: ShowcaseSource | null) {
    hoisted.source = source;
    const { default: Page } = await import("@/app/(public)/page");
    return renderToStaticMarkup(await Page({}));
  }

  it("예시 모드·정상 0건은 예시, 승인 목록은 승인 작품만", async () => {
    for (const markup of [await page(null), await page(active(fixed(snapshot([]))))]) {
      expect(markup).toContain("NEON AFTER HOURS");
      expect(markup).not.toContain("예시"); // 2026-11-19 주인님 결정: 화면에 예시 표시 없음(R5 예외)
      expect(markup).not.toContain("작품 목록을 불러오지 못했어요");
    }
    const published = await page(active(fixed(snapshot([row("neon-demo", NOW - 10)]))));
    expect(published).toContain("WORK NEON-DEMO");
    expect(published).toContain('src="/media/public/neon-demo/1/cover.webp"');
    expect(published).not.toMatch(/NEON AFTER HOURS|예시 작품|대표 작품 · 예시|불러오지 못했어요/);
  });

  it("장애 화면은 예시 없이 안내와 로그인 링크를 유지하고, 정상 빈 목록과 다르다", async () => {
    for (const source of [active(null), active(fixed({ rows: [] })), active({ listApproved: async () => { throw new Error("down"); } })]) {
      const markup = await page(source);
      expect(markup).toContain("작품 목록을 불러오지 못했어요");
      expect(markup).toContain('href="/login?next=%2Fstudio"');
      expect(markup).toContain('href="/admin/login"');
      expect(markup).not.toMatch(/NEON AFTER HOURS|예시 작품|아직 공개된 작품이 없어요|<button[^>]*>다시 시도/);
    }
  });
});

describe("T-255 연결 범위", () => {
  it("홈은 요청마다 서버에서 상태를 정하고, 공급 모듈은 정해진 것만 가져온다", () => {
    const pageSource = readFileSync(resolve(root, "app/(public)/page.tsx"), "utf8");
    expect([...pageSource.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])).toEqual(["next", "@/components/public-showcase/neon-showcase",
      "@/components/public-showcase/showcase-guard", "@/lib/public-showcase/publication-runtime", "@/lib/public-showcase/showcase-feed"]);
    expect(pageSource).toContain('export const dynamic = "force-dynamic";');
    expect(pageSource).toContain("const { showcaseSource } = await getPublicationPublicReaders();");
    expect(pageSource).toContain("const feed = await loadShowcaseFeed(showcaseSource);");
    expect(pageSource).not.toMatch(/"use client"|SAMPLE_WORKS|lib\/db|lib\/auth|lib\/services|node:fs|onRetry/);
    const imports = (path: string) => [...readFileSync(resolve(root, path), "utf8").matchAll(/^import\s+(?:.*\s+from\s+)?"([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports("lib/public-showcase/showcase-feed.ts")).toEqual(["server-only", "@/lib/public-showcase/published-works", "@/lib/public-showcase/showcase-source", "@/lib/public-showcase/works"]);
    expect(imports("lib/public-showcase/showcase-source.ts")).toEqual(["server-only", "./playback-path", "@/lib/public-showcase/cover-path"]);
    for (const path of ["lib/public-showcase/showcase-feed.ts", "lib/public-showcase/showcase-source.ts"]) {
      const code = readFileSync(resolve(root, path), "utf8").replace(/\/\/.*$/gm, "");
      expect(code, path).not.toMatch(/\bfetch\(|supabase|node:fs|process\.env|lib\/db|"use client"|unstable_cache|revalidate/i);
    }
  });
});
