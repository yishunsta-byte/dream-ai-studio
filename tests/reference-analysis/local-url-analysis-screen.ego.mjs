/* global document, window, Headers, URL */
import assert from "node:assert/strict";

const panel = 'section[aria-labelledby="local-url-heading"]';
const field = "#local-media-url";
const heading = "#local-url-result-heading";
const submit = panel + ' button[type="submit"]';
const sample = "https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg";

// Use the fixed candidate on a disposable local Next app with local auth and the approved MDN sample.
export async function verifyLocalUrlAnalysisFocus(page, origin) {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  await page.goto(origin + "/studio/reference-analysis");
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 45000 });

  async function authorize(url) {
    await page.fill(field, "");
    await page.fill(field, url);
    await page.focus(field);
    assert.equal(await page.evaluate(selector => document.querySelector(selector).disabled, submit), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.type), "checkbox");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(selector => document.activeElement?.matches(selector), submit), true);
  }

  async function focusedResult(width) {
    await wait(selector => document.activeElement?.matches(selector), heading);
    const placement = await page.evaluate(() => {
      const title = document.activeElement.getBoundingClientRect();
      return { width: window.innerWidth, height: window.innerHeight, top: Math.round(title.top), bottom: Math.round(title.bottom) };
    });
    assert.equal(placement.width, width);
    assert.ok(placement.top >= 0 && placement.bottom <= placement.height);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.labels?.[0]?.textContent), "결과 선택");
    return placement;
  }

  const placements = [];
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
    await authorize(sample);
    await page.keyboard.press("Enter");
    placements.push(await focusedResult(width));
    await page.fill(panel + " textarea", "검수용 편집");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA");
  }

  // Submit a second analysis of the same address without changing either input.
  await page.focus(submit);
  await page.keyboard.press("Enter");
  await focusedResult(1440);

  await authorize("잘못된 주소");
  assert.equal(await page.evaluate(selector => document.querySelector(selector).validity.typeMismatch, field), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(selector => document.activeElement?.matches(selector), field), true);
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), heading), false);

  await authorize("https://www.youtube.com/watch?v=GVhztzBPsOY");
  await page.keyboard.press("Enter");
  await page.waitForSelector(panel + ' [role="alert"]');
  assert.equal(await page.evaluate(selector => !!document.querySelector(selector), heading), false);

  // Hold the actual action response while the user moves the keyboard focus elsewhere.
  await page.evaluate(() => {
    const request = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await request(input, init);
      if (!new Headers(init?.headers).has("Next-Action")) return response;
      window.fetch = request;
      await new Promise(resolve => { window.releaseAnalysisResponse = resolve; });
      return response;
    };
  });
  await authorize(sample);
  await page.keyboard.press("Enter");
  await page.focus('loc=role:link[name="작업실로 돌아가기"]');
  await wait(() => typeof window.releaseAnalysisResponse === "function");
  await page.evaluate(() => window.releaseAnalysisResponse());
  await page.waitForSelector(heading);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "작업실로 돌아가기");
  return placements;
}
