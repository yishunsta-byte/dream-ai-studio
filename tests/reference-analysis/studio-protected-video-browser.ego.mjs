/* global taskSpace, fetch, document, setTimeout, console */
// PG17 격리 루프백: 브라우저 → 보호 목록 GET → 권리 확인 → 등록 MP4 분석 POST → 프레임·장면 전환 결과 → 철회 → 계정 B 격리
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/studio-protected-video-browser.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const task = await taskSpace("protected mp4 integration");
const page = task.page("p1");
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const focus = () => page.evaluate(() => { const a = document.activeElement; if (a === document.body) return "BODY"; const n = a.tagName === "SELECT" ? `[${a.selectedOptions[0]?.textContent}]` : a.type === "checkbox" ? `체크(${a.checked ? "켬" : "끔"})` : a.textContent.trim().slice(0, 22); return `${a.tagName}${a.disabled ? "(꺼짐)" : ""}:${n}`; });
const openList = async () => {
  await page.goto(origin + "/");
  await page.waitForFunction(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, undefined, { timeout: 15000 });
};
// 자료 선택 → (확인 전 강제 클릭) → 확인 → 실행 → 결과
const analyze = async (r) => {
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); r.checkFocus = await focus();
  await page.evaluate(() => [...document.querySelectorAll("main button")].forEach((b) => b.click()));
  await wait(300);
  r.beforeRights = await st();
  await page.keyboard.press("Space"); await page.keyboard.press("Tab"); r.runFocus = await focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.textContent === "분석 결과", undefined, { timeout: 30000 });
  r.result = await page.evaluate(() => {
    const main = document.querySelector("main");
    return { focus: document.activeElement.tagName + ":" + document.activeElement.textContent,
      meta: main.innerText.match(/영상 분석 · 결과 \d+개/)?.[0] ?? null,
      items: [...(main.querySelector("select[id$='-result']")?.options ?? [])].map((o) => o.textContent.trim()),
      headings: [...main.querySelectorAll("h4")].map((h) => h.textContent),
      evidence: main.querySelector("ol")?.textContent?.slice(0, 160),
      draft: !!main.querySelector("textarea")?.value };
  });
  // 결과 선택을 키보드로 넘기며 결과별 프레임 시각과 근거 시간 구간을 읽는다.
  r.details = [];
  for (let i = 0; i < r.result.items.length; i++) {
    if (i > 0) { await page.focus("loc=css:main select[id$='-result']"); await page.keyboard.press("ArrowDown"); await wait(100); }
    r.details.push(await page.evaluate(() => { const main = document.querySelector("main");
      return { seek: main.innerText.match(/원본 프레임 표시 시각 (\d+) ms/)?.[1] ?? null,
        evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()).join(" | ").slice(0, 200) }; }));
  }
  r.afterResult = await st();
};
const cleared = () => page.evaluate(() => { const main = document.querySelector("main"); return { select: !!main.querySelector("select"), textarea: !!main.querySelector("textarea"),
  check: !!main.querySelector("input[type=checkbox]"), result: /원본 프레임 표시 시각|영상 분석 · 결과/.test(main.innerText) }; });
// 새 계정 화면: 자료 선택 칸은 있지만 아무것도 고르지 않았고, 체크는 꺼져 있고, 결과·초안이 없다.
const fresh = () => page.evaluate(() => { const main = document.querySelector("main"); return { selected: main.querySelector("select")?.selectedIndex ?? -1,
  checked: main.querySelector("input[type=checkbox]")?.checked ?? null, textarea: !!main.querySelector("textarea"), result: /원본 프레임 표시 시각|영상 분석 · 결과/.test(main.innerText) }; });
const out = [];
try {
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };
    await openList();
    r.firstEntry = await focus();
    r.options = await page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
    r.domLeaks = await page.evaluate(() => { const h = document.documentElement.outerHTML; return ["10000000-", "등록 영상 ·", "등록 이미지 ·"].filter((s) => h.includes(s)); });
    await analyze(r);
    r.layout = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll("main section section")].map((s) => s.getBoundingClientRect()); return b.top > a.bottom - 1 ? "아래" : "옆"; });
    // 승인 철회 → 다시 분석 → 차단(다운로드 없음), 결과·목록 정리
    await ctl("revoke");
    await page.focus("loc=css:main button:has-text('다시 분석')"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => /분석할 수 있는 등록 자료가 없어요/.test(document.querySelector("main").innerText), undefined, { timeout: 15000 });
    await wait(150);
    r.revoked = await cleared();
    r.revokedFocus = await focus();
    r.afterRevoke = await st();
    r.overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await ctl("restore");
    // 계정 B: 목록은 B 자기 자료 1개만, A의 결과·선택은 남지 않음, B 분석은 B의 MP4
    await ctl("account-b");
    const b = {};
    await openList();
    b.options = await page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
    b.fresh = await fresh();
    await analyze(b);
    r.accountB = b;
    await ctl("account-a");
    out.push(r);
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) });
}
console.log(JSON.stringify(out));
