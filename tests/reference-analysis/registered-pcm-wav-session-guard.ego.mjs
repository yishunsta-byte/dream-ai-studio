/* global taskSpace, fetch, document, window, location, BroadcastChannel, setTimeout, console, Event */
// 등록 PCM WAV · 보호 분석 세션 방어 보완 확인(SessionBoundary → ProtectedContent → 보호 목록 화면), 폭 390·1440
//  S0 갱신: focus 복귀 재확인(같은 계정) → 결과·초안 편집·선택·확인 유지
//  S1 만료: 문서 유지·쿠키 삭제 → '다시 분석' POST 401 → ‘다시 로그인’ 상태, 선택·확인·결과·초안 제거, 초점 안내 → focus 재확인 → 로그인 이동
//  S2 다른 탭 계정 변경: 붙잡힌 A 재분석 + 세션 확인 붙잡기 → 신호 → 분석 화면 내림(진행 중 취소) → 늦은 A 응답 DOM 0 → 다시 받기 → B만
//  S3 같은 계정 신호: 의심 → same 확인 뒤 목록 재조회(이전 결과·선택 제거) → 새 선택·분석 → 갱신 뒤 유지
//  S4 신호 없는 쿠키 교체: source_unavailable → 목록 재조회(B) · 이전 결과/초안 제거(회귀)
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/registered-pcm-wav-session-guard.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const EDIT = "A가 고친 초안 문장";
const task = await taskSpace("registered wav session guard");
const page = task.page("p1");
const other = await task.newPage();
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cookie = (as) => page.evaluate(async (value) => (await fetch(`/__fixture/cookie?as=${value}`, { cache: "no-store" })).status, as);
const view = () => page.evaluate((edit) => { const main = document.querySelector("main"); const text = main.innerText; const body = document.querySelector("[data-protected-content]");
  const select = main.querySelector("select"); const notice = document.querySelector("[data-session-notice]"); const box = main.querySelector("input[type=checkbox]");
  return { path: location.pathname, account: document.getElementById("root")?.dataset.account ?? null,
    result: /음악 분석 · 결과|최대 정규화 RMS/.test(text), rms25: /RMS 25%/.test(text), edit: text.includes(edit) || [...document.querySelectorAll("textarea")].some((t) => t.value.includes(edit)),
    selectDom: !!select, textarea: !!main.querySelector("textarea"), selected: select ? select.selectedIndex > 0 : false, checked: !!box?.checked, checkbox: !!box,
    links: [...main.querySelectorAll("a")].map((a) => a.textContent), body: body ? { hidden: body.hidden, inert: body.inert } : null,
    sessionNotice: notice?.innerText.split("\n")[0] ?? null, domRms25: document.documentElement.outerHTML.includes("RMS 25%"),
    domEdit: document.documentElement.outerHTML.includes(edit),
    focus: document.activeElement === document.body ? "BODY" : `${document.activeElement.tagName}:${(document.activeElement.textContent || "").trim().slice(0, 18)}` }; }, EDIT);
const options = () => page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
const until = async (fn, label, tries = 60) => { for (let i = 0; i < tries; i++) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(250); } throw new Error("timeout: " + label); };
const openList = () => until(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, "list");
const runAnalysis = async () => {
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await until(() => document.activeElement?.textContent === "분석 결과", "result focus");
};
const rerun = async () => { await page.focus("loc=css:main button:has-text('다시 분석')"); await page.keyboard.press("Enter"); };
const resultOf = () => page.evaluate(() => { const main = document.querySelector("main");
  return { meta: main.innerText.match(/음악 분석 · 결과 \d+개/)?.[0] ?? null, evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()) }; });
const edit = async () => { await page.focus("loc=css:main textarea"); await page.keyboard.press("End"); await page.keyboard.type(" " + EDIT); };
const startA = async () => { await page.goto(`${origin}/__session?as=a`); await openList(); await runAnalysis(); const result = await resultOf(); await edit(); return result; };
const okA = (r) => r.meta === "음악 분석 · 결과 1개" && r.evidence.some((e) => e.includes("오디오 1채널 · 최대 정규화 RMS 25%") && /0.?125 ms/.test(e));
// focus 복귀 재확인(같은 계정). 제품은 3초 안 재확인을 건너뛰므로 간격을 둔다.
const refresh = async () => { await wait(3_300); const before = (await st()).sessionChecks; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  for (let i = 0; i < 40 && (await st()).sessionChecks === before; i++) await wait(100); await wait(400); return (await st()).sessionChecks - before; };
const broadcast = (as) => other.evaluate(async (value) => { const s = (await fetch(`/__fixture/cookie?as=${value}`, { cache: "no-store" })).status;
  const channel = new BroadcastChannel("dream-auth-session"); channel.postMessage("changed"); channel.close(); return s; }, as);
const out = { widths: [] };
let lastReload = 0;
try {
  await other.goto(`${origin}/login`);
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };

    // S0 갱신
    r.s0 = { a: await startA() };
    r.s0.checks = await refresh();
    r.s0.after = await view();
    check(okA(r.s0.a) && r.s0.checks >= 1 && r.s0.after.rms25 && r.s0.after.edit && r.s0.after.selected && r.s0.after.checked && r.s0.after.body?.hidden === false, `S0 refresh keeps state ${width}`);

    // S1 만료 → POST 401
    const e0 = await st();
    r.s1 = { cookie: await cookie("none") };
    await rerun();
    await until(() => /다시 로그인해 주세요/.test(document.querySelector("main").innerText), "S1 login notice");
    await wait(200);
    r.s1.after = await view();
    const e1 = await st();
    r.s1.counts = { unauthorized: e1.unauthorized - e0.unauthorized, reads: (e1.readsA + e1.readsB) - (e0.readsA + e0.readsB) };
    r.s1.overflow = await overflow();
    for (let i = 0; i < 40 && (await page.evaluate(() => location.pathname).catch(() => "")) !== "/login"; i++) {
      await page.evaluate(() => window.dispatchEvent(new Event("focus"))).catch(() => {}); await wait(500);
    }
    r.s1.login = await page.evaluate(() => ({ path: location.pathname, search: location.search }));
    check(r.s1.cookie === 204 && r.s1.counts.unauthorized === 1 && r.s1.counts.reads === 0, `S1 401 no read ${width}`);
    check(!r.s1.after.result && !r.s1.after.domEdit && !r.s1.after.selectDom && !r.s1.after.checkbox && !r.s1.after.textarea && r.s1.after.links.includes("다시 로그인")
      && /^DIV:다시 로그인해 주세요/.test(r.s1.after.focus) && r.s1.overflow === 0, `S1 POST 401 → login state cleared ${width}`);
    check(r.s1.login.path === "/login" && r.s1.login.search === "?next=%2F", `S1 focus recheck → login ${width}`);

    // S2 다른 탭 계정 변경 + 늦은 응답
    const since = Date.now() - lastReload; if (since < 16_000) await wait(16_000 - since);
    r.s2 = { a: await startA() };
    const h0 = await ctl("hold-next-post");
    await rerun();
    for (let i = 0; i < 100 && (await st()).held === h0.held; i++) await wait(100);
    const h1 = await st();
    await ctl("hold-session");
    r.s2.otherTab = await broadcast("b");
    await until(() => !!document.querySelector("[data-session-notice]"), "S2 checking notice");
    await wait(200);
    r.s2.checking = await view();
    await ctl("release");
    await wait(400);
    r.s2.lateArrived = await view();
    const h2 = await st();
    r.s2.held = { held: h2.held - h0.held, delivered: h2.heldDelivered - h0.heldDelivered, discarded: h2.heldDiscarded - h0.heldDiscarded };
    await ctl("release-session");
    lastReload = Date.now();
    await wait(800);
    await until(() => document.getElementById("root")?.dataset.account === "b@example.invalid", "S2 reload as B", 80);
    await openList();
    r.s2.afterReload = await view();
    r.s2.bOptions = await options();
    const h3 = await st();
    await runAnalysis();
    r.s2.b = await resultOf();
    const h4 = await st();
    r.s2.reads = { aAfterHeld: h4.readsA - h1.readsA, bBeforeExplicit: h3.readsB - h1.readsB, b: h4.readsB - h3.readsB };
    r.s2.overflow = await overflow();
    check(okA(r.s2.a) && r.s2.otherTab === 204 && r.s2.checking.body?.hidden === true && r.s2.checking.body?.inert === true && !r.s2.checking.selectDom
      && !r.s2.checking.domRms25 && !r.s2.checking.domEdit, `S2 suspect removes analysis ${width}`);
    check(r.s2.held.held === 1 && r.s2.held.delivered === 0 && r.s2.held.discarded === 1 && !r.s2.lateArrived.domRms25 && !r.s2.lateArrived.domEdit && !r.s2.lateArrived.selectDom, `S2 late A cancelled, DOM 0 ${width}`);
    check(r.s2.afterReload.account === "b@example.invalid" && JSON.stringify(r.s2.bOptions) === JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"])
      && !r.s2.afterReload.domRms25 && !r.s2.afterReload.domEdit && !r.s2.afterReload.selected && !r.s2.afterReload.checked, `S2 reload B only ${width}`);
    check(r.s2.b.meta === "음악 분석 · 결과 1개" && r.s2.b.evidence.some((e) => e.includes("RMS 12.5%") && /0.?125 ms/.test(e)), `S2 B explicit result ${width}`);
    check(r.s2.reads.aAfterHeld === 0 && r.s2.reads.bBeforeExplicit === 0 && r.s2.reads.b === 2 && r.s2.overflow === 0, `S2 reads/overflow ${width}`);

    // S3 같은 계정 신호 → same 확인 뒤 재조회, 새 선택은 확인된 상태에서만
    r.s3 = { a: await startA() };
    const g0 = await st();
    r.s3.otherTab = await broadcast("a");
    await until(() => !document.querySelector("[data-session-notice]") && !!document.querySelector("main select") && document.querySelector("main select").options.length > 1, "S3 same → re-query");
    await openList();
    await wait(200);
    r.s3.after = await view();
    const g1 = await st();
    r.s3.listGets = g1.listGets - g0.listGets;
    await runAnalysis();
    r.s3.again = await resultOf();
    r.s3.checks = await refresh();
    r.s3.kept = await view();
    const g2 = await st();
    r.s3.reads = { a: g2.readsA - g0.readsA, b: g2.readsB - g0.readsB };
    check(okA(r.s3.a) && r.s3.otherTab === 204 && r.s3.listGets >= 1 && !r.s3.after.result && !r.s3.after.domEdit && !r.s3.after.selected && !r.s3.after.checked
      && /^SELECT:/.test(r.s3.after.focus), `S3 same-account signal re-query clears ${width}`);
    check(okA(r.s3.again) && r.s3.checks >= 1 && r.s3.kept.rms25 && r.s3.kept.selected && r.s3.kept.checked && r.s3.reads.a === 2 && r.s3.reads.b === 0, `S3 new selection kept when confirmed ${width}`);

    // S4 신호 없는 쿠키 교체(회귀)
    r.s4 = { a: await startA() };
    const c0 = await st();
    r.s4.cookie = await cookie("b");
    await rerun();
    await until(() => /선택한 자료에 접근할 수 없어요/.test(document.querySelector("main").innerText), "S4 revoked notice");
    await openList();
    await wait(200);
    r.s4.after = await view();
    r.s4.options = await options();
    const c1 = await st();
    r.s4.counts = { su: c1.sourceUnavailable - c0.sourceUnavailable, reads: (c1.readsA + c1.readsB) - (c0.readsA + c0.readsB) };
    r.s4.overflow = await overflow();
    check(okA(r.s4.a) && r.s4.cookie === 204 && r.s4.counts.su === 1 && r.s4.counts.reads === 0, `S4 su no read ${width}`);
    check(JSON.stringify(r.s4.options) === JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"]) && !r.s4.after.result && !r.s4.after.domEdit
      && !r.s4.after.textarea && !r.s4.after.selected && !r.s4.after.checked && r.s4.overflow === 0, `S4 re-query clears A ${width}`);
    out.widths.push(r);
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 200));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await ctl("release").catch(() => {}); await ctl("release-session").catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
