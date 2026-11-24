/* global taskSpace, fetch, document, window, setTimeout, console, getComputedStyle */
// 공개 분석 결과 화면 · 합성 목록, 폭 390·1440
//  ok: 3종 카드·매체 표시·평문(HTML 해석 0, 스크립트 실행 0)·줄바꿈 유지 / empty: 빈 안내 / down: 장애 안내, 카드 0 / long: 긴 제목·주소·프롬프트 가로 넘침 0
//  키보드: Tab 첫 초점은 홈 링크(44px 이상), 카드 안 추가 조작 없음
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/admin/published-analysis-results.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const task = await taskSpace("published analysis results");
const page = task.page("p1");
const read = () => page.evaluate(() => {
  const main = document.querySelector("main");
  const a = document.activeElement;
  const cards = [...document.querySelectorAll("article")];
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    cardOverflow: cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length,
    cards: cards.length, media: cards.map((card) => card.querySelector("p span")?.textContent),
    bold: document.querySelectorAll("main b").length, scripts: document.querySelectorAll("main script").length, xss: window.__xss ?? 0,
    preWrap: cards.length ? getComputedStyle(cards[0].querySelector("p:not(:first-child)")).whiteSpace : null,
    text: main.innerText.replace(/\s+/g, " ").slice(0, 400), h1: document.querySelector("h1")?.textContent,
    focusables: document.querySelectorAll("main a, main button, main input, main [tabindex]:not([tabindex='-1'])").length,
    focus: a === document.body ? "BODY" : `${a.tagName}:${a.textContent.trim().slice(0, 20)}:${Math.round(a.getBoundingClientRect().height)}`,
  };
});
const out = { widths: [] };
try {
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };
    out.widths.push(r);
    for (const state of ["ok", "empty", "down", "long"]) {
      await page.goto(`${origin}/?state=${state}`);
      for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector("h1"))); i++) await wait(100);
      if (state === "ok") { await page.keyboard.press("Tab"); }
      r[state] = await read();
    }
    const { ok, empty, down, long } = r;
    check(ok.cards === 3 && JSON.stringify(ok.media) === JSON.stringify(["이미지", "음악", "영상"]) && ok.bold === 0 && ok.scripts === 0 && ok.xss === 0
      && ok.text.includes("<b>굵게</b>") && ok.preWrap === "pre-wrap" && ok.overflow <= 0 && ok.focusables === 1 && /^A:DREAM/.test(ok.focus)
      && Number(ok.focus.split(":").pop()) >= 44, `ok ${width}`);
    check(empty.cards === 0 && empty.text.includes("아직 공개된 분석 결과가 없어요") && empty.overflow <= 0, `empty ${width}`);
    check(down.cards === 0 && down.text.includes("지금은 결과를 불러올 수 없어요") && down.overflow <= 0, `down ${width}`);
    check(long.cards === 1 && long.overflow <= 0 && long.cardOverflow === 0, `long ${width}`);
    for (const state of ["ok", "empty", "down", "long"]) delete r[state].text;
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 600));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
