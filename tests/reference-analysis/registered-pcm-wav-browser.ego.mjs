/* global taskSpace, fetch, document, setTimeout, console */
// 등록 PCM WAV 보호 목록 → 권리 확인 → 분석 → 음악 결과 → 철회 → 계정 격리(두 세션: A=127.0.0.1, B=localhost)
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/registered-pcm-wav-browser.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const SA = origin, SB = origin.replace("127.0.0.1", "localhost");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const task = await taskSpace("registered wav integration");
const pageA = task.page("p1");
const pageB = await task.newPage();
const focus = (page) => page.evaluate(() => { const a = document.activeElement; if (a === document.body) return "BODY"; const n = a.tagName === "SELECT" ? `[${a.selectedOptions[0]?.textContent}]` : a.type === "checkbox" ? `체크(${a.checked ? "켬" : "끔"})` : a.textContent.trim().slice(0, 22); return `${a.tagName}${a.disabled ? "(꺼짐)" : ""}:${n}`; });
const overflow = (page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, diff: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
const openList = async (page, base) => {
  await page.goto(base + "/");
  await page.waitForFunction(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, undefined, { timeout: 15000 });
};
const listCount = async (page) => { const r = await page.fetch("/api/studio/reference-analysis/materials"); return { status: r.status, count: (JSON.parse(r.body || "{}").materials ?? []).length }; };
async function analyze(page, reads) {
  const r = {};
  r.firstEntry = await focus(page);
  r.options = await page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
  r.domLeaks = await page.evaluate(() => ["등록 음악 ·", "SYNTHETIC_TEST_RIGHTS_NOTE"].filter((s) => document.documentElement.outerHTML.includes(s)));
  const before = await st();
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); r.checkFocus = await focus(page);
  await page.evaluate(() => [...document.querySelectorAll("main button")].forEach((b) => b.click()));
  await wait(300);
  const pre = await st();
  r.postsBeforeRights = pre.posts - before.posts; r.readsBeforeRights = pre[reads] - before[reads];
  await page.keyboard.press("Space"); await page.keyboard.press("Tab"); r.runFocus = await focus(page); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.textContent === "분석 결과", undefined, { timeout: 30000 });
  r.resultFocus = await focus(page);
  r.result = await page.evaluate(() => { const main = document.querySelector("main");
    return { meta: main.innerText.match(/음악 분석 · 결과 \d+개/)?.[0] ?? null,
      items: [...(main.querySelector("select[id$='-result']")?.options ?? [])].map((o) => o.textContent.trim()),
      headings: [...main.querySelectorAll("h4")].map((h) => h.textContent),
      evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()),
      draft: (main.querySelector("textarea")?.value ?? "").slice(0, 60) }; });
  r.layout = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll("main section section")].map((s) => s.getBoundingClientRect()); return b && b.top > a.bottom - 1 ? "아래" : "옆"; });
  r.overflowResult = await overflow(page);
  const after = await st();
  r.posts = after.posts - pre.posts; r.ready = after.ready - pre.ready; r.reads = after[reads] - pre[reads];
  r.otherReads = (after.readsA + after.readsB) - (pre.readsA + pre.readsB) - r.reads;
  return r;
}
const judge = (r, label, rms) => {
  check(r.firstEntry === "BODY" && JSON.stringify(r.options) === JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"]) && r.domLeaks.length === 0, `${label} entry`);
  check(r.checkFocus === "INPUT:체크(끔)" && r.runFocus === "BUTTON:분석 실행" && r.resultFocus === "H3:분석 결과", `${label} focus`);
  check(r.postsBeforeRights === 0 && r.readsBeforeRights === 0, `${label} no POST before rights`);
  // 어댑터는 분석 전 한 번, 분석 뒤 재확인 한 번 자기 원본을 읽는다(사본은 1개).
  check(r.posts === 1 && r.ready === 1 && r.reads === 2 && r.otherReads === 0, `${label} one POST, own source only`);
  check(/^음악 분석 · 결과 \d+개$/.test(r.result.meta ?? "") && r.result.headings.includes("관찰 근거") && r.result.headings.includes("창작 초안") && r.result.draft.length > 0, `${label} result shape`);
  check(r.result.evidence.some((e) => e.includes(`오디오 1채널 · 최대 정규화 RMS ${rms}`) && /0.?125 ms/.test(e)), `${label} RMS/channel/interval`);
  check(r.overflowResult.diff === 0, `${label} overflow`);
};
const out = { widths: [] };
try {
  await pageA.goto(`${SA}/__session?as=a`);
  await pageB.goto(`${SB}/__session?as=b`);
  out.sessions = { A: await listCount(pageA), B: await listCount(pageB) };
  check(out.sessions.A.count === 1 && out.sessions.B.count === 1, "each session lists one own material");
  for (const width of [390, 1440]) {
    for (const page of [pageA, pageB]) await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };
    await openList(pageA, SA);
    r.A = await analyze(pageA, "readsA"); judge(r.A, `A ${width}`, "25%");
    await openList(pageB, SB);
    r.B = await analyze(pageB, "readsB"); judge(r.B, `B ${width}`, "12.5%");
    check(width === 390 ? r.A.layout === "아래" : r.A.layout === "옆", `layout ${width}`);
    // A 승인 철회 → A '다시 분석': 원본 읽기 0, 결과·목록 정리. B 세션 목록은 그대로
    const s0 = await st();
    await ctl("revoke-a");
    await pageA.focus("loc=css:main button:has-text('다시 분석')"); await pageA.keyboard.press("Enter");
    await pageA.waitForFunction(() => /분석할 수 있는 등록 자료가 없어요/.test(document.querySelector("main").innerText), undefined, { timeout: 15000 });
    await wait(200);
    r.revoked = await pageA.evaluate(() => { const main = document.querySelector("main"); return { select: !!main.querySelector("select"), check: !!main.querySelector("input[type=checkbox]"), textarea: !!main.querySelector("textarea"), result: /음악 분석 · 결과|최대 정규화 RMS/.test(main.innerText) }; });
    r.revokedFocus = await focus(pageA);
    r.overflowRevoked = await overflow(pageA);
    const s1 = await st();
    r.revokedReads = (s1.readsA + s1.readsB) - (s0.readsA + s0.readsB);
    r.revokedSourceUnavailable = s1.sourceUnavailable - s0.sourceUnavailable;
    r.listBDuringRevoke = await listCount(pageB);
    check(JSON.stringify(r.revoked) === JSON.stringify({ select: false, check: false, textarea: false, result: false }), `revoked cleared ${width}`);
    check(/^DIV:분석할 수 있는 등록 자료가 없어요/.test(r.revokedFocus) && r.overflowRevoked.diff === 0, `revoked focus/overflow ${width}`);
    check(r.revokedReads === 0 && r.revokedSourceUnavailable === 1, `revoked no source read ${width}`);
    check(r.listBDuringRevoke.count === 1, `B unaffected ${width}`);
    await ctl("restore-a");
    out.widths.push(r);
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 200));
} finally {
  for (const page of [pageA, pageB]) await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
