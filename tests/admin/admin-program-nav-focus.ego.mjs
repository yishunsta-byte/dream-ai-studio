/* global taskSpace, window, setTimeout, document, location, getComputedStyle, requestAnimationFrame, addEventListener, scrollTo, console */
// 고정 관리 메뉴 아래로 이동할 때 첫 스크롤부터 제목과 분석 프로그램 메뉴가 가려지지 않는지 확인한다.
// 아래로 스크롤한 상태에서 키보드(Enter)로 설정→분석, 분석 안 이동, 분석→설정을 오가며 이동 직후 모든 프레임을 잰다.
// 다음 프레임의 보정 스크롤에 기대지 않도록, 가장 나쁜 프레임 기준으로 판정한다.
// admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
import assert from "node:assert/strict";

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Program navigation focus " + Date.now());
const page = task.page("p1");
const menu = id => `nav[aria-label="관리 메뉴"] a[href="#${id}"]`;
const program = id => `nav[aria-label="분석 프로그램"] a[href="#${id}"]`;
const steps = [
  ["설정→분석 결과", menu("admin-analysis-results"), "admin-analysis-results", true],
  ["분석 결과→이미지", program("admin-style-dna"), "admin-style-dna", true],
  ["이미지→음악", program("admin-music-analysis"), "admin-music-analysis", true],
  ["음악→설정", menu("admin-account"), "admin-account", false],
  ["설정→개요", menu("admin-overview"), "admin-overview", false],
];

const rows = [];
for (const width of [320, 390, 768, 1440]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await page.goto(`${base}/admin?programFocus=${width}#admin-account`);
  await page.waitForFunction(() => document.querySelector("[data-admin-ready]") && document.querySelector('nav[aria-label="관리 메뉴"]')?.dataset.sticky, null, { timeout: 10000 });
  await page.evaluate(() => {
    // 목적지 제목에 초점이 온 뒤의 프레임만 잰다. 고정 메뉴가 위에 붙어 있으면 그 아래 끝, 아니면 화면 위 끝이 보이는 영역의 시작이다.
    const sample = () => {
      const heading = document.activeElement;
      const target = document.getElementById(location.hash.slice(1));
      if (!/^H[23]$/.test(heading.tagName) || !target?.contains(heading)) return;
      const bar = document.querySelector('nav[aria-label="관리 메뉴"]');
      const box = bar.getBoundingClientRect();
      const limit = bar.dataset.sticky === "true" && box.top <= 1 ? box.bottom : 0;
      window.__frames.push(+(heading.getBoundingClientRect().top - limit).toFixed(1));
    };
    addEventListener("hashchange", () => { let n = 0; const loop = () => { sample(); if (++n < 12) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    addEventListener("scroll", sample, true);
  });
  for (const [label, selector, id, analysis] of steps) {
    // 아래 끝까지 내려 프로그램 메뉴가 화면 위로 나간 상태에서, 스크롤 없이 링크에 초점을 두고 Enter.
    await page.evaluate((selector) => {
      scrollTo(0, document.documentElement.scrollHeight);
      window.__frames = [];
      document.querySelector(selector).focus({ preventScroll: true });
    }, selector);
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => location.hash === `#${id}` && /^H[23]$/.test(document.activeElement.tagName) && document.getElementById(id)?.contains(document.activeElement), id, { timeout: 5000 });
    // 이동 뒤 14프레임을 더 잰다. 같은 브라우저를 다른 시험이 쓰면 이 탭의 프레임이 느려지므로 1.5초에서 멈춘다.
    await page.evaluate(() => new Promise(done => { let n = 0; const loop = () => (++n < 14 ? requestAnimationFrame(loop) : done()); requestAnimationFrame(loop); setTimeout(done, 1500); }));
    const result = await page.evaluate(() => {
      const programs = document.getElementById("admin-program-navigation");
      const bar = document.querySelector('nav[aria-label="관리 메뉴"]');
      const workspace = bar.parentElement;
      const probe = document.createElement("div");
      probe.style.marginTop = "var(--admin-nav-offset)";
      workspace.append(probe);
      const offset = parseFloat(getComputedStyle(probe).marginTop);
      probe.remove();
      const box = bar.getBoundingClientRect();
      const limit = bar.dataset.sticky === "true" && box.top <= 1 ? box.bottom : 0;
      const shown = !programs.hidden && programs.getClientRects().length > 0;
      const top = shown ? programs.getBoundingClientRect().top : null;
      const fits = shown && document.activeElement.getBoundingClientRect().bottom - top + offset <= Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
      return { headings: window.__frames, margin: parseFloat(getComputedStyle(programs).scrollMarginTop), offset, programs: shown ? +(top - limit).toFixed(1) : null, fits };
    });
    const worstHeading = result.headings.length ? Math.min(...result.headings) : null;
    const row = { width, label, worstHeading, programs: result.programs, fits: result.fits, margin: result.margin, offset: result.offset };
    rows.push(row);
    // 원인: 전역 [id] 스크롤 여백과 같은 우선순위라 CSS 싣는 순서에 따라 고정 메뉴 높이가 빠진 값이 쓰였다.
    assert.equal(result.margin, result.offset, `프로그램 메뉴 스크롤 여백 ${JSON.stringify(row)}`);
    assert.ok(worstHeading !== null && worstHeading >= -0.5, `제목이 고정 메뉴에 가려짐 ${JSON.stringify(row)}`);
    // 프로그램 메뉴와 제목이 한 화면에 들어가면 프로그램 메뉴도 고정 메뉴 아래에 보여야 한다.
    if (analysis && result.fits) assert.ok(result.programs >= -0.5, `프로그램 메뉴가 고정 메뉴에 가려짐 ${JSON.stringify(row)}`);
  }
}
console.log("PROGRAM-NAV-RESULT" + JSON.stringify(rows));
