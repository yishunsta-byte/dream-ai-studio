/* global taskSpace, document, DataTransfer, File, Event, console */
// 관리자 화면 기본값 확인: 분석 부품에 설정 주소를 넘기지 않으면 미설정 안내 링크는 지금처럼 관리자 API연동을 연다.
// admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
import assert from "node:assert/strict";

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Analysis settings links " + Date.now());
const page = task.page("p1");
const rows = [];
for (const [id, label] of [["admin-music-analysis", "음악"], ["admin-shorts-analysis", "쇼츠"]]) {
  await page.goto(`${base}/admin?analysisStatus=music:not_configured,shorts:not_configured#${id}`);
  // 음악은 파일을 고른 뒤에 설정 상태를 확인한다.
  if (id === "admin-music-analysis") await page.evaluate((id) => {
    const input = document.querySelector(`#${id} input[type=file]`);
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(160)], "settings-check.wav", { type: "audio/wav" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, id);
  await page.waitForFunction((id) => [...document.querySelectorAll(`#${id} a`)].some(link => link.textContent === "API연동 보기"), id, { timeout: 8000 })
    .catch(error => { throw new Error(`${label}: ${error.message}`); });
  const links = await page.evaluate((id) => [...document.querySelectorAll(`#${id} a`)].filter(link => link.textContent === "API연동 보기").map(link => link.getAttribute("href")), id);
  assert.ok(links.length >= 1, label);
  assert.ok(links.every(href => href === "#admin-api-integrations"), `${label} ${links}`);
  rows.push({ id, links });
}
console.log("SETTINGS-LINK-RESULT" + JSON.stringify(rows));
