/* global taskSpace, window, setTimeout, document, location, getComputedStyle, requestAnimationFrame, addEventListener, scrollTo, console */
// 고정 관리 메뉴 아래에서 분석기와 운영 화면을 바꿀 때 초점이 메뉴에 가려지지 않는지 확인한다.
// 다음 프레임의 보정 스크롤에 기대지 않도록, 가장 나쁜 프레임 기준으로 판정한다.
// admin-premiere-publication-run.mjs가 출력한 루프백 주소에서 실행한다.
// P1-00-ADMIN-HEADER-320-OVERFLOW: 폭마다 문서·머리·계정 줄의 가로 넘침 0(일반·합성 긴 이메일), 로그아웃 단추가 화면 안에 있고 마지막 메뉴 다음 Tab으로 닿는지도 본다.
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

const rows = [], headers = [];
// 머리 넘침 측정: 문서·머리 scrollWidth와 머리 안 요소의 오른쪽 끝이 화면을 넘는지.
const headerFit = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const header = document.querySelector("[data-admin-workspace] > header");
  const account = header.querySelector("[data-show-email]");
  const email = account.querySelector("[title]");
  const logout = [...account.querySelectorAll("button")].find((b) => /로그아웃/.test(b.textContent)).getBoundingClientRect();
  return { vw, document: document.documentElement.scrollWidth - vw, header: header.scrollWidth - header.clientWidth,
    beyond: [...header.querySelectorAll("*")].filter((n) => n.getBoundingClientRect().right > vw + 0.5).length,
    logout: { left: Math.round(logout.left), right: Math.round(logout.right), height: Math.round(logout.height) }, clipped: email.scrollWidth > email.clientWidth };
});
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
  const plain = await headerFit();
  // 합성 긴 이메일(화면 글자만 바꿔 배치를 잰 뒤 되돌린다).
  const original = await page.evaluate(() => { const e = document.querySelector("[data-admin-workspace] > header [data-show-email] [title]"); const v = e.title;
    const long = "very.long.synthetic.operator.address.for.layout.check@example.invalid"; e.title = long; e.lastChild.textContent = long; return v; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const long = await headerFit();
  await page.evaluate((v) => { const e = document.querySelector("[data-admin-workspace] > header [data-show-email] [title]"); e.title = v; e.lastChild.textContent = v; }, original);
  await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="관리 메뉴"] a')].at(-1).focus());
  await page.keyboard.press("Tab");
  const tabbed = await page.evaluate(() => { const a = document.activeElement; return a?.tagName === "BUTTON" && /로그아웃/.test(a.textContent) && a.closest("header") !== null; });
  const fit = { width, plain, long, logoutByTab: tabbed };
  headers.push(fit);
  for (const [name, m] of [["일반", plain], ["긴 이메일", long]]) {
    assert.deepEqual([m.document, m.header, m.beyond], [0, 0, 0], `${width} ${name} 머리 넘침 ${JSON.stringify(m)}`);
    // 휴대폰 폭에서는 누르기 쉬운 44px 이상, 넓은 화면은 기존 작은 단추 높이 그대로.
    assert.ok(m.logout.left >= 0 && m.logout.right <= m.vw && (width >= 600 || m.logout.height >= 44), `${width} ${name} 로그아웃 위치 ${JSON.stringify(m.logout)}`);
  }
  assert.equal(long.clipped, true, "긴 이메일은 말줄임");
  assert.equal(tabbed, true, "마지막 메뉴 다음 Tab이 로그아웃");
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
console.log("HEADER-FIT-RESULT" + JSON.stringify(headers));
