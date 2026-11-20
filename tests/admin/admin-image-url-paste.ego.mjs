/* global taskSpace, window, document, navigator, getComputedStyle, console, DOMException, setTimeout, location */
import assert from "node:assert/strict";
// 이미지 분석 URL 붙여넣기: admin-premiere-publication-run.mjs가 연 루프백 주소에서 실행한다.
// 클립보드는 페이지 안에서 대역으로 바꿔 권한 거절·빈 값·정상 값·지연을 재현한다(실제 클립보드는 읽지 않음).
const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Image URL paste " + Date.now());
const page = task.page("p1");
const section = "#admin-style-dna";
const urlInput = `${section} input[type=url]`;
const results = [];

const clipboard = (mode, text = "") => page.evaluate(({ mode, text }) => {
  const reader = {
    deny: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    missing: () => { throw new TypeError("clipboard unavailable"); },
    text: () => Promise.resolve(text),
    held: () => new Promise((resolve) => { window.__releaseClipboard = () => resolve(text); }),
  }[mode];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: reader } });
}, { mode, text });
const state = () => page.evaluate(({ section, urlInput }) => {
  const root = document.querySelector(section);
  const input = document.querySelector(urlInput);
  const paste = [...root.querySelectorAll("button")].find((button) => button.textContent.trim() === "붙여넣기");
  const notice = document.getElementById(input.getAttribute("aria-describedby"));
  return {
    value: input.value,
    focused: document.activeElement === input,
    notice: notice?.textContent ?? null,
    noticeRole: notice?.getAttribute("role") ?? null,
    noticeVisible: !!notice && getComputedStyle(notice).display !== "none",
    pasteDisabled: paste?.disabled ?? null,
    consent: root.querySelector("input[type=checkbox]")?.checked ?? null,
    posts: window.__premiere.requests().filter((row) => row.method === "POST").length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}, { section, urlInput });
const clickPaste = async () => {
  const handle = await page.evaluate((section) => {
    const button = [...document.querySelector(section).querySelectorAll("button")].find((item) => item.textContent.trim() === "붙여넣기");
    button.setAttribute("data-paste-test", "");
    return true;
  }, section);
  assert.ok(handle);
  await page.focus(`${section} [data-paste-test]`);
  await page.keyboard.press("Enter");
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

try {
  for (const width of [320, 390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
    await page.goto(`${base}/admin?paste=${width}${section}`);
    await page.waitForFunction((selector) => !!document.querySelector(selector)
      && !!document.querySelector("#admin-style-dna input[type=checkbox]"), urlInput, { timeout: 6000 });
    const row = { width };

    await clipboard("deny");
    await clickPaste(); await settle();
    row.denied = await state();
    assert.equal(row.denied.value, "");
    assert.equal(row.denied.focused, true, "권한 거절 뒤 입력란 초점");
    assert.match(row.denied.notice, /Ctrl\+V 또는 ⌘V/);
    assert.equal(row.denied.noticeRole, "status");

    await clipboard("missing");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter"); await settle();
    row.missing = await state();
    assert.equal(row.missing.focused, true);
    assert.match(row.missing.notice, /Ctrl\+V/);

    await clipboard("text", "   ");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter"); await settle();
    row.empty = await state();
    assert.equal(row.empty.value, "");
    assert.equal(row.empty.focused, true);
    assert.match(row.empty.notice, /붙여넣을 텍스트가 없어요/);

    // 직접 입력하면 안내가 사라진다
    await page.focus(urlInput);
    await page.keyboard.type("h");
    row.typed = await state();
    assert.equal(row.typed.notice, "");
    assert.equal(row.typed.noticeVisible, false);

    // 정상 붙여넣기: 앞뒤 공백 정리, 동의 해제, 입력란 초점, 분석 요청 없음
    await page.focus(`${section} input[type=checkbox]`);
    await page.keyboard.press("Space");
    await clipboard("text", "  https://mdn.github.io/shared-assets/images/examples/grapefruit-slice.jpg \n");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter"); await settle();
    row.pasted = await state();
    assert.equal(row.pasted.value, "https://mdn.github.io/shared-assets/images/examples/grapefruit-slice.jpg");
    assert.equal(row.pasted.focused, true);
    assert.equal(row.pasted.consent, false, "주소가 바뀌면 동의를 다시 받는다");
    assert.equal(row.pasted.notice, "");
    assert.equal(row.pasted.posts, 0);

    // 요청 중: 분석이 진행되는 동안 붙여넣기 버튼은 쓸 수 없고, 끝나면 다시 쓸 수 있다
    await page.evaluate(() => { window.__premiere.hold = "image"; });
    await page.focus(`${section} input[type=checkbox]`);
    await page.keyboard.press("Space");
    await page.focus(`${section} button[type=submit]`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__premiere.requests().some((row) => row.method === "POST" && row.path === "/api/admin/reference-analysis"), null, { timeout: 4000 });
    row.running = await state();
    assert.equal(row.running.pasteDisabled, true, "요청 중 붙여넣기 비활성");
    await page.evaluate(() => { window.__premiere.hold = ""; window.__premiere.release(); });
    await page.waitForFunction((section) => [...document.querySelector(section).querySelectorAll("button")].some((b) => b.textContent.trim() === "붙여넣기" && !b.disabled), section, { timeout: 4000 });
    row.after = await state();
    assert.equal(row.after.pasteDisabled, false);

    // 같은 주소를 다시 붙여넣으면 결과를 지우지 않는다
    const before = await page.evaluate((section) => document.querySelector(section).innerText.includes("스타일 리포트"), section);
    await clipboard("text", row.pasted.value);
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter"); await settle();
    row.same = await state();
    assert.equal(row.same.value, row.pasted.value);
    assert.equal(row.same.focused, true);
    assert.equal(await page.evaluate((section) => document.querySelector(section).innerText.includes("스타일 리포트"), section), before);

    const posts = async () => (await page.evaluate(() => window.__premiere.requests()))
      .filter((request) => request.method === "POST" && request.path === "/api/admin/reference-analysis");
    // 기다리는 사이 직접 고치면 늦게 온 클립보드 값은 버린다
    await clipboard("held", "https://mdn.github.io/late-edit.png");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter");
    await page.focus(urlInput);
    await page.keyboard.press("End");
    await page.keyboard.type("?");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__releaseClipboard?.());
    await settle();
    row.editedWhileWaiting = await state();
    assert.equal(row.editedWhileWaiting.value, row.pasted.value, "직접 편집이 늦은 붙여넣기에 덮이지 않음");

    // 기다리는 사이 이미 입력한 주소로 분석을 시작하면 늦게 온 값이 입력·요청을 덮지 않는다
    await page.focus(`${section} input[type=checkbox]`);
    await page.keyboard.press("Space");
    await clipboard("held", "https://mdn.github.io/late-run.png");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter");
    await page.evaluate(() => { window.__premiere.hold = "image"; });
    const postsBefore = (await posts()).length;
    await page.focus(`${section} button[type=submit]`);
    await page.keyboard.press("Enter");
    await page.waitForFunction((count) => window.__premiere.requests().filter((r) => r.method === "POST" && r.path === "/api/admin/reference-analysis").length > count, postsBefore, { timeout: 4000 });
    await page.evaluate(() => window.__releaseClipboard?.());
    await settle();
    row.startedWhileWaiting = await state();
    const runPosts = await posts();
    assert.equal(row.startedWhileWaiting.value, row.pasted.value, "분석 시작 뒤 늦은 붙여넣기 무시");
    assert.equal(runPosts.length, postsBefore + 1);
    assert.equal(runPosts.at(-1).body.url, row.pasted.value);
    assert.equal(runPosts.at(-1).aborted, false, "진행 중 요청이 취소되지 않음");
    assert.equal(row.startedWhileWaiting.pasteDisabled, true);
    await page.evaluate(() => { window.__premiere.hold = ""; window.__premiere.release(); });
    await page.waitForFunction((section) => [...document.querySelector(section).querySelectorAll("button")].some((b) => b.textContent.trim() === "붙여넣기" && !b.disabled), section, { timeout: 4000 });

    // 기다리는 사이 다른 분석기로 떠났다 돌아오면 늦게 온 값이 새 화면에 들어가지 않는다
    await clipboard("held", "https://mdn.github.io/late-leave.png");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter");
    await page.evaluate(() => { location.hash = "#admin-music-analysis"; });
    await settle();
    await page.evaluate(() => window.__releaseClipboard?.());
    await page.evaluate(() => { location.hash = "#admin-style-dna"; });
    await page.waitForFunction((selector) => !!document.querySelector(selector), urlInput, { timeout: 4000 });
    await settle();
    row.leftWhileWaiting = await state();
    assert.notEqual(row.leftWhileWaiting.value, "https://mdn.github.io/late-leave.png");
    await clipboard("text", row.pasted.value);
    await clickPaste(); await settle();
    assert.equal((await state()).value, row.pasted.value, "돌아온 화면에서 새 붙여넣기는 동작");

    // 늦게 온 클립보드 값: 그 사이 파일 방식으로 바꾸면 버리고 오류를 내지 않는다
    await clipboard("held", "https://mdn.github.io/late.png");
    await page.focus(`${section} [data-paste-test]`);
    await page.keyboard.press("Enter");
    await page.focus(`${section} input[type=radio][value=file]`);
    await page.keyboard.press("Space");
    await page.evaluate(() => window.__releaseClipboard?.());
    await settle();
    row.late = await page.evaluate((section) => ({ fileMode: !!document.querySelector(`${section} input[type=file]`), url: !!document.querySelector(`${section} input[type=url]`) }), section);
    assert.deepEqual(row.late, { fileMode: true, url: false });

    assert.ok(row.denied.overflow <= 0 && row.pasted.overflow <= 0, `가로 넘침 ${width}`);
    results.push(row);
  }
  console.log("PASTE-RESULT" + JSON.stringify(results));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
