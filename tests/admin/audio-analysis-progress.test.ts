// 주인님 지시(2026-11-24): 분석 중에는 하단에 움직이는 진행 막대와 지난 시간이 보여야 하고, Suno 분석 프롬프트는 칸에 잘리지 않고 다 보여야 한다.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AudioAnalysisProgress, audioWaitSeconds, elapsedLabel, largeFilePreparationSeconds } from "@/components/admin/audio-analysis-progress";
import { fitPrompt } from "@/components/admin/admin-suno-prompt";
import { detailedAudioDeadlineMs } from "@/lib/reference-analysis/admin-audio-details-server";
import { audioProviderDeadlineMs } from "@/lib/reference-analysis/admin-audio-gemini";

describe("analysis progress bar", () => {
  it("shows a moving bar and the elapsed time with the server's real wait limit", () => {
    const html = renderToStaticMarkup(createElement(AudioAnalysisProgress, { limitSeconds: 200 }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="분석 진행 중"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("0초 지남 · 최대 3분 20초까지 기다려요. 막대가 움직이면 분석이 진행 중이에요.");
    expect(elapsedLabel(59)).toBe("59초");
    expect(elapsedLabel(125)).toBe("2분 5초");
  });

  it("uses the same wait limits as the server", () => {
    expect(audioWaitSeconds.basic * 1000).toBe(audioProviderDeadlineMs);
    expect(audioWaitSeconds.detailed * 1000).toBe(detailedAudioDeadlineMs);
    expect(largeFilePreparationSeconds).toBe(50);
  });

  it("is placed under the run button on both direct analysis and large-file upload", () => {
    const direct = readFileSync("components/admin/admin-music-semantic.tsx", "utf8");
    expect(direct).toContain("{busy && <AudioAnalysisProgress limitSeconds={detail ? audioWaitSeconds.detailed : audioWaitSeconds.basic} />}");
    const large = readFileSync("components/admin/admin-audio-upload.tsx", "utf8");
    expect(large).toMatch(/\{work === "analyze" && <AudioAnalysisProgress limitSeconds=\{largeFilePreparationSeconds \+/);
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
