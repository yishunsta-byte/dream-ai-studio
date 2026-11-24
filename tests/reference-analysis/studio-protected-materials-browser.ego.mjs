/* global taskSpace, fetch, document, setTimeout, console */
// PG17 격리 루프백: 브라우저 → 보호 목록 GET → 권리 확인 → 등록 PNG 분석 POST → 실제 결과 → 철회
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/studio-protected-materials-browser.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const task = await taskSpace("protected png integration");
const page = task.page("p1");
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const focus = () => page.evaluate(() => { const a = document.activeElement; if (a === document.body) return "BODY"; const n = a.tagName === "SELECT" ? `[${a.selectedOptions[0]?.textContent}]` : a.type === "checkbox" ? `체크(${a.checked ? "켬" : "끔"})` : a.textContent.trim().slice(0, 22); return `${a.tagName}${a.disabled ? "(꺼짐)" : ""}:${n}`; });
const out = [];
try {
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };
    await page.goto(origin + "/");
    await page.waitForFunction(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, undefined, { timeout: 15000 });
    r.firstEntry = await focus();
    r.options = await page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
    r.domLeaks = await page.evaluate(() => { const h = document.documentElement.outerHTML; return ["10000000-", "등록 이미지 ·"].filter((s) => h.includes(s)); });
    await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab"); r.checkFocus = await focus();
    // 확인 전: 꺼진 실행을 강제로 눌러도 POST 0
    await page.evaluate(() => [...document.querySelectorAll("main button")].forEach((b) => b.click()));
    await new Promise((s) => setTimeout(s, 300));
    r.beforeRights = await st();
    await page.keyboard.press("Space"); await page.keyboard.press("Tab"); r.runFocus = await focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.textContent === "분석 결과", undefined, { timeout: 15000 });
    r.result = await page.evaluate(() => ({ focus: document.activeElement.tagName + ":" + document.activeElement.textContent,
      headings: [...document.querySelectorAll("main h4")].map((h) => h.textContent), evidence: document.querySelector("main ol")?.textContent?.slice(0, 80),
      palette: /#e02020/.test(document.querySelector("main").innerText), draft: !!document.querySelector("main textarea")?.value }));
    r.layout = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll("main section section")].map((s) => s.getBoundingClientRect()); return b.top > a.bottom - 1 ? "아래" : "옆"; });
    r.afterResult = await st();
    // 승인 철회 → 다시 분석 → 차단(다운로드 없음), 결과·목록 정리, 초점
    await ctl("revoke");
    await page.focus("loc=css:main button:has-text('다시 분석')"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => /분석할 수 있는 등록 자료가 없어요/.test(document.querySelector("main").innerText), undefined, { timeout: 15000 });
    await new Promise((s) => setTimeout(s, 150));
    r.revoked = await page.evaluate(() => ({ select: !!document.querySelector("main select"), textarea: !!document.querySelector("main textarea"), check: !!document.querySelector("main input[type=checkbox]"),
      palette: /#e02020/.test(document.querySelector("main").innerText) }));
    r.revokedFocus = await focus();
    r.afterRevoke = await st();
    r.overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await ctl("restore");
    out.push(r);
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) });
}
console.log(JSON.stringify(out));
