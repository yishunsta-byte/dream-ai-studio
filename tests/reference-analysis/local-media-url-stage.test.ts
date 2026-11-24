import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { analyzeLocalMediaUrl } from "../../lib/reference-analysis/local-media-url";
import { AnalysisStageError } from "../../lib/reference-analysis/media-url-error";

const decoder = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/media/tools", () => ({ mediaBinary: (name: string) => name, runMedia: decoder.run }));

const stage = (promise: Promise<unknown>) => promise.then(() => undefined, (caught: unknown) => caught);
const timeoutError = () => new DOMException("The operation timed out.", "TimeoutError");

// 운영 422 원인 후보의 작동 방식: 이미 끝난 호출자 신호를 넘기면 매체와 관계없이 내려받기 전에 fetch 단계에서 멈춘다.
// 처리기는 이제 이 신호를 넘기지 않는다(admin-reference-http.test.ts). 네트워크에는 나가지 않는다(이미 끝난 신호).
describe("공개 URL 분석의 실패 단계", () => {
  it.each(["https://mdn.github.io/a.png", "https://tonejs.github.io/audio/a.mp3", "https://mdn.github.io/a.mp4"])("끝난 호출자 신호면 %s는 fetch 단계 cancelled다", async (url) => {
    const error = await stage(analyzeLocalMediaUrl(url, undefined, AbortSignal.abort()));
    expect(error).toBeInstanceOf(AnalysisStageError);
    expect(error).toMatchObject({ stage: "fetch", detail: "cancelled" });
    expect(String((error as Error).message)).not.toContain("mdn");
  });
});

// Tester 재현(msg_1841f1afcf0c): 내려받은 뒤 검사 중 자체 30초 시한이 끝나면 cancelled가 아니라 timed_out이어야 한다.
// 호출자 신호는 AbortError든 TimeoutError든 cancelled로 남는다.
describe("검사 단계의 시한과 취소 구분", () => {
  async function inspectWith(stop: (own: AbortController, caller: AbortController) => void, withCaller: boolean) {
    const bytes = await readFile(new URL("../fixtures/backups/s6-inputs/render-passed.mp4", import.meta.url));
    const own = new AbortController();
    const caller = new AbortController();
    const original = AbortSignal.timeout.bind(AbortSignal);
    const timer = vi.spyOn(AbortSignal, "timeout").mockImplementation(original).mockImplementationOnce(() => own.signal);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
    decoder.run.mockReset().mockImplementation(async (_file: string, _args: string[], options: { signal: AbortSignal }) => {
      stop(own, caller);
      options.signal.throwIfAborted();
    });
    try {
      const error = await stage(analyzeLocalMediaUrl("https://mdn.github.io/stage-fixture.mp4", undefined, withCaller ? caller.signal : undefined));
      expect(timer.mock.calls[0]).toEqual([30_000]);
      expect(decoder.run).toHaveBeenCalledOnce();
      return error;
    } finally {
      vi.unstubAllGlobals();
      timer.mockRestore();
    }
  }

  it("자체 시한이 검사 중 끝나면 inspect timed_out", async () => {
    expect(await inspectWith((own) => own.abort(timeoutError()), false)).toMatchObject({ stage: "inspect", detail: "timed_out" });
    expect(await inspectWith((own) => own.abort(timeoutError()), true)).toMatchObject({ stage: "inspect", detail: "timed_out" });
  });

  it("호출자 신호는 TimeoutError든 AbortError든 inspect cancelled", async () => {
    expect(await inspectWith((_own, caller) => caller.abort(timeoutError()), true)).toMatchObject({ stage: "inspect", detail: "cancelled" });
    expect(await inspectWith((_own, caller) => caller.abort(), true)).toMatchObject({ stage: "inspect", detail: "cancelled" });
  });
});

describe("내려받기 단계의 시한", () => {
  it("응답을 기다리다 자체 시한이 끝나면 fetch timed_out", async () => {
    const own = new AbortController();
    const original = AbortSignal.timeout.bind(AbortSignal);
    const timer = vi.spyOn(AbortSignal, "timeout").mockImplementation(original).mockImplementationOnce(() => own.signal);
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
      own.abort(timeoutError());
    })));
    try {
      expect(await stage(analyzeLocalMediaUrl("https://mdn.github.io/slow.png"))).toMatchObject({ stage: "fetch", detail: "timed_out" });
    } finally {
      vi.unstubAllGlobals();
      timer.mockRestore();
    }
  });
});
