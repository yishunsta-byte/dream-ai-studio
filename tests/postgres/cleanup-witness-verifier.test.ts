import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => vi.fn(() => { throw Error("B50 I/O forbidden"); }));
vi.mock("node:fs/promises", () => ({ readFile: io, writeFile: io }));
vi.mock("node:child_process", () => ({ execFile: io, spawn: io }));
vi.mock("node:net", () => ({ createConnection: io, createServer: io }));
vi.mock("pg", () => ({ Client: io, Pool: io }));
import { verifyCleanupWitnessCandidate } from "../helpers/cleanup-witness-verifier";

const names = ["run", "clients", "receipt", "baselines"] as const;
type Name = typeof names[number];
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8");
const sha = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
const error = { id: "fixture-error", category: "fixture", message: "synthetic failure" };
function fixture() {
  const binding = { task: "B50-test", scenario: "A", attempt: "fixture-attempt-1", host: "fixture-host",
    root: "/fixture/owned", cluster: "/fixture/owned/cluster", port: 61000, source: "a".repeat(64) };
  const authority = { ...binding, authorized: true, profile: { id: "pure-fixture-v2", mode: "synthetic-test-only" },
    clockOrigin: "fixture-origin", plannedSlots: ["admin", "migration", "observer"],
    inputHashes: { run: "", clients: "", receipt: "", baselines: "" } };
  const id = (pid: number) => ({ pid, host: binding.host, startUtc: "2026-01-01T00:00:00Z",
    path: "/fixture/postgres.exe", status: "complete", errors: [] });
  const docs = {
    run: { ...binding, pid: 101 },
    clients: { ...binding, collectionComplete: true, collected: authority.plannedSlots.map((slot, i) => ({ slot, pid: i + 102, collected: true })) },
    receipt: { ...binding, completed: true, pid: 101, backendPids: [102, 103, 104] },
    baselines: { ...binding, captured: true, phase: "startup-before-cleanup", capturedUtc: "2026-01-01T00:00:00Z",
      identities: { "101": id(101), "102": id(102), "103": id(103), "104": id(104) } },
  };
  const plan = [101, 102, 103, 104].flatMap(pid => [["process", "CIM", pid], ["process", "GetProcess", pid]]);
  plan.push(["listener", "TCP", binding.port], ["pidfile", "File", binding.cluster + "/postmaster.pid"]);
  const reason: Record<string, string> = { CIM: "fixture-empty-cim", GetProcess: "fixture-no-pid", TCP: "fixture-no-listener", File: "fixture-no-file" };
  const sample = {
    attempt: binding.attempt, sample: "fixture-sample-0", index: 0, purpose: "first-gate", host: binding.host,
    source: binding.source, inputSet: "", clockOrigin: authority.clockOrigin, unit: "ns", begin: 0, end: 100,
    utcBegin: "2026-01-01T00:00:01Z", utcEnd: "2026-01-01T00:00:02Z", generatedUtc: "2026-01-01T00:00:03Z", utcClockState: "stable",
    expectedPids: [101, 102, 103, 104], startupIdentityCaptured: true, receiptCompleted: true,
    probes: plan.map(([kind, provider, target], seq) => ({
      attempt: binding.attempt, sample: "fixture-sample-0", host: binding.host, source: binding.source,
      inputSet: "", clockOrigin: authority.clockOrigin, seq, kind, provider, target, begin: seq * 2 + 1, end: seq * 2 + 2,
      utcBegin: "2026-01-01T00:00:01Z", utcEnd: "2026-01-01T00:00:01Z", status: "absent", providerCompleted: true,
      outcome: "completed-empty", rowCount: 0, rows: [] as unknown[],
      errors: { query: [] as unknown[], nonTerminating: [] as unknown[], identity: [] as unknown[] }, rawErrorRecords: [] as unknown[],
      absenceReason: reason[provider], identityReadStatus: "not-applicable",
      details: { profile: authority.profile.id, nativeOutcome: "completed-empty", captureComplete: true },
    })),
  };
  const packet = { authority, docs, sample, raw: {} as Record<Name, Uint8Array> };
  seal(packet);
  return packet;
}
type Packet = ReturnType<typeof fixture>;
function seal(p: Packet) {
  for (const n of names) { p.raw[n] = bytes(p.docs[n]); p.authority.inputHashes[n] = sha(p.raw[n]); }
  p.sample.inputSet = sha(JSON.stringify(names.map(n => [n, p.authority.inputHashes[n]])));
  p.sample.probes.forEach(probe => { probe.inputSet = p.sample.inputSet; });
}
type Change = { title: string; target: "authority" | "sample" | Name; key: (string | number)[]; value?: unknown; remove?: true };
function change(p: Packet, c: Change) {
  let cursor: unknown = c.target === "authority" ? p.authority : c.target === "sample" ? p.sample : p.docs[c.target];
  for (const part of c.key.slice(0, -1)) cursor = (cursor as Record<string, unknown>)[String(part)];
  const last = String(c.key.at(-1));
  if (c.remove) delete (cursor as Record<string, unknown>)[last];
  else (cursor as Record<string, unknown>)[last] = structuredClone(c.value);
  // Only source-receipt cases are intentionally pre-bound malformed fixtures.
  if (names.includes(c.target as Name)) seal(p);
}
function verify(p: Packet) { return verifyCleanupWitnessCandidate(p.authority, p.raw, p.sample); }
function blocked(p: Packet) { const result = verify(p); expect(result.kind).toBe("blocked"); return result; }

const independent13: Change[] = [
  { title: "identity baseline map empty", target: "baselines", key: ["identities"], value: {} },
  { title: "identity baseline missing path", target: "baselines", key: ["identities", "101", "path"], remove: true },
  { title: "startup flag is a truthy false string", target: "sample", key: ["startupIdentityCaptured"], value: "false" },
  { title: "absent probe carries partial identity status", target: "sample", key: ["probes", 0, "identityReadStatus"], value: "partial" },
  { title: "separate identity property error", target: "sample", key: ["probes", 0, "errors", "identity"], value: [error] },
  { title: "absent probe contains a positive row", target: "sample", key: ["probes", 0, "rows"], value: [{ pid: 101 }] },
  { title: "nonterminating error collection", target: "sample", key: ["probes", 0, "errors", "nonTerminating"], value: [error] },
  { title: "unknown no-match classification", target: "sample", key: ["probes", 0, "absenceReason"], value: "unknown-provider-output" },
  { title: "empty expected PID universe", target: "sample", key: ["expectedPids"], value: [] },
  { title: "duplicate expected PID inventory", target: "sample", key: ["expectedPids"], value: [101, 102, 103, 104, 101] },
  { title: "producer flag is a truthy false string", target: "sample", key: ["receiptCompleted"], value: "false" },
  { title: "provider calls have overlapping/reversed sequence", target: "sample", key: ["probes", 1, "begin"], value: 0 },
  { title: "probe is outside sample range", target: "sample", key: ["begin"], value: 90 },
];
const boundaries: Change[] = [
  { title: "real provider profile unsupported", target: "authority", key: ["profile", "id"], value: "windows-process-v1" },
  { title: "synthetic mode explicit", target: "authority", key: ["profile", "mode"], value: "production" },
  { title: "authority numeric boolean", target: "authority", key: ["authorized"], value: 1 },
  { title: "unknown authority member", target: "authority", key: ["injected"], value: true },
  { title: "invalid source pin", target: "authority", key: ["source"], value: "not-a-sha" },
  { title: "control character in authority ID", target: "authority", key: ["host"], value: "host\nline" },
  { title: "path traversal in authority", target: "authority", key: ["root"], value: "/fixture/../owned" },
  { title: "planned client omitted", target: "clients", key: ["collected"], value: [{ slot: "admin", pid: 102, collected: true }] },
  { title: "receipt PID mismatch", target: "receipt", key: ["pid"], value: 777 },
  { title: "receipt missing client", target: "receipt", key: ["backendPids"], value: [102, 103] },
  { title: "duplicate collected PID", target: "clients", key: ["collected", 1, "pid"], value: 102 },
  { title: "client slot swapped", target: "clients", key: ["collected", 0, "slot"], value: "observer" },
  { title: "false producer completion", target: "receipt", key: ["completed"], value: false },
  { title: "truthy producer receipt", target: "receipt", key: ["completed"], value: "false" },
  { title: "boolean PID", target: "run", key: ["pid"], value: true },
  { title: "floating PID", target: "run", key: ["pid"], value: 101.5 },
  { title: "zero PID", target: "run", key: ["pid"], value: 0 },
  { title: "unsafe PID", target: "run", key: ["pid"], value: Number.MAX_SAFE_INTEGER + 1 },
  { title: "extra identity key", target: "baselines", key: ["identities", "999"], value: {} },
  { title: "baseline retrieval error", target: "baselines", key: ["identities", "101", "errors"], value: [error] },
  { title: "wrong baseline PID", target: "baselines", key: ["identities", "101", "pid"], value: 999 },
  { title: "wrong baseline host", target: "baselines", key: ["identities", "101", "host"], value: "different-host" },
  { title: "late baseline", target: "baselines", key: ["capturedUtc"], value: "2026-01-01T00:00:04Z" },
  { title: "baseline created after capture", target: "baselines", key: ["identities", "101", "startUtc"], value: "2026-01-01T00:00:04Z" },
  { title: "wrong baseline phase", target: "baselines", key: ["phase"], value: "reconstructed" },
  { title: "baseline image is not absolute", target: "baselines", key: ["identities", "101", "path"], value: "postgres.exe" },
  { title: "source receipt wrong root", target: "run", key: ["root"], value: "/different/root" },
  { title: "wrong input attempt", target: "run", key: ["attempt"], value: "other-attempt" },
  { title: "wrong input port", target: "run", key: ["port"], value: 61001 },
  { title: "unknown receipt member", target: "run", key: ["injected"], value: true },
  { title: "sample inventory omits collected client", target: "sample", key: ["expectedPids"], value: [101, 102, 103] },
  { title: "clock changed", target: "sample", key: ["utcClockState"], value: "changed" },
  { title: "clock unknown", target: "sample", key: ["utcClockState"], value: "unknown" },
  { title: "wrong clock origin", target: "sample", key: ["clockOrigin"], value: "other-clock" },
  { title: "missing UTC offset", target: "sample", key: ["utcBegin"], value: "2026-01-01T00:00:01" },
  { title: "impossible UTC date", target: "sample", key: ["utcBegin"], value: "2026-02-30T00:00:01Z" },
  { title: "wrong monotonic unit", target: "sample", key: ["unit"], value: "seconds" },
  { title: "floating monotonic value", target: "sample", key: ["probes", 0, "end"], value: 2.5 },
  { title: "unsafe monotonic value", target: "sample", key: ["end"], value: Number.MAX_SAFE_INTEGER + 1 },
  { title: "mixed sample", target: "sample", key: ["probes", 0, "sample"], value: "another" },
  { title: "mixed input digest", target: "sample", key: ["probes", 0, "inputSet"], value: "b".repeat(64) },
  { title: "duplicate sequence", target: "sample", key: ["probes", 1, "seq"], value: 0 },
  { title: "wrong PID target", target: "sample", key: ["probes", 0, "target"], value: 999 },
  { title: "unknown normalized field", target: "sample", key: ["probes", 0, "extra"], value: true },
  { title: "row count boolean", target: "sample", key: ["probes", 0, "rowCount"], value: false },
  { title: "provider-completed numeric", target: "sample", key: ["probes", 0, "providerCompleted"], value: 1 },
  { title: "missing identity error channel", target: "sample", key: ["probes", 0, "errors", "identity"], remove: true },
  { title: "query error empty output", target: "sample", key: ["probes", 0, "errors", "query"], value: [error] },
  { title: "capture incomplete", target: "sample", key: ["probes", 0, "details", "captureComplete"], value: false },
  { title: "native outcome disagrees", target: "sample", key: ["probes", 0, "details", "nativeOutcome"], value: "query-failed" },
  { title: "listener partial status", target: "sample", key: ["probes", 8, "identityReadStatus"], value: "partial" },
  { title: "file error empty output", target: "sample", key: ["probes", 9, "errors", "query"], value: [error] },
  { title: "raw unclassified error", target: "sample", key: ["probes", 0, "rawErrorRecords"], value: [{ code: "denied", classification: "error", channel: "terminating" }] },
  { title: "generated before sample completes", target: "sample", key: ["generatedUtc"], value: "2026-01-01T00:00:00Z" },
];

describe("B50 pure cleanup witness candidate verifier", () => {
  it("returns only a synthetic absence candidate and immutable isolated evidence", () => {
    const p = fixture(), result = verify(p);
    expect(result.kind).toBe("absence_candidate");
    if (result.kind !== "absence_candidate") throw Error("positive control blocked");
    expect(result.scope).toBe("synthetic-test-only");
    expect(result.evidence.ownedPids).toEqual([101, 102, 103, 104]);
    expect(Object.isFrozen(result.evidence.sample.probes[0])).toBe(true);
    p.sample.probes[0].target = 999;
    expect(result.evidence.sample.probes[0].target).toBe(101);
    expect(Object.keys(result).sort()).toEqual(["evidence", "kind", "scope"]);
    expect(io).not.toHaveBeenCalled();
  });
  it.each(independent13)("independent condition: $title", c => {
    const p = fixture(); change(p, c); blocked(p);
  });
  it.each(boundaries)("boundary: $title", c => { const p = fixture(); change(p, c); blocked(p); });
  it.each(Object.keys(fixture().sample))("requires sample field %s", key => {
    const p = fixture(); change(p, { title: key, target: "sample", key: [key], remove: true }); blocked(p);
  });
  it.each(Object.keys(fixture().sample.probes[0]))("requires probe field %s", key => {
    const p = fixture(); change(p, { title: key, target: "sample", key: ["probes", 0, key], remove: true }); blocked(p);
  });
  it("allows a recognized synthetic no-match with its exact retained raw classification", () => {
    const p = fixture(), probe = p.sample.probes[1];
    probe.outcome = probe.details.nativeOutcome = "recognized-no-match";
    probe.rawErrorRecords = [{ code: "fixture-GetProcess-not-found", classification: "known-absence", channel: "terminating" }];
    expect(verify(p).kind).toBe("absence_candidate");
    probe.rawErrorRecords = [{ code: "unverified-real-code", classification: "known-absence", channel: "terminating" }];
    blocked(p);
  });
  it("requires the raw no-match record and never suppresses a property error", () => {
    const p = fixture(), probe = p.sample.probes[1];
    probe.outcome = probe.details.nativeOutcome = "recognized-no-match";
    blocked(p);
    probe.rawErrorRecords = [{ code: "fixture-GetProcess-not-found", classification: "known-absence", channel: "terminating" }];
    probe.errors.identity = [error]; blocked(p);
  });
  it.each(["pid", "\\u0070id"])("rejects duplicate decoded key %s in an otherwise complete, correctly pinned input", key => {
    const p = fixture();
    p.raw.run = Buffer.from(`{"${key}":101,${JSON.stringify(p.docs.run).slice(1)}`);
    p.authority.inputHashes.run = sha(p.raw.run);
    expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_json", path: "run.duplicateKey" }] });
  });
  it("keeps JSON string contents separate from duplicate-key tokenization", () => {
    const p = fixture();
    p.docs.baselines.identities["101"].path = '/fixture/text-{pid}-"key"-file.exe'; seal(p);
    expect(verify(p).kind).toBe("absence_candidate");
  });
  it("requires a complete postmaster plus approved client inventory even if no process probes are supplied", () => {
    const p = fixture(); p.sample.expectedPids = []; p.sample.probes = p.sample.probes.slice(-2); blocked(p);
  });
  it("checks consistent row counts as well as the absence status", () => {
    const p = fixture(); p.sample.probes[0].rows = [{ pid: 101 }]; p.sample.probes[0].rowCount = 1; blocked(p);
  });
  it.each(["attempt", "host", "source", "clockOrigin"])("binds each probe's %s to the same sample", key => {
    const p = fixture(); change(p, { title: key, target: "sample", key: ["probes", 0, key], value: key === "source" ? "b".repeat(64) : "other" }); blocked(p);
  });
  it("does not accept more than nanosecond timestamp precision", () => {
    const p = fixture(); p.sample.probes[0].utcBegin = "2026-01-01T00:00:01.0000000001Z"; blocked(p);
  });
  it("rejects negative or out-of-sample monotonic values", () => {
    const p = fixture(); p.sample.probes[0].begin = -1; blocked(p);
    p.sample.probes[0].begin = 1; p.sample.probes.at(-1)!.end = 101; blocked(p);
  });
  it.each(["original", "reused"])("blocks %s present process even if another provider says absent", mode => {
    const p = fixture(), probe = p.sample.probes[1];
    const row = structuredClone(p.docs.baselines.identities["101"]);
    if (mode === "reused") row.path = "/fixture/unrelated.exe";
    probe.status = "present"; probe.outcome = probe.details.nativeOutcome = "completed-rows";
    probe.rows = [row]; probe.rowCount = 1; probe.identityReadStatus = "complete";
    (probe as unknown as Record<string, unknown>).absenceReason = null;
    expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "present_observation", path: "probes" }] });
  });
  it("compares nanosecond UTC fractions instead of silently rounding them to milliseconds", () => {
    const p = fixture();
    p.sample.probes[0].utcBegin = "2026-01-01T00:00:01.000000002Z";
    p.sample.probes[0].utcEnd = "2026-01-01T00:00:01.000000001Z";
    blocked(p);
  });
  it("accepts equivalent offset timestamps and touching sequential bounds", () => {
    const p = fixture();
    p.sample.utcBegin = "2026-01-01T09:00:01+09:00";
    p.sample.probes[1].begin = p.sample.probes[0].end;
    expect(verify(p).kind).toBe("absence_candidate");
  });
  it("verifies original input bytes rather than reserializing parsed JSON", () => {
    const p = fixture();
    p.raw.run = Buffer.from("  " + JSON.stringify(p.docs.run) + "\n");
    expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "input_hash_mismatch", path: "run" }] });
    p.authority.inputHashes.run = sha(p.raw.run);
    p.sample.inputSet = sha(JSON.stringify(names.map(n => [n, p.authority.inputHashes[n]])));
    p.sample.probes.forEach(probe => { probe.inputSet = p.sample.inputSet; });
    expect(verify(p).kind).toBe("absence_candidate");
  });
  it.each(["{", '{"pid":101,"pid":102}', '{"pid":101,"\\u0070id":102}', "\ufeff{}"])("blocks malformed or ambiguous pinned JSON %s", text => {
    const p = fixture(); p.raw.run = Buffer.from(text); p.authority.inputHashes.run = sha(p.raw.run);
    expect(blocked(p).kind).toBe("blocked");
  });
  it("rejects invalid UTF8 without replacement decoding", () => {
    const p = fixture(); p.raw.run = new Uint8Array([0xff]); p.authority.inputHashes.run = sha(p.raw.run);
    expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_json", path: "run" }] });
  });
  it("requires all and only four byte inputs, rejects strings and oversized bytes", () => {
    const p = fixture();
    expect(verifyCleanupWitnessCandidate(p.authority, { ...p.raw, extra: bytes({}) }, p.sample).kind).toBe("blocked");
    expect(verifyCleanupWitnessCandidate(p.authority, { ...p.raw, run: JSON.stringify(p.docs.run) }, p.sample).kind).toBe("blocked");
    p.raw.run = new Uint8Array(131073); blocked(p);
  });
  it("rejects sparse arrays, custom prototypes, accessors and cycles without invoking getters", () => {
    const p = fixture(), getter = vi.fn(() => { throw Error("must not execute"); });
    Object.defineProperty(p.sample, "injected", { get: getter, enumerable: true });
    blocked(p); expect(getter).not.toHaveBeenCalled();
    const q = fixture(); Object.setPrototypeOf(q.sample, { inherited: true }); blocked(q);
    const s = fixture(); delete (s.sample.probes as unknown[])[0]; blocked(s);
    const c = fixture(); (c.sample as unknown as Record<string, unknown>).self = c.sample; blocked(c);
  });
  it("does not evaluate byte-input getters or accept shared mutable byte backing", () => {
    const p = fixture(), getter = vi.fn(() => p.raw.run), raw = { ...p.raw };
    Object.defineProperty(raw, "run", { get: getter, enumerable: true });
    expect(verifyCleanupWitnessCandidate(p.authority, raw, p.sample).kind).toBe("blocked");
    expect(getter).not.toHaveBeenCalled();
    p.raw.run = new Uint8Array(new SharedArrayBuffer(10)); blocked(p);
  });
  it("does not replay history or turn a current-state sample into execution permission", () => {
    const p = fixture(); p.sample.index = 1; p.sample.purpose = "current-state";
    const result = verify(p); expect(result.kind).toBe("absence_candidate");
    expect(Object.keys(result).sort()).toEqual(["evidence", "kind", "scope"]);
  });
  it("never leaks raw input or exception text in a structured blocked result", () => {
    const p = fixture(); p.sample.source = "synthetic-secret-marker";
    const result = blocked(p); expect(JSON.stringify(result)).not.toContain("synthetic-secret-marker");
    expect(Object.isFrozen(result)).toBe(true);
  });
  describe("F50-1 canonical original numeric lexemes", () => {
    // Correctly pin the exact altered bytes before verification; no hash mismatch
    // is used as a substitute for rejecting a rounded or unsupported number.
    const runToken = (token: string) => {
      const p = fixture();
      p.raw.run = Buffer.from(JSON.stringify(p.docs.run).replace('"pid":101', '"pid":' + token));
      p.authority.inputHashes.run = sha(p.raw.run);
      p.sample.inputSet = sha(JSON.stringify(names.map(n => [n, p.authority.inputHashes[n]])));
      p.sample.probes.forEach(probe => { probe.inputSet = p.sample.inputSet; });
      return p;
    };
    it.each([
      "101.000000000000000001", "1010000000000000000001e-19", "101.1",
      "101.0", "101e0", "1.01e2", "101E+0", "101e-0", "1e-999999", "1e999999",
      "-0", "-101", "9007199254740992", "9007199254740993", "9007199254740991.1",
      "900719925474099100e-2", "90071992547409910", "0.00000000000000000001",
    ])("blocks pinned noncanonical/unsafe number %s before binary64 rounding", token => {
      const p = runToken(token);
      expect(sha(p.raw.run)).toBe(p.authority.inputHashes.run);
      expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_json", path: "run.numericToken" }] });
    });
    it.each(["01", "+101", "101.", "1e", "NaN", "Infinity"])("retains strict JSON rejection for %s", token => { blocked(runToken(token)); });
    it("preserves a normal canonical integer and independently demonstrates the exact counterexample remainders", () => {
      expect(verify(runToken("101")).kind).toBe("absence_candidate");
      expect(101000000000000000001n % 1000000000000000000n).toBe(1n);
      expect(1010000000000000000001n % 10000000000000000000n).toBe(1n);
    });
    it("accepts MAX_SAFE_INTEGER exactly when every owned receipt and probe agrees", () => {
      const p = fixture(), max = 9007199254740991;
      p.docs.run.pid = p.docs.receipt.pid = max;
      const ids = p.docs.baselines.identities as Record<string, typeof p.docs.baselines.identities["101"]>;
      ids[String(max)] = { ...ids["101"], pid: max }; delete ids["101"];
      p.sample.expectedPids[0] = max;
      p.sample.probes[0].target = p.sample.probes[1].target = max;
      seal(p);
      expect(verify(p).kind).toBe("absence_candidate");
    });
    it("treats zero as an exact lexeme but still rejects it as a positive postmaster PID", () => {
      expect(blocked(runToken("0"))).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_json", path: "run" }] });
    });
    it("checks other receipt numeric fields, not only run.pid", () => {
      const p = fixture();
      p.raw.baselines = Buffer.from(JSON.stringify(p.docs.baselines).replace('"pid":101', '"pid":101.000000000000000001'));
      p.authority.inputHashes.baselines = sha(p.raw.baselines);
      p.sample.inputSet = sha(JSON.stringify(names.map(n => [n, p.authority.inputHashes[n]])));
      p.sample.probes.forEach(probe => { probe.inputSet = p.sample.inputSet; });
      expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_json", path: "baselines.numericToken" }] });
    });
    it("does not tokenize numeric-looking string contents", () => {
      const p = fixture();
      p.docs.baselines.identities["101"].path = '/fixture/101.000000000000000001-1e999-0.exe';
      seal(p); expect(verify(p).kind).toBe("absence_candidate");
    });
    it("keeps byte-hash rejection ahead of lexeme validation", () => {
      const p = runToken("101.000000000000000001"); p.authority.inputHashes.run = "b".repeat(64);
      expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "input_hash_mismatch", path: "run" }] });
    });
  });
  describe("F50-2 native Proxy rejection before caller code", () => {
    const positions = ["authority", "sample", "bundle", "authority-profile", "authority-slots", "authority-pins",
      "probe-array", "probe-object", "error-object", "rows-array", "expected-pids", "byte-container"] as const;
    for (const mode of ["transparent", "throwing", "revoked"] as const) {
      it.each(positions)(mode + " Proxy in %s blocks with exactly zero trap calls", position => {
        const p = fixture(), calls = vi.fn();
        const wrap = <T extends object>(target: T): T => {
          const hit = () => { calls(); if (mode === "throwing") throw Error("caller trap must not execute"); };
          const handler: ProxyHandler<T> = {
            getPrototypeOf(t) { hit(); return Reflect.getPrototypeOf(t); },
            ownKeys(t) { hit(); return Reflect.ownKeys(t); },
            getOwnPropertyDescriptor(t, key) { hit(); return Reflect.getOwnPropertyDescriptor(t, key); },
            get(t, key, receiver) { hit(); return Reflect.get(t, key, receiver); },
            has(t, key) { hit(); return Reflect.has(t, key); },
          };
          if (mode === "revoked") { const r = Proxy.revocable(target, handler); r.revoke(); return r.proxy; }
          return new Proxy(target, handler);
        };
        let authority: unknown = p.authority, raw: unknown = p.raw, sample: unknown = p.sample;
        switch (position) {
          case "authority": authority = wrap(p.authority); break;
          case "sample": sample = wrap(p.sample); break;
          case "bundle": raw = wrap(p.raw); break;
          case "authority-profile": p.authority.profile = wrap(p.authority.profile); break;
          case "authority-slots": p.authority.plannedSlots = wrap(p.authority.plannedSlots); break;
          case "authority-pins": p.authority.inputHashes = wrap(p.authority.inputHashes); break;
          case "probe-array": p.sample.probes = wrap(p.sample.probes); break;
          case "probe-object": p.sample.probes[0] = wrap(p.sample.probes[0]); break;
          case "error-object": p.sample.probes[0].errors = wrap(p.sample.probes[0].errors); break;
          case "rows-array": p.sample.probes[0].rows = wrap(p.sample.probes[0].rows); break;
          case "expected-pids": p.sample.expectedPids = wrap(p.sample.expectedPids); break;
          case "byte-container": p.raw.run = wrap(p.raw.run); break;
        }
        const result = verifyCleanupWitnessCandidate(authority, raw, sample);
        const field = position === "bundle" ? "inputs.proxy" : position === "byte-container" ? "run.proxy" : "data.proxy";
        expect(result).toEqual({ kind: "blocked", issues: [{ code: position === "bundle" || position === "byte-container" ? "invalid_input_bytes" : "invalid_data", path: field }] });
        expect(calls).not.toHaveBeenCalled();
      });
    }
    it("keeps byte subclass and shared-buffer rejection and normal byte positive controls", () => {
      class SubBytes extends Uint8Array {}
      const p = fixture(); p.raw.run = new SubBytes(p.raw.run); blocked(p);
      const q = fixture(); q.raw.run = new Uint8Array(new SharedArrayBuffer(4)); blocked(q);
      const r = fixture(); r.raw.run = new Uint8Array(r.raw.run); expect(verify(r).kind).toBe("absence_candidate");
      expect(io).not.toHaveBeenCalled();
    });
  });
  describe("F50-2 genuine bytes with untrusted prototypes", () => {
    for (const mode of ["transparent", "throwing", "revoked"] as const) {
      it.each(["byte", "backing"] as const)(mode + " %s prototype Proxy is rejected without walking its chain", position => {
        const p = fixture(), native = new Uint8Array(p.raw.run), backing = native.buffer;
        // Copy to an unshared, unpooled backing store and check the original pin
        // before constructing the hostile prototype. Do not exercise caller
        // hooks via an unrelated assertion's own traversal afterward.
        expect(sha(native)).toBe(p.authority.inputHashes.run);
        const calls = vi.fn();
        const expectedPrototype = position === "byte" ? Uint8Array.prototype : ArrayBuffer.prototype;
        const hit = () => { calls(); if (mode === "throwing") throw Error("prototype trap must not execute"); };
        const handler: ProxyHandler<object> = {
          getPrototypeOf() { hit(); return expectedPrototype; },
          ownKeys(t) { hit(); return Reflect.ownKeys(t); },
          getOwnPropertyDescriptor(t, key) { hit(); return Reflect.getOwnPropertyDescriptor(t, key); },
          get(t, key, receiver) { hit(); return Reflect.get(t, key, receiver); },
        };
        const r = Proxy.revocable({}, handler);
        if (mode === "revoked") r.revoke();
        Object.setPrototypeOf(position === "byte" ? native : backing, r.proxy);
        p.raw.run = native;
        expect(calls).not.toHaveBeenCalled();
        const result = verify(p);
        expect(result).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_bytes", path: "run." + (position === "byte" ? "bytePrototype" : "backingPrototype") }] });
        expect(calls).not.toHaveBeenCalled();
      });
    }
    it.each(["byte", "backing"] as const)("rejects ordinary custom %s prototypes without instanceof", position => {
      const p = fixture(), native = new Uint8Array(p.raw.run);
      const target = position === "byte" ? native : native.buffer;
      Object.setPrototypeOf(target, Object.create(position === "byte" ? Uint8Array.prototype : ArrayBuffer.prototype));
      p.raw.run = native;
      expect(blocked(p)).toEqual({ kind: "blocked", issues: [{ code: "invalid_input_bytes", path: "run." + (position === "byte" ? "bytePrototype" : "backingPrototype") }] });
    });
    it("preserves both normal Buffer and Uint8Array original-byte positive controls", () => {
      const p = fixture(); expect(verify(p).kind).toBe("absence_candidate");
      for (const n of names) p.raw[n] = new Uint8Array(p.raw[n]);
      expect(verify(p).kind).toBe("absence_candidate");
      expect(io).not.toHaveBeenCalled();
    });
  });
});
