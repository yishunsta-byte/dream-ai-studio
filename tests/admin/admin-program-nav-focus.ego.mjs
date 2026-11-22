/* global taskSpace, window, setTimeout, document, location, getComputedStyle, requestAnimationFrame, addEventListener, scrollTo, console */
// 고정 관리 메뉴 아래에서 분석기와 운영 화면을 바꿀 때 초점이 메뉴에 가려지지 않는지 확인한다.
// 다음 프레임의 보정 스크롤에 기대지 않도록, 가장 나쁜 프레임 기준으로 판정한다.
// admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
import assert from "node:assert/strict";

const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Program navigation focus " + Date.now());
const page = task.page("p1");
const menu = id => `nav[aria-label="관리 메뉴"] a[href="#${id}"]`;
const steps = [
  ["설정→이미지 분석", "admin-image-analysis"],
  ["이미지→오디오 분석", "admin-music-analysis"],
  ["오디오→영상 분석", "admin-shorts-analysis"],
  ["영상→설정", "admin-account"],
  ["설정→내 프로젝트", "admin-project-list"],
];

const rows = [];
for (const width of [320, 390, 768, 1440]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await page.goto(`${base}/admin?programFocus=${width}#admin-overview`);
  await page.waitForFunction(() => location.hash === "#admin-home"
    && document.activeElement?.id === "admin-home-heading"
    && !document.querySelector('a[href="#admin-overview"], #admin-overview'), null, { timeout: 10000 });
  await page.goto(`${base}/admin?programFocus=${width}#admin-account`);
  await page.waitForFunction(() => document.querySelector("[data-admin-ready]") && document.querySelector('nav[aria-label="관리 메뉴"]')?.dataset.sticky, null, { timeout: 10000 });
  await page.evaluate(() => {
    // 목적지 제목에 초점이 온 뒤의 프레임만 잰다. 고정 메뉴가 위에 붙어 있으면 그 아래 끝, 아니면 화면 위 끝이 보이는 영역의 시작이다.
    const sample = () => {
      const heading = document.activeElement;
      const target = document.getElementById(location.hash.slice(1));
      if (!target?.contains(heading) || (heading !== target && !/^H[23]$/.test(heading.tagName))) return;
      const bar = document.querySelector('nav[aria-label="관리 메뉴"]');
      const box = bar.getBoundingClientRect();
      const limit = bar.dataset.sticky === "true" && box.top <= 1 ? box.bottom : 0;
      window.__frames.push(+(heading.getBoundingClientRect().top - limit).toFixed(1));
    };
    addEventListener("hashchange", () => { let n = 0; const loop = () => { sample(); if (++n < 12) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    addEventListener("scroll", sample, true);
  });
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="관리 메뉴"] a')].slice(0,3).map(link=>link.textContent.trim())), ["이미지 분석","오디오 분석","영상 분석"]);
  for (const [label, id] of steps) {
    await page.evaluate((selector) => {
      scrollTo(0, document.documentElement.scrollHeight);
      window.__frames = [];
      document.querySelector(selector).focus({ preventScroll: true });
    }, menu(id));
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => {
      const target = document.getElementById(id);
      const focused = document.activeElement;
      return location.hash === `#${id}` && target?.contains(focused) && (focused === target || /^H[23]$/.test(focused.tagName));
    }, id, { timeout: 5000 });
    // 이동 뒤 14프레임을 더 잰다. 같은 브라우저를 다른 시험이 쓰면 이 탭의 프레임이 느려지므로 1.5초에서 멈춘다.
    await page.evaluate(() => new Promise(done => { let n = 0; const loop = () => (++n < 14 ? requestAnimationFrame(loop) : done()); requestAnimationFrame(loop); setTimeout(done, 1500); }));
    const result = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="관리 메뉴"]');
      const workspace = bar.parentElement;
      const probe = document.createElement("div");
      probe.style.marginTop = "var(--admin-nav-offset)";
      workspace.append(probe);
      const offset = parseFloat(getComputedStyle(probe).marginTop);
      probe.remove();
      return { headings: window.__frames, margin: parseFloat(getComputedStyle(document.activeElement).scrollMarginTop), offset };
    });
    const worstHeading = result.headings.length ? Math.min(...result.headings) : null;
    const row = { width, label, worstHeading, margin: result.margin, offset: result.offset };
    rows.push(row);
    assert.equal(result.margin, result.offset, `상세 화면 스크롤 여백 ${JSON.stringify(row)}`);
    assert.ok(worstHeading !== null && worstHeading >= -0.5, `제목이 고정 메뉴에 가려짐 ${JSON.stringify(row)}`);
  }
}
console.log("PROGRAM-NAV-RESULT" + JSON.stringify(rows));
