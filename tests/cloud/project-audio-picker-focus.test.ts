import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 검수 LOCAL-PROJECT-EDITING-AUDIO-PICKER: '연결 상태 다시 확인' 뒤 버튼이 사라지며 초점이 BODY로 떨어졌다.
const source = readFileSync("components/cloud/project-audio-picker.tsx", "utf8");

describe("편집 음원 선택: 재시도 뒤 키보드 초점", () => {
  it("항상 남는 바깥 영역이 초점을 받을 수 있고, 재시도를 누르면 먼저 그곳으로 옮긴다", () => {
    expect(source).toMatch(/<div ref=\{root\} tabIndex=\{-1\} aria-label="편집 음원">\{content\(\)\}<\/div>/);
    expect(source).toMatch(/function reload\(\) \{\s*pendingFocus\.current = true;\s*root\.current\?\.focus\(\);/);
  });
  it("결과가 그려지면 같은 음원 플레이어, 없으면 선택 상자, 다시 실패하면 재시도 버튼으로 옮긴다", () => {
    expect(source).toContain('failed ? area?.querySelector<HTMLElement>("button") : (area?.querySelector<HTMLElement>("audio") ?? area?.querySelector<HTMLElement>("select"))');
    expect(source).toMatch(/if \(!pendingFocus\.current \|\| \(!tracks && !failed\)\) return;/);
  });
});
