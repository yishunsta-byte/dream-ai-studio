// 주인님 지시(2026-11-24): 분석 중에는 하단에 움직이는 진행 막대와 지난 시간이 보여야 하고, Suno 분석 프롬프트는 칸에 잘리지 않고 다 보여야 한다.
// Master 검수: 모델 대기 예산(120·200초)은 전체 최대가 아니므로, 숫자는 경로 함수 한도(300초)만 보인다.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudioAnalysisProgress, audioRouteLimitSeconds, elapsedLabel } from "@/components/admin/audio-analysis-progress";
import { fitPrompt } from "@/components/admin/admin-suno-prompt";

const routeSeconds = (path: string) => Number(/export const maxDuration = (\d+);/.exec(readFileSync(path, "utf8"))?.[1]);

describe("analysis progress bar", () => {
  it("shows a moving bar, the elapsed time and only the real route limit", () => {
    const html = renderToStaticMarkup(createElement(AudioAnalysisProgress));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="분석 진행 중"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("0초 지남 · 막대가 움직이면 분석이 진행 중이에요. 늦어도 5분 0초 안에 결과나 안내가 나와요.");
    expect(html).not.toMatch(/2분 0초|3분 20초|최대/);
    expect(elapsedLabel(59)).toBe("59초");
    expect(elapsedLabel(125)).toBe("2분 5초");
  });

  it("uses the function limit of every audio analysis route", () => {
    for (const path of ["app/api/admin/audio-analysis/route.ts", "app/api/admin/music-semantic/route.ts", "app/api/admin/audio-uploads/[id]/route.ts"]) {
      expect(routeSeconds(path), path).toBe(audioRouteLimitSeconds);
    }
  });

  it("is placed under the run button on both direct analysis and large-file upload", () => {
    expect(readFileSync("components/admin/admin-music-semantic.tsx", "utf8")).toContain("{busy && <AudioAnalysisProgress />}");
    expect(readFileSync("components/admin/admin-audio-upload.tsx", "utf8")).toContain('{work === "analyze" && <AudioAnalysisProgress />}');
    const css = readFileSync("components/admin/audio-analysis-progress.module.css", "utf8");
    expect(css).toMatch(/animation: slide/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe("Suno prompt is fully visible", () => {
  it("grows the prompt box to the full text height", () => {
    const box = { style: { height: "" }, scrollHeight: 420, offsetHeight: 98, clientHeight: 96 } as unknown as HTMLTextAreaElement;
    fitPrompt(box);
    expect(box.style.height).toBe("422px");
    expect(() => fitPrompt(null)).not.toThrow();
    const css = readFileSync("components/admin/admin-music-semantic.module.css", "utf8");
    expect(css).toMatch(/\.prompt \{[^}]*field-sizing: content;[^}]*overflow-y: hidden;/);
  });
});
