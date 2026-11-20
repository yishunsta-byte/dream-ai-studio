import { describe, expect, it } from "vitest";
import { nearestAspectRatio, wholeImageMeasure } from "@/components/admin/admin-style-dna-report";
import type { ReadyResult } from "@/components/admin/admin-reference-analysis-model";
import { parseStyleDna } from "@/components/admin/admin-style-dna-extension";

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

describe("styleDna 선택 응답 읽기", () => {
  const valid = {
    schemaVersion: 1, titles: { ko: "제목" }, dimensions: { width: 10, height: 20 }, aspectRatio: "9:16",
    camera: { angle: { certainty: "estimated", description: "눈높이", basis: "수평선" }, lens: { certainty: "unconfirmed" } },
    lighting: { shadows: { certainty: "unconfirmed" } }, keywords: ["a"],
  };
  it("없으면 비우고, 맞으면 그대로 읽는다", () => {
    expect(parseStyleDna(undefined)).toBeUndefined();
    expect(parseStyleDna(valid)?.camera?.angle).toEqual({ certainty: "estimated", description: "눈높이", basis: "수평선" });
  });
  it("형식이 틀리면 통째로 무시한다(기존 리포트만 표시)", () => {
    for (const broken of [{ ...valid, schemaVersion: 2 }, { ...valid, camera: { angle: { certainty: "estimated" } } },
      { ...valid, dimensions: { width: 0, height: 5 } }, { ...valid, keywords: [""] }, "x", null]) {
      expect(parseStyleDna(broken)).toBeUndefined();
    }
  });
});
