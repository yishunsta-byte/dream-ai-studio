/* global taskSpace, window, document, console, innerWidth, setTimeout, Event, HTMLInputElement, HTMLSelectElement */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// P1-08 쇼츠 검색 V/S 등급·VPH(원본 Shorts Viral Studio v2.01 정의). admin-hub-fixture-run.mjs가 연 루프백 주소에서 320·390·1440으로 실행한다.
// 운영 ShortsWorkspace처럼 단건 분석 안의 '공개 쇼츠 검색'을 연 뒤 확인한다.
// 확인: 등급 경계(10·5·3·1배, 4.99배는 '4.9배 떡상'), 구독자 비공개·0·조회수 비공개는 판정불가,
// VPH(최소 1시간·검색 시각 기준, 조회수 비공개·검색 시각보다 늦은 게시 시각은 계산 불가),
// 결과 보기 순서(V/S·VPH·검색 순서)는 받은 결과만 다시 늘어놓아 검색 요청 0, 다시 늘어놓아도 고른 영상 주소가 맞음, 다음 검색에도 순서 유지, 넘침 0.
const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const proof = globalThis.FIXTURE_OUTPUT_DIR ?? join(tmpdir(), "dream-shorts-vs-qa");
await mkdir(proof, { recursive: true });
const task = await taskSpace("Shorts VS " + Date.now());
const page = task.page("p1");
const R = "#admin-shorts-analysis";
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const rows = () => page.evaluate(() => window.__premiere.requests());
const searches = async () => (await rows()).filter((row) => row.path === "/api/admin/shorts-search");
const analyses = async () => (await rows()).filter((row) => row.path === "/api/admin/shorts-analysis" && row.method === "POST");
const read = () => page.evaluate((R) => {
  const panel = [...document.querySelectorAll(`${R} h3`)].find((heading) => heading.textContent === "공개 쇼츠 검색")?.closest("section");
  return { text: panel.innerText.replace(/\s+/g, " "), items: [...panel.querySelectorAll("ol > li")].map((li) => ({
    title: li.querySelector("h5").textContent, grade: li.querySelector("[data-grade]")?.getAttribute("data-grade") ?? null,
    gradeText: li.querySelector("[data-grade]")?.textContent ?? null,
    metrics: Object.fromEntries([...li.querySelectorAll("dl > div")].map((div) => [div.querySelector("dt").textContent, div.querySelector("dd").textContent])) })) };
}, R);
const fill = (label, value) => page.evaluate(([R, label, value]) => {
  const input = document.getElementById([...document.querySelectorAll(`${R} label`)].find((item) => item.textContent.trim().startsWith(label)).htmlFor);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
}, [R, label, value]);
const arrange = (value) => page.evaluate(([R, value]) => {
  const select = document.getElementById([...document.querySelectorAll(`${R} label`)].find((item) => item.textContent.trim().startsWith("결과 보기 순서")).htmlFor);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, [R, value]);
const press = async (text) => {
  await page.evaluate(([R, text]) => [...document.querySelectorAll(`${R} button`)].find((button) => button.textContent.trim() === text || button.getAttribute("aria-label") === text).setAttribute("data-press", ""), [R, text]);
  await page.focus("[data-press]"); await page.keyboard.press("Enter");
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// 0 10배 초대박 · 1 4.9999배 떡상 · 2 5배 대박(게시 6분 → 최소 1시간) · 3 3배 떡상 · 4 1배 양호 · 5 0.999배 보통 · 6 구독자 비공개 · 7 조회수 비공개 · 8 구독자 0
// 9 게시 시각이 검색 시각보다 2시간 늦음(잘못된 시간) → V/S는 8배 대박, VPH는 계산 불가
const shape = [
  { views: 1_000_000, subscribers: 100_000, ageHours: 48 },
  { views: 49_999, subscribers: 10_000, ageHours: 24 },
  { views: 50_000, subscribers: 10_000, ageHours: 0.1 },
  { views: 3_000, subscribers: 1_000, ageHours: 200 },
  { views: 1_000, subscribers: 1_000, ageHours: 72 },
  { views: 999, subscribers: 1_000, ageHours: 24 },
  { views: 5_000, subscribers: null, ageHours: 24 },
  { views: null, subscribers: 500, ageHours: 24 },
  { views: 100, subscribers: 0, ageHours: 24 },
  { views: 800, subscribers: 100, ageHours: -2 },
];
const expected = [
  ["초대박", "10.0배", "20,833회"], ["떡상", "4.9배", "2,083회"], ["대박", "5.0배", "50,000회"],
  ["떡상", "3.0배", "15회"], ["양호", "1.0배", "14회"], ["보통", "0.9배", "42회"],
  ["판정불가", "판정불가", "208회"], ["판정불가", "판정불가", "계산 불가"], ["판정불가", "판정불가", "4.1회"],
  ["대박", "8.0배", "계산 불가"],
];
const order = (view) => view.items.map((item) => Number(item.title.match(/후보 (\d+)$/)[1]) - 1);
const results = [];

try {
  await page.cdp("Network.enable", {});
  await page.cdp("Network.setBlockedURLs", { urls: ["*ytimg.com*", "*img.youtube.com*"] });
  for (const width of [320, 390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const row = { width, overflow: [] };
    await page.goto("about:blank");
    await page.goto(`${base}/admin?youtubeKey=2&w=${width}${R}`);
    await until((R) => [...document.querySelectorAll(`${R} summary`)].some((summary) => summary.textContent === "공개 쇼츠 검색"), "search summary", R);
    await page.evaluate((R) => [...document.querySelectorAll(`${R} summary`)].find((summary) => summary.textContent === "공개 쇼츠 검색").click(), R);
    await until((R) => /저장됨\(버전 2\) · 공개 쇼츠 검색에서 현재 연결을 확인할 수 있어요/.test(document.querySelector(R).innerText), "key state", R);
    await page.evaluate((shape) => { window.__premiere.searchCount = shape.length; window.__premiere.searchShape = shape; }, shape);

    // 1. 검색 한 번: 칸마다 등급·배율·VPH, 기준 설명과 검색 시각
    await fill("검색어", "캠핑 요리");
    await press("검색");
    await until((R) => /공개 쇼츠 후보 10개를 찾았어요/.test(document.querySelector(R).innerText), "found", R);
    let view = await read();
    assert.deepEqual(view.items.map((item) => [item.grade, item.metrics["조회÷구독"], item.metrics["VPH"]]), expected);
    assert.deepEqual(view.items.map((item) => item.gradeText), expected.map(([grade]) => `등급 ${grade}`));
    assert.equal(view.items[7].metrics["조회수"], "비공개");
    assert.equal(view.items[8].metrics["구독자"], "0");
    assert.match(view.text, /등급 기준\(조회수 ÷ 구독자\): 초대박 10배 이상 · 대박 5배 이상 · 떡상 3배 이상 · 양호 1배 이상 · 그 밖 보통\. 구독자나 조회수가 비공개면 판정불가예요\./);
    assert.match(view.text, /VPH는 검색 시각\(\d{4}\. \d{1,2}\. \d{1,2}\. (오전|오후) \d{1,2}:\d{2}\) 기준으로 조회수를 게시 후 지난 시간\(최소 1시간\)으로 나눈 시간당 조회수예요\. 조회수가 비공개이거나 게시 시각이 검색 시각보다 늦으면 계산 불가예요\./);
    assert.equal(order(view).join(), "0,1,2,3,4,5,6,7,8,9");
    row.overflow.push(await overflow());
    await page.evaluate((R) => [...document.querySelectorAll(`${R} h3`)].find((heading) => heading.textContent === "공개 쇼츠 검색")?.closest("section").querySelector("ol").scrollIntoView({ block: "start" }), R);
    await page.screenshot({ path: `${proof}/shorts-vs-search-${width}.png` });

    // 2. 보기 순서: V/S 높은 순·VPH 높은 순·검색 순서 — 다시 검색하지 않음, 계산 불가는 뒤로(원래 순서 유지)
    const sent = (await searches()).length;
    await arrange("ratio");
    await until((R) => /V\/S\) 높은 순으로 받은 결과만 다시 늘어놓았어요\. 다시 검색하지 않아요\./.test([...document.querySelectorAll(`${R} h3`)].find((heading) => heading.textContent === "공개 쇼츠 검색")?.closest("section").textContent), "ratio status", R);
    assert.equal(order(await read()).join(), "0,9,2,1,3,4,5,6,7,8");
    await arrange("vph");
    await settle();
    assert.equal(order(await read()).join(), "2,0,1,6,5,3,4,8,7,9");
    row.overflow.push(await overflow());
    await page.screenshot({ path: `${proof}/shorts-vs-vph-${width}.png` });
    // 다시 늘어놓은 뒤 고르기: 맞는 영상 주소가 단건 분석 칸에 들어간다(분석 요청 0).
    await press("캠핑 요리 후보 3 영상을 쇼츠 분석 주소 칸에 넣기");
    const url = await page.evaluate((R) => [...document.querySelectorAll(`${R} label`)].find((item) => item.textContent.trim().startsWith("공개 YouTube 영상 주소")).querySelector("input").value, R);
    assert.equal(url, "https://www.youtube.com/watch?v=Fx02abcdefg");
    view = await read();
    assert.equal(view.items[0].title, "캠핑 요리 후보 3");
    await arrange("search");
    await settle();
    assert.equal(order(await read()).join(), "0,1,2,3,4,5,6,7,8,9");
    assert.deepEqual([(await searches()).length, (await analyses()).length], [sent, 0]);

    // 3. 순서는 다음 검색에도 유지된다(새 결과를 같은 순서로 보여 줌).
    await arrange("ratio");
    await fill("검색어", "캠핑 간식");
    await press("검색");
    await until((R) => /‘캠핑 간식’ 검색 결과 10개/.test(document.querySelector(R).innerText), "second", R);
    view = await read();
    assert.equal(order(view).join(), "0,9,2,1,3,4,5,6,7,8");
    assert.equal((await searches()).length, sent + 1);
    row.overflow.push(await overflow());
    assert.ok(row.overflow.every((value) => value <= 0), JSON.stringify(row.overflow));
    await page.evaluate(() => { window.__premiere.searchShape = []; window.__premiere.searchCount = 3; });
    row.searches = (await searches()).length;
    results.push(row);
  }
} finally {
  await page.cdp("Network.setBlockedURLs", { urls: [] }).catch(() => {});
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("SHORTS-VS-RESULT" + JSON.stringify(results));
