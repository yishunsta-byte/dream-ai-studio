// 주인님 지시(2026-11-24): 오디오 분석 화면은 원본 키트처럼 동의 상자 없이 분석 버튼으로 바로 실행한다.
// 바로 분석·큰 파일 업로드·바깥 화면·안내서 어디에도 동의 체크 상자나 '동의해야' 안내가 다시 생기지 않게 고정한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["components/admin/admin-music-semantic.tsx", "components/admin/admin-audio-upload.tsx",
  "components/admin/audio-original/audio-studio.tsx", "components/admin/audio-original/audio-guide.tsx"];

describe("audio analysis runs straight from the button", () => {
  it("has no consent checkbox or consent wording on the audio screens", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/type="checkbox"/);
      expect(source, file).not.toMatch(/동의해요|동의해야|동의하기 전까지|동의하고 실행/);
      expect(source, file).not.toMatch(/setConsent|setTransferConsent|setAnalysisConsent/);
    }
  });

  it("does not gate the run buttons on consent", () => {
    const direct = readFileSync("components/admin/admin-music-semantic.tsx", "utf8");
    expect(direct).toContain('disabled={!!fileIssue || disabled} onClick={analyze}');
    expect(direct).not.toContain("음악 의미 분석</h3>");
    const large = readFileSync("components/admin/admin-audio-upload.tsx", "utf8");
    expect(large).toContain("const transferAgreed = !!ready;");
    expect(large).toContain("const analysisAgreed = !!conditionKey;");
  });
});
