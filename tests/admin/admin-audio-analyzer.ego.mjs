/* global taskSpace, URLSearchParams, URL, Response, Headers, window, location, document, File, DataTransfer, DragEvent, Event, history, fetch, console */
// Run against the loopback production build with synthetic administrator authentication.
const { default: assert } = await import("node:assert/strict");
const { mkdir, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const proof = globalThis.FIXTURE_OUTPUT_DIR ?? join(tmpdir(), "dream-audio-embed-qa");
await mkdir(proof, { recursive: true });
const task = await taskSpace(globalThis.FIXTURE_SPACE ?? "관리자 오디오 원본 작업실");
const page = task.page("p1");
console.log({ space: task.spaceId });
const root = "#admin-music-analysis";
const menu = 'nav[aria-label="관리 메뉴"]';
const project = "0190a0b0-0000-7000-8000-000000000001";
const scene = "0190a0b0-0000-7000-8000-000000000011";
const query = new URLSearchParams({ project, scene });
const open = async path => {
  const url = base + path;
  await page.goto(globalThis.FIXTURE_LOGIN_PATH
    ? `${base}${globalThis.FIXTURE_LOGIN_PATH}${encodeURIComponent(path)}`
    : url);
};
const wait = (callback, args) => page.waitForFunction(callback, args, { timeout: 10000 });

async function installSyntheticAnswers() {
  await page.evaluate(({ project, scene }) => {
    const nativeFetch = window.fetch.bind(window);
    const events = [];
    const originalPrompt = "합성 Suno 프롬프트";
    const music = {
      status: "ready", provider: "gemini",
      report: { genre: "앰비언트", instruments: ["피아노"], tempoBpm: 96, structure: [{ label: "도입", description: "피아노로 시작" }], sunoPrompt: originalPrompt },
    };
    const speech = {
      status: "ready", kind: "speech", provider: "gemini",
      report: { summary: "합성 회의 요약", topicsAndKeywords: null, actionItems: [{ task: "체크리스트 정리", assignee: null, dueDate: null }],
        fullTranscription: [{ speaker: "화자 1", timestamp: "00:01", text: "합성 대화" }] },
    };
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    window.__embedAudioEvents = events;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
      const method = init?.method ?? "GET";
      if (url.origin !== location.origin) {
        events.push({ external: url.hostname });
        throw new Error("외부 호출은 검수 범위 밖입니다.");
      }
      const path = url.pathname;
      if (path === "/api/auth/session") return nativeFetch(input, init);
      if (path === `/api/projects/${project}/production`) {
        events.push({ path, method });
        return response({ scenes: [{ id: scene, position: 1, title: "합성 장면" }] });
      }
      if (path === "/api/admin/music-semantic" && method === "GET") return response({ semantic: { music: "configured" } });
      if (path === "/api/admin/music-semantic" || path === "/api/admin/audio-analysis") {
        const headers = new Headers(init?.headers);
        const mode = headers.get("x-dream-audio-mode") ?? "music";
        events.push({ path, method, mode, consent: headers.get("x-dream-music-external-consent"), sent: init?.body?.size });
        return response(mode === "music"
          ? { semantic: music }
          : { schemaVersion: 1, requestedMode: mode, ...speech });
      }
      if (method !== "GET") {
        events.push({ path, method });
        return response({ error: "fixture_write_disallowed" }, 503);
      }
      return nativeFetch(input, init);
    };
  }, { project, scene });
}

async function putWave(name, seconds, drop = false) {
  await page.evaluate(({ root, name, seconds, drop }) => {
    const count = seconds * 8000;
    const view = new DataView(new ArrayBuffer(44 + count * 2));
    const signature = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    signature(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); signature(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); signature(36, "data"); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i += 1) view.setInt16(44 + i * 2, Math.sin(i / 8) * 24000 * i / count, true);
    const transfer = new DataTransfer();
    transfer.items.add(new File([view.buffer], name, { type: "audio/wav" }));
    const input = document.querySelector(`${root} input[type=file]`);
    if (drop) {
      const zone = input.closest("label");
      zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    } else {
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { root, name, seconds, drop });
  await wait(({ root, name, seconds }) => {
    const wave = document.querySelector(`${root} section:has(> audio)`);
    return wave?.querySelector("h4")?.textContent === name && Math.abs(wave.querySelector("audio").duration - seconds) < 0.01
      && wave.querySelectorAll("[aria-hidden=true] > span[style]").length === 120;
  }, { root, name, seconds });
}

const rows = [];
for (const width of [1440, 390, 320]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await open(`/admin?${query}`);
  await page.waitForSelector(`${menu} a[href="${root}"]`);
  await installSyntheticAnswers();
  await page.focus(`loc=css:${menu} a[href="${root}"]`);
  await page.keyboard.press("Enter");
  await wait(root => location.hash === root && document.activeElement?.id === `${root.slice(1)}-title`, root);
  await page.waitForSelector(`${root} [data-audio-studio=embedded]`);
  const layout = await page.evaluate(root => {
    const panel = document.querySelector(root);
    const studio = panel.querySelector("[data-audio-studio]");
    const bar = document.querySelector('nav[aria-label="관리 메뉴"]').getBoundingClientRect();
    const sidebar = studio.querySelector("aside").getBoundingClientRect();
    const modes = studio.querySelector('[aria-label="분석 모드"]').getBoundingClientRect();
    const drawer = studio.querySelector("[aria-expanded]");
    return {
      main: document.querySelectorAll("main").length, globalHeader: document.querySelectorAll("header").length,
      oneFile: panel.querySelectorAll("input[type=file]").length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      below: studio.getBoundingClientRect().top >= bar.bottom, leftRail: sidebar.right < modes.left, mobileDrawer: !!drawer.getClientRects().length,
      auto: panel.querySelector('[aria-label="분석 모드"] button[aria-pressed=true]').textContent.trim(),
      report: panel.querySelector('input[type=radio]:checked').value, path: location.pathname,
    };
  }, root);
  assert.deepEqual(layout, { main: 1, globalHeader: 1, oneFile: 1, overflow: 0, below: true, leftRail: width === 1440, mobileDrawer: width !== 1440,
    auto: "스마트 자동 감지", report: "detail", path: "/admin" });
  await page.waitForSelector(`${root} a[href="/cloud/projects/${project}/produce?scene=${scene}"]`);
  await page.screenshot({ path: `${proof}/audio-embedded-${width}.png` });

  if (width !== 1440) await page.click('loc=role:button[name="오디오 스튜디오 메뉴"]');
  await page.click(`loc=css:${root} aside button:has-text("음성 인텔리전스")`);
  await wait(root => document.querySelector(`${root} [aria-label="분석 모드"] button[aria-pressed=true]`)?.textContent.includes("음성"), root);
  if (width !== 1440) assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-expanded")), "false");
  await page.click('loc=role:button[name="스마트 자동 감지"]');
  await putWave("tone-2.wav", 2, true);
  await page.focus(`loc=css:${root} input[type=range]`);
  for (let step = 0; step < 8; step += 1) await page.keyboard.press("ArrowRight");
  await wait(root => document.querySelector(`${root} audio`).currentTime > 0.5, root);
  assert.equal(await page.evaluate(() => window.__embedAudioEvents.filter(row => row.method === "POST").length), 0);

  await page.focus(`loc=css:${root} input[value=basic]`);
  await page.keyboard.press("Space");
  await wait(root => document.querySelector(`${root} input[value=basic]`)?.checked, root);
  await page.waitForSelector(`${root} input[type=checkbox]`);
  await page.click(`loc=css:${root} input[type=checkbox]`);
  await page.click('loc=role:button[name="자동 판별 분석 실행"]');
  await wait(root => document.querySelector(root).textContent.includes("합성 회의 요약"), root);

  await page.click('loc=role:button[name="음성 · 회의록"]');
  await page.click(`loc=css:${root} input[type=checkbox]`);
  await page.click('loc=role:button[name="음성 분석 실행"]');
  await wait(root => document.querySelector(root).textContent.includes("합성 회의 요약"), root);

  await page.click('loc=role:button[name="음악 · Suno v6"]');
  await page.click(`loc=css:${root} input[type=checkbox]`);
  await page.click('loc=role:button[name="음악 의미 분석 실행"]');
  await wait(root => document.querySelector(`${root} textarea[aria-label="Suno용 프롬프트 제안"]`)?.value === "합성 Suno 프롬프트", root);
  await page.fill(`loc=css:${root} textarea[aria-label="Suno용 프롬프트 제안"]`, "화면에서 수정한 프롬프트");
  await page.click('loc=role:button[name="공개 준비"]');
  await wait(() => location.hash === "#admin-analysis-results");
  await wait(() => [...document.querySelectorAll("#admin-analysis-results textarea")].some(field => field.value === "합성 Suno 프롬프트"));

  const events = await page.evaluate(() => window.__embedAudioEvents);
  assert.equal(events.some(row => row.external), false);
  assert.deepEqual(events.filter(row => row.method === "POST").map(row => row.mode), ["auto", "speech", "music"]);
  assert.equal(events.filter(row => row.method === "POST").every(row => row.sent > 0 && row.consent === "true"), true);
  await page.evaluate(() => history.back());
  await wait(root => location.hash === root && document.querySelector(`${root} [data-audio-studio=embedded]`), root);
  await putWave("tone-3.wav", 3);
  await page.fill('loc=role:textbox[name="사용자 컨텍스트 (선택 사항)"]', "합성 분석 맥락");
  await wait(root => document.querySelector(root).textContent.includes("업로드 후 분석"), root);
  await page.click('loc=role:button[name="파일 교체"]');
  await wait(root => document.activeElement === document.querySelector(`${root} input[type=file]`), root);
  assert.equal(await page.evaluate(root => document.querySelector(`${root} textarea`)?.value, root), "합성 분석 맥락");
  if (width === 1440) {
    await page.click('loc=role:link[name="API 키 설정"]');
    await wait(() => location.pathname === "/admin" && location.hash === "#admin-api-integrations");
    await page.evaluate(() => history.back());
    await wait(root => location.hash === root && document.querySelector(`${root} [data-audio-studio=embedded]`), root);
  }
  rows.push({ width, ...layout, analysis: events.filter(row => row.method === "POST"), external: 0 });
}
await open("/admin/audio-analysis");
await page.waitForSelector('[data-audio-studio="standalone"]');
assert.equal(await page.evaluate(() => document.querySelectorAll("main").length), 1);
assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-audio-studio="standalone"] a')].every(a => a.hash === "#admin-api-integrations" && a.pathname === "/admin")), true);
const denied = await fetch(`${base}/admin/audio-analysis?${query}`, { redirect: "manual" });
assert.equal(denied.status, 307);
assert.equal(new URL(denied.headers.get("location"), base).searchParams.get("next"), `/admin/audio-analysis?${query}`);
await writeFile(`${proof}/verification.json`, JSON.stringify({ rows, standalone: true, denied: 307 }, null, 2));
console.log({ space: task.spaceId, rows });
