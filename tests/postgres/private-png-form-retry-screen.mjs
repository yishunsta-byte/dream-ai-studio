/* global window, document, Headers, URL, Request */
import assert from "node:assert/strict";

// Run against an authenticated, disposable local PG form. Both writes really commit.
export async function verifyRetryScreen(page, pngPath) {
  const location = await page.evaluate(() => window.location.href);
  assert.equal(new URL(location).hostname, "127.0.0.1");
  assert.equal(new URL(location).pathname, "/cloud/projects/new");
  const fields = { title: "단계별 복구 확인", goal: "저장 검수", target: "검수 담당자", productName: "시험 제품", facts: "합성 사진" };
  for (const [name, value] of Object.entries(fields)) await page.fill(`css:[name=${name}]`, value);
  await page.setInputFiles("css:input[type=file]", pngPath);
  await page.selectOption('css:select[name="usageRights"]', "직접 촬영");
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    const attempts = [];
    window.formRetryAttempts = attempts;
    window.fetch = async (url, init) => {
      const path = new URL(url instanceof Request ? url.url : url, window.location.href).pathname;
      if (init?.method !== "POST" || !["/api/assets/upload", "/api/projects"].includes(path)) return original(url, init);
      const response = await original(url, init);
      const first = !attempts.some(attempt => attempt.path === path);
      const { id } = await response.clone().json();
      attempts.push({ path, key: new Headers(init.headers).get("Idempotency-Key"), status: response.status, id });
      if (first && response.status === 201) throw new TypeError("lost response");
      return response;
    };
  });
  const button = "css:button[type=submit]";
  const clickSubmit = async () => {
    await page.evaluate(() => document.querySelector("button[type=submit]").scrollIntoView({ block: "center", behavior: "instant" }));
    await page.click(button);
  };
  const help = "css:#project-retry-help";
  const retry = async (label, message) => {
    await page.waitForSelector(help);
    const state = await page.evaluate(() => ({
      label: document.querySelector("button[type=submit]").innerText.trim(),
      message: document.querySelector("#project-retry-help").innerText,
      selected: document.querySelector("input[type=file]").files.length,
    }));
    assert.equal(state.label, label);
    assert.match(state.message, message);
    assert.equal(state.selected, 1);
    await clickSubmit();
  };
  await clickSubmit();
  await retry("사진 업로드 다시 시도", /선택한 사진/);
  await retry("프로젝트 저장 다시 시도", /프로젝트 저장만/);
  await page.waitForSelector("css:a[href^='/cloud/projects/']");
  const attempts = await page.evaluate(() => window.formRetryAttempts);
  assert.deepEqual(attempts.map(a => a.path), ["/api/assets/upload", "/api/assets/upload", "/api/projects", "/api/projects"]);
  assert.ok(attempts.every(a => a.status === 201 && a.id && a.key));
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(attempts[2], attempts[3]);
  assert.notEqual(attempts[0].key, attempts[2].key);
}
