/* global taskSpace, fetch, document, BroadcastChannel, setTimeout, console */
// 등록 PCM WAV · 늦은 목록 응답과 세션 경계(SessionBoundary → ProtectedContent → 보호 목록 화면), 폭 390·1440
//  L1 같은 계정: A 결과·편집 → 신호#1 → same 뒤 다시 받는 목록을 붙잡음 → 신호#2(이전 epoch) → 붙잡은 목록 풀기 → 되살림 0 → same 뒤 유효 목록 1회·키보드
//  L2 계정 변경: 첫 목록(A)을 붙잡음 → 다른 탭 B 전환·신호 → 붙잡은 A 목록 풀기 → 되살림 0 → changed 다시 받기 → B 목록 1회
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/registered-pcm-wav-late-list.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const EDIT = "A가 고친 초안 문장";
const task = await taskSpace("registered wav late list");
const page = task.page("p1");
const other = await task.newPage();
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const view = () => page.evaluate((edit) => { const main = document.querySelector("main"); const body = document.querySelector("[data-protected-content]");
  const select = main.querySelector("select"); const box = main.querySelector("input[type=checkbox]");
  return { account: document.getElementById("root")?.dataset.account ?? null, result: /음악 분석 · 결과|최대 정규화 RMS/.test(main.innerText),
    domRms25: document.documentElement.outerHTML.includes("RMS 25%"), domEdit: document.documentElement.outerHTML.includes(edit),
    selectDom: !!select, options: select ? select.options.length : 0, selected: select ? select.selectedIndex > 0 : false, checked: !!box?.checked,
    textarea: !!main.querySelector("textarea"), loadingNotice: /등록 자료 목록을 불러오고 있어요/.test(document.documentElement.outerHTML),
    body: body ? { hidden: body.hidden, inert: body.inert } : null, sessionNotice: document.querySelector("[data-session-notice]")?.innerText.split("\n")[0] ?? null,
    focus: document.activeElement === document.body ? "BODY" : `${document.activeElement.tagName}:${(document.activeElement.textContent || "").trim().slice(0, 18)}` }; }, EDIT);
const until = async (fn, label, tries = 60) => { for (let i = 0; i < tries; i++) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(250); } throw new Error("timeout: " + label); };
const untilState = async (fn, label) => { for (let i = 0; i < 100; i++) { if (fn(await st())) return; await wait(100); } throw new Error("timeout: " + label); };
const openList = () => until(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, "list");
const runAnalysis = async () => {
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await until(() => document.activeElement?.textContent === "분석 결과", "result focus");
};
const resultOf = () => page.evaluate(() => { const main = document.querySelector("main");
  return { meta: main.innerText.match(/음악 분석 · 결과 \d+개/)?.[0] ?? null, evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()) }; });
const okA = (r) => r.meta === "음악 분석 · 결과 1개" && r.evidence.some((e) => e.includes("오디오 1채널 · 최대 정규화 RMS 25%") && /0.?125 ms/.test(e));
const signal = (as) => other.evaluate(async (value) => { const s = (await fetch(`/__fixture/cookie?as=${value}`, { cache: "no-store" })).status;
  const channel = new BroadcastChannel("dream-auth-session"); channel.postMessage("changed"); channel.close(); return s; }, as);
const checking = () => until(() => !!document.querySelector("[data-session-notice]"), "checking");
const out = { widths: [] };
let lastReload = 0;
try {
  await other.goto(`${origin}/login`);
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };

    // L1 같은 계정: 이전 epoch의 늦은 목록
    await page.goto(`${origin}/__session?as=a`);
    await openList();
    r.l1 = { firstFocus: (await view()).focus };
    await runAnalysis();
    r.l1.a = await resultOf();
    await page.focus("loc=css:main textarea"); await page.keyboard.press("End"); await page.keyboard.type(" " + EDIT);
    const s0 = await st();
    await ctl("hold-session");
    r.l1.signal1 = await signal("a");
    await checking();
    await ctl("hold-next-list");
    await ctl("release-session");
    await untilState((x) => x.listHeld === s0.listHeld + 1, "L1 list held");
    await wait(200);
    r.l1.whileHeld = await view();
    await ctl("hold-session");
    r.l1.signal2 = await signal("a");
    await checking();
    await wait(200);
    await ctl("release-list");
    await wait(400);
    r.l1.lateReleased = await view();
    const s1 = await st();
    r.l1.held = { delivered: s1.listHeldDelivered - s0.listHeldDelivered, discarded: s1.listHeldDiscarded - s0.listHeldDiscarded };
    await ctl("release-session");
    await until(() => !document.querySelector("[data-session-notice]"), "L1 current");
    await openList();
    await wait(800);
    const s2 = await st();
    r.l1.after = await view();
    r.l1.lists = { total: s2.listGets - s0.listGets, held: s2.listHeld - s0.listHeld };
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Tab");
    r.l1.tab = (await view()).focus;
    r.l1.overflow = await overflow();
    r.l1.posts = s2.posts - s0.posts;
    check(r.l1.firstFocus === "BODY" && okA(r.l1.a), `L1 normal list/analysis ${width}`);
    check(!r.l1.whileHeld.selectDom && !r.l1.whileHeld.domRms25 && !r.l1.whileHeld.domEdit && r.l1.whileHeld.loadingNotice, `L1 list pending shows loading only ${width}`);
    check(r.l1.held.delivered === 0 && r.l1.held.discarded === 1 && !r.l1.lateReleased.selectDom && !r.l1.lateReleased.domRms25 && !r.l1.lateReleased.domEdit
      && r.l1.lateReleased.body?.hidden === true, `L1 late list cancelled, nothing revived ${width}`);
    check(r.l1.lists.total === 2 && r.l1.lists.held === 1 && r.l1.after.options === 2 && !r.l1.after.selected && !r.l1.after.checked && !r.l1.after.domRms25 && !r.l1.after.domEdit
      && /^SELECT:/.test(r.l1.after.focus) && r.l1.tab === "INPUT:" && r.l1.posts === 0 && r.l1.overflow === 0, `L1 one valid list after current ${width}`);

    // L2 계정 변경: 첫 목록이 늦게 옴
    const since = Date.now() - lastReload; if (since < 16_000) await wait(16_000 - since);
    await page.goto(`${origin}/__session?as=a`);
    await openList();
    const t0 = await st();
    await ctl("hold-next-list");
    await page.goto(`${origin}/`);
    await untilState((x) => x.listHeld === t0.listHeld + 1, "L2 list held");
    r.l2 = { whileHeld: await view() };
    await ctl("hold-session");
    r.l2.signal = await signal("b");
    await checking();
    await wait(200);
    await ctl("release-list");
    await wait(400);
    r.l2.lateReleased = await view();
    const t1 = await st();
    r.l2.held = { delivered: t1.listHeldDelivered - t0.listHeldDelivered, discarded: t1.listHeldDiscarded - t0.listHeldDiscarded };
    await ctl("release-session");
    lastReload = Date.now();
    await wait(800);
    await until(() => document.getElementById("root")?.dataset.account === "b@example.invalid", "L2 reload as B", 80);
    await openList();
    await wait(800);
    const t2 = await st();
    r.l2.after = await view();
    r.l2.bList = JSON.parse((await page.fetch("/api/studio/reference-analysis/materials")).body).materials.length;
    r.l2.lists = { afterReload: t2.listGets - t1.listGets };
    r.l2.reads = (t2.readsA + t2.readsB) - (t0.readsA + t0.readsB);
    r.l2.overflow = await overflow();
    check(r.l2.signal === 204 && !r.l2.whileHeld.selectDom && r.l2.held.delivered === 0 && r.l2.held.discarded === 1 && !r.l2.lateReleased.selectDom
      && r.l2.lateReleased.body?.hidden === true, `L2 late A list cancelled ${width}`);
    check(r.l2.after.account === "b@example.invalid" && r.l2.after.options === 2 && !r.l2.after.selected && r.l2.lists.afterReload === 1 && r.l2.bList === 1
      && r.l2.reads === 0 && r.l2.overflow === 0, `L2 B one list after reload ${width}`);
    out.widths.push(r);
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 200));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await ctl("release-list").catch(() => {}); await ctl("release-session").catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
