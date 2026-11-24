/* global document, window, URL, Headers */
import assert from "node:assert/strict";

// Use the authenticated disposable PG17 app and a synthetic one-second PCM file.
export async function verifyWavPanel(page, wavPath, replacementPath) {
  const panel = "section[aria-label='비공개 음원']";
  const origin = await page.evaluate(() => window.location.origin);
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  await page.setInputFiles("css:" + panel + " input[type=file]", wavPath);
  if (replacementPath) {
    await page.fill("css:" + panel + " textarea", "첫 파일에만 해당하는 메모");
    await page.setInputFiles("css:" + panel + " input[type=file]", replacementPath);
    assert.equal(await page.evaluate(() => document.querySelector("section[aria-label='비공개 음원'] textarea").value), "");
  }
  await page.fill("css:" + panel + " textarea", "직접 생성한 시험 음원");
  const device = await page.evaluate(async () => {
    const audio = document.querySelector("audio[aria-label='선택한 파일 미리 듣기']");
    await audio.play(); audio.pause();
    return { duration: audio.duration, src: audio.src };
  });
  assert.match(device.src, /^blob:/);
  assert.equal(device.duration, 1);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.wavAttempts = [];
    window.fetch = async (url, init) => {
      const response = await original(url, init);
      if (init?.method === "POST" && String(url).includes("format=wav")) {
        const { id } = await response.clone().json();
        window.wavAttempts.push({ key: new Headers(init.headers).get("Idempotency-Key"), id, status: response.status });
        if (window.wavAttempts.length === 1) throw new TypeError("lost response");
      }
      return response;
    };
  });
  const submit = "css:" + panel + " button";
  await page.click(submit);
  await page.waitForSelector("css:" + panel + " [role=alert]");
  assert.equal(await page.evaluate(() => document.querySelector("section[aria-label='비공개 음원'] textarea").value), "직접 생성한 시험 음원");
  await page.focus(submit);
  await page.keyboard.press("Enter");
  await page.waitForSelector("css:audio[aria-label='등록한 음원 듣기']");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "status");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "등록한 음원 듣기");
  const saved = await page.evaluate(async () => {
    const audio = document.querySelector("audio[aria-label='등록한 음원 듣기']");
    await audio.play(); audio.pause();
    return { duration: audio.duration, path: audio.getAttribute("src"), attempts: window.wavAttempts,
      status: document.querySelector("section[aria-label='비공개 음원'] [role=status]").textContent };
  });
  assert.equal(saved.duration, 1);
  assert.equal(saved.attempts.length, 2);
  assert.deepEqual(saved.attempts[0], saved.attempts[1]);
  assert.equal(saved.attempts[0].status, 201);
  assert.equal(saved.path, `/api/assets/${saved.attempts[0].id}?format=wav`);
  assert.match(saved.status, /프로젝트 연결 전/);
}
