import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, unlinkSync, watch, writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = process.env.DREAM_HARNESS_CONTROL_ROOT || join(repo, "tmp", "master-harness");
const plan = process.env.DREAM_HARNESS_PLAN || join(repo, "docs", "MASTER_DEVELOPMENT_PLAN.md");
const renderedPlan = process.env.DREAM_HARNESS_PLAN_HTML || join(repo, "docs", "dev-plan.html");
const legacy = process.env.DREAM_HARNESS_ASSIGNMENT_ADAPTER || fileURLToPath(new URL("./master-harness.mjs", import.meta.url));
const inbox = join(root, "inbox");
const active = ["SENDING", "SEND_UNCERTAIN", "QUEUED", "RUNNING"];
const checks = new Set(["PASS", "FAIL", "NOT_RUN", "BLOCKED", "NOT_APPLICABLE"]);
const taskStates = new Set(["READY", "RUNNING", "REVIEW", "VERIFIED", "INTEGRATED", "DONE", "BLOCKED", "FAILED", "CANCELLED"]);
const pendingRequests = ["OPEN", "REPORTED", "DEFERRED"];
const transitions = {
  QUEUED: ["RUNNING", "BLOCKED", "FAILED", "CANCELLED"],
  RUNNING: ["REVIEW", "BLOCKED", "FAILED", "CANCELLED"],
  REVIEW: ["VERIFIED", "FAILED", "BLOCKED", "CANCELLED"],
  VERIFIED: ["INTEGRATED", "FAILED", "BLOCKED", "CANCELLED"],
  INTEGRATED: ["DONE", "FAILED", "BLOCKED"],
  SEND_UNCERTAIN: ["QUEUED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["READY", "CANCELLED"],
  FAILED: ["CANCELLED"],
  READY: ["BLOCKED", "CANCELLED"],
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function scrub(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED]")
    .replace(/\b(\w+:\/\/[^\s:/]+):[^\s@]+@/g, "$1:[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9_]{18,}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{8,})\b/g, "[REDACTED]")
    .replace(/\b(password|otp|token|api[_ -]?key|client[_ -]?secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b(password|otp|token|api[_ -]?key|client[_ -]?secret)\s+(is\s+)?\d{4,10}\b/gi, "$1 [REDACTED]");
}

function field(value, name, limit = 800) {
  invariant(typeof value === "string" && value.trim() && value.length <= limit, `Invalid ${name}`);
  return scrub(value.trim());
}

function id(value, name) {
  invariant(typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,94}$/.test(value), `Invalid ${name}`);
  return value;
}

function version(value, name) {
  invariant(Number.isSafeInteger(value) && value > 0, `Invalid ${name}`);
  return value;
}

function strings(values, name, { empty = false } = {}) {
  invariant(Array.isArray(values) && (empty || values.length) && values.length <= 60, `Invalid ${name}`);
  return values.map(value => field(value, name, 430));
}

const now = () => new Date().toISOString();
const seoul = timestamp => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium",
}).format(new Date(timestamp));

function packet(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "Invalid intake packet");
  const out = { id: id(raw.id, "event id"), kind: raw.kind };
  switch (raw.kind) {
    case "queue":
    case "observe":
    case "amend": {
      const workspace = field(raw.workspace, "workspace");
      invariant(isAbsolute(workspace) && existsSync(workspace), "Workspace must be an existing absolute path");
      const allowedPaths = strings(raw.allowedPaths, "allowed paths", { empty: true })
        .map(path => path.replaceAll("\\", "/").replace(/\/$/, ""));
      invariant(allowedPaths.every(path => /^[^:/]+(?:\/[^:/]+)*$/.test(path) &&
        !path.split("/").some(part => part === ".." || part === ".")), "Invalid owned path");
      invariant(/^term_[a-f0-9-]+$/.test(raw.recipient), "Invalid Orca recipient");
      invariant(/^[a-f0-9]{40}$/.test(raw.baseCommit), "Expected a full Git commit");
      const role = field(raw.role, "role", 80), reviewer = field(raw.reviewer, "reviewer", 100);
      invariant(role !== reviewer, "Independent reviewer must differ from the assigned role");
      if (raw.kind !== "queue") invariant(/^msg_[a-f0-9]+$/.test(raw.receipt), "Existing Orca receipt is required");
      return {
        ...out, task: id(raw.task, "task id"), attempt: id(raw.attempt, "attempt id"),
        assignment: version(raw.assignment, "assignment revision"), planRevision: id(raw.planRevision, "plan revision"),
        marker: id(raw.marker, "plan marker"), role, recipient: raw.recipient,
        workspace: realpathSync(workspace), allowedPaths, baseCommit: raw.baseCommit,
        dependencies: strings(raw.dependencies, "dependencies", { empty: true }).map(value => id(value, "dependency")),
        acceptance: strings(raw.acceptance, "acceptance"), reviewer,
        reportPath: field(raw.reportPath, "report path"), summary: field(raw.summary, "assignment summary", 3200),
        priority: Number.isSafeInteger(raw.priority) ? raw.priority : 0, receipt: raw.kind === "queue" ? null : raw.receipt,
      };
    }
    case "state": {
      invariant(taskStates.has(raw.state) || raw.state === "QUEUED", "Invalid task state");
      const quality = raw.check ?? "NOT_RUN";
      invariant(checks.has(quality), "Invalid check result");
      if (raw.state === "QUEUED") invariant(/^msg_[a-f0-9]+$/.test(raw.receipt), "Reconciled Orca receipt is required");
      return {
        ...out, task: id(raw.task, "task id"), attempt: id(raw.attempt, "attempt id"),
        assignment: version(raw.assignment, "assignment revision"), state: raw.state, check: quality,
        marker: id(raw.marker, "plan marker"), summary: field(raw.summary, "result", 1600),
        evidence: field(raw.evidence, "evidence"), actor: field(raw.actor ?? "Master", "actor", 80),
        receipt: raw.state === "QUEUED" ? raw.receipt : null,
      };
    }
    case "command": {
      invariant(/^CMD-\d{8}-\d{3,}$/.test(raw.id), "Expected a CMD id");
      invariant(["pause", "resume", "record"].includes(raw.action), "Invalid command action");
      return {
        ...out, action: raw.action, marker: raw.action === "pause" ? null : id(raw.marker, "plan marker"),
        summary: field(raw.summary, "command summary", 2400), impact: field(raw.impact, "scope and impact", 1000),
        source: field(raw.source, "admin channel", 120),
      };
    }
    case "request": {
      invariant(["DECISION", "AUTHORIZATION", "MANUAL_ACTION"].includes(raw.category), "Invalid administrator request type");
      return {
        ...out, request: id(raw.request, "request id"), task: id(raw.task, "task id"),
        marker: id(raw.marker, "plan marker"), category: raw.category,
        summary: field(raw.summary, "reason"), scope: field(raw.scope, "scope"),
        prepared: field(raw.prepared, "prepared work"), recommendation: field(raw.recommendation, "recommendation"),
        procedure: field(raw.procedure, "administrator action"), verification: field(raw.verification, "verification"),
        resume: field(raw.resume, "resume condition"),
      };
    }
    case "answer":
      invariant(["REPORTED", "VERIFIED", "REJECTED", "DEFERRED"].includes(raw.resolution ?? "REPORTED"), "Invalid request resolution");
      return {
        ...out, request: id(raw.request, "request id"), marker: id(raw.marker, "plan marker"),
        command: id(raw.command, "command id"), summary: field(raw.summary, "administrator answer"),
        evidence: field(raw.evidence, "confirmation"), resolution: raw.resolution ?? "REPORTED",
      };
    case "inspection": {
      const completedAt = Date.parse(raw.completedAt);
      invariant(typeof raw.completedAt === "string" && Number.isFinite(completedAt) && completedAt <= Date.now(), "Expected an actual inspection completion time");
      return {
        ...out, marker: id(raw.marker, "plan marker"), summary: field(raw.summary, "inspection summary"),
        evidence: field(raw.evidence, "inspection evidence"), completedAt: new Date(completedAt).toISOString(),
      };
    }
    default:
      throw new Error("Expected a queue, state or command packet");
  }
}

function publish(path, content) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
  renameSync(temp, path);
}

function hasPlanMarker(marker) {
  return [plan, renderedPlan].every(path => readFileSync(path, "utf8").includes(marker));
}

function openStore() {
  mkdirSync(inbox, { recursive: true });
  const db = new DatabaseSync(join(root, "controller.sqlite"));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, timestamp TEXT NOT NULL,
      kind TEXT NOT NULL, task TEXT, summary TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (
      task TEXT PRIMARY KEY, assignment INTEGER NOT NULL, attempt TEXT NOT NULL, state TEXT NOT NULL,
      priority INTEGER NOT NULL, receipt TEXT, card TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (
      request TEXT PRIMARY KEY, status TEXT NOT NULL, card TEXT NOT NULL);
  `);
  return db;
}

function setting(db, key) {
  return db.prepare("SELECT value FROM control WHERE key = ?").get(key)?.value;
}

function set(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO control VALUES (?, ?)").run(key, value);
}

function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function record(db, data, kind, summary) {
  db.prepare("INSERT INTO events (id, timestamp, kind, task, summary, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(data.id, now(), kind, data.task ?? null, summary, JSON.stringify(data));
}

function stillAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

function tasks(db) {
  return db.prepare("SELECT * FROM tasks ORDER BY priority DESC, task").all()
    .map(row => ({ ...row, card: JSON.parse(row.card) }));
}

function apply(db, event) {
  if (db.prepare("SELECT 1 FROM events WHERE id = ?").get(event.id)) return;
  if (event.marker && !hasPlanMarker(event.marker)) {
    record(db, event, "REJECTED", "Master plan and its published copy are missing the action marker");
    return;
  }
  const previous = event.task && db.prepare("SELECT * FROM tasks WHERE task = ?").get(event.task);
  if (event.kind === "command") {
    if (event.action !== "record") set(db, "paused", event.action === "pause" ? "1" : "0");
    set(db, "lastCommand", event.id);
    record(db, event, `COMMAND_${event.action.toUpperCase()}`, event.summary);
    return;
  }
  if (event.kind === "inspection") {
    if (event.completedAt > (setting(db, "lastInspection") ?? "")) set(db, "lastInspection", event.completedAt);
    record(db, event, "INSPECTION_COMPLETED", event.summary);
    return;
  }
  if (event.kind === "request") {
    const result = db.prepare("INSERT OR IGNORE INTO requests VALUES (?, 'OPEN', ?)").run(event.request, JSON.stringify(event));
    record(db, event, result.changes ? "HUMAN_REQUEST" : "REQUEST_ALREADY_OPEN", event.summary);
    return;
  }
  if (event.kind === "answer") {
    const command = db.prepare("SELECT kind FROM events WHERE id = ?").get(event.command);
    if (!command?.kind.startsWith("COMMAND_")) {
      record(db, event, "REJECTED", "Administrator command must be recorded before its answer");
      return;
    }
    const result = db.prepare("UPDATE requests SET status = ? WHERE request = ? AND status IN (?, ?, ?)")
      .run(event.resolution, event.request, ...pendingRequests);
    record(db, event, result.changes ? "HUMAN_ANSWER" : "REQUEST_NOT_OPEN", event.summary);
    return;
  }
  if (event.kind === "amend") {
    const old = previous && JSON.parse(previous.card);
    if (!old || !["QUEUED", "RUNNING"].includes(previous.state) ||
      previous.attempt !== event.attempt || previous.assignment >= event.assignment ||
      ["workspace", "recipient", "role", "baseCommit"].some(key => old[key] !== event[key]) ||
      tasks(db).some(row => row.task !== event.task && active.includes(row.state) && overlaps(event, row.card))) {
      record(db, event, "REJECTED", "Amendment is stale or overlaps an active assignment");
      return;
    }
    db.prepare("UPDATE tasks SET assignment = ?, receipt = ?, card = ? WHERE task = ?")
      .run(event.assignment, event.receipt, JSON.stringify(event), event.task);
    record(db, event, "AMENDED", event.summary);
    return;
  }
  if (event.kind === "queue" || event.kind === "observe") {
    if (event.kind === "observe" && handledObservation(db, event, previous)) return;
    const replaceable = ["READY", "BLOCKED", "FAILED", "CANCELLED"];
    if (event.dependencies.includes(event.task) || (previous &&
      (event.assignment <= previous.assignment || !replaceable.includes(previous.state) ||
        event.attempt === previous.attempt))) {
      record(db, event, "REJECTED", "Assignment is stale, cyclic or has an unfenced existing attempt");
      return;
    }
    const state = event.kind === "observe" ? "QUEUED" : "READY";
    db.prepare("INSERT OR REPLACE INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(event.task, event.assignment, event.attempt, state, event.priority, event.receipt, JSON.stringify(event));
    record(db, event, state, event.summary);
    return;
  }
  if (!previous || previous.attempt !== event.attempt || previous.assignment !== event.assignment) {
    record(db, event, "STALE_RESULT", "Result retained for Master review");
    return;
  }
  if (!transitions[previous.state]?.includes(event.state) ||
    (event.state === "VERIFIED" && event.actor !== JSON.parse(previous.card).reviewer) ||
    (event.state === "DONE" && event.actor !== "Master") ||
    (["VERIFIED", "INTEGRATED", "DONE"].includes(event.state) && event.check !== "PASS")) {
    record(db, event, "REJECTED", "Transition or documented validation is missing");
    return;
  }
  // A paused/failed write attempt can only be replaced with a new revision. Same-revision
  // READY is reserved for a task blocked before it received a delivery receipt.
  if (event.state === "READY" && previous.receipt) {
    record(db, event, "REJECTED", "A delivered attempt needs a new revision before redispatch");
    return;
  }
  db.prepare("UPDATE tasks SET state = ?, receipt = coalesce(?, receipt) WHERE task = ?").run(event.state, event.receipt, event.task);
  record(db, event, event.state, event.summary);
}

function handledObservation(db, event, previous) {
  const receiptOwner = db.prepare("SELECT task, attempt, assignment FROM tasks WHERE receipt = ?").get(event.receipt);
  const sameAssignment = previous?.attempt === event.attempt && previous.assignment === event.assignment;
  if (receiptOwner) {
    const sameReceipt = receiptOwner.task === event.task && sameAssignment &&
      receiptOwner.attempt === event.attempt && receiptOwner.assignment === event.assignment;
    record(db, event, sameReceipt ? "OBSERVATION_DUPLICATE" : "OBSERVATION_CONFLICT",
      sameReceipt ? "Receipt already recorded for this assignment" : "Receipt belongs to another assignment");
    return true;
  }

  const conflict = tasks(db).find(row => row.task !== event.task && active.includes(row.state) && overlaps(event, row.card));
  if (conflict) {
    record(db, event, "OBSERVATION_CONFLICT", `Existing assignment owns the workspace, paths or terminal: ${conflict.task}`);
    return true;
  }
  if (!sameAssignment) return false;

  const approved = JSON.parse(previous.card);
  const hasSameScope = ["recipient", "workspace", "baseCommit", "role", "reviewer", "reportPath"].every(key => approved[key] === event[key]) &&
    ["allowedPaths", "dependencies", "acceptance"].every(key => JSON.stringify(approved[key]) === JSON.stringify(event[key]));
  if (!["READY", "SEND_UNCERTAIN"].includes(previous.state) || !hasSameScope) {
    record(db, event, "OBSERVATION_CONFLICT", "Current dispatch state or approved assignment scope requires reconciliation");
    return true;
  }
  db.prepare("UPDATE tasks SET state = 'QUEUED', receipt = ? WHERE task = ?").run(event.receipt, event.task);
  record(db, event, "QUEUED", "Existing receipt reconciled without another dispatch");
  return true;
}

function collect(db) {
  const names = readdirSync(inbox).filter(name => name.endsWith(".json")).sort();
  const candidates = [];
  for (const name of names) {
    const path = join(inbox, name);
    try {
      const input = JSON.parse(readFileSync(path, "utf8"));
      const event = packet(input);
      candidates.push({ path, event });
    } catch (error) {
      transaction(db, () => {
        const event = { id: "invalid-" + randomUUID() };
        record(db, event, "REJECTED", "Invalid intake file. " + scrub(error.message));
      });
      unlinkSync(path);
    }
  }
  candidates.sort(({ event: a }, { event: b }) => Number(b.action === "pause") - Number(a.action === "pause"));
  for (const { path, event } of candidates) {
    transaction(db, () => apply(db, event));
    unlinkSync(path);
  }
}

function overlaps(a, b) {
  const location = path => process.platform === "win32" ? path.toLowerCase() : path;
  if (a.recipient === b.recipient || location(a.workspace) === location(b.workspace)) return true;
  return a.allowedPaths.some(x => b.allowedPaths.some(y => {
    const left = location(x), right = location(y);
    return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
  }));
}

function nextTask(db, rows = tasks(db)) {
  if (setting(db, "paused") === "1") return null;
  const busy = rows.filter(row => active.includes(row.state));
  return rows.find(row => row.state === "READY" &&
    row.card.dependencies.every(task => rows.some(dep => dep.task === task && dep.state === "DONE")) &&
    !busy.some(other => overlaps(row.card, other.card)));
}

function view(db) {
  const rows = tasks(db);
  const lease = JSON.parse(setting(db, "lease") || "null");
  const live = lease && stillAlive(lease.pid);
  const heartbeat = setting(db, "heartbeat");
  const requests = db.prepare("SELECT card, status FROM requests WHERE status IN (?, ?, ?) ORDER BY request")
    .all(...pendingRequests).map(row => ({ ...JSON.parse(row.card), status: row.status }));
  const humanPending = requests.length > 0;
  const next = nextTask(db, rows);
  const workPending = next || rows.some(row => active.includes(row.state) || ["REVIEW", "VERIFIED", "INTEGRATED"].includes(row.state));
  const dependencyPending = rows.some(row => ["READY", "BLOCKED"].includes(row.state));
  const paused = setting(db, "paused") === "1";
  const state = !live ? "STOPPED" : paused ? "PAUSED_BY_ADMIN" :
    (!heartbeat || Date.now() - Date.parse(heartbeat) > 20000 ||
      rows.some(row => row.state === "SEND_UNCERTAIN")) ? "RECOVERING" :
    workPending
      ? (humanPending ? "RUNNING_WITH_HUMAN_PENDING" : "RUNNING") : humanPending ? "WAITING_HUMAN" :
        dependencyPending ? "WAITING_DEPENDENCY" : "MONITORING";
  return {
    state, pid: live ? lease.pid : null, heartbeat, lastCommand: setting(db, "lastCommand"), lastInspection: setting(db, "lastInspection"),
    next: next?.task ?? (paused ? "Wait for admin resume" : state === "RECOVERING" ?
      "Reconcile the Orca receipt before retrying" : state === "WAITING_DEPENDENCY" ?
        "Review blocked or incomplete prerequisites" : "Await Orca wake or local intake"),
    requests,
    tasks: rows.map(({ task, state, receipt, card }) => ({ task, state, receipt, owner: card.role, attempt: card.attempt })),
  };
}

function projectState(db, lastProjected) {
  const recent = db.prepare("SELECT sequence, id, timestamp, kind, task, summary FROM events ORDER BY sequence DESC LIMIT 250").all().reverse();
  const viewData = view(db);
  publish(join(root, "STATE.json"), JSON.stringify(viewData, null, 2) + "\n");
  publish(join(root, "HUMAN_REQUESTS.json"), JSON.stringify(viewData.requests, null, 2) + "\n");
  const output = ["# Dream AI Studio 하네스", "", `- 상태 ${viewData.state}`, "- 현재 목표 같은 DB에서 이미지·오디오·쇼츠 제작 연결",
    `- Controller ${viewData.pid ?? "중지"} · 최근 생존 신호 ${viewData.heartbeat ? seoul(viewData.heartbeat) + " KST" : "없음"}`,
    `- 마지막 관리자 지시 ${viewData.lastCommand ?? "없음"}`, `- 마지막 전체 점검 ${viewData.lastInspection ? seoul(viewData.lastInspection) + " KST" : "기록 없음"}`, `- 다음 행동 ${viewData.next}`,
    `- 완료 ${viewData.tasks.filter(row => row.state === "DONE").length} · 실패 ${viewData.tasks.filter(row => row.state === "FAILED").length} · 관리자 요청 ${viewData.requests.length}`,
    "", ...viewData.tasks.map(row => `- ${row.task} · ${row.owner} · ${row.state}`),
    "", "## 관리자 요청", "", ...viewData.requests.map(card => `- ${card.request} · ${card.category} · ${card.status} · ${card.summary}`), "", "## 최근 사건", "",
    ...recent.slice(-12).map(event => `- ${seoul(event.timestamp)} · ${event.task ?? "하네스"} · ${event.kind} · ${event.summary}`)];
  publish(join(root, "STATUS.md"), output.join("\n") + "\n");
  const describe = event => `[${seoul(event.timestamp)} KST][Master][${event.task ?? "하네스"}][${event.kind}] ${event.summary} | ${viewData.next}`;
  const events = db.prepare("SELECT * FROM events WHERE sequence > ? ORDER BY sequence").all(lastProjected);
  if (events.length) {
    appendFileSync(join(root, "events.jsonl"), events.map(event => JSON.stringify({ ...event, data: JSON.parse(event.data) })).join("\n") + "\n");
    appendFileSync(join(root, "master.log"), events.map(describe).join("\n") + "\n");
    for (const event of events) console.log(describe(event));
  }
  return recent.at(-1)?.sequence ?? 0;
}

function dispatch(card) {
  const key = "h-" + createHash("sha256").update(JSON.stringify([card.task, card.attempt, card.assignment])).digest("hex").slice(0, 48);
  const body = [
    `작업 ${card.task} · 시도 ${card.attempt} · 배정 ${card.assignment} · 플랜 ${card.planRevision}`,
    `작업공간 ${card.workspace}`, `기준 ${card.baseCommit}`, `허용 경로 ${card.allowedPaths.join(", ") || "읽기 전용"}`,
    `인수 기준 ${card.acceptance.join(" / ")}`, `검수 ${card.reviewer}`, `인계 ${card.reportPath}`, card.summary,
  ].join("\n");
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [legacy, "assign", key, card.recipient, card.task, body],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 30000 });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk.toString().slice(0, 1000); });
    child.on("error", fail);
    child.on("close", code => {
      try {
        const receipt = JSON.parse(output).id;
        if (code !== 0 || !/^msg_[a-f0-9]+$/.test(receipt)) throw new Error("Orca receipt unavailable");
        done(receipt);
      } catch { fail(new Error(scrub(errors.trim()).slice(0, 300) || "Orca receipt unavailable")); }
    });
  });
}

function projectedSequence(db) {
  const path = join(root, "events.jsonl");
  if (!existsSync(path)) return 0;
  try {
    return JSON.parse(readFileSync(path, "utf8").trim().split("\n").at(-1) || "{}").sequence ?? 0;
  } catch {
    // SQLite is authoritative if a crash interrupted the append-only projection.
    const events = db.prepare("SELECT * FROM events ORDER BY sequence").all();
    publish(path, events.map(event => JSON.stringify({ ...event, data: JSON.parse(event.data) })).join("\n") + "\n");
    return events.at(-1)?.sequence ?? 0;
  }
}

async function run() {
  const db = openStore();
  const token = randomUUID();
  transaction(db, () => {
    const prior = JSON.parse(setting(db, "lease") || "null");
    invariant(!prior || !stillAlive(prior.pid), "Another Controller holds the lease");
    set(db, "lease", JSON.stringify({ pid: process.pid, token }));
    const interrupted = db.prepare("SELECT task FROM tasks WHERE state = 'SENDING'").all();
    db.exec("UPDATE tasks SET state = 'SEND_UNCERTAIN' WHERE state = 'SENDING'");
    for (const { task } of interrupted) record(db, { id: randomUUID(), task }, "SEND_UNCERTAIN", "Interrupted send needs Orca reconciliation");
    record(db, { id: randomUUID() }, "STARTED", "Controller opened the saved checkpoint");
  });
  let sending = false;
  let ending = false;
  let lastProjected = projectedSequence(db);
  const tick = () => {
    if (ending) return;
    set(db, "heartbeat", now());
    collect(db);
    const next = !sending && nextTask(db);
    if (next) {
      if (!hasPlanMarker(next.card.marker)) {
        transaction(db, () => {
          db.prepare("UPDATE tasks SET state = 'BLOCKED' WHERE task = ?").run(next.task);
          record(db, { id: randomUUID(), task: next.task }, "BLOCKED", "Master plan marker changed before dispatch");
        });
      } else {
        sending = true;
        transaction(db, () => {
          db.prepare("UPDATE tasks SET state = 'SENDING' WHERE task = ?").run(next.task);
          record(db, { id: randomUUID(), task: next.task }, "SENDING", "Sending the approved assignment through Orca");
        });
        void dispatch(next.card).then(receipt => finishSend(next.task, receipt), error => finishSend(next.task, null, error.message));
      }
    }
    lastProjected = projectState(db, lastProjected);
  };
  function finishSend(task, receipt, failure) {
    const state = receipt ? "QUEUED" : "SEND_UNCERTAIN";
    transaction(db, () => {
      db.prepare("UPDATE tasks SET state = ?, receipt = ? WHERE task = ?").run(state, receipt, task);
      record(db, { id: randomUUID(), task, receipt }, state, receipt ? "Orca delivery receipt stored" : "Check Orca before any retry. " + scrub(failure));
    });
    sending = false;
    if (ending) close();
    else guardedTick();
  }
  function close() {
    transaction(db, () => {
      if (JSON.parse(setting(db, "lease") || "null")?.token === token) db.prepare("DELETE FROM control WHERE key = 'lease'").run();
      record(db, { id: randomUUID() }, "STOPPED", "Controller closed with its checkpoint intact");
    });
    projectState(db, lastProjected);
    db.close();
  }
  function guardedTick() {
    try { tick(); } catch (error) {
      console.error("Controller tick failed. " + scrub(error.message));
      process.exitCode = 1;
      stop();
    }
  }
  const watcher = watch(inbox, { persistent: true }, (_kind, name) => {
    if (!name || name.endsWith(".json")) queueMicrotask(guardedTick);
  });
  watcher.on("error", error => console.error("Local watch unavailable. " + scrub(error.message)));
  const timer = setInterval(guardedTick, 5000);
  function stop() {
    if (ending) return;
    ending = true;
    clearInterval(timer);
    watcher.close();
    if (!sending) close();
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  guardedTick();
}

const [action, input] = process.argv.slice(2);
try {
  invariant(isAbsolute(root), "CONTROL_ROOT must be absolute");
  if (action === "run") await run();
  else if (action === "submit") {
    invariant(input, "Usage: submit <intake-json-file>");
    const event = packet(JSON.parse(readFileSync(input, "utf8")));
    mkdirSync(inbox, { recursive: true });
    publish(join(inbox, `${Date.now()}-${event.id}-${randomUUID()}.json`), JSON.stringify(event) + "\n");
    console.log(JSON.stringify({ staged: event.id, controlRoot: root }));
  } else if (action === "status") {
    invariant(existsSync(join(root, "controller.sqlite")), "Controller has not been started");
    const db = new DatabaseSync(join(root, "controller.sqlite"), { readOnly: true });
    try { console.log(JSON.stringify(view(db), null, 2)); } finally { db.close(); }
  } else throw new Error("Use run, submit <intake-json-file> or status");
} catch (error) {
  console.error(scrub(error.message));
  process.exitCode = 1;
}
