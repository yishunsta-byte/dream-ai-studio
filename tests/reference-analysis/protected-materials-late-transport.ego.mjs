/* global taskSpace, fetch, document, window, setTimeout, console */
// 보호 목록 화면 · 취소 뒤에도 성공을 돌려주는 목록 전송(시험 대역)과 세션 경계 세대, 폭 390·1440
//  N  정상: 첫 목록 요청 성공 → 자료 2개, 첫 초점 BODY → 선택·권리 확인
//  G1 늦은 성공이 새 결과 뒤: 의심(epoch+1) → current → 요청#2 → 의심(epoch+1, #2 취소) → current → 요청#3 성공(자료 1개) → 취소된 #2에 성공 반환
//  G2 늦은 성공이 새 결과 앞: 같은 방식으로 #4 취소 → #5 요청 → 취소된 #4에 먼저 성공 반환(불러오는 중 유지) → #5 성공
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/protected-materials-late-transport.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const guid = (n) => `10000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const asset = (n) => `10000000-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`;
const OLD = [{ projectId: guid(11), assetId: asset(12), label: "이전 자료 하나" }, { projectId: guid(21), assetId: asset(22), label: "이전 자료 둘" }];
const NEW = [{ projectId: guid(31), assetId: asset(32), label: "새 자료" }];
const task = await taskSpace("protected materials late transport");
const page = task.page("p1");
const fx = (expr, arg) => (arg === undefined ? page.evaluate(expr) : page.evaluate(expr, arg));
const requests = () => fx(() => window.__fixture.requests());
const setBoundary = (view, epoch) => fx((v) => window.__fixture.setBoundary(v), { view, epoch });
const resolve = (id, materials) => fx((v) => window.__fixture.resolve(v.id, v.materials), { id, materials });
const view = () => fx(() => { const main = document.querySelector("main"); const select = main.querySelector("select"); const box = main.querySelector("input[type=checkbox]");
  return { options: select ? [...select.options].map((o) => o.textContent) : null, selected: select ? select.selectedIndex > 0 : false, checked: !!box?.checked,
    loading: /등록 자료 목록을 불러오고 있어요/.test(main.innerText), failed: /등록 자료를 불러오지 못했어요/.test(main.innerText),
    leaked: ["이전 자료", "새 자료", "0000000012", "0000000032"].filter((s) => document.documentElement.outerHTML.includes(s)),
    focus: document.activeElement === document.body ? "BODY" : `${document.activeElement.tagName}:${(document.activeElement.textContent || "").trim().slice(0, 18)}` }; });
const until = async (fn, label, tries = 40) => { for (let i = 0; i < tries; i++) { if (await fx(fn).catch(() => false)) return; await wait(100); } throw new Error("timeout: " + label); };
const untilRequests = async (n, label) => { for (let i = 0; i < 40; i++) { if ((await requests()).length === n) return; await wait(100); } throw new Error("timeout: " + label); };
const opts2 = JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"]);
const opts3 = JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1", "등록 자료 2"]);
// 의심 → current로 새 목록 요청을 하나 만들고, 다시 의심 → current로 그 요청을 이전 세대로 만든다.
async function staleThenFresh(epoch, staleId) {
  await setBoundary("checking", epoch); await wait(150);
  await setBoundary("current", epoch); await untilRequests(staleId, `request ${staleId}`);
  await setBoundary("checking", epoch + 1); await wait(150);
  await setBoundary("current", epoch + 1); await untilRequests(staleId + 1, `request ${staleId + 1}`);
  await wait(150);
}
const out = { widths: [] };
try {
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await page.goto(`${origin}/`);
    await until(() => !!window.__fixture && window.__fixture.requests().length === 1, "first request");
    const r = { width };

    // N 정상
    r.n = { pending: await view() };
    await resolve(1, OLD);
    await until(() => document.querySelectorAll("main option").length === 3, "N list");
    r.n.ready = await view();
    await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab"); await page.keyboard.press("Space");
    r.n.selected = await view();
    check(r.n.pending.loading && JSON.stringify(r.n.ready.options) === opts3 && r.n.ready.focus === "BODY" && r.n.ready.leaked.length === 0
      && r.n.selected.selected && r.n.selected.checked, `N normal ${width}`);

    // G1 늦은 성공이 새 결과 뒤
    await staleThenFresh(1, 2);
    r.g1 = { requests: await requests(), whileFresh: await view() };
    await resolve(3, NEW);
    await until(() => document.querySelectorAll("main option").length === 2, "G1 fresh list");
    r.g1.fresh = await view();
    await resolve(2, OLD);
    await wait(400);
    r.g1.afterStale = await view();
    r.g1.after = await requests();
    check(r.g1.requests[1].aborted && !r.g1.requests[2].aborted && r.g1.whileFresh.loading && !r.g1.whileFresh.selected, `G1 stale aborted ${width}`);
    check(JSON.stringify(r.g1.fresh.options) === opts2 && !r.g1.fresh.selected && !r.g1.fresh.checked, `G1 fresh list only ${width}`);
    check(r.g1.after[1].settled && r.g1.after[1].bodyRead === 1 && JSON.stringify(r.g1.afterStale.options) === opts2 && !r.g1.afterStale.selected
      && !r.g1.afterStale.checked && !r.g1.afterStale.failed && r.g1.afterStale.leaked.length === 0 && r.g1.after.length === 3, `G1 late success not shown ${width}`);

    // G2 늦은 성공이 새 결과 앞
    await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Tab"); await page.keyboard.press("Space");
    r.g2 = { before: await view() };
    await staleThenFresh(3, 4);
    r.g2.requests = await requests();
    await resolve(4, OLD);
    await wait(400);
    r.g2.afterStale = await view();
    await resolve(5, NEW);
    await until(() => document.querySelectorAll("main option").length === 2, "G2 fresh list");
    r.g2.fresh = await view();
    r.g2.after = await requests();
    check(r.g2.before.selected && r.g2.before.checked && r.g2.requests[3].aborted && !r.g2.requests[4].aborted, `G2 stale aborted ${width}`);
    check(r.g2.after[3].bodyRead === 1 && r.g2.afterStale.loading && r.g2.afterStale.options === null && !r.g2.afterStale.failed, `G2 late success keeps loading ${width}`);
    check(JSON.stringify(r.g2.fresh.options) === opts2 && !r.g2.fresh.selected && !r.g2.fresh.checked && !r.g2.fresh.failed && r.g2.fresh.leaked.length === 0
      && r.g2.after.length === 5, `G2 fresh list only ${width}`);
    out.widths.push(r);
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 200));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
