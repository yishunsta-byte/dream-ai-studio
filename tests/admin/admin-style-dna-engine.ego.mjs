/* global taskSpace, window, document, console, setTimeout, Event, HTMLSelectElement, sessionStorage */
import assert from "node:assert/strict";
// P1-06 이미지 분석·보정 엔진 선택(서버 f2d7e63 계약, Tester ACCEPTANCE p1-06-style-dna-engine-ui-preflight 기준). fixture ?styleDnaEngines=openai,anthropic.
// 1. 선택: 분석 AI에 Gemini·OpenAI·Anthropic Claude, 모델은 등록된 것 하나. 열기만 하면 목록·엔진 설정 GET뿐(POST 0).
// 2. 동의 뒤 엔진을 바꾸면 동의가 풀리고 문구의 공급자가 바뀐다. OpenAI로 분석 → 본문 engine·OpenAI 등록 버전 2, 리포트에 실제 실행 엔진.
// 3. 2단계에서 Claude로 보정 → 본문 engine·버전 5, 기록·현재 카드에 실제 엔진. 1단계 리포트의 v1 엔진(OpenAI)은 그대로.
// 4. 키 교체(Claude 버전 6) → 409 → 공급자 이름이 든 안내, 엔진 설정 다시 읽기, 동의 풀림, 기록 보존 → 다시 동의하면 버전 6으로 성공.
// 5. 시험 생성: 동의 문구 Gemini, 본문에 engine 없음·Gemini 버전 3. 6. 미등록 공급자는 '(키 미등록)'으로 잠김. 7. 엔진 칸 없는 이전 기록은 'Gemini · 모델 기록 없음'.
// 각 폭(1574·390)에서 가로 넘침 0, 외부 요청 0.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA engine " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const SEC = `document.querySelector("${R}")`;
const ST = `document.querySelector("${R} [aria-label='이미지 스타일 분석기']")`;
const RF = `document.querySelector("${R} [aria-label='프롬프트 보정']")`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const press = (text, scope = SEC) => mark(`[...(${scope}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`, "Enter");
const choose = async (expression, value) => {
  await page.evaluate(([expression, value]) => {
    const select = eval(expression);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, [expression, value]);
  await settle(250);
};
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [expression, value]);
const ENGINE = `(${ST}).querySelector("[aria-label='시스템 가이던스'] select[aria-describedby$='engine']")`;
const REF_ENGINE = `(${RF}).querySelector("form select[aria-describedby$='engine']")`;
const consentOf = (scope, form) => `[...(${scope}).querySelectorAll("${form} input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`;
const engineState = (scope, form) => page.evaluate(([scope, form]) => {
  const root = eval(scope);
  const selects = [...root.querySelectorAll(`${form} select[aria-describedby$='engine']`)];
  const box = [...root.querySelectorAll(`${form} input[type=checkbox]`)].find((item) => /동의해요/.test(item.closest("label").textContent));
  return { options: [...selects[0].options].map((option) => [option.textContent, option.disabled]), value: selects[0].value, model: selects[1].selectedOptions[0]?.textContent ?? null,
    consent: box.checked, consentText: box.closest("label").textContent.trim(), warn: root.querySelector(`${form} [role=note]:not(details *)`)?.textContent ?? null };
}, [scope, form]);
const posts = (suffix) => page.evaluate((suffix) => window.__premiere.requests().filter((row) => row.method === "POST" && row.path.endsWith(suffix)), suffix);
const gets = (path) => page.evaluate((path) => window.__premiere.requests().filter((row) => row.method === "GET" && row.path === path).length, path);
const notice = () => page.evaluate((R) => [...document.querySelectorAll(`${R} section > p[role]`)].map((item) => item.textContent).join(" | "), R);
const open = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  // ④ 보관함 이관: 일반 진입 첫 화면은 보관함. 다 불러온 뒤 분석 화면이 아니면 '1. 이미지 분석'(기록 복귀면 이미 분석 화면).
  await until((R) => { const s = document.querySelector(R); const lib = s?.querySelector("[aria-label='보관함'] h4")?.closest("section");
    return !!s?.querySelector("[aria-label='이미지 스타일 분석기'] form") || (!!lib && !/불러오는 중/.test(lib.textContent)); }, "entry", R);
  await page.evaluate((R) => { const s = document.querySelector(R); if (!s.querySelector("[aria-label='이미지 스타일 분석기'] form")) s.querySelector("[aria-label='Style DNA 단계'] button").click(); }, R);
  await until((R) => !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "studio", R);
  await until((R) => !/확인하는 중/.test(document.querySelector(R).innerText), "settings", R);
  await until(() => window.__premiere.requests().some((row) => row.path === "/api/admin/style-dna/engine-credentials"), "engines");
  await settle(200);
};
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const results = [];
try {
  for (const [width, height] of [[1574, 1167], [390, 844]]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    console.log("STEP 1 " + width);
    await open(`styleDnaEngines=openai,anthropic&styleDnaReport=1&w=${width}`);
    let e = await engineState(ST, "form[aria-label='분석 설정']");
    assert.deepEqual([e.options, e.value, e.model, e.warn], [[["Google Gemini", false], ["OpenAI", false], ["Anthropic Claude", false]], "gemini", "gemini-fixture-image", null]);
    assert.match(e.consentText, /Gemini에 보내 분석하고/);
    assert.equal((await posts("style-dna")).length, 0, "열기만 하면 POST 0");
    assert.equal(await gets("/api/admin/style-dna/engine-credentials"), 1);

    console.log("STEP 2 " + width);
    await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
    await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/engine.png");
    await mark(consentOf(ST, "form[aria-label='분석 설정']"), "Space");
    assert.equal((await engineState(ST, "form[aria-label='분석 설정']")).consent, true);
    await choose(ENGINE, "openai");
    e = await engineState(ST, "form[aria-label='분석 설정']");
    assert.deepEqual([e.value, e.model, e.consent], ["openai", "gpt-fixture-vision", false], "엔진을 바꾸면 동의가 풀림");
    assert.match(e.consentText, /OpenAI에 보내 분석하고/);
    assert.equal((await posts("style-dna")).length, 0, "고르기·동의만으로 POST 0");
    await mark(consentOf(ST, "form[aria-label='분석 설정']"), "Space");
    await press("이미지 시퀀싱 시작", ST);
    await until((ST) => /Dusk City Portrait/.test(eval(ST).textContent), "analyzed", ST);
    const analyzed = (await posts("/api/admin/style-dna")).at(-1).body;
    assert.deepEqual([analyzed.credentialVersion, analyzed.engine], [2, { provider: "openai", modelId: "gpt-fixture-vision" }]);
    assert.equal(await page.evaluate((ST) => eval(ST).querySelector("[aria-label='실행 엔진']").textContent, ST), "v1 실행 엔진 · OpenAI · gpt-fixture-vision · 등록 버전 2");

    console.log("STEP 3 " + width);
    await press("2. 프롬프트 보정");
    await until((RF) => !!eval(RF), "refine", RF);
    e = await engineState(RF, "form");
    assert.deepEqual([e.value, e.model], ["openai", "gpt-fixture-vision"], "1단계와 같은 선택");
    assert.equal(await page.evaluate((RF) => eval(RF).querySelector("[aria-label='실행 엔진']").textContent, RF), "v1 실행 엔진 · OpenAI · gpt-fixture-vision · 등록 버전 2");
    await choose(REF_ENGINE, "anthropic");
    await press("색감을 더 따뜻하게", RF);
    await mark(consentOf(RF, "form"), "Space");
    e = await engineState(RF, "form");
    assert.deepEqual([e.value, e.model, e.consent], ["anthropic", "claude-fixture-vision", true]);
    assert.match(e.consentText, /Claude\(claude-fixture-vision\)에 보내/);
    await press("미세 보정 요청", RF);
    await until((R) => /새 보정 버전을 저장했어요\(버전 2\)/.test(document.querySelector(R).textContent), "refined", R);
    const refined = (await posts("/refine")).at(-1).body;
    assert.deepEqual([refined.credentialVersion, refined.engine, refined.revision], [5, { provider: "anthropic", modelId: "claude-fixture-vision" }, 1]);
    const history = await page.evaluate((RF) => [...eval(RF).querySelectorAll("[aria-label='보정 기록'] li p")].map((item) => item.textContent), RF);
    assert.ok(history.includes("실행 엔진 · Anthropic Claude · claude-fixture-vision · 등록 버전 5"), history.join(" / "));
    assert.equal(await page.evaluate((RF) => eval(RF).querySelector("[aria-label='실행 엔진']").textContent, RF), "v2 실행 엔진 · Anthropic Claude · claude-fixture-vision · 등록 버전 5");
    assert.equal(await page.evaluate(() => window.__premiere.styleDna.records[0].engine.provider), "openai", "최초 분석 근거 보존");
    // 선택을 바꿔도 이미 만든 버전의 실제 실행 엔진 표시는 기록 그대로(선택이 아니라 기록에서 읽음)
    await choose(REF_ENGINE, "gemini");
    assert.equal(await page.evaluate((RF) => eval(RF).querySelector("[aria-label='실행 엔진']").textContent, RF), "v2 실행 엔진 · Anthropic Claude · claude-fixture-vision · 등록 버전 5");
    assert.match((await engineState(RF, "form")).consentText, /Gemini\(gemini-fixture-image\)에 보내/);
    await choose(REF_ENGINE, "anthropic");
    if (width === 1574 || width === 390) { await page.evaluate(`(${RF}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/engine-refine-${width}.png` }); }

    console.log("STEP 4 " + width);
    // 다른 곳에서 Claude 키를 바꿈(버전 6) → 화면의 동의는 버전 5에 묶여 있어 서버가 409
    await page.evaluate(() => { window.__premiere.styleDna.engines.anthropic.version = 6; });
    await press("조명을 더 부드럽게", RF);
    await mark(consentOf(RF, "form"), "Space");
    const before = await gets("/api/admin/style-dna/engine-credentials");
    await press("미세 보정 요청", RF);
    await until((R) => /Anthropic Claude 등록 버전이 바뀌었어요/.test(document.querySelector(R).textContent), "stale", R);
    await until((count) => window.__premiere.requests().filter((row) => row.method === "GET" && row.path === "/api/admin/style-dna/engine-credentials").length > count, "reread engines", before);
    await settle(300);
    e = await engineState(RF, "form");
    assert.equal(e.consent, false, "409 뒤 동의 풀림");
    assert.equal(await page.evaluate((RF) => eval(RF).querySelectorAll("[aria-label='보정 기록'] li").length, RF), 1, "기록 보존");
    await mark(consentOf(RF, "form"), "Space");
    await press("미세 보정 요청", RF);
    await until((R) => /새 보정 버전을 저장했어요\(버전 3\)/.test(document.querySelector(R).textContent), "refined 3", R);
    assert.equal((await posts("/refine")).at(-1).body.credentialVersion, 6);

    console.log("STEP 5 " + width);
    await press("처음 분석(버전 1)으로 시험", RF);
    const testBox = await page.evaluate((R) => [...document.querySelectorAll(`${R} form input[type=checkbox]`)].map((box) => box.closest("label").textContent).find((text) => /시험 이미지 1장/.test(text)), R);
    assert.match(testBox, /Gemini 이미지 모델에 보내/);
    await typeInto(`[...(${SEC}).querySelectorAll("label")].find((label) => label.textContent.trim().startsWith("피사체")).querySelector("textarea")`, "a cat");
    await mark(`[...(${SEC}).querySelectorAll("form input[type=checkbox]")].find((box) => /시험 이미지 1장/.test(box.closest("label").textContent))`, "Space");
    await press("공정 시작 (이미지 1장 합성)");
    await until((R) => /시험 이미지를 만들었어요/.test(document.querySelector(R).textContent), "tested", R);
    const tested = (await posts("/test-image")).at(-1).body;
    assert.deepEqual([tested.credentialVersion, "engine" in tested], [3, false], "시험 생성은 Gemini 계약");

    console.log("STEP 6 " + width);
    await open(`styleDnaSeed=1&styleDnaEngines=openai&w=${width}`);
    e = await engineState(ST, "form[aria-label='분석 설정']");
    assert.deepEqual(e.options, [["Google Gemini", false], ["OpenAI", false], ["Anthropic Claude (키 미등록)", true]]);

    console.log("STEP 7 " + width);
    if (await page.evaluate((R) => [...document.querySelectorAll(`${R} [aria-label='Style DNA 단계'] button`)][1].disabled, R)) await press("다시 열기");
    await until((ST) => !!eval(ST).querySelector("[aria-label='실행 엔진']"), "old record", ST);
    assert.equal(await page.evaluate((ST) => eval(ST).querySelector("[aria-label='실행 엔진']").textContent, ST), "v1 실행 엔진 · Google Gemini · 모델 기록 없음(이전 방식)");
    assert.equal(await overflow(), 0, `넘침 ${width}`);
    const external = await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length);
    assert.equal(external, 0);
    if (width === 1574 || width === 390) { await page.evaluate(`(${ST}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/engine-old-${width}.png` }); }
    results.push({ width, overflow: 0, external, notice: await notice() });
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("STYLE-DNA-ENGINE-RESULT" + JSON.stringify(results));
