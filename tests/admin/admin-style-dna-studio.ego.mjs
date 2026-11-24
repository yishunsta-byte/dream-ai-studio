/* global taskSpace, window, document, navigator, console, innerWidth, setTimeout, Event, getComputedStyle, sessionStorage */
import assert from "node:assert/strict";
// P1-06 원본 Style DNA v1.39 분석 화면 이관(1단계) 확인. admin-hub-fixture-run.mjs 루프백 주소에서 ?styleDnaReport=1(서버 1d7ee8d 선택 보고서 대역)로 연다.
// 1. 빈 분석 상태: 원본 머리·3열 카드·대기 문구, 카메라·조명 10칸 '---', 팔레트·DNA·일치율은 예시값 없이 빈 상태, 아래 추론 막대 잠김, 요청은 목록 GET 하나.
// 2. 다크 스튜디오 전환·도움말 창(Esc로 닫기). 3. 파일 고르기 → 미리보기·브라우저 실측 색(서버 전송 0).
// 4. 분석 중 스캔(레이저·'스타일 분석 중...'·'---') → 결과: 제목 두 줄·카메라/조명 값과 미확인 '—'·청사진/스타일/팁·프롬프트 두 개·서버 실측 5색·DNA(0% 포함)·일치율·키워드.
// 5. 아래 추론 막대 보정 2회: v2는 청사진만, v3는 스타일만 바뀌고 나머지는 이어받음. 복사. 6. 보관함에서 확장 없는 이전 기록 다시 열기 → 빈 칸·의미 분석으로 채운 청사진.
// 7. 모델 오류 실패 안내·빈 칸 유지, 키 미등록 경고·잠김. 각 폭(320·390·1280·1574)에서 가로 넘침 0, 빈 상태·결과 상태 사진. 1574는 원본 비교 사진(image-comparison-1574.png)과 같은 폭.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA studio " + Date.now());
const page = task.page("p1");
const R = "#admin-style-dna";
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const ST = `document.querySelector("${R} [aria-label='이미지 스타일 분석기']")`;
const rows = () => page.evaluate(() => window.__premiere.requests().filter((row) => row.path.startsWith("/api/admin/style-dna")));
const studio = () => page.evaluate((ST) => {
  const st = eval(ST);
  if (!st) return null;
  const text = (selector) => st.querySelector(selector)?.textContent.trim() ?? null;
  const facts = (label) => [...st.querySelectorAll(`[aria-label='${label}'] dl > div`)].map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]);
  const grid = st.querySelector("form[aria-label='분석 설정']").parentElement;
  const buttons = [...st.querySelectorAll("button")];
  return {
    theme: st.dataset.theme, columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    title: text("header h4"), quick: [...st.querySelectorAll("header button")].map((button) => button.textContent.trim()),
    camera: facts("카메라 & 렌즈"), lighting: facts("조명 환경 분석"),
    cameraNote: text("[aria-label='카메라 & 렌즈'] p"), gold: st.querySelector("[aria-label='조명 환경 분석'] dd[class]")?.textContent ?? null,
    waiting: text("[aria-label^='스캔 뷰어'] strong"), viewerImage: !!st.querySelector("[aria-label^='스캔 뷰어'] img"),
    scanning: !!st.querySelector("[aria-label^='스캔 뷰어'] img[data-scanning]"), scanText: [...st.querySelectorAll("[aria-label^='스캔 뷰어'] p")].map((item) => item.textContent).join("|"),
    ratio: [...st.querySelectorAll("[aria-label^='스캔 뷰어'] span")].map((item) => item.textContent).find((value) => value.startsWith("AR: ")) ?? null,
    report: text("[aria-label='분석 리포트'] strong"), titles: [...st.querySelectorAll("[aria-label='분석 리포트'] > div p")].map((item) => item.textContent),
    blueprint: [...st.querySelectorAll("[aria-label='구조적 청사진'] li")].map((item) => item.textContent), blueprintNote: text("[aria-label='구조적 청사진'] > p:last-child"),
    style: [...st.querySelectorAll("[aria-label='스타일 분석'] li")].map((item) => item.textContent), tips: [...st.querySelectorAll("[aria-label='프로의 활용 팁'] li")].map((item) => item.textContent),
    tipsEmpty: text("[aria-label='프로의 활용 팁'] > p:last-child"),
    prompts: [...st.querySelectorAll("section[aria-label^='마스터 프롬프트']")].map((item) => [item.getAttribute("aria-label"), item.querySelector("p").textContent]),
    palette: [...st.querySelectorAll("[aria-label='미학적 팔레트'] li")].map((item) => item.textContent), paletteNote: text("[aria-label='미학적 팔레트'] > p"),
    donut: st.querySelectorAll("[aria-label='미학적 팔레트'] svg circle").length,
    bars: [...st.querySelectorAll("[aria-label='스타일 핵심 요소'] li")].map((item) => item.textContent), barsEmpty: text("[aria-label='스타일 핵심 요소'] > p"),
    score: text("[aria-label='스타일 일치율'] strong"), scoreNote: text("[aria-label='스타일 일치율'] p:last-child"),
    keywords: [...st.querySelectorAll("[aria-label='추출된 키워드'] li")].map((item) => item.textContent),
    refineInput: st.querySelector("form[aria-label='추론 인터페이스'] input[type=text]").disabled,
    refineRun: buttons.find((button) => button.textContent.trim() === "미세 보정 요청").disabled,
    testLink: buttons.filter((button) => button.textContent.trim() === "3단계 결과 테스트").map((button) => button.disabled),
    run: buttons.find((button) => /이미지 시퀀싱/.test(button.textContent)).textContent.trim(),
    runDisabled: buttons.find((button) => /이미지 시퀀싱/.test(button.textContent)).disabled,
  };
}, ST);
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const button = (text) => `[...(${ST}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`;
const press = (text) => mark(button(text), "Enter");
// CMD-044: 분석 아래 보정 줄에는 동의 체크 상자가 없고, 보낼 내용은 안내 문구로만 보인다.
const noConsent = async (form) => assert.deepEqual(await page.evaluate(([ST, form]) => { const f = eval(ST).querySelector(`form[aria-label='${form}']`);
  return [f.querySelectorAll("input[type=checkbox]").length, [...f.querySelectorAll("p")].some((p) => /'미세 보정 요청'을 누르면 현재 버전 \d+의 프롬프트와 피드백을 .+에 보내 새 보정 버전을 만들어요\(호출 1건\)/.test(p.textContent))]; }, [ST, form]), [0, true]);
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [expression, value]);
const notice = () => page.evaluate((R) => [...document.querySelectorAll(`${R} section > p[role]`)].map((item) => item.textContent).join(" | "), R);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const shot = async (name) => { await page.evaluate(`(${ST}).scrollIntoView({ block: "start" })`); await settle(200); await page.screenshot({ path: `${out}/${name}`, fullPage: true }); };
const open = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  // ④ 보관함 이관: 일반 진입 첫 화면은 보관함. 다 불러온 뒤 분석 화면이 아니면 '1. 이미지 분석'(기록 복귀면 이미 분석 화면).
  await until((R) => { const s = document.querySelector(R); const lib = s?.querySelector("[aria-label='보관함'] h4")?.closest("section");
    return !!s?.querySelector("[aria-label='이미지 스타일 분석기'] form") || (!!lib && !/불러오는 중/.test(lib.textContent)); }, "entry", R);
  await page.evaluate((R) => { const s = document.querySelector(R); if (!s.querySelector("[aria-label='이미지 스타일 분석기'] form")) s.querySelector("[aria-label='Style DNA 단계'] button").click(); }, R);
  await until((ST) => { try { return !!eval(ST); } catch { return false; } }, "studio", ST);
  await until((R) => !/확인하는 중/.test(document.querySelector(R).innerText), "settings", R);
  await page.evaluate(() => { window.__clip = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__clip.push(text); } } }); });
};
const EMPTY10 = ["---", "---", "---", "---", "---"];
const results = [];

try {
  for (const width of [320, 390, 1280, 1574]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    const row = { width };

    console.log("STEP 1 " + width);
    await open(`styleDnaReport=1&styleDnaSeed=1&w=${width}`);
    await page.evaluate(() => sessionStorage.clear());
    await open(`styleDnaReport=1&w=${width}`);
    let v = await studio();
    assert.equal(v.title, "이미지 스타일 분석기");
    assert.deepEqual(v.quick, ["도움말", "다크 스튜디오"]);
    assert.deepEqual([v.camera.map((item) => item[1]), v.lighting.map((item) => item[1])], [EMPTY10, EMPTY10]);
    assert.deepEqual(v.camera.map((item) => item[0]), ["앵글", "샷 타입", "렌즈", "초점 거리", "피사계 심도"]);
    assert.deepEqual(v.lighting.map((item) => item[0]), ["시간대", "조명 방향", "고도", "대비", "그림자"]);
    assert.deepEqual([v.waiting, v.viewerImage, v.report], ["이미지를 업로드하면 DNA 스캔이 시작됩니다", false, "분석된 프롬프트 리포트 대기 중"]);
    assert.deepEqual([v.palette, v.paletteNote, v.donut], [[], "이미지를 고르면 주요 색이 여기에 표시돼요.", 1]);
    assert.deepEqual([v.bars, v.barsEmpty, v.score, v.scoreNote, v.keywords], [[], "분석이 끝나면 표시돼요.", "—", "* 분석이 끝나면 표시돼요.", []]);
    assert.deepEqual([v.refineInput, v.refineRun, v.testLink, v.run, v.runDisabled], [true, true, [true], "이미지 시퀀싱 시작", true]);
    // 열기만 하면 보관함 목록과 분석·보정 엔진 설정(키 원문 없음) GET 두 건뿐
    assert.deepEqual((await rows()).map((item) => item.method + " " + item.path), ["GET /api/admin/style-dna", "GET /api/admin/style-dna/engine-credentials"]);
    row.columns = v.columns;
    row.emptyOverflow = await overflow();
    assert.ok(row.emptyOverflow <= 0, "empty overflow " + row.emptyOverflow);
    await shot(`studio-empty-${width}.png`);

    console.log("STEP 2 " + width);
    await press("다크 스튜디오");
    v = await studio();
    assert.deepEqual([v.theme, v.quick], ["dark", ["도움말", "화이트 모드"]]);
    if (width === 1574) await shot(`studio-empty-dark-${width}.png`);
    await press("화이트 모드");
    await press("도움말");
    assert.deepEqual(await page.evaluate(() => { const dialog = document.querySelector("dialog[open]"); return [dialog?.querySelector("h4").textContent, dialog?.querySelectorAll("ol li").length]; }),
      ["이미지 스타일 분석기 도움말 & 가이드", 5]);
    if (width === 390) await page.screenshot({ path: `${out}/studio-help-${width}.png` });
    await page.keyboard.press("Escape"); await settle(200);
    assert.equal(await page.evaluate(() => !!document.querySelector("dialog[open]")), false);

    console.log("STEP 3 " + width);
    // 왼쪽 2/3 빨강·오른쪽 1/3 파랑 PNG를 화면에서 만들어 고른다 → 미리보기·브라우저 실측 67/33
    await page.evaluate(`(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 60; canvas.height = 30;
      const context = canvas.getContext("2d"); context.fillStyle = "#e11d48"; context.fillRect(0, 0, 40, 30); context.fillStyle = "#2563eb"; context.fillRect(40, 0, 20, 30);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const input = (${ST}).querySelector("input[type=file]"); const data = new DataTransfer();
      data.items.add(new File([blob], "two-tone.png", { type: "image/png" })); input.files = data.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await until((ST) => eval(ST).querySelectorAll("[aria-label='미학적 팔레트'] li").length === 2, "preview palette", ST);
    v = await studio();
    assert.deepEqual([v.viewerImage, v.palette, v.paletteNote], [true, ["#E11D4867%", "#2563EB33%"], "고른 파일에서 브라우저가 직접 잰 색이에요(서버로 보내지 않아요). 분석하면 서버 실측 5색으로 바뀌어요."]);
    assert.equal(v.runDisabled, false, "파일을 고르면 분석을 시작할 수 있음");
    assert.equal((await rows()).filter((item) => item.method === "POST").length, 0);

    console.log("STEP 4 " + width);
    await page.evaluate(() => { window.__premiere.styleDna.hold = "analyze"; });
    await press("이미지 시퀀싱 시작");
    await until((ST) => !!eval(ST).querySelector("[aria-label^='스캔 뷰어'] img[data-scanning]"), "scanning", ST);
    v = await studio();
    assert.deepEqual([v.scanning, v.scanText.includes("스타일 분석 중..."), v.run, v.camera.map((item) => item[1])], [true, true, "이미지 시퀀싱 중...", EMPTY10]);
    if (width === 1574 || width === 390) await shot(`studio-scanning-${width}.png`);
    await page.evaluate(() => { window.__premiere.styleDna.hold = ""; window.__premiere.release(); });
    await until((ST) => /Dusk City Portrait/.test(eval(ST).querySelector("[aria-label='분석 리포트']")?.textContent ?? ""), "report", ST);
    v = await studio();
    assert.deepEqual(v.titles, ["EN: Dusk City Portrait", "KR: 황혼의 도심 초상"]);
    assert.deepEqual(v.camera.map((item) => item[1]), ["눈높이 정면", "미디엄 클로즈업", "85mm 상당 망원", "—", "얕은 심도"]);
    assert.deepEqual([v.lighting.map((item) => item[1]), v.gold], [["해 질 녘", "왼쪽 측면광", "낮음", "중간", "—"], "해 질 녘"]);
    assert.deepEqual(v.blueprint, ["구도:인물을 오른쪽 삼분할 선에 둔 세로 구도근거: 얼굴이 오른쪽 1/3 지점", "배경:흐릿한 도심 간판 불빛근거: 둥근 빛 번짐"]);
    assert.equal(v.style.length, 2);
    assert.deepEqual(v.tips, ["원본을 함께 첨부하면 색 대비가 더 정확히 재현돼요.", "피사체만 바꿔 같은 빛을 유지하세요."]);
    assert.deepEqual(v.prompts.map((item) => item[0]), ["마스터 프롬프트 (EN) v1", "마스터 프롬프트 (KO) v1"]);
    assert.match(v.prompts[0][1], /^A portrait of \[INSERT SUBJECT HERE\]/);
    assert.deepEqual([v.palette, v.paletteNote], [["#1F6F6A40%", "#E8D5B025%", "#2A2A3515%", "#C96A3B12%", "#F4F1EA8%"], "서버가 원본 이미지에서 실제로 잰 5색이에요."]);
    assert.deepEqual([v.bars, v.score, v.keywords], [["색 대비 /82%", "빛 방향 /74%", "질감 /0%"], "87.5%", ["cinematic", "teal-orange", "golden hour", "bokeh"]]);
    assert.deepEqual([v.viewerImage, v.scanning, !!v.ratio, v.quick[0], v.testLink], [true, false, true, "3단계 결과 테스트", [false, false]]);
    assert.match(await notice(), /분석을 마치고 보관함에 저장했어요\. '파일 two-tone\.png'/);
    row.resultOverflow = await overflow();
    assert.ok(row.resultOverflow <= 0, "result overflow " + row.resultOverflow);
    await shot(`studio-result-${width}.png`);

    // 가독성(Design 004e99e 후속): 팔레트 비율 글자와 남색 카드 대비 4.5:1 이상.
    const percent = await page.evaluate((ST) => {
      const node = eval(ST).querySelector("[aria-label='미학적 팔레트'] li strong");
      const rgb = (value) => value.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      let back = null; for (let item = node; item && !back; item = item.parentElement) { const c = rgb(getComputedStyle(item).backgroundColor); if (c.length === 3 || c[3] === 1) back = c; }
      const a = lum(rgb(getComputedStyle(node).color)), b = lum(back);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, ST);
    assert.ok(percent >= 4.5, `팔레트 비율 대비 ${percent}`);
    console.log("STEP 5 " + width);
    await mark(`(${ST}).querySelector("[aria-label='마스터 프롬프트 (EN) v1'] button")`, "Enter");
    assert.match(await page.evaluate(() => window.__clip.at(-1)), /^A portrait of/);
    const refine = async (feedback, revision) => {
      await typeInto(`(${ST}).querySelector("form[aria-label='추론 인터페이스'] input[type=text]")`, feedback);
      assert.equal((await studio()).refineRun, false, "피드백만 넣으면 보정 단추가 바로 열림");
      await noConsent("추론 인터페이스");
      await press("미세 보정 요청");
      await until(([ST, revision]) => !!eval(ST).querySelector(`section[aria-label='마스터 프롬프트 (EN) v${revision}']`), "refined " + revision, [ST, revision]);
    };
    await refine("배경을 단순하게", 2);
    v = await studio();
    assert.deepEqual([v.blueprint, v.style[0].startsWith("색감:청록 그림자"), v.blueprintNote], [["구도:보정 2: 배경을 단순하게 비운 세로 구도근거: 피드백 반영"], true, "보정 버전의 값이에요."]);
    await refine("더 따뜻하게", 3);
    v = await studio();
    assert.deepEqual([v.blueprint, v.style], [["구도:보정 2: 배경을 단순하게 비운 세로 구도근거: 피드백 반영"], ["색감:보정 3: 더 따뜻한 주황 하이라이트근거: 피드백 반영"]]);
    assert.deepEqual((await rows()).filter((item) => item.path.endsWith("/refine")).map((item) => [item.body.revision, item.body.feedback]), [[1, "배경을 단순하게"], [2, "더 따뜻하게"]]);
    assert.deepEqual([v.camera[0][1], v.score], ["눈높이 정면", "87.5%"]);

    console.log("STEP 6 " + width);
    await open(`styleDnaReport=1&styleDnaSeed=1&w=${width}`);
    await page.evaluate(() => sessionStorage.clear());
    await open(`styleDnaReport=1&styleDnaSeed=1&w=${width}`);
    // ④ 보관함: '보관함' 단추(단계 묶음 앞) → 카드 '열기'
    const LIBTAB = `document.querySelector("${R} [aria-label='Style DNA 단계']").previousElementSibling`;
    if ((await page.evaluate(`(${LIBTAB}).getAttribute("aria-pressed")`)) !== "true") await mark(LIBTAB, "Enter");
    await mark(`[...[...document.querySelectorAll("${R} section[aria-label='보관함'] li")].find((li) => li.querySelector("button > span:nth-of-type(2)")?.textContent === "보관된 도심 인물 사진").querySelectorAll("button")][1]`, "Enter");
    await until((ST) => /KR: 보관된 도심 인물 사진/.test(eval(ST).querySelector("[aria-label='분석 리포트']")?.textContent ?? ""), "old record", ST);
    v = await studio();
    assert.deepEqual([v.camera.map((item) => item[1]), v.cameraNote], [["—", "—", "—", "—", "—"], "이 기록의 분석 결과에는 카메라 & 렌즈 항목이 없어요."]);
    assert.deepEqual([v.titles[0], v.blueprintNote, v.tipsEmpty], ["EN: 보관된 도심 인물 사진", "의미 분석 결과(구도·인물·사물·동작·조명·맥락)로 채웠어요.", "분석 결과에 없어요."]);
    assert.deepEqual([v.bars, v.barsEmpty, v.score, v.keywords, v.palette.length], [[], "이 기록의 분석 결과에 없어요.", "—", [], 5]);
    row.oldOverflow = await overflow();
    assert.ok(row.oldOverflow <= 0, "old overflow " + row.oldOverflow);
    if (width === 1574 || width === 390) await shot(`studio-old-record-${width}.png`);

    console.log("STEP 7 " + width);
    // 7. 실패: 모델 오류(502 model_error) → 안내, 스캔 해제, 빈 칸 유지, 기록 추가 0. 키 미등록 → 엔진 경고, 실행 잠김.
    await page.evaluate(() => sessionStorage.clear());
    await open(`styleDnaReport=1&w=${width}`);
    await page.evaluate(() => window.__premiere.styleDna.faults.analyze.push({ status: 502, body: { code: "model_error" } }));
    await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
    await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/fail.png");
    await press("이미지 시퀀싱 시작");
    await until((R) => /Gemini가 결과를 만들지 못했어요/.test(document.querySelector(R).textContent), "model error", R);
    v = await studio();
    assert.deepEqual([v.scanning, v.run, v.report, v.camera.map((item) => item[1])], [false, "이미지 시퀀싱 시작", "분석된 프롬프트 리포트 대기 중", EMPTY10]);
    assert.equal(await page.evaluate(() => window.__premiere.styleDna.records.length), 0);
    await open(`styleDnaModel=none&styleDnaReport=1&w=${width}`);
    await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
    await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/no-key.png");
    v = await studio();
    assert.deepEqual(await page.evaluate((ST) => { const st = eval(ST);
      return [st.querySelector("[id$='-operation-status']")?.textContent ?? null, st.querySelector("[aria-label='시스템 가이던스'] p[id$='-engine']").textContent,
        st.querySelectorAll("[aria-label='시스템 가이던스'] select[aria-describedby$='engine']").length]; }, ST),
      // CMD-043: 모델 고르는 칸이 없어졌다. 미등록이면 안내 문구에 모델 이름이 붙지 않는다.
      ["이미지 분석 모델이 등록되지 않았어요. API키등록·플랫폼연동에서 등록해 주세요.", "API키등록·플랫폼연동에 등록한 Gemini 키로 호출되며 요금은 그 계정에 청구돼요. 시험 이미지 생성은 언제나 Gemini로 해요.", 0]);
    assert.equal(v.runDisabled, true);
    if (width === 390 || width === 1574) await shot(`studio-no-key-${width}.png`);
    row.external = (await page.evaluate(() => window.__premiere.requests().filter((item) => !item.path.startsWith("/")).length));
    results.push(row);
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("STYLE-DNA-STUDIO-RESULT" + JSON.stringify(results));
