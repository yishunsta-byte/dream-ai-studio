/* global taskSpace, window, document, innerWidth, DataTransfer, File, Event, console */
// Style DNA 리포트(이미지 분석) 화면 확인. admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const proof = globalThis.FIXTURE_OUTPUT_DIR ?? join(tmpdir(), "dream-style-dna-qa");
await mkdir(proof, { recursive: true });
const task = await taskSpace("Style DNA report " + Date.now());
const page = task.page("p1");
const root = "#admin-style-dna";
const until = (fn, label, arg) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(error => { throw new Error(`${label}: ${error.message}`); });
const styleDna = {
  schemaVersion: 1,
  titles: { ko: "노을빛 도심 초상", en: "Dusk city portrait" },
  style: [{ label: "시네마틱", description: "낮은 채도와 따뜻한 역광", basis: "하늘과 인물 윤곽의 색" }],
  tips: ["인물 대신 제품을 같은 자리에 두세요."],
  keywords: ["dusk", "portrait"],
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: "16:9",
  camera: { angle: { certainty: "estimated", description: "눈높이", basis: "수평선 위치" }, lens: { certainty: "unconfirmed" } },
  lighting: { direction: { certainty: "estimated", description: "역광", basis: "인물 윤곽 빛" } },
};
const state = () => page.evaluate((root) => {
  const panel = document.querySelector(root);
  const section = label => panel.querySelector(`[aria-label='${label}']`)?.innerText.replace(/\s+/g, " ") ?? null;
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    measured: section("픽셀 측정"), camera: section("카메라"), lighting: section("조명 설계"), style: section("스타일 분석"),
    tips: section("활용 팁"), keywords: section("키워드"), titles: panel.querySelector("[aria-label='분석 제목']")?.innerText.replace(/\s+/g, " ") ?? null,
    cards: [...panel.querySelectorAll("[aria-label='이미지 의미와 스타일'] > li h5")].map(h => h.textContent),
    prompts: [...panel.querySelectorAll("textarea")].map(t => t.value),
  };
}, root);
// 실행마다 리포트를 새로 그리므로, 이전 카드 목록에 표시를 달고 표시 없는 새 목록이 나올 때까지 기다린다.
const run = async () => {
  await page.evaluate((root) => document.querySelector(`${root} [aria-label='이미지 의미와 스타일']`)?.setAttribute("data-stale", ""), root);
  await page.click('loc=role:button[name="이미지 분석 실행"]');
  await until((root) => {
    const list = document.querySelector(`${root} [aria-label='이미지 의미와 스타일']`);
    return !!list && !list.hasAttribute("data-stale");
  }, "analysis", root);
};
// 지정 크기의 PNG를 만들어 파일 입력에 넣는다(브라우저 미리보기 크기 측정 확인용).
const pickFile = (width, height) => page.evaluate(async ({ root, width, height }) => {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").fillRect(0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  const input = document.querySelector(`${root} input[type=file]`);
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], `fixture-${width}x${height}.png`, { type: "image/png" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, { root, width, height });

// 고정 메뉴가 겹쳐도 되도록 키보드로 고른다.
const choose = async (selector) => { await page.focus(selector); await page.keyboard.press("Space"); };
const rows = [];
for (const width of [320, 390, 1440]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await page.goto(`${base}/admin?style=${width}${root}`);
  await until((root) => document.querySelector(`${root} input[type=url]`), "form", root);
  await page.evaluate(() => { window.__premiere.imageExtra = undefined; });
  await page.fill(`loc=css:${root} input[type=url]`, "https://mdn.github.io/fixture.png");
  await choose(`loc=css:${root} input[type=checkbox]`);

  // 1) 지금 서버 응답 그대로: 픽셀 측정·관찰 카드·프롬프트, styleDna 칸 없음.
  await run();
  const plain = await state();
  assert.match(plain.measured, /#3366CC 60%/);
  assert.match(plain.measured, /어두운 영역 25%/);
  assert.doesNotMatch(plain.measured, /원본 크기/); // URL 미리보기를 열지 않았으면 크기를 모른다.
  assert.deepEqual(plain.cards.slice(0, 2), ["구조적 청사진 · 구도 Gemini 추정", "조명 Gemini 추정"]);
  assert.deepEqual([plain.camera, plain.lighting, plain.style, plain.tips, plain.titles], [null, null, null, null, null]);
  assert.deepEqual(plain.prompts, ["Premiere image suggestion", "프리미어 이미지 제안"]);

  // 2) 편집은 이 결과에만: 같은 원본·같은 제안으로 다시 분석하면 편집이 사라진다.
  await page.fill(`loc=css:${root} textarea[lang=en]`, "edited prompt");
  await until((root) => [...document.querySelectorAll(`${root} button`)].some(b => b.textContent === "원래대로"), "edited", root);
  await run();
  assert.deepEqual((await state()).prompts, ["Premiere image suggestion", "프리미어 이미지 제안"]);

  // 3) styleDna가 오면 표시한다. 서버가 잰 크기와 지원 비율 선택을 구분한다.
  await page.evaluate((extra) => { window.__premiere.imageExtra = { styleDna: extra }; }, styleDna);
  await run();
  const rich = await state();
  assert.equal(rich.titles, "EN Dusk city portrait KO 노을빛 도심 초상");
  assert.match(rich.measured, /원본 크기 1920×1080px 서버가 원본을 열어 잰 값/);
  assert.match(rich.measured, /원본 비율 16:9 서버가 원본에서 잰 비율 생성 추천 비율 16:9 원본 크기에 가장 가까운 생성 지원 비율\(12개 중 화면에서 계산\)/);
  assert.doesNotMatch(rich.measured, /서버 계산/);
  assert.match(rich.camera, /앵글 눈높이 시각 단서 · 수평선 위치/);
  assert.match(rich.camera, /렌즈 이미지에서 확인할 수 없었어요/);
  assert.doesNotMatch(rich.camera, /샷 크기/); // 서버가 주지 않은 칸은 만들지 않는다.
  assert.match(rich.lighting, /빛 방향 역광/);
  assert.match(rich.style, /시네마틱 낮은 채도와 따뜻한 역광/);
  assert.match(rich.tips, /제품을 같은 자리에/);
  assert.equal(rich.keywords, "dusk portrait");
  assert.ok(rich.overflow <= 0, `overflow ${width}`);
  await page.evaluate((root) => document.querySelector(`${root} [aria-label='분석 제목']`)?.scrollIntoView(), root);
  await page.screenshot({ path: `${proof}/style-dna-${width}.png` });

  // 3-1) 원본 비율은 메타데이터일 뿐: 목록 밖 원본 비율(2:1·7:3)이어도 생성 추천은 크기로 계산(16:9).
  //      칸이 빠지면 그 줄만 숨긴다(크기 없음 → 추천 없음, 원본 비율 없음 → 그 줄 없음).
  const ratioCases = [
    [{ dimensions: { width: 1024, height: 512 }, aspectRatio: "2:1" }, /원본 크기 1024×512px .*원본 비율 2:1 .*생성 추천 비율 16:9/, /생성 추천 비율 2:1/],
    [{ dimensions: { width: 1280, height: 720 }, aspectRatio: "7:3" }, /원본 크기 1280×720px .*원본 비율 7:3 .*생성 추천 비율 16:9/, /생성 추천 비율 7:3/],
    [{ dimensions: undefined, aspectRatio: "2:1" }, /원본 비율 2:1/, /원본 크기|생성 추천 비율/],
    [{ aspectRatio: undefined }, /원본 크기 1920×1080px .*생성 추천 비율 16:9/, /원본 비율/],
  ];
  for (const [patch, shown, hidden] of ratioCases) {
    await page.evaluate((extra) => { window.__premiere.imageExtra = { styleDna: extra }; }, { ...styleDna, ...patch });
    await run();
    const ratio = await state();
    assert.match(ratio.measured, shown);
    assert.doesNotMatch(ratio.measured, hidden);
    assert.match(ratio.camera, /앵글 눈높이/); // 다른 선택 칸은 그대로
  }

  // 4) 형식이 맞지 않는 styleDna는 통째로 무시하고 지금 리포트만 보여 준다.
  await page.evaluate((extra) => { window.__premiere.imageExtra = { styleDna: { ...extra, schemaVersion: 2 } }; }, styleDna);
  await run();
  const invalid = await state();
  assert.deepEqual([invalid.titles, invalid.camera, invalid.style], [null, null, null]);
  assert.match(invalid.measured, /#3366CC 60%/);
  assert.equal(invalid.cards.length, 6);

  // 5) 원본을 바꾸면 이전 결과·크기가 남지 않는다. 파일은 브라우저 미리보기 크기를 쓴다.
  await page.evaluate(() => { window.__premiere.imageExtra = undefined; });
  await choose(`loc=css:${root} input[type=radio][value=file]`);
  assert.equal((await state()).measured, null);
  await pickFile(400, 300);
  await until((root) => document.querySelector(`${root} img[alt='선택한 원본 이미지']`)?.naturalWidth === 400, "file 1", root);
  await choose(`loc=css:${root} input[type=checkbox]`);
  await run();
  assert.match((await state()).measured, /원본 크기 400×300px 브라우저 미리보기에서 잰 값 생성 추천 비율 4:3/);
  await pickFile(300, 600);
  assert.equal((await state()).measured, null);
  await until((root) => document.querySelector(`${root} img[alt='선택한 원본 이미지']`)?.naturalWidth === 300, "file 2", root);
  await choose(`loc=css:${root} input[type=checkbox]`);
  await run();
  const swapped = await state();
  assert.match(swapped.measured, /원본 크기 300×600px .*생성 추천 비율 9:16/);
  assert.doesNotMatch(swapped.measured, /400×300/);
  rows.push({ width, overflow: Math.max(0, rich.overflow) });
}
console.log("STYLE-DNA-RESULT" + JSON.stringify(rows));
