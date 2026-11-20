import { describe, expect, it } from "vitest";
import { nearestAspectRatio, wholeImageMeasure } from "@/components/admin/admin-style-dna-report";
import type { ReadyResult } from "@/components/admin/admin-reference-analysis-model";

const observation = (x: number, width: number, bucket: string) => ({
  kind: "observation" as const, findingId: `f-${x}`, measure: "region_color_luminance" as const,
  location: { kind: "region" as const, x, y: 0, width, height: 1 }, alphaCoverage: 1,
  palette: [{ bucket, visibleShare: 1 }], luminanceShares: [0.25, 0.25, 0.25, 0.25], luminanceEdges: [0, 0.25, 0.5, 0.75, 1],
});
const draft = { kind: "creative_proposal" as const, target: "image" as const, prompt: "p" };

describe("Style DNA 리포트 측정값", () => {
  it("키트와 같은 지원 비율 중 가장 가까운 비율을 고른다", () => {
    expect(nearestAspectRatio(1920, 1080)).toBe("16:9");
    expect(nearestAspectRatio(1080, 1920)).toBe("9:16");
    expect(nearestAspectRatio(1000, 1000)).toBe("1:1");
    expect(nearestAspectRatio(2560, 1080)).toBe("21:9");
    expect(nearestAspectRatio(0, 100)).toBeUndefined();
  });
  it("이미지 전체 영역 측정값만 고르고 없으면 비운다", () => {
    const result: ReadyResult = { schemaVersion: 1, status: "ready", media: "image", proposals: [
      { media: "image", selectionId: "a", observations: [observation(0.5, 0.5, "#111111")], draft },
      { media: "image", selectionId: "b", observations: [observation(0, 1, "#222222")], draft },
    ] };
    expect(wholeImageMeasure(result)?.palette[0].bucket).toBe("#222222");
    expect(wholeImageMeasure({ ...result, proposals: [result.proposals[0]] })).toBeUndefined();
    expect(wholeImageMeasure(undefined)).toBeUndefined();
  });
});
