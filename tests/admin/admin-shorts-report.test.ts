import { describe, expect, it } from "vitest";
import { evidenceLabel, SHORTS_STEPS, shortsMarkdown, shortsWatchUrl } from "@/components/admin/admin-shorts-report";

const result = {
  evidence: "youtube_video" as const,
  findings: {
    summary: "요약", hook: "첫 컷", composition: null, sound: null,
    segments: [{ timestamp: "00:03", evidence: "제품 등장" }], draftPrompt: null,
  },
};

describe("쇼츠 리포트", () => {
  it("영상 직접 분석만 직접 분석으로 표시하고 다른 근거는 섞지 않는다", () => {
    expect(evidenceLabel("youtube_video")?.label).toBe("영상 직접 분석");
    expect(evidenceLabel("metadata")?.label).toBe("메타데이터 추정");
    expect(evidenceLabel("metadata")?.detail).toContain("직접 보지 않고");
    expect(evidenceLabel("unknown")).toBeUndefined();
  });
  it("Markdown에 영상 주소·근거·빈 항목(미확인)을 그대로 적는다", () => {
    const markdown = shortsMarkdown("A1b2C3d4E5F", result);
    expect(markdown).toContain(`- 영상: ${shortsWatchUrl("A1b2C3d4E5F")}`);
    expect(markdown).toContain("- 근거: 영상 직접 분석 (Gemini 추정)");
    expect(markdown).toContain("## 첫 장면\n첫 컷\n");
    expect(markdown).toContain("## 화면 구성\n미확인\n");
    expect(markdown).toContain("## 시간대별 근거\n- 00:03 · 제품 등장\n");
    expect(markdown).toContain("## 새 영상 연출 초안\n미확인\n");
    expect(shortsMarkdown("A1b2C3d4E5F", { ...result, findings: { ...result.findings, segments: [] } })).toContain("## 시간대별 근거\n미확인\n");
  });
  it("키트 단계 여섯 개를 같은 순서로 둔다", () => {
    expect(SHORTS_STEPS).toEqual(["쇼츠 주소", "바이럴 분석", "소재 발굴", "주제 확정", "대본 생성", "이미지·영상 프롬프트"]);
  });
});
