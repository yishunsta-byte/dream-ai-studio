/* global taskSpace, fetch, document, window, location, localStorage, sessionStorage, BroadcastChannel, setTimeout, console, Event */
// 등록 PCM WAV · 같은 문서 세션 경계(SessionBoundary → ProtectedContent → 보호 목록 화면), 폭 390·1440
//  S1 만료: 문서 유지·쿠키 삭제 → '다시 분석' POST 401 처리 → focus 복귀 재확인 → 로그인 이동
//  S2 다른 탭 계정 변경: 붙잡힌 A 재분석 + 세션 확인 붙잡기 → 다른 탭 신호 → 의심(가림·inert) 중 늦은 A 응답 도착 → 변경 확정 → 다시 받기 → B만
//  S3 신호 없는 쿠키 교체: 문서 유지·쿠키 B → A 선택으로 '다시 분석' → source_unavailable → 목록 재조회(B) · 이전 결과/초안 제거
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/registered-pcm-wav-session-boundary.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const EDIT = "A가 고친 초안 문장";
const task = await taskSpace("registered wav session boundary");
const page = task.page("p1");
const other = await task.newPage();
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cookie = (as) => page.evaluate(async (value) => (await fetch(`/__fixture/cookie?as=${value}`, { cache: "no-store" })).status, as);
// 보이는 화면 기준 흔적(가려진 본문은 innerText에서 빠진다) + 보호 본문 상태
const view = () => page.evaluate((edit) => { const main = document.querySelector("main"); const text = main.innerText; const body = document.querySelector("[data-protected-content]");
  const select = main.querySelector("select"); const notice = document.querySelector("[data-session-notice]");
  return { path: location.pathname, account: document.getElementById("root")?.dataset.account ?? null,
    result: /음악 분석 · 결과|최대 정규화 RMS/.test(text), rms25: /RMS 25%/.test(text), edit: text.includes(edit) || [...document.querySelectorAll("textarea")].some((t) => !t.closest("[hidden]") && t.value.includes(edit)),
    textarea: !!main.querySelector("textarea:not([hidden] textarea)"), selected: select && !select.closest("[hidden]") ? select.selectedIndex > 0 : false,
    checked: !!main.querySelector("input[type=checkbox]:checked") && !main.querySelector("input[type=checkbox]:checked").closest("[hidden]"),
    body: body ? { hidden: body.hidden, inert: body.inert } : null, sessionNotice: notice?.innerText.split("\n")[0] ?? null,
    domRms25: document.documentElement.outerHTML.includes("RMS 25%"),
    focus: document.activeElement === document.body ? "BODY" : `${document.activeElement.tagName}:${(document.activeElement.textContent || "").trim().slice(0, 18)}`,
    storage: sessionStorage.length + localStorage.length, storageKeys: [...Object.keys(sessionStorage), ...Object.keys(localStorage)] }; }, EDIT);
const options = () => page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
const openList = async () => {
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }).catch(() => false);
    if (ok) return; await wait(250);
  }
  throw new Error("list did not load");
};
const until = async (fn, label, tries = 60) => { for (let i = 0; i < tries; i++) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(250); } throw new Error("timeout: " + label); };
const runAnalysis = async () => {
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await until(() => document.activeElement?.textContent === "분석 결과", "result focus");
};
const rerun = async () => { await page.focus("loc=css:main button:has-text('다시 분석')"); await page.keyboard.press("Enter"); };
const resultOf = () => page.evaluate(() => { const main = document.querySelector("main");
  return { meta: main.innerText.match(/음악 분석 · 결과 \d+개/)?.[0] ?? null, evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()) }; });
const startA = async () => {
  await page.goto(`${origin}/__session?as=a`);
  await openList(); await runAnalysis();
  const result = await resultOf();
  await page.focus("loc=css:main textarea"); await page.keyboard.press("End"); await page.keyboard.type(" " + EDIT);
  return result;
};
const okA = (r) => r.meta === "음악 분석 · 결과 1개" && r.evidence.some((e) => e.includes("오디오 1채널 · 최대 정규화 RMS 25%") && /0.?125 ms/.test(e));
const out = { widths: [] };
let lastReload = 0;
try {
  await other.goto(`${origin}/login`);
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };

    // S1 만료: 문서 유지 쿠키 삭제 → POST 401 → focus 복귀 재확인 → 로그인 이동
    r.s1 = { a: await startA() };
    check(okA(r.s1.a), `S1 A result ${width}`);
    const e0 = await st();
    r.s1.cookie = await cookie("none");
    await rerun();
    await until(() => !/등록 자료를 분석하고 있어요/.test(document.querySelector("main").innerText), "S1 rerun settled");
    await wait(200);
    r.s1.after401 = await view();
    r.s1.notice401 = await page.evaluate(() => [...document.querySelectorAll("main [role=status], main [aria-live]")].map((n) => n.textContent.trim()).filter(Boolean).slice(0, 3));
    const e1 = await st();
    r.s1.counts = { unauthorized: e1.unauthorized - e0.unauthorized, reads: (e1.readsA + e1.readsB) - (e0.readsA + e0.readsB) };
    for (let i = 0; i < 40 && (await page.evaluate(() => location.pathname).catch(() => "")) !== "/login"; i++) {
      await page.evaluate(() => window.dispatchEvent(new Event("focus"))).catch(() => {}); await wait(500);
    }
    r.s1.login = await page.evaluate(() => ({ path: location.pathname, search: location.search, text: document.querySelector("main")?.innerText ?? "" }));
    check(r.s1.cookie === 204 && r.s1.counts.unauthorized === 1 && r.s1.counts.reads === 0, `S1 401 no read ${width}`);
    check(!r.s1.after401.result && !r.s1.after401.rms25, `S1 previous result removed after 401 ${width}`);
    check(r.s1.login.path === "/login" && r.s1.login.search === "?next=%2F", `S1 focus recheck → login ${width}`);

    // S2 다른 탭 계정 변경 + 늦은 응답
    const since = Date.now() - lastReload; if (since < 16_000) await wait(16_000 - since);
    r.s2 = { a: await startA() };
    check(okA(r.s2.a), `S2 A result ${width}`);
    const h0 = await ctl("hold-next-post");
    await rerun();
    for (let i = 0; i < 100 && (await st()).held === h0.held; i++) await wait(100);
    const h1 = await st();
    await ctl("hold-session");
    r.s2.otherTab = await other.evaluate(async () => { const s = (await fetch("/__fixture/cookie?as=b", { cache: "no-store" })).status;
      const channel = new BroadcastChannel("dream-auth-session"); channel.postMessage("changed"); channel.close(); return s; });
    await until(() => !!document.querySelector("[data-session-notice]"), "S2 checking notice");
    r.s2.checking = await view();
    await ctl("release");
    await wait(400);
    r.s2.lateArrived = await view();
    const h2 = await st();
    r.s2.held = { held: h2.held - h0.held, delivered: h2.heldDelivered - h0.heldDelivered, sessionHeld: h2.sessionHeld - h0.sessionHeld };
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
    check(r.s2.otherTab === 204 && r.s2.checking.body?.hidden === true && r.s2.checking.body?.inert === true && !r.s2.checking.rms25 && !r.s2.checking.edit
      && /로그인 상태를 확인하고 있어요/.test(r.s2.checking.sessionNotice ?? ""), `S2 suspect hides body ${width}`);
    check(r.s2.held.held === 1 && r.s2.held.delivered === 1 && r.s2.lateArrived.body?.hidden === true && r.s2.lateArrived.body?.inert === true
      && !r.s2.lateArrived.rms25 && !r.s2.lateArrived.edit, `S2 late A response stays hidden ${width}`);
    check(r.s2.afterReload.account === "b@example.invalid" && JSON.stringify(r.s2.bOptions) === JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"])
      && !r.s2.afterReload.result && !r.s2.afterReload.domRms25 && !r.s2.afterReload.edit && !r.s2.afterReload.selected && !r.s2.afterReload.checked, `S2 reload B only ${width}`);
    check(r.s2.b.meta === "음악 분석 · 결과 1개" && r.s2.b.evidence.some((e) => e.includes("RMS 12.5%") && /0.?125 ms/.test(e)), `S2 B explicit result ${width}`);
    check(r.s2.reads.aAfterHeld === 0 && r.s2.reads.bBeforeExplicit === 0 && r.s2.reads.b === 2 && r.s2.overflow === 0, `S2 reads/overflow ${width}`);

    // S3 신호 없는 쿠키 교체 → 기존 경계(source_unavailable)로 목록 재조회
    r.s3 = { a: await startA() };
    check(okA(r.s3.a), `S3 A result ${width}`);
    const c0 = await st();
    r.s3.cookie = await cookie("b");
    await rerun();
    await until(() => /선택한 자료에 접근할 수 없어요/.test(document.querySelector("main").innerText), "S3 revoked notice");
    await openList();
    await wait(200);
    r.s3.after = await view();
    r.s3.options = await options();
    r.s3.list = JSON.parse((await page.fetch("/api/studio/reference-analysis/materials")).body).materials.length;
    const c1 = await st();
    r.s3.counts = { su: c1.sourceUnavailable - c0.sourceUnavailable, reads: (c1.readsA + c1.readsB) - (c0.readsA + c0.readsB) };
    r.s3.overflow = await overflow();
    check(r.s3.cookie === 204 && r.s3.counts.su === 1 && r.s3.counts.reads === 0, `S3 su no read ${width}`);
    check(JSON.stringify(r.s3.options) === JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"]) && r.s3.list === 1
      && !r.s3.after.result && !r.s3.after.edit && !r.s3.after.textarea && !r.s3.after.selected && !r.s3.after.checked && r.s3.overflow === 0, `S3 re-query clears A ${width}`);
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
