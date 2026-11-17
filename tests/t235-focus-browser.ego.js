/* eslint-disable -- ego lite 런타임 전용 스크립트(브라우저·ego 전역 사용) */
// T-235/T-237 test-only 브라우저 하네스. vitest 대상이 아니에요. 실행: `ego-browser nodejs < tests/t235-focus-browser.ego.js`
// 준비: `node tests/t213-cross-tab-session-http.mjs --bin … --openssl … --hold`로 합성 서비스를 띄우고
//       tmp/t235-target.json 에 {"root":"D:/…/tmp/t213-http-<id>","tag":"<이름>"} 을 써 둡니다(ego 실행기는 셸 환경변수를 받지 않아요).
// 결과: tmp/t235-<tag>.json. 기대값 하나라도 어긋나거나 중간 오류가 나면 "T235 FAILED"를 출력하고 종료 코드 1로 끝나요(JSON에 ok:false).
// 같은 127.0.0.1 쿠키를 쓰므로 다른 합성 서비스 브라우저 검증과 동시에 돌리지 않아요.
const fs = await import("node:fs");
const REPO = "D:/starwork/dream-ai-studio";
const target = JSON.parse(fs.readFileSync(REPO + "/tmp/t235-target.json", "utf8"));
const ROOT = target.root, TAG = target.tag;
const hold = JSON.parse(fs.readFileSync(ROOT + "/hold.json", "utf8"));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const r = { root: ROOT, base: fs.readFileSync(ROOT + "/base.txt", "utf8").trim(), build: fs.readFileSync(ROOT + "/app/.next/BUILD_ID", "utf8").trim(), s: {}, failures: [] };
const expect = (name, ok, detail) => { if (!ok) r.failures.push(`${name}: ${JSON.stringify(detail)}`); };
const D = `const d = (e) => e ? (e.tagName + (e.getAttribute("href") ? "[" + e.getAttribute("href") + "]" : "") + (e.hasAttribute("data-session-notice") ? "[notice]" : "") + (e.tagName === "BUTTON" ? "[" + e.innerText.trim() + "]" : "")) : null;`;
const task = await taskSpace("T235 focus " + TAG); const p = await task.newPage();
// 세션 확인 요청(/api/auth/session)을 모두 붙잡아 두는 관문. 요청마다 몇 번째인지 센다.
const setup = () => p.evaluate(`(() => { ${D} window.__body = document.querySelector("[data-protected-content]"); window.__f = window.fetch.bind(window); window.__pending = []; window.__made = 0;
  window.fetch = (u, o) => String(u?.url ?? u).includes("/api/auth/session") ? (window.__made++, new Promise((res, rej) => window.__pending.push({ u, o, res, rej }))) : window.__f(u, o);
  window.__releaseReal = () => window.__pending.splice(0).forEach(x => window.__f(x.u, x.o).then(x.res, x.rej));
  window.__releaseWith = (status, body) => window.__pending.splice(0).forEach(x => x.res(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  window.__signal = () => { const c = new BroadcastChannel("dream-auth-session"); c.postMessage("changed"); c.close(); }; })()`);
const state = () => p.evaluate(`(() => { ${D} const b = document.querySelector("[data-protected-content]"); const a = document.activeElement; const box = a && a !== document.body ? a.getBoundingClientRect() : null;
  return { active: d(a), activeInView: box ? box.bottom <= innerHeight + 1 && box.top >= -1 : null, body: b ? (b.hidden ? "hidden" : "shown") : "removed", sameBody: b === window.__body, inert: !!b?.inert,
    notice: document.querySelector("[data-session-notice]")?.innerText.replace(/\\s+/g, " ").slice(0, 40) ?? null, scrollY: Math.round(scrollY), sel: String(getSelection()), hasFocus: document.hasFocus(), pending: window.__pending.length, made: window.__made }; })()`);
const until = async (js, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await p.evaluate(js)) return true; await wait(100); } return false; };
const frames = () => p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));
const fresh = async () => { await p.goto(hold.baseUrl + "/cloud/manage"); await p.waitForSelector("main dl"); await wait(600); await setup(); };
const hide = async () => { await p.evaluate("window.__signal()"); if (!await until(`document.querySelector("[data-protected-content]")?.hidden && window.__pending.length > 0`)) throw new Error("hide: 본문이 가려지지 않음"); return state(); };
// 같은 계정 복귀: 쌓인 확인 요청을 실제 서버로 계속 보내며(자동 재확인 포함) 본문이 다시 보일 때까지
const back = async () => { if (!await until(`(window.__releaseReal(), document.querySelector("[data-protected-content]")?.hidden === false)`)) throw new Error("back: 본문이 돌아오지 않음"); await frames(); return state(); };
const A = "A[/cloud/manage]";
try {
  await p.goto(hold.baseUrl + "/auth/callback?token_hash=A&type=recovery&next=%2Fcloud%2Fmanage"); await wait(2500);
  for (const width of [1280, 390]) {
    await p.cdp("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
    // S1 같은 계정 2번 연속(같은 문서)
    await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0");
    const s = { before: await state() }; s.hidden1 = await hide(); s.after1 = await back(); s.hidden2 = await hide(); s.after2 = await back(); r.s["same2-" + width] = s;
    expect(`same2-${width}`, s.before.active === A && s.hidden1.active === "DIV[notice]" && s.hidden1.inert && s.after1.active === A && s.hidden2.active === "DIV[notice]" && s.after2.active === A && s.after2.sameBody && s.after2.body === "shown",
      [s.before.active, s.hidden1.active, s.after1.active, s.hidden2.active, s.after2.active, s.after2.sameBody]);
  }
  // S2 키보드 Tab 도달 + 스크롤: 돌려준 포커스가 화면 안
  await p.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 500, deviceScaleFactor: 1, mobile: true });
  await fresh(); await p.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  for (let i = 0; i < 8; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(() => document.activeElement?.innerText?.includes("내 프로젝트 보기"))) break; }
  await p.evaluate(() => scrollTo(0, 260)); const s2 = { before: await state() }; s2.hidden = await hide(); s2.after = await back(); r.s.keyboardScroll = s2;
  expect("keyboardScroll", s2.before.active === "A[/cloud/projects]" && s2.after.active === s2.before.active && s2.after.activeInView === true, [s2.before.active, s2.after.active, s2.after.activeInView, s2.after.scrollY]);
  await p.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // S3 글자 선택(포커스 컨트롤 없음): 선택 유지, 포커스를 만들지 않음
  await fresh(); await p.evaluate(() => { document.activeElement?.blur(); const t = [...document.querySelectorAll("main p")].find(e => e.innerText.includes("이번에 불러온")); const g = document.createRange(); g.selectNodeContents(t); getSelection().removeAllRanges(); getSelection().addRange(g); });
  const s3 = { before: await state() }; s3.hidden = await hide(); s3.after = await back(); r.s.selection = s3;
  expect("selection", s3.before.sel.length > 0 && s3.after.sel === s3.before.sel && s3.after.active === "BODY", [s3.before.sel, s3.after.sel, s3.after.active]);
  // S4 가린 동안 다른 의미 있는 컨트롤(헤더 로그아웃)로 옮김 → 빼앗지 않음
  await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0"); const s4 = { hidden: await hide() };
  await p.evaluate(() => [...document.querySelectorAll("header button")].find(b => b.innerText.includes("로그아웃"))?.focus()); s4.moved = await state(); s4.after = await back(); r.s.movedElsewhere = s4;
  expect("movedElsewhere", s4.moved.active === "BUTTON[로그아웃]" && s4.after.active === "BUTTON[로그아웃]" && s4.after.body === "shown", [s4.moved.active, s4.after.active]);
  // S5 가린 동안 대상이 사라짐 → 오류 없이 강제 이동 없음
  await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0"); const s5 = { hidden: await hide() };
  await p.evaluate(() => document.querySelector("main a[href='/cloud/manage']")?.remove()); s5.after = await back(); r.s.targetRemoved = s5;
  expect("targetRemoved", s5.after.body === "shown" && s5.after.active === "BODY", [s5.after.body, s5.after.active]);
  // S6 확인 실패(500) → 안내의 "다시 확인" 버튼을 실제로 눌러 생긴 요청만 same으로 통과 → 원래 링크로 복귀
  //    관문은 버튼을 누르기 전까지 풀지 않는다. 자동 재확인 요청은 계속 500으로 돌려보내 unavailable을 유지하고, 조용해진 뒤 누른다.
  await fresh(); await p.focus("main a[href='/cloud/manage'] >> nth=0"); const s6 = { hidden: await hide() };
  const noticeRetry = `[...document.querySelectorAll("[data-session-notice] button")].find(b => b.innerText.trim() === "다시 확인")`;
  if (!await until(`(window.__pending.length && window.__releaseWith(500, {}), !!(${noticeRetry}))`)) throw new Error("retry: 안내의 다시 확인 버튼이 나오지 않음");
  let quiet = 0; for (let i = 0; i < 40 && quiet < 5; i++) { await wait(100); const n = await p.evaluate("window.__pending.length"); if (n) { await p.evaluate("window.__releaseWith(500, {})"); quiet = 0; } else quiet++; }
  s6.unavailable = await state();
  if (!await p.evaluate(`!!(${noticeRetry})`)) throw new Error("retry: 누르기 직전 버튼이 사라짐(자동 재확인 경합)");
  const madeBefore = s6.unavailable.made; await p.evaluate(`(${noticeRetry}).click()`);
  if (!await until(`window.__made > ${madeBefore} && window.__pending.length > 0`)) throw new Error("retry: 버튼을 눌러도 확인 요청이 생기지 않음");
  s6.requestsFromClick = (await state()).made - madeBefore; s6.after = await back(); r.s.retry = s6;
  expect("retry", s6.unavailable.body === "hidden" && s6.unavailable.inert && /확인하지 못했어요/.test(s6.unavailable.notice ?? "") && s6.requestsFromClick >= 1 && s6.after.active === A && s6.after.body === "shown",
    [s6.unavailable.notice, s6.requestsFromClick, s6.after.active]);
  // S7 계정 변경 확정(재로드 제한 → stale) 뒤 늦은 same: 본문을 다시 살리지 않음
  await fresh(); await p.evaluate(() => sessionStorage.setItem("dream-auth-session-reloaded", String(Date.now()))); await p.focus("main a[href='/cloud/manage'] >> nth=0");
  const s7 = { hidden: await hide() }; await p.evaluate(`window.__releaseWith(200, { state: "changed" })`);
  if (!await until(`!document.querySelector("[data-protected-content]")`)) throw new Error("cleared: 본문이 제거되지 않음");
  s7.cleared = await state(); await p.evaluate("window.__signal()"); for (let i = 0; i < 15; i++) { await wait(100); await p.evaluate("window.__releaseReal()"); } await wait(1000); await frames(); s7.lateSame = await state(); r.s.clearedLateSame = s7;
  await p.evaluate(() => sessionStorage.removeItem("dream-auth-session-reloaded"));
  expect("clearedLateSame", s7.cleared.body === "removed" && s7.lateSame.body === "removed" && s7.lateSame.active !== A, [s7.cleared.body, s7.lateSame.body, s7.lateSame.active]);
  // 44px 링크 회귀(목록·관리, 1280/390)
  for (const width of [1280, 390]) {
    await p.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    for (const path of ["/cloud/projects", "/cloud/manage"]) {
      await p.goto(hold.baseUrl + path); await p.waitForSelector("h1"); await wait(400);
      const m = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, links: [...document.querySelectorAll("main a")].filter(a => a.getAttribute("href") === "/cloud/manage" || a.closest("nav")).map(a => ({ text: a.innerText.trim(), h: +a.getBoundingClientRect().height.toFixed(2) })) }));
      r.s[`links-${path}-${width}`] = m;
      expect(`links-${path}-${width}`, m.links.length > 0 && m.links.every(l => l.h >= 44) && m.overflow <= 0, m);
    }
  }
  await p.cdp("Emulation.clearDeviceMetricsOverride");
} catch (e) { r.ERR = e.message.slice(0, 400); r.failures.push("ERR: " + r.ERR); }
r.ok = r.failures.length === 0;
fs.writeFileSync(REPO + "/tmp/t235-" + TAG + ".json", JSON.stringify(r, null, 1));
await task.finish({ keep: [] });
if (!r.ok) { console.log("T235 FAILED " + TAG + "\n" + r.failures.join("\n")); process.exitCode = 1; }
else console.log("T235 PASS " + TAG + " base=" + r.base + " build=" + r.build);
