/* global taskSpace, window, document, console, setTimeout, location, FocusEvent, sessionStorage, getComputedStyle */
import assert from "node:assert/strict";
// P1-06 원본 Style DNA v1.39 전체 화면(/admin/style-dna 본문, admin-hub-fixture-run.mjs ?page=style-dna 루프백 대역).
// 1. 첫 화면 = 원본 보관함(격자 640px 이상 2열·1280px 이상 3열), 기존 허브의 이미지 요약 칸·작업실 머리·단계 탭 없음. 원본 사이드바(768px 이상 256px 고정): 브랜드(이미지 스타일 분석기·v1.39·DNA LAB),
//    보관함(현재), '작업 워크플로우' 1~3 번호와 설명, 매뉴얼·API키등록 링크(허브 칸), 로그인 계정(공통 계정 메뉴·로그아웃).
// 2. 분석 전 2·3단계 → 원본 NeedAnalysis 안내('먼저 1단계…')와 '1단계 이미지 분석으로 이동'·'보관함에서 불러오기'. 1단계 → 원본 분석 화면.
// 3. 보관 기록 열기 → 1단계 분석 화면(1단계 현재) → 2단계 보정 → 3단계 결과 테스트, 브랜드 → 보관함.
// 4. 모바일(768px 미만): 좌측 바 없음·상단 바(브랜드·v1.39·메뉴 단추 44px). 메뉴 열기 → 같은 메뉴, 단계 고르면 닫히고 단추로 초점, Esc로도 닫힘.
// 5. 세션 감시: 다른 탭 로그아웃(401)이 확인되면 본문(사이드바 포함)을 가리고 안내로 초점.
// 각 폭 가로 넘침 0, 외부 요청 0, 쓰기 요청 0(열기·단계 이동은 GET뿐).
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA original shell " + Date.now());
const page = task.page("p1");
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
// 보이는 단추·링크를 이름으로 골라 키보드로 누른다.
const press = async (name, scope = "body", key = "Enter") => {
  const found = await page.evaluate(([name, scope]) => {
    const node = [...document.querySelectorAll(`${scope} button, ${scope} a`)].find((item) => item.getClientRects().length > 0
      && (item.getAttribute("aria-label") === name || item.textContent.replace(/\s+/g, "") === name.replace(/\s+/g, "")));
    if (!node) return false;
    document.querySelector("[data-press]")?.removeAttribute("data-press");
    node.setAttribute("data-press", ""); return true;
  }, [name, scope]);
  assert.ok(found, `단추 ${name}`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const state = () => page.evaluate(() => {
  const visible = (node) => !!node && node.getClientRects().length > 0;
  const aside = document.querySelector("aside[aria-label='이미지 스타일 분석기 사이드바']");
  const nav = visible(aside) ? aside : document.querySelector("[data-dna-shell] nav");
  const current = nav ? [...nav.querySelectorAll("[aria-current]")].map((node) => node.textContent.replace(/\s+/g, "")) : [];
  return {
    aside: visible(aside) ? Math.round(aside.getBoundingClientRect().width) : 0,
    mobileBar: visible(document.querySelector("[data-dna-shell] button[aria-controls]")),
    current,
    library: visible(document.querySelector("section[aria-label='보관함']")),
    analyze: visible(document.querySelector("[role=region][aria-label='이미지 스타일 분석기']")),
    refine: visible(document.querySelector("[role=region][aria-label='프롬프트 보정']")),
    test: visible(document.querySelector("[aria-label='결과 테스트']")),
    need: [...document.querySelectorAll("p")].some((node) => visible(node) && node.textContent.startsWith("먼저 1단계에서 이미지를 분석하거나")),
    oldHub: !!document.querySelector("#admin-style-dna, [aria-label='Style DNA 단계']") || [...document.querySelectorAll("h3")].some((node) => node.textContent.startsWith("Style DNA 작업실")),
    // 모바일 흉내에서는 넘치면 배치 창(innerWidth)이 함께 넓어지므로 innerWidth가 아니라 실제 화면 폭(clientWidth, 스크롤 막대 제외)과 비교한다.
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    heading: document.querySelector("h1")?.textContent ?? null,
    // 원본 dashboard 격자(sm 2열·xl 3열, 화면 폭 기준)
    columns: (() => { const grid = document.querySelector("section[aria-label='보관함'] ul"); return grid && visible(grid) ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0; })(),
  };
});
const requests = () => page.evaluate(() => window.__premiere.requests().map((row) => ({ path: row.path, method: row.method })));

const rows = [];
let step = "";
for (const width of [1440, 1280, 768, 390, 320]) try {
  const row = { width };
  const mobile = width < 768;
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
  await page.goto("about:blank");
  // 앞 폭에서 연 기록 기억(새로고침 복귀용 sessionStorage)을 지워 일반 진입 첫 화면(보관함)부터 본다.
  await page.goto(`${base}/admin?page=style-dna&styleDnaHold=list`);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base}/admin?page=style-dna&styleDnaSeed=1&w=${width}`);
  await until(() => !!window.__premiere && !!document.querySelector("section[aria-label='보관함'] li"), "library");
  await page.evaluate(() => { window.__external = 0; new window.PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.name.startsWith(location.origin)) window.__external += 1; }).observe({ type: "resource", buffered: true }); });

  // 1) 첫 화면 = 보관함 + 원본 사이드바
  step = "first";
  let s = await state();
  assert.equal(s.oldHub, false, "기존 허브 이미지 칸·작업실 머리·단계 탭 없음");
  assert.equal(s.library, true);
  assert.equal(s.heading, "보관함");
  assert.equal(s.columns, width >= 1280 ? 3 : width >= 640 ? 2 : 1, "보관함 열 수(원본 sm 2열·xl 3열)");
  row.columns = s.columns;
  if (mobile) {
    assert.deepEqual([s.aside, s.mobileBar], [0, true]);
    const bar = await page.evaluate(() => { const bar = document.querySelector("[data-dna-shell] button[aria-controls]"); const box = bar.getBoundingClientRect();
      return { text: bar.parentElement.textContent.replace(/\s+/g, " ").trim(), w: Math.round(box.width), h: Math.round(box.height), label: bar.getAttribute("aria-label"), expanded: bar.getAttribute("aria-expanded") }; });
    assert.deepEqual([bar.w >= 44, bar.h >= 44, bar.label, bar.expanded], [true, true, "메뉴 열기", "false"]);
    assert.match(bar.text, /이미지 스타일 분석기\s*v1\.39/);
    await page.screenshot({ path: `${out}/original-library-${width}.png` });
    await press("메뉴 열기");
    await until(() => !!document.querySelector("[data-dna-shell] [id] nav"), "drawer");
    s = await state();
  } else {
    assert.deepEqual([s.aside, s.mobileBar], [256, false]);
  }
  const menu = await page.evaluate((mobile) => {
    const root = mobile ? document.querySelector("[data-dna-shell] [id]") : document.querySelector("aside[aria-label='이미지 스타일 분석기 사이드바']");
    const text = root.innerText.replace(/\s+/g, " ").trim();
    const links = [...root.querySelectorAll("a")].map((a) => [a.textContent.trim(), a.getAttribute("href")]);
    const steps = [...root.querySelectorAll("nav button")].map((b) => b.textContent.replace(/\s+/g, ""));
    return { text, links, steps, logout: [...root.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그아웃") };
  }, mobile);
  assert.match(menu.text, /이미지 스타일 분석기 v1\.39 DNA LAB/);
  assert.match(menu.text, /작업 워크플로우/);
  assert.deepEqual(menu.steps.slice(0, 4), ["보관함", "1이미지분석카메라·조명·색상·스타일→마스터프롬프트", "2프롬프트보정피드백으로프롬프트미세조정",
    "3결과테스트프롬프트로이미지생성·원본과비교"]);
  assert.deepEqual(menu.links, [["📖 연동 & 사용 매뉴얼", "/admin#admin-manual"], ["🔑 API키등록·플랫폼연동", "/admin#admin-api-integrations"]]);
  assert.match(menu.text, /로그인 계정 (로그인한 계정 )?hub-fixture@example\.invalid/);
  assert.equal(menu.logout, true, "공통 계정 메뉴 로그아웃");
  assert.deepEqual(s.current, ["보관함"]);
  if (!mobile) await page.screenshot({ path: `${out}/original-library-${width}.png` });
  else {
    await page.screenshot({ path: `${out}/original-menu-${width}.png` });
    await page.keyboard.press("Escape"); await settle(200);
    assert.deepEqual(await page.evaluate(() => [!!document.querySelector("[data-dna-shell] [id] nav"), document.activeElement?.getAttribute("aria-label")]), [false, "메뉴 열기"], "Esc로 닫고 단추로 초점");
  }
  // 고른 단계로 옮긴다(모바일은 메뉴를 열고 고르면 닫히고 단추로 초점).
  const go = async (name) => {
    if (mobile) { await press("메뉴 열기"); await until(() => !!document.querySelector("[data-dna-shell] [id] nav"), "drawer open"); }
    await press(name, mobile ? "[data-dna-shell] [id] nav" : "aside");
    if (mobile) assert.deepEqual(await page.evaluate(() => [!!document.querySelector("[data-dna-shell] [id] nav"), document.activeElement?.getAttribute("aria-label")]), [false, "메뉴 열기"], `${name} 고른 뒤 닫힘·초점`);
  };

  // 2) 분석 전 2·3단계 → 원본 안내
  step = "need";
  for (const [name, label] of [["2프롬프트 보정피드백으로 프롬프트 미세 조정", "2단계 프롬프트 보정"], ["3결과 테스트프롬프트로 이미지 생성·원본과 비교", "3단계 결과 테스트"]]) {
    await go(name);
    s = await state();
    assert.deepEqual([s.need, s.library, s.refine, s.test, s.heading], [true, false, false, false, label]);
  }
  await page.screenshot({ path: `${out}/original-need-${width}.png` });
  await press("1단계 이미지 분석으로 이동");
  s = await state();
  assert.deepEqual([s.analyze, s.need, s.heading], [true, false, "1단계 이미지 분석"]);
  assert.match(s.current.join("|"), /^1이미지분석/);
  await page.screenshot({ path: `${out}/original-analyze-empty-${width}.png` });
  await go("3결과 테스트프롬프트로 이미지 생성·원본과 비교");
  await press("보관함에서 불러오기");
  assert.equal((await state()).library, true);

  // 3) 보관 기록 열기 → 분석 → 보정 → 시험
  step = "open";
  await press("보관된 도심 인물 사진 열기");
  await until(() => !!document.querySelector("[role=region][aria-label='이미지 스타일 분석기']"), "analyze opened");
  s = await state();
  assert.deepEqual([s.analyze, s.heading], [true, "1단계 이미지 분석"]);
  assert.match(s.current.join("|"), /^1이미지분석/);
  await page.screenshot({ path: `${out}/original-analyze-${width}.png` });
  row.overflow = Math.max(row.overflow ?? -Infinity, s.overflow);
  await go("2프롬프트 보정피드백으로 프롬프트 미세 조정");
  s = await state();
  assert.deepEqual([s.refine, s.need, s.heading], [true, false, "2단계 프롬프트 보정"]);
  await page.screenshot({ path: `${out}/original-refine-${width}.png` });
  row.overflow = Math.max(row.overflow ?? -Infinity, s.overflow);
  await go("3결과 테스트프롬프트로 이미지 생성·원본과 비교");
  s = await state();
  assert.deepEqual([s.test, s.need, s.heading], [true, false, "3단계 결과 테스트"]);
  await page.screenshot({ path: `${out}/original-test-${width}.png` });
  row.overflow = Math.max(row.overflow ?? -Infinity, s.overflow);
  await press("이미지 스타일 분석기 v1.39 보관함으로");
  assert.equal((await state()).library, true, "브랜드 → 보관함");

  // 4) 쓰기 요청 0, 외부 0
  const list = await requests();
  row.writes = list.filter((item) => item.method !== "GET" && item.path !== "/api/auth/session").length;
  row.external = await page.evaluate(() => window.__external);
  assert.deepEqual([row.writes, row.external], [0, 0]);
  assert.ok(row.overflow <= 0, `가로 넘침 ${row.overflow}`);

  // 5) 세션 감시: 다른 탭 로그아웃 확인 → 본문 가림
  step = "session";
  // 확인 불가(503): 의심 상태라 본문만 가리고 계정 메뉴는 남는다. 로그인 없음(401)은 공통 감시가 본문을 지우고 로그인 화면으로 보낸다(아래).
  // 다른 탭의 로그인 변경 신호(같은 이름의 BroadcastChannel) 뒤 확인 불가 → 의심 상태.
  await page.evaluate(() => { window.__premiere.session = 503; const channel = new window.BroadcastChannel("dream-auth-session"); channel.postMessage("changed"); channel.close(); });
  await until(() => !document.querySelector("main [data-protected-content]:not([hidden])"), "protected hidden");
  // 공통 작업실 껍데기와 같은 규칙: 본문(main)과 브랜드·단계·링크는 가리고, 사이드바(모바일은 펼침 메뉴) 계정 메뉴의 로그아웃은 남긴다.
  if (mobile) { await press("메뉴 열기"); await until(() => !!document.querySelector("[data-dna-shell] [id] nav"), "drawer session"); }
  row.session = await page.evaluate((mobile) => {
    const root = mobile ? document.querySelector("[data-dna-shell] [id]") : document.querySelector("aside[aria-label='이미지 스타일 분석기 사이드바']");
    const shown = (node) => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
    return {
      main: [...document.querySelectorAll("main [data-protected-content] *")].some((node) => node.getClientRects().length > 0),
      steps: [...root.querySelectorAll("nav button, nav a")].filter((node) => !node.closest("[class*=accountBox]")).filter(shown).map((node) => node.textContent.trim().slice(0, 20)),
      logout: [...root.querySelectorAll("button")].some((node) => node.textContent.trim().startsWith("로그아웃") && shown(node)),
      notice: document.querySelector("main [data-session-notice]")?.textContent.trim().slice(0, 40) ?? null,
    };
  }, mobile);
  assert.deepEqual([row.session.main, row.session.steps, row.session.logout, !!row.session.notice], [false, [], true, true], `확인 불가 때 본문·단계 가림, 계정 메뉴 남김 ${JSON.stringify(row.session)}`);
  if (mobile) await page.keyboard.press("Escape");
  // 로그인 없음 확정: 로그인 화면(돌아올 곳 = 지금 화면)으로 옮긴다. 대역 서버에는 로그인 화면이 없어 주소 이동만 본다.
  await page.evaluate(() => {
    window.__leaving = null;
    window.addEventListener("beforeunload", () => { window.__leaving = "unload"; });
    window.__premiere.session = 401; window.dispatchEvent(new FocusEvent("focus"));
  });
  let left = false;
  for (let i = 0; i < 60 && !left; i++) { left = await page.evaluate(() => window.__leaving === "unload" || !document.querySelector("[data-dna-shell]")).catch(() => true); if (!left) await settle(100); }
  assert.equal(left, true, "로그인 없음 확정 → 화면을 떠남");
  row.session.signedOut = "left";
  rows.push(row);
} catch (error) {
  await page.screenshot({ path: `${out}/original-fail-${width}-${step}.png` }).catch(() => {});
  throw new Error(`${width} ${step}: ${error.message}`, { cause: error });
}
console.log("STYLE-DNA-ORIGINAL-RESULT" + JSON.stringify(rows));
