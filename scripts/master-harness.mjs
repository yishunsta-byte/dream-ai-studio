import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const run = "run_a3e2ad32d55d";
const master = "term_17af78d9-1177-4953-9000-d52d0457d46e";
const changeover = "msg_7e2129aea624";
const directory = process.env.DREAM_HARNESS_CONTROL_ROOT || fileURLToPath(new URL("../tmp/master-harness/", import.meta.url));
mkdirSync(directory, { recursive: true });
const db = new DatabaseSync(join(directory, run + ".sqlite"));
db.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS checkpoint (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS handled (
    id TEXT PRIMARY KEY,
    decision TEXT NOT NULL,
    finished_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignment (
    key TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    receipt TEXT
  );
`);

function orca(...args) {
  const command = spawnSync(process.env.DREAM_HARNESS_ORCA || "orca", ["orchestration", ...args, "--environment", "local", "--json", "--full"], {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (command.error) throw new Error("Orca CLI failed: " + command.error.code);
  const response = JSON.parse(command.stdout);
  if (command.status !== 0 || !response.ok) {
    throw new Error(response.error?.code ?? "Orca request failed");
  }
  return response.result;
}

function inbox(recipient, limit = "250") {
  const { messages } = orca("inbox", "--terminal", recipient, "--run", run, "--limit", limit);
  if (!Array.isArray(messages)) throw new Error("Orca inbox format changed");
  return messages;
}

function checkpointCursor() {
  return db.prepare("SELECT value FROM checkpoint WHERE key = 'cursor'").get()?.value ?? null;
}

function inboxAfter(cursor = checkpointCursor()) {
  const recipient = "run:" + run;
  const anchor = cursor ?? changeover;
  let messages = inbox(recipient);
  let boundary = messages.findIndex(message => message.id === anchor);
  if (boundary === -1) {
    messages = inbox(recipient, "2000");
    boundary = messages.findIndex(message => message.id === anchor);
  }
  if (boundary === -1) throw new Error("Checkpoint is outside inbox history. Reconcile before advancing.");
  return messages.slice(0, boundary).reverse();
}

function pending() {
  const handled = db.prepare("SELECT 1 FROM handled WHERE id = ?");
  return inboxAfter().filter(message => !handled.get(message.id));
}

function complete(id, decision) {
  if (!/^msg_[a-f0-9]+$/.test(id ?? "") || !decision?.trim()) {
    throw new Error("Usage: done <message-id> <decision and evidence>");
  }
  const handled = db.prepare("SELECT 1 FROM handled WHERE id = ?");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (handled.get(id)) return { alreadyHandled: id };
    const cursor = checkpointCursor();
    // Orca can take seconds to answer. Read its inbox outside the write transaction.
    const messages = inboxAfter(cursor);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (handled.get(id)) {
        db.exec("COMMIT");
        return { alreadyHandled: id };
      }
      if (checkpointCursor() !== cursor) {
        db.exec("ROLLBACK");
        continue;
      }
      if (!messages.some(message => message.id === id)) throw new Error("Message is outside the pending coordinator inbox");
      const finishedAt = new Date().toISOString();
      db.prepare("INSERT INTO handled VALUES (?, ?, ?)").run(id, decision, finishedAt);
      const next = messages.findIndex(message => !handled.get(message.id));
      const contiguous = messages.slice(0, next === -1 ? messages.length : next);
      if (contiguous.length > 0) {
        db.prepare("INSERT OR REPLACE INTO checkpoint VALUES ('cursor', ?)").run(contiguous.at(-1).id);
      }
      db.exec("COMMIT");
      return { handled: id, finishedAt };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  throw new Error("Checkpoint advanced during reconciliation; read the inbox again.");
}

function assign(key, recipient, subject, body) {
  if (!/^[a-z0-9-]{1,72}$/.test(key ?? "") || !/^term_[a-f0-9-]+$/.test(recipient ?? "") ||
      recipient === master || !subject?.trim() || !body?.trim()) {
    throw new Error("Submit new assignments to the Controller queue");
  }
  const controller = new DatabaseSync(join(directory, "controller.sqlite"), { readOnly: true });
  try {
    const card = controller.prepare("SELECT task, attempt, assignment, card FROM tasks WHERE task = ? AND state = 'SENDING'").get(subject);
    const expected = card && "h-" + createHash("sha256").update(JSON.stringify([card.task, card.attempt, card.assignment])).digest("hex").slice(0, 48);
    if (!card || key !== expected || JSON.parse(card.card).recipient !== recipient) {
      throw new Error("Submit new assignments to the Controller queue; no matching dispatch is active");
    }
  } finally {
    controller.close();
  }
  const thread = "master-harness-" + key;
  const saved = db.prepare("SELECT * FROM assignment WHERE key = ?").get(key);
  if (saved && saved.recipient !== recipient) throw new Error("Assignment key already belongs to another recipient");
  if (saved?.receipt) return { alreadyQueued: true, id: saved.receipt };

  const existing = inbox(recipient).find(message => message.thread_id === thread && message.from_handle === master);
  const claim = db.prepare("INSERT OR IGNORE INTO assignment VALUES (?, ?, NULL)").run(key, recipient);
  const current = db.prepare("SELECT * FROM assignment WHERE key = ?").get(key);
  if (current.recipient !== recipient) throw new Error("Assignment key already belongs to another recipient");
  if (current.receipt) return { alreadyQueued: true, id: current.receipt };
  const save = db.prepare("UPDATE assignment SET receipt = ? WHERE key = ?");
  if (existing) {
    save.run(existing.id, key);
    return { alreadyQueued: true, id: existing.id };
  }
  if (!claim.changes) throw new Error("Prior send is unconfirmed. Reconcile in Orca before any retry.");
  const temp = mkdtempSync(join(directory, "assignment-"));
  const bodyFile = join(temp, "body.txt");
  writeFileSync(bodyFile, body, "utf8");
  const sent = orca("send", "--run", run, "--from", master, "--to", recipient, "--thread-id", thread,
    "--type", "dispatch", "--subject", subject, "--body-file", bodyFile);
  const id = sent.messageId ?? sent.message?.id ?? sent.id;
  if (typeof id !== "string" || !id.startsWith("msg_")) {
    throw new Error("Send receipt needs reconciliation. Repeat the same command to look it up without resending.");
  }
  save.run(id, key);
  try {
    unlinkSync(bodyFile);
    rmdirSync(temp);
  } catch {
    // A successful delivery remains successful if the OS delays temporary file cleanup.
  }
  return { queued: true, id };
}

try {
  const [action, ...args] = process.argv.slice(2);
  const commands = {
    wake() {
      const delivery = orca("check", "--run", run, "--terminal", master);
      return { received: delivery.messages, pending: pending() };
    },
    resume() {
      return {
        pending: pending(),
        lastMessageHandledAt: db.prepare("SELECT MAX(finished_at) AS value FROM handled").get()?.value,
        unconfirmedAssignments: db.prepare("SELECT key, recipient FROM assignment WHERE receipt IS NULL").all(),
      };
    },
    probe(recipient = "run:" + run) {
      return { connected: Array.isArray(inbox(recipient, "1")) };
    },
    done: complete,
    assign,
  };
  if (!Object.hasOwn(commands, action)) throw new Error("Use wake, resume, done or assign");
  console.log(JSON.stringify(commands[action](...args), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
