/* global taskSpace, window, document, console, setTimeout, Event, sessionStorage, DataTransfer, File, performance, location */
import assert from "node:assert/strict";
// P2-02 3단계 Seedream 5.5 시험 생성 화면(합성 응답). admin-hub-fixture-run.mjs 루프백 주소, ?page=style-dna-panel.
// 합성 서버는 Seedream을 모르므로 이 시험이 문서 시작 스크립트로 앱의 fetch 대역(window.fetch 대입)을 한 겹 감싼다:
//  - GET /api/admin/style-dna: ?seedream=ready면 settings.generationModels에 Seedream 한 줄(키 버전 7, 견적 20000/28000, 키 문자열 칸 포함 — 화면에 나오면 안 됨),
//    =bad면 모델 ID가 어긋난 줄, =none이면 칸 없음(운영 기본 앱과 같음).
//  - POST /{id}/test-image 중 model "seedream-5.5"만 이 대역이 받는다(실제 공급자·청구 없음). 나머지(Gemini)는 합성 서버 그대로.
//    서버 규칙 흉내: 키 버전 7 아니면 409 stale_credential, 견적(참조 0/1장, __seedream.price로 바꿈) 다르면 409 estimate_changed+새 견적(기록 없음),
//    기존 보류가 있으면 신규 POST에 409로 앞선 번호를 돌려준다. __seedream.queue로 초기 POST 응답을 202·504·연결 유실·503으로 바꾼다.
//    상태 GET은 현재 보류를 발견하고, 번호를 지정한 GET은 202·일시 503·확정 영수증을 구분한다.
// 확인: 목록 칸 없음·어긋남이면 Gemini 두 모델만 / 준비되면 Seedream 선택 → 화면비 1:1 고정, 예상 금액(참조 0/1장) 단추 앞 표시, 키 버전·금액 전송,
//   409 견적 바뀜 → 새 금액 표시·자동 재요청 없음 → 다시 누르면 새 금액·새 요청 번호, 202 → 원래 번호의 GET으로만 확인,
//   전송 불명 → 청구 가능성·자동 재전송 없음·이전 결과 유지·다시 확인 단추 없음, 연결 끊김 → 상태 GET, 보내기 전 실패 → 요금 없음 안내,
//   503 미확정 → 이전 결과 유지·새 POST 차단 → 원래 번호의 GET 202 → 200 확정,
//   참조 업로드 multipart(원본 첨부 끔·sha256·28000), 결과 카드·시험 기록의 생성 출처·예상 금액·실제 청구 미확정, 다른 기록 갔다가 다시 열어도 출처 유지,
//   Gemini는 기존 본문과 안내를 유지한다. 같은 탭의 새 문서에서 원래 모델을 복구하고, 다른 탭에서 모델 근거가 없으면 잠금을 유지한다.
//   각 폭 가로 넘침 0, 외부 요청 0, 키 문자열 화면 노출 0.
const base = globalThis.FIXTURE_ORIGIN;
const out = globalThis.FIXTURE_OUTPUT_DIR ?? ".";
assert.match(base ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const task = await taskSpace("Style DNA Seedream test stage " + Date.now());
const firstPage = task.page("p1");
let page = firstPage;
const secondPage = await task.newPage();
const R = "#admin-style-dna";
const SEC = `document.querySelector("${R}")`;
const TS = `document.querySelector("${R} [aria-label='결과 테스트']")`;
const FORM = `(${TS}).querySelector("form[aria-label='추론 및 생성 설정']")`;
const RUN = "공정 시작 (이미지 1장 합성)";
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, arg = null) => { for (let i = 0; i < 100; i++) { if (await page.evaluate(fn, arg).catch(() => false)) return; await settle(100); } throw new Error("timeout " + label); };
const mark = async (expression, key) => {
  await page.evaluate(`(${expression}).setAttribute("data-press", "")`);
  await page.focus("[data-press]"); await page.keyboard.press(key);
  await page.evaluate(() => document.querySelector("[data-press]")?.removeAttribute("data-press")); await settle(250);
};
const pressOnly = (text, scope = SEC) => mark(`[...(${scope}).querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)})`, "Enter");
// '결과 다시 확인'은 GET 확인이 끝날 때까지('결과를 확인하고 있어요' 사라짐) 기다린다.
const press = async (text, scope = SEC) => {
  await pressOnly(text, scope);
  if (text === "결과 다시 확인") await until(() => !document.body.innerText.includes("결과를 확인하고 있어요"), "check done");
};
const typeInto = (expression, value) => page.evaluate(([expression, value]) => {
  const input = eval(expression);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}, [expression, value]);
const BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4];
const putFile = (name, type) => page.evaluate(([TS, name, type, bytes]) => {
  const input = eval(TS).querySelector("[aria-label^='참조 이미지'] input[type=file]");
  const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], name, { type })); input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, [TS, name, type, BYTES]);
const SUBJECT = `(${FORM}).querySelector("textarea")`;
const MODEL = `(${FORM}).querySelectorAll("select")[1]`;
const log = () => page.evaluate(() => window.__seedream.log.map((row) => ({ ...row })));
const blockedStart = async (recoveryText = "결과 다시 확인") => {
  const before = (await log()).length;
  const controls = await page.evaluate(FORM => {
    const form = eval(FORM);
    const start = form.querySelector('button[type="submit"]');
    const explanation = document.getElementById(start.getAttribute("aria-describedby"));
    const recovery = explanation?.nextElementSibling;
    form.querySelectorAll("select")[1].focus();
    return { disabled: start.disabled, status: explanation?.getAttribute("role"), description: explanation?.textContent,
      recovery: recovery?.tagName === "BUTTON" ? recovery.textContent.trim() : null };
  }, FORM);
  assert.equal(controls.disabled, true);
  assert.equal(controls.status, "status");
  assert.match(controls.description, /이미지 생성/);
  assert.equal(controls.recovery, recoveryText);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), recoveryText, "키보드는 비활성 시작을 건너뛰고 재확인에 도달");
  await page.evaluate(FORM => eval(FORM).requestSubmit(), FORM);
  await settle(250);
  assert.equal((await log()).length, before, "폼 제출도 잠긴 Seedream을 보내지 않음");
};
const startBlock = () => page.evaluate(FORM => {
  const start = eval(FORM).querySelector('button[type="submit"]');
  return document.getElementById(start.getAttribute("aria-describedby"))?.textContent ?? null;
}, FORM);
const expectGet = (read, sent) => assert.deepEqual(read, { method: "GET", id: sent.id, options: { requestId: sent.options.requestId }, hasBody: false });
const geminiPosts = () => page.evaluate(() => window.__premiere.requests().filter((row) => row.method === "POST" && row.path.endsWith("/test-image")).map((row) => row.body));
const notice = () => page.evaluate((R) => [...document.querySelectorAll(`${R} section > p[role]`)].map((item) => item.textContent).join(" | "), R);
const control = (patch) => page.evaluate((patch) => Object.assign(window.__seedream, patch), patch);
const state = () => page.evaluate(([TS, FORM]) => {
  const ts = eval(TS), form = eval(FORM);
  const selects = [...form.querySelectorAll("select")];
  const match = ts.querySelector("[aria-label='색감 일치율']");
  const info = [...form.querySelectorAll("p")].find((item) => /'공정 시작'을 누르면/.test(item.textContent));
  return {
    options: [...selects[1].options].map((option) => [option.value, option.textContent]),
    model: selects[1].value,
    ratio: [selects[2].disabled, selects[2].selectedOptions[0]?.textContent ?? null, form.querySelector("[id$='-ratio-fixed']")?.textContent ?? null],
    estimate: form.querySelector("[aria-label='예상 금액']")?.textContent ?? null,
    send: info?.textContent.trim() ?? null,
    paid: [...form.querySelectorAll(":scope > p")].at(-1)?.textContent ?? null,
    missing: form.querySelector("[role=note]")?.textContent ?? null,
    run: [...form.querySelectorAll("button[type=submit]")].map((button) => [button.textContent.trim(), button.disabled])[0],
    source: match?.querySelector("[aria-label='생성 출처']")?.textContent ?? null,
    tests: [...ts.querySelectorAll("[aria-label='시험 기록'] li span")].map((node) => node.textContent),
    checked: [...ts.querySelectorAll("[aria-label='시험 기록'] input[type=radio]")].findIndex((input) => input.checked),
    image: ts.querySelector("[aria-label='DNA 합성 미리보기'] img")?.getAttribute("src") ?? null,
    retry: [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "결과 다시 확인"),
    secret: document.documentElement.outerHTML.includes("seedream-secret"),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    external: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => !name.startsWith(location.origin) && !name.startsWith("data:") && !name.startsWith("blob:")),
  };
}, [TS, FORM]);

// 문서 시작 스크립트: 앱이 window.fetch에 합성 대역을 넣는 순간 Seedream 대역으로 한 겹 감싼다.
const wrapper = String.raw`(() => {
  const mode = new URLSearchParams(location.search).get("seedream") ?? "none";
  const S = window.__seedream = { mode, price: null, queue: [], log: [], done: {}, seq: 0, geminiFails: false, legacy: false };
  // 원 요청 모델(서버 원장): 구형 행(S.legacy)·모델 기록이 없는 영수증은 생략한다.
  const led = (receipt) => !S.legacy && receipt && receipt.model ? { model: receipt.model } : {};
  const row = { id: "seedream-5.5", label: "Seedream 5.5", vendor: "ByteDance", provider: "byteplus", modelId: "dola-seedream-5-5-261028", size: "1024x1024",
    aspectRatio: "1:1", credentialVersion: 7, estimate: { priceTable: "byteplus-modelark-2026-11-25", currency: "USD", unit: "micros", withoutReference: 20000, withReference: 28000 } };
  const flux = { ...row, id: "flux-2-pro", label: "FLUX.2 pro", vendor: "Black Forest Labs", provider: "bfl", modelId: "flux-2-pro",
    estimate: { ...row.estimate, priceTable: "bfl-flux2-pro-2026-11-26", withoutReference: 30000, withReference: 45000 } };
  // GPT Image 2.6(P2-02-STYLE-DNA-GPT-IMAGE-UI, 서버 4ba5eecc 계약): usage 기반 줄(금액 칸 없음). ?seedream=gpt
  const gpt = { ...row, id: "gpt-image-2.6", label: "GPT Image 2.6", vendor: "OpenAI", provider: "openai", modelId: "gpt-image-2.6-sunburst",
    estimate: { kind: "usage_based", priceTable: "openai-gpt-image-2.6-sunburst-2026-11", currency: "USD", unit: "micros" } };
  const models = { [row.id]: row, ...(mode === "flux" && { [flux.id]: flux }), ...(mode === "gpt" && { [gpt.id]: gpt }) };
  const quote = (model, refs, total) => {
    const outputMicros = model.id === flux.id && refs ? model.estimate.withoutReference : total - refs * 8000;
    return { priceTable: model.estimate.priceTable, currency: "USD", unit: "micros", referenceCount: refs,
      outputMicros, referenceMicros: total - outputMicros, totalMicros: total };
  };
  const json = (value, status) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  let inner;
  const make = (id, options, upload, refs, total, persist = true) => {
    const model = models[options.model];
    const fixture = window.__premiere.styleDna;
    const record = fixture.records.find((item) => item.id === id);
    if (!record) return null;
    S.seq += 1;
    const testId = "0190b0b0-0000-7000-8000-0000000d" + String(S.seq).padStart(4, "0");
    const test = { id: testId, revision: options.revision, model: model.id, createdAt: "2026-11-25T0" + Math.min(S.seq, 9) + ":30:00.000Z", original: record.original,
      image: fixture.media(id, testId, 1024, 1024, [{ hex: "#2a6f8a", share: 0.4 }, { hex: "#e8c9a0", share: 0.3 }, { hex: "#1c1c24", share: 0.2 }, { hex: "#f2efe8", share: 0.1 }]),
      basis: { promptMode: options.customPrompt === undefined ? "revision" : "edited", promptSha256: "e".repeat(64), aspectRatio: "1:1", credentialVersion: 7,
        reference: !refs ? { kind: "none" } : upload ? { kind: "upload", sha256: "f".repeat(64), sourceSha256: options.customReferenceSha256 } : { kind: "original", sha256: record.original.sha256 } },
      generation: model.id === gpt.id
        ? { provider: model.provider, modelId: model.modelId, size: model.size, png: { sha256: "a".repeat(64), width: 1024, height: 1024, byteLength: 1500000 },
          usage: S.noCost ? { generatedImages: 1 } : { generatedImages: 1, inputTokens: 120, inputImageTokens: 0, outputTokens: 1000 },
          estimate: { ...gpt.estimate, referenceCount: refs }, ...(!S.noCost && { actualCostMicros: 30600 }), billing: "unconfirmed" }
        : { provider: model.provider, modelId: model.modelId, size: model.size, png: { sha256: "a".repeat(64), width: 1024, height: 1024, byteLength: 1500000 },
        usage: { generatedImages: 1, ...(model.id === row.id && { outputTokens: 4096 }) },
        estimate: quote(model, refs, total),
        billing: "unconfirmed" } };
    if (persist) record.tests.push(test);
    return { test };
  };
  const generate = async (id, options, upload, text) => {
    const model = models[options.model];
    S.log.push({ method: "POST", id, upload, options, text });
    const prior = S.done[options.requestId];
    if (prior) return json({ code: "request_conflict" }, 409);
    const existing = Object.keys(S.done).find(key => S.done[key].id === id && S.done[key].pending);
    if (existing) return json({ code: "generation_in_progress", requestId: existing, ...led(S.done[existing]) }, 409);
    if (options.credentialVersion !== 7) return json({ code: "stale_credential" }, 409);
    const refs = upload || options.attachImage ? 1 : 0;
    // 서버 4ba5eecc: usage 기반은 billing만(금액 칸 섞이면 400), 고정가에 billing을 보내도 400
    if (model.id === gpt.id ? options.billing !== "usage_based" || "expectedCostMicros" in options : "billing" in options)
      return json({ code: "invalid_input" }, 400);
    const total = model.id === gpt.id ? 0 : S.price ?? (refs ? model.estimate.withReference : model.estimate.withoutReference);
    if (model.id !== gpt.id && options.expectedCostMicros !== total)
      return json({ code: "estimate_changed", estimate: quote(model, refs, total) }, 409);
    const step = S.queue.shift() ?? "ok";
    if (step === "in_progress" || step === "unconfirmed") {
      S.done[options.requestId] = { id, options, upload, pending: true, refs, total, model: options.model };
      return step === "in_progress" ? json({ code: "in_progress" }, 202) : json({ code: "result_unconfirmed" }, 503);
    }
    const fail = { unknown: [504, "generation_submission_unknown"], not_sent: [503, "generation_not_sent"], lost: [504, "generation_result_lost"] }[step];
    // 서버 c608b8c1: FLUX·GPT Image의 504(접수 미확인·결과 유실)는 같은 요청 번호로 예약을 유지하고 그 번호·원장 모델을 돌려준다. Seedream은 예약을 푼다.
    if (fail && fail[0] === 504 && (model.id === gpt.id || model.id === flux.id)) {
      S.done[options.requestId] = { id, options, upload, pending: true, refs, total, model: options.model };
      // heldReply: 비정상 응답 경계(Tester gpt-504-independent). 서버 예약은 원 요청 번호로 남고 응답의 번호·모델만 바꾼다.
      const replyId = { same: options.requestId, other: "0190b0b0-0000-7000-8000-00000000ffff", invalid: "invalid-uuid", none: undefined, model: options.requestId }[S.heldReply ?? "same"];
      return json({ code: fail[1], ...(replyId !== undefined && { requestId: replyId }), model: S.heldReply === "model" ? "seedream-5.5" : options.model }, fail[0]);
    }
    if (fail) { S.done[options.requestId] = { text, status: fail[0], body: { code: fail[1] }, model: options.model }; return json({ code: fail[1] }, fail[0]); }
    const body = make(id, options, upload, refs, total);
    if (!body) return json({ code: "not_found" }, 404);
    S.done[options.requestId] = { id, status: 201, body, model: options.model };
    if (step === "network") throw new TypeError("Failed to fetch");
    return json(body, 201);
  };
  const wrapped = async (raw, init) => {
    const path = String(raw), method = init?.method ?? "GET";
    if (path === "/api/admin/style-dna" && method === "GET") {
      if (S.savedRecord) {
        const records = window.__premiere.styleDna.records;
        if (!records.some(record => record.id === S.savedRecord.id)) records.push(S.savedRecord);
      }
      const response = await inner(raw, init);
      if (!response.ok || S.mode === "none") return response;
      const body = await response.json();
      body.settings.generationModels = S.mode === "bad" ? [{ ...row, modelId: "other-model" }]
        : Object.values(models).map(model => ({ ...model, apiKey: "seedream-secret-should-not-render" }));
      return json(body, response.status);
    }
    const match = /^\/api\/admin\/style-dna\/([^/]+)\/test-image(?:\?requestId=([^&]+))?$/.exec(path);
    if (match && method === "GET") {
      const [ , id, requestId ] = match;
      if (S.otherAccount) return json({ code: "not_found" }, 404);
      if (!requestId) {
        if (S.discoveryError) return json({ code: "storage_unavailable" }, 503);
        const existing = Object.keys(S.done).find(key => S.done[key].id === id && S.done[key].pending);
        return existing ? json({ code: "in_progress", requestId: existing, ...led(S.done[existing]) }, 202) : json({ pending: false }, 200);
      }
      S.log.push({ method: "GET", id, options: { requestId }, hasBody: !!init?.body });
      if (S.delayStatus) await new Promise(resolve => setTimeout(resolve, S.delayStatus));
      const receipt = S.done[requestId];
      if (!receipt || receipt.id !== id || S.otherAccount) return json({ code: "not_found" }, 404);
      if (S.queue[0] === "recheck_unavailable") { S.queue.shift(); return json({ code: "storage_unavailable" }, 503); }
      if (S.queue[0] === "finish_error") {
        S.queue.shift();
        receipt.pending = false; receipt.status = 503; receipt.body = { code: "storage_unavailable" };
      }
      if (receipt.pending && S.queue[0] === "wrong_model") {
        S.queue.shift();
        const other = receipt.options.model === flux.id ? row : flux;
        const total = receipt.refs ? other.estimate.withReference : other.estimate.withoutReference;
        const body = make(id, { ...receipt.options, model: other.id }, receipt.upload, receipt.refs, total, false);
        return json({ ...body, requestId, settled: true, ...led(receipt) }, 200);
      }
      if (receipt.pending && S.queue[0] === "deleted") {
        // 원본 기록이 지워진 뒤 같은 UUID 조회: 확정 404(같은 요청 번호·원장 모델·settled).
        S.queue.shift();
        const records = window.__premiere.styleDna.records;
        records.splice(records.findIndex(record => record.id === id), 1);
        S.savedRecord = null;
        receipt.pending = false; receipt.status = 404; receipt.body = { code: "not_found" };
      }
      if (receipt.pending && S.queue[0] === "finish") {
        S.queue.shift();
        receipt.pending = false; receipt.status = 201; receipt.body = make(id, receipt.options, receipt.upload, receipt.refs, receipt.total);
      }
      return receipt.pending ? json({ code: "in_progress", requestId, ...led(receipt) }, 202)
        : json({ ...receipt.body, requestId, settled: true, ...led(receipt) }, receipt.status === 201 ? 200 : receipt.status);
    }
    if (match && method === "POST") {
      const upload = init.body instanceof FormData;
      const options = upload ? JSON.parse(String(init.body.get("options"))) : JSON.parse(String(init.body));
      if (Object.hasOwn(models, options.model))
        return generate(match[1], options, upload, upload ? JSON.stringify([options, init.body.get("customReference")?.name ?? null]) : String(init.body));
      if (S.geminiFails) return json({ code: "model_error" }, 502);
    }
    return inner(raw, init);
  };
  Object.defineProperty(window, "fetch", { configurable: true, get: () => inner ? wrapped : undefined, set: (value) => { inner = value; } });
})();`;
await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: wrapper });
await secondPage.cdp("Page.addScriptToEvaluateOnNewDocument", { source: wrapper });

const open = async (query) => {
  await page.goto("about:blank");
  await page.goto(`${base}/admin?page=style-dna-panel&${query}${R}`);
  await until((R) => { const s = document.querySelector(R); const lib = s?.querySelector("[aria-label='보관함'] h4")?.closest("section");
    return !!s?.querySelector("[aria-label='이미지 스타일 분석기'] form") || (!!lib && !/불러오는 중/.test(lib.textContent)); }, "entry", R);
  await page.evaluate((R) => { const s = document.querySelector(R); if (!s.querySelector("[aria-label='이미지 스타일 분석기'] form")) s.querySelector("[aria-label='Style DNA 단계'] button").click(); }, R);
  await until((R) => !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "studio", R);
  await until((R) => !/확인하는 중/.test(document.querySelector(R).innerText), "settings", R);
};
const analyze = async () => {
  const ST = `document.querySelector("${R} [aria-label='이미지 스타일 분석기']")`;
  await mark(`[...(${ST}).querySelectorAll("label")].find((label) => label.textContent.trim() === "HTTPS 주소").querySelector("input")`, "Space");
  await typeInto(`(${ST}).querySelector("input[type=url]")`, "https://images.example.com/city.png");
  await press("이미지 시퀀싱 시작", ST);
  await until((ST) => /Dusk City Portrait/.test(eval(ST).textContent), "analyzed", ST);
  await press("3. 결과 테스트");
  await until((TS) => !!eval(TS), "test stage", TS);
};
const run = async (count, label) => { await press(RUN, FORM); await until(([n]) => window.__seedream.log.length >= n && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), label, [count]); await settle(200); };
const shot = async (name) => { await page.evaluate(`(${TS}).scrollIntoView({ block: "start" })`); await settle(250); await page.screenshot({ path: `${out}/${name}` }); };
// 안내 문단(섹션 위쪽)과 '결과 다시 확인' 단추가 보이게 찍는다.
const shotNotice = async (name) => { await page.evaluate((R) => document.querySelector(`${R} section > p[role]`)?.scrollIntoView({ block: "start" }), R); await settle(250); await page.screenshot({ path: `${out}/${name}` }); };
const GEMINI_OPTIONS = [["gemini-nano-banana-2.1", "Nano Banana 2.1 · 2K"], ["gemini-3.1-flash-lite-image", "Nano Banana 2 Lite · 1K"]];
const SEEDREAM_OPTION = ["seedream-5.5", "Seedream 5.5(ByteDance) · 1024×1024"];
const SEEDREAM_SEND = "'공정 시작'을 누르면 버전 1의 프롬프트와 원본 이미지를 ByteDance Seedream 5.5(dola-seedream-5-5-261028, 키 등록 버전 7)에 보내 시험 이미지 1장을 만들고 보관해요(호출 1건).";
const GEMINI_SEND = "'공정 시작'을 누르면 버전 1의 프롬프트와 원본 이미지를 Gemini 이미지 모델에 보내 시험 이미지 1장을 만들고 보관해요(호출 1건).";
const source = (micros, reference) => `AI 생성 출처 BytePlus · dola-seedream-5-5-261028 · 1024×1024 · 예상 ${micros}(${reference}) · 실제 청구 미확정`;
const results = [];
const fluxResults = [];
const gptResults = [];
try {
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const full = width === 1280;
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });

    console.log("STEP 1 칸 없음·어긋남 " + width);
    for (const mode of ["none", "bad"]) {
      await page.evaluate(() => sessionStorage.clear()).catch(() => {});
      await open(`styleDnaReport=1&seedream=${mode}&w=${width}`);
      await analyze();
      const v = await state();
      assert.deepEqual(v.options, GEMINI_OPTIONS, `${mode} 모델 목록`);
      assert.deepEqual([v.estimate, v.send, v.paid, v.ratio[0]], [null, GEMINI_SEND, "생성 1회마다 등록한 Gemini 이미지 호출 1건(유료)이 발생합니다.", false], `${mode} Gemini 안내`);
      if (!full) break;
    }

    console.log("STEP 2 준비됨·선택 " + width);
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    await open(`styleDnaReport=1&styleDnaSeed=1&seedream=ready&w=${width}`);
    await analyze();
    let v = await state();
    assert.deepEqual(v.options, [...GEMINI_OPTIONS, SEEDREAM_OPTION]);
    assert.equal(v.secret, false, "키 문자열이 화면에 없다");
    await typeInto(MODEL, "seedream-5.5");
    v = await state();
    assert.deepEqual(v.ratio, [true, "1:1 (1024×1024 고정)", "이 모델은 크기가 고정이라 화면 비율을 고를 수 없어요."]);
    assert.equal(v.estimate, "예상 금액 $0.028 (출력 1024×1024 1장 + 참조 1장, 가격표 byteplus-modelark-2026-11-25) · 실제 청구는 공급자 정산 뒤 확정돼요.");
    assert.equal(v.send, SEEDREAM_SEND);
    assert.equal(v.paid, "생성 1회마다 Seedream 5.5 호출 1건(유료)이 발생해요. 장당 금액 상한은 없고, 위 금액은 예상가예요.");
    assert.deepEqual([v.missing, v.run], [null, [RUN, true]], "피사체 없으면 잠김");
    await press("참조 이미지 연결됨", FORM);
    v = await state();
    assert.equal(v.estimate, "예상 금액 $0.020 (출력 1024×1024 1장, 가격표 byteplus-modelark-2026-11-25) · 실제 청구는 공급자 정산 뒤 확정돼요.");
    assert.match(v.send, /의 프롬프트를 ByteDance Seedream 5\.5/);
    await typeInto(SUBJECT, "a cat on a neon rooftop");
    assert.deepEqual((await state()).run, [RUN, false]);
    assert.equal((await log()).length, 0, "준비만 하면 요청 없음");
    await shot(`seedream-ready-${width}.png`);

    console.log("STEP 3 견적 바뀜 " + width);
    await control({ price: 35000 });
    await run(1, "estimate");
    let rows = await log();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].upload, rows[0].options.model, rows[0].options.credentialVersion, rows[0].options.expectedCostMicros, rows[0].options.attachImage, "aspectRatio" in rows[0].options],
      [false, "seedream-5.5", 7, 20000, false, false]);
    assert.match(await notice(), /예상 금액이 \$0\.020에서 \$0\.035로 바뀌었어요\(가격표 byteplus-modelark-2026-11-25\)\. 요청은 보내지 않았어요\./);
    v = await state();
    assert.match(v.estimate, /^예상 금액 \$0\.035 /);
    assert.equal(v.retry, false, "견적 바뀜에는 다시 확인 단추가 없다");
    await settle(1500);
    assert.equal((await log()).length, 1, "자동 재요청 없음");
    await run(2, "estimate confirmed");
    rows = await log();
    assert.deepEqual([rows[1].options.expectedCostMicros, rows[1].options.requestId !== rows[0].options.requestId], [35000, true]);
    v = await state();
    assert.match(await notice(), /Seedream 5\.5 시험 이미지를 만들었어요\. 예상 금액 \$0\.035, 실제 청구는 공급자 정산 뒤 확정돼요\./);
    assert.equal(v.source, source("$0.035", "참조 없음"));
    assert.match(v.tests.at(-1), /Seedream 5\.5 · 참조 없음 · 실제 청구 미확정$/);
    assert.match(v.image ?? "", /\/media\/0190b0b0-0000-7000-8000-0000000d0001$/);
    await control({ price: null });
    assert.match((await state()).estimate, /^예상 금액 \$0\.020 /, "성공 뒤 서버 기본 견적으로 돌아간다");
    await shot(`seedream-result-${width}.png`);

    if (full) {
      console.log("STEP 4 처리 중(202) " + width);
      await control({ queue: ["in_progress"] });
      await run(3, "202");
      assert.match(await notice(), /아직 처리 중이에요/);
      assert.equal((await state()).retry, true);
      await blockedStart();
      await settle(2000);
      assert.equal((await log()).length, 3, "202에 자동 재전송 없음");
      await control({ queue: ["finish"] });
      await press("결과 다시 확인");
      await until(() => window.__seedream.log.length >= 4 && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "recheck");
      rows = await log();
      expectGet(rows[3], rows[2]);
      v = await state();
      assert.equal(v.tests.length, 2);
      assert.equal(v.checked, 1);

      console.log("STEP 5 전송 불명(504) " + width);
      const before = await state();
      await control({ queue: ["unknown"] });
      await run(5, "unknown");
      const text = await notice();
      assert.match(text, /요청이 Seedream 5\.5에 전달됐는지 확인하지 못했어요\. 이미 만들어져 요금이 청구됐을 수 있어요\(청구 확인 필요\)\. 자동으로 다시 보내지 않았고 이전 결과는 그대로예요\./);
      v = await state();
      assert.deepEqual([v.retry, v.tests, v.checked, v.image, v.source], [false, before.tests, before.checked, before.image, before.source], "이전 결과 유지");
      await settle(1500);
      assert.equal((await log()).length, 5, "자동 재전송 없음");
      await shot(`seedream-unknown-${width}.png`);

      console.log("STEP 6 연결 끊김 " + width);
      await control({ queue: ["network"] });
      await run(6, "network");
      assert.match(await notice(), /응답을 받지 못했어요\. Seedream 5\.5에서 이미 만들어져 저장되고 요금이 청구됐을 수 있어요\. '결과 다시 확인'은 같은 요청을 다시 물어봐요\(새로 만들지 않아요\)\./);
      assert.equal((await state()).retry, true);
      await settle(1500);
      assert.equal((await log()).length, 6, "끊김에도 자동 재전송 없음");
      await press("결과 다시 확인");
      await until(() => window.__seedream.log.length >= 7 && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "network recheck");
      rows = await log();
      expectGet(rows[6], rows[5]);
      assert.equal((await state()).tests.length, 3);

      console.log("STEP 6b 결과 미확정(503 result_unconfirmed) " + width);
      const kept = await state();
      await control({ queue: ["unconfirmed"] });
      await run(8, "unconfirmed");
      assert.ok((await notice()).startsWith("Seedream 5.5에서 이미 만들어져 요금이 청구됐을 수 있지만 서버가 결과 저장을 확인하지 못했어요(청구 확인 필요). 자동으로 다시 보내지 않았고 이전 결과는 그대로예요. '결과 다시 확인'은 같은 요청을 다시 물어봐요(새로 만들지 않아요)."), "미확정 안내");
      v = await state();
      assert.deepEqual([v.retry, v.tests, v.checked, v.image, v.source], [true, kept.tests, kept.checked, kept.image, kept.source], "미확정: 이전 결과 유지·다시 확인 단추");
      await settle(2000);
      assert.equal((await log()).length, 8, "미확정에 자동 재전송 없음");
      await blockedStart();
      assert.equal((await log()).length, 8, "미확정 중 '공정 시작'은 새 요청을 보내지 않음");
      assert.equal((await state()).retry, true, "다시 확인 단추 유지");
      await shotNotice(`seedream-unconfirmed-${width}.png`);
      await press("결과 다시 확인");
      await until(() => window.__seedream.log.length >= 9 && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "unconfirmed recheck 202");
      rows = await log();
      expectGet(rows[8], rows[7]);
      assert.match(await notice(), /아직 처리 중이에요/);
      v = await state();
      assert.deepEqual([v.retry, v.tests.length], [true, kept.tests.length], "202: 복구 경로 유지·결과 그대로");
      await blockedStart();
      assert.equal((await log()).length, 9, "202 중에도 '공정 시작'은 새 요청을 보내지 않음");
      await settle(1500);
      assert.equal((await log()).length, 9, "202에 자동 재전송 없음");
      await control({ queue: ["finish"] });
      await press("결과 다시 확인");
      await until(() => window.__seedream.log.length >= 10 && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "unconfirmed recheck 201");
      rows = await log();
      expectGet(rows[9], rows[7]);
      assert.equal(new Set(rows.slice(7).map((row) => row.options.requestId)).size, 1, "미확정 복구 동안 요청 번호는 하나");
      v = await state();
      assert.deepEqual([v.tests.length, v.retry], [kept.tests.length + 1, false], "확정 뒤 새 결과 하나·다시 확인 단추 사라짐");
      assert.equal(v.run[1], false, "확정 뒤 공정 시작 활성");
      assert.match(await notice(), /Seedream 5\.5 시험 이미지를 만들었어요/);
      await shotNotice(`seedream-unconfirmed-settled-${width}.png`);

      console.log("STEP 7 보내기 전 실패·결과 유실 " + width);
      await control({ queue: ["not_sent"] });
      await run(11, "not sent");
      assert.match(await notice(), /공급자에 보내기 전에 멈췄어요\. 요청이 나가지 않아 요금도 없어요\./);
      await control({ queue: ["lost"] });
      await run(12, "result lost");
      assert.match(await notice(), /Seedream 5\.5이 요청을 받았지만 결과를 받지 못했어요\. 요금이 청구됐을 수 있어요\(청구 확인 필요\)\. 자동으로 다시 보내지 않았고 이전 결과는 그대로예요\./);
      assert.deepEqual([(await state()).tests.length, (await state()).retry], [4, false]);

      console.log("STEP 8 참조 업로드 " + width);
      await press("참조 이미지 없음", FORM);
      await putFile("anchor.png", "image/png");
      await until((FORM) => !!eval(FORM).querySelector("img[alt^='바꾼 참조 이미지']"), "reference", FORM);
      assert.match((await state()).estimate, /^예상 금액 \$0\.028 \(출력 1024×1024 1장 \+ 참조 1장/);
      await run(13, "upload");
      rows = await log();
      const sent = rows[12];
      assert.deepEqual([sent.upload, sent.options.attachImage, sent.options.expectedCostMicros, /^[a-f0-9]{64}$/.test(sent.options.customReferenceSha256)], [true, false, 28000, true]);
      v = await state();
      assert.equal(v.source, source("$0.028", "참조 1장 포함"));
      assert.match(v.tests.at(-1), /Seedream 5\.5 · 바꾼 참조 · 실제 청구 미확정$/);

      console.log("STEP 9 다른 기록 갔다가 다시 열기 " + width);
      const reopenedTests = v.tests;
      await mark(`[...(${SEC}).querySelectorAll("button[aria-pressed]")].find((item) => /^보관함( [0-9]+)?$/.test(item.textContent.trim()))`, "Enter");
      await until((R) => !!document.querySelector(`${R} [aria-label='보관함'] button[aria-label='보관된 도심 인물 사진 열기']`), "library", R);
      await mark(`document.querySelector("${R} [aria-label='보관함'] button[aria-label='보관된 도심 인물 사진 열기']")`, "Enter");
      await until((R) => !document.querySelector(`${R} [aria-label='보관함']`) && !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "seed open", R);
      await mark(`[...(${SEC}).querySelectorAll("button[aria-pressed]")].find((item) => /^보관함( [0-9]+)?$/.test(item.textContent.trim()))`, "Enter");
      await until((R) => !!document.querySelector(`${R} [aria-label='보관함'] button[aria-label='주소 분석 열기']`), "library 2", R);
      const gets = await page.evaluate(() => window.__premiere.requests().filter((row) => row.method === "GET" && /\/api\/admin\/style-dna\/[^/]+$/.test(row.path)).length);
      await mark(`document.querySelector("${R} [aria-label='보관함'] button[aria-label='주소 분석 열기']")`, "Enter");
      await until(([R, n]) => window.__premiere.requests().filter((row) => row.method === "GET" && /\/api\/admin\/style-dna\/[^/]+$/.test(row.path)).length > n
        && !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "reopen", [R, gets]);
      await press("3. 결과 테스트");
      await until((TS) => !!eval(TS), "test stage again", TS);
      v = await state();
      assert.deepEqual(v.tests, reopenedTests, "다시 연 기록의 시험 기록");
      await page.evaluate((TS) => { const radios = eval(TS).querySelectorAll("[aria-label='시험 기록'] input[type=radio]"); radios[0].click(); }, TS);
      await settle(300);
      assert.equal((await state()).source, source("$0.035", "참조 없음"), "다시 연 Seedream 결과의 출처");

      console.log("STEP 10 Gemini로 돌아가기 " + width);
      await typeInto(MODEL, "gemini-nano-banana-2.1");
      await press("초기화", FORM).catch(() => {});
      v = await state();
      assert.deepEqual([v.ratio[0], v.estimate, v.paid], [false, null, "생성 1회마다 등록한 Gemini 이미지 호출 1건(유료)이 발생합니다."]);
      const geminiBefore = (await geminiPosts()).length;
      await typeInto(SUBJECT, "a dog under street lights");
      await press(RUN, FORM);
      await until(([n]) => window.__premiere.requests().filter((row) => row.method === "POST" && row.path.endsWith("/test-image")).length > n
        && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "gemini", [geminiBefore]);
      const geminiBody = (await geminiPosts()).at(-1);
      const geminiOptions = geminiBody.options ?? geminiBody;
      assert.deepEqual([geminiOptions.model, geminiOptions.credentialVersion, "expectedCostMicros" in geminiOptions], ["gemini-nano-banana-2.1", 3, false]);
      await settle(300);
      v = await state();
      assert.equal(v.source, "AI 생성 출처 Google Gemini · Nano Banana 2.1");
      assert.doesNotMatch(v.tests.at(-1), /청구 미확정/);
      assert.equal((await log()).length, 13, "Gemini 생성은 Seedream 대역으로 가지 않는다");
    }

    {
      console.log("STEP 11 Gemini·기록 전환·일시 오류 뒤 보류 복구 " + width);
      const postBase = (await log()).length;
      const openSaved = async (label) => {
        await mark(`[...(${SEC}).querySelectorAll("button[aria-pressed]")].find((item) => /^보관함/.test(item.textContent.trim()))`, "Enter");
        const selector = `${R} [aria-label='보관함'] button[aria-label='${label}']`;
        await until(selector => !!document.querySelector(selector), label, selector);
        await mark(`document.querySelector(${JSON.stringify(selector)})`, "Enter");
        await until((R) => !document.querySelector(`${R} [aria-label='보관함']`) && !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), label, R);
        await press("3. 결과 테스트");
        await until(TS => !!eval(TS), "test record", TS);
      };
      const originalSubject = "recovery fixture subject";
      await typeInto(MODEL, "seedream-5.5");
      await typeInto(SUBJECT, originalSubject);
      if (await page.evaluate(FORM => [...eval(FORM).querySelectorAll("button")].some(button => button.textContent.trim() === "참조 이미지 없음"), FORM))
        await press("참조 이미지 없음", FORM);
      await putFile("recovery.png", "image/png");
      await control({ queue: ["unconfirmed"] });
      await run(postBase + 1, "multipart unconfirmed");
      await blockedStart();
      await page.evaluate(FORM => eval(FORM).querySelector('button[type="submit"]').scrollIntoView({ block: "center" }), FORM);
      await settle(300);
      await page.screenshot({ path: `${out}/seedream-start-blocked-${width}.png` });
      const original = (await log()).at(-1);
      assert.equal(original.upload, true);
      const stored = await page.evaluate(({ id, options }) => ({
        binding: JSON.parse(sessionStorage.getItem(`dream:style-dna:paid::${id}`)),
        local: Object.values(window.localStorage).some(value => value.includes(options.requestId)),
        payload: [window.localStorage, sessionStorage].some(storage =>
          Object.values(storage).some(value => value.includes(options.subject) || value.includes("recovery.png"))),
      }), original);
      assert.deepEqual(stored, { binding: { requestId: original.options.requestId, model: "seedream-5.5" }, local: false, payload: false });
      await typeInto(MODEL, "gemini-nano-banana-2.1");
      const beforeGemini = (await state()).tests.length;
      await press(RUN, FORM);
      await until(TS => eval(TS).querySelector("[aria-label='생성 출처']")?.textContent.includes("Google Gemini")
        && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "gemini success with pending Seedream", TS);
      assert.equal((await state()).retry, true);
      assert.equal((await state()).tests.length, beforeGemini + 1);
      await control({ geminiFails: true });
      await press(RUN, FORM);
      assert.match(await notice(), /Gemini가 결과를 만들지 못했어요/);
      assert.equal((await state()).retry, true);
      await control({ geminiFails: false });
      await typeInto(MODEL, "seedream-5.5");
      await blockedStart();
      assert.equal((await log()).length, postBase + 1, "Gemini 성공·실패와 모델 전환 후에도 새 Seedream 제출 0건");

      await control({ discoveryError: true });
      await openSaved("보관된 도심 인물 사진 열기");
      assert.equal((await state()).retry, false, "다른 기록에서는 앞 기록의 복구를 보여 주지 않음");
      await typeInto(SUBJECT, "another fixture subject");
      await blockedStart("이미지 생성 상태 다시 확인");
      await control({ discoveryError: false });
      await press("이미지 생성 상태 다시 확인", FORM);
      assert.equal((await state()).run[1], false, "상태 확인 뒤 새 생성 가능");
      await run(postBase + 2, "new generation on another record");
      assert.notEqual((await log()).at(-1).id, original.id);
      assert.match((await state()).source, /BytePlus/);
      await openSaved("주소 분석 열기");
      v = await state();
      assert.equal(v.retry, true, "같은 기록을 다시 열면 복구 가능");
      assert.match(v.source, /Google Gemini/);
      await typeInto(SUBJECT, "edited after reopening");
      await blockedStart();
      assert.equal((await log()).length, postBase + 2, "재열기 뒤에도 새 Seedream 제출 0건");
      await control({ queue: ["recheck_unavailable"] });
      await press("결과 다시 확인");
      assert.match(await notice(), /생성 상태를 확인하지 못했어요/);
      assert.equal((await state()).retry, true);
      await blockedStart();
      await press("결과 다시 확인");
      assert.match(await notice(), /아직 처리 중이에요/);
      assert.equal((await state()).retry, true);
      await settle(1700);
      assert.equal((await log()).length, postBase + 4, "일시 오류와 202 뒤 자동 재전송 0건");
      assert.deepEqual([(await state()).tests, (await state()).image], [v.tests, v.image], "재확인 오류 중 이전 결과 유지");
      await control({ queue: ["finish"] });
      await press("결과 다시 확인");
      await until(TS => eval(TS).querySelector("[aria-label='생성 출처']")?.textContent.includes("BytePlus"), "reopened request settled", TS);
      const recoveryRows = (await log()).slice(postBase + 2);
      assert.equal(recoveryRows.length, 3);
      for (const replay of recoveryRows) expectGet(replay, original);
      assert.equal((await state()).tests.length, v.tests.length + 1);
      assert.equal((await state()).retry, false);
      await run(postBase + 6, "fresh generation after recovery");
      assert.notEqual((await log()).at(-1).options.requestId, original.options.requestId);

      if (full) {
        console.log("STEP 12 두 탭 경합·새 문서·확정 실패");
        await control({ queue: ["unconfirmed"] });
        await run(postBase + 7, "first tab pending");
        const first = (await log()).at(-1);
        const saved = await page.evaluate(id => ({ [id]: window.__seedream.done[id] }), first.options.requestId);
        page = secondPage;
        await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await open("styleDnaReport=1&styleDnaSeed=1&seedream=ready&tab=2");
        await analyze();
        await typeInto(MODEL, "seedream-5.5");
        await typeInto(SUBJECT, "second tab fixture subject");
        await control({ done: saved, legacy: true });
        await run(1, "competing POST");
        assert.match(await notice(), /앞선 이미지 생성 요청을 처리 중/);
        await press("결과 다시 확인");
        expectGet((await log()).at(-1), first);
        assert.equal((await log()).filter(row => row.method === "POST").length, 1);
        const savedRecord = await page.evaluate(recordId => window.__premiere.styleDna.records.find(record => record.id === recordId), first.id);

        await control({ delayStatus: 1800, queue: ["finish"] });
        await press("결과 다시 확인");
        await openSaved("보관된 도심 인물 사진 열기");
        const other = await state();
        await settle(1900);
        assert.deepEqual([(await state()).tests, (await state()).image], [other.tests, other.image], "늦은 확정 결과는 다른 기록에 반영하지 않음");
        await openSaved("주소 분석 열기");

        const script = await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
          source: `if (window.__seedream) Object.assign(window.__seedream, ${JSON.stringify({ done: saved, savedRecord, legacy: true })});`,
        });
        try {
          await page.reload();
          await until(R => [...document.querySelectorAll(`${R} button`)].some(button => button.textContent.trim() === "결과 다시 확인"), "pending after document reload", R);
          await press("3. 결과 테스트");
          await until(TS => !!eval(TS), "restored test step", TS);
          await typeInto(MODEL, "seedream-5.5");
          await typeInto(SUBJECT, "after document reload");
          await blockedStart();
          assert.equal((await log()).length, 0);
          await control({ queue: ["recheck_unavailable"] });
          await press("결과 다시 확인");
          expectGet((await log()).at(-1), first);
          assert.equal((await state()).retry, true);
          await control({ queue: ["finish_error"] });
          await press("결과 다시 확인");
          expectGet((await log()).at(-1), first);
          assert.match(await notice(), /처음 요청한 모델을 확인할 수 없어요\. 결과와 잠금은 그대로예요\./);
          assert.equal((await state()).retry, true);
          assert.match(await startBlock(), /^확인할 요청 · 모델 확인 전\./);
          await blockedStart();
          assert.deepEqual((await log()).map(row => row.method), ["GET", "GET"], "원장 모델이 없는 구형 행은 확정 실패 뒤에도 신규 제출 0건");

          const denied = await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: "if (window.__seedream) window.__seedream.otherAccount = true;" });
          try {
            await page.reload();
            await until(R => !!document.querySelector(`${R} [aria-label='이미지 스타일 분석기'] form`), "other account", R);
            await until(() => !/불러오는 중/.test(document.body.innerText), "other account record read");
            assert.equal(await page.evaluate(R => [...document.querySelectorAll(`${R} button`)].some(button => button.textContent.trim() === "결과 다시 확인"), R), false);
            assert.deepEqual(await log(), []);
          } finally {
            await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: denied.identifier });
          }
        } finally {
          await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
        }

        console.log("STEP 12b 새 탭 원장 모델 복구·삭제 확정 " + width);
        // 이 탭에 묶은 모델이 없는 새 세션(sessionStorage 비움)이 서버 원장 모델로 같은 UUID를 확정한다.
        const ledger = await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
          source: `if (window.__seedream) Object.assign(window.__seedream, ${JSON.stringify({ done: saved, savedRecord })});`,
        });
        try {
          // 이 탭에 묶은 유료 요청만 지운다(마지막으로 연 기록 기억은 남겨 같은 기록이 열리게).
          await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("dream:style-dna:paid:")).forEach(key => sessionStorage.removeItem(key)));
          await page.reload();
          await until(R => [...document.querySelectorAll(`${R} button`)].some(button => button.textContent.trim() === "결과 다시 확인"), "ledger pending", R);
          await press("3. 결과 테스트");
          await until(TS => !!eval(TS), "ledger test step", TS);
          await typeInto(MODEL, "seedream-5.5");
          assert.match(await startBlock(), /^확인할 요청 · Seedream 5\.5\. .*위 모델 선택과 예상 금액은 다음 생성 설정이에요\.$/);
          assert.deepEqual(await page.evaluate(id => JSON.parse(sessionStorage.getItem(`dream:style-dna:paid::${id}`)), first.id),
            { requestId: first.options.requestId, model: "seedream-5.5" }, "발견한 원장 모델을 이 탭에 묶음");
          const before = await state();
          await control({ delayStatus: 1500, queue: ["finish"] });
          await pressOnly("결과 다시 확인");
          const checking = await page.evaluate(R => ({
            text: document.querySelector(`${R} section > p[role]`)?.textContent ?? "",
            busy: [...document.querySelectorAll(`${R} button`)].find(button => button.textContent.includes("결과를 확인하고 있어요"))?.getAttribute("aria-disabled") ?? null,
            focus: document.activeElement?.textContent.trim() ?? "",
            simulated: document.body.innerText.includes("DNA 합성 시뮬레이션 중"),
          }), R);
          assert.deepEqual(checking, { text: "결과를 확인하고 있어요.", busy: "true", focus: "결과를 확인하고 있어요…", simulated: false }, "GET 확인 중 표시·초점");
          await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
          await until(TS => eval(TS).querySelector("[aria-label='생성 출처']")?.textContent.includes("BytePlus"), "ledger settled", TS);
          await settle(300);
          const after = await state();
          assert.deepEqual([after.tests.length, after.retry], [before.tests.length + 1, false], "원장 모델로 같은 UUID 확정");
          const titleFocus = () => page.evaluate(() => [/^H[1-3]$/.test(document.activeElement?.tagName ?? ""), document.activeElement?.id.endsWith("-title") ?? false]);
          assert.deepEqual(await titleFocus(), [true, true], "확인 성공으로 단추가 사라지면 초점은 작업실 제목");
          assert.deepEqual((await log()).map(row => row.method), ["GET"], "확인 중 연속 Enter에도 조회 1건·생성 POST 0건");
          expectGet((await log()).at(-1), first);
          await control({ delayStatus: 0 });
          await shot(`ledger-settled-${width}.png`);
        } finally {
          await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: ledger.identifier });
        }

        // 같은 UUID에 묶인 확정 삭제 404: 잠금을 끝내고 보관함을 다시 읽는다. 다른 계정의 일반 404는 위에서 잠금 유지를 확인했다.
        const gone = await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
          source: `if (window.__seedream) Object.assign(window.__seedream, ${JSON.stringify({ done: saved, savedRecord })});`,
        });
        try {
          // 이 탭에 묶은 유료 요청만 지운다(마지막으로 연 기록 기억은 남겨 같은 기록이 열리게).
          await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("dream:style-dna:paid:")).forEach(key => sessionStorage.removeItem(key)));
          await page.reload();
          await until(R => [...document.querySelectorAll(`${R} button`)].some(button => button.textContent.trim() === "결과 다시 확인"), "deleted pending", R);
          const lists = () => page.evaluate(() => window.__premiere.requests().filter(row => row.method === "GET" && row.path === "/api/admin/style-dna").length);
          const listBefore = await lists();
          await control({ queue: ["deleted"] });
          await press("결과 다시 확인");
          await until(() => document.body.innerText.includes("삭제된 기록이에요."), "deleted notice");
          await settle(400);
          assert.equal(await page.evaluate(R => [...document.querySelectorAll(`${R} button`)].some(button => button.textContent.trim() === "결과 다시 확인"), R), false, "삭제 확정 뒤 복구 단추 없음");
          assert.ok((await lists()) > listBefore, "보관함 다시 읽음");
          assert.deepEqual(await page.evaluate(() => [/^H[1-3]$/.test(document.activeElement?.tagName ?? ""), document.activeElement?.id.endsWith("-title") ?? false]), [true, true], "삭제 확정 뒤 초점은 작업실 제목");
          assert.deepEqual((await log()).map(row => row.method), ["GET"], "삭제 확정 조회 1건·생성 POST 0건");
          await page.screenshot({ path: `${out}/ledger-deleted-${width}.png` });
        } finally {
          await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: gone.identifier });
          page = firstPage;
        }
        await control({ queue: ["finish_error"] });
        await press("결과 다시 확인");
        expectGet((await log()).at(-1), first);
        assert.match(await notice(), /결과를 저장하지 못했어요/);
        assert.equal((await state()).retry, false);
        assert.equal((await state()).run[1], false, "원래 모델이 확인된 탭은 같은 요청의 확정 실패 뒤 시작 가능");
      }
    }

    v = await state();
    assert.equal(v.overflow, 0, `가로 넘침 ${width}`);
    assert.deepEqual(v.external, [], `외부 요청 ${width}`);
    assert.equal(v.secret, false);
    results.push({ width, pass: true, seedreamPosts: (await log()).length });

    console.log("STEP 13 FLUX.2 pro 견적·공급자 출처·확정 복구 " + width);
    await page.evaluate(() => sessionStorage.clear());
    await open(`styleDnaReport=1&styleDnaSeed=1&seedream=flux&w=${width}`);
    await analyze();
    await typeInto(MODEL, "flux-2-pro");
    await typeInto(SUBJECT, "a synthetic city bicycle");
    assert.match((await state()).estimate, /^예상 금액 \$0\.045 /);
    await control({ price: 60000 });
    await run(1, "flux revised quote");
    assert.match(await notice(), /\$0\.045에서 \$0\.060로/);
    assert.match((await state()).estimate, /^예상 금액 \$0\.060 /);
    await settle(1500);
    assert.equal((await log()).length, 1, "FLUX.2 pro 가격 변경의 자동 재전송 0");
    await control({ queue: ["unconfirmed"] });
    await run(2, "explicit FLUX submit with revised quote");
    const [oldQuote, submitted] = await log();
    assert.equal(submitted.options.expectedCostMicros, 60000);
    assert.notEqual(oldQuote.options.requestId, submitted.options.requestId);
    assert.match(await notice(), /^FLUX\.2 pro에서/);
    await blockedStart();
    await typeInto(MODEL, "seedream-5.5");
    await blockedStart();
    const saved = await page.evaluate(({ id, options }) => ({
      done: { [options.requestId]: window.__seedream.done[options.requestId] },
      savedRecord: window.__premiere.styleDna.records.find(record => record.id === id),
    }), submitted);
    const restore = await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
      source: `if (window.__seedream) Object.assign(window.__seedream, ${JSON.stringify({ ...saved, seq: 50 })});`,
    });
    try {
      await page.reload();
      await until(R => [...document.querySelectorAll(`${R} button`)].some(button => button.textContent.trim() === "결과 다시 확인"), "original model binding after reload", R);
      await press("3. 결과 테스트");
      await until(TS => !!eval(TS), "reloaded FLUX test step", TS);
      await typeInto(MODEL, "seedream-5.5");
      await typeInto(SUBJECT, "another synthetic bicycle");
      const verifyMismatch = async (request) => {
        const before = await state();
        const postCount = (await log()).filter(row => row.method === "POST").length;
        await control({ queue: ["wrong_model"] });
        await press("결과 다시 확인");
        expectGet((await log()).at(-1), request);
        assert.match(await notice(), /기존 요청과 결과의 모델이 일치하지 않아요\. 결과와 잠금은 그대로예요\./);
        const after = await state();
        assert.deepEqual([after.tests, after.image, after.source, after.retry], [before.tests, before.image, before.source, true]);
        await blockedStart();
        assert.equal((await log()).filter(row => row.method === "POST").length, postCount);
      };
      await blockedStart();
      assert.match(await startBlock(), /^확인할 요청 · FLUX\.2 pro\./, "다음 생성 설정이 Seedream이어도 확인할 요청은 FLUX.2");
      await verifyMismatch(submitted);
      await press("결과 다시 확인");
      expectGet((await log()).at(-1), submitted);
      assert.match(await notice(), /아직 처리 중이에요/);
      await control({ queue: ["finish"] });
      await press("결과 다시 확인");
      expectGet((await log()).at(-1), submitted);
      v = await state();
      assert.equal(v.source, "AI 생성 출처 Black Forest Labs · flux-2-pro · 1024×1024 · 예상 $0.060(참조 1장 포함) · 실제 청구 미확정");
      assert.match(v.tests.at(-1), /FLUX\.2 pro · 원본 참조 · 실제 청구 미확정$/);
      assert.deepEqual([v.tests.length, v.retry, v.run[1], v.overflow, v.external, v.secret], [1, false, false, 0, [], false]);
      assert.deepEqual((await log()).map(item => item.method), ["GET", "GET", "GET"]);
      await shot(`flux2-confirmed-${width}.png`);

      await control({ queue: ["unconfirmed"] });
      await run(4, "Seedream pending after FLUX recovery");
      const seedreamRequest = (await log()).at(-1);
      await typeInto(MODEL, "flux-2-pro");
      assert.match(await startBlock(), /^확인할 요청 · Seedream 5\.5\./, "다음 생성 설정이 FLUX.2여도 확인할 요청은 Seedream");
      await verifyMismatch(seedreamRequest);
      await control({ queue: ["finish"] });
      await press("결과 다시 확인");
      expectGet((await log()).at(-1), seedreamRequest);
      v = await state();
      assert.match(v.source, /BytePlus/);
      assert.deepEqual([v.tests.length, v.retry, v.run[1]], [2, false, false]);
      assert.deepEqual((await log()).map(item => item.method), ["GET", "GET", "GET", "POST", "GET", "GET"]);
      fluxResults.push({ width, recovered: true, mismatchesRejected: 2, receiptReads: 5, extraPostsOnReceiptCheck: 0 });
    } finally {
      await page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: restore.identifier });
    }

    console.log("STEP 14 GPT Image 2.6 사용량 기반 생성 " + width);
    // 주인님 결정(msg_eecb6bc80f10): 누르기 전 금액이 없어도 생성 허용, '실제 사용량으로 계산' 안내, 생성 뒤 usage로 금액 표시
    await page.evaluate(() => sessionStorage.clear());
    await open(`styleDnaReport=1&styleDnaSeed=1&seedream=gpt&w=${width}`);
    await analyze();
    const gptLabel = await page.evaluate((MODEL) => [...eval(MODEL).options].find((option) => option.value === "gpt-image-2.6")?.textContent ?? null, MODEL);
    assert.match(gptLabel ?? "", /^GPT Image 2\.6 · sunburst\(OpenAI\)/, "생성 모델은 sunburst까지 적어 프롬프트 대상과 구분");
    await typeInto(MODEL, "gpt-image-2.6");
    await typeInto(SUBJECT, "a synthetic city bicycle");
    v = await state();
    assert.match(v.estimate ?? "", /^실제 사용량으로 계산\(누르기 전 금액 없음\) · 출력 1024×1024 1장/);
    assert.equal(v.run[1], false, "금액 없이도 공정 시작 가능");
    await run(1, "gpt usage-based submit");
    const [gptPost] = await log();
    assert.equal(gptPost.options.billing, "usage_based");
    assert.equal("expectedCostMicros" in gptPost.options, false, "usage 기반은 금액을 보내지 않음");
    await until((TS) => /OpenAI/.test(eval(TS).querySelector("[aria-label='생성 출처']")?.textContent ?? ""), "gpt source", TS);
    v = await state();
    assert.match(v.source, /^AI 생성 출처 OpenAI · gpt-image-2\.6-sunburst · 1024×1024 · 실제 사용량 기준 \$0\.031\(참조 (1장 포함|없음)\) · 실제 청구 미확정$/);
    assert.match(await notice(), /실제 사용량 기준 \$0\.031, 실제 청구는 공급자 정산 뒤 확정돼요/);
    await shot(`gpt-image-cost-${width}.png`);
    // 공급자 응답에 사용량이 모자라 금액을 못 낸 경우: 칸을 채우지 않고 '계산 중'
    await control({ noCost: true });
    await run(2, "gpt usage-based without cost");
    await until((TS) => /계산 중/.test(eval(TS).querySelector("[aria-label='생성 출처']")?.textContent ?? ""), "gpt pending cost", TS);
    v = await state();
    assert.match(v.source, /· 실제 사용량으로 계산 중\(금액 미확인\)\(참조 (1장 포함|없음)\) · 실제 청구 미확정$/);
    assert.deepEqual([v.overflow, v.external, v.secret], [0, [], false]);

    console.log("STEP 15 GPT Image 504 접수 미확인: 같은 요청 확인만 " + width);
    // Tester 32a2af30 반례: 최초 504 직후 '공정 시작'이 켜지고 새 요청을 안내했다. 서버가 같은 요청 번호로 예약을 유지하면 화면도 그 요청의 GET 확인만 남긴다.
    await control({ noCost: false, queue: ["unknown"] });
    const keptGpt = await state();
    const n0 = (await log()).length;
    await run(n0 + 1, "gpt 504 unknown");
    let gl = await log();
    const held = gl[n0];
    assert.equal(held.method, "POST");
    assert.match(await notice(), /요청이 GPT Image 2\.6[^|]*에 전달됐는지 확인하지 못했어요\. 이미 만들어져 요금이 청구됐을 수 있어요\(청구 확인 필요\)\. 자동으로 다시 보내지 않았고 이전 결과는 그대로예요\. 같은 요청이 끝날 때까지 새 생성은 잠가 두었어요\. '결과 다시 확인'은 같은 요청을 다시 물어봐요\(새로 만들지 않아요\)\./);
    assert.doesNotMatch(await notice(), /새 요청\)|'공정 시작'을 다시 눌러/, "새 요청 안내 없음");
    v = await state();
    assert.deepEqual([v.retry, v.tests, v.checked, v.image, v.source], [true, keptGpt.tests, keptGpt.checked, keptGpt.image, keptGpt.source], "504 직후: 다시 확인 단추·이전 결과 유지");
    await settle(1500);
    assert.equal((await log()).length, n0 + 1, "504에 자동 재전송 없음");
    await blockedStart();
    assert.equal((await log()).length, n0 + 1, "504 직후 '공정 시작'은 새 POST를 보내지 않음");
    await shotNotice(`gpt-image-504-${width}.png`);
    await press("결과 다시 확인");
    await until(([n]) => window.__seedream.log.length >= n && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "gpt 504 recheck 202", [n0 + 2]);
    gl = await log();
    expectGet(gl[n0 + 1], held);
    assert.match(await notice(), /아직 처리 중이에요/);
    assert.equal((await state()).retry, true, "202: 다시 확인 단추 유지");
    await control({ queue: ["finish"] });
    await press("결과 다시 확인");
    await until(([n]) => window.__seedream.log.length >= n && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), "gpt 504 recheck 201", [n0 + 3]);
    gl = await log();
    expectGet(gl[n0 + 2], held);
    assert.equal(gl.slice(n0).filter((row) => row.method === "POST").length, 1, "복구 동안 POST는 처음 한 번뿐");
    assert.equal(new Set(gl.slice(n0).map((row) => row.options.requestId)).size, 1, "복구 동안 요청 번호는 하나");
    v = await state();
    assert.deepEqual([v.tests.length, v.retry, v.run[1]], [keptGpt.tests.length + 1, false, false], "확정 뒤 새 결과 하나·다시 확인 단추 사라짐·공정 시작 활성");
    assert.match(await notice(), /GPT Image 2\.6[^|]* 시험 이미지를 만들었어요/);
    assert.deepEqual([v.overflow, v.external, v.secret], [0, [], false]);
    await shotNotice(`gpt-image-504-settled-${width}.png`);
    console.log("STEP 15b GPT Image 504 응답 번호 불일치·잘못됨·빠짐·모델 다름 " + width);
    // 이미 보낸 이 탭의 요청 번호·모델로 잠금을 유지하고, 응답의 다른 번호는 조회하지 않는다. 추가 POST 0.
    const mismatch = [];
    for (const [step, reply] of [["unknown", "other"], ["lost", "invalid"], ["unknown", "none"], ["lost", "model"]]) {
      await control({ queue: [step], heldReply: reply });
      const kept = await state();
      const k0 = (await log()).length;
      await run(k0 + 1, `gpt 504 ${step} ${reply}`);
      const sentRow = (await log())[k0];
      assert.equal(sentRow.method, "POST");
      assert.match(await notice(), /같은 요청이 끝날 때까지 새 생성은 잠가 두었어요\. '결과 다시 확인'은 같은 요청을 다시 물어봐요\(새로 만들지 않아요\)\./, `${step}/${reply} 안내`);
      v = await state();
      assert.deepEqual([v.retry, v.tests, v.image], [true, kept.tests, kept.image], `${step}/${reply}: 다시 확인 단추·이전 결과 유지`);
      await blockedStart();
      assert.equal((await log()).length, k0 + 1, `${step}/${reply}: '공정 시작'이 새 POST를 보내지 않음`);
      await press("결과 다시 확인");
      await until(([n]) => window.__seedream.log.length >= n && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), `${step}/${reply} recheck 202`, [k0 + 2]);
      expectGet((await log())[k0 + 1], sentRow);
      await control({ queue: ["finish"] });
      await press("결과 다시 확인");
      await until(([n]) => window.__seedream.log.length >= n && !/시험 이미지 생성 중이에요|결과를 확인하고 있어요/.test(document.body.innerText), `${step}/${reply} recheck 201`, [k0 + 3]);
      const rows = (await log()).slice(k0);
      expectGet(rows[2], sentRow);
      assert.deepEqual([rows.filter((row) => row.method === "POST").length, new Set(rows.map((row) => row.options.requestId)).size], [1, 1], `${step}/${reply}: POST 1·요청 번호 1`);
      v = await state();
      assert.deepEqual([v.tests.length, v.retry, v.run[1]], [kept.tests.length + 1, false, false], `${step}/${reply}: 확정 뒤 결과 하나·단추 사라짐·공정 시작 활성`);
      if (reply === "other") await shotNotice(`gpt-image-504-other-${width}.png`);
      mismatch.push({ step, reply, posts: 1, gets: 2 });
    }
    await control({ heldReply: "same" });
    assert.deepEqual([v.overflow, v.external, v.secret], [0, [], false]);
    gptResults.push({ width, posts: (await log()).filter((row) => row.method === "POST").length, billing: "usage_based", held504: { posts: 1, gets: 2 }, mismatch });
  }
} finally {
  await task.finish({ keep: [] }).catch(() => {});
}
console.log("SEEDREAM-UI " + JSON.stringify(results));
console.log("FLUX2-UI " + JSON.stringify(fluxResults));
console.log("GPT-IMAGE-UI " + JSON.stringify(gptResults));
