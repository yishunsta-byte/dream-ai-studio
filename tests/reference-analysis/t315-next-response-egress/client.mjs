/* global console, process, fetch, performance, setTimeout, Buffer */
// T315 측정 클라이언트. 격리 사본의 Next production 서버(127.0.0.1:<port>)에 실제 TCP 소켓으로 요청한다.
// 사용: node client.mjs <port> <raw.jsonl> <summary.json>
// - 시각: 서버·클라이언트 모두 시스템 시계 기준 epoch ms(performance.timeOrigin + performance.now(), 0.01ms 반올림).
//   같은 PC의 두 프로세스가 같은 시계 원천을 쓴다. 순서가 중요한 판단은 "클라이언트가 멈춘 동안 읽은 서버 상태"로도 함께 기록한다.
// - 원시 기록(JSONL): 클라이언트 사건(side=client)과 서버 사건(side=server)을 case·ticket·request ID로 묶는다. 비밀값·경로 없음.
// - 버퍼 위치는 단정하지 않는다: 서버 enqueue 누적량과 클라이언트 data 콜백 누적량만 기록한다.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { request } from "node:http";

const PORT = Number(process.argv[2]);
const RAW = process.argv[3];
const SUMMARY = process.argv[4];
assert(Number.isInteger(PORT) && RAW && SUMMARY, "usage: node client.mjs <port> <raw.jsonl> <summary.json>");
const host = "127.0.0.1";
const base = `http://${host}:${PORT}`;
const now = () => Math.round((performance.timeOrigin + performance.now()) * 100) / 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const raw = [];
const summary = {};
let current = "";
const log = (event, fields = {}) => raw.push({ case: current, side: "client", event, at: now(), ...fields });
const count = (text, needle) => needle ? text.split(needle).length - 1 : 0;
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const marker = (id) => `T315-PROTECTED-${id}`;

async function control(body) {
  const response = await fetch(`${base}/api/t315-control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  log(`control:${body.op}:confirmed`, { ticket: json?.id ?? body.id, serverConfirmedAt: json?.confirmedAt });
  return json;
}
const serverState = async (id) => (await fetch(`${base}/api/t315-control?id=${id}`)).json();
async function until(id, name, limit = 8000) {
  const start = Date.now();
  for (;;) {
    const state = await serverState(id);
    if (state.events.some((event) => event.name === name)) return state;
    assert(Date.now() - start < limit, `timeout waiting ${name} on ${id}`);
    await sleep(15);
  }
}
async function dumpServer(id) {
  const state = await serverState(id);
  for (const event of state.events) raw.push({ case: current, side: "server", ticket: id, event: event.name, at: event.at, ...(event.request ? { request: event.request } : {}), ...(event.detail ?? {}) });
  return state;
}
const has = (state, name) => state.events.some((event) => event.name === name);

/** 요청 하나. 대기 구간 관측을 위해 상태·헤더·바이트를 실시간으로 rec에 둔다. */
function send(path, { method = "GET", headers = {}, body, ticket, pauseAfterFirst = false } = {}) {
  const id = randomUUID();
  const rec = { request: id, status: null, headers: null, bytes: 0, end: null, chunks: [] };
  let response;
  log("request:send", { request: id, ticket, method, path: path.replace(/\?.*$/, "") });
  const done = new Promise((resolve) => {
    const req = request({ host, port: PORT, path, method, headers: { connection: "close", "x-t315-request": id, ...headers } }, (res) => {
      response = res;
      rec.status = res.statusCode;
      rec.headers = { "content-type": res.headers["content-type"] ?? null, "cache-control": res.headers["cache-control"] ?? null,
        "content-length": res.headers["content-length"] ?? null, "transfer-encoding": res.headers["transfer-encoding"] ?? null, location: res.headers.location ?? null };
      log("response:headers", { request: id, ticket, status: rec.status, ...rec.headers });
      res.on("data", (chunk) => {
        if (rec.bytes === 0) { log("response:firstByte", { request: id, ticket }); if (pauseAfterFirst) { res.pause(); log("client:pause", { request: id, ticket }); } }
        rec.bytes += chunk.length; rec.chunks.push(chunk);
        log("response:data", { request: id, ticket, cum: rec.bytes });
      });
      res.on("aborted", () => { rec.end ??= "aborted"; });
      res.on("end", () => { rec.end ??= "end"; });
      res.on("error", (error) => { rec.end ??= `error:${error.code ?? error.message}`; });
      res.on("close", () => { rec.end ??= "close"; log("response:close", { request: id, ticket, end: rec.end, bytes: rec.bytes }); resolve(); });
    });
    req.on("error", (error) => { rec.end ??= `request-error:${error.code ?? error.message}`; log("request:error", { request: id, ticket, code: error.code }); resolve(); });
    rec.destroy = () => { log("client:destroy", { request: id, ticket }); req.destroy(); };
    if (body) req.write(body);
    req.end();
  });
  return { rec, done, resume: () => { log("client:resume", { request: id, ticket }); response?.resume(); } };
}
function final(rec, ticket) {
  const buffer = Buffer.concat(rec.chunks);
  const text = buffer.toString("utf8");
  return { status: rec.status, headers: rec.headers, bytes: buffer.length, sha256: sha(buffer), end: rec.end, protectedMarkers: count(text, marker(ticket)) };
}
const waiting = (rec) => ({ status: rec.status, headersReceived: rec.headers !== null, bytes: rec.bytes });
const kinds = {
  html: { path: "/api/t315/html" },
  rsc: { path: "/api/t315/rsc" },
  post: { path: "/api/t315/post", method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
};
const call = (kind, ticket, extra = {}) => send(`${kinds[kind].path}?ticket=${ticket}`, { method: kinds[kind].method, headers: kinds[kind].headers, body: kinds[kind].body, ticket, ...extra });

// A. 정상 전송과 같은 허가 재사용
for (const kind of Object.keys(kinds)) {
  current = `A-normal-${kind}`;
  const { id } = await control({ op: "issue", kind, hold: "none" });
  const first = call(kind, id); await first.done;
  const reuse = call(kind, id); await reuse.done;
  await sleep(100);
  const state = await dumpServer(id);
  summary[current] = { first: final(first.rec, id), reuse: final(reuse.rec, id), consumedOnce: state.events.filter((e) => e.name === "stream:consumed").length };
}
// B. Response 반환 전(핸들러 대기) 철회·만료 — 대기 구간과 최종 응답을 따로 기록
// C. Response 반환 뒤 첫 pull 대기 중 철회·만료
for (const [label, hold, waitFor] of [["B-before-return", "handler", "handler:hold"], ["C-first-pull", "stream", "stream:hold"]]) {
  for (const kind of Object.keys(kinds)) for (const op of ["revoke", "expire"]) {
    current = `${label}-${kind}-${op}`;
    const { id } = await control({ op: "issue", kind, hold });
    const pending = call(kind, id);
    await until(id, waitFor); await sleep(300);
    const during = waiting(pending.rec);
    log("client:waiting-snapshot", { ticket: id, ...during });
    await control({ op, id }); await control({ op: "release", id });
    await pending.done; await sleep(150);
    const state = await dumpServer(id);
    summary[current] = { waiting: during, final: final(pending.rec, id), ticketState: state.state, consumed: has(state, "stream:consumed") };
  }
}
// D. 느린 수신(첫 data 뒤 읽기 정지) — 512KB·4MB, 철회 있음/없음
for (const kind of ["html", "post"]) for (const [size, chunks] of [["512KB", 8], ["4MB", 64]]) for (const revoke of [true, false]) {
  current = `D-slow-${kind}-${size}-${revoke ? "revoke" : "no-revoke"}`;
  const { id } = await control({ op: "issue", kind, hold: "none", chunks, chunkBytes: 65536 });
  const pending = call(kind, id, { pauseAfterFirst: true });
  await until(id, "stream:consumed"); await sleep(700);
  const paused = await serverState(id);
  const atPause = { clientBytes: pending.rec.bytes, serverEnqueued: paused.enqueued, streamClosed: has(paused, "stream:close"), afterRun: has(paused, "after:run") };
  log("client:paused-snapshot", { ticket: id, ...atPause });
  let afterRevoke = null;
  if (revoke) {
    await control({ op: "revoke", id }); await sleep(300);
    const s = await serverState(id);
    afterRevoke = { clientBytes: pending.rec.bytes, serverEnqueued: s.enqueued, stopObserved: has(s, "stream:stop:revoked") };
    log("client:after-revoke-snapshot", { ticket: id, ...afterRevoke });
  }
  pending.resume(); await pending.done; await sleep(200);
  const state = await dumpServer(id);
  const result = final(pending.rec, id);
  summary[current] = { bodyBytes: chunks * 65536, atPause, afterRevoke, final: result, observedAfterResume: result.bytes - atPause.clientBytes,
    serverEnqueuedFinal: state.enqueued, serverStop: state.events.find((e) => e.name.startsWith("stream:stop"))?.name ?? null };
}
// E. 클라이언트 취소(첫 data 뒤 정지 → 소켓 파괴)
for (const kind of ["rsc", "post"]) {
  current = `E-cancel-${kind}`;
  const { id } = await control({ op: "issue", kind, hold: "none", chunks: 64, chunkBytes: 65536 });
  const pending = call(kind, id, { pauseAfterFirst: true });
  await until(id, "stream:consumed"); await sleep(400);
  const before = await serverState(id);
  pending.rec.destroy(); await pending.done; await sleep(600);
  const state = await dumpServer(id);
  summary[current] = { clientBytes: pending.rec.bytes, end: pending.rec.end, enqueuedAtDestroy: before.enqueued, enqueuedFinal: state.enqueued,
    observed: state.events.filter((e) => ["request:abort", "stream:cancel", "after:run"].includes(e.name)).map((e) => e.name) };
}
// F. 실제 App Router 페이지(Suspense 없음)
const page = (ticket, extra = {}) => send(`/t315/page?ticket=${ticket}`, { ticket, ...extra });
for (const op of ["revoke", "expire"]) {
  current = `F-page-render-hold-${op}`;
  const { id } = await control({ op: "issue", kind: "page", hold: "render" });
  const pending = page(id);
  await until(id, "render:hold"); await sleep(400);
  const during = waiting(pending.rec);
  await control({ op, id }); await control({ op: "release", id }); await pending.done;
  const state = await dumpServer(id);
  summary[current] = { waiting: during, final: final(pending.rec, id), ticketState: state.state };
}
{
  current = "F-page-html";
  const { id } = await control({ op: "issue", kind: "page", hold: "none" });
  const first = page(id); await first.done;
  const reuse = page(id); await reuse.done;
  const state = await dumpServer(id);
  summary[current] = { first: final(first.rec, id), reuse: final(reuse.rec, id), consumed: state.events.filter((e) => e.name === "render:consumed").length };
}
for (const [label, headers] of [["F-page-rsc", { rsc: "1" }], ["F-page-prefetch-default", { rsc: "1", "next-router-prefetch": "1" }]]) {
  current = label;
  const { id } = await control({ op: "issue", kind: "page", hold: "none" });
  const hop = page(id, { headers }); await hop.done;
  const location = hop.rec.headers?.location ?? null;
  let followed = null;
  if (location) { const next = send(location, { headers, ticket: id }); await next.done; followed = { location: location.replace(/ticket=[^&]+/, "ticket=<id>"), ...final(next.rec, id) }; }
  const state = await dumpServer(id);
  summary[current] = { firstHop: { status: hop.rec.status, location: location?.replace(/ticket=[^&]+/, "ticket=<id>") ?? null }, followed, ticketState: state.state,
    renderConsumed: state.events.filter((e) => e.name === "render:consumed").length };
}
{
  current = "F-page-revoke-after-render-3MB";
  const size = 3_000_000;
  const { id } = await control({ op: "issue", kind: "page", hold: "none", chunkBytes: size });
  const pending = page(id, { pauseAfterFirst: true });
  await until(id, "render:consumed"); await sleep(600);
  const atRevoke = pending.rec.bytes;
  await control({ op: "revoke", id }); await sleep(200);
  pending.resume(); await pending.done;
  await dumpServer(id);
  const result = final(pending.rec, id);
  const text = Buffer.concat(pending.rec.chunks).toString("utf8");
  summary[current] = { clientBytesAtRevoke: atRevoke, final: result, yBlockOccurrences: count(text, "y".repeat(size)), htmlOpenTags: count(text, "<html"), flightScripts: count(text, "self.__next_f.push") };
}
// G. Suspense 스트리밍 페이지: 대기 구간(셸) / 최종(보호 표식) 분리, 정상 대조군
for (const op of ["revoke", "expire", "none"]) {
  current = `G-suspense-${op}`;
  const { id } = await control({ op: "issue", kind: "page", hold: op === "none" ? "none" : "render" });
  const pending = send(`/t315/suspense?ticket=${id}`, { ticket: id });
  let during = null;
  if (op !== "none") {
    await until(id, "render:hold"); await sleep(400);
    const text = Buffer.concat(pending.rec.chunks).toString("utf8");
    during = { ...waiting(pending.rec), shell: count(text, "T315-PUBLIC-SHELL"), loading: count(text, "T315-LOADING"), protectedMarkers: count(text, marker(id)) };
    log("client:waiting-snapshot", { ticket: id, ...during });
    await control({ op, id }); await control({ op: "release", id });
  }
  await pending.done;
  await dumpServer(id);
  const text = Buffer.concat(pending.rec.chunks).toString("utf8");
  summary[current] = { waiting: during, final: final(pending.rec, id), withheld: count(text, "T315-WITHHELD"), shell: count(text, "T315-PUBLIC-SHELL") };
}

writeFileSync(RAW, raw.map((line) => JSON.stringify(line)).join("\n") + "\n", { flag: "wx" });
writeFileSync(SUMMARY, JSON.stringify({ port: PORT, node: process.version, cases: summary }, null, 1) + "\n", { flag: "wx" });
console.log(`cases=${Object.keys(summary).length} rawLines=${raw.length}`);
