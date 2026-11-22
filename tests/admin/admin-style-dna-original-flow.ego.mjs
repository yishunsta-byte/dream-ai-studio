/* global taskSpace, window, document, console, setTimeout, Event, sessionStorage */
import assert from "node:assert/strict";
// P1-06 원본 전체 화면(/admin/style-dna 본문, ?page=style-dna 루프백 대역)에서 조작 결과 화면을 남긴다(1280·390).
// 보관 기록 열기 → 사이드바 2단계 → 빠른 피드백 두 개·동의·'미세 보정 요청' → 보정 기록 1건·프롬프트 버전 2(보정 2버전 표시)
// → 사이드바 3단계 → '프롬프트 직접 편집'을 연 상태로 편집·동의·'공정 시작' → 원본과 생성 결과 비교. 단계마다 가로 넘침 0(실제 화면 폭 기준), 외부 요청 0.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA original flow " + Date.now());
const page = task.page("p1");
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 100; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const RF = `document.querySelector("main [aria-label='프롬프트 보정']")`;
const TS = `document.querySelector("main [aria-label='결과 테스트']")`;
const mark = async (expression, key) => {
  const found = await page.evaluate((expression) => { const node = eval(expression); if (!node) return false; document.querySelector("[data-press]")?.removeAttribute("data-press"); node.setAttribute("data-press", ""); return true; }, expression);
  assert.ok(found, expression.slice(0, 120));
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const press = (text, scope = "document.querySelector('main')") => mark(`[...(${scope}).querySelectorAll("button")].find((item) => item.getClientRects().length > 0 && (item.textContent.trim() === ${JSON.stringify(text)} || item.getAttribute("aria-label") === ${JSON.stringify(text)}))`, "Enter");
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [expression, value]);
const agree = (scope) => `[...(${scope}).querySelectorAll("form input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`;
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const side = async (mobile, prefix) => {
  if (mobile) { await press("메뉴 열기", "document"); await until(() => !!document.querySelector("[data-dna-shell] [id] nav"), "drawer"); }
  await mark(`[...document.querySelectorAll("${mobile ? "[data-dna-shell] [id] nav" : "aside nav"} button")].find((item) => item.textContent.replace(/\\s+/g, "").startsWith(${JSON.stringify(prefix)}))`, "Enter");
};

const rows = [];
for (const width of [1280, 390]) {
  const mobile = width < 768;
  const row = { width, overflow: [] };
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
  await page.goto(`${base}/admin?page=style-dna&styleDnaHold=list`);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base}/admin?page=style-dna&styleDnaSeed=1&flow=${width}`);
  await until(() => !!window.__premiere && !!document.querySelector("section[aria-label='보관함'] li"), "library");
  await page.evaluate(() => { window.__external = 0; new window.PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.name.startsWith(window.location.origin)) window.__external += 1; }).observe({ type: "resource", buffered: true }); });
  await press("보관된 도심 인물 사진 열기");
  await until(() => !!document.querySelector("main [aria-label='이미지 스타일 분석기']"), "analyze");

  // 2단계: 피드백 두 개 → 동의 → 보정 v2
  await side(mobile, "2프롬프트보정");
  await until((RF) => !!eval(RF), "refine", RF);
  await press("색감을 더 따뜻하게", RF);
  await press("배경을 단순하게", RF);
  await mark(agree(RF), "Space");
  await press("미세 보정 요청", RF);
  await until(() => /새 보정 버전을 저장했어요\(버전 2\)/.test(document.querySelector("main").textContent), "refined");
  row.refine = await page.evaluate((RF) => { const rf = eval(RF); return { history: [...rf.querySelectorAll("h5, h4")].map((node) => node.textContent.trim()).find((text) => text.startsWith("보정 기록")), v2: /v2|버전 2/.test(rf.textContent) }; }, RF);
  assert.deepEqual(row.refine, { history: "보정 기록 (1)", v2: true });
  row.overflow.push(await overflow());
  await page.evaluate((RF) => eval(RF).scrollIntoView({ block: "start" }), RF); await settle(250);
  await page.screenshot({ path: `${out}/original-refine-v2-${width}.png` });

  // 3단계: 직접 편집 연 상태 → 동의 → 합성 → 결과 비교
  await side(mobile, "3결과테스트");
  await until((TS) => !!eval(TS), "test", TS);
  await press("프롬프트 직접 편집", TS);
  const edited = "Edited: a cat on a neon rooftop, teal and amber city glow";
  await typeInto(`(${TS}).querySelector("form textarea")`, edited);
  await mark(agree(TS), "Space");
  await press("공정 시작 (이미지 1장 합성)", TS);
  await until(() => /프롬프트로 시험 이미지를 만들었어요/.test(document.querySelector("main").textContent), "tested");
  row.test = await page.evaluate((TS) => { const ts = eval(TS); return { editing: [...ts.querySelectorAll("button")].some((item) => item.textContent.trim() === "기본 프롬프트 모드로"), images: ts.querySelectorAll("img").length }; }, TS);
  assert.equal(row.test.editing, true, "직접 편집이 열린 상태");
  assert.ok(row.test.images >= 2, "원본과 생성 결과 이미지");
  row.overflow.push(await overflow());
  await page.evaluate((TS) => eval(TS).scrollIntoView({ block: "start" }), TS); await settle(250);
  await page.screenshot({ path: `${out}/original-test-edit-${width}.png` });
  const result = await page.evaluate((TS) => { const node = [...eval(TS).querySelectorAll("section, div")].find((item) => /원본과 비교|비교/.test(item.getAttribute("aria-label") ?? "")); if (!node) return false; node.scrollIntoView({ block: "start" }); return node.getAttribute("aria-label"); }, TS);
  row.compare = result;
  await settle(250);
  await page.screenshot({ path: `${out}/original-test-result-${width}.png` });
  row.external = await page.evaluate(() => window.__external);
  assert.equal(row.external, 0);
  assert.ok(Math.max(...row.overflow) <= 0, `가로 넘침 ${row.overflow}`);
  rows.push(row);
}
console.log("STYLE-DNA-ORIGINAL-FLOW" + JSON.stringify(rows));
