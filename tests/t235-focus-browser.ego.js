/* eslint-disable -- ego lite 런타임 전용 스크립트(브라우저·ego 전역 사용) */
// T-235 test-only 브라우저 하네스(ego lite 'ego-browser nodejs < 이 파일'). vitest 대상 아님.
// 사용: T213 하네스 --hold로 합성 서비스를 띄운 뒤 아래 ROOT(tmp/t213-http-*)와 TAG를 바꿔 실행. 결과 tmp/t235-<TAG>.json.
// 같은 127.0.0.1 쿠키를 쓰므로 다른 합성 서비스 브라우저 검증과 동시에 돌리지 않는다.
const fs = await import("node:fs");
const ROOT = "D:/starwork/dream-ai-studio/tmp/t213-http-REPLACE", TAG = "run";
const hold = JSON.parse(fs.readFileSync(ROOT + "/hold.json", "utf8"));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const task = await taskSpace("T235 focus " + TAG); const p = await task.newPage();
const r = { root: ROOT, base: fs.readFileSync(ROOT + "/base.txt", "utf8").trim(), build: fs.readFileSync(ROOT + "/app/.next/BUILD_ID", "utf8").trim(), s: {} };
const D = `const d = (e) => e ? (e.tagName + (e.getAttribute("href") ? "[" + e.getAttribute("href") + "]" : "") + (e.hasAttribute("data-session-notice") ? "[notice]" : "") + (e.tagName === "BUTTON" ? "[" + e.innerText.trim() + "]" : "")) : null;`;
const setup = () => p.evaluate(`(() => { ${D} window.__body = document.querySelector("[data-protected-content]"); window.__f = window.fetch.bind(window); window.__pending = []; window.__pass = false;
  window.fetch = (u, o) => (!window.__pass && String(u?.url ?? u).includes("/api/auth/session")) ? new Promise((res, rej) => window.__pending.push({ u, o, res, rej })) : window.__f(u, o);
  window.__releaseReal = () => window.__pending.splice(0).forEach(x => window.__f(x.u, x.o).then(x.res, x.rej));
  window.__releaseWith = (status, body) => window.__pending.splice(0).forEach(x => x.res(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  window.__signal = () => { const c = new BroadcastChannel("dream-auth-session"); c.postMessage("changed"); c.close(); }; })()`);
const state = () => p.evaluate(`(() => { ${D} const b = document.querySelector("[data-protected-content]"); return { active: d(document.activeElement), body: b ? (b.hidden ? "hidden" : "shown") : "removed", sameBody: b === window.__body, inert: !!b?.inert, notice: document.querySelector("[data-session-notice]")?.innerText.replace(/\s+/g, " ").slice(0, 30) ?? null, scrollY: Math.round(scrollY), sel: String(getSelection()), hasFocus: document.hasFocus() }; })()`);
const until = async (js, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await p.evaluate(js)) return true; await wait(100); } return false; };
const frames = () => p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));
const fresh = async () => { await p.goto(hold.baseUrl + "/cloud/manage"); await p.waitForSelector("main dl"); await wait(600); await setup(); };
const hide = async () => { await p.evaluate("window.__signal()"); await until(`document.querySelector("[data-protected-content]")?.hidden && window.__pending.length > 0`); return state(); };
const back = async () => { await until(`(window.__releaseReal(), document.querySelector("[data-protected-content]")?.hidden === false)`); await frames(); return state(); };
try {
  await p.goto(hold.baseUrl + "/auth/callback?token_hash=A&type=recovery&next=%2Fcloud%2Fmanage"); await wait(2500);
  for (const width of [1280, 390]) {
    await p.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
    // S1 같은 계정 2번 연속(같은 문서)
    await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0");
    const s1 = { before: await state() }; s1.hidden1 = await hide(); await p.evaluate("window.__releaseReal()"); s1.after1 = await back();
    s1.hidden2 = await hide(); await p.evaluate("window.__releaseReal()"); s1.after2 = await back(); r.s["same2-" + width] = s1;
  }
  await p.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 500, deviceScaleFactor: 1, mobile: true });
  // S2 키보드 Tab 도달 + 스크롤 위치
  await fresh(); await p.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  for (let i = 0; i < 8; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(() => document.activeElement?.innerText?.includes("내 프로젝트 보기"))) break; }
  await p.evaluate(() => scrollTo(0, 260)); const s2 = { before: await state() }; s2.hidden = await hide(); await p.evaluate("window.__releaseReal()"); s2.after = await back();
  await p.keyboard.press("Tab"); s2.nextTab = (await state()).active; r.s.keyboardScroll = s2;
  await p.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // S3 글자 선택(포커스 컨트롤 없음): 포커스를 만들지 않고 선택 유지
  await fresh(); await p.evaluate(() => { document.activeElement?.blur(); const t = [...document.querySelectorAll("main p")].find(e => e.innerText.includes("이번에 불러온")); const g = document.createRange(); g.selectNodeContents(t); getSelection().removeAllRanges(); getSelection().addRange(g); });
  const s3 = { before: await state() }; s3.hidden = await hide(); await p.evaluate("window.__releaseReal()"); s3.after = await back(); r.s.selection = s3;
  // S4 가린 동안 다른 의미 있는 컨트롤(헤더 로그아웃)로 옮김 → 빼앗지 않음
  await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0"); const s4 = { hidden: await hide() };
  await p.evaluate(() => [...document.querySelectorAll("header button")].find(b => b.innerText.includes("로그아웃"))?.focus()); s4.moved = await state();
  await p.evaluate("window.__releaseReal()"); s4.after = await back(); r.s.movedElsewhere = s4;
  // S5 가린 동안 대상이 사라짐 → 오류 없이 다른 곳으로 강제 이동 없음
  await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0"); const s5 = { hidden: await hide() };
  await p.evaluate(() => document.querySelector("main a[href='/cloud/manage']")?.remove()); await p.evaluate("window.__releaseReal()"); s5.after = await back(); r.s.targetRemoved = s5;
  // S6 확인 실패(unavailable) → 다시 확인 → same: 원래 링크로 복귀
  await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0"); const s6 = { hidden: await hide() };
  await p.evaluate("window.__releaseWith(500, {})"); await until(`(window.__pending.length && window.__releaseWith(500, {}), !!document.querySelector("[data-session-notice] button"))`); s6.unavailable = await state();
  s6.noticeHtml = await p.evaluate(() => document.querySelector("[data-session-notice]")?.innerText.replace(/\s+/g, " ") ?? null);
  await p.evaluate("window.__pass = true"); await p.click("[data-session-notice] button"); s6.after = await back(); r.s.retry = s6;
  // S7 계정 변경 확정(재로드 제한 → stale) 뒤 늦은 same: 본문 다시 살리지 않음
  await fresh(); await p.evaluate(() => sessionStorage.setItem("dream-auth-session-reloaded", String(Date.now()))); await p.focus("main a[href='/cloud/manage'] >> nth=0");
  const s7 = { hidden: await hide() }; await p.evaluate(`window.__releaseWith(200, { state: "changed" })`); await until(`!document.querySelector("[data-protected-content]")`); s7.cleared = await state();
  await p.evaluate("window.__signal()"); for (let i = 0; i < 15; i++) { await wait(100); await p.evaluate("window.__releaseReal()"); } await wait(1000); await frames(); s7.lateSame = await state(); r.s.clearedLateSame = s7;
  await p.evaluate(() => sessionStorage.removeItem("dream-auth-session-reloaded"));
} catch (e) { r.ERR = e.message.slice(0, 400); }
fs.writeFileSync("D:/starwork/dream-ai-studio/tmp/t235-" + TAG + ".json", JSON.stringify(r, null, 1));
await task.finish({ keep: [] }); console.log("done " + TAG);
