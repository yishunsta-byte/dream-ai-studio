/* global taskSpace, window, document, innerWidth, HTMLAnchorElement, URL, console */
// Shorts Viral Studio 첫 화면 묶음 확인: 단계 표시, 분석한 영상 카드·근거 표시, 리포트 카드, Markdown 내려받기, 공개 준비 유지.
// admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const proof = globalThis.FIXTURE_OUTPUT_DIR ?? join(tmpdir(), "dream-shorts-qa");
await mkdir(proof, { recursive: true });
const task = await taskSpace("Shorts report " + Date.now());
const page = task.page("p1");
const root = "#admin-shorts-analysis";
const until = (fn, label, arg) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(error => { throw new Error(`${label}: ${error.message}`); });
const choose = async (selector) => { await page.focus(selector); await page.keyboard.press("Space"); };
const state = () => page.evaluate((root) => {
  const panel = document.querySelector(root);
  const region = label => panel.querySelector(`[aria-label='${label}']`)?.innerText.replace(/\s+/g, " ") ?? null;
  const link = panel.querySelector("a[target=_blank]");
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    steps: [...panel.querySelectorAll("[aria-label='쇼츠 분석 단계'] > li")].map(li => `${li.dataset.state}${li.getAttribute("aria-current") ? "*" : ""}`),
    target: region("분석한 영상"), summary: region("요약"), hook: region("첫 장면"), sound: region("소리"), timeline: region("시간대별 근거"), draft: region("새 영상 연출 초안"),
    link: link && { href: link.href, rel: link.rel },
    buttons: [...panel.querySelectorAll("button")].map(button => button.textContent).filter(text => /Markdown|공개 준비/.test(text)),
  };
}, root);

const rows = [];
for (const width of [320, 390, 1440]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await page.goto(`${base}/admin?shorts=${width}${root}`);
  await until((root) => document.querySelector(`${root} [aria-label='쇼츠 분석 단계']`) && document.querySelector(`${root} input[type=checkbox]:not(:disabled)`), "form", root);
  const empty = await state();
  assert.deepEqual(empty.steps, ["current*", "next", "locked", "locked", "locked", "locked"]);
  assert.equal(empty.target, null);

  await page.fill('loc=role:textbox[name="공개 YouTube 영상 주소"]', "https://www.youtube.com/shorts/A1b2C3d4E5F");
  await choose(`loc=css:${root} input[type=checkbox]`);
  await page.click('loc=role:button[name="쇼츠 분석"]');
  await until((root) => document.querySelector(`${root} [aria-label='분석한 영상']`), "report", root);
  const done = await state();
  assert.deepEqual(done.steps, ["done", "current*", "locked", "locked", "locked", "locked"]);
  assert.match(done.target, /A1b2C3d4E5F/);
  assert.match(done.target, /영상 직접 분석 Gemini가 공개 영상을 보고 낸 추정이에요/);
  assert.deepEqual(done.link, { href: "https://www.youtube.com/shorts/A1b2C3d4E5F", rel: "noopener noreferrer" });
  assert.equal(done.summary, "요약 프리미어 검수 영상");
  assert.equal(done.hook, "첫 장면 영상에서 확인하지 못했어요."); // 응답이 null이면 지어내지 않는다.
  assert.equal(done.timeline, "시간대별 근거 00:01 샘플 첫 장면");
  assert.equal(done.draft, "새 영상 연출 초안 Premiere fixture Shorts");
  assert.deepEqual(done.buttons, ["Markdown 복사", "Markdown 내려받기", "공개 준비"]);
  assert.ok(done.overflow <= 0, `overflow ${width}`);
  await page.evaluate((root) => document.querySelector(`${root} [aria-label='쇼츠 분석 단계']`).scrollIntoView(), root);
  await page.screenshot({ path: `${proof}/shorts-${width}.png` });

  // Markdown 내려받기: 실제 파일 클릭 대신 이름과 내용을 받아 확인한다.
  await page.evaluate(() => {
    window.__download = null;
    const create = URL.createObjectURL;
    URL.createObjectURL = (blob) => { window.__blob = blob; return create(blob); };
    HTMLAnchorElement.prototype.click = function () { window.__download = { name: this.download, href: this.href }; };
  });
  await page.click('loc=role:button[name="Markdown 내려받기"]');
  const file = await page.evaluate(async () => ({ name: window.__download.name, text: await window.__blob.text() }));
  assert.equal(file.name, "shorts-analysis-A1b2C3d4E5F.md");
  assert.match(file.text, /^# 쇼츠 분석 리포트\n\n- 영상: https:\/\/www\.youtube\.com\/shorts\/A1b2C3d4E5F\n- 근거: 영상 직접 분석 \(Gemini 추정\)/);
  assert.match(file.text, /## 첫 장면\n미확인\n/);
  assert.match(file.text, /## 시간대별 근거\n- 00:01 · 샘플 첫 장면\n/);
  await until((root) => [...document.querySelectorAll(`${root} [role=status]`)].some(node => node.textContent.includes("shorts-analysis-A1b2C3d4E5F.md")), "download status", root);

  // 주소를 바꾸면 이전 결과·단계가 남지 않는다.
  await page.fill('loc=role:textbox[name="공개 YouTube 영상 주소"]', "https://youtu.be/Z9y8X7w6V5u");
  const changed = await state();
  assert.equal(changed.target, null);
  assert.deepEqual(changed.steps.slice(0, 2), ["current*", "next"]);
  rows.push({ width, overflow: Math.max(0, done.overflow) });
}
console.log("SHORTS-RESULT" + JSON.stringify(rows));
