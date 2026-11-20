import { describe, expect, it } from "vitest";
import { containsNonPublicText } from "@/lib/reference-analysis/publication-text";
import {
  imagePublicationDraft, musicPublicationDraft, shortsPublicationDraft,
} from "@/components/admin/admin-analysis-publication-draft";

describe("Premiere analysis publication drafts", () => {
  it("uses the requested image prompt language and omits addresses and observation details", () => {
    const draft = imagePublicationDraft({
      status: "partial",
      provider: "gemini",
      findings: [
        { category: "composition", certainty: "estimated", description: "오른쪽 피사체", basis: "관리자 근거" },
        { category: "lighting", certainty: "estimated", description: "https://private.example.invalid/source", basis: "원본 근거" },
      ],
      prompts: { ko: "한국어 제안", en: "An English prompt" },
    }, "en");
    expect(draft).toEqual({
      media: "image", title: "Style DNA 분석 결과", summary: "추정 구도 — 오른쪽 피사체", prompt: "An English prompt",
    });
  });

  it("allows only the estimated music summary and prompt fields", () => {
    const draft = musicPublicationDraft({
      genre: "앰비언트", instruments: ["피아노", "person@example.invalid"], tempoBpm: 96,
      structure: [{ label: "도입", description: "게시용 요약에서 제외하는 관찰 원문" }],
      sunoPrompt: "A calm piano arrangement",
    });
    expect(draft).toEqual({
      media: "music", title: "음악 분석 결과", prompt: "A calm piano arrangement",
      summary: "추정 장르 — 앰비언트\n추정 악기 — 피아노\n추정 템포 — 96 BPM\n추정 구간 — 도입",
    });
  });

  it("leaves an unsafe Shorts prompt for the operator to edit and omits raw segments", () => {
    const draft = shortsPublicationDraft({
      summary: "첫 장면에 인물이 등장", hook: null, composition: null, sound: null,
      segments: [{ timestamp: "00:01", evidence: "관찰 원자료" }],
      draftPrompt: "Follow https://private.example.invalid/watch to recreate the scene.",
    });
    expect(draft).toEqual({
      media: "video", title: "쇼츠 분석 결과", summary: "모델 추정 — 첫 장면에 인물이 등장", prompt: "",
    });
    expect(containsNonPublicText("file:///C:/private/video.mov")).toBe(true);
    expect(containsNonPublicText("Person@example.invalid")).toBe(true);
    expect(containsNonPublicText("A quiet room, 96 BPM, no vocals")).toBe(false);
  });
});
