import { afterEach, describe, expect, it, vi } from "vitest";
import { compareStyleDna } from "@/components/admin/style-dna-client";
import {
  averageDiff, bestTrendIndex, colorDiffPercent, containPoint, defaultSplit, percentAt, percentForKey, promptPreview, sparklinePoints, splitClip, spotChange, toHex,
} from "@/components/admin/style-dna-original/compare-math";
import { styleDnaCompare } from "@/lib/reference-analysis/style-dna-contract";

// P1-06 3단계 원본 비교 슬라이더 이관(3b): 원본 compare.ts·checkSpots.ts 계산이 그대로인지, 비교 저장 요청이 서버 계약(styleDnaCompare)을 통과하는지.
const target = { testId: "0190b0b0-0000-7000-8000-00000000c001", originalSha256: "a".repeat(64), resultSha256: "b".repeat(64) };
const comparison = { source: "stored_webp_rgb_5x5", spotVersion: 1, frame: { width: 640, height: 400 }, baseline: { ...target, at: "2026-11-22T00:00:00.000Z" },
  spots: [{ x: 50, y: 50, diff: 12.3 }], updatedAt: "2026-11-22T00:00:00.000Z", trends: [], recordedTestIds: [] };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("P1-06 원본 비교 계산(compare-math)", () => {
  it("위치·키보드·분할은 원본과 같다", () => {
    expect([percentAt(150, 100, 200), percentAt(50, 100, 200), percentAt(400, 100, 200), percentAt(1, 0, 0)]).toEqual([25, 0, 100, 50]);
    expect(["ArrowLeft", "ArrowRight", "Home", "End", "x"].map((key) => percentForKey(50, key))).toEqual([48, 52, 0, 100, null]);
    expect([percentForKey(5, "ArrowLeft", true), percentForKey(95, "ArrowRight", true)]).toEqual([0, 100]);
    expect([splitClip("horizontal", 30, 70), splitClip("vertical", 30, 70)]).toEqual(["inset(0 70% 0 0)", "inset(0 0 30% 0)"]);
    expect([defaultSplit(640, 400), defaultSplit(400, 480), defaultSplit(400, 479), defaultSplit(0, 10)]).toEqual(["horizontal", "vertical", "horizontal", "horizontal"]);
  });

  it("색 집게: 맞춰 그린 그림 안 픽셀, 여백은 null, 색 차이는 0~100", () => {
    // 640×400 틀에 400×640 세로 그림 → 가운데 250px 폭만 그림
    expect(containPoint(640, 400, 400, 640, 50, 50)).toEqual({ x: 200, y: 320 });
    expect(containPoint(640, 400, 400, 640, 20, 50)).toBeNull();
    expect(containPoint(640, 400, 640, 400, 100, 100)).toEqual({ x: 639, y: 399 });
    expect(containPoint(0, 400, 640, 400, 50, 50)).toBeNull();
    expect([toHex(232, 213, 176), toHex(-3, 300, 15.6)]).toEqual(["#E8D5B0", "#00FF10"]);
    expect([colorDiffPercent([0, 0, 0], [255, 255, 255]), colorDiffPercent([10, 20, 30], [10, 20, 30]), colorDiffPercent([232, 213, 176], [244, 241, 234])]).toEqual([100, 0, 14.8]);
  });

  it("점검 지점 평균·변화와 추세 그래프·최고 기록·미리보기", () => {
    expect([averageDiff([10, null, 20.25, undefined, Number.NaN]), averageDiff([null])]).toEqual([15.1, null]);
    expect([spotChange(20, 10), spotChange(10, 20), spotChange(10, 10.4), spotChange(null, 3)]).toEqual([
      { delta: -10, trend: "better" }, { delta: 10, trend: "worse" }, { delta: 0.4, trend: "same" }, null]);
    expect(sparklinePoints([30, 10, 20], 132, 34, 6)).toBe("6,28 66,6 126,17");
    expect(sparklinePoints([5], 132, 34, 6)).toBe("66,6");
    expect([bestTrendIndex([30, 10, 20, 10]), bestTrendIndex([])]).toEqual([3, -1]);
    expect(promptPreview(`  a\n  b ${"x".repeat(130)}`)).toBe(`a b ${"x".repeat(116)}…`);
  });
});

describe("P1-06 비교 저장 요청(compareStyleDna)", () => {
  it("점검 지점 저장·추세 기록 본문은 서버 계약을 통과하고, 빈 프롬프트는 빼고 앞뒤 공백은 지운다", async () => {
    const send = vi.fn(async () => reply(200, { comparison }));
    vi.stubGlobal("fetch", send);
    await expect(compareStyleDna("rec", { action: "save-spots", ...target, spotVersion: 0, frame: { width: 640, height: 400 }, spots: [{ x: 50, y: 50 }, { x: 20.5, y: 6 }] }))
      .resolves.toEqual({ kind: "ok", value: comparison });
    await compareStyleDna("rec", { action: "record-trend", ...target, spotVersion: 1, prompt: "  Edited prompt  " });
    await compareStyleDna("rec", { action: "record-trend", ...target, spotVersion: 1, prompt: "   " });
    const calls = send.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => [url, init.method])).toEqual(Array(3).fill(["/api/admin/style-dna/rec", "PATCH"]));
    const bodies = calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[1].prompt).toBe("Edited prompt");
    expect("prompt" in bodies[2]).toBe(false);
    for (const body of bodies) expect(styleDnaCompare.safeParse(body).success).toBe(true);
    expect(new Set(bodies.map((body) => body.requestId)).size).toBe(3);
  });

  it("409·422·로그인·권한·끊김·이상한 응답을 나눈다", async () => {
    const cases: [Response | Error, unknown][] = [
      [reply(409, { code: "stale_spot_version" }), { kind: "error", code: "stale_spot_version", status: 409 }],
      [reply(409, { code: "comparison_media_mismatch" }), { kind: "error", code: "comparison_media_mismatch", status: 409 }],
      [reply(422, { code: "comparison_unmeasured" }), { kind: "error", code: "comparison_unmeasured", status: 422 }],
      [reply(401, {}), { kind: "login" }], [reply(403, {}), { kind: "forbidden" }],
      [new TypeError("network"), { kind: "lost" }],
      [reply(200, { comparison: { spots: "x" } }), { kind: "error", code: "failed", status: 200 }],
    ];
    for (const [answer, outcome] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => { if (answer instanceof Error) throw answer; return answer; }));
      await expect(compareStyleDna("rec", { action: "record-trend", ...target, spotVersion: 1 })).resolves.toEqual(outcome);
    }
  });
});
