/* global taskSpace, fetch, document, window, setTimeout, console */
// 관리자 콘텐츠 분석·공개 화면 · 합성 응답 대역, 폭 390·1440, 키보드 흐름
//  1 첫 목록 빈 상태 → 2 음악 분석(키보드) → 결과·근거·프롬프트, 결과 제목 초점 → 3 공개: 첫 응답 실패 → 같은 id 재시도 → 성공·목록 갱신
//  4 철회 확인 → DELETE {id} → 목록 '철회됨' → 5 이미지·영상(결과 2개) 분석 → 5b 영상 공개 409 충돌이면 안내·동의 해제, 다시 동의하면 새 id
//  6 401이면 조작 멈춤·로그인 안내. 단계마다 가로 넘침 0.
// 실행: ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<준비 줄의 주소>"; await import("file:///…/tests/admin/admin-reference-analysis.ego.mjs")'
const origin = globalThis.FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("FIXTURE_ORIGIN must be the loopback fixture origin");
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
const time = (startMs, endMs = startMs) => ({ kind: "time", startMs, endMs });
const READY = {
  image: { schemaVersion: 1, status: "ready", media: "image", proposals: [{ media: "image", selectionId: "image-1",
    observations: [{ kind: "observation", findingId: "region-1", measure: "region_color_luminance", location: { kind: "region", x: 0, y: 0, width: 1, height: 1 },
      alphaCoverage: 1, palette: [{ bucket: "#3366cc", visibleShare: 0.6 }], luminanceShares: [0.25, 0.25, 0.25, 0.25], luminanceEdges: [0, 0.25, 0.5, 0.75, 1] }],
    draft: { kind: "creative_proposal", target: "image", prompt: "푸른 색이 넓게 퍼진 장면" } }] },
  music: { schemaVersion: 1, status: "ready", media: "music", proposals: [{ media: "music", selectionId: "music-1",
    observations: [{ kind: "observation", findingId: "onsets-1", measure: "energy_onsets", location: time(0, 4000), timesMs: [0, 500, 1000, 1500, 2000], medianIntervalMs: 500 }],
    inference: { kind: "inference", findingId: "bpm-1", measure: "estimated_bpm", location: time(0, 4000), bpm: 120, evidenceIds: ["onsets-1"] },
    draft: { kind: "creative_proposal", target: "music", role: "music", prompt: "120 BPM의 경쾌한 배경 음악" } }] },
  video: { schemaVersion: 1, status: "ready", media: "video", proposals: [
    { media: "video", selectionId: "video-1", observations: [{ kind: "observation", findingId: "frame-1", measure: "decoded_frame", location: time(125) }],
      sourceSeek: { kind: "observed_pts", findingId: "frame-1", ptsMs: 125 },
      inference: { kind: "inference", findingId: "cut-1", measure: "candidate_cut", location: time(125), evidenceIds: ["frame-1"] },
      draft: { kind: "creative_proposal", target: "cut", prompt: "125ms에서 장면을 바꾸는 컷" } },
    { media: "video", selectionId: "video-2", observations: [{ kind: "observation", findingId: "frame-2", measure: "decoded_frame", location: time(500) }],
      sourceSeek: { kind: "observed_pts", findingId: "frame-2", ptsMs: 500 }, draft: { kind: "creative_proposal", target: "cut", prompt: "두 번째 컷" } }] },
};
const ID1 = "10000000-0000-4000-8000-000000000001";
const item = (over = {}) => ({ id: ID1, title: "음악 분석 결과", summary: "음악 소스에서 추정 템포 120 BPM를 측정했어요.", prompt: "120 BPM의 경쾌한 배경 음악",
  media: "music", status: "published", publishedAt: "2026-11-20T03:00:00.000Z", ...over });

const task = await taskSpace("admin reference analysis");
const page = task.page("p1");
console.log(`ADMIN-ANALYSIS-SPACE ${task.spaceId}`);
const fx = (expr, arg) => (arg === undefined ? page.evaluate(expr) : page.evaluate(expr, arg));
const requests = () => fx(() => window.__fixture.requests());
const reply = (index, status, body) => fx((v) => window.__fixture.reply(v.index, v.status, v.body), { index, status, body });
const untilRequests = async (n, label) => { for (let i = 0; i < 50; i++) { if ((await requests()).length === n) return; await wait(100); } throw new Error("timeout: " + label); };
const until = async (fn, label) => { for (let i = 0; i < 50; i++) { if (await fx(fn).catch(() => false)) return; await wait(100); } throw new Error("timeout: " + label + " | " + (await fx(() => document.querySelector("main").innerText.replace(/\s+/g, " ").slice(-700)))); };
const state = () => fx(() => {
  const text = document.querySelector("main").innerText;
  const a = document.activeElement;
  return { text, overflow: document.documentElement.scrollWidth - window.innerWidth,
    focus: a === document.body ? "BODY" : `${a.tagName}:${(a.getAttribute("type") || "")}:${(a.textContent || a.value || "").trim().slice(0, 24)}`,
    title: document.querySelector("form:has(input[type=checkbox]) input:not([type])")?.value ?? null,
    prompt: document.querySelectorAll("form:has(input[type=checkbox]) textarea")[1]?.value ?? null,
    pick: !!document.querySelector("form:has(input[type=checkbox]) select"), inputs: document.querySelectorAll("main input, main textarea, main select").length };
});
async function submitAnalysis() {
  await page.focus("loc=css:form:has(input[type=radio]) button[type=submit]");
  await page.keyboard.press("Enter");
}

async function analyze(url, media) {
  await page.click(`loc=css:main input[type=radio][value=${media}]`);
  await page.fill("loc=css:main input[type=url]", url);
  await submitAnalysis();
}

const out = { widths: [] };
try {
  for (const width of [390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await page.goto(`${origin}/`);
    await untilRequests(1, "list");
    const r = { width, steps: {} };
    out.widths.push(r);
    await reply(0, 200, { items: [] });
    await until(() => document.querySelector("main").innerText.includes("아직 공개한 분석 결과가 없어요"), "empty list");
    r.steps.empty = await state();
    await page.fill("loc=css:main input[type=url]", "https://www.threads.com/@fixture/post/123");
    check(await fx(() => document.querySelector("input[type=url]").getAttribute("aria-invalid") === "true" &&
      document.querySelector("form button[type=submit]").disabled && document.querySelector("main").innerText.includes("Threads 게시물 링크") &&
      !document.querySelector("input[type=checkbox]")), `initial rights and URL guidance ${width}`);

    // 2 음악 분석
    await analyze("https://tonejs.github.io/audio/loop.mp3", "music");
    await untilRequests(2, "analyze music");
    r.steps.running = await state();
    await reply(1, 200, { result: READY.music });
    await until(() => document.querySelector("main").innerText.includes("추정 템포 120 BPM"), "music result");
    r.steps.music = await state();
    check(await fx(() => [...document.querySelectorAll('main h2, form h3, section[aria-labelledby$="-results"] h3')].every(
      (heading) => getComputedStyle(heading).color === 'rgb(237, 253, 248)')), `lab heading contrast ${width}`);
    if (globalThis.FIXTURE_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${globalThis.FIXTURE_SCREENSHOT_DIR}/spectrum-${width}.png`, fullPage: true });
    }
    check((await requests())[1].body?.url === "https://tonejs.github.io/audio/loop.mp3" && (await requests())[1].body?.authorized === true
      && (await requests())[1].body?.media === "music" && r.steps.music.text.includes("0, 500, 1000, 1500, 2000 ms")
      && r.steps.running.text.includes("서버에서 분석하고 있어요") && r.steps.running.focus.includes("분석 취소") && r.steps.music.focus.startsWith("H3:") && r.steps.music.title === "음악 분석 결과"
      && r.steps.music.prompt === "120 BPM의 경쾌한 배경 음악" && r.steps.music.overflow <= 0, `music analysis ${width}`);

    // 3 공개: 실패 → 같은 id 재시도 → 성공
    await page.focus("loc=css:form:has(input[type=checkbox]) input:not([type])");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await untilRequests(3, "publish 1");
    await reply(2, 503);
    await until(() => document.querySelector("main").innerText.includes("같은 공개 요청을 다시 보내요"), "publish failed");
    r.steps.publishFailed = await state();
    await page.focus("loc=css:form:has(input[type=checkbox]) button[type=submit]"); await page.keyboard.press("Enter");
    await untilRequests(4, "publish retry");
    await reply(3, 200, { item: item() });
    await untilRequests(5, "list after publish");
    await reply(4, 200, { items: [item()] });
    await until(() => [...document.querySelectorAll("main ul")].some((list) => list.innerText.includes("공개 중")) && document.querySelector("main").innerText.includes("을 공개했어요"), "published list");
    r.steps.published = await state();
    const sent = await requests();
    r.publishSent = sent.slice(2, 4).map(({ method, body }) => ({ method, keys: Object.keys(body ?? {}).sort().join(","), id: body?.id }));
    r.publishFocus = r.steps.publishFailed.focus;
    r.publishedNotice = r.steps.published.text.split("\n").find((line) => line.includes("공개했어요")) ?? null;
    check(sent[2].method === "POST" && sent[2].body?.id === ID1 && sent[3].body?.id === ID1 && sent[2].body?.authorized === true
      && JSON.stringify(Object.keys(sent[3].body).sort()) === JSON.stringify(["authorized", "id", "media", "prompt", "summary", "title"])
      && r.steps.publishFailed.focus.startsWith("P:") && r.steps.published.text.includes("을 공개했어요") && r.steps.published.overflow <= 0, `publish retry same id ${width}`);

    // 4 철회
    await page.focus("loc=css:main ul button"); await page.keyboard.press("Enter");
    await until(() => [...document.querySelectorAll("main ul button")].some((b) => b.textContent.includes("공개 철회 확인")), "confirm");
    r.steps.confirm = await state();
    await page.focus("loc=css:main ul [role=group] button:first-child"); await page.keyboard.press("Enter");
    await untilRequests(6, "revoke");
    await reply(5, 200, { ok: true });
    await untilRequests(7, "list after revoke");
    await reply(6, 200, { items: [item({ status: "revoked" })] });
    await until(() => document.querySelector("main").innerText.includes("철회됨"), "revoked");
    r.steps.revoked = await state();
    const after = await requests();
    check(after[5].method === "DELETE" && JSON.stringify(after[5].body) === JSON.stringify({ id: ID1 })
      && !(await fx(() => [...document.querySelectorAll("main ul button")].some((b) => b.textContent.includes("공개 철회"))))
      && r.steps.revoked.focus.startsWith("H3:") && r.steps.revoked.overflow <= 0, `revoke ${width}`);

    // 5 이미지·영상
    await analyze("https://mdn.github.io/a.png", "image");
    await untilRequests(8, "image");
    await reply(7, 200, { result: READY.image });
    await until(() => document.querySelector("main").innerText.includes("이미지 분석"), "image result");
    r.steps.image = await state();
    await analyze("https://interactive-examples.mdn.mozilla.net/media/a.mp4", "video");
    await untilRequests(9, "video");
    await reply(8, 200, { result: READY.video });
    await until(() => document.querySelector("main").innerText.includes("영상 분석"), "video result");
    r.steps.video = await state();
    check(r.steps.image.prompt === "푸른 색이 넓게 퍼진 장면" && r.steps.image.title === "이미지 분석 결과" && r.steps.video.title === "영상 분석 결과" && r.steps.video.pick
      && r.steps.image.text.includes("#3366cc · 60%") && r.steps.video.text.includes("원본 프레임 표시 시각 125 ms")
      && r.steps.video.prompt === "125ms에서 장면을 바꾸는 컷" && r.steps.video.overflow <= 0 && r.steps.image.overflow <= 0, `image video ${width}`);

    await page.click('loc=css:button[aria-controls$="-prompt"]');
    await page.fill('loc=css:section[aria-labelledby$="-results"] textarea', "첫 번째 구간 수정 문장");
    await page.selectOption('loc=css:section[aria-labelledby$="-results"] select', { index: 1 });
    check(await fx(() => document.querySelector('section[aria-labelledby$="-results"] textarea').value === "두 번째 컷"), `second draft separate ${width}`);
    await page.selectOption('loc=css:section[aria-labelledby$="-results"] select', { index: 0 });
    check(await fx(() => document.querySelector('section[aria-labelledby$="-results"] textarea').value === "첫 번째 구간 수정 문장"), `first draft restored ${width}`);

    // 5b 공개 확정 충돌(409): 안내 → 동의 해제·같은 id 재시도 중단 → 목록 다시 읽기 → 다시 동의하면 새 id
    const publishVideo = async () => {
      await page.focus("loc=css:form:has(input[type=checkbox]) input[type=checkbox]"); await page.keyboard.press("Space");
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    };
    await publishVideo();
    await untilRequests(10, "video publish");
    await reply(9, 409, { error: "publication_conflict" });
    await untilRequests(11, "list after conflict");
    await reply(10, 200, { items: [item({ status: "revoked" })] });
    await until(() => document.querySelector("main").innerText.includes("다른 내용으로 이미 처리됐어요"), "conflict notice");
    r.steps.conflict = await state();
    const consentAfterConflict = await fx(() => document.querySelector("form:has(input[type=checkbox]) input[type=checkbox]").checked);
    await publishVideo();
    await untilRequests(12, "video publish new intent");
    await reply(11, 200, { item: item({ id: "10000000-0000-4000-8000-000000000003", media: "video", title: "영상 분석 결과" }) });
    await untilRequests(13, "list after video publish");
    await reply(12, 200, { items: [item({ id: "10000000-0000-4000-8000-000000000003", media: "video", title: "영상 분석 결과" }), item({ status: "revoked" })] });
    await until(() => document.querySelector("main").innerText.includes("‘영상 분석 결과’을 공개했어요"), "video published");
    const conflictSent = await requests();
    r.conflictIds = [conflictSent[9].body?.id, conflictSent[11].body?.id];
    check(conflictSent[9].body?.id === "10000000-0000-4000-8000-000000000002" && conflictSent[11].body?.id === "10000000-0000-4000-8000-000000000003"
      && !consentAfterConflict && r.steps.conflict.focus.startsWith("P:") && r.steps.conflict.overflow <= 0, `conflict new intent ${width}`);

    // 6 파일 선택·크기, 취소, 원본 전송
    await page.click("loc=css:main input[type=radio][value=file]");
    await page.click("loc=css:main input[type=radio][value=image]");
    await fx(() => window.__fixture.selectFile("큰 사진.jpg", 4 * 1024 * 1024 + 1));
    await until(() => document.querySelector("main").innerText.includes("업로드는 4 MiB까지 가능해요"), "large file");
    check((await requests()).length === 13 && await fx(() => document.querySelector("form button[type=submit]").disabled &&
      !document.querySelector("form:has(input[type=checkbox])")), `large file and previous result cleared ${width}`);
    await fx(() => window.__fixture.selectFile("검수 사진.jpg", 32));
    await submitAnalysis();
    await untilRequests(14, "raw file");
    const fileRequest = (await requests())[13];
    check(fileRequest.body?.size === 32 && fileRequest.headers["content-type"] === "application/octet-stream" &&
      fileRequest.headers["x-dream-media"] === "image" && fileRequest.headers["x-dream-filename"] === encodeURIComponent("검수 사진.jpg"), `raw file wire ${width}`);
    await page.keyboard.press("Enter");
    await reply(13, 200, { result: READY.image });
    await until(() => document.activeElement?.textContent.includes("권리 확인하고 분석") && window.__fixture.requests()[13].aborted, "canceled file");
    check(!(await fx(() => document.querySelector("form:has(input[type=checkbox])"))), `late file ignored ${width}`);
    await submitAnalysis();
    await untilRequests(15, "raw file retry");
    await reply(14, 200, { result: READY.image });
    await until(() => document.querySelector("main").innerText.includes("#3366cc · 60%"), "raw file success");
    r.steps.file = await state();
    check(r.steps.file.overflow <= 0 && r.steps.file.prompt === "푸른 색이 넓게 퍼진 장면", `file result ${width}`);

    // 7 401 → 멈춤
    await page.click("loc=css:main input[type=radio][value=url]");
    await analyze("https://mdn.github.io/b.png", "image");
    await untilRequests(16, "auth");
    await reply(15, 401);
    await until(() => document.querySelector("main").innerText.includes("다시 로그인이 필요해요"), "login stop");
    r.steps.login = await state();
    check(r.steps.login.inputs === 0 && r.steps.login.text.includes("관리자 로그인") && (await requests()).length === 16, `auth stop ${width}`);
    for (const step of Object.values(r.steps)) delete step.text;
  }
} catch (error) {
  failures.push("exception: " + String(error).slice(0, 1200));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  out.failures = failures;
  out.verdict = failures.length ? "fail" : "pass";
  await fetch(`${origin}/__fixture/done`, { method: "POST", body: JSON.stringify(out) }).catch(() => {});
}
console.log(JSON.stringify(out));
