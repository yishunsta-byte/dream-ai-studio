// 주인님 지시(2026-11-24): API연동 카드의 저장 상태·마지막 저장 칸과 YouTube 회색 안내 줄을 없애고 위쪽에 등록됨/등록 안 됨만 보인다.
// 오디오 분석 왼쪽 메뉴의 API키등록·플랫폼연동 버튼은 위쪽 관리자 메뉴의 같은 항목과 겹쳐 지웠다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("settings cards show only registered / not registered", () => {
  it("has no saved-state or last-saved boxes on the AI engine and YouTube cards", () => {
    for (const file of ["components/admin/admin-gemini-settings.tsx", "components/admin/admin-style-dna-engine-settings.tsx", "components/admin/admin-youtube-settings.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain("<dt>저장 상태</dt>");
      expect(source, file).not.toContain("<dt>마지막 저장</dt>");
      expect(source, file).toContain("styles.stateBadge");
      expect(source, file).toContain('"등록됨"');
      expect(source, file).toContain('"등록 안 됨"');
    }
    expect(read("components/admin/admin-youtube-settings.tsx")).not.toContain("{status.text}");
  });

  it("removes the duplicate API key link from the audio studio sidebar", () => {
    const source = read("components/admin/audio-original/audio-studio.tsx");
    expect(source).not.toMatch(/<span>API키등록·플랫폼연동<\/span>/);
  });
});
