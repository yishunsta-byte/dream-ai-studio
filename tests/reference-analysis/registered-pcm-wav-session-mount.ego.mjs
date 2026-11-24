/* global taskSpace, fetch, document, window, BroadcastChannel, setTimeout, console, Event */
// 등록 PCM WAV · 세션 확인 중 최초 마운트와 실제 POST 403(SessionBoundary → ProtectedContent → 보호 목록 화면), 폭 390·1440
//  M0 정상: 확인된 상태에서 화면을 늦게 그림 → 목록 1회 → A 분석(회귀)
//  M1 확인 중 마운트: 같은 계정 신호로 의심 상태(세션 확인 붙잡기) 중 화면을 그림 → 목록 0 → same 확인 뒤 자기 목록 1회
//  F  POST 403: A 결과·초안 편집 → 문서 유지·허용 밖 세션(f) → '다시 분석' → 접근 불가 상태, 선택·확인·초안 제거, 초점 안내, 원본 읽기 0
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/registered-pcm-wav-session-mount.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const EDIT = "A가 고친 초안 문장";
const task = await taskSpace("registered wav session mount");
const page = task.page("p1");
const other = await task.newPage();
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cookie = (as) => page.evaluate(async (value) => (await fetch(`/__fixture/cookie?as=${value}`, { cache: "no-store" })).status, as);
const view = () => page.evaluate((edit) => { const main = document.querySelector("main"); const body = document.querySelector("[data-protected-content]");
  const select = main.querySelector("select"); const box = main.querySelector("input[type=checkbox]");
  return { result: /음악 분석 · 결과|최대 정규화 RMS/.test(main.innerText), domRms25: document.documentElement.outerHTML.includes("RMS 25%"),
    domEdit: document.documentElement.outerHTML.includes(edit), selectDom: !!select, options: select ? select.options.length : 0, selected: select ? select.selectedIndex > 0 : false,
    checkbox: !!box, checked: !!box?.checked, textarea: !!main.querySelector("textarea"), links: [...main.querySelectorAll("a")].map((a) => a.textContent),
    deferred: !!document.querySelector("[data-fixture-deferred]"), loadingNotice: /등록 자료 목록을 불러오고 있어요/.test(document.documentElement.outerHTML),
    body: body ? { hidden: body.hidden, inert: body.inert } : null, sessionNotice: document.querySelector("[data-session-notice]")?.innerText.split("\n")[0] ?? null,
    focus: document.activeElement === document.body ? "BODY" : `${document.activeElement.tagName}:${(document.activeElement.textContent || "").trim().slice(0, 18)}` }; }, EDIT);
const until = async (fn, label, tries = 60) => { for (let i = 0; i < tries; i++) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(250); } throw new Error("timeout: " + label); };
const openList = () => until(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, "list");
const runAnalysis = async () => {
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await until(() => document.activeElement?.textContent === "분석 결과", "result focus");
};
const resultOf = () => page.evaluate(() => { const main = document.querySelector("main");
  return { meta: main.innerText.match(/음악 분석 · 결과 \d+개/)?.[0] ?? null, evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()) }; });
const okA = (r) => r.meta === "음악 분석 · 결과 1개" && r.evidence.some((e) => e.includes("오디오 1채널 · 최대 정규화 RMS 25%") && /0.?125 ms/.test(e));
const mount = () => page.evaluate(() => window.dispatchEvent(new Event("fixture-mount")));
const openDeferred = async () => { await page.goto(`${origin}/?defer=1`); await until(() => !!document.querySelector("[data-fixture-deferred]") && !!document.getElementById("root")?.dataset.account, "deferred"); };
const out = { widths: [] };
try {
  await other.goto(`${origin}/login`);
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };
    await page.goto(`${origin}/__session?as=a`);

    // M0 정상 지연 마운트
    await openDeferred();
    const n0 = await st();
    await mount();
    await openList();
    await wait(600);
    const n1 = await st();
    r.m0 = { lists: n1.listGets - n0.listGets, first: await view() };
    await runAnalysis();
    r.m0.result = await resultOf();
    const n2 = await st();
    r.m0.reads = { a: n2.readsA - n1.readsA, b: n2.readsB - n1.readsB };
    check(r.m0.lists === 1 && r.m0.first.focus === "BODY" && !r.m0.first.selected && okA(r.m0.result) && r.m0.reads.a === 2 && r.m0.reads.b === 0, `M0 normal mount ${width}`);

    // M1 확인 중 마운트
    await openDeferred();
    const k0 = await st();
    await ctl("hold-session");
    r.m1 = { otherTab: await other.evaluate(async () => { const s = (await fetch("/__fixture/cookie?as=a", { cache: "no-store" })).status;
      const channel = new BroadcastChannel("dream-auth-session"); channel.postMessage("changed"); channel.close(); return s; }) };
    await until(() => !!document.querySelector("[data-session-notice]"), "M1 checking");
    await mount();
    await wait(800);
    const k1 = await st();
    r.m1.whileChecking = { lists: k1.listGets - k0.listGets, view: await view() };
    await ctl("release-session");
    await until(() => !document.querySelector("[data-session-notice]"), "M1 current");
    await openList();
    await wait(800);
    const k2 = await st();
    r.m1.afterCurrent = { lists: k2.listGets - k0.listGets, view: await view(), posts: k2.posts - k0.posts, reads: (k2.readsA + k2.readsB) - (k0.readsA + k0.readsB) };
    r.m1.overflow = await overflow();
    check(r.m1.otherTab === 204 && r.m1.whileChecking.lists === 0 && r.m1.whileChecking.view.body?.hidden === true && !r.m1.whileChecking.view.selectDom, `M1 no list while checking ${width}`);
    check(r.m1.afterCurrent.lists === 1 && r.m1.afterCurrent.view.options === 2 && !r.m1.afterCurrent.view.selected && !r.m1.afterCurrent.view.checked
      && r.m1.afterCurrent.posts === 0 && r.m1.afterCurrent.reads === 0 && r.m1.overflow === 0, `M1 one own list after current ${width}`);

    // F 실제 POST 403
    await page.goto(`${origin}/__session?as=a`);
    await openList();
    await runAnalysis();
    r.f = { a: await resultOf() };
    await page.focus("loc=css:main textarea"); await page.keyboard.press("End"); await page.keyboard.type(" " + EDIT);
    const f0 = await st();
    r.f.cookie = await cookie("f");
    await page.focus("loc=css:main button:has-text('다시 분석')"); await page.keyboard.press("Enter");
    await until(() => /이 화면에 접근할 수 없어요/.test(document.querySelector("main").innerText), "F forbidden notice");
    await wait(300);
    r.f.after = await view();
    const f1 = await st();
    r.f.counts = { forbidden: f1.forbidden - f0.forbidden, reads: (f1.readsA + f1.readsB) - (f0.readsA + f0.readsB), lists: f1.listGets - f0.listGets };
    r.f.overflow = await overflow();
    await cookie("a");
    check(okA(r.f.a) && r.f.cookie === 204 && r.f.counts.forbidden === 1 && r.f.counts.reads === 0 && r.f.counts.lists === 0, `F POST 403 no read ${width}`);
    check(!r.f.after.result && !r.f.after.domRms25 && !r.f.after.domEdit && !r.f.after.selectDom && !r.f.after.checkbox && !r.f.after.textarea
      && r.f.after.links.length === 0 && /^DIV:이 화면에 접근할 수 없어요/.test(r.f.after.focus) && r.f.overflow === 0, `F forbidden state cleared ${width}`);
    out.widths.push(r);
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 200));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await ctl("release-session").catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
