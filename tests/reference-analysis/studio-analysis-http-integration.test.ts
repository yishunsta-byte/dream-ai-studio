import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioRegisteredAnalysisProvider } from "../../components/reference-analysis/studio-registered-analysis-provider";
import { analysisPath, credential, ownerId, selection, startStudioAnalysisHttpFixture } from "./studio-analysis-http-integration-fixture";

vi.mock("server-only", () => ({}));

type Fixture = Awaited<ReturnType<typeof startStudioAnalysisHttpFixture>>;
const materials = [{ ...selection, label: "합성 등록 이미지" }];
const failure = (reason: string) => ({ schemaVersion: 1, status: "unavailable", reason });
const browserExecutable = process.env.DREAM_REA_HTTP_BROWSER;
let fixture: Fixture | undefined;

async function start(options?: Parameters<typeof startStudioAnalysisHttpFixture>[0]) {
  fixture = await startStudioAnalysisHttpFixture(options);
  return fixture;
}

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

function provider(fixture: Fixture, timeoutMs = 4_000) {
  return createStudioRegisteredAnalysisProvider({ materials, uri: fixture.origin + analysisPath, transport: fetch, timeoutMs });
}

async function stage(fixture: Fixture, index: number) {
  await vi.waitFor(() => expect(fixture.requests[index]?.stalled).toBeDefined(), { timeout: 2_000 });
  const dirs = await readdir(fixture.root);
  expect(dirs).toHaveLength(1);
  expect(dirs[0]).toMatch(/^dream-studio-source-/);
  expect((await stat(join(fixture.root, dirs[0], "reference.png"))).size).toBeGreaterThan(0);
}

async function cleaned(fixture: Fixture, index: number, reason: string, disconnected: boolean) {
  await vi.waitFor(() => expect(fixture.requests[index].result).toEqual(failure(reason)), { timeout: 2_000 });
  expect(fixture.requests[index].signal.aborted).toBe(disconnected);
  expect(await readdir(fixture.root)).toEqual([]);
}

describe("isolated Studio analysis HTTP integration", () => {
  it("projects a registered PNG over HTTP and rejects unauthorized selection before storage", async () => {
    const local = await start();
    const connected = provider(local);
    const analyze = () => connected.analyze(selection, new AbortController().signal);
    for (const mode of ["denied", "other"] as const) {
      local.setNextMode(mode);
      expect(await analyze()).toEqual(failure("source_unavailable"));
    }
    const invalid = await fetch(local.origin + analysisPath, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...selection, path: "synthetic-foreign-path" }),
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual(failure("invalid_selection"));
    expect(local.requests[2].authCalls).toBe(0);
    expect(local.storageReads).toEqual([]);

    const result = await analyze();
    expect(result).toMatchObject({ status: "ready", media: "image", proposals: expect.arrayContaining([expect.objectContaining({
      observations: [expect.objectContaining({ kind: "observation", alphaCoverage: 1 })],
      draft: expect.objectContaining({ kind: "creative_proposal", prompt: expect.stringContaining("#e02020") }),
    })]) });
    expect(local.requests[3].input).toEqual(selection);
    expect(local.requests[3].signal.aborted).toBe(false);
    expect(local.storageReads).toEqual(["/storage/v1/bucket/t294-isolated", local.objectPath, local.objectPath]);
    for (const privateValue of [ownerId, credential, local.sha256, local.objectPath, local.root, ...Object.values(selection)]) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
    expect(await readdir(local.root)).toEqual([]);
  });

  it.each(["caller cancel", "client deadline"] as const)("cleans the staged file and returns the slot on %s", async (mode) => {
    const local = await start();
    const connected = provider(local, mode === "client deadline" ? 2_000 : 4_000);
    const caller = new AbortController();
    local.setNextMode("stall-after-staging");
    const first = connected.analyze(selection, caller.signal);
    await stage(local, 0);
    const storageCount = local.storageReads.length;
    expect(await connected.analyze(selection, new AbortController().signal)).toEqual(failure("source_unavailable"));
    expect(local.requests[1].authCalls).toBe(0);
    expect(local.storageReads).toHaveLength(storageCount);

    if (mode === "caller cancel") caller.abort();
    expect(await first).toEqual(failure(mode === "caller cancel" ? "analysis_unavailable" : "timed_out"));
    await cleaned(local, 0, "cancelled", true);
    const retry = await connected.analyze(selection, new AbortController().signal);
    expect(retry.status).toBe("ready");
    expect(local.requests.map(({ input }) => input)).toEqual([selection, selection, selection]);
    local.requests[0].stalled?.resolve({ kind: "verified", userId: ownerId, email: "owner@example.invalid" });
    await setImmediate();
    expect(local.requests[0].result).toEqual(failure("cancelled"));
    expect(local.requests[0].authCalls).toBe(2);
    expect(local.storageReads).toHaveLength(storageCount * 2);
    expect(await readdir(local.root)).toEqual([]);
  });

  it("returns the server deadline over a still-connected HTTP request after cleanup", async () => {
    const local = await start({ serverTimeoutMs: 1_500 });
    const connected = provider(local, 4_000);
    local.setNextMode("stall-after-staging");
    const first = connected.analyze(selection, new AbortController().signal);
    await stage(local, 0);
    expect(await first).toEqual(failure("timed_out"));
    await cleaned(local, 0, "timed_out", false);
    expect((await connected.analyze(selection, new AbortController().signal)).status).toBe("ready");
  });

  it.skipIf(!browserExecutable)("runs selection, analysis, editing, copy and cancellation retries in the actual T291 UI", async () => {
    const [{ build }, { openBrowser }] = await Promise.all([import("esbuild"), import("@remotion/renderer")]);
    const { outputFiles } = await build({
      entryPoints: [fileURLToPath(new URL("./studio-analysis-http-integration-browser.tsx", import.meta.url))],
      bundle: true, platform: "browser", jsx: "automatic", write: false, outfile: "fixture.js",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const js = outputFiles.find(({ path }) => path.endsWith(".js"))?.text;
    const css = outputFiles.find(({ path }) => path.endsWith(".css"))?.text;
    if (!js || !css) throw new Error("Missing browser fixture bundle");
    const local = await start({ bundle: { js, css } });
    const browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell", logLevel: "error" });
    try {
      const page = await browser.newPage({ context: () => null, logLevel: "error", onLog: () => {}, indent: false, pageIndex: 0, onBrowserLog: null });
      await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
      await page.goto({ url: local.origin, timeout: 5_000 });
      const status = (text: string) => vi.waitFor(async () => {
        expect(await page.evaluate((phrase: string) => [...document.querySelectorAll("[role=status]")]
          .some((element) => element.textContent?.includes(phrase)), text)).toBe(true);
      }, { timeout: 4_000 });
      async function click(label: string) {
        expect(await page.evaluate((text: string) => {
          const button = [...document.querySelectorAll("button")].find((node) => node.textContent === text);
          if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
          button.focus();
          button.click();
          return true;
        }, label)).toBe(true);
      }

      await status("분석할 등록 자료를 선택해 주세요.");
      expect(await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>('select[id$="-material"]');
        if (!select || select.options[1]?.text !== "합성 등록 이미지") return false;
        select.value = select.options[1].value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })).toBe(true);
      await click("분석 실행");
      await status("분석이 완료됐어요.");
      const rendered = await page.evaluate(() => ({
        headings: [...document.querySelectorAll("h4")].map((node) => node.textContent),
        evidence: document.querySelector("ol")?.textContent,
        prompt: document.querySelector("textarea")?.value,
        original: [...document.querySelectorAll("h5")].find((element) => element.textContent === "분석으로 생성한 초안")?.nextElementSibling?.textContent,
      }));
      expect(rendered.headings).toEqual(["관찰 근거", "분석 추정", "창작 초안"]);
      expect(rendered.evidence).toContain("불투명도 반영 면적 100%");
      const ready = local.requests[0].result;
      expect(ready?.status).toBe("ready");
      if (ready?.status !== "ready") throw new Error("Missing HTTP analysis result");
      expect(rendered.prompt).toBe(ready.proposals[0].draft.prompt);
      expect(rendered.original).toBe(rendered.prompt);
      await click("초안 복사");
      await status("창작 초안을 복사했어요.");

      const edited = "편집한 합성 이미지 프롬프트";
      await page.evaluate((text: string) => {
        const field = document.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }, edited);
      expect(await page.evaluate(() => [...document.querySelectorAll("h5")]
        .find((element) => element.textContent === "분석으로 생성한 초안")?.nextElementSibling?.textContent)).toBe(rendered.original);
      await click("수정본 복사");
      await status("수정본을 복사했어요.");
      expect(await page.evaluate(() => (window as Window & { fixtureCopied?: string[] }).fixtureCopied)).toEqual([rendered.prompt, edited]);

      local.setNextMode("stall-after-staging");
      await click("다시 분석");
      await stage(local, 1);
      await click("분석 취소");
      await status("취소 완료를 확인할 수 없어 결과를 표시하지 않았어요.");
      await cleaned(local, 1, "cancelled", true);
      local.setNextMode("stall-after-staging");
      await click("다시 분석");
      await stage(local, 2);
      await status("분석 시간이 초과됐어요.");
      await cleaned(local, 2, "cancelled", true);
      await click("다시 분석");
      await status("분석이 완료됐어요.");
      expect(local.requests.map(({ input }) => input)).toEqual([selection, selection, selection, selection]);
      expect(await readdir(local.root)).toEqual([]);
    } finally {
      await browser.close({ silent: true });
    }
  }, 25_000);
});
