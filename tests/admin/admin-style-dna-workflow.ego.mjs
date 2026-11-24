/* global taskSpace, window, document, navigator, console, innerWidth, setTimeout, Event, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, sessionStorage */
import assert from "node:assert/strict";
// P1-06 Style DNA 작업실: admin-hub-fixture-run.mjs가 연 루프백 주소에서 실행한다(Backend ab798b1 계약 대역: fixture.styleDna).
// 확인: 보관함·설정 GET만 하고 실행 전 POST 0, 분석 소스 선택 전 실행 잠김. ① 주소·파일 분석(복제·변형 강도·지침·첨부 구문·문법 모델) → 기록·보고서·실측 5색, 보관함 증가.
// ② 빠른 피드백 보정 → 새 버전·이력, 오래된 버전 409(다시 읽기)·등록 버전 409(설정 다시 읽기). 보정·시험은 동의 체크 상자 없이 단추로 바로 실행(CMD-044). ③ 피사체 필수·비율·원본 첨부 → 시험 이미지·슬라이더 비교·색 근접도,
// 응답 유실 → 같은 요청으로 다시 확인(결과 하나). 멈추기·다른 기록 열기 → 끊김·늦은 결과 0. 새로고침 뒤 마지막 기록 다시 열기. 모델 미등록 안내. 320·390·1280 넘침 없음.
// P1-06 원본 분석 화면(1단계) 뒤: 분석 단계는 원본 스튜디오(이미지 시퀀싱 시작·분석 뒤에도 분석 화면 유지·제목은 리포트 KR 줄·팔레트는 미학적 팔레트). 원본 화면 자체 확인은 admin-style-dna-studio.ego.mjs.
const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA workflow " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const SEC = `[...document.querySelectorAll("${R} h3")].find((heading) => heading.textContent.startsWith("Style DNA 작업실")).closest("section")`;
const rows = () => page.evaluate(() => window.__premiere.requests().filter((row) => row.path.startsWith("/api/admin/style-dna")));
const posts = async (suffix = "") => (await rows()).filter((row) => row.method === "POST" && row.path.endsWith(suffix));
const view = () => page.evaluate((SEC) => {
  const sec = eval(SEC);
  const form = sec.querySelector("form");
  const run = form ? [...form.querySelectorAll("button[type=submit]")][0] : null;
  const checks = form ? [...form.querySelectorAll("input[type=checkbox]")].filter((box) => /동의/.test(box.closest("label")?.textContent ?? "")) : [];
  const lib = sec.querySelector("[aria-label='Style DNA 단계']")?.previousElementSibling;
  return { library: lib?.textContent ?? null, libraryOpen: lib?.getAttribute("aria-pressed") ?? null,
    items: [...sec.querySelectorAll("section[aria-label='보관함'] li")].map((item) => item.querySelector("button > span:nth-of-type(2)")?.textContent ?? null),
    steps: [...sec.querySelectorAll("[aria-label='Style DNA 단계'] button")].map((button) => [button.textContent, button.getAttribute("aria-pressed"), button.disabled]),
    settings: sec.querySelector("[aria-label='Style DNA 설정']")?.textContent ?? null,
    run: run?.disabled ?? null, consent: checks.at(-1)?.checked ?? null,
    record: sec.querySelector("[aria-label='열린 분석'] h4")?.textContent ?? sec.querySelector("[aria-label='분석 리포트'] p + p")?.textContent.replace(/^KR: /, "") ?? null,
    recordNote: sec.querySelector("[aria-label='열린 분석'] p")?.textContent ?? null,
    palette: [...sec.querySelectorAll("[aria-label='원본 실측 5색'] li, [aria-label='미학적 팔레트'] li")].map((item) => item.textContent),
    report: !!sec.querySelector("[aria-label='열린 분석'] [aria-label='분석 제목'], [aria-label='열린 분석'] section, [aria-label='열린 분석'] details"),
    history: [...sec.querySelectorAll("[aria-label='보정 기록'] li p > span")].map((item) => item.textContent),
    historyEmpty: sec.querySelector("[aria-label='보정 기록'] ol") ? null : sec.querySelector("[aria-label='보정 기록'] p")?.textContent ?? null,
    refineTitle: sec.querySelector("[aria-label='프롬프트 보정'] [aria-label='현재 프롬프트'] img + div p")?.textContent ?? null,
    prompts: [...sec.querySelectorAll("form strong, [aria-label='현재 프롬프트'] h6")].map((item) => item.textContent).filter((text) => text.startsWith("마스터") || text.startsWith("시험에")),
    compare: !!sec.querySelector("[role=group][aria-label^='원본과 시험 결과'] [role=slider]"), proximity: sec.querySelector("[aria-label='색감 일치율'] p + p")?.textContent ?? null,
    tests: [...sec.querySelectorAll("[aria-label='시험 기록'] input[type=radio]")].length,
    notice: [...sec.querySelectorAll(":scope > p[role], p[id$='-operation-status']")].map((item) => item.textContent).filter(Boolean).join(" | "),
    retry: [...sec.querySelectorAll(":scope > p button")].some((button) => button.textContent === "결과 다시 확인"),
    stop: [...sec.querySelectorAll(":scope > div button")].some((button) => button.textContent.trim() === "멈추기") };
}, SEC);
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const button = (text) => `[...(${SEC}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`;
const press = (text) => mark(button(text), "Enter");
// ④ 보관함: '보관함' 단추(단계 묶음 앞)와 카드 '열기'
const LIBRARY = `(${SEC}).querySelector("[aria-label='Style DNA 단계']").previousElementSibling`;
const openCard = (title) => mark(`[...[...(${SEC}).querySelectorAll("section[aria-label='보관함'] li")].find((li) => li.querySelector("button > span:nth-of-type(2)")?.textContent === ${JSON.stringify(title)}).querySelectorAll("button")][1]`, "Enter");
const labelled = (text, tag = "input") => `[...(${SEC}).querySelectorAll("label")].find((label) => label.textContent.trim().startsWith(${JSON.stringify(text)})).querySelector("${tag}")`;
const pick = (text) => mark(labelled(text), "Space");
// CMD-044: 보정·시험에는 동의 체크 상자가 없다. 예전에 동의하던 자리에서는 체크 상자가 없는지만 확인한다.
const consent = async () => assert.equal((await view()).consent, null, "동의 체크 상자 없음");
const RANGE = `(${SEC}).querySelector("[aria-label='시스템 가이던스'] input[type=range]")`;
const FILE = `(${SEC}).querySelector("input[type=file]")`;
const type = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}, [expression, value]);
const noticeIs = (pattern, label) => until(([SEC, source]) => new RegExp(source).test([...eval(SEC).querySelectorAll(":scope > p[role], p[id$='-operation-status']")].map((item) => item.textContent).join(" ")), label, [SEC, pattern.source]);
const open = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  await until((SEC) => { try { const sec = eval(SEC); return !!sec && !/확인하는 중/.test(sec.innerText); } catch { return false; } }, "section", SEC);
  await page.evaluate(() => { window.__clip = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__clip.push(text); } } }); });
};
const fault = (op, value) => page.evaluate(([op, value]) => window.__premiere.styleDna.faults[op].push(value), [op, value]);
const results = [];

try {
  for (const width of [320, 390, 1280]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const row = { width };

    console.log("STEP 1 " + width);
    // 1. 보관함 1개·설정 표시, 보정·시험 단계 잠김, 분석 소스 선택 전 실행 잠김, POST 0
    await open(`styleDnaSeed=1&w=${width}`);
    let v = await view();
    assert.deepEqual([v.library, v.libraryOpen, v.items, v.steps.map((item) => item[2]), v.run], ["보관함 1", "true", ["보관된 도심 인물 사진"], [false, true, true], null], "첫 화면은 보관함");
    await press("1. 이미지 분석");
    v = await view();
    assert.deepEqual([v.libraryOpen, v.run, v.consent], ["false", true, null]);
    assert.equal(v.settings, "분석 모델 gemini-fixture-image · Gemini 등록 버전 3 · 시험 생성 모델 Nano Banana 2.1, Nano Banana 2 Lite");
    assert.deepEqual([(await rows()).length, (await posts()).length], [2, 0], "열기만 하면 목록·엔진 설정 GET 두 건, POST 0");

    console.log("STEP 2 " + width);
    // 2. 주소 분석: 변형 80(파격)·지침·문법 모델 → 시작 클릭 → POST 1(JSON) → 기록·보고서·5색, 보관함 2
    await pick("HTTPS 주소");
    await type(labelled("이미지 주소"), "https://images.example.com/city.png");
    await press("스타일 변형");
    await type(RANGE, "80");
    assert.match(await page.evaluate(`(${RANGE}).closest("div").textContent`), /변형 강도80%파격 \(과감한 재해석\)/);
    await type(labelled("추가 분석 지침", "textarea"), "조명과 표면 질감을 집중 분석");
    await type(labelled("타겟 이미지 모델", "select"), "gemini-3.1-flash-lite-image");
    assert.equal((await view()).run, false);
    assert.equal((await posts()).length, 0, "주소와 설정을 입력해도 POST 0");
    await press("이미지 시퀀싱 시작");
    await noticeIs(/분석을 마치고 보관함에 저장했어요\. '주소 분석'/, "analyzed url");
    assert.equal((await posts("style-dna")).length, 1);
    const sent = (await posts()).at(-1).body;
    assert.deepEqual({ ...sent, requestId: "id" }, { requestId: "id", authorized: true, credentialVersion: 3, mode: "mutate", guidance: "조명과 표면 질감을 집중 분석",
      mutationLevel: 80, includeImageTag: true, targetModel: "gemini-3.1-flash-lite-image", source: { kind: "url", url: "https://images.example.com/city.png" } });
    await until((SEC) => eval(SEC).querySelector("[aria-label='Style DNA 단계']").previousElementSibling.textContent === "보관함 2", "library 2", SEC);
    v = await view();
    assert.deepEqual([v.record, v.steps.map((item) => item[1]), v.palette.length, v.consent], ["주소 분석", ["true", "false", "false"], 5, null]);

    console.log("STEP 3 " + width);
    // 3. 보정: 빠른 피드백 두 개 → v2·이력(동의 체크 없음). 오래된 버전 409 → 기록 다시 읽기. 등록 버전 409 → 설정 다시 읽기
    await press("2. 프롬프트 보정");
    // 원본 2단계: 왼쪽 카드에 썸네일·제목, 보정 기록은 비어 있으면 원본 문구. 아래 '열린 분석'은 2단계에 없다(원본 카드와 겹침).
    v = await view();
    assert.deepEqual([v.refineTitle, v.historyEmpty, v.recordNote, v.prompts], ["주소 분석", "아직 보정한 적이 없습니다.", null, ["마스터 프롬프트 (EN) v1", "마스터 프롬프트 (KO) v1"]]);
    await press("색감을 더 따뜻하게");
    await press("배경을 단순하게");
    assert.equal(await page.evaluate(`(${labelled("보정 피드백", "textarea")}).value`), "색감을 더 따뜻하게, 배경을 단순하게");
    await consent();
    await press("미세 보정 요청");
    await noticeIs(/새 보정 버전을 저장했어요\(버전 2\)/, "refined 2");
    v = await view();
    assert.deepEqual([v.history, v.prompts.slice(0, 2)], [["버전 2"], ["마스터 프롬프트 (EN) v2", "마스터 프롬프트 (KO) v2"]]);
    assert.deepEqual((await posts("/refine")).at(-1).body.revision, 1);
    await press("복사");
    assert.match(await page.evaluate(() => window.__clip.at(-1)), /refined 2$/);
    await fault("refine", { status: 409, body: { code: "stale_revision" } });
    await type(labelled("보정 피드백", "textarea"), "조명을 더 부드럽게");
    await consent();
    const gets = (await rows()).filter((item) => item.method === "GET" && /b00\d$/.test(item.path)).length;
    await press("미세 보정 요청");
    await noticeIs(/다른 곳에서 새 보정 버전이 먼저 저장됐어요/, "stale revision");
    await until((count) => window.__premiere.requests().filter((item) => item.method === "GET" && /b00[0-9]$/.test(item.path)).length > count, "reread", gets);
    assert.equal((await view()).consent, null, "409 뒤에도 동의 체크 상자 없음");
    await fault("refine", { status: 409, body: { code: "stale_credential" } });
    await consent();
    const lists = (await rows()).filter((item) => item.method === "GET" && item.path === "/api/admin/style-dna").length;
    await press("미세 보정 요청");
    await noticeIs(/Gemini 등록 버전이 바뀌었어요/, "stale credential");
    await until((count) => window.__premiere.requests().filter((item) => item.method === "GET" && item.path === "/api/admin/style-dna").length > count, "relist", lists);
    assert.equal((await view()).consent, null, "409 뒤에도 동의 체크 상자 없음");

    console.log("STEP 4 " + width);
    // 4. 시험: 버전 1로 → 피사체 필수(비면 잠김) → 9:16·원본 첨부 → 시험 이미지·슬라이더·색 근접도. 응답 유실 → 같은 요청 다시 확인 → 결과 하나
    await press("처음 분석(버전 1)으로 시험");
    v = await view();
    assert.equal(v.steps[2][1], "true");
    await consent();
    assert.equal((await view()).run, true, "subject required");
    await type(labelled("피사체", "textarea"), "a cat on a neon rooftop");
    await type(labelled("화면 비율", "select"), "9:16");
    await consent();
    await press("공정 시작 (이미지 1장 합성)");
    await noticeIs(/버전 1 프롬프트로 시험 이미지를 만들었어요/, "tested");
    const tested = (await posts("/test-image")).at(-1).body;
    assert.deepEqual({ ...tested, requestId: "id" }, { requestId: "id", authorized: true, credentialVersion: 3, revision: 1, model: "gemini-nano-banana-2.1",
      subject: "a cat on a neon rooftop", attachImage: true, aspectRatio: "9:16" });
    v = await view();
    assert.deepEqual([v.compare, v.tests], [true, 1]);
    assert.match(v.proximity, /^9\d%$/, "색감 일치율(서버 실측 5색)");
    row.testOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(row.testOverflow <= 0, "test overflow " + row.testOverflow);
    await page.evaluate(`(${SEC}).querySelector("[aria-label='결과 테스트']").scrollIntoView({ block: "start" })`);
    await page.screenshot({ path: `${globalThis.FIXTURE_OUTPUT_DIR ?? "."}/style-dna-test-${width}.png` });
    // 원본 비교 슬라이더(3b): → 2칸
    await mark(`(${SEC}).querySelector("[aria-label^='원본과 시험 결과'] [role=slider]")`, "ArrowRight");
    assert.equal(await page.evaluate(`(${SEC}).querySelector("[aria-label^='원본과 시험 결과'] [role=slider]").getAttribute("aria-valuenow")`), "52");
    await fault("test", { lost: true });
    await consent();
    await press("공정 시작 (이미지 1장 합성)");
    await noticeIs(/응답을 받지 못했어요/, "lost");
    assert.equal((await view()).retry, true);
    const lostBody = (await posts("/test-image")).at(-1).body;
    await press("결과 다시 확인");
    await noticeIs(/버전 1 프롬프트로 시험 이미지를 만들었어요/, "recovered");
    const replay = await posts("/test-image");
    assert.deepEqual(replay.at(-1).body, lostBody);
    assert.deepEqual([(await view()).tests, await page.evaluate(() => window.__premiere.styleDna.records[0].tests.length)], [2, 2]);

    console.log("STEP 5 " + width);
    // 5. 파일 분석(FormData)과 멈추기·다른 기록 열기 → 끊김, 늦은 결과·기록 추가 0
    await press("1. 이미지 분석");
    await pick("파일");
    await page.evaluate(`(() => { const input = ${FILE}; const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "studio.png", { type: "image/png" })); input.files = data.files;
      input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await press("스타일 복제");
    assert.equal((await view()).run, false, "파일을 고르면 분석을 시작할 수 있음");
    const analyzesBeforeFile = (await posts("style-dna")).length;
    await press("이미지 시퀀싱 시작");
    await noticeIs(/분석을 마치고 보관함에 저장했어요\. '파일 studio\.png'/, "analyzed file");
    assert.equal((await posts("style-dna")).length, analyzesBeforeFile + 1);
    const formBody = (await posts()).filter((item) => item.path === "/api/admin/style-dna").at(-1).body;
    assert.deepEqual([formBody.form, formBody.file, formBody.options.mode, formBody.options.mutationLevel], [["file", "options"], "studio.png", "replicate", 30]);
    const before = await page.evaluate(() => window.__premiere.styleDna.records.length);
    await press("1. 이미지 분석");
    await page.evaluate(() => { window.__premiere.styleDna.hold = "analyze"; });
    await press("이미지 시퀀싱 시작");
    assert.equal((await view()).stop, true);
    await press("멈추기");
    await page.evaluate(() => { window.__premiere.styleDna.hold = ""; window.__premiere.release(); }); await settle(300);
    assert.equal((await posts()).filter((item) => item.path === "/api/admin/style-dna").at(-1).aborted, true);
    assert.match((await view()).notice, /요청을 멈췄어요/);
    await page.evaluate(() => { window.__premiere.styleDna.hold = "analyze"; });
    await press("이미지 시퀀싱 시작");
    await mark(LIBRARY, "Enter");
    await openCard("보관된 도심 인물 사진");
    await page.evaluate(() => { window.__premiere.styleDna.hold = ""; window.__premiere.release(); }); await settle(400);
    assert.equal((await posts()).filter((item) => item.path === "/api/admin/style-dna").at(-1).aborted, true);
    assert.deepEqual([await page.evaluate(() => window.__premiere.styleDna.records.length), (await view()).record], [before, "보관된 도심 인물 사진"]);
    row.aborted = (await rows()).filter((item) => item.aborted).length;

    console.log("STEP 6 " + width);
    // 6. 새로고침 뒤 마지막으로 연 기록(보관된 도심 인물 사진)을 다시 연다. 모델 미등록이면 실행 잠김
    await page.goto(`${base}/admin?page=style-dna-panel&styleDnaSeed=1&w=${width}${R}`);
    await until((SEC) => { try { return eval(SEC).querySelector("[aria-label='분석 리포트'] p + p")?.textContent === "KR: 보관된 도심 인물 사진"; } catch { return false; } }, "reopened", SEC);
    row.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(row.overflow <= 0, "overflow " + row.overflow);
    await page.evaluate(`(${SEC}).scrollIntoView({ block: "start" })`);
    await page.screenshot({ path: `${globalThis.FIXTURE_OUTPUT_DIR ?? "."}/style-dna-workflow-${width}.png` });
    await page.evaluate(() => sessionStorage.clear());
    await open(`styleDnaModel=none&w=${width}`);
    v = await view();
    assert.match(v.settings, /^이미지 분석 모델이 등록되지 않아 실행할 수 없어요/);
    assert.equal(v.library, "보관함 0");
    assert.match(await page.evaluate(`(${SEC}).querySelector("section[aria-label='보관함']").textContent`), /아직 분석한 이미지가 없습니다\./);
    await press("1. 이미지 분석");
    await pick("HTTPS 주소");
    await type(labelled("이미지 주소"), "https://images.example.com/no-key.png");
    v = await view();
    assert.deepEqual([v.consent, v.run], [null, true]);
    results.push(row);
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("STYLE-DNA-WORKFLOW-RESULT" + JSON.stringify(results));
