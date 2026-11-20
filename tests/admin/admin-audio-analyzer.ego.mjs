/* global taskSpace, document, innerWidth, DataTransfer, File, Event, DragEvent, Blob, console */
// Audio Analyzer 첫 화면 묶음 확인: 끌어다 놓기·교체·해제, 브라우저 파형·재생, 기존 음악 결과와 Suno 프롬프트.
// admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const proof = globalThis.FIXTURE_OUTPUT_DIR ?? join(tmpdir(), "dream-audio-qa");
await mkdir(proof, { recursive: true });
const task = await taskSpace("Audio analyzer " + Date.now());
const page = task.page("p1");
const root = "#admin-music-analysis";
const until = (fn, label, arg) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(error => { throw new Error(`${label}: ${error.message}`); });
const choose = async (selector) => { await page.focus(selector); await page.keyboard.press("Space"); };

// 합성 사인파 WAV(16bit mono 8kHz)를 만들어 끌어다 놓기로 넣는다. kind: "drop" | "input".
const put = (name, seconds, kind = "drop", type = "audio/wav") => page.evaluate(({ root, name, seconds, kind, type }) => {
  let blob;
  if (type === "audio/wav") {
    const rate = 8000, count = Math.round(rate * seconds), view = new DataView(new ArrayBuffer(44 + count * 2));
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, count * 2, true);
    for (let index = 0; index < count; index += 1) {
      const envelope = index / count; // 점점 커지는 소리: 파형 오른쪽이 더 높아야 한다.
      view.setInt16(44 + index * 2, Math.round(Math.sin(index / 8) * 30000 * envelope), true);
    }
    blob = new Blob([view.buffer], { type });
  } else blob = new Blob(["not audio"], { type });
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], name, { type }));
  const panel = document.querySelector(root);
  if (kind === "input") {
    const input = panel.querySelector("input[type=file]");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const zone = panel.querySelector("input[type=file]").closest("label").parentElement;
  zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
}, { root, name, seconds, kind, type });

const state = () => page.evaluate((root) => {
  const panel = document.querySelector(root);
  const wave = panel.querySelector("section:has(> audio)");
  const bars = wave ? [...wave.querySelectorAll("[aria-hidden=true] > span")].map(bar => parseFloat(bar.style.blockSize)).filter(Number.isFinite) : [];
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    waveName: wave?.querySelector("h4")?.textContent ?? null,
    time: wave?.querySelector("span[aria-label^='재생 위치']")?.textContent ?? null,
    bars: bars.length, rising: bars.length ? bars.slice(-10).reduce((a, b) => a + b, 0) > bars.slice(0, 10).reduce((a, b) => a + b, 0) : null,
    note: wave?.querySelector("p")?.textContent ?? null,
    picked: [...panel.querySelectorAll("p")].find(node => node.textContent.startsWith("선택한 파일 ·"))?.textContent ?? null,
    inputValue: panel.querySelector("input[type=file]").value,
    issue: [...panel.querySelectorAll("[role=status]")].map(node => node.textContent).join(" | "),
    preview: panel.querySelector("[aria-label='오디오 프리뷰']")?.innerText.replace(/\s+/g, " ") ?? null,
    report: [...panel.querySelectorAll("h4")].find(node => node.textContent === "음악 의미 분석 결과")?.parentElement.innerText.replace(/\s+/g, " ") ?? null,
    prompt: panel.querySelector("textarea[aria-label='Suno용 프롬프트 제안']")?.value ?? null,
    muted: panel.querySelector("audio")?.muted ?? null,
    current: panel.querySelector("audio")?.currentTime ?? null,
  };
}, root);
const waveReady = (name, seconds) => until(({ root, name, seconds }) => {
  const wave = document.querySelector(`${root} section:has(> audio)`);
  return wave?.querySelector("h4")?.textContent === name && wave.querySelectorAll("[aria-hidden=true] > span[style]").length === 120
    && wave.querySelector("span[aria-label^='재생 위치']")?.textContent.endsWith(`/ 0:0${seconds}`);
}, `wave ${name}`, { root, name, seconds });
const analyze = async () => {
  await until((root) => document.querySelector(`${root} input[type=checkbox]`), "consent", root);
  await choose(`loc=css:${root} input[type=checkbox]`);
  await page.click('loc=role:button[name="음악 의미 분석 실행"]');
  await until((root) => document.querySelector(`${root} textarea[aria-label='Suno용 프롬프트 제안']`), "report", root);
};

const rows = [];
for (const width of [320, 390, 1440]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await page.goto(`${base}/admin?audio=${width}${root}`);
  await until((root) => document.querySelector(`${root} input[type=file]`), "form", root);
  assert.match((await state()).preview, /음악 파일을 선택하면 파형을 보고/);

  // 1) 끌어다 놓기 → 실제 디코딩 파형 120구간(점점 커지는 소리라 오른쪽이 높음)·시간 표시.
  await put("tone-2.wav", 2);
  await waveReady("tone-2.wav", 2);
  const dropped = await state();
  assert.equal(dropped.time, "0:00 / 0:02");
  assert.equal(dropped.rising, true);
  assert.match(dropped.picked, /선택한 파일 · tone-2\.wav · 0\.03 MB/);
  assert.match(dropped.inputValue, /tone-2\.wav$/); // 끌어다 놓은 파일도 파일 칸에 보인다.
  assert.match(dropped.note, /브라우저가 이 파일을 디코딩해/);

  // 2) 재생 위치는 키보드로 옮긴다. 음소거는 눌림 상태로 알린다.
  await page.focus(`loc=css:${root} input[type=range]`);
  for (let step = 0; step < 10; step += 1) await page.keyboard.press("ArrowRight");
  await until((root) => document.querySelector(`${root} audio`).currentTime > 0.5, "seek", root);
  await page.click(`loc=css:${root} button[aria-pressed]`);
  await until((root) => document.querySelector(`${root} audio`).muted && document.querySelector(`${root} button[aria-pressed=true]`), "mute", root);
  await page.click('loc=role:button[name="처음으로"]');
  await until((root) => document.querySelector(`${root} audio`).currentTime === 0, "rewind", root);

  // 3) 기존 결과 다섯 값과 편집 가능한 Suno 프롬프트(공개 준비에는 원문).
  await analyze();
  const report = await state();
  assert.match(report.report, /장르 · 악기 앰비언트 피아노/);
  assert.match(report.report, /추정 템포 96 BPM/);
  assert.match(report.report, /구간 구조 1 도입 피아노로 시작/);
  assert.equal(report.prompt, "Premiere fixture music");
  await page.fill(`loc=css:${root} textarea[aria-label='Suno용 프롬프트 제안']`, "edited suno");
  await until((root) => [...document.querySelectorAll(`${root} button`)].some(b => b.textContent === "원래대로"), "edited", root);
  // 같은 파일로 다시 분석하면 편집이 남지 않는다.
  await page.click('loc=role:button[name="음악 의미 분석 실행"]');
  await until((root) => document.querySelector(`${root} textarea[aria-label='Suno용 프롬프트 제안']`)?.value === "Premiere fixture music", "rerun", root);
  assert.ok(report.overflow <= 0, `overflow ${width}`);
  await page.evaluate((root) => document.querySelector(`${root} [aria-label='오디오 프리뷰']`).scrollIntoView(), root);
  await page.screenshot({ path: `${proof}/audio-${width}.png` });

  // 4) 다른 파일로 교체(파일 입력): 이름·파형·시간이 바뀌고 이전 결과가 남지 않는다.
  await put("tone-3.wav", 3, "input");
  await waveReady("tone-3.wav", 3);
  const swapped = await state();
  assert.equal(swapped.time, "0:00 / 0:03");
  assert.equal(swapped.prompt, null);
  assert.doesNotMatch(swapped.issue, /Suno/);

  // 5) 지원하지 않는 파일을 놓으면 미리보기 없이 안내하고, 선택 해제하면 입력도 비운다.
  await put("notes.txt", 0, "drop", "text/plain");
  await until((root) => document.querySelector(`${root} [aria-label='오디오 프리뷰']`).innerText.includes("음악 파일을 선택하면"), "invalid", root);
  const invalid = await state();
  assert.equal(invalid.waveName, null);
  assert.match(invalid.picked, /notes\.txt/);
  await page.click('loc=role:button[name="선택 해제"]');
  await until((root) => ![...document.querySelectorAll(`${root} p`)].some(node => node.textContent.startsWith("선택한 파일 ·")), "cleared", root);
  assert.equal((await state()).inputValue, "");

  // 6) 0바이트에 가까운 깨진 WAV는 파형 실패를 알리고 화면은 유지한다.
  await page.evaluate((root) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(160)], "broken.wav", { type: "audio/wav" }));
    const input = document.querySelector(`${root} input[type=file]`);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, root);
  await until((root) => document.querySelector(`${root} section:has(> audio)`)?.innerText.includes("파형을 그리지 못했어요"), "broken", root);
  // 7) 해제 없이 바로 교체: 손상→정상, 길이 다른 정상→정상, 정상→손상. 이전 길이·위치·오류가 남지 않고,
  //    재생 정보를 확인하기 전에는 재생·위치·음소거를 잠근다.
  const controls = () => page.evaluate((root) => {
    const wave = document.querySelector(`${root} section:has(> audio)`);
    const range = wave.querySelector("input[type=range]");
    return { name: wave.querySelector("h4").textContent, time: wave.querySelector("span[aria-label^='재생 위치']").textContent,
      max: Number(range.max), disabled: [range, ...wave.querySelectorAll("button")].map(control => control.disabled),
      unplayable: wave.innerText.includes("재생할 수 없어요") };
  }, root);
  await until((root) => document.querySelector(`${root} section:has(> audio)`)?.innerText.includes("재생할 수 없어요"), "broken unplayable", root);
  const broken = await controls();
  assert.deepEqual([broken.time, broken.max, broken.disabled], ["–:– / –:–", 0, [true, true, true, true]]);
  await put("tone-3.wav", 3, "input");
  await waveReady("tone-3.wav", 3);
  const healed = await controls();
  assert.deepEqual([healed.time, healed.max, healed.disabled, healed.unplayable], ["0:00 / 0:03", 3, [false, false, false, false], false]);
  await page.focus(`loc=css:${root} input[type=range]`);
  for (let step = 0; step < 25; step += 1) await page.keyboard.press("ArrowRight");
  await until((root) => document.querySelector(`${root} audio`).currentTime > 2, "seek past 2s", root);
  await put("tone-2.wav", 2, "input");
  await waveReady("tone-2.wav", 2);
  const shorter = await controls();
  assert.deepEqual([shorter.time, shorter.max], ["0:00 / 0:02", 2]);
  assert.equal(await page.evaluate((root) => document.querySelector(`${root} audio`).currentTime, root), 0);
  await page.evaluate((root) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(160)], "broken-2.wav", { type: "audio/wav" }));
    const input = document.querySelector(`${root} input[type=file]`);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, root);
  await until((root) => document.querySelector(`${root} section:has(> audio) h4`)?.textContent === "broken-2.wav", "broken-2 name", root);
  const immediate = await controls(); // 오류가 오기 전에도 이전 길이를 쓰지 않는다.
  assert.deepEqual([immediate.time, immediate.max, immediate.disabled], ["–:– / –:–", 0, [true, true, true, true]]);
  await until((root) => document.querySelector(`${root} section:has(> audio)`)?.innerText.includes("재생할 수 없어요"), "broken-2 unplayable", root);
  assert.deepEqual((await controls()).disabled, [true, true, true, true]);

  rows.push({ width, overflow: Math.max(0, report.overflow) });
}
console.log("AUDIO-RESULT" + JSON.stringify(rows));
