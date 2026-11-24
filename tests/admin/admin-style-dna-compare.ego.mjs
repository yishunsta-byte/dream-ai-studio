/* global taskSpace, window, document, console, setTimeout, Event, getComputedStyle, sessionStorage */
import assert from "node:assert/strict";
// P1-06 3단계 원본 비교 슬라이더 이관 확인(3b). admin-hub-fixture-run.mjs 루프백 주소, ?styleDnaReport=1.
// 1. 첫 결과: 원본 v1.39 CompareSlider — 나누기 '◧ 좌우'(가로 원본이라 처음 좌우), 원본·생성 표시, 손잡이(⇆) 키보드 ←/→ 2칸·Shift 10칸·Home/End, ↑/↓ 높이,
//    '⬒ 위아래' 전환(⇅·위쪽 원본 clip), 색 집게(원본 색·생성 색 HEX·색 차이 = 원본 계산식), Enter·'📍 이 자리 저장'으로 점검 지점, ✕ 지우기, 평균 차이.
// 2. '💾 보관함에 저장' → PATCH save-spots(시험·원본/결과 sha·지점 버전 0·틀 크기·지점) → 안내·'이전 기록과 비교'(서버가 잰 이전 → 지금, 점선 지점), 추세 없음.
// 3. 직접 편집으로 새 결과 → 자동 PATCH record-trend 1번(새 시험·지점 버전 1·편집한 프롬프트), 추세 1회. 기본 모드로 또 한 번 → 추세 2회·최고 기록, 프롬프트 = 피사체를 넣은 버전 프롬프트.
// 4. 유실 → '결과 다시 확인'으로 받은 결과도 추세 1번(같은 시험 두 번 아님). 지난 시험 고르기·기록 다시 열기로는 추세 PATCH가 늘지 않는다.
// 5. 추세 점(키보드) → 회차·프롬프트 미리보기 → '✏ 이 프롬프트를 편집 칸으로 불러오기' → 직접 편집 칸·'추세 N회차 프롬프트를 불러왔습니다.' → '되돌리기'로 이전 상태.
// 6. 다른 곳에서 지점이 바뀐 뒤 저장 → 409 stale_spot_version 안내·기록 다시 불러옴. 각 폭 넘침 0, 외부 요청 0, 비교 영역 글자 대비 4.5:1 이상.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA compare " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const SEC = `document.querySelector("${R}")`;
const TS = `document.querySelector("${R} [aria-label='결과 테스트']")`;
const CMP = `(${TS}).querySelector("[role=group][aria-label^='원본과 시험 결과']")`;
const SLIDER = `(${CMP}).querySelector("[role=slider]")`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(200);
};
const pressIn = (scope, text) => mark(`[...(${scope}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`, "Enter");
const press = (text) => pressIn(SEC, text);
const key = async (name, shift = false) => {
  await page.evaluate(`(${SLIDER}).focus()`);
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(name);
  if (shift) await page.keyboard.up("Shift");
  await settle(120);
};
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [expression, value]);
// CMD-044: 보정·시험은 따로 동의 체크 없이 단추를 누르면 바로 보낸다. 그 폼에 동의 체크 상자가 없어야 한다.
const noConsent = async (scope) => assert.equal(await page.evaluate((scope) => [...eval(scope).querySelectorAll("form input[type=checkbox]")].filter((box) => /동의/.test(box.closest("label")?.textContent ?? "")).length, scope), 0, "동의 체크 상자 없음");
const TEXT = `(${TS}).querySelector("form textarea")`;
const patches = () => page.evaluate(() => window.__premiere.requests().filter((row) => row.method === "PATCH" && /\/api\/admin\/style-dna\/[^/]+$/.test(row.path)).map((row) => row.body));
const notice = () => page.evaluate((R) => [...document.querySelectorAll(`${R} section > p[role]`)].map((item) => item.textContent).join(" | "), R);
const record = () => page.evaluate(() => window.__premiere.styleDna.records[0]);
const diff = (a, b) => { const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const [x, y] = [c(a), c(b)];
  return Math.round((Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / Math.hypot(255, 255, 255)) * 1000) / 10; };
const view = () => page.evaluate(([CMP, TS]) => {
  const cmp = eval(CMP), ts = eval(TS);
  const text = (selector, root = cmp) => root?.querySelector(selector)?.textContent.trim() ?? null;
  const slider = cmp.querySelector("[role=slider]");
  const panel = (label) => cmp.querySelector(`[aria-label='${label}']`);
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
  const picker = panel("색 집게"), spots = panel("점검 지점"), prev = panel("이전 기록과 비교"), trend = cmp.querySelector("[aria-label='추세']");
  const picked = cmp.querySelector("[data-trend-picked]");
  const area = ts.querySelector("form textarea");
  return {
    modes: [...cmp.querySelectorAll(":scope > div:first-child button")].map((b) => [b.textContent.trim(), b.getAttribute("aria-pressed")]),
    tags: [...cmp.querySelectorAll(":scope > div:nth-child(2) > span")].filter((s) => !s.getAttribute("role") && !s.dataset.spot && !s.dataset.savedSpot && s.textContent).map((s) => s.textContent),
    slider: [slider.getAttribute("aria-valuenow"), slider.getAttribute("aria-valuetext"), slider.textContent, slider.style.left, slider.style.top],
    orientation: slider.getAttribute("aria-orientation"),
    clip: cmp.querySelector(":scope > div:nth-child(2) > div").style.clipPath,
    colors: picker ? [...picker.querySelectorAll("p")].map((p) => p.textContent.trim()) : null,
    saveSpot: picker ? text("button", picker) : null,
    spotHead: spots ? text("p", spots) : null,
    spotRows: spots ? [...spots.querySelectorAll("li")].map((li) => [...li.querySelectorAll("span")].map((s) => s.textContent.trim())) : [],
    marks: [...cmp.querySelectorAll("[data-spot]")].length, saved: [...cmp.querySelectorAll("[data-saved-spot]")].length,
    message: text("[role=status]"),
    prevHead: prev ? text("p", prev) : null, prevRows: prev ? [...prev.querySelectorAll(":scope > ul li")].length : 0,
    trend: trend ? text("p", trend) : null, dots: trend ? [...trend.querySelectorAll("circle")].length : 0,
    best: trend ? text("[data-trend-best]", trend) : null,
    picked: picked ? picked.textContent.replace(/\s+/g, " ").trim() : null,
    editing: !!ts.querySelector("form[aria-label='추론 및 생성 설정'] textarea[maxlength='2400']"), textarea: area?.value ?? null,
    loaded: text("[data-loaded-from]", ts),
    ratios: { help: ratio(cmp.querySelector(":scope > p:last-child")), modeLabel: ratio(cmp.querySelector(":scope > div:first-child > span")),
      mode: ratio(cmp.querySelector(":scope > div:first-child button[aria-pressed='false']")), swatch: picker ? ratio(picker.querySelector("p")) : null,
      hexText: picker ? ratio(picker.querySelectorAll("p")[1]) : null, saveSpot: picker ? ratio(picker.querySelector("button")) : null,
      spotHead: spots ? ratio(spots.querySelector("p")) : null, sky: ratio(cmp.querySelector("[aria-label='점검 지점'] button") ?? cmp.querySelector("[aria-label='이전 기록과 비교'] button")),
      muted: spots ? ratio([...spots.querySelectorAll("button")].find((b) => b.textContent === "모두 지우기")) : null,
      remove: spots ? ratio(spots.querySelector("li button")) : null, prev: prev ? ratio(prev.querySelector("p")) : null,
      mark: ratio(cmp.querySelector("[data-trend]")), trend: trend ? ratio(trend.querySelector("p")) : null, best: trend ? ratio(trend.querySelector("[data-trend-best]")) : null,
      picked: picked ? ratio(picked) : null, loaded: ratio(ts.querySelector("[data-loaded-from]")), loadedUndo: ratio(ts.querySelector("[data-loaded-from] button")) },
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, [CMP, TS]);
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
  await pressIn(ST, "이미지 시퀀싱 시작");
  await until((ST) => /Dusk City Portrait/.test(eval(ST).textContent), "analyzed", ST);
};
const run = async (expect) => {
  const before = (await record()).tests.length;
  await noConsent(TS);
  await press("공정 시작 (이미지 1장 합성)");
  if (expect === "lost") { await until((R) => /응답을 받지 못했어요/.test(document.querySelector(R).textContent), "lost", R); return; }
  await until(([R, n]) => /프롬프트로 시험 이미지를 만들었어요/.test(document.querySelector(R).textContent) && window.__premiere.styleDna.records[0].tests.length > n, "tested", [R, before]);
};
const pixels = async () => until((CMP) => (eval(CMP)?.querySelector("[aria-label='색 집게'] p:nth-child(2)")?.textContent ?? "—") !== "—", "picker", CMP);
const trendCount = async () => (await patches()).filter((body) => body.action === "record-trend").length;
const min45 = (ratios, label) => { for (const [name, value] of Object.entries(ratios)) if (value !== null) assert.ok(value >= 4.5, `${label} ${name} ${value}`); };
const ORIGINAL = { center: "#E8D5B0", edge: "#1F6F6A" }, RESULT = { center: "#F4F1EA", edge: "#C96A3B" };
const results = [];
try {
  for (const [width, height] of [[1574, 1167], [1280, 900], [390, 844], [320, 700]]) {
    console.log("STEP 1 " + width);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    await open(`styleDnaReport=1&styleDnaSeed=1&w=${width}`);
    await analyze();
    await press("3. 결과 테스트");
    await until((TS) => !!eval(TS), "test stage", TS);
    await typeInto(TEXT, "a cat on a neon rooftop");
    await run();
    await until((CMP) => !!eval(CMP), "compare", CMP);
    await pixels();
    let v = await view();
    assert.deepEqual(v.modes, [["◧ 좌우", "true"], ["⬒ 위아래", "false"]], "가로 원본은 처음 좌우");
    assert.deepEqual(v.tags, ["원본", "생성"]);
    assert.deepEqual([...v.slider.slice(0, 3), v.orientation], ["50", "왼쪽 원본 50% · 오른쪽 생성 50%", "⇆", "horizontal"]);
    assert.equal(v.clip, "inset(0px 50% 0px 0px)");
    assert.deepEqual(v.colors, ["원본 색", ORIGINAL.center, "색 차이", `${diff(ORIGINAL.center, RESULT.center)}%`, "생성 색", RESULT.center], "가운데 색");
    for (const [name, shift, now] of [["ArrowRight", false, "52"], ["ArrowLeft", true, "42"], ["Home", false, "0"], ["End", false, "100"], ["ArrowLeft", false, "98"]]) {
      await key(name, shift);
      assert.equal((await view()).slider[0], now, `${name}${shift ? "+Shift" : ""}`);
    }
    await key("ArrowDown"); assert.equal((await view()).slider[4], "52%", "↓ 높이 2칸");
    await key("ArrowUp");
    await pressIn(CMP, "⬒ 위아래");
    v = await view();
    assert.deepEqual([v.modes[1][1], v.slider[0], v.slider[1], v.slider[2], v.clip, v.orientation], ["true", "50", "위 원본 50% · 아래 생성 50%", "⇅", "inset(0px 0px 50%)", "vertical"]);
    // 3c: 위아래 모드 Home/End = 세로 처음·끝(가로 위치는 그대로), 화살표·Shift는 원본 그대로
    const keepX = v.slider[3];
    for (const [name, shift, now] of [["Home", false, "0"], ["End", false, "100"], ["ArrowUp", false, "98"], ["ArrowUp", true, "88"], ["Home", false, "0"]]) {
      await key(name, shift);
      v = await view();
      assert.deepEqual([v.slider[0], v.slider[4], v.slider[3]], [now, `${now}%`, keepX], `위아래 ${name}${shift ? "+Shift" : ""}`);
    }
    for (let i = 0; i < 5; i++) await key("ArrowDown", true);
    assert.equal((await view()).slider[0], "50");
    // 위아래 모드에서도 ←/→는 색 집게 가로 위치만(값은 그대로)
    await key("ArrowRight");
    v = await view();
    assert.deepEqual([v.slider[0], v.slider[3] !== keepX], ["50", true], "위아래 → 가로만");
    await key("ArrowLeft");
    assert.equal((await view()).slider[3], keepX);
    await pressIn(CMP, "◧ 좌우");
    assert.equal((await view()).orientation, "horizontal");
    // 가운데(두 그림 다 원 안)와 위쪽 6%(두 그림 다 바탕)에 점검 지점 두 곳. 세 번째 왼쪽 10%는 세로 생성 그림의 여백이라 「—」, 확인 뒤 지우기.
    await key("Home"); for (let i = 0; i < 5; i++) await key("ArrowRight", true);
    await key("Enter");
    for (let i = 0; i < 4; i++) await key("ArrowUp", true);
    await key("ArrowUp"); await key("ArrowUp");
    assert.deepEqual((await view()).slider.slice(3), ["50%", "6%"]);
    await pressIn(CMP, "📍 이 자리 저장 (1/8)");
    await key("Home"); await key("ArrowRight", true); await key("Enter");
    v = await view();
    assert.equal(v.marks, 3);
    assert.deepEqual(v.spotRows[2].slice(0, 5), ["3", ORIGINAL.edge, "→", "—", "—"], "생성 그림 여백은 —");
    await mark(`(${CMP}).querySelector("[aria-label='3번 지점 지우기']")`, "Enter");
    v = await view();
    const d1 = diff(ORIGINAL.center, RESULT.center), d2 = diff(ORIGINAL.edge, RESULT.edge);
    assert.equal(v.marks, 2);
    assert.deepEqual(v.spotRows.map((row) => row.slice(0, 5)), [["1", ORIGINAL.center, "→", RESULT.center, `${d1}%`], ["2", ORIGINAL.edge, "→", RESULT.edge, `${d2}%`]]);
    assert.match(v.spotHead, new RegExp(`^점검 지점 2곳 · 평균 차이 ${Math.round(((d1 + d2) / 2) * 10) / 10}%`));
    assert.equal(v.saveSpot, "📍 이 자리 저장 (2/8)");
    assert.deepEqual([v.prevHead, v.trend], [null, null]);
    min45(v.ratios, `지점 ${width}`);
    if (width === 1574 || width === 390) { await page.evaluate(`(${CMP}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/compare-spots-${width}.png` }); }

    console.log("STEP 2 " + width);
    const first = (await record()).tests[0];
    await pressIn(CMP, "💾 보관함에 저장");
    await until((CMP) => !!eval(CMP).querySelector("[aria-label='이전 기록과 비교']"), "saved", CMP);
    let sent = (await patches()).at(-1);
    const frame = await page.evaluate((CMP) => { const f = eval(CMP).querySelector(":scope > div:nth-child(2)"); return { width: Math.round(f.clientWidth), height: Math.round(f.clientHeight) }; }, CMP);
    assert.deepEqual({ ...sent, requestId: "id" }, { action: "save-spots", testId: first.id, originalSha256: first.original.sha256, resultSha256: first.image.sha256,
      spotVersion: 0, frame, spots: [{ x: 50, y: 50 }, { x: 50, y: 6 }], requestId: "id" });
    const saved = (await record()).comparison;
    v = await view();
    assert.equal(v.message, "보관함에 2곳을 저장했습니다. 프롬프트를 고쳐 다시 만들면 같은 자리를 비교해 드립니다.");
    const prevAvg = Math.round(((saved.spots[0].diff + saved.spots[1].diff) / 2) * 10) / 10;
    assert.match(v.prevHead, new RegExp(`^이전 기록과 비교 · 평균 ${prevAvg}% → ${Math.round(((d1 + d2) / 2) * 10) / 10}%`), "서버가 잰 이전 → 지금");
    assert.deepEqual([v.saved, v.prevRows, v.trend, await trendCount()], [2, 2, null, 0], "저장만으로 추세 없음");

    console.log("STEP 3 " + width);
    await press("프롬프트 직접 편집");
    const edited = "Edited: a cat on a neon rooftop, teal and amber city glow";
    await typeInto(TEXT, edited);
    await run();
    await until(() => window.__premiere.styleDna.records[0].comparison.trends.length === 1, "trend 1");
    const second = (await record()).tests.at(-1);
    sent = (await patches()).at(-1);
    assert.deepEqual({ ...sent, requestId: "id" }, { action: "record-trend", testId: second.id, originalSha256: second.original.sha256, resultSha256: second.image.sha256,
      spotVersion: 1, prompt: edited, requestId: "id" });
    await until((CMP) => /^추세 1회/.test(eval(CMP).querySelector("[aria-label='추세'] p")?.textContent ?? ""), "trend shown", CMP);
    await press("기본 프롬프트 모드로");
    await run();
    await until(() => window.__premiere.styleDna.records[0].comparison.trends.length === 2, "trend 2");
    const filled = (await record()).revisions[0].prompts.en.replace("[INSERT SUBJECT HERE]", "a cat on a neon rooftop");
    assert.equal((await patches()).at(-1).prompt, filled, "기본 모드 추세 프롬프트 = 피사체를 넣은 버전 프롬프트");
    await until((CMP) => /^추세 2회/.test(eval(CMP).querySelector("[aria-label='추세'] p")?.textContent ?? ""), "trend 2 shown", CMP);
    const trends = (await record()).comparison.trends;
    v = await view();
    assert.match(v.trend, new RegExp(`^추세 2회 · 처음 ${trends[0].avg}% → 최근 ${trends[1].avg}%`));
    const bestIdx = trends[1].avg <= trends[0].avg ? 1 : 0;
    assert.equal(v.best, `🏆 최고 기록 ${bestIdx + 1}회차 ${trends[bestIdx].avg}%`);
    assert.equal(v.dots, 2);
    assert.equal(await trendCount(), 2);

    console.log("STEP 4 " + width);
    await page.evaluate(() => window.__premiere.styleDna.faults.test.push({ lost: true }));
    await run("lost");
    assert.equal(await trendCount(), 2, "유실 중에는 추세 없음");
    await press("결과 다시 확인");
    await until(() => window.__premiere.styleDna.records[0].comparison.trends.length === 3, "trend 3 after recovery");
    assert.equal(await trendCount(), 3, "유실 복구 결과도 한 번");
    await mark(`[...(${TS}).querySelectorAll("[aria-label='시험 기록'] input[type=radio]")][0]`, "Space");
    await settle(300);
    assert.equal(await trendCount(), 3, "지난 결과 고르기로는 추세 안 늘어남");
    // 보관함에서 다른 기록(미리 넣은 기록)을 열었다가 다시 이 기록을 연다 — 과거 기록 열기로는 추세를 남기지 않는다.
    const reopen = async (title) => {
      // ④ 보관함: '보관함' 단추 → 카드 '열기'(열면 그 기록의 분석 화면)
      await mark(`(${SEC}).querySelector("[aria-label='Style DNA 단계']").previousElementSibling`, "Enter");
      await mark(`[...[...(${SEC}).querySelectorAll("section[aria-label='보관함'] li")].find((li) => li.querySelector("button > span:nth-of-type(2)")?.textContent === ${JSON.stringify(title)}).querySelectorAll("button")][1]`, "Enter");
      await until(([R, title]) => document.querySelector(R).textContent.includes(`보관한 분석을 열었어요. '${title}'`), "reopen " + title, [R, title]);
    };
    const ours = (await record()).title;
    await reopen("보관된 도심 인물 사진");
    await reopen(ours);
    await press("3. 결과 테스트");
    await until((CMP) => !!eval(CMP)?.querySelector("[aria-label='추세']"), "reopened compare", CMP);
    await settle(500);
    assert.equal(await trendCount(), 3, "다시 열기로는 추세 안 늘어남");

    console.log("STEP 5 " + width);
    await mark(`(${CMP}).querySelector("[data-trend-dot='2']")`, "Enter");
    v = await view();
    const t2 = (await record()).comparison.trends[1];
    assert.match(v.picked, new RegExp(`^2회차.* · 버전 1 · 평균 차이 ${t2.avg}% \\(2곳\\)`));
    assert.ok(v.picked.includes(`「${filled}」`), "2회차 프롬프트 미리보기");
    await mark(`(${CMP}).querySelector("[data-trend-dot='1']")`, "Enter");
    assert.match((await view()).picked, /「Edited: a cat on a neon rooftop, teal and amber city glow」/);
    const beforeLoad = (await view()).textarea;
    await mark(`(${CMP}).querySelector("[data-load-prompt]")`, "Enter");
    v = await view();
    assert.deepEqual([v.editing, v.textarea, v.loaded?.startsWith("추세 1회차 프롬프트를 불러왔습니다.")], [true, edited, true]);
    min45({ loaded: v.ratios.loaded, loadedUndo: v.ratios.loadedUndo, picked: v.ratios.picked, trend: v.ratios.trend, best: v.ratios.best, mark: v.ratios.mark, prev: v.ratios.prev }, `추세 ${width}`);
    if (width === 1574 || width === 390) { await page.evaluate(`(${TS}).scrollIntoView({ block: "start" })`); await settle(400); await page.screenshot({ path: `${out}/compare-loaded-${width}.png` }); }
    await pressIn(TS, "되돌리기");
    v = await view();
    assert.deepEqual([v.editing, v.textarea, v.loaded], [false, beforeLoad, null], "되돌리기 = 불러오기 전 상태");

    console.log("STEP 6 " + width);
    await page.evaluate(() => { const c = window.__premiere.styleDna.records[0].comparison; c.spotVersion += 1; });
    await pressIn(CMP, "지점 불러오기");
    v = await view();
    assert.equal(v.marks, 2, "저장 지점 불러오기");
    const gets = await page.evaluate(() => window.__premiere.requests().filter((row) => row.method === "GET" && /\/api\/admin\/style-dna\/[^/]+$/.test(row.path)).length);
    await pressIn(CMP, "💾 보관함에 저장");
    await until((CMP) => /다른 곳에서 점검 지점이 바뀌었어요/.test(eval(CMP).textContent), "stale", CMP);
    await until(([n]) => window.__premiere.requests().filter((row) => row.method === "GET" && /\/api\/admin\/style-dna\/[^/]+$/.test(row.path)).length > n, "reloaded", [gets]);
    assert.equal((await patches()).at(-1).spotVersion, 1);
    v = await view();
    assert.equal(v.overflow, 0, `넘침 ${width}`);
    min45(v.ratios, `끝 ${width}`);
    const external = await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length);
    assert.equal(external, 0);
    assert.ok(!(await notice()).includes("undefined"));
    results.push({ width, overflow: v.overflow, external, trends: await trendCount(), ratios: v.ratios });
  }
  console.log("STYLE-DNA-COMPARE-RESULT" + JSON.stringify(results));
} finally {
  await task.close?.().catch?.(() => {});
}
