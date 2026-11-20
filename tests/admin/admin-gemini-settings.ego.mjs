/* global taskSpace, window, document, location, console, setTimeout */
import assert from "node:assert/strict";
// 계정설정 Gemini 키·모델 등록과 연결 시험: admin-premiere-publication-run.mjs가 연 루프백 주소에서 실행한다.
// 서버 응답은 대역(window.__premiere.credentials·credentialFaults·testOutcome·hold)으로 만들고 키는 합성 값만 쓴다.
const base = globalThis.FIXTURE_ORIGIN;
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Gemini settings " + Date.now());
const page = task.page("p1");
const root = "#admin-api-integrations";
const KEYS = { reference: "SYNTHETIC-ONLY-REFERENCE-KEY-1234567890", music: "SYNTHETIC-ONLY-MUSIC-KEY-0987654321" };
const input = (name) => `${root} form input[name="${name}"]`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = () => page.evaluate(() => window.__premiere.requests().filter((row) => row.path.startsWith("/api/admin/analysis-credentials")));
const count = async (method, path = "/api/admin/analysis-credentials") => (await rows()).filter((row) => row.method === method && row.path === path).length;
const fault = (status, body) => page.evaluate(([status, body]) => window.__premiere.credentialFaults.push({ status, body }), [status, body]);
const until = async (fn, label, arg) => { for (let i = 0; i < 60; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const view = () => page.evaluate((root) => {
  const card = document.querySelector(root);
  const form = card.querySelector("form");
  const active = document.activeElement;
  return {
    status: [...card.querySelectorAll("dl dd")].map((node) => node.textContent.replace(/ · 변경.*/, "")),
    keys: [...form.querySelectorAll("input[type=password]")].map((node) => node.name),
    errors: [...form.querySelectorAll("[id$=-error]")].map((node) => node.textContent),
    invalid: [...form.querySelectorAll("[aria-invalid=true]")].map((node) => node.name),
    notice: card.querySelector("[role=status][tabindex='-1']").textContent,
    focus: active === card.querySelector("[role=status][tabindex='-1']") ? "notice" : active?.name || active?.textContent?.trim() || active?.tagName,
    submit: form.querySelector("button[type=submit]").textContent.trim(),
    locked: [...form.querySelectorAll("fieldset")].every((node) => node.disabled),
    tests: [...card.querySelectorAll("section li")].map((li) => ({ state: li.querySelector("[role=status]").textContent.replace(/ · 최근 확인.*/, ""),
      recent: li.querySelector("[role=status] time") !== null, disabled: li.querySelector("button").disabled })),
  };
}, root);
const pressButton = async (text) => {
  await page.evaluate(([root, text]) => [...document.querySelectorAll(`${root} button`)].find((button) => button.textContent.trim() === text).setAttribute("data-press", ""), [root, text]);
  await page.focus(`${root} [data-press]`); await page.keyboard.press("Enter");
  await page.evaluate((root) => document.querySelector(`${root} [data-press]`)?.removeAttribute("data-press"), root); await settle();
};
const save = async () => { await page.focus(`${root} form button[type=submit]`); await page.keyboard.press("Enter"); await settle(); };
const results = [];

try {
  for (const width of [320, 390, 1440]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
    await page.goto(`${base}/admin?gemini=${width}${root}`);
    await until((root) => !!document.querySelector(`${root} form`), "form", root);
    const row = { width };

    // 처음: 읽기 1회, 쓰기 0, 두 키 미등록·입력 열림, 시험 버튼 잠김, 원시 경로 없음
    row.initial = await view();
    assert.equal(await count("GET"), 1); assert.equal(await count("PUT"), 0);
    assert.deepEqual(row.initial.status, ["서버 키 저장소", "미등록", "미등록"]);
    assert.deepEqual(row.initial.keys, ["reference-api-key", "music-api-key"]);
    assert.deepEqual(row.initial.tests.map((item) => [item.state, item.disabled]), [["미등록", true], ["미등록", true], ["미등록", true]]);
    assert.equal(await page.evaluate((root) => /\/api\/|GET |연결됨/.test(document.querySelector(root).innerText), root), false);

    // 바뀐 것 없음 → 안내로 초점 / 키 없이 모델만 → 키 필요 / 잘못된 모델 ID → 그 칸
    await save();
    assert.deepEqual([(await view()).focus, (await view()).notice.startsWith("바뀐 내용이 없어요")], ["notice", true]);
    await page.fill(`loc=css:${input("models.image")}`, "gemini-image-test");
    await save();
    row.keyRequired = await view();
    assert.equal(row.keyRequired.focus, "reference-api-key"); assert.match(row.keyRequired.errors.join(), /처음 저장할 때는 API 키가 필요해요/);
    // 형식이 틀린 키 → 키 칸 형식 안내(요청 없음)
    await page.focus(input("reference-api-key")); await page.keyboard.type("short key");
    await save();
    assert.match((await view()).errors.join(), /키 형식을 확인해 주세요/);
    await page.fill(`loc=css:${input("reference-api-key")}`, "");
    await page.focus(input("reference-api-key")); await page.keyboard.type(KEYS.reference);
    await page.fill(`loc=css:${input("models.image")}`, "models/gemini");
    await page.fill(`loc=css:${input("models.shorts")}`, "gemini-shorts-test");
    await save();
    row.badModel = await view();
    assert.deepEqual([row.badModel.focus, row.badModel.invalid], ["models.image", ["models.image"]]);
    assert.equal(await count("PUT"), 0);

    // 두 묶음 저장: 저장 중 잠금·버튼 문구 → 묶음마다 PUT 1건 → 키 지움·안내 초점·키 저장됨
    await page.fill(`loc=css:${input("models.image")}`, "gemini-image-test");
    await page.focus(input("music-api-key")); await page.keyboard.type(KEYS.music);
    await page.fill(`loc=css:${input("models.music")}`, "gemini-music-test");
    await page.evaluate(() => { window.__premiere.hold = "credentials"; });
    await save();
    row.pending = await view();
    assert.deepEqual([row.pending.submit, row.pending.locked], ["Gemini에서 확인 중", true]);
    await page.evaluate(() => { window.__premiere.hold = ""; window.__premiere.release(); });
    await until((root) => document.querySelector(`${root} form [role=status]`).textContent.startsWith("저장했어요"), "saved", root);
    row.saved = await view();
    assert.deepEqual([row.saved.status, row.saved.keys, row.saved.focus], [["서버 키 저장소", "키 저장됨", "키 저장됨"], [], "notice"]);
    const puts = (await rows()).filter((item) => item.method === "PUT").map((item) => item.body);
    assert.deepEqual(puts, [
      { group: "reference", expectedVersion: 0, apiKey: KEYS.reference, models: { image: "gemini-image-test", shorts: "gemini-shorts-test" } },
      { group: "music", expectedVersion: 0, apiKey: KEYS.music, models: { music: "gemini-music-test" } },
    ]);
    assert.equal(await page.evaluate((keys) => keys.some((key) => document.documentElement.outerHTML.includes(key)), Object.values(KEYS)), false);
    assert.deepEqual(row.saved.tests.map((item) => [item.state, item.disabled]), [["저장됨 · 시험 전", false], ["저장됨 · 시험 전", false], ["저장됨 · 시험 전", false]]);

    // 연결 시험: 성공 → 연결 확인·최근 확인 / 실패 → 원인
    await pressButton("이미지 분석 연결 시험");
    await until((root) => document.querySelector(`${root} section li [role=status]`).textContent.startsWith("연결 확인"), "verified", root);
    assert.deepEqual((await rows()).filter((item) => item.path.endsWith("/test")).map((item) => item.body), [{ program: "image", group: "reference", version: 1 }]);
    await page.evaluate(() => { window.__premiere.testOutcome = { status: "failed", code: "model_not_found" }; });
    await pressButton("쇼츠 분석 연결 시험");
    await settle(300);
    row.tested = (await view()).tests;
    assert.deepEqual(row.tested.map((item) => [item.state, item.recent]), [["연결 확인", true], ["저장됨 · 시험 전", false], ["시험 실패 · 모델 ID 또는 사용 권한 확인", true]]);
    await page.evaluate(() => { window.__premiere.testOutcome = { status: "verified", code: null }; });

    // 다른 탭이 이미지·쇼츠 설정을 1→2로 바꾼 뒤 시험(409) → 최신 설정 다시 읽기·시험 안내 초점, 고치던 쇼츠 칸은 유지,
    // 시험은 자동으로 다시 하지 않음 → 다시 시험은 새 버전 2로 성공
    const tests = async () => (await rows()).filter((item) => item.path.endsWith("/test"));
    const testState = () => page.evaluate((root) => {
      const note = document.querySelector(`${root} section > [role=status]`);
      return { focus: document.activeElement === note, text: note.textContent, buttons: [...document.querySelectorAll(`${root} section li button`)].map((button) => button.disabled),
        retry: [...document.querySelectorAll(`${root} section button`)].some((button) => button.textContent.trim() === "최신 설정 다시 불러오기") };
    }, root);
    await page.fill(`loc=css:${input("models.shorts")}`, "gemini-shorts-editing");
    await page.evaluate(() => { const c = window.__premiere.credentials; c.groups.reference.version += 1; c.programs.image.modelId = "gemini-image-other"; c.programs.image.lastTest = null; c.programs.shorts.lastTest = null; });
    const getsBeforeTest = await count("GET");
    const testsBefore = (await tests()).length;
    await pressButton("이미지 분석 연결 시험");
    await until((root) => document.querySelector(`${root} section > [role=status]`).textContent.startsWith("다른 곳에서 이미지·쇼츠 설정이 바뀌어"), "test stale", root);
    row.testStale = { ...(await testState()), ...(await page.evaluate((root) => ({ model: document.querySelector(`${root} section li span`).textContent,
      image: document.querySelector(`${root} form input[name="models.image"]`).value, shorts: document.querySelector(`${root} form input[name="models.shorts"]`).value }), root)) };
    assert.deepEqual(row.testStale, { focus: true, text: "다른 곳에서 이미지·쇼츠 설정이 바뀌어 최신 설정을 불러왔어요. 저장하지 않은 입력은 그대로 두었어요. 다시 시험해 주세요.",
      buttons: [false, false, false], retry: false, model: "gemini-image-other", image: "gemini-image-other", shorts: "gemini-shorts-editing" });
    assert.deepEqual([await count("GET"), (await tests()).length], [getsBeforeTest + 1, testsBefore + 1]);
    await page.fill(`loc=css:${input("models.shorts")}`, "gemini-shorts-test");
    await pressButton("이미지 분석 연결 시험");
    await until((root) => document.querySelector(`${root} section li [role=status]`).textContent.startsWith("연결 확인"), "retest", root);
    assert.deepEqual((await tests()).at(-1).body, { program: "image", group: "reference", version: 2 });
    assert.equal((await testState()).text, "");

    // 2→3으로 또 바뀐 뒤 시험 409 + 다시 읽기 실패 → 오류 안내 초점·다시 불러오기 버튼, 이미지·쇼츠 시험 잠금(음악은 가능)
    // → 다시 불러오기 성공: 시험은 자동으로 하지 않고 잠금만 풂 → 다시 시험은 버전 3
    await page.evaluate(() => { const c = window.__premiere.credentials; c.groups.reference.version += 1; c.programs.image.lastTest = null; c.programs.shorts.lastTest = null;
      window.__premiere.credentialFaults.push({ status: 409, body: { code: "stale", error: "x" } }, { status: 503, body: { code: "provider_error", error: "x" } }); });
    const getsFailed = await count("GET");
    await pressButton("이미지 분석 연결 시험");
    await until((root) => document.querySelector(`${root} section > [role=status]`).textContent.includes("최신 설정을 불러오지 못했어요"), "refresh failed", root);
    row.refreshFailed = await testState();
    assert.deepEqual([row.refreshFailed.focus, row.refreshFailed.buttons, row.refreshFailed.retry], [true, [true, false, true], true]);
    assert.equal(await count("GET"), getsFailed + 1);
    const testsAfterFail = (await tests()).length;
    await pressButton("최신 설정 다시 불러오기");
    await until((root) => document.querySelector(`${root} section > [role=status]`).textContent === "다른 곳에서 이미지·쇼츠 설정이 바뀌어 최신 설정을 불러왔어요. 다시 시험해 주세요.", "refresh retry", root);
    row.refreshRetried = await testState();
    assert.deepEqual([row.refreshRetried.focus, row.refreshRetried.buttons, row.refreshRetried.retry], [true, [false, false, false], false]);
    assert.deepEqual([await count("GET"), (await tests()).length], [getsFailed + 2, testsAfterFail]);
    await pressButton("이미지 분석 연결 시험");
    await until((root) => document.querySelector(`${root} section li [role=status]`).textContent.startsWith("연결 확인"), "retest 3", root);
    assert.deepEqual((await tests()).at(-1).body, { program: "image", group: "reference", version: 3 });

    // 시험 중에 설정을 바꿔 저장하면, 늦게 온 이전 버전 시험 결과는 쓰지 않는다
    await page.evaluate(() => { window.__premiere.hold = "credential-test"; });
    await pressButton("음악 분석 연결 시험");
    assert.equal((await view()).tests[1].state, "시험 중");
    await page.evaluate(() => { window.__premiere.hold = ""; });
    await page.fill(`loc=css:${input("models.music")}`, "gemini-music-next");
    await save();
    await until((root) => document.querySelector(`${root} form [role=status]`).textContent === "저장했어요. Gemini에서 모델 정보를 확인했어요. 아래에서 연결 시험을 해 보세요.", "music v2", root);
    await page.evaluate(() => window.__premiere.release()); await settle(300);
    row.late = (await view()).tests[1].state;
    assert.equal(row.late, "설정이 바뀌어 다시 시험 필요");
    assert.deepEqual((await rows()).filter((item) => item.method === "PUT").at(-1).body, { group: "music", expectedVersion: 1, models: { music: "gemini-music-next" } });

    // 한 묶음만 저장: 다른 탭이 음악 설정을 먼저 바꿨다면 이미지·쇼츠만 저장하고 최신 설정을 다시 읽는다
    const getsBefore = await count("GET");
    await page.evaluate(() => { window.__premiere.credentials.groups.music.version += 1; });
    await page.fill(`loc=css:${input("models.shorts")}`, "gemini-shorts-next");
    await page.fill(`loc=css:${input("models.music")}`, "gemini-music-third");
    await save();
    await until((root) => document.querySelector(`${root} form [role=status]`).textContent.startsWith("이미지·쇼츠 설정은 저장했어요. 다른 곳에서"), "partial", root);
    assert.equal((await view()).focus, "notice"); assert.equal(await count("GET"), getsBefore + 1);

    // 키 교체 → Gemini가 키 거부(422): 키 칸 오류·초점, 저장 상태 유지
    await pressButton("이미지·쇼츠 키 교체");
    assert.equal((await view()).focus, "reference-api-key");
    await page.keyboard.type("SYNTHETIC-ONLY-REJECTED-KEY");
    await fault(422, { code: "invalid_key", error: "x", field: "apiKey" });
    await save();
    row.rejected = await view();
    assert.deepEqual([row.rejected.focus, row.rejected.invalid, row.rejected.status[1]], ["reference-api-key", ["reference-api-key"], "키 저장됨"]);
    assert.match(row.rejected.errors.join(), /받아들이지 않았어요/);

    // 저장소 없음 / Gemini 오류 / 시간 초과 / 형식 거절(415) → 안내 초점
    for (const [status, body, text] of [
      [503, { code: "storage_unavailable", error: "x" }, "서버의 키 저장소가 준비되지 않아"],
      [503, { code: "provider_error", error: "x" }, "Gemini가 응답하지 않아"],
      [504, { code: "timed_out", error: "x" }, "Gemini 확인이 늦어져"],
      [415, { code: "UNSUPPORTED_MEDIA_TYPE", error: "x" }, "저장하지 못했어요. 연결을 확인한 뒤"],
    ]) {
      await fault(status, body); await save();
      await until(([root, text]) => document.querySelector(`${root} form [role=status]`).textContent.startsWith(text), `notice ${status}`, [root, text]);
      assert.equal((await view()).focus, "notice", String(status));
    }

    // 저장 중 다른 메뉴로 떠나면 요청 취소, 돌아오면 서버 상태를 다시 읽고 키 입력은 비어 있음
    await page.evaluate(() => { window.__premiere.hold = "credentials"; });
    await save();
    await page.evaluate(() => { location.hash = "#admin-overview"; }); await settle(300);
    row.leftAborted = (await rows()).filter((item) => item.method === "PUT").at(-1).aborted;
    assert.equal(row.leftAborted, true);
    await page.evaluate(() => { window.__premiere.hold = ""; window.__premiere.release(); });
    await page.evaluate((hash) => { location.hash = hash; }, root);
    await until((root) => !!document.querySelector(`${root} form`), "back", root);
    assert.deepEqual([(await view()).keys, (await view()).notice], [[], ""]);

    // 로그인 만료(401) → 폼을 닫고 이 화면으로 돌아오는 로그인 링크
    await page.fill(`loc=css:${input("models.image")}`, "gemini-image-login");
    await fault(401, { code: "AUTH_REQUIRED", error: "x" });
    await save();
    row.login = await page.evaluate((root) => ({ form: !!document.querySelector(`${root} form`), link: document.querySelector(`${root} a[href^="/admin/login"]`)?.getAttribute("href") }), root);
    assert.deepEqual(row.login, { form: false, link: "/admin/login?next=%2Fadmin%23admin-api-integrations" });

    // 저장소가 없는 배포: 상태는 보이고 입력·저장은 막힘
    await page.evaluate(() => { window.__premiere.credentials.storage = "unavailable"; location.hash = "#admin-overview"; }); await settle(200);
    await page.evaluate((hash) => { location.hash = hash; }, root);
    await until((root) => !!document.querySelector(`${root} form`), "storage", root);
    // 메뉴 이동이 머리글로 초점을 옮기는 동작이 끝난 뒤 누른다(늦게 오면 버튼이 옮긴 초점을 덮음).
    await until((root) => document.activeElement === document.querySelector(`${root}-title`), "heading focus", root);
    row.storage = await view();
    assert.equal(row.storage.locked, true); assert.equal(row.storage.status[0], "서버 키 저장소 미연결");
    assert.equal(await page.evaluate((root) => !!document.querySelector(`${root} a[href="#admin-manual"]`), root), true);
    // 저장소 다시 확인: 아직 없으면 경고 안내, 연결되면 저장 가능 안내와 입력 열림(GET 1회씩)
    const getsStorage = await count("GET");
    await pressButton("저장소 다시 확인");
    await until((root) => document.querySelector(`${root} [role=status][tabindex='-1']`).textContent.includes("아직 연결되지 않았어요"), "recheck", root);
    assert.deepEqual([(await view()).focus, await count("GET")], ["notice", getsStorage + 1]);
    row.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(row.overflow, 0);
    await page.evaluate(() => { window.__premiere.credentials.storage = "ready"; });
    await pressButton("저장소 다시 확인");
    await until((root) => document.querySelector(`${root} form [role=status]`)?.textContent === "저장소에 연결됐어요. 이제 저장할 수 있어요.", "recheck ok", root);
    assert.deepEqual([(await view()).focus, (await view()).locked, (await view()).status[0]], ["notice", false, "서버 키 저장소"]);
    await page.evaluate(() => { location.hash = "#admin-overview"; }); await settle(200);
    await page.evaluate((hash) => { location.hash = hash; }, root);
    await until((root) => !!document.querySelector(`${root} form`), "shot", root);
    if (globalThis.FIXTURE_OUTPUT_DIR) await page.screenshot({ path: `${globalThis.FIXTURE_OUTPUT_DIR}/gemini-settings-${width}.png`, fullPage: true });
    results.push({ width, overflow: row.overflow, puts: await count("PUT"), tests: await count("POST", "/api/admin/analysis-credentials/test"), gets: await count("GET") });
  }
  console.log("GEMINI-SETTINGS-RESULT" + JSON.stringify(results));
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
