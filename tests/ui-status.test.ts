import { describe, expect, it } from "vitest";
import { statusDisplay } from "@/lib/ui/status";

describe("작업 상태 표시", () => {
  it("모든 상태에 글자·아이콘·색 역할이 있으며 샘플은 전용 색을 사용한다", () => {
    expect(Object.keys(statusDisplay)).toHaveLength(9);
    for (const state of Object.values(statusDisplay)) {
      expect(state.label.length).toBeGreaterThan(0);
      expect(state.icon.length).toBeGreaterThan(0);
      expect(state.tone.length).toBeGreaterThan(0);
    }
    expect(Object.entries(statusDisplay).filter(([, value]) => value.tone === "sample").map(([key]) => key)).toEqual(["sample"]);
    expect(statusDisplay.running.icon).toBe("spinner");
    expect(statusDisplay.failed.label).toBe("실패");
  });
});
