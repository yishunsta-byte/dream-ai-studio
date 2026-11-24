/* global taskSpace, window, document, location, URL, Request, Event, HTMLSelectElement, HTMLTextAreaElement, setTimeout, console */
import assert from "node:assert/strict";
// P2-MANAGED-TOPIC-SHORTS-ENTRY-FRONT 배정 1·2 브라우저 확인. 실제 next build + next start(합성 Supabase Auth, 합성 menus.json에 topic-shorts active).
// 1. 분야가 둘이면 먼저 고르기(폼 없음) → 키보드 Enter로 '주제별 쇼츠' → 주소 ?menu=topic-shorts, aria-current.
// 2. 길이 10~60초 기본 30, 비율 기본 9:16(1:1·16:9 선택), 핵심 메시지 글자 수 기본 100, 사실 출처·상품 칸 없음, 참고 자료는 선택이라 저장 열림.
// 3. 51자를 쓴 뒤 50자를 고르면 글은 그대로 두고 초과 글자 수를 알리며 저장 잠금(제출 시도해도 POST 0). 50자로 줄이면 열림. 다시 100자면 열림.
// 4. '쇼핑숏츠'로 바꾸면 기존 폼(상품명, 필수 자료 목록 전에는 잠김). 각 폭(1440·390)에서 가로 넘침 0, 바깥 요청 0.
// 전역: FIXTURE_ORIGIN(http://127.0.0.1:포트), FIXTURE_OUTPUT_DIR, LOGIN_EMAIL, LOGIN_PASSWORD(합성 Auth 값).
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("topic shorts entry " + Date.now());
const page = task.page("p1");
const settle = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 100; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("시간 초과 " + label); };
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const watch = () => page.evaluate(() => {
  if (window.__seen) return;
  window.__seen = [];
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    // 주소는 문자열·URL 객체·Request 셋 다 올 수 있다(Next 화면 이동은 URL 객체).
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url, location.href);
    window.__seen.push({ method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), path: url.origin === location.origin ? url.pathname : url.href });
    return original(input, init);
  };
});
const seen = () => page.evaluate(() => window.__seen ?? []);
const choose = (id, value) => page.evaluate(([id, value]) => {
  const select = document.getElementById(id);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, [id, value]);
const write = (id, value) => page.evaluate(([id, value]) => {
  const area = document.getElementById(id);
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(area, value);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}, [id, value]);
const state = () => page.evaluate(() => {
  const select = id => { const element = document.getElementById(id); return element ? { value: element.value, options: element.tagName === "SELECT" ? [...element.options].map(option => option.textContent) : [] } : null; };
  const submit = document.querySelector("form button[type=submit]");
  const message = document.getElementById("input-keyMessage");
  return {
    url: location.pathname + location.search,
    kinds: [...document.querySelectorAll('nav[aria-label="만들 분야"] a')].map(link => [link.textContent.trim(), link.getAttribute("aria-current")]),
    form: !!document.querySelector("form"), length: select("input-lengthSec"), aspect: select("input-aspect"), limit: select("input-keyMessageLength"),
    count: document.getElementById("keyMessage-count")?.textContent.trim() ?? null, message: message ? [...message.value].length : null,
    error: message?.closest(".stack")?.querySelector('[role=alert], [id$="-error"]')?.textContent.trim() ?? null,
    submitDisabled: submit ? submit.disabled || submit.getAttribute("aria-disabled") === "true" : null,
    reason: submit?.getAttribute("aria-describedby") ? document.getElementById(submit.getAttribute("aria-describedby").split(" ")[0])?.textContent.trim() ?? null : null,
    product: !!document.getElementById("input-productName"), facts: /사실 출처|factSources/.test(document.querySelector("main")?.textContent ?? ""),
    topic: !!document.getElementById("input-topic"), text: document.querySelector("main")?.textContent ?? "",
  };
});
const report = [];
try {
  await page.goto(`${base}/login?next=${encodeURIComponent("/cloud/projects/new")}`);
  await until(() => !!document.querySelector('input[type=email]') && !!document.querySelector('input[type=password]'), "로그인 칸");
  await page.fill('input[type=email]', globalThis.LOGIN_EMAIL);
  await page.fill('input[type=password]', globalThis.LOGIN_PASSWORD);
  await page.focus('input[type=password]'); await page.keyboard.press("Enter");
  await until(() => location.pathname === "/cloud/projects/new", "로그인 뒤 이동");
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    // 1. 분야 고르기
    await page.goto(`${base}/cloud/projects/new`);
    await until(() => !!document.querySelector('nav[aria-label="만들 분야"] a'), "분야 링크");
    let now = await state();
    assert.deepEqual(now.kinds, [["쇼핑숏츠", null], ["주제별 쇼츠", null]]);
    assert.equal(now.form, false);
    assert.match(now.text, /만들 분야를 골라 주세요/);
    assert.equal(await overflow(), 0, `고르기 넘침 ${width}`);
    await page.screenshot({ path: `${out}/topic-choose-${width}.png` });
    await page.focus('nav[aria-label="만들 분야"] a[href$="menu=topic-shorts"]'); await page.keyboard.press("Enter");
    await until(() => location.search === "?menu=topic-shorts" && !!document.getElementById("input-topic"), "주제별 쇼츠 폼");
    await watch();
    // 2. 기본값
    now = await state();
    assert.deepEqual(now.kinds, [["쇼핑숏츠", null], ["주제별 쇼츠", "page"]]);
    assert.deepEqual(now.length, { value: "30", options: ["10초", "20초", "30초", "40초", "50초", "60초"] });
    assert.equal(now.aspect.value, "9:16");
    for (const ratio of ["1:1", "16:9"]) assert.ok(now.aspect.options.includes(ratio), ratio);
    assert.deepEqual(now.limit, { value: "100", options: ["50", "100", "200", "300"] });
    assert.equal(now.count, "0 / 100자");
    assert.equal(now.product, false); assert.equal(now.facts, false);
    await until(() => !/불러오고 있어요/.test(document.querySelector("form")?.textContent ?? ""), "자료 목록 끝");
    now = await state();
    assert.equal(now.submitDisabled, false, "참고 자료는 선택이라 저장 열림");
    const assets = /참고 자료는 선택 항목이라/.test(now.text) ? "목록 실패 안내" : "목록 읽음";
    // 길이 키보드로 바꾸기(40초)
    await page.focus("#input-lengthSec"); await page.keyboard.press("ArrowDown");
    await settle();
    const lengthAfterKey = (await state()).length.value;
    // 3. 글자 수 상한
    await write("input-keyMessage", "가".repeat(51));
    await choose("input-keyMessageLength", "50");
    now = await state();
    assert.equal(now.message, 51, "글은 자르지 않음");
    assert.equal(now.count, "51 / 50자");
    assert.match(now.error ?? now.text, /고른 글자 수\(50자\)보다 1자 길어요/);
    assert.equal(now.submitDisabled, true, "51자는 저장 잠금");
    const before = (await seen()).filter(item => item.method === "POST").length;
    await page.focus("#input-topic"); await page.keyboard.press("Enter"); await settle(400);
    assert.equal((await seen()).filter(item => item.method === "POST").length, before, "잠긴 동안 POST 0");
    await page.screenshot({ path: `${out}/topic-over-${width}.png` });
    await write("input-keyMessage", "가".repeat(50));
    now = await state();
    assert.equal(now.count, "50 / 50자"); assert.equal(now.submitDisabled, false, "50자는 저장 가능");
    await write("input-keyMessage", "가".repeat(51));
    await choose("input-keyMessageLength", "100");
    now = await state();
    assert.equal(now.count, "51 / 100자"); assert.equal(now.submitDisabled, false);
    assert.equal(await overflow(), 0, `주제별 넘침 ${width}`);
    await page.screenshot({ path: `${out}/topic-form-${width}.png`, fullPage: true });
    // 4. 쇼핑숏츠로 바꾸기
    await page.focus('nav[aria-label="만들 분야"] a[href$="menu=shopping-shorts"]'); await page.keyboard.press("Enter");
    await until(() => location.search === "?menu=shopping-shorts" && !!document.getElementById("input-productName"), "쇼핑 폼");
    now = await state();
    assert.equal(now.topic, false); assert.equal(now.limit, null); assert.equal(now.length?.options?.length ?? 0, 0, "쇼핑은 길이 고르기 칸 없음");
    assert.equal(now.submitDisabled, true, "쇼핑은 확인된 자료 목록 없이 잠김");
    // 고른 분야 단추도 작은 화면에서 한 줄 전체로 늘어나지 않고 두 단추가 같은 줄
    const tops = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="만들 분야"] a')].map(link => Math.round(link.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, `분야 단추 한 줄 ${width}`);
    assert.equal(await overflow(), 0, `쇼핑 넘침 ${width}`);
    await page.screenshot({ path: `${out}/shopping-form-${width}.png` });
    const external = (await seen()).filter(item => !item.path.startsWith("/")).length;
    assert.equal(external, 0, "바깥 요청 0");
    report.push({ width, assets, lengthAfterKey, requests: await seen() });
    console.log("STEP " + width + " 통과");
  }
} finally {
  console.log(JSON.stringify(report));
  await task.finish?.({ keep: [] }).catch(() => {});
}
