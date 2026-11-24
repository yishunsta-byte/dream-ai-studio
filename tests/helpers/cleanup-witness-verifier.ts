import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { z } from "zod";

// Test support only. No provider, persistence, lifecycle operation or permission API.
const names = ["run", "clients", "receipt", "baselines"] as const;
const MAX_BYTES = 131072;
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pid = integer.min(1);
const printable = (s: string) => Array.from(s).every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const word = z.string().min(1).max(256).refine(s => s.trim() === s && printable(s));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().min(2).max(2048).refine(s => /^(?:[A-Za-z]:\/|\/)/.test(s)
  && !s.includes("\\") && printable(s) && !s.endsWith("/")
  && s.replace(/^[A-Za-z]:\//, "").replace(/^\//, "").split("/").every(p => p !== "" && p !== "." && p !== ".."));
const stamp = z.iso.datetime({ offset: true }).refine(s => /(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(s)
  && (s.match(/\.(\d+)/)?.[1].length ?? 0) <= 9);
const hashes = z.strictObject({ run: sha, clients: sha, receipt: sha, baselines: sha });
const binding = { task: word, scenario: z.enum(["A", "B"]), attempt: word, host: word,
  root: path, cluster: path, port: integer.min(1).max(65535), source: sha };
const authoritySchema = z.strictObject({ ...binding, authorized: z.literal(true),
  profile: z.strictObject({ id: word, mode: word }), clockOrigin: word,
  plannedSlots: z.array(word).min(1).max(16), inputHashes: hashes });
const errorRecord = z.strictObject({ id: word, category: word, message: z.string().max(4096) });
const identity = z.strictObject({ pid, host: word, startUtc: stamp, path,
  status: z.enum(["complete", "partial", "error"]), errors: z.array(errorRecord).max(32) });
const inputSchemas = {
  run: z.strictObject({ ...binding, pid }),
  clients: z.strictObject({ ...binding, collectionComplete: z.boolean(), collected: z.array(z.strictObject({
    slot: word, pid, collected: z.boolean(),
  })).max(16) }),
  receipt: z.strictObject({ ...binding, completed: z.boolean(), pid, backendPids: z.array(pid).max(16) }),
  baselines: z.strictObject({ ...binding, captured: z.boolean(), phase: z.literal("startup-before-cleanup"),
    capturedUtc: stamp, identities: z.record(z.string().regex(/^[1-9]\d*$/), identity) }),
};
const probeSchema = z.strictObject({
  attempt: word, sample: word, host: word, source: sha, inputSet: sha, clockOrigin: word,
  seq: integer, kind: z.enum(["process", "listener", "pidfile"]), provider: z.enum(["CIM", "GetProcess", "TCP", "File"]),
  target: z.union([pid, path]), begin: integer, end: integer, utcBegin: stamp, utcEnd: stamp,
  status: z.enum(["absent", "present", "error"]), providerCompleted: z.boolean(),
  outcome: z.enum(["completed-empty", "recognized-no-match", "completed-rows", "query-failed"]),
  rowCount: integer.max(512), rows: z.array(z.unknown()).max(512),
  errors: z.strictObject({ query: z.array(errorRecord).max(32), nonTerminating: z.array(errorRecord).max(32), identity: z.array(errorRecord).max(32) }),
  rawErrorRecords: z.array(z.strictObject({ code: word, classification: word, channel: word })).max(32),
  absenceReason: word.nullable(), identityReadStatus: z.enum(["not-applicable", "complete", "partial", "error"]),
  details: z.strictObject({ profile: word, nativeOutcome: word, captureComplete: z.boolean() }),
});
const sampleSchema = z.strictObject({
  attempt: word, sample: word, index: integer, purpose: z.enum(["first-gate", "current-state"]),
  host: word, source: sha, inputSet: sha, clockOrigin: word, unit: z.literal("ns"),
  begin: integer, end: integer, utcBegin: stamp, utcEnd: stamp, generatedUtc: stamp,
  utcClockState: z.enum(["stable", "changed", "unknown"]), expectedPids: z.array(pid).min(1).max(17),
  startupIdentityCaptured: z.boolean(), receiptCompleted: z.boolean(), probes: z.array(probeSchema).min(1).max(36),
});

type Authority = z.infer<typeof authoritySchema>;
type Sample = z.infer<typeof sampleSchema>;
export type CleanupWitnessBlockCode = "invalid_authority" | "unsupported_profile" | "invalid_input_bytes"
  | "input_hash_mismatch" | "invalid_input_json" | "invalid_inventory" | "invalid_sample"
  | "invalid_probe" | "provider_error" | "present_observation" | "invalid_data";
type Issue = Readonly<{ code: CleanupWitnessBlockCode; path: string }>;
export type CleanupWitnessVerification = Readonly<{
  kind: "blocked"; issues: readonly Issue[];
}> | Readonly<{
  kind: "absence_candidate"; scope: "synthetic-test-only";
  evidence: Readonly<{ authority: Authority; sample: Sample; ownedPids: readonly number[] }>;
}>;

class Rejected extends Error {
  constructor(readonly code: CleanupWitnessBlockCode, readonly field: string) { super(code); }
}
function need(ok: unknown, code: CleanupWitnessBlockCode, field: string): asserts ok {
  if (!ok) throw new Rejected(code, field);
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
// Copy only bounded plain data without evaluating accessors or caller serializers.
function plain(value: unknown, depth = 0, budget = { left: 20000 }): unknown {
  need(!utilTypes.isProxy(value), "invalid_data", "data.proxy");
  need(depth <= 32 && --budget.left >= 0, "invalid_data", "data.limit");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") { need(Number.isFinite(value), "invalid_data", "data.number"); return value; }
  if (typeof value === "string") { need(value.length <= 8192, "invalid_data", "data.string"); return value; }
  need(typeof value === "object", "invalid_data", "data.type");
  const proto = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  need(array ? proto === Array.prototype : proto === Object.prototype || proto === null, "invalid_data", "data.prototype");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  need(Object.getOwnPropertySymbols(value).length === 0, "invalid_data", "data.symbols");
  if (array) {
    const length = descriptors.length.value as number;
    need(length <= 512 && Object.keys(descriptors).length === length + 1, "invalid_data", "data.array");
    return Array.from({ length }, (_, i) => {
      const d = descriptors[String(i)];
      need(d && "value" in d && d.enumerable, "invalid_data", "data.arrayItem");
      return plain(d.value, depth + 1, budget);
    });
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, d] of Object.entries(descriptors)) {
    need(key !== "__proto__" && key !== "constructor" && key !== "prototype" && "value" in d && d.enumerable, "invalid_data", "data.property");
    result[key] = plain(d.value, depth + 1, budget);
  }
  return result;
}
function parsed<S extends z.ZodType>(schema: S, value: unknown, code: CleanupWitnessBlockCode, field: string): z.output<S> {
  const result = schema.safeParse(plain(value));
  need(result.success, code, field);
  return result.data;
}
function rawBytes(value: unknown, name: string): Uint8Array {
  need(!utilTypes.isProxy(value), "invalid_input_bytes", name + ".proxy");
  need(utilTypes.isUint8Array(value), "invalid_input_bytes", name + ".brand");
  // Only inspect the immediate prototype of this genuine, non-Proxy view.
  // Never walk an untrusted chain with instanceof, even if its root is native.
  const bytePrototype = Object.getPrototypeOf(value);
  need(bytePrototype === Uint8Array.prototype || bytePrototype === Buffer.prototype, "invalid_input_bytes", name + ".bytePrototype");
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const getter = (key: string) => Object.getOwnPropertyDescriptor(typed, key)!.get!;
  let length: number;
  let buffer: unknown;
  try { length = getter("length").call(value); buffer = getter("buffer").call(value); }
  catch { throw new Rejected("invalid_input_bytes", name); }
  need(utilTypes.isArrayBuffer(buffer), "invalid_input_bytes", name + ".backingBrand");
  need(Object.getPrototypeOf(buffer) === ArrayBuffer.prototype, "invalid_input_bytes", name + ".backingPrototype");
  need(length > 0 && length <= MAX_BYTES, "invalid_input_bytes", name);
  need(Reflect.ownKeys(value).length === length, "invalid_input_bytes", name);
  const copy = new Uint8Array(length);
  for (let i = 0; i < length; i++) copy[i] = value[i];
  return copy;
}
function hash(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function json(bytes: Uint8Array, name: string): unknown {
  try {
    // A BOM is not silently stripped; only exact, fatal UTF-8 JSON is accepted.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const stack: Array<{ kind: string; keys: Set<string>; key: boolean }> = [];
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
      const t = token[0], top = stack.at(-1);
      // Narrow receipt grammar: canonical nonnegative base-10 safe integers only.
      // Check the original lexeme before JSON.parse can round a fraction/exponent.
      if (/^-?\d/.test(t)) need(/^(?:0|[1-9]\d*)$/.test(t) && t.length <= 16
        && BigInt(t) <= 9007199254740991n, "invalid_input_json", name + ".numericToken");
      if (t === "{" || t === "[") stack.push({ kind: t, keys: new Set(), key: t === "{" });
      else if (t === "}" || t === "]") stack.pop();
      else if (t === "," && top?.kind === "{") top.key = true;
      else if (t === ":" && top?.kind === "{") top.key = false;
      else if (t.startsWith('"') && top?.kind === "{" && top.key) {
        const key = JSON.parse(t) as string;
        need(!top.keys.has(key), "invalid_input_json", name + ".duplicateKey");
        top.keys.add(key);
      }
    }
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof Rejected) throw error;
    throw new Rejected("invalid_input_json", name);
  }
}
function time(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!;
  return BigInt(Date.parse(match[1] + match[3])) * 1000000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}
const syntheticReasons = { CIM: "fixture-empty-cim", GetProcess: "fixture-no-pid", TCP: "fixture-no-listener", File: "fixture-no-file" } as const;

/** Both authority pins and bytes must come from the controller, separately from sample.
 * No I/O, storage/ACK readiness, permission or claim about actual process absence. */
export function verifyCleanupWitnessCandidate(authority: unknown, inputBytes: unknown, sample: unknown): CleanupWitnessVerification {
  try {
    const a = parsed(authoritySchema, authority, "invalid_authority", "authority");
    need(a.profile.id === "pure-fixture-v2" && a.profile.mode === "synthetic-test-only", "unsupported_profile", "authority.profile");
    need(a.cluster === a.root + "/cluster" && new Set(a.plannedSlots).size === a.plannedSlots.length, "invalid_authority", "authority.ownership");
    need(!utilTypes.isProxy(inputBytes), "invalid_input_bytes", "inputs.proxy");
    need(inputBytes !== null && typeof inputBytes === "object" && !Array.isArray(inputBytes), "invalid_input_bytes", "inputs");
    need(Object.getPrototypeOf(inputBytes) === Object.prototype || Object.getPrototypeOf(inputBytes) === null, "invalid_input_bytes", "inputs.prototype");
    const descriptors = Object.getOwnPropertyDescriptors(inputBytes);
    need(Reflect.ownKeys(inputBytes).length === 4 && names.every(n => descriptors[n] && "value" in descriptors[n] && descriptors[n].enumerable), "invalid_input_bytes", "inputs.keys");
    const read = (name: typeof names[number]): unknown => {
      const bytes = rawBytes(descriptors[name].value, name);
      need(hash(bytes) === a.inputHashes[name], "input_hash_mismatch", name);
      return json(bytes, name);
    };
    const run = parsed(inputSchemas.run, read("run"), "invalid_input_json", "run");
    const clients = parsed(inputSchemas.clients, read("clients"), "invalid_input_json", "clients");
    const receipt = parsed(inputSchemas.receipt, read("receipt"), "invalid_input_json", "receipt");
    const baselines = parsed(inputSchemas.baselines, read("baselines"), "invalid_input_json", "baselines");
    for (const [name, record] of Object.entries({ run, clients, receipt, baselines })) {
      for (const key of Object.keys(binding) as Array<keyof typeof binding>) need(record[key] === a[key], "invalid_inventory", name + "." + key);
    }
    const ownedPids = [run.pid, ...clients.collected.map(c => c.pid)];
    need(clients.collectionComplete && clients.collected.every(c => c.collected) && new Set(ownedPids).size === ownedPids.length,
      "invalid_inventory", "clients.coverage");
    need(clients.collected.length === a.plannedSlots.length && clients.collected.every((c, i) => c.slot === a.plannedSlots[i]), "invalid_inventory", "clients.slots");
    need(receipt.completed && receipt.pid === run.pid && JSON.stringify(receipt.backendPids) === JSON.stringify(ownedPids.slice(1)), "invalid_inventory", "receipt.coverage");
    need(baselines.captured && Object.keys(baselines.identities).length === ownedPids.length && ownedPids.every(p => Object.hasOwn(baselines.identities, String(p))), "invalid_inventory", "baselines.coverage");
    for (const p of ownedPids) {
      const id = baselines.identities[String(p)];
      need(id.pid === p && id.host === a.host && id.status === "complete" && id.errors.length === 0 && time(id.startUtc) <= time(baselines.capturedUtc), "invalid_inventory", "baselines.identity");
    }
    const s = parsed(sampleSchema, sample, "invalid_sample", "sample");
    const inputSet = hash(JSON.stringify(names.map(n => [n, a.inputHashes[n]])));
    need(s.attempt === a.attempt && s.host === a.host && s.source === a.source && s.clockOrigin === a.clockOrigin && s.inputSet === inputSet,
      "invalid_sample", "sample.binding");
    need((s.index === 0 ? s.purpose === "first-gate" : s.purpose === "current-state") && s.startupIdentityCaptured && s.receiptCompleted
      && JSON.stringify(s.expectedPids) === JSON.stringify(ownedPids), "invalid_sample", "sample.coverage");
    need(s.utcClockState === "stable" && s.begin <= s.end && time(baselines.capturedUtc) <= time(s.utcBegin)
      && time(s.utcBegin) <= time(s.utcEnd) && time(s.utcEnd) <= time(s.generatedUtc), "invalid_sample", "sample.time");
    const plan: Array<readonly [string, string, number | string]> = ownedPids.flatMap(p => [["process", "CIM", p] as const, ["process", "GetProcess", p] as const]);
    plan.push(["listener", "TCP", a.port], ["pidfile", "File", a.cluster + "/postmaster.pid"]);
    need(s.probes.length === plan.length, "invalid_probe", "probes.coverage");
    let previousEnd = s.begin, previousUtc = time(s.utcBegin);
    let present = false;
    for (let i = 0; i < plan.length; i++) {
      const p = s.probes[i], field = "probes." + i;
      need(p.seq === i && p.kind === plan[i][0] && p.provider === plan[i][1] && p.target === plan[i][2], "invalid_probe", field + ".plan");
      for (const key of ["attempt", "sample", "host", "source", "inputSet", "clockOrigin"] as const) need(p[key] === s[key], "invalid_probe", field + ".binding");
      need(previousEnd <= p.begin && p.begin <= p.end && p.end <= s.end && previousUtc <= time(p.utcBegin)
        && time(p.utcBegin) <= time(p.utcEnd) && time(p.utcEnd) <= time(s.utcEnd), "invalid_probe", field + ".time");
      previousEnd = p.end; previousUtc = time(p.utcEnd);
      need(p.rowCount === p.rows.length, "invalid_probe", field + ".rows");
      need(p.providerCompleted && p.status !== "error" && Object.values(p.errors).every(e => e.length === 0), "provider_error", field + ".errors");
      need(p.details.profile === a.profile.id && p.details.nativeOutcome === p.outcome && p.details.captureComplete, "invalid_probe", field + ".details");
      if (p.status === "absent") {
        need(p.rowCount === 0 && p.identityReadStatus === "not-applicable" && p.absenceReason === syntheticReasons[p.provider], "invalid_probe", field + ".absence");
        if (p.outcome === "completed-empty") need(p.rawErrorRecords.length === 0, "provider_error", field + ".rawErrors");
        else {
          need(p.outcome === "recognized-no-match" && p.rawErrorRecords.length === 1, "invalid_probe", field + ".outcome");
          const e = p.rawErrorRecords[0];
          need(e.code === "fixture-" + p.provider + "-not-found" && e.classification === "known-absence" && e.channel === "terminating", "provider_error", field + ".rawErrors");
        }
      } else {
        need(p.rowCount > 0 && p.outcome === "completed-rows" && p.absenceReason === null && p.identityReadStatus === "complete" && p.rawErrorRecords.length === 0, "invalid_probe", field + ".presence");
        if (p.kind === "process") {
          need(p.rows.length === 1, "invalid_probe", field + ".presence");
          const id = parsed(identity, p.rows[0], "invalid_probe", field + ".identity");
          need(id.pid === p.target && id.host === a.host && id.status === "complete" && id.errors.length === 0 && time(id.startUtc) <= time(p.utcEnd), "invalid_probe", field + ".identity");
        }
        present = true;
      }
    }
    need(!present, "present_observation", "probes");
    return frozen({ kind: "absence_candidate", scope: "synthetic-test-only", evidence: { authority: a, sample: s, ownedPids } });
  } catch (error) {
    const issue: Issue = error instanceof Rejected ? { code: error.code, path: error.field } : { code: "invalid_data", path: "data" };
    return frozen({ kind: "blocked", issues: [issue] });
  }
}
