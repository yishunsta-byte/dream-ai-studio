/* global taskSpace, window, document, navigator, console, setTimeout, Event, getComputedStyle, sessionStorage */
import assert from "node:assert/strict";
// P1-06 2단계: 원본 Style DNA v1.39 '프롬프트 보정' 화면 이관 확인. admin-hub-fixture-run.mjs 루프백 주소에서 ?styleDnaReport=1로 연다.
// 1. 주소로 분석 → '2. 프롬프트 보정': 원본 단계 머리, 왼쪽 카드(썸네일·제목 두 줄·마스터 프롬프트 EN/KO v1), 오른쪽 추론 인터페이스(빠른 피드백 9개·보정 AI 고르기, 모델은 등록된 것 하나)·보정 기록(빈 문구).
//    넓은 화면 2열(1fr/360px), 모바일 1열, 원본 바탕·카드·밝은 프롬프트 상자 색, 작은 글자 대비 4.5:1 이상, 가로 넘침 0.
// 2. 피드백이 없거나 동의가 없으면 '미세 보정 요청' 잠김. 빠른 피드백 두 개 → 동의 → 보정 v2: 기록 1건(요청·답·날짜), 프롬프트 v2, 입력 비움.
// 3. 복사, 입력 지우기, 기록의 '이 버전으로 시험' → 3단계에서 그 버전 선택. '처음 분석(버전 1)으로 시험'도 같은 방식.
// 4. 키 미등록이면 엔진 경고·동의 잠김. 외부 요청 0.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA refine " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const SEC = `document.querySelector("${R}")`;
const RF = `document.querySelector("${R} [aria-label='프롬프트 보정']")`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const press = (text, scope = SEC) => mark(`[...(${scope}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`, "Enter");
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [expression, value]);
const notice = () => page.evaluate((R) => [...document.querySelectorAll(`${R} section > p[role]`)].map((item) => item.textContent).join(" | "), R);
const refine = () => page.evaluate((RF) => {
  const rf = eval(RF);
  if (!rf) return null;
  const text = (selector) => rf.querySelector(selector)?.textContent.trim() ?? null;
  const form = rf.querySelector("form[aria-label='추론 인터페이스']");
  const grid = rf.querySelector("[aria-label='현재 프롬프트']").parentElement;
  const box = [...form.querySelectorAll("input[type=checkbox]")].find((item) => /동의해요/.test(item.closest("label").textContent));
  const rgb = (value) => value.match(/[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  // 반투명 바탕(프롬프트 상자 slate-50/70 등)은 아래 불투명 바탕과 섞어 실제로 보이는 색으로 계산한다.
  const back = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) { const c = rgb(getComputedStyle(node).backgroundColor); const alpha = c.length === 3 ? 1 : c[3];
      if (alpha > 0) layers.push([c.slice(0, 3), alpha]); if (alpha === 1) break; }
    return layers.reverse().reduce((under, [color, alpha]) => color.map((value, i) => value * alpha + under[i] * (1 - alpha)), [255, 255, 255]);
  };
  const ratio = (element) => { if (!element) return null; const a = lum(rgb(getComputedStyle(element).color)), b = lum(back(element)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  return {
    step: [text("header span"), text("header h4"), text("header p")],
    columns: getComputedStyle(grid).gridTemplateColumns.split(" "),
    titles: [...rf.querySelectorAll("[aria-label='현재 프롬프트'] img + div p")].map((item) => item.textContent),
    image: rf.querySelector("[aria-label='현재 프롬프트'] img")?.getAttribute("src") ?? null,
    prompts: [...rf.querySelectorAll("section[aria-label^='마스터 프롬프트']")].map((item) => [item.getAttribute("aria-label"), item.querySelector("p").textContent]),
    feedback: form.querySelector("textarea").value, count: text("form label span[id]"),
    chips: [...rf.querySelectorAll("[aria-label='빠른 피드백'] button")].length,
    engine: [...form.querySelectorAll("select")].map((select) => [select.disabled, select.selectedOptions[0]?.textContent ?? null]),
    warn: text("form [role=note]"),
    consent: box.checked, consentDisabled: box.disabled,
    run: [...form.querySelectorAll("button[type=submit]")].map((button) => [button.textContent.trim(), button.disabled])[0],
    historyTitle: text("[aria-label='보정 기록'] h5"), historyEmpty: rf.querySelector("[aria-label='보정 기록'] ol") ? null : text("[aria-label='보정 기록'] > p"),
    history: [...rf.querySelectorAll("[aria-label='보정 기록'] li")].map((item) => [...item.querySelectorAll("p")].map((node) => node.textContent).concat(item.querySelector("time")?.textContent ?? "")),
    colors: { page: getComputedStyle(rf).backgroundColor, card: getComputedStyle(form).backgroundColor, prompt: getComputedStyle(rf.querySelector("section[aria-label^='마스터 프롬프트']")).backgroundColor },
    ratios: { consent: ratio(box.closest("label")), note: ratio([...form.querySelectorAll("p")].at(-1)), engine: ratio(form.querySelector("select").closest("label")), count: ratio(rf.querySelector("form label span[id]")),
      empty: ratio(rf.querySelector("[aria-label='보정 기록'] > p")), time: ratio(rf.querySelector("[aria-label='보정 기록'] time")),
      prompt: ratio(rf.querySelector("section[aria-label^='마스터 프롬프트'] p")), label: ratio(rf.querySelector("section[aria-label^='마스터 프롬프트'] h6")), step: ratio(rf.querySelector("header p")) },
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, RF);
const open = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  // ④ 보관함 이관: 일반 진입 첫 화면은 보관함. 다 불러온 뒤 분석 화면이 아니면 '1. 이미지 분석'(기록 복귀면 이미 분석 화면).
  await until((R) => { const s = document.querySelector(R); const lib = s?.querySelector("[aria-label='보관함'] h4")?.closest("section");
    return !!s?.querySelector("[aria-label='이미지 스타일 분석기'] form") || (!!lib && !/불러오는 중/.test(lib.textContent)); }, "entry", R);
  await page.evaluate((R) => { const s = document.querySelector(R); if (!s.querySelector("[aria-label='이미지 스타일 분석기'] form")) s.querySelector("[aria-label='Style DNA 단계'] button").click(); }, R);
  await until((R) => !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "studio", R);
  await until((R) => !/확인하는 중/.test(document.querySelector(R).innerText), "settings", R);
  await page.evaluate(() => { window.__clip = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__clip.push(text); } } }); });
};
const analyze = async () => {
  const ST = `document.querySelector("${R} [aria-label='이미지 스타일 분석기']")`;
  await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
  await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/city.png");
  await mark(`[...(${ST}).querySelectorAll("form[aria-label='분석 설정'] input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`, "Space");
  await press("이미지 시퀀싱 시작", ST);
  await until((ST) => /Dusk City Portrait/.test(eval(ST).textContent), "analyzed", ST);
};
const shot = async (name) => { await page.evaluate(`(${RF}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/${name}` }); };
const AGREE = `[...(${RF}).querySelectorAll("form input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`;
const results = [];
try {
  for (const [width, height] of [[1574, 1167], [1280, 900], [390, 844], [320, 700]]) {
    console.log("STEP 1 " + width);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    await open(`styleDnaReport=1&w=${width}`);
    await analyze();
    await press("2. 프롬프트 보정");
    await until((RF) => !!eval(RF), "refine", RF);
    let v = await refine();
    assert.deepEqual(v.step, ["2", "프롬프트 보정", "결과가 마음에 들지 않는 부분을 말로 적으면 AI가 마스터 프롬프트를 미세하게 고칩니다. 고친 결과는 보관함에 바로 저장됩니다."]);
    assert.deepEqual(v.columns.length === 2 ? v.columns[1] : v.columns.length, width >= 1024 ? "360px" : 1, `열 ${width}`);
    assert.deepEqual(v.titles, ["황혼의 도심 초상", "Dusk City Portrait"]);
    assert.ok(v.image, "썸네일");
    assert.deepEqual(v.prompts.map((item) => item[0]), ["마스터 프롬프트 (EN) v1", "마스터 프롬프트 (KO) v1"]);
    assert.match(v.prompts[0][1], /INSERT SUBJECT HERE/);
    assert.deepEqual([v.feedback, v.count, v.chips, v.engine, v.warn], ["", "0 / 600", 9, [[false, "Google Gemini"], [true, "gemini-fixture-image"]], null]);
    assert.deepEqual([v.historyTitle, v.historyEmpty, v.history], ["보정 기록 (0)", "아직 보정한 적이 없습니다.", []]);
    assert.deepEqual([v.consent, v.consentDisabled, v.run], [false, false, ["미세 보정 요청", true]]);
    assert.deepEqual(v.colors, { page: "rgb(12, 15, 23)", card: "rgb(19, 24, 36)", prompt: "rgba(248, 250, 252, 0.7)" });
    for (const [key, value] of Object.entries(v.ratios)) if (value !== null) assert.ok(value >= 4.5, `대비 ${key} ${value} (${width})`);
    assert.equal(v.overflow, 0, `넘침 ${width}`);
    if (width === 1574 || width === 390) await shot(`refine-empty-${width}.png`);

    console.log("STEP 2 " + width);
    // 동의만 하면 아직 잠김(피드백 없음) → 빠른 피드백 두 개 → 보정 v2
    await mark(AGREE, "Space");
    assert.deepEqual((await refine()).run, ["미세 보정 요청", true]);
    await press("색감을 더 따뜻하게", RF);
    await press("배경을 단순하게", RF);
    v = await refine();
    assert.deepEqual([v.feedback, v.count, v.consent], ["색감을 더 따뜻하게, 배경을 단순하게", `${[..."색감을 더 따뜻하게, 배경을 단순하게"].length} / 600`, false], "피드백을 바꾸면 동의가 풀림");
    await mark(AGREE, "Space");
    assert.deepEqual((await refine()).run, ["미세 보정 요청", false]);
    await press("미세 보정 요청", RF);
    await until((R) => /새 보정 버전을 저장했어요\(버전 2\)/.test(document.querySelector(R).textContent), "refined", R);
    v = await refine();
    assert.deepEqual(v.prompts.map((item) => item[0]), ["마스터 프롬프트 (EN) v2", "마스터 프롬프트 (KO) v2"]);
    assert.match(v.prompts[0][1], /refined 2$/);
    assert.deepEqual([v.feedback, v.historyTitle, v.historyEmpty, v.consent], ["", "보정 기록 (1)", null, false]);
    assert.equal(v.history.length, 1);
    assert.deepEqual(v.history[0].slice(0, 2), ["버전 2요청: 색감을 더 따뜻하게, 배경을 단순하게", "→ 피드백을 반영해 조명과 색을 조정했어요."]);
    assert.ok(v.history[0][2].length > 0, "날짜");
    assert.ok(v.ratios.time >= 4.5, `날짜 대비 ${v.ratios.time}`);
    assert.match(await notice(), /새 보정 버전을 저장했어요\(버전 2\)/);
    if (width === 1574 || width === 390) await shot(`refine-result-${width}.png`);

    console.log("STEP 3 " + width);
    await mark(`(${RF}).querySelector("section[aria-label^='마스터 프롬프트 (EN)'] button")`, "Enter");
    assert.match(await page.evaluate(() => window.__clip.at(-1)), /refined 2$/);
    await typeInto(`(${RF}).querySelector("textarea")`, "조명을 더 부드럽게");
    await press("입력 지우기", RF);
    assert.equal((await refine()).feedback, "");
    await press("이 버전으로 시험", RF);
    await until((R) => [...document.querySelectorAll(`${R} [aria-label='Style DNA 단계'] button`)][2].getAttribute("aria-pressed") === "true", "test step", R);
    assert.equal(await page.evaluate((R) => document.querySelector(`${R} form select`).value, R), "2");
    await press("2. 프롬프트 보정");
    await press("처음 분석(버전 1)으로 시험", RF);
    assert.equal(await page.evaluate((R) => document.querySelector(`${R} form select`).value, R), "1");

    console.log("STEP 4 " + width);
    await open(`styleDnaSeed=1&styleDnaModel=none&styleDnaReport=1&w=${width}`);
    // 키 미등록: 보관함의 이전 형태 기록(확장 없음)을 다시 열어 2단계 → 제목 한 줄(영문 없음)·빈 기록, 엔진 경고·동의 잠김
    // 같은 ID가 새로고침 복귀로 이미 열려 있을 수 있다(단추 '열려 있음'). 닫혀 있을 때만 '다시 열기'.
    if (await page.evaluate((R) => [...document.querySelectorAll(`${R} [aria-label='Style DNA 단계'] button`)][1].disabled, R)) await press("다시 열기");
    await until((R) => [...document.querySelectorAll(`${R} [aria-label='Style DNA 단계'] button`)][1].disabled === false, "reopened", R);
    await press("2. 프롬프트 보정");
    await until((RF) => !!eval(RF), "refine old", RF);
    v = await refine();
    assert.deepEqual([v.titles, v.historyEmpty], [["보관된 도심 인물 사진"], "아직 보정한 적이 없습니다."]);
    assert.deepEqual([v.warn, v.consentDisabled, v.engine[1][1], v.run[1]], ["이미지 분석 모델이 등록되지 않았어요. 계정설정 및 API 연동에서 등록해 주세요.", true, "등록 안 됨", true]);
    assert.equal(v.overflow, 0);
    const external = await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length);
    assert.equal(external, 0);
    results.push({ width, columns: v.columns.length, ratios: v.ratios, overflow: v.overflow, external });
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("STYLE-DNA-REFINE-RESULT" + JSON.stringify(results));
