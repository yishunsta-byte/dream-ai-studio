/* global taskSpace, fetch, document, localStorage, sessionStorage, setTimeout, console */
// 등록 PCM WAV · 한 오리진(127.0.0.1)·한 탭 세션 교체: A 결과·초안 편집 → 붙잡힌 A 재분석 중 로그아웃 → 401 경계 → B 로그인 → A 응답 풀기 → B만
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/reference-analysis/registered-pcm-wav-session-switch.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async () => (await fetch(`${origin}/__fixture/state`)).json();
const ctl = async (path) => (await fetch(`${origin}/__fixture/${path}`, { method: "POST" })).json();
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const EDIT = "A가 고친 초안 문장";
const task = await taskSpace("registered wav session switch");
const page = task.page("p1");
const focus = () => page.evaluate(() => { const a = document.activeElement; if (a === document.body) return "BODY"; const n = a.tagName === "SELECT" ? `[${a.selectedOptions[0]?.textContent}]` : a.type === "checkbox" ? `체크(${a.checked ? "켬" : "끔"})` : a.textContent.trim().slice(0, 22); return `${a.tagName}${a.disabled ? "(꺼짐)" : ""}:${n}`; });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 화면에 남은 계정 흔적: 결과·RMS·초안(원문·편집)·선택·체크·저장소
const residue = () => page.evaluate((edit) => { const main = document.querySelector("main"); const text = main.innerText; const select = main.querySelector("select");
  return { result: /음악 분석 · 결과|최대 정규화 RMS/.test(text), rms25: /RMS 25%/.test(text), edit: document.documentElement.outerHTML.includes(edit) || [...document.querySelectorAll("textarea")].some((t) => t.value.includes(edit)),
    textarea: !!main.querySelector("textarea"), selected: select ? select.selectedIndex > 0 : false, checked: !!main.querySelector("input[type=checkbox]:checked"),
    storage: localStorage.length + sessionStorage.length }; }, EDIT);
const clean = (r) => !r.result && !r.rms25 && !r.edit && !r.textarea && !r.selected && !r.checked && r.storage === 0;
const openList = async () => {
  await page.waitForFunction(() => { const s = document.querySelector("main select"); return !!s && s.options.length > 1 && Object.keys(s).some((k) => k.startsWith("__react")); }, undefined, { timeout: 15000 });
};
const runAnalysis = async () => {
  await page.focus("loc=css:main select"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.textContent === "분석 결과", undefined, { timeout: 30000 });
};
const resultOf = () => page.evaluate(() => { const main = document.querySelector("main");
  return { meta: main.innerText.match(/음악 분석 · 결과 \d+개/)?.[0] ?? null, evidence: [...main.querySelectorAll("ol li")].map((li) => li.textContent.trim()),
    draft: (main.querySelector("textarea")?.value ?? "").slice(0, 60) }; });
const out = { widths: [] };
try {
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const r = { width };
    // 1) A 로그인 → 분석 → 값·초안 표시 → 초안 편집
    await page.goto(`${origin}/__session?as=a`);
    await openList();
    r.aOptions = await page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
    await runAnalysis();
    r.aResult = await resultOf();
    await page.focus("loc=css:main textarea"); await page.keyboard.press("End"); await page.keyboard.type(" " + EDIT);
    r.aEdited = await page.evaluate((edit) => document.querySelector("main textarea").value.includes(edit), EDIT);
    check(r.aResult.meta === "음악 분석 · 결과 1개" && r.aResult.evidence.some((e) => e.includes("오디오 1채널 · 최대 정규화 RMS 25%") && /0.?125 ms/.test(e)) && r.aResult.draft.length > 0 && r.aEdited, `A result+edit ${width}`);
    // 2) A '다시 분석' 응답을 붙잡는다(서버는 계산까지 마침). 그 상태로 같은 탭 로그아웃
    const s0 = await ctl("hold-next-post");
    await page.focus("loc=css:main button:has-text('다시 분석')"); await page.keyboard.press("Enter");
    for (let i = 0; i < 100 && (await st()).held === s0.held; i++) await wait(100);
    const s1 = await st();
    check(s1.held === s0.held + 1, `A response held ${width}`);
    await page.goto(`${origin}/__logout`);
    await page.waitForFunction(() => /다시 로그인해 주세요/.test(document.querySelector("main")?.innerText ?? ""), undefined, { timeout: 15000 });
    await wait(200);
    r.loggedOut = await residue();
    r.loggedOutLogin = await page.evaluate(() => [...document.querySelectorAll("main a")].map((a) => a.textContent));
    r.loggedOutOverflow = await overflow();
    // 3) 401 경계: 무세션 목록 GET·분석 POST(선택값은 A의 것이 남아 있어도 보낼 수 없음을 서버에서 확인)
    const list401 = await page.fetch("/api/studio/reference-analysis/materials");
    const post401 = await page.fetch("/api/studio/reference-analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "00000000-0000-7000-8000-000000000000", assetId: "00000000-0000-7000-8000-000000000000" }) });
    r.boundary = { list: list401.status, post: post401.status, postBody: (post401.body ?? "").slice(0, 80) };
    const s2 = await st();
    check(clean(r.loggedOut) && r.loggedOutLogin.includes("다시 로그인") && r.loggedOutOverflow === 0, `logout cleared ${width}`);
    check(r.boundary.list === 401 && r.boundary.post === 401 && s2.readsA === s1.readsA && s2.readsB === s1.readsB, `401 boundary no read ${width}`);
    // 4) 같은 탭 B 로그인 → 붙잡은 A 응답 풀기 → 화면에 A 흔적 0, B 목록만
    await page.goto(`${origin}/__session?as=b`);
    await openList();
    r.bOptions = await page.evaluate(() => [...document.querySelectorAll("main option")].map((o) => o.textContent));
    r.bList = JSON.parse((await page.fetch("/api/studio/reference-analysis/materials")).body).materials.length;
    const s3 = await ctl("release");
    await wait(500);
    r.afterRelease = await residue();
    r.afterReleaseFocus = await focus();
    r.held = { discarded: s3.heldDiscarded, delivered: s3.heldDelivered };
    check(JSON.stringify(r.bOptions) === JSON.stringify(["등록 자료를 선택하세요", "등록 자료 1"]) && r.bList === 1, `B list only ${width}`);
    check(clean(r.afterRelease) && s3.heldDiscarded + s3.heldDelivered === s1.held, `held A response ignored, no residue ${width}`);
    // 5) 명시적 B 분석: B 원본만 읽는다
    const s4 = await st();
    await runAnalysis();
    r.bResult = await resultOf();
    r.bOverflow = await overflow();
    const s5 = await st();
    r.reads = { aSinceLogout: s5.readsA - s1.readsA, b: s5.readsB - s4.readsB, bBeforeExplicit: s4.readsB - s1.readsB };
    r.bResidue = await page.evaluate((edit) => ({ rms25: /RMS 25%/.test(document.querySelector("main").innerText), edit: document.querySelector("main textarea").value.includes(edit) }), EDIT);
    check(r.bResult.meta === "음악 분석 · 결과 1개" && r.bResult.evidence.some((e) => e.includes("오디오 1채널 · 최대 정규화 RMS 12.5%") && /0.?125 ms/.test(e)) && !r.bResidue.rms25 && !r.bResidue.edit, `B explicit result ${width}`);
    check(r.reads.aSinceLogout === 0 && r.reads.bBeforeExplicit === 0 && r.reads.b === 2 && s5.posts - s4.posts === 1, `B-only reads ${width}`);
    check(r.bOverflow === 0, `overflow ${width}`);
    // 다음 폭을 위해 로그아웃
    await page.goto(`${origin}/__logout`);
    out.widths.push(r);
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 200));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await ctl("release").catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
