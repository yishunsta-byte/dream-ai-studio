/* global taskSpace, window, document, console, setTimeout, Event, getComputedStyle, sessionStorage */
import assert from "node:assert/strict";
// P1-06 ④ 원본 보관함 이관 확인. admin-hub-fixture-run.mjs 루프백 주소.
// 1. 일반 진입 첫 화면 = 보관함: 불러오는 중(?styleDnaHold=list) → 원본 머리(보관함·설명·보관 n/100·'새 이미지 분석'), 카드(4:3 썸네일·팔레트 막대 = 서버 5색 비율·제목·
//    '스타일 복제 · 버전 1 · 날짜'·'열기'·휴지통(분석 삭제)), 격자 열 = 컨테이너 705/1217 기준 1·2·3열.
// 2. '새 이미지 분석' → 빈 분석 폼(열린 기록 없음, 보정·시험 잠김) → 주소 분석 → 보관함 2, 새 기록 카드 '열려 있음'(현재 표시).
// 3. 다른 카드(썸네일 단추) 열기 → 그 기록의 분석 화면·'보관한 분석을 열었어요'. 지침 입력 → 또 다른 기록 열기에서는 지침 그대로 →
//    '새 이미지 분석' → 기록 닫힘·빈 폼(지침 비움)·마지막 기록 기억 지움.
// 4. 카드를 연 뒤 새로고침 → 마지막 기록 복귀는 바로 분석 화면(보관함 거치지 않음). 기억이 없으면 새로고침 첫 화면 = 보관함.
// 5. 첫 목록 실패(?styleDnaListFault=500) → 오류 안내·'다시 확인' → 목록. 빈 보관함 → 원본 빈 카드·API 연동 링크·'첫 이미지 분석하기' → 분석 폼.
// 6. 삭제(④-4b, Backend 0727932 계약 대역): 휴지통 → '삭제 확인'/'취소'(초점 '취소'), 취소 → 휴지통으로 초점. 503 → 안내·목록·확인 상태 그대로.
//    다시 '삭제 확인' → 본문 없는 DELETE 204 → 카드 빠짐·안내로 초점·목록 다시 읽기. 열린 기록 삭제 → 기록 닫힘·마지막 기록 기억 지움·빈 보관함.
//    404(이미 없음) → 목록에서 뺌. 연결 끊김 → 목록 그대로·'다시 확인'은 DELETE 없이 상세 GET: 200 = 삭제 안 됨(그대로), 503 = 그대로·다시 확인,
//    404 = 삭제 정리(열린 기록이면 닫고 기억 지움 → 새로고침해도 복원 안 함, 다른 기록이면 열린 기록 그대로).
// 각 폭 넘침 0, 외부 요청 0, 보관함 글자 대비 4.5:1 이상.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA library " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const SEC = `document.querySelector("${R}")`;
const LIB = `(${SEC}).querySelector("section[aria-label='보관함']")`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const press = (text) => mark(`[...(${SEC}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`, "Enter");
const card = (title) => `[...(${LIB}).querySelectorAll("li")].find((li) => li.querySelector("button > span:nth-of-type(2)")?.textContent === ${JSON.stringify(title)})`;
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [expression, value]);
const view = () => page.evaluate(([SEC, LIB]) => {
  const sec = eval(SEC), lib = eval(LIB);
  const tab = sec.querySelector("[aria-label='Style DNA 단계']").previousElementSibling;
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
  const grid = lib?.querySelector("ul");
  const li = lib?.querySelector("li");
  const cardButtons = li ? [...li.querySelectorAll("button")] : [];
  return {
    tab: [tab.textContent, tab.getAttribute("aria-pressed")],
    steps: [...sec.querySelectorAll("[aria-label='Style DNA 단계'] button")].map((b) => b.disabled),
    library: !!lib, analyzer: !!sec.querySelector("[aria-label='이미지 스타일 분석기'] form"),
    head: lib ? [lib.querySelector("h4")?.textContent, lib.querySelector("h4 + p")?.textContent, [...lib.querySelectorAll(":scope > div:first-child > button")].map((b) => b.textContent.trim())] : null,
    loading: lib?.querySelector("[role=status]")?.textContent.trim() ?? null,
    error: lib?.querySelector("[role=alert]")?.textContent ?? null,
    empty: lib && !grid ? [...lib.querySelectorAll(":scope > div:last-child p")].map((p) => p.textContent) : null,
    emptyLink: lib?.querySelector(":scope > div:last-child p a")?.getAttribute("href") ?? null,
    cards: grid ? [...grid.querySelectorAll(":scope > li")].map((item) => {
      const cover = item.querySelector("button");
      const box = cover.querySelector("img").getBoundingClientRect();
      return { title: cover.querySelector(":scope > span:nth-of-type(2)").textContent, meta: cover.querySelector(":scope > span:nth-of-type(3)").textContent,
        img: [cover.querySelector("img").getAttribute("src"), cover.querySelector("img").getAttribute("alt"), Math.round((box.width / box.height) * 10) / 10],
        palette: [...cover.querySelectorAll(":scope > span:first-of-type > span")].map((s) => [s.style.background, s.style.width]),
        current: item.getAttribute("aria-current"), buttons: [...item.querySelectorAll("button")].map((b) => [b.getAttribute("aria-label") ?? b.textContent.trim(), b.disabled]) };
    }) : null,
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : null, container: lib ? lib.clientWidth : null,
    trash: !!lib?.querySelector("[aria-label='분석 삭제']"),
    report: sec.querySelector("[aria-label='분석 리포트'] p + p")?.textContent ?? null,
    notice: [...sec.querySelectorAll(":scope > p[role]")].map((p) => p.textContent).join(" | "),
    ratios: lib ? { title: ratio(lib.querySelector("h4")), desc: ratio(lib.querySelector("h4 + p")), primary: ratio(lib.querySelector(":scope > div:first-child > button")),
      cardTitle: ratio(li?.querySelector("button > span:nth-of-type(2)")), meta: ratio(li?.querySelector("button > span:nth-of-type(3)")), metaMode: ratio(li?.querySelector("button > span:nth-of-type(3) b")),
      open: ratio(cardButtons[1]), trash: ratio(lib.querySelector("[aria-label='분석 삭제']")), danger: ratio(lib.querySelector("[aria-label$='삭제 확인']")),
      cancel: ratio([...lib.querySelectorAll("button")].find((b) => b.textContent.trim() === "취소")), note: ratio(lib.querySelector("[role=status][data-note]")), loading: ratio(lib.querySelector("[role=status]")), error: ratio(lib.querySelector("[role=alert] span")), retry: ratio(lib.querySelector("[role=alert] button")),
      empty: ratio(lib.querySelector(":scope > div:last-child p:not(:first-child)")), emptyTitle: ratio(lib.querySelector(":scope > div:last-child p")),
      emptyLink: ratio(lib.querySelector(":scope > div:last-child p a")) } : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, [SEC, LIB]);
const go = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  await until((R) => !!document.querySelector(`${R} [aria-label='Style DNA 단계']`), "section", R);
};
const settled = () => until(([SEC, LIB]) => { const lib = eval(LIB); return eval(SEC).querySelector("[aria-label='이미지 스타일 분석기'] form") || (lib && !/불러오는 중/.test(lib.textContent)); }, "settled", [SEC, LIB]);
const min45 = (ratios, label) => { for (const [name, value] of Object.entries(ratios ?? {})) if (value !== null) assert.ok(value >= 4.5, `${label} ${name} ${value}`); };
const analyzeUrl = async () => {
  const ST = `document.querySelector("${R} [aria-label='이미지 스타일 분석기']")`;
  await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
  await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/city.png");
  await mark(`[...(${ST}).querySelectorAll("form[aria-label='분석 설정'] input[type=checkbox]")].find((box) => /동의해요/.test(box.closest("label").textContent))`, "Space");
  await mark(`[...(${ST}).querySelectorAll("button")].find((item) => item.textContent.trim() === "이미지 시퀀싱 시작")`, "Enter");
  await until((R) => /분석을 마치고 보관함에 저장했어요/.test(document.querySelector(R).textContent), "analyzed", R);
};
const SEED = "보관된 도심 인물 사진";
const results = [];
try {
  for (const [width, height] of [[1574, 1167], [1280, 900], [390, 844], [320, 700]]) {
    console.log("STEP 1 " + width);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    await go(`styleDnaSeed=1&styleDnaHold=list&w=${width}`);
    await until((LIB) => !!eval(LIB)?.querySelector("[role=status]"), "loading", LIB);
    let v = await view();
    assert.deepEqual([v.tab, v.library, v.analyzer, v.loading, v.steps], [["보관함", "true"], true, false, "불러오는 중…", [false, true, true]], "첫 화면 = 보관함 불러오는 중");
    min45({ loading: v.ratios.loading }, `불러오는 중 ${width}`);
    await page.evaluate(() => { window.__premiere.styleDna.hold = ""; window.__premiere.release(); });
    await settled();
    v = await view();
    const seed = await page.evaluate(() => window.__premiere.styleDna.records[0]);
    assert.deepEqual(v.head, ["보관함", "분석한 이미지는 자동으로 저장됩니다. 카드를 눌러 다시 열고 보정·테스트를 이어가세요. 보관 1 / 100", ["새 이미지 분석"]]);
    assert.equal(v.tab[0], "보관함 1");
    assert.deepEqual(v.cards.map(({ title, meta, img, current, buttons }) => ({ title, meta, img, current, buttons })), [{ title: SEED,
      meta: `스타일 복제 · 버전 1 · ${new Date(seed.createdAt).toLocaleDateString("ko-KR")}`, img: [seed.original.href, "", 1.3], current: null,
      buttons: [[`${SEED} 열기`, false], ["열기", false], ["분석 삭제", false]] }]);
    assert.deepEqual(v.cards[0].palette.map(([, w]) => w), seed.original.palette.map((c) => `${c.share * 100}%`), "팔레트 막대 = 서버 5색 비율");
    assert.equal(v.columns, v.container >= 1217 ? 3 : v.container >= 705 ? 2 : 1, `격자 열 ${v.container}`);
    assert.equal(v.trash, true, "원본 휴지통(분석 삭제)");
    min45(v.ratios, `보관함 ${width}`);
    if (width === 1574 || width === 390) { await page.evaluate(`(${LIB}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/library-${width}.png` }); }

    console.log("STEP 2 " + width);
    await press("새 이미지 분석");
    v = await view();
    assert.deepEqual([v.tab[1], v.library, v.analyzer, v.report, v.steps], ["false", false, true, null, [false, true, true]], "새 이미지 분석 = 빈 폼");
    await analyzeUrl();
    await until((SEC) => eval(SEC).querySelector("[aria-label='Style DNA 단계']").previousElementSibling.textContent === "보관함 2", "library 2", SEC);
    const ours = await page.evaluate(() => window.__premiere.styleDna.records[0].title);
    await press("보관함 2");
    v = await view();
    assert.deepEqual(v.cards.map((c) => [c.title, c.current, c.buttons]), [[ours, "true", [[`${ours} (열려 있음)`, true], ["열려 있음", true], ["분석 삭제", false]]], [SEED, null, [[`${SEED} 열기`, false], ["열기", false], ["분석 삭제", false]]]]);
    min45(v.ratios, `열린 카드 ${width}`);

    console.log("STEP 3 " + width);
    await mark(`(${card(SEED)}).querySelector("button")`, "Enter");
    await until((SEC) => /보관한 분석을 열었어요\. '보관된 도심 인물 사진'/.test(eval(SEC).textContent), "opened seed", SEC);
    v = await view();
    assert.deepEqual([v.tab[1], v.analyzer, v.report, v.steps], ["false", true, `KR: ${SEED}`, [false, false, false]], "카드 열기 = 그 기록의 분석 화면");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("dream:style-dna:last")), seed.id);
    // 추가 분석 지침: 다른 기록 열기에서는 그대로, '새 이미지 분석'에서는 비움
    const GUIDE = `[...(${SEC}).querySelectorAll("[aria-label='이미지 스타일 분석기'] label")].find((label) => label.textContent.trim().startsWith("추가 분석 지침")).querySelector("textarea")`;
    await typeInto(GUIDE, "조명 위주로");
    await press("보관함 2");
    await mark(`[...(${card(ours)}).querySelectorAll("button")][1]`, "Enter");
    await until(([SEC, ours]) => eval(SEC).textContent.includes(`보관한 분석을 열었어요. '${ours}'`), "opened ours", [SEC, ours]);
    assert.equal(await page.evaluate(`(${GUIDE}).value`), "조명 위주로", "기록 열기는 지침 보존");
    await press("보관함 2");
    await press("새 이미지 분석");
    v = await view();
    assert.deepEqual([v.analyzer, v.report, v.steps], [true, null, [false, true, true]], "열린 기록 닫힘");
    assert.equal(await page.evaluate(`(${GUIDE}).value`), "", "새 이미지 분석은 지침 비움");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("dream:style-dna:last")), null);

    console.log("STEP 4 " + width);
    await press("보관함 2");
    await mark(`[...(${card(SEED)}).querySelectorAll("button")][1]`, "Enter");
    await until((SEC) => /보관한 분석을 열었어요/.test(eval(SEC).textContent), "opened again", SEC);
    // 대역 기록은 브라우저 안에 있어 새로고침하면 미리 넣은 기록만 남는다(같은 ID) → 마지막 기록 복귀 확인
    await page.goto(`${base}/admin?page=style-dna-panel&styleDnaSeed=1&w=${width}${R}`);
    await until((SEC) => { try { return eval(SEC).querySelector("[aria-label='분석 리포트'] p + p")?.textContent === "KR: 보관된 도심 인물 사진"; } catch { return false; } }, "restored", SEC);
    v = await view();
    assert.deepEqual([v.tab[1], v.library, v.analyzer], ["false", false, true], "기록 복귀는 바로 분석 화면");
    await page.evaluate(() => sessionStorage.clear());
    await go(`styleDnaSeed=1&w=${width}`);
    await settled();
    assert.deepEqual((await view()).tab, ["보관함 1", "true"], "기억이 없으면 첫 화면 = 보관함");

    console.log("STEP 5 " + width);
    await go(`styleDnaSeed=1&styleDnaListFault=500&w=${width}`);
    await until((LIB) => !!eval(LIB)?.querySelector("[role=alert]"), "error", LIB);
    v = await view();
    assert.match(v.error, /^보관함을 불러오지 못했습니다\.다시 확인$/);
    assert.equal(v.cards, null);
    min45({ error: v.ratios.error, retry: v.ratios.retry }, `오류 ${width}`);
    await press("다시 확인");
    await settled();
    v = await view();
    assert.deepEqual([v.error, v.cards?.map((c) => c.title)], [null, [SEED]]);
    await go(`w=${width}`);
    await settled();
    v = await view();
    assert.deepEqual(v.empty, ["아직 분석한 이미지가 없습니다.", "1단계에서 이미지를 올리면 카메라·조명·색상·스타일을 분석해 마스터 프롬프트를 만들어 드립니다. 먼저 계정설정 및 API 연동에서 Gemini(또는 OpenAI·Claude) 키를 등록해주세요."]);
    assert.equal(v.emptyLink, "#admin-api-integrations");
    assert.equal(v.tab[0], "보관함 0");
    min45(v.ratios, `빈 보관함 ${width}`);
    if (width === 1574 || width === 390) { await page.evaluate(`(${LIB}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/library-empty-${width}.png` }); }
    await press("첫 이미지 분석하기");
    assert.equal((await view()).analyzer, true);
    v = await view();
    assert.equal(v.overflow, 0, `넘침 ${width}`);
    const external = await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length);
    assert.equal(external, 0);

    console.log("STEP 6 " + width);
    const trashOf = (title) => `(${card(title)}).querySelector("[aria-label='분석 삭제']")`;
    const focused = () => page.evaluate(() => [document.activeElement.getAttribute("aria-label") ?? document.activeElement.textContent.trim(), document.activeElement.closest("li")?.querySelector("button > span:nth-of-type(2)")?.textContent ?? null]);
    const deletes = () => page.evaluate(() => window.__premiere.requests().filter((item) => item.method === "DELETE"));
    const lists = () => page.evaluate(() => window.__premiere.requests().filter((item) => item.method === "GET" && item.path === "/api/admin/style-dna").length);
    const noteIs = (pattern, label) => until(([LIB, source]) => new RegExp(source).test(eval(LIB)?.querySelector("[data-note]")?.textContent ?? ""), label, [LIB, pattern.source]);
    await go(`styleDnaSeed=1&w=${width}`);
    await settled();
    await press("새 이미지 분석");
    await analyzeUrl();
    const [mine, seedId] = await page.evaluate(() => [window.__premiere.styleDna.records[0], window.__premiere.styleDna.records[1].id]);
    await press("보관함 2");
    await mark(trashOf(SEED), "Enter");
    v = await view();
    assert.deepEqual(v.cards[1].buttons, [[`${SEED} 열기`, false], ["열기", false], [`'${SEED}' 삭제 확인`, false], ["취소", false]], "휴지통 → 삭제 확인/취소");
    assert.deepEqual(await focused(), ["취소", SEED], "초점은 '취소'");
    min45({ danger: v.ratios.danger, cancel: v.ratios.cancel, trash: v.ratios.trash }, `삭제 확인 ${width}`);
    // hover: 실제로 실린 CSS의 '삭제 확인' hover 배경 위 흰 글자 대비(원본 rose-500 3.67 → 제품 rose-700)
    const hoverBg = await page.evaluate((LIB) => {
      const cls = eval(LIB).querySelector("[aria-label$='삭제 확인']").classList[0];
      for (const sheet of document.styleSheets) { let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
        for (const rule of rules) if ((rule.selectorText ?? "").includes(`.${cls}:hover`)) return rule.style.backgroundColor; } return null; }, LIB);
    const lum = (rgb) => rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const hoverRatio = Math.round(((1.05) / (lum(hoverBg.match(/\d+/g).slice(0, 3).map(Number)) + 0.05)) * 100) / 100;
    assert.ok(hoverRatio >= 4.5, `삭제 확인 hover 대비 ${hoverBg} ${hoverRatio}`);
    assert.equal(v.overflow, 0, `확인 넘침 ${width}`);
    if (width === 1574 || width === 390) { await page.evaluate(`(${card(SEED)}).scrollIntoView({ block: "center" })`); await settle(250); await page.screenshot({ path: `${out}/library-delete-confirm-${width}.png` }); }
    await press("취소");
    v = await view();
    assert.deepEqual(v.cards[1].buttons.at(-1), ["분석 삭제", false]);
    assert.deepEqual(await focused(), ["분석 삭제", SEED], "취소하면 초점은 휴지통");
    assert.equal((await deletes()).length, 0, "확인 전 DELETE 0");

    // 초점 테두리: 2px 실선이 보이는지(색은 관리자 공용 .console 초점 규칙이 이길 수 있어 투명만 아니면 됨)
    const outline = () => page.evaluate(() => { const s = getComputedStyle(document.activeElement);
      return [s.outlineStyle, s.outlineWidth, !/rgba\(.*, 0\)|transparent/.test(s.outlineColor)]; });
    await page.evaluate(() => window.__premiere.styleDna.faults.delete.push({ status: 503, body: { code: "not_connected" } }));
    await mark(trashOf(SEED), "Enter");
    await press("삭제 확인");
    await until((LIB) => /저장소가 준비되지 않아 삭제하지 못했어요\. 목록은 그대로예요\./.test(eval(LIB).querySelector("[role=alert]")?.textContent ?? ""), "delete 503", LIB);
    v = await view();
    assert.deepEqual([v.cards.map((c) => c.title), v.cards[1].buttons.at(-1), v.tab[0]], [[mine.title, SEED], ["취소", false], "보관함 2"], "503 → 목록·확인 상태 그대로");
    min45({ error: v.ratios.error }, `삭제 실패 ${width}`);
    // 실패 안내(role=alert, data-note)도 초점을 받으면 하늘색 테두리(제품 CSS .error[data-note]:focus-visible)
    await page.evaluate((LIB) => eval(LIB).querySelector("[role=alert][data-note]").focus(), LIB);
    assert.deepEqual(await outline(), ["solid", "2px", true], "실패 안내 초점 테두리");

    const listsBefore = await lists();
    await press("삭제 확인");
    await noteIs(/^분석을 삭제했어요\. '보관된 도심 인물 사진'$/, "deleted seed");
    v = await view();
    assert.deepEqual([v.cards.map((c) => c.title), v.tab[0], v.error], [[mine.title], "보관함 1", null], "204 → 카드 빠짐");
    assert.deepEqual(await focused(), [`분석을 삭제했어요. '${SEED}'`, null], "삭제 뒤 초점은 결과 안내");
    assert.deepEqual(await outline(), ["solid", "2px", true], "성공 안내 초점 테두리");
    min45({ note: v.ratios.note }, `삭제 안내 ${width}`);
    const sent = (await deletes()).map(({ path, body, headers }) => [path, body, headers]);
    assert.deepEqual(sent, [[`/api/admin/style-dna/${seedId}`, null, {}], [`/api/admin/style-dna/${seedId}`, null, {}]], "본문·Content-Type 없는 DELETE(503 한 번 + 성공 한 번)");
    await until((n) => window.__premiere.requests().filter((item) => item.method === "GET" && item.path === "/api/admin/style-dna").length > n, "list refreshed", listsBefore);

    assert.equal(await page.evaluate(() => sessionStorage.getItem("dream:style-dna:last")), mine.id);
    await mark(trashOf(mine.title), "Enter");
    await press("삭제 확인");
    await until(([LIB, text]) => eval(LIB)?.querySelector("[data-note]")?.textContent === text, "deleted mine", [LIB, `분석을 삭제했어요. '${mine.title}'`]);
    v = await view();
    assert.deepEqual([v.cards, v.empty?.[0], v.tab, v.steps], [null, "아직 분석한 이미지가 없습니다.", ["보관함 0", "true"], [false, true, true]], "열린 기록 삭제 → 닫힘·빈 보관함");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("dream:style-dna:last")), null, "마지막 기록 기억 지움");
    await press("1. 이미지 분석");
    v = await view();
    assert.deepEqual([v.analyzer, v.report], [true, null]);

    await go(`styleDnaSeed=1&w=${width}`);
    await settled();
    await page.evaluate(() => window.__premiere.styleDna.records.splice(0));
    await mark(trashOf(SEED), "Enter");
    await press("삭제 확인");
    await noteIs(/^이미 삭제된 분석이라 목록에서 뺐어요\. '보관된 도심 인물 사진'$/, "deleted 404");
    v = await view();
    assert.deepEqual([v.cards, v.tab[0]], [null, "보관함 0"], "404 → 목록에서 뺌");

    // 응답 유실 뒤 '다시 확인'(Master msg_4f114fbc7b49): DELETE를 다시 보내지 않고 상세 GET으로 판단. 내 기록(mine2)을 연 채로 시작.
    await go(`styleDnaSeed=1&w=${width}`);
    await settled();
    await press("새 이미지 분석");
    await analyzeUrl();
    const [mine2, seedId2] = await page.evaluate(() => [window.__premiere.styleDna.records[0], window.__premiere.styleDna.records[1].id]);
    await press("보관함 2");
    const lostAlert = (LIB) => /^연결이 끊겨 삭제됐는지 확인하지 못했어요\. 목록을 다시 확인해 주세요\.다시 확인$/.test(eval(LIB).querySelector("[role=alert]")?.textContent ?? "");
    const gets = (id) => page.evaluate((id) => window.__premiere.requests().filter((item) => item.method === "GET" && item.path === `/api/admin/style-dna/${id}`).length, id);
    const deletesOf = async (id) => (await deletes()).filter((item) => item.path === `/api/admin/style-dna/${id}`).length;
    const last = () => page.evaluate(() => sessionStorage.getItem("dream:style-dna:last"));

    // (1) 지우기 전에 끊김 → 다시 확인 = 상세 200 → '삭제되지 않았어요', 목록·열린 기록 그대로
    await page.evaluate(() => window.__premiere.styleDna.faults.delete.push({ lost: "before" }));
    await mark(trashOf(SEED), "Enter");
    await press("삭제 확인");
    await until(lostAlert, "lost before", LIB);
    let seedGets = await gets(seedId2);
    await press("다시 확인");
    await noteIs(/^삭제되지 않았어요\. '보관된 도심 인물 사진' 기록은 그대로 있어요\.$/, "not deleted");
    v = await view();
    assert.deepEqual([v.cards.map((c) => c.title), await gets(seedId2) - seedGets, await deletesOf(seedId2), await last(), v.steps],
      [[mine2.title, SEED], 1, 1, mine2.id, [false, false, false]], "200 → 그대로, 상세 GET 1·DELETE 1");
    assert.deepEqual((await focused())[0], `삭제되지 않았어요. '${SEED}' 기록은 그대로 있어요.`, "다시 확인 뒤 초점은 안내");
    await press("취소");

    // (2) 열려 있지 않은 기록이 지워진 뒤 끊김 → 다시 확인 503(자료 그대로) → 다시 확인 404 → 카드만 빠지고 열린 기록(mine2)·기억은 그대로
    await page.evaluate(() => window.__premiere.styleDna.faults.delete.push({ lost: true }));
    await mark(trashOf(SEED), "Enter");
    await press("삭제 확인");
    await until(lostAlert, "lost seed", LIB);
    assert.deepEqual((await view()).cards.map((c) => c.title), [mine2.title, SEED], "끊김 → 목록 그대로");
    await page.evaluate(() => window.__premiere.styleDna.faults.get.push({ status: 503, body: { code: "storage_unavailable" } }));
    await press("다시 확인");
    await until((LIB) => /^삭제됐는지 아직 확인하지 못했어요\. 목록은 그대로예요\.다시 확인$/.test(eval(LIB).querySelector("[role=alert]")?.textContent ?? ""), "recheck 503", LIB);
    v = await view();
    assert.deepEqual([v.cards.map((c) => c.title), await last()], [[mine2.title, SEED], mine2.id], "확인 실패 → 자료 그대로");
    await press("다시 확인");
    await noteIs(/^분석을 삭제했어요\. '보관된 도심 인물 사진'$/, "recheck 404 seed");
    v = await view();
    assert.deepEqual([v.cards.map((c) => c.title), v.steps, await last(), await deletesOf(seedId2)], [[mine2.title], [false, false, false], mine2.id, 2],
      "다른 기록 삭제 확인 → 열린 기록·기억 그대로, 중복 DELETE 없음");

    // (3) 열린 기록(mine2)이 지워진 뒤 끊김 → 다시 확인 404 → 기록 닫힘·기억 지움, 새로고침해도 복원 안 함
    await page.evaluate(() => window.__premiere.styleDna.faults.delete.push({ lost: true }));
    await mark(trashOf(mine2.title), "Enter");
    await press("삭제 확인");
    await until(lostAlert, "lost mine", LIB);
    assert.deepEqual([(await view()).steps, await last()], [[false, false, false], mine2.id], "끊김 직후 열린 기록 그대로");
    await press("다시 확인");
    await until(([LIB, text]) => eval(LIB)?.querySelector("[data-note]")?.textContent === text, "recheck 404 mine", [LIB, `분석을 삭제했어요. '${mine2.title}'`]);
    v = await view();
    assert.deepEqual([v.cards, v.steps, await last(), await deletesOf(mine2.id)], [null, [false, true, true], null, 1], "열린 기록 삭제 확인 → 닫힘·기억 지움");
    await page.goto(`${base}/admin?page=style-dna-panel&styleDnaSeed=1&w=${width}${R}`);
    await until((R) => !!document.querySelector(`${R} [aria-label='Style DNA 단계']`), "reload", R);
    await settled();
    v = await view();
    assert.deepEqual([v.tab[1], v.report], ["true", null], "새로고침해도 지운 기록을 복원하지 않음");
    const external2 = await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length);
    assert.equal(external2, 0);
    results.push({ width, overflow: v.overflow, external: external + external2, hover: hoverRatio });
  }
  console.log("STYLE-DNA-LIBRARY-RESULT" + JSON.stringify(results));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
