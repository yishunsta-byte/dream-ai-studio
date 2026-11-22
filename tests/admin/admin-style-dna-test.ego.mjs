/* global taskSpace, window, document, console, setTimeout, Event, getComputedStyle, sessionStorage, DataTransfer, File, Buffer, HTMLElement */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// P1-06 3단계: 원본 Style DNA v1.39 '결과 테스트 및 이미지 합성' 화면 이관 확인(3a). admin-hub-fixture-run.mjs 루프백 주소, ?styleDnaReport=1.
// 1. 주소 분석 → '3. 결과 테스트': 원본 단계 머리, 넓은 화면 2열(380px/나머지)·모바일 1열, 왼쪽 '추론 및 생성 설정'(직접 편집 전환·버전·피사체(필수)·참조 이미지 위젯·
//    생성 모델·비율·Gemini 동의·'공정 시작 (이미지 1장 합성)'·유료 안내), 결과 전 원본·미리보기 두 카드와 빈 문구, 피사체가 없으면 잠김. 작은 글자 대비 4.5:1 이상.
// 2. 피사체 → '프롬프트 직접 편집': 시작값 = 피사체를 넣은 버전 프롬프트, 2400자 칸, 자리표시자가 남으면 잠김 → 동의 → 본문 customPrompt·subject ""·원본 첨부.
//    결과: 두 카드 접힘·'원본 ↔ 생성 비교'·색감 일치율·다운로드(결과 주소·파일 이름)·시험 기록 '직접 편집 · 원본 참조'.
// 3. '개별 이미지 보기'(두 카드 다시 보임), 확대 창: 닫기 단추로 포커스, Esc로 닫고 연 단추로 포커스 복귀.
// 4. 기본 모드 → '참조 이미지 변경'(PNG): 썸네일·초기화·동의 문구 '고른 참조 이미지' → multipart customReference+options(원본 첨부 끔·파일 sha256 일치) → 기록 '바꾼 참조'.
// 5. GIF는 거절(안내, 참조 그대로). 초기화 → 원본 썸네일. '참조 이미지 없음' → 동의 문구에서 이미지 빠짐 → JSON attachImage false.
// 각 폭 가로 넘침 0, 외부 요청 0, 동의 없이 POST 0.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA test stage " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const SEC = `document.querySelector("${R}")`;
const TS = `document.querySelector("${R} [aria-label='결과 테스트']")`;
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
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}, [expression, value]);
const BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4];
const putFile = (name, type) => page.evaluate(([TS, name, type, bytes]) => {
  const input = eval(TS).querySelector("[aria-label^='참조 이미지'] input[type=file]");
  const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], name, { type })); input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, [TS, name, type, BYTES]);
const AGREE = `[...(${TS}).querySelectorAll("form input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`;
const SUBJECT = `(${TS}).querySelector("form textarea")`;
const posts = (suffix) => page.evaluate((suffix) => window.__premiere.requests().filter((row) => row.method === "POST" && row.path.endsWith(suffix)), suffix);
const notice = () => page.evaluate((R) => [...document.querySelectorAll(`${R} section > p[role]`)].map((item) => item.textContent).join(" | "), R);
const state = () => page.evaluate((TS) => {
  const ts = eval(TS);
  const text = (selector, root = ts) => root.querySelector(selector)?.textContent.trim() ?? null;
  const form = ts.querySelector("form[aria-label='추론 및 생성 설정']");
  const box = [...form.querySelectorAll("input[type=checkbox]")].find((item) => /동의해요/.test(item.closest("label").textContent));
  const ref = form.querySelector("[aria-label^='참조 이미지']");
  const singles = ts.querySelector("[aria-label='원본 레퍼런스']").parentElement;
  const rgb = (value) => value.match(/[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const back = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) { const c = rgb(getComputedStyle(node).backgroundColor); const alpha = c.length === 3 ? 1 : c[3];
      if (alpha > 0) layers.push([c.slice(0, 3), alpha]); if (alpha === 1) break; }
    return layers.reverse().reduce((under, [color, alpha]) => color.map((value, i) => value * alpha + under[i] * (1 - alpha)), [255, 255, 255]);
  };
  const ratio = (element) => { if (!element) return null; const a = lum(rgb(getComputedStyle(element).color)), b = lum(back(element));
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  const match = ts.querySelector("[aria-label='색감 일치율']");
  return {
    step: [text("header span"), text("header h4"), text("header p")],
    columns: getComputedStyle(form.parentElement).gridTemplateColumns.split(" "),
    head: [...form.firstElementChild.children].map((node) => node.textContent.trim()),
    labels: [...form.querySelectorAll(":scope > label > span:first-child, :scope > div > label > span:first-child")].map((node) => node.firstChild.textContent.trim()),
    textarea: (() => { const area = form.querySelector("textarea"); return { value: area.value, max: area.maxLength, placeholder: area.placeholder }; })(),
    hint: text("textarea + small", form),
    reference: { head: text("div > span", ref), toggle: [text("div > button", ref), ref.querySelector("div > button").getAttribute("aria-pressed")],
      image: ref.querySelector("img")?.getAttribute("alt") ?? null, src: ref.querySelector("img")?.getAttribute("src") ?? null,
      pick: !!ref.querySelector("input[type=file]"), reset: !![...ref.querySelectorAll("button")].find((button) => button.textContent.trim() === "초기화") },
    models: [...form.querySelectorAll("select")].map((select) => select.selectedOptions[0]?.textContent ?? null),
    consent: [box.checked, box.disabled, box.closest("label").textContent.trim()],
    run: [...form.querySelectorAll("button[type=submit]")].map((button) => [button.textContent.trim(), button.disabled])[0],
    paid: [...form.querySelectorAll(":scope > p")].at(-1)?.textContent ?? null,
    singles: !singles.hidden, cards: [...singles.querySelectorAll("section h5")].map((node) => node.textContent),
    placeholder: text("[aria-label='DNA 합성 미리보기'] div span"),
    compare: !!ts.querySelector("[aria-label='원본 ↔ 생성 비교'] [role=slider]"),
    match: match ? text("p + p", match) : null,
    download: match ? [match.querySelector("a[download]").getAttribute("href"), match.querySelector("a[download]").getAttribute("download")] : null,
    tests: [...ts.querySelectorAll("[aria-label='시험 기록'] li span")].map((node) => node.textContent),
    toggle: text("[aria-label='원본 ↔ 생성 비교'] button"),
    ratios: { textButton: ratio(form.firstElementChild.querySelector("button")), hint: ratio(form.querySelector("textarea + small")), refText: ratio(ref.querySelector("p")),
      refHead: ratio(ref.querySelector("div > span")), refPick: ratio(ref.querySelector("label span")), consent: ratio(box.closest("label")), paid: ratio([...form.querySelectorAll(":scope > p")].at(-1)),
      placeholder: ratio(ts.querySelector("[aria-label='DNA 합성 미리보기'] div span")), ratio: ratio(ts.querySelector("[aria-label='원본 레퍼런스'] h5 + span")),
      matchLabel: match ? ratio(match.querySelector("p")) : null, matchValue: match ? ratio(match.querySelector("p + p")) : null, matchNote: match ? ratio(match.querySelector("p + p + p")) : null,
      testTime: ratio(ts.querySelector("[aria-label='시험 기록'] time")), toggle: ratio(ts.querySelector("[aria-label='원본 ↔ 생성 비교'] button")) },
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, TS);
const open = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  // ④ 보관함 이관: 일반 진입 첫 화면은 보관함. 다 불러온 뒤 분석 화면이 아니면 '1. 이미지 분석'(기록 복귀면 이미 분석 화면).
  await until((R) => { const s = document.querySelector(R); const lib = s?.querySelector("[aria-label='보관함'] h4")?.closest("section");
    return !!s?.querySelector("[aria-label='이미지 스타일 분석기'] form") || (!!lib && !/불러오는 중/.test(lib.textContent)); }, "entry", R);
  await page.evaluate((R) => { const s = document.querySelector(R); if (!s.querySelector("[aria-label='이미지 스타일 분석기'] form")) s.querySelector("[aria-label='Style DNA 단계'] button").click(); }, R);
  await until((R) => !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "studio", R);
  await until((R) => !/확인하는 중/.test(document.querySelector(R).innerText), "settings", R);
};
const analyze = async () => {
  const ST = `document.querySelector("${R} [aria-label='이미지 스타일 분석기']")`;
  await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
  await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/city.png");
  await mark(`[...(${ST}).querySelectorAll("form[aria-label='분석 설정'] input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`, "Space");
  await press("이미지 시퀀싱 시작", ST);
  await until((ST) => /Dusk City Portrait/.test(eval(ST).textContent), "analyzed", ST);
};
const shot = async (name) => { await page.evaluate(`(${TS}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/${name}` }); };
const min45 = (ratios, label) => { for (const [key, value] of Object.entries(ratios)) if (value !== null) assert.ok(value >= 4.5, `${label} ${key} ${value}`); };
const PROMPT = "A portrait of [INSERT SUBJECT HERE] in warm afternoon city light, analysis 1";
const results = [];
try {
  for (const [width, height] of [[1574, 1167], [1280, 900], [390, 844], [320, 700]]) {
    console.log("STEP 1 " + width);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    await open(`styleDnaReport=1&w=${width}`);
    await analyze();
    await press("3. 결과 테스트");
    await until((TS) => !!eval(TS), "test stage", TS);
    let v = await state();
    assert.deepEqual(v.step, ["3", "결과 테스트 및 이미지 합성", "마스터 프롬프트로 실제 이미지를 한 장 만들어 원본과 나란히 비교합니다. 대상 프롬프트를 자유롭게 수정하거나 참조 이미지를 연결할 수 있습니다."]);
    assert.deepEqual(v.columns.length === 2 ? v.columns[0] : v.columns.length, width >= 1024 ? "380px" : 1, `열 ${width}`);
    assert.deepEqual(v.head, ["추론 및 생성 설정", "프롬프트 직접 편집"]);
    assert.deepEqual(v.labels, ["시험할 프롬프트 버전", "피사체 대입 (필수)", "이미지 생성 모델", "화면 비율"]);
    assert.deepEqual([v.textarea.max, v.textarea.placeholder], [500, "a young Korean woman in modern hanbok, cinematic lighting"]);
    assert.match(v.hint, /\[INSERT SUBJECT HERE\] 자리에 들어갑니다/);
    assert.deepEqual([v.reference.head, v.reference.toggle, v.reference.image, v.reference.pick, v.reference.reset],
      ["참조 이미지 (Visual DNA Anchor)", ["참조 이미지 연결됨", "true"], "참조 이미지(원본)", true, false]);
    assert.deepEqual(v.consent, [false, false, "버전 1의 프롬프트와 원본 이미지를 Gemini 이미지 모델에 보내 시험 이미지 1장을 만들고 보관하는 데 동의해요."]);
    assert.deepEqual(v.run, ["공정 시작 (이미지 1장 합성)", true]);
    assert.equal(v.paid, "생성 1회마다 등록한 Gemini 이미지 호출 1건(유료)이 발생합니다.");
    assert.deepEqual([v.singles, v.cards, v.placeholder, v.compare, v.match], [true, ["원본 레퍼런스", "DNA 합성 미리보기"], "왼쪽에서 피사체를 입력하고 공정 시작을 눌러주세요.", false, null]);
    min45(v.ratios, `빈 화면 ${width}`);
    await mark(AGREE, "Space");
    assert.deepEqual((await state()).run, ["공정 시작 (이미지 1장 합성)", true], "피사체 없으면 잠김");
    assert.equal((await posts("/test-image")).length, 0);
    await shot(`test-empty-${width}.png`);

    console.log("STEP 2 " + width);
    await typeInto(SUBJECT, "a cat on a neon rooftop");
    await press("프롬프트 직접 편집");
    v = await state();
    assert.equal(v.textarea.value, PROMPT.replace("[INSERT SUBJECT HERE]", "a cat on a neon rooftop"), "시작값 = 피사체를 넣은 프롬프트");
    assert.deepEqual([v.head[1], v.labels[1], v.textarea.max, v.consent[0]], ["기본 프롬프트 모드로", "대상 프롬프트 직접 편집 (Target Prompt)", 2400, false]);
    assert.match(v.consent[2], /버전 1의 직접 편집한 프롬프트와 원본 이미지를/);
    await typeInto(SUBJECT, "Still [INSERT SUBJECT HERE] here");
    await mark(AGREE, "Space");
    assert.equal((await state()).run[1], true, "자리표시자가 남으면 잠김");
    const edited = "Edited: a cat on a neon rooftop, teal and amber city glow";
    await typeInto(SUBJECT, edited);
    assert.equal((await state()).consent[0], false, "편집하면 동의 풀림");
    await mark(AGREE, "Space");
    await press("공정 시작 (이미지 1장 합성)");
    await until((R) => /버전 1 프롬프트로 시험 이미지를 만들었어요/.test(document.querySelector(R).textContent), "tested edited", R);
    let body = (await posts("/test-image")).at(-1).body;
    assert.deepEqual({ ...body, requestId: "id" }, { requestId: "id", authorized: true, credentialVersion: 3, revision: 1, model: "gemini-nano-banana-2.1",
      subject: "", attachImage: true, customPrompt: edited });
    v = await state();
    assert.deepEqual([v.singles, v.compare, v.toggle], [false, true, "개별 이미지 보기 ▾"]);
    assert.match(v.match, /^\d{1,3}%$/);
    const image = await page.evaluate(() => window.__premiere.styleDna.records.at(-1).tests.at(-1).image.href);
    assert.deepEqual(v.download, [image, "style-dna-test-1-v1.webp"]);
    assert.deepEqual(v.tests, ["1번 · 버전 1 · Nano Banana 2.1 · 직접 편집 · 원본 참조"]);
    min45(v.ratios, `결과 ${width}`);
    assert.equal(v.overflow, 0, `넘침 ${width}`);
    await shot(`test-result-${width}.png`);

    console.log("STEP 3 " + width);
    await press("개별 이미지 보기 ▾");
    v = await state();
    assert.deepEqual([v.singles, v.toggle], [true, "개별 이미지 접기 ▴"]);
    await press("확대 보기");
    await until(() => !!document.querySelector("[role=dialog][aria-label='결과 확대 보기']"), "zoom");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "닫기");
    assert.equal(await page.evaluate(() => document.querySelector("[role=dialog] a[download]")?.textContent.trim()), "고해상도 다운로드");
    if (width === 1574 || width === 390) await page.screenshot({ path: `${out}/test-zoom-${width}.png` });
    // 확대 창 초점 순환(Tester ed89d86 지적): 닫기 → Tab 다운로드 → Tab 닫기, Shift+Tab 거꾸로, 창 밖 초점도 Tab이면 창 안으로
    const zoomFocus = () => page.evaluate(() => {
      const box = document.querySelector("[role=dialog][aria-label='결과 확대 보기']");
      const el = document.activeElement;
      return (box?.contains(el) ? "in:" : "out:") + (el?.getAttribute("aria-label") ?? el?.textContent.trim());
    });
    const tabs = [];
    for (const shift of [false, false, false, true, true, true]) {
      if (shift) await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      if (shift) await page.keyboard.up("Shift");
      tabs.push(await zoomFocus());
    }
    assert.deepEqual(tabs, ["in:고해상도 다운로드", "in:닫기", "in:고해상도 다운로드", "in:닫기", "in:고해상도 다운로드", "in:닫기"], "확대 창 안 Tab 순환");
    await page.evaluate(() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur(); });
    await page.keyboard.press("Tab");
    assert.equal(await zoomFocus(), "in:닫기", "창 밖 초점에서 Tab이면 창 안 처음으로");
    await page.evaluate(() => { const a = document.activeElement; if (a instanceof HTMLElement) a.blur(); });
    await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
    assert.equal(await zoomFocus(), "in:고해상도 다운로드", "창 밖 초점에서 Shift+Tab이면 창 안 끝으로");
    await page.keyboard.press("Escape"); await settle(250);
    assert.equal(await page.evaluate(() => !!document.querySelector("[role=dialog]")), false);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), "확대 보기", "연 단추로 포커스 복귀");
    await press("개별 이미지 접기 ▴");

    console.log("STEP 4 " + width);
    await press("기본 프롬프트 모드로");
    assert.equal((await state()).labels[1], "피사체 대입 (필수)");
    await putFile("ref.png", "image/png"); await settle(250);
    v = await state();
    assert.deepEqual([v.reference.image, v.reference.reset], ["바꾼 참조 이미지 ref.png", true]);
    assert.match(v.reference.src, /^blob:/);
    assert.match(v.consent[2], /버전 1의 프롬프트와 고른 참조 이미지를/);
    await mark(AGREE, "Space");
    await press("공정 시작 (이미지 1장 합성)");
    await until((count) => window.__premiere.styleDna.records.at(-1).tests.length > count, "tested upload", 1);
    body = (await posts("/test-image")).at(-1).body;
    assert.deepEqual([body.form, body.file, body.options.attachImage, body.options.subject, "customPrompt" in body.options],
      [["customReference", "options"], "ref.png", false, "a cat on a neon rooftop", false]);
    assert.equal(body.options.customReferenceSha256, createHash("sha256").update(Buffer.from(BYTES)).digest("hex"), "파일 sha256");
    assert.deepEqual((await state()).tests.at(-1), "2번 · 버전 1 · Nano Banana 2.1 · 바꾼 참조");

    console.log("STEP 5 " + width);
    await putFile("ref.gif", "image/gif"); await settle(250);
    assert.match(await notice(), /참조 이미지는 PNG·JPG·WebP만 쓸 수 있어요/);
    assert.equal((await state()).reference.image, "바꾼 참조 이미지 ref.png", "거절하면 참조 그대로");
    await press("초기화");
    assert.deepEqual([(await state()).reference.image, (await state()).reference.reset], ["참조 이미지(원본)", false]);
    await press("참조 이미지 연결됨");
    v = await state();
    assert.deepEqual([v.reference.toggle, v.reference.image], [["참조 이미지 없음", "false"], null]);
    assert.equal(v.consent[2], "버전 1의 프롬프트를 Gemini 이미지 모델에 보내 시험 이미지 1장을 만들고 보관하는 데 동의해요.");
    await mark(AGREE, "Space");
    await press("공정 시작 (이미지 1장 합성)");
    await until((count) => window.__premiere.styleDna.records.at(-1).tests.length > count, "tested none", 2);
    body = (await posts("/test-image")).at(-1).body;
    assert.deepEqual([body.attachImage, "customPrompt" in body, "form" in body], [false, false, false]);
    v = await state();
    assert.equal(v.tests.length, 3);
    assert.equal(v.overflow, 0, `넘침 ${width}`);
    const external = await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length);
    assert.equal(external, 0);
    results.push({ width, columns: v.columns.length, overflow: v.overflow, external, ratios: v.ratios });
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("STYLE-DNA-TEST-RESULT" + JSON.stringify(results));
