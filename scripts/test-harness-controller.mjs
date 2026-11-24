import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "dream-harness-test-"));
assert.equal(dirname(root), tmpdir());
const plan = join(root, "plan.md");
const html = join(root, "plan.html");
const adapter = join(root, "adapter.mjs");
const writes = join(root, "sends");
const instance = fileURLToPath(new URL("./harness-controller.mjs", import.meta.url));
const env = {
  ...process.env, DREAM_HARNESS_CONTROL_ROOT: root, DREAM_HARNESS_PLAN: plan,
  DREAM_HARNESS_PLAN_HTML: html, DREAM_HARNESS_ASSIGNMENT_ADAPTER: adapter,
  HARNESS_TEST_SEND_LOG: writes,
};
writeFileSync(plan, "RECORDED");
writeFileSync(html, "RECORDED");
writeFileSync(adapter, `
  import { appendFileSync } from "node:fs";
  appendFileSync(process.env.HARNESS_TEST_SEND_LOG, process.argv[3] + "\\n");
  console.log(JSON.stringify({ id: "msg_abcd" }));
`);
const call = (...args) => spawnSync(process.execPath, [instance, ...args], { env, encoding: "utf8", windowsHide: true });
const status = () => JSON.parse(call("status").stdout);
const sends = () => {
  try { return readFileSync(writes, "utf8").trim().split("\n"); }
  catch (error) { if (error.code !== "ENOENT") throw error; return []; }
};
let child;
let stderr = "";
function start() {
  child = spawn(process.execPath, [instance, "run"], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", data => { stderr += data; });
}
async function stop() {
  if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await stopped;
  }
}
async function waitFor(condition) {
  for (let i = 0; i < 80; i++) {
    try { if (condition()) return; } catch { /* Snapshot may still be starting. */ }
    await delay(125);
  }
  throw new Error("Controller condition not met. " + stderr);
}
function send(event) {
  const file = join(root, "input.json");
  writeFileSync(file, JSON.stringify(event));
  const r = call("submit", file);
  assert.equal(r.status, 0, r.stderr);
}
const common = { assignment: 1, attempt: "try1", marker: "RECORDED" };
const card = {
  ...common, kind: "queue", planRevision: "plan-1", role: "Front", recipient: "term_abcd",
  workspace: root, allowedPaths: ["src/example.ts"], baseCommit: "a".repeat(40), acceptance: ["scenario"],
  reviewer: "Tester", reportPath: "reports/example.md", summary: "Fixture with token=never-persist-this",
};
const result = (id, task, state, check = "NOT_RUN", actor = "Master") =>
  ({ ...common, id, task, kind: "state", state, check, actor, summary: state, evidence: "fixture" });
const command = (id, action) => ({ id, action, kind: "command", marker: "RECORDED", summary: action, impact: "test", source: "fixture" });
const taskState = task => status().tasks.find(row => row.task === task)?.state;

try {
  start();
  await waitFor(() => status().state === "MONITORING");
  const extra = call("run");
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /holds the lease/);

  send(command("CMD-20261122-001", "pause"));
  await waitFor(() => status().state === "PAUSED_BY_ADMIN");
  send({ ...card, id: "one", task: "first", dependencies: [] });
  send({ ...card, id: "one", task: "first", dependencies: [] });
  send({ ...card, id: "two", task: "later", dependencies: ["first"] });
  send({ ...card, id: "no-plan", marker: "ABSENT", task: "unapproved", dependencies: [] });
  await waitFor(() => taskState("first") === "READY" && taskState("later") === "READY");
  assert.equal(sends().length, 0);

  send(command("CMD-20261122-002", "resume"));
  await waitFor(() => taskState("first") === "QUEUED");
  assert.equal(sends().length, 1);
  assert.equal(taskState("unapproved"), undefined);
  const request = {
    id: "request-event", kind: "request", request: "login-needed", task: "blocked-fixture", marker: "RECORDED",
    category: "MANUAL_ACTION", summary: "login required", scope: "fixture", prepared: "fixture",
    recommendation: "fixture", procedure: "fixture", verification: "fixture", resume: "fixture",
  };
  send(request);
  send({ ...request, id: "duplicate-request" });
  await waitFor(() => status().state === "RUNNING_WITH_HUMAN_PENDING");
  assert.equal(status().requests.length, 1);
  await stop();
  start();
  await waitFor(() => status().pid === child.pid);
  send({ ...result("old", "first", "RUNNING"), assignment: 2 });
  send(result("running", "first", "RUNNING"));
  await waitFor(() => taskState("first") === "RUNNING");
  send(result("review", "first", "REVIEW"));
  await waitFor(() => taskState("first") === "REVIEW");
  send(result("own-review", "first", "VERIFIED", "PASS", "Front"));
  send(result("reviewed", "first", "VERIFIED", "PASS", "Tester"));
  await waitFor(() => taskState("first") === "VERIFIED");
  send(result("integrated", "first", "INTEGRATED", "PASS"));
  await waitFor(() => taskState("first") === "INTEGRATED");
  send(result("completed", "first", "DONE", "PASS"));
  await waitFor(() => taskState("later") === "QUEUED");
  assert.equal(sends().length, 2);
  assert.notEqual(sends()[0], sends()[1]);
  send({ ...card, id: "late-amend", kind: "amend", task: "later", assignment: 2, receipt: "msg_ff00",
    dependencies: ["first"], allowedPaths: ["src/example.ts", "src/additional.ts"] });
  await waitFor(() => status().tasks.find(row => row.task === "later")?.receipt === "msg_ff00");
  assert.equal(sends().length, 2);
  send(command("CMD-20261122-003", "record"));
  send({ id: "answer", kind: "answer", request: request.request, command: "CMD-20261122-003",
    marker: "RECORDED", summary: "login reported", evidence: "fixture" });
  await waitFor(() => status().requests[0]?.status === "REPORTED");
  assert.equal(status().state, "RUNNING_WITH_HUMAN_PENDING");
  send({ id: "verified-answer", kind: "answer", request: request.request, command: "CMD-20261122-003",
    marker: "RECORDED", summary: "login verified", evidence: "fixture", resolution: "VERIFIED" });
  await waitFor(() => status().requests.length === 0);
  assert.equal(status().lastInspection, undefined);
  const completedAt = new Date().toISOString();
  send({ id: "actual-inspection", kind: "inspection", marker: "RECORDED", completedAt,
    summary: "inspected all active tasks", evidence: "fixture" });
  await waitFor(() => status().lastInspection === completedAt);
  send({ id: "older-inspection", kind: "inspection", marker: "RECORDED", completedAt: "2000-01-01T00:00:00Z",
    summary: "imported old inspection", evidence: "fixture" });
  await waitFor(() => readFileSync(join(root, "events.jsonl"), "utf8").includes("older-inspection"));
  assert.equal(status().lastInspection, completedAt);
  const history = readFileSync(join(root, "events.jsonl"), "utf8");
  assert.match(history, /STALE_RESULT/);
  assert.match(history, /REJECTED/);
  assert.match(history, /AMENDED/);
  assert.doesNotMatch(history, /never-persist-this/);
  assert.equal((history.match(/"id":"one"/g) ?? []).length, 2);

  // The same terminal must finish its assignment even when the next task has an independent checkout and file scope.
  const nextWorkspace = join(root, "next-workspace");
  mkdirSync(nextWorkspace);
  send({ ...card, id: "same-recipient", task: "same-recipient", workspace: nextWorkspace,
    allowedPaths: ["other/next.ts"], dependencies: [] });
  await waitFor(() => taskState("same-recipient") === "READY");
  assert.equal(sends().length, 2);
  send({ ...result("later-started", "later", "RUNNING"), assignment: 2 });
  await waitFor(() => taskState("later") === "RUNNING");
  assert.equal(taskState("same-recipient"), "READY");
  assert.equal(sends().length, 2);
  send({ ...result("later-frozen", "later", "REVIEW"), assignment: 2 });
  await waitFor(() => taskState("same-recipient") === "QUEUED");
  assert.equal(sends().length, 3);

  const unassigned = fileURLToPath(new URL("./master-harness.mjs", import.meta.url));
  const direct = spawnSync(process.execPath, [unassigned, "assign", "unapproved-direct", "term_abcd", "manual task", "fixture"], { env, encoding: "utf8" });
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /no matching dispatch/);

  const alreadySent = { ...card, task: "already-sent", recipient: "term_beef", workspace: nextWorkspace,
    allowedPaths: ["other/next.ts"], dependencies: [], receipt: "msg_ff11" };
  send({ ...alreadySent, id: "conflicting-observation", kind: "observe" });
  await waitFor(() => readFileSync(join(root, "events.jsonl"), "utf8").includes("conflicting-observation"));
  assert.equal(taskState("already-sent"), undefined);
  send(result("release-other-scope", "same-recipient", "CANCELLED"));
  await waitFor(() => taskState("same-recipient") === "CANCELLED");
  send(command("CMD-20261122-004", "pause"));
  await waitFor(() => status().state === "PAUSED_BY_ADMIN");
  send({ ...alreadySent, id: "queued-before-observation" });
  await waitFor(() => taskState("already-sent") === "READY");
  send({ ...alreadySent, id: "reconciled-observation", kind: "observe" });
  await waitFor(() => taskState("already-sent") === "QUEUED");
  send({ ...alreadySent, id: "repeated-observation", kind: "observe" });
  send(command("CMD-20261122-005", "resume"));
  await waitFor(() => status().state === "RUNNING");
  assert.equal(sends().length, 3);
  assert.equal(status().tasks.find(row => row.task === "already-sent")?.receipt, "msg_ff11");
  const observations = readFileSync(join(root, "events.jsonl"), "utf8");
  assert.match(observations, /OBSERVATION_DUPLICATE/);
  assert.match(observations, /OBSERVATION_CONFLICT/);
  console.log("PASS: lease, pause/resume, plan guard, dedupe, review, restart, dependent dispatch, verified request closure, inspection timestamp, redaction, same-terminal serialization, receipt reconciliation and direct-send guard");
} finally {
  await stop();
  rmSync(root, { recursive: true, force: true });
}
