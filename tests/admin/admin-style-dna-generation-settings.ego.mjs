/* global taskSpace, window, document, location, console, setTimeout, Event, sessionStorage, localStorage, performance */
import assert from "node:assert/strict";
// P2-02-STYLE-DNA-SEEDREAM-CREDENTIAL-UI: API키등록·플랫폼연동 화면의 BytePlus(Seedream 5.5) 생성 키 카드.
// 실행: node tests/admin/admin-premiere-publication-run.mjs → "PREMIERE-READY <주소>" →
//   ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<주소>"; globalThis.FIXTURE_OUTPUT_DIR = "<사진 폴더>"; await import("file:///…/tests/admin/admin-style-dna-generation-settings.ego.mjs")'
// 그 대역은 생성 키·분석 엔진 키 경로를 모르므로(404), 문서 시작 스크립트가 대역의 window.fetch를 한 겹 감싸 두 경로에만 합성 응답을 준다.
//   GET  /api/admin/style-dna/generation-credentials → { providers: { byteplus: { configured, version, updatedAt } } }
//   PUT  { provider, expectedVersion, apiKey } → 버전이 다르면 409, 맞으면 버전+1. 다음 응답 오류는 __gen.faults로 넣는다.
// 단계(1280·390 각각): 1 미등록 표시·분석 엔진 카드 유지·목록 조회 0 / 2 빈 키·형식 오류 / 3 등록(보내는 동안 잠금·칸 비움) → 등록됨·버전 1
//   4 교체 취소 → 동시 갱신 409 → 최신 상태 다시 읽기 → 교체 성공 / 5 저장소 503 → 다시 불러오기, 형식 거절 422, 요청 제한 429,
//     결과 불명 504(서버는 저장함) → 잠금 → GET으로 버전 4 확인 뒤에만 다시 저장 가능 / 6 첫 조회 실패·로그인 끝남.
// 모든 단계에서 합성 키가 문서·입력 칸·브라우저 저장소·응답에 남지 않는지, 이미지 분석기 목록(/api/admin/style-dna) 요청이 없는지 본다.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Seedream generation key " + Date.now());
const page = task.page("p1");
const KEYS = ["SYNTHETIC_ONLY_BYTEPLUS_KEY_0001", "SYNTHETIC_ONLY_BYTEPLUS_KEY_0002", "SYNTHETIC_ONLY_BYTEPLUS_KEY_0003", "SYNTHETIC_ONLY_BYTEPLUS_KEY_0004"];
const CARD = `document.querySelector("[data-kind='generation'][data-provider='byteplus']")`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const mark = async (expression, key = "Enter") => {
  const found = await page.evaluate((expression) => { const node = eval(expression); if (!node) return false; node.setAttribute("data-press", ""); return true; }, expression);
  assert.ok(found, expression.slice(0, 160));
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")).catch(() => {}); await settle(250);
};
const press = (text) => mark(`[...(${CARD}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`);
const submit = () => mark(`(${CARD}).querySelector("form button[type=submit]")`);
const typeKey = (value) => page.evaluate(([CARD, value]) => {
  const input = eval(CARD).querySelector("input[type=password]");
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, [CARD, value]);
const view = () => page.evaluate(([CARD, KEYS]) => {
  const card = eval(CARD);
  const form = card.querySelector("form");
  const active = document.activeElement;
  const html = document.documentElement.outerHTML;
  const stores = (() => { try { return JSON.stringify([Object.entries(sessionStorage), Object.entries(localStorage)]); } catch { return ""; } })();
  const inputs = [...document.querySelectorAll("input")].map((input) => input.value).join("\n");
  const engine = (provider) => document.querySelector(`[data-provider='${provider}']:not([data-kind])`);
  return {
    badge: card.querySelector("[aria-label='BytePlus ModelArk 등록 상태']")?.textContent ?? null,
    heading: card.querySelector("h4")?.textContent ?? null,
    password: form ? form.querySelectorAll("input[type=password]").length : -1,
    keyValue: form?.querySelector("input[type=password]")?.value ?? null,
    error: form?.querySelector("[id$='-key-error']")?.textContent ?? null,
    notice: card.querySelector("[role=status][tabindex='-1']")?.textContent ?? null,
    status: form ? null : card.querySelector("[role=status]")?.textContent ?? null,
    locked: form ? [...form.querySelectorAll("fieldset")].every((node) => node.disabled) : null,
    buttons: [...card.querySelectorAll("button")].map((button) => [button.textContent.trim(), button.disabled]),
    focus: active === card.querySelector("[role=status][tabindex='-1']") ? "notice" : active?.type === "password" ? "key" : active?.textContent?.trim() || active?.tagName,
    model: form?.querySelector("[data-form-part='models'] p")?.textContent ?? null,
    leak: KEYS.filter((key) => html.includes(key) || stores.includes(key) || inputs.includes(key)),
    engines: { openai: engine("openai")?.querySelector("[role=status]")?.textContent ?? null, anthropic: engine("anthropic")?.querySelector("[role=status]")?.textContent ?? null },
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    external: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => !name.startsWith(location.origin) && !/^(data|blob):/.test(name)),
  };
}, [CARD, KEYS]);
const gen = () => page.evaluate(() => window.__gen.rows.map(({ method, status, body, reply }) => ({ method, status, body, reply })));
const listCalls = () => page.evaluate(() => [...window.__gen.others, ...window.__premiere.requests().map((row) => row.path)]
  .filter((path) => /^\/api\/admin\/style-dna(?:$|[/?])/.test(path) && !/\/(generation|engine)-credentials$/.test(path)));
// 위쪽 고정 메뉴 높이만큼 내려 카드 머리가 가려지지 않게 찍는다.
const shot = async (name) => { await page.evaluate(`(() => { const card = ${CARD}; const bar = [...document.querySelectorAll("header, nav")].filter((node) => getComputedStyle(node).position === "sticky" || getComputedStyle(node).position === "fixed").reduce((max, node) => Math.max(max, node.getBoundingClientRect().bottom), 0); window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top - bar - 12); })()`); await settle(300); await page.screenshot({ path: `${out}/${name}` }); };

// 문서 시작 스크립트: 대역(admin-premiere-publication-run.mjs)이 window.fetch를 덮어쓰면 그 함수를 inner로 받아 두고,
// 생성 키·분석 엔진 키 경로만 여기서 답한다. 대역이 자기 realFetch로 잡는 값은 브라우저 원래 fetch다(되돌아 들어오지 않음).
await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const native = window.fetch;
  let inner = null;
  const first = new URLSearchParams(location.search).get("gen");
  const withBfl = new URLSearchParams(location.search).get("bfl") === "1";
  const withOpenai = new URLSearchParams(location.search).get("openai") === "1";
  const G = window.__gen = { state: { byteplus: { configured: false, version: 0, updatedAt: null },
    ...(withBfl && { bfl: { configured: false, version: 0, updatedAt: null } }),
    ...(withOpenai && { openai: { configured: false, version: 0, updatedAt: null } }) }, faults: [], hold: false, rows: [], others: [], release: null,
    initial: first === "storage" ? { status: 503, body: { code: "storage_unavailable" } } : first === "login" ? { status: 401, body: { error: "AUTH_REQUIRED" } }
      : first === "forbidden" ? { status: 403, body: { error: "FORBIDDEN" } } : null };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const stamp = () => new Date(Date.UTC(2026, 10, 25, 9, G.rows.length)).toISOString();
  const handle = async (raw, init) => {
    const href = typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url;
    const path = href.startsWith("http") ? new URL(href).pathname : href.split("?")[0];
    const method = (init && init.method) || "GET";
    if (path === "/api/admin/style-dna/engine-credentials") {
      return json({ providers: { openai: { configured: true, modelId: "gpt-fixture-vision", version: 2, updatedAt: "2026-11-24T00:00:00.000Z" },
        anthropic: { configured: false, modelId: null, version: 0, updatedAt: null } } });
    }
    if (path === "/api/admin/style-dna/generation-credentials") {
      const body = init && init.body ? JSON.parse(String(init.body)) : null;
      const row = { method, body, status: 0, reply: null, credentials: init && init.credentials, cache: init && init.cache };
      G.rows.push(row);
      const send = (value, status = 200) => { row.status = status; row.reply = value; return json(value, status); };
      if (method === "GET" && G.initial) { const fault = G.initial; G.initial = null; return send(fault.body, fault.status); }
      if (method === "PUT" && G.hold) await new Promise((resolve) => { G.release = resolve; });
      const fault = G.faults.shift();
      // commit: 서버가 저장을 끝냈지만 응답이 504로 끝난 경우(결과 불명)를 흉내 낸다.
      if (fault && fault.commit && method === "PUT" && body && body.expectedVersion === G.state.byteplus.version) G.state.byteplus = { configured: true, version: body.expectedVersion + 1, updatedAt: stamp() };
      if (fault) return send(fault.body, fault.status);
      if (method === "GET") return send({ providers: Object.fromEntries(Object.entries(G.state).map(([name, value]) => [name, { ...value }])) });
      if (method === "PUT") {
        if (!body || !(body.provider in G.state) || typeof body.apiKey !== "string" || Object.keys(body).sort().join() !== "apiKey,expectedVersion,provider") return send({ code: "invalid_input" }, 400);
        if (body.expectedVersion !== G.state[body.provider].version) return send({ code: "stale" }, 409);
        G.state[body.provider] = { configured: true, version: body.expectedVersion + 1, updatedAt: stamp() };
        return send({ provider: body.provider, setting: { ...G.state[body.provider] } });
      }
      return send({ code: "not_found" }, 404);
    }
    if (path.startsWith("/api/")) G.others.push(path);
    return inner(raw, init);
  };
  Object.defineProperty(window, "fetch", { configurable: true, get: () => inner ? handle : native, set: (fn) => { inner = fn; } });
})();` });

const open = async (query = "") => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?${query}#admin-api-integrations`);
  await until((CARD) => { const card = eval(CARD); return !!card && !/불러오고 있어요/.test(card.textContent); }, "generation card", CARD);
  await settle(200);
};
const results = [];
try {
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    console.log("STEP 1 " + width);
    await open(`w=${width}`);
    let v = await view();
    assert.deepEqual([v.heading, v.badge, v.password, v.notice], ["BytePlus ModelArk 생성 키", "등록 안 됨", 1, ""]);
    assert.match(v.model ?? "", /^Seedream 5\.5\(ByteDance\) · dola-seedream-5-5-261028 · 1024×1024 고정이에요/);
    assert.deepEqual(v.engines, { openai: "등록됨", anthropic: "등록 안 됨" }, "분석 엔진 카드 유지");
    assert.equal(await page.evaluate(() => !!document.querySelector("[data-provider-heading] h4") && [...document.querySelectorAll("h4")].some((h) => h.textContent === "Gemini 키·모델")), true, "Gemini 카드 유지");
    const order = await page.evaluate(() => { const h = [...document.querySelectorAll("h3")].map((node) => node.textContent);
      const card = document.querySelector("[data-kind='generation']"); const section = card.closest("section"); return [section.querySelector("h3").textContent, h.indexOf("AI 분석 엔진") < h.indexOf("이미지·음악·영상 생성 API")]; });
    assert.deepEqual(order, ["이미지·음악·영상 생성 API", true], "생성 API 절 안");
    // 허브 화면은 열릴 때 자기 패널 자료를 읽을 수 있다. 이 카드의 계약은 '저장이 목록 조회를 새로 일으키지 않음'이라 열린 직후 수를 기준으로 삼는다.
    const listAtOpen = await listCalls();
    console.log("LIST-AT-OPEN " + JSON.stringify(listAtOpen));
    let rows = await gen();
    assert.deepEqual(rows.map((row) => [row.method, row.status]), [["GET", 200]]);
    assert.deepEqual(await page.evaluate(() => [window.__gen.rows[0].credentials, window.__gen.rows[0].cache]), ["same-origin", "no-store"]);
    await shot(`generation-unregistered-${width}.png`);

    console.log("STEP 2 " + width);
    await submit();
    v = await view();
    assert.deepEqual([v.error, v.focus], ["API 키를 입력해 주세요.", "key"]);
    await typeKey("short key");
    await submit();
    v = await view();
    assert.equal(v.error, "API 키의 형식을 확인해 주세요.");
    assert.equal((await gen()).filter((row) => row.method === "PUT").length, 0, "형식 오류는 보내지 않음");

    console.log("STEP 3 " + width);
    await typeKey(KEYS[0]);
    await page.evaluate(() => { window.__gen.hold = true; });
    await submit();
    await until(() => window.__gen.rows.some((row) => row.method === "PUT"), "held put");
    v = await view();
    assert.deepEqual([v.locked, v.keyValue, v.leak], [true, "", []], "보내는 동안 잠금·칸 비움·키 흔적 없음");
    assert.ok(v.buttons.some(([text, disabled]) => text === "저장 중" && disabled), JSON.stringify(v.buttons));
    await page.evaluate(() => { window.__gen.hold = false; window.__gen.release(); });
    await until((CARD) => /등록됨/.test(eval(CARD).querySelector("[aria-label='BytePlus ModelArk 등록 상태']").textContent), "registered", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.password, v.focus, v.leak], ["등록됨 · 버전 1", 0, "notice", []]);
    assert.equal(v.notice, "BytePlus ModelArk 키를 저장했어요(등록 버전 1). 이미지 분석기를 다시 열면 결과 테스트에 Seedream 5.5가 나타나요.");
    assert.ok(v.buttons.some(([text]) => text === "API 키 교체"));
    assert.ok(v.buttons.some(([text, disabled]) => text === "저장" && disabled), "저장된 상태에서는 저장 단추 잠금");
    rows = await gen();
    assert.deepEqual(rows.at(-1).body, { provider: "byteplus", expectedVersion: 0, apiKey: KEYS[0] });
    assert.ok(rows.every((row) => !JSON.stringify(row.reply).includes(KEYS[0])), "응답에 키 없음");
    assert.deepEqual(rows.map((row) => row.method), ["GET", "PUT"], "저장 뒤 다시 읽기 없음");
    assert.deepEqual(await listCalls(), listAtOpen, "저장·교체가 이미지 분석기 목록 조회를 새로 일으키지 않음");
    await shot(`generation-registered-${width}.png`);

    console.log("STEP 4 " + width);
    await press("API 키 교체");
    v = await view();
    assert.deepEqual([v.password, v.focus], [1, "key"]);
    await typeKey(KEYS[1]);
    await press("교체 취소");
    v = await view();
    assert.deepEqual([v.password, v.focus, v.leak], [0, "API 키 교체", []], "교체 취소: 칸 사라짐·초점 복귀·키 흔적 없음");
    // 다른 곳(다른 탭·다른 관리자 화면)에서 키가 바뀌어 서버 버전이 2가 됨 → 이 화면은 아직 1을 보냄
    await page.evaluate(() => { window.__gen.state.byteplus = { configured: true, version: 2, updatedAt: "2026-11-25T10:00:00.000Z" }; });
    await press("API 키 교체");
    await typeKey(KEYS[1]);
    await submit();
    await until((CARD) => /다른 곳에서 키를 바꿨어요/.test(eval(CARD).textContent), "stale", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.password, v.focus, v.leak], ["등록됨 · 버전 2", 0, "notice", []]);
    assert.equal(v.notice, "다른 곳에서 키를 바꿨어요. 최신 등록 상태를 불러왔으니 확인한 뒤 다시 입력해 주세요.");
    rows = await gen();
    assert.deepEqual(rows.slice(-2).map((row) => [row.method, row.status]), [["PUT", 409], ["GET", 200]]);
    assert.equal(rows.at(-2).body.expectedVersion, 1);
    await press("API 키 교체");
    await typeKey(KEYS[2]);
    await submit();
    await until((CARD) => /버전 3/.test(eval(CARD).textContent), "rotated", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.leak], ["등록됨 · 버전 3", []]);
    assert.deepEqual((await gen()).at(-1).body, { provider: "byteplus", expectedVersion: 2, apiKey: KEYS[2] });
    await shot(`generation-rotated-${width}.png`);

    console.log("STEP 5 " + width);
    await page.evaluate(() => window.__gen.faults.push({ status: 503, body: { code: "storage_unavailable" } }));
    await press("API 키 교체");
    await typeKey(KEYS[3]);
    await submit();
    await until((CARD) => /서버 키 저장소에 연결하지 못했어요/.test(eval(CARD).textContent), "storage", CARD);
    v = await view();
    assert.deepEqual([v.locked, v.leak, v.keyValue], [true, [], ""]);
    assert.ok(v.buttons.some(([text]) => text === "최신 등록 상태 다시 불러오기"));
    await press("최신 등록 상태 다시 불러오기");
    await until((CARD) => /최신 등록 상태를 불러왔어요/.test(eval(CARD).textContent), "reloaded", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.password, v.locked], ["등록됨 · 버전 3", 0, false]);
    await page.evaluate(() => window.__gen.faults.push({ status: 422, body: { code: "invalid_key", error: "SYNTHETIC_ONLY_BYTEPLUS_KEY_0004" } }));
    await press("API 키 교체");
    await typeKey(KEYS[3]);
    await submit();
    await until((CARD) => /서버가 API 키 형식을 받아들이지 않았어요/.test(eval(CARD).textContent), "rejected", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.keyValue, v.leak, v.locked], ["등록됨 · 버전 3", "", [], false], "거절된 키는 칸·문서·응답 문구에 남지 않음");
    assert.equal(v.notice, "서버가 API 키 형식을 받아들이지 않았어요. BytePlus ModelArk에서 발급한 키를 앞뒤 공백 없이 그대로 붙여 넣었는지 확인해 주세요.");
    assert.doesNotMatch(v.notice, /BytePlus ModelArk가|플랫폼이/, "공급자에 보내 확인한 것처럼 쓰지 않음");
    // 429: 서버가 이번 저장을 받지 않음 → 잠그지 않고 다시 입력해 저장할 수 있음, 상태 그대로, 다시 읽기 없음
    await page.evaluate(() => window.__gen.faults.push({ status: 429, body: { code: "rate_limited" } }));
    await typeKey(KEYS[3]);
    await submit();
    await until((CARD) => /이번 저장을 처리하지 않았어요/.test(eval(CARD).textContent), "rate limited", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.keyValue, v.leak, v.locked, v.password], ["등록됨 · 버전 3", "", [], false, 1]);
    assert.equal(v.notice, "등록 요청이 많아 서버가 이번 저장을 처리하지 않았어요. 이번에 입력한 키는 저장되지 않았으니 잠시 뒤 다시 입력해 저장해 주세요.");
    assert.deepEqual((await gen()).slice(-1).map((row) => [row.method, row.status]), [["PUT", 429]], "429 뒤 자동 다시 읽기·재전송 없음");
    // 504: 서버는 저장(버전 4)했지만 응답이 시간 초과 → 결과 불명. 잠그고 GET으로 상태 확인 뒤에만 다시 저장.
    await page.evaluate(() => window.__gen.faults.push({ status: 504, body: { code: "timed_out" }, commit: true }));
    await typeKey(KEYS[3]);
    await submit();
    await until((CARD) => /결과를 확인하지 못했어요\(시간 초과\)/.test(eval(CARD).textContent), "timed out", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.keyValue, v.leak, v.locked], ["등록됨 · 버전 3", "", [], true], "결과 불명: 칸 잠금");
    assert.equal(v.notice, "저장 요청의 결과를 확인하지 못했어요(시간 초과). 키가 저장됐을 수 있으니 다시 저장하기 전에 최신 등록 상태를 불러와 확인해 주세요.");
    assert.ok(v.buttons.some(([text]) => text === "최신 등록 상태 다시 불러오기") && !v.buttons.some(([text]) => text === "저장"), "다시 저장 단추 대신 다시 불러오기");
    const putsBefore = (await gen()).filter((row) => row.method === "PUT").length;
    await submit().catch(() => {});
    assert.equal((await gen()).filter((row) => row.method === "PUT").length, putsBefore, "확인 전 다시 저장 불가");
    await shot(`generation-timeout-locked-${width}.png`);
    await press("최신 등록 상태 다시 불러오기");
    await until((CARD) => /최신 등록 상태를 불러왔어요/.test(eval(CARD).textContent), "reloaded after timeout", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.password, v.locked, v.leak], ["등록됨 · 버전 4", 0, false, []], "GET으로 서버가 저장한 버전 4 확인");
    assert.deepEqual((await gen()).slice(-2).map((row) => [row.method, row.status]), [["PUT", 504], ["GET", 200]]);
    await shot(`generation-timeout-reloaded-${width}.png`);
    assert.deepEqual(await listCalls(), listAtOpen, "저장·교체가 이미지 분석기 목록 조회를 새로 일으키지 않음");
    assert.equal(v.overflow, 0, `넘침 ${width}`);
    assert.deepEqual(v.external, [], "외부 요청 0");
    const engineWrites = await page.evaluate(() => window.__premiere.requests().filter((row) => row.method !== "GET" && /credentials/.test(row.path)).length);
    assert.equal(engineWrites, 0, "분석 엔진·Gemini 키 쓰기 0");

    console.log("STEP 6 " + width);
    await open(`gen=storage&w=${width}`);
    v = await view();
    assert.equal(v.status, "이미지 생성 키 저장소에 연결할 수 없어요.");
    assert.deepEqual(v.engines, { openai: "등록됨", anthropic: "등록 안 됨" }, "생성 키 조회 실패가 분석 엔진 카드에 번지지 않음");
    await shot(`generation-storage-${width}.png`);
    await press("다시 불러오기");
    await until((CARD) => !!eval(CARD).querySelector("form"), "retry form", CARD);
    v = await view();
    assert.deepEqual([v.badge, v.password], ["등록 안 됨", 1]);
    await open(`gen=login&w=${width}`);
    v = await view();
    assert.match(v.status ?? "", /^로그인이 끝났어요\./);
    assert.equal(await page.evaluate((CARD) => eval(CARD).querySelector("a[href^='/admin/login']")?.getAttribute("href"), CARD), "/admin/login?next=%2Fadmin%2Fintegrations");
    await open(`gen=forbidden&w=${width}`);
    assert.equal((await view()).status, "이 계정에는 생성 키 설정을 볼 권한이 없어요.");
    console.log("STEP 7 BFL 카드 " + width);
    // 서버가 bfl을 내지 않는 기본 응답에서는 BFL 카드가 없다(STEP 1~6 전부 이 상태).
    await open(`w=${width}`);
    assert.equal(await page.evaluate(() => document.querySelectorAll("[data-kind='generation']").length), 1, "bfl 미응답: BytePlus 카드만");
    await open(`bfl=1&w=${width}`);
    const BFL = `document.querySelector("[data-kind='generation'][data-provider='bfl']")`;
    const bflView = () => page.evaluate((BFL) => { const card = eval(BFL); return {
      heading: card.querySelector("h4")?.textContent, docs: card.querySelector("a[href^='https://docs.bfl.ai']")?.getAttribute("href") ?? null,
      badge: card.querySelector("[aria-label='Black Forest Labs 등록 상태']")?.textContent ?? null,
      notice: card.querySelector("[role=status][tabindex='-1']")?.textContent ?? null,
      model: card.querySelector("form [data-form-part='models'] p")?.textContent ?? null,
      byteplus: document.querySelector("[aria-label='BytePlus ModelArk 등록 상태']")?.textContent ?? null,
      cards: [...document.querySelectorAll("[data-kind='generation']")].map((node) => node.getAttribute("data-provider")),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }; }, BFL);
    let b = await bflView();
    assert.deepEqual(b.cards, ["byteplus", "bfl"]);
    assert.deepEqual([b.heading, b.docs, b.badge, b.byteplus], ["Black Forest Labs 생성 키", "https://docs.bfl.ai/", "등록 안 됨", "등록 안 됨"]);
    assert.equal(b.overflow, 0, "두 카드 가로 넘침 0");
    const bflSubmit = () => mark(`(${BFL}).querySelector("form button[type=submit]")`);
    const bflType = (value) => page.evaluate(([BFL, value]) => {
      const input = eval(BFL).querySelector("input[type=password]");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, [BFL, value]);
    // 형식 거절 422: 발급처가 BFL로 안내된다
    await page.evaluate(() => { window.__gen.faults.push({ status: 422, body: { code: "invalid_key" } }); });
    await bflType(KEYS[1]);
    await bflSubmit();
    await until((BFL) => /Black Forest Labs에서 발급한 키/.test(eval(BFL).textContent), "bfl 422", BFL);
    // 저장 성공: provider bfl·버전 1, BytePlus 카드는 그대로
    await bflType(KEYS[2]);
    await bflSubmit();
    await until((BFL) => /등록됨/.test(eval(BFL).querySelector("[aria-label='Black Forest Labs 등록 상태']").textContent), "bfl registered", BFL);
    b = await bflView();
    assert.deepEqual([b.badge, b.byteplus], ["등록됨 · 버전 1", "등록 안 됨"], "BFL 저장이 BytePlus 카드에 번지지 않음");
    assert.equal(b.notice, "Black Forest Labs 키를 저장했어요(등록 버전 1). 이미지 분석기를 다시 열면 결과 테스트에 FLUX.2 pro가 나타나요.");
    const puts = (await gen()).filter((row) => row.method === "PUT");
    assert.deepEqual(puts.map((row) => [row.body.provider, row.body.expectedVersion, row.status]), [["bfl", 0, 422], ["bfl", 0, 200]]);
    v = await view();
    assert.deepEqual(v.leak, [], "BFL 합성 키 흔적 없음");
    assert.deepEqual(v.external, [], "외부 요청 0");
    await page.evaluate((BFL) => eval(BFL).scrollIntoView({ block: "start" }), BFL);
    await page.screenshot({ path: `${out}/generation-bfl-${width}.png` }).catch((error) => console.log("SHOT-FAIL " + String(error.message).slice(0, 60)));

    console.log("STEP 8 OpenAI 생성 키 카드 " + width);
    // P2-02-STYLE-DNA-GPT-IMAGE-UI F3(서버 4ba5eecc): 응답에 openai가 있으면 세 번째 카드. 분석 엔진 OpenAI 키와 별개 안내, 저장은 provider openai만.
    await open(`bfl=1&openai=1&w=${width}`);
    const OAI = `document.querySelector("[data-kind='generation'][data-provider='openai']")`;
    const oaiView = () => page.evaluate((OAI) => { const card = eval(OAI); return {
      heading: card.querySelector("h4")?.textContent, docs: card.querySelector("a[href='https://platform.openai.com/api-keys']")?.textContent ?? null,
      note: [...card.querySelectorAll("p")].some((node) => node.textContent === "분석 엔진 OpenAI 키와 따로 등록·버전 관리돼요. 같은 키 값을 넣어도 돼요."),
      badge: card.querySelector("[aria-label='OpenAI 등록 상태']")?.textContent ?? null,
      notice: card.querySelector("[role=status][tabindex='-1']")?.textContent ?? null,
      others: ["BytePlus ModelArk", "Black Forest Labs"].map((name) => document.querySelector(`[aria-label='${name} 등록 상태']`)?.textContent ?? null),
      cards: [...document.querySelectorAll("[data-kind='generation']")].map((node) => node.getAttribute("data-provider")),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }; }, OAI);
    let o = await oaiView();
    assert.deepEqual(o.cards, ["byteplus", "bfl", "openai"]);
    assert.deepEqual([o.heading, o.docs, o.note, o.badge], ["OpenAI 생성 키", "OpenAI API 키 발급 ↗", true, "등록 안 됨"]);
    assert.equal(o.overflow, 0, "세 카드 가로 넘침 0");
    await page.evaluate(([OAI, value]) => {
      const input = eval(OAI).querySelector("input[type=password]");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, [OAI, KEYS[2]]);
    await mark(`(${OAI}).querySelector("form button[type=submit]")`);
    await until((OAI) => /등록됨/.test(eval(OAI).querySelector("[aria-label='OpenAI 등록 상태']").textContent), "openai registered", OAI);
    o = await oaiView();
    assert.deepEqual([o.badge, o.others], ["등록됨 · 버전 1", ["등록 안 됨", "등록 안 됨"]], "OpenAI 저장이 다른 카드에 번지지 않음");
    assert.equal(o.notice, "OpenAI 키를 저장했어요(등록 버전 1). 이미지 분석기를 다시 열면 결과 테스트에 GPT Image 2.6 · sunburst가 나타나요.");
    const oaiPuts = (await gen()).filter((row) => row.method === "PUT");
    assert.deepEqual(oaiPuts.map((row) => [row.body.provider, row.body.expectedVersion, row.status]), [["openai", 0, 200]]);
    v = await view();
    assert.deepEqual(v.leak, [], "OpenAI 합성 키 흔적 없음");
    assert.deepEqual(v.external, [], "외부 요청 0");
    await page.evaluate((OAI) => eval(OAI).scrollIntoView({ block: "start" }), OAI);
    await page.screenshot({ path: `${out}/generation-openai-${width}.png` }).catch((error) => console.log("SHOT-FAIL " + String(error.message).slice(0, 60)));

    results.push({ width, overflow: 0, external: 0, putBodies: (await gen()).length });
  }
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  await task.finish({ keep: [] });
}
console.log("STYLE-DNA-GENERATION-KEY-RESULT" + JSON.stringify(results));
