import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeLocalMediaUrl } from "../../lib/reference-analysis/local-media-url";
import { AnalysisStageError } from "../../lib/reference-analysis/media-url-error";

const runMedia = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("../../lib/media/tools", () => ({ mediaBinary: (name: string) => name, runMedia }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  runMedia.mockReset();
});

// 운영 422 원인 후보의 작동 방식: 이미 끝난 요청 신호를 넘기면 매체와 관계없이 내려받기 전에 fetch 단계에서 멈춘다.
// 처리기는 이제 이 신호를 넘기지 않는다(admin-reference-http.test.ts). 네트워크에는 나가지 않는다(이미 끝난 신호).
describe("공개 URL 분석의 실패 단계", () => {
  it.each(["https://mdn.github.io/a.png", "https://tonejs.github.io/audio/a.mp3", "https://mdn.github.io/a.mp4"])("끝난 요청 신호면 %s는 fetch 단계 취소다", async (url) => {
    const ended = AbortSignal.abort();
    const error = await analyzeLocalMediaUrl(url, undefined, ended).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnalysisStageError);
    expect(error).toMatchObject({ stage: "fetch", detail: "cancelled" });
    expect(String((error as Error).message)).not.toContain("mdn");
  });

  it.each(["fetch", "download"] as const)("전체 시한 만료를 %s 단계의 timed_out으로 돌려준다", async (stage) => {
    const deadline = new AbortController();
    const expire = () => deadline.abort(new DOMException("Synthetic deadline", "TimeoutError"));
    const timer = vi.spyOn(AbortSignal, "timeout").mockImplementationOnce(() => deadline.signal);
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (stage === "fetch") {
        expire();
        deadline.signal.throwIfAborted();
      }
      return new Response(new ReadableStream({ pull(controller) {
        expire();
        controller.error(deadline.signal.reason);
      } }, { highWaterMark: 0 }));
    }));

    await expect(analyzeLocalMediaUrl("https://mdn.github.io/a.mp4")).rejects.toMatchObject({ stage, detail: "timed_out" });
    expect(timer).toHaveBeenCalledWith(30_000);
  });

  it.each([
    { first: "overall", detail: "timed_out" },
    { first: "inspection", detail: "timed_out" },
    { first: "external", externalReason: "AbortError", detail: "cancelled" },
    { first: "external", externalReason: "TimeoutError", detail: "cancelled" },
  ])("검사 단계에서 먼저 끝난 신호를 반영한다 ($first $externalReason)", async ({ first, externalReason, detail }) => {
    const media = await readFile(new URL("../fixtures/backups/s6-inputs/render-passed.mp4", import.meta.url));
    const overall = new AbortController();
    const inspection = new AbortController();
    const external = new AbortController();
    const timer = vi.spyOn(AbortSignal, "timeout")
      .mockImplementationOnce(() => overall.signal)
      .mockImplementationOnce(() => inspection.signal);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(media))));
    runMedia.mockImplementation(async (_bin: string, _args: string[], { signal }: { signal: AbortSignal }) => {
      if (first === "external") external.abort(new DOMException("Synthetic external interruption", externalReason));
      if (first === "inspection") inspection.abort(new DOMException("Synthetic inspection deadline", "TimeoutError"));
      overall.abort(new DOMException("Synthetic overall deadline", "TimeoutError"));
      signal.throwIfAborted();
    });

    await expect(analyzeLocalMediaUrl("https://mdn.github.io/a.mp4", undefined, external.signal))
      .rejects.toMatchObject({ stage: "inspect", detail });
    expect(runMedia).toHaveBeenCalledOnce();
    expect(timer.mock.calls.slice(0, 2)).toEqual([[30_000], [30_000]]);
  });
});
