import { describe, expect, it } from "vitest";
import { arrangeShorts, ratioText, viewsPerHour, viewsPerSubscriber, viralGrade, vphText, vsGrade, vsTenths } from "@/components/admin/shorts-metrics";

// P1-08 V/S 등급·VPH(원본 Shorts Viral Studio v2.01 metrics.ts 정의). 받은 공개 지표로만 계산하고 보기 순서만 바꾼다.
const now = Date.parse("2026-11-21T12:00:00Z");
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

describe("P1-08 쇼츠 V/S·VPH", () => {
  it("V/S는 조회수÷구독자이고, 구독자 비공개·0이나 조회수 비공개면 판정불가다", () => {
    expect(viewsPerSubscriber({ views: 25_000, subscribers: 1_000 })).toBe(25);
    expect(viewsPerSubscriber({ views: 0, subscribers: 10 })).toBe(0);
    expect([viewsPerSubscriber({ views: 10, subscribers: null }), viewsPerSubscriber({ views: 10, subscribers: 0 }), viewsPerSubscriber({ views: null, subscribers: 10 })])
      .toEqual([null, null, null]);
    expect(viralGrade(viewsPerSubscriber({ views: 10, subscribers: null }))).toBe("판정불가");
  });

  it("등급 경계는 원본과 같다(10·5·3·1배 이상, 그 밖 보통)", () => {
    expect([10, 9.99, 5, 4.99, 3, 2.99, 1, 0.99, 0, null].map(value => viralGrade(value)))
      .toEqual(["초대박", "대박", "대박", "떡상", "떡상", "양호", "양호", "보통", "보통", "판정불가"]);
  });

  it("화면 배율 글자와 등급은 정확한 정수 계산 한 값에서 함께 정해져 엇갈리지 않는다(Tester 4.99999999999 지적)", () => {
    const show = (views: number, subscribers: number) => { const tenths = vsTenths({ views, subscribers }); return [ratioText(tenths), vsGrade(tenths)]; };
    expect(show(499_999_999_999, 100_000_000_000)).toEqual(["4.9배", "떡상"]);
    expect(show(500_000_000_000, 100_000_000_000)).toEqual(["5.0배", "대박"]);
    expect(show(49_999, 10_000)).toEqual(["4.9배", "떡상"]);
    expect(show(50_000, 10_000)).toEqual(["5.0배", "대박"]);
    expect(show(99_999, 10_000)).toEqual(["9.9배", "대박"]);
    expect(show(100_000, 10_000)).toEqual(["10.0배", "초대박"]);
    expect(show(3, 1)).toEqual(["3.0배", "떡상"]);
    expect(show(2_999, 1_000)).toEqual(["2.9배", "양호"]);
    expect(show(1_000, 1_000)).toEqual(["1.0배", "양호"]);
    expect(show(999, 1_000)).toEqual(["0.9배", "보통"]);
    expect(show(3, 10)).toEqual(["0.3배", "보통"]);
    expect(show(0, 10)).toEqual(["0.0배", "보통"]);
    expect(show(123_456_789, 100_000)).toEqual(["1,234.5배", "초대박"]);
    expect([vsTenths({ views: 10, subscribers: null }), vsTenths({ views: 10, subscribers: 0 }), vsTenths({ views: null, subscribers: 10 })]).toEqual([null, null, null]);
    expect([ratioText(null), vsGrade(null)]).toEqual(["판정불가", "판정불가"]);
    // 같은 경계에서 원본 등급 함수(실제 비율)와 같은 판정
    for (const [views, subscribers] of [[499_999_999_999, 100_000_000_000], [50_000, 10_000], [2_999, 1_000], [100_000, 10_000]])
      expect(vsGrade(vsTenths({ views, subscribers }))).toBe(viralGrade(viewsPerSubscriber({ views, subscribers })));
  });

  it("VPH는 조회수÷게시 후 시간(최소 1시간), 기준은 검색 시각이다", () => {
    expect(viewsPerHour({ views: 1_000, publishedAt: ago(48) }, now)).toBeCloseTo(1_000 / 48);
    expect(viewsPerHour({ views: 4_800, publishedAt: ago(48) }, now)).toBe(100);
    expect(viewsPerHour({ views: 100, publishedAt: ago(0.1) }, now)).toBe(100);
    expect(viewsPerHour({ views: 100, publishedAt: ago(0) }, now)).toBe(100);
    expect(viewsPerHour({ views: 0, publishedAt: ago(5) }, now)).toBe(0);
  });

  it("조회수 비공개·읽을 수 없는 시각·검색 시각보다 늦은 게시 시각은 계산 불가(지표를 꾸미지 않음)", () => {
    expect(viewsPerHour({ views: null, publishedAt: ago(5) }, now)).toBeNull();
    expect(viewsPerHour({ views: 5, publishedAt: "not a date" }, now)).toBeNull();
    expect(viewsPerHour({ views: 5, publishedAt: "" }, now)).toBeNull();
    expect(viewsPerHour({ views: 100, publishedAt: ago(-5) }, now)).toBeNull();
    expect(viewsPerHour({ views: 100, publishedAt: ago(-0.001) }, now)).toBeNull();
    expect(viewsPerHour({ views: 100, publishedAt: ago(5) }, Number.NaN)).toBeNull();
  });

  it("VPH 글자: 10회 미만은 소수 한 자리 버림, 그 이상은 반올림 정수", () => {
    expect([vphText(1_234_567.6), vphText(12.5), vphText(9.99), vphText(9.99999999999), vphText(0.44), vphText(0), vphText(null)])
      .toEqual(["1,234,568회", "13회", "9.9회", "9.9회", "0.4회", "0회", "계산 불가"]);
  });

  it("보기 순서는 받은 목록만 다시 늘어놓고, 계산 불가는 뒤로·같은 값은 원래 순서를 지킨다", () => {
    const items = [
      { id: "a", views: 100, subscribers: 100, publishedAt: ago(24) },
      { id: "b", views: 500, subscribers: null, publishedAt: ago(24) },
      { id: "c", views: 300, subscribers: 100, publishedAt: ago(72) },
      { id: "d", views: null, subscribers: 100, publishedAt: ago(24) },
      { id: "e", views: 200, subscribers: 200, publishedAt: ago(24) },
      { id: "f", views: 900, subscribers: 100, publishedAt: ago(-3) },
    ];
    const ids = (view: "search" | "ratio" | "vph") => arrangeShorts(items, view, now).map(item => item.id).join("");
    expect([ids("search"), ids("ratio"), ids("vph")]).toEqual(["abcdef", "fcaebd", "beacdf"]);
    expect(items.map(item => item.id).join("")).toBe("abcdef");
  });
});
