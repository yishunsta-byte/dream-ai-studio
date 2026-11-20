import { describe, expect, it, vi } from "vitest";
import { analyzeLocalMediaUrl } from "../../lib/reference-analysis/local-media-url";
import { AnalysisStageError } from "../../lib/reference-analysis/media-url-error";

vi.mock("server-only", () => ({}));

// 운영 422 원인 후보의 작동 방식: 이미 끝난 요청 신호를 넘기면 매체와 관계없이 내려받기 전에 fetch 단계에서 멈춘다.
// 처리기는 이제 이 신호를 넘기지 않는다(admin-reference-http.test.ts). 네트워크에는 나가지 않는다(이미 끝난 신호).
describe("공개 URL 분석의 실패 단계", () => {
  it.each(["https://mdn.github.io/a.png", "https://tonejs.github.io/audio/a.mp3", "https://mdn.github.io/a.mp4"])("끝난 요청 신호면 %s는 fetch 단계 AbortError다", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ended = AbortSignal.abort();
    const error = await analyzeLocalMediaUrl(url, undefined, ended).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnalysisStageError);
    expect(error).toMatchObject({ stage: "fetch", detail: "AbortError" });
    expect(String((error as Error).message)).not.toContain("mdn");
    fetchSpy.mockRestore();
  });
});
