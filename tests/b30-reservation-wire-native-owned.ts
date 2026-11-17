// B30: explicit owned Windows PG18.7 fixture only. Never reads .env or a DSN.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { decodeUploadReservation, encodeUploadReservation } from "../lib/db/postgres/upload-reservation-codec";
import { canonicalJson } from "../lib/storage/uploads/receipt";
import { reserveUpload } from "../lib/storage/uploads/state";
import { id } from "../lib/storage/uploads/schema";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--bin") {
  throw new Error("Usage: node --import tsx tests/b30-reservation-wire-native-owned.ts --bin <existing-pg18.7-bin>");
}
const bin = await realpath(process.argv[3]);
if (bin !== await realpath(join(repo, ".tools/b3-postgres-18.7/pgsql/bin"))) throw new Error("Unexpected binary directory");
const root = join(repo, "tmp", `b30-native-${randomUUID()}`), cluster = join(root, "cluster");
await mkdir(root, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value, null, 2));
const password = randomBytes(24).toString("hex"); // This new cluster's synthetic secret only.
for (const key of Object.keys(process.env)) if (key.startsWith("PG")) delete process.env[key];
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const childEnv = { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  DREAM_B30_BIN: bin }; // No inherited PG defaults, DSNs, app credentials or PATH change.
const exec = promisify(execFile);
const facts: unknown[] = [];
let stage = "source verification", port = 0, pid = 0, startAttempted = false, completed = false;
const clients = new Set<Client>();
const verify = (condition: unknown, label: string) => { if (!condition) throw new Error(`B30_ASSERT: ${label}`); };
const run = async (exe: string, args: string[], name: string, timeout = 60000) => {
  try {
    const out = await exec(exe, args, { cwd: repo, env: childEnv, windowsHide: true, timeout, maxBuffer: 4 * 1024 ** 2 });
    await writeFile(join(root, name), out.stdout + out.stderr); return out.stdout;
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string };
    await writeFile(join(root, name), (e.stdout ?? "") + (e.stderr ?? "")); throw error;
  }
};
const nativeError = (error: unknown) => {
  const e = error as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const key of ["message", "code", "detail", "hint", "where", "position", "internalPosition", "internalQuery", "schema", "table", "constraint", "routine"]) {
    if (e[key] !== undefined) result[key] = String(e[key]).replaceAll(password, "[synthetic-secret-redacted]");
  }
  return result;
};
const connect = async (database: string, user = "b30_bootstrap") => {
  const c = new Client({ host: "127.0.0.1", port, database, user, password, ssl: false, options: "",
    application_name: "B30-owned-native", client_encoding: "UTF8", connectionTimeoutMillis: 5000,
    statement_timeout: 30000, query_timeout: 45000 });
  clients.add(c); await c.connect(); return c;
};
const close = async (c: Client) => { try { await c.end(); } finally { clients.delete(c); } };
const src = [
  ["0001_schema.sql", "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql", "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql", "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
  ["0004_storage_verification.sql", "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c"],
] as const;
const fuse = "DO $fuse$ BEGIN RAISE EXCEPTION 'B27_UNPUBLISHED_EXECUTION_NOT_AUTHORIZED'; END $fuse$;";
let activeSource: { text: string; label: string; offset: number } | undefined;
let sql5: string, derived: string;
try {
  const baseline: string[] = [];
  for (const [name, expected] of src) {
    const text = lf(await readFile(join(repo, "lib/db/postgres", name), "utf8"));
    verify(sha(text) === expected, `${name} protected source hash`); baseline.push(text);
  }
  sql5 = lf(await readFile(join(repo, "lib/db/postgres/drafts/0005_upload_reservation.sql"), "utf8"));
  verify(sha(sql5) === "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb", "fixed fbfc48c SQL5 hash");
  verify(sql5.split(fuse).length === 2, "one exact known fuse");
  const fuseAt = sql5.indexOf(fuse);
  derived = sql5.slice(0, fuseAt) + sql5.slice(fuseAt + fuse.length);
  verify(derived.slice(0, fuseAt) + fuse + derived.slice(fuseAt) === sql5, "fuse-only exact derivation");
  await writeFile(join(root, "sql5-original.sql"), sql5);
  await writeFile(join(root, "sql5-fuse-only-derived.sql"), derived);
  await writeFile(join(root, "fuse-only.diff"), `--- fixed-fbfc48c.sql\n+++ B30-owned-derived.sql\n@@ -5 +5 @@\n-${fuse}\n+\n`);
  await save("derivation.json", { sourceCommit: "fbfc48c95264eaf37826f943b5e35e9fe67fa616", originalSha: sha(sql5),
    derivedSha: sha(derived), removedStatement: fuse, removedAt: fuseAt, removedLength: fuse.length,
    exactOneStatementOnly: true, lineCountPreserved: true, executionScope: "this owned B30 cluster only" });
  await save("ownership.json", { task: "B30", root, cluster, bin, nonce: randomUUID() });
  console.log(`B30 owned evidence: ${root}`);
  stage = "portable binary verification";
  await run(powershell, ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; foreach($n in @('postgres.exe','initdb.exe','pg_ctl.exe')) { $s=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_B30_BIN $n); if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Invalid existing EDB signature' }; Write-Output ($n+': Valid EnterpriseDB') }"], "signatures.log");
  verify((await run(join(bin, "postgres.exe"), ["--version"], "version.log")).includes("18.7"), "PG18.7 version");
  await writeFile(join(root, "synthetic-password.txt"), password);
  stage = "owned initdb";
  await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "b30_bootstrap", `--pwfile=${join(root, "synthetic-password.txt")}`,
    "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", 150000);
  const listener = createServer();
  port = await new Promise<number>((res, rej) => { listener.once("error", rej); listener.listen(0, "127.0.0.1", () => {
    const address = listener.address(); if (!address || typeof address === "string") return rej(new Error("No owned port"));
    listener.close(error => error ? rej(error) : res(address.port));
  }); });
  verify(port !== 3013, "never shared app port"); startAttempted = true;
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], "start.log");
  const pidLines = (await readFile(join(cluster, "postmaster.pid"), "utf8")).trim().split(/\r?\n/);
  pid = Number(pidLines[0]);
  verify(resolve(pidLines[1]) === resolve(cluster) && Number(pidLines[3]) === port, "owned PID directory and port");
  await run(powershell, ["-NoProfile", "-Command", `$l=@(Get-NetTCPConnection -LocalPort ${port} -State Listen); if($l.Count -ne 1 -or $l[0].LocalAddress -ne '127.0.0.1' -or $l[0].OwningProcess -ne ${pid}) { exit 1 }; Write-Output 'Owned loopback PID verified'`], "listener.log");
  await save("run.json", { root, cluster, bin, pid, port, address: "127.0.0.1", sourceSha: sha(sql5), derivedSha: sha(derived) });


  const admin = await connect("postgres");
  await admin.query(`CREATE ROLE b30_migration LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  await admin.query("CREATE DATABASE b30_fixture OWNER b30_migration TEMPLATE template0 ENCODING 'UTF8'");
  const management = await connect("b30_fixture", "b30_migration");
  const observer = await connect("b30_fixture");
  const principals = (await admin.query("SELECT oid,rolname,rolsuper,rolcreaterole FROM pg_roles WHERE rolname IN ('b30_bootstrap','b30_migration') ORDER BY rolname")).rows;
  const migrationOid = principals.find(p => p.rolname === "b30_migration")?.oid;
  const rootOid = principals.find(p => p.rolname === "b30_bootstrap")?.oid;
  verify(migrationOid && rootOid, "native management and bootstrap OIDs"); await save("principals.json", principals);
  stage = "full SQL1-5 setup"; console.log(`B30 ${stage}`);
  await management.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)");
  for (let n = 0; n < baseline.length; n++) {
    activeSource = { text: baseline[n], label: src[n][0], offset: 0 }; await management.query(baseline[n]);
  }
  await management.query("SELECT set_config('dream.b27_migration_owner_oid',$1,false),set_config('dream.b27_bootstrap_oid',$2,false),set_config('dream.b27_expected_pg_major','18',false)", [String(migrationOid), String(rootOid)]);
  activeSource = { text: derived, label: "sql5-fuse-only-derived.sql", offset: 0 };
  await management.query(derived); activeSource = undefined;
  const helperIdentity = (await management.query("SELECT current_user,session_user,pg_backend_pid() AS pid,current_user::regrole::oid AS oid")).rows[0];
  await save("helper-identity.json", { ...helperIdentity, layer: "management INVOKER helpers; not runtime privilege proof" });
  const owner = "00000000-0000-4000-8000-000000000001", worker = "00000000-0000-4000-8000-000000000002";
  const uid = (n: number) => `019b9000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
  const baseBody = { bodyVersion: 1, collectors: [worker], incomingBucket: "synthetic-incoming", intentTtlMs: 120000,
    issueEnvelopeMs: 90000, keyRule: "owner/incoming/object/intent:v1", maxBytes: 1048576, maxIssues: 3,
    maxPreparationAgeMs: 60000, policyManagers: [owner], providerMaxBytes: 1048576, verifiers: [worker] };
  const helperCounts: Record<string, { accepted: number; rejected: number }> = {};
  const count = (group: string, accepted: boolean) => {
    helperCounts[group] ??= { accepted: 0, rejected: 0 }; helperCounts[group][accepted ? "accepted" : "rejected"]++;
  };
  const check = async (group: string, label: string, text: string, values: unknown[], accepted: boolean,
    expectedValue?: unknown) => {
    stage = `${group}: ${label}`;
    let value: unknown, error: unknown;
    try { value = (await management.query(text, values)).rows[0].value; } catch (e) { error = e; }
    facts.push({ layer: "management helper", group, label, input: values, expectedAccepted: accepted,
      actualAccepted: !error, value, error: error ? nativeError(error) : undefined });
    verify(!error === accepted, `first contract mismatch ${stage}: ${JSON.stringify(error ? nativeError(error) : value)}`);
    if (error) verify(String((error as { code?: string }).code).startsWith("22"), `${stage} expected data rejection, not unrelated SQL/permission/timeout error`);
    if (accepted && expectedValue !== undefined) verify(canonicalJson(value) === canonicalJson(expectedValue), `${stage} exact canonical/native result`);
    count(group, accepted); return value;
  };
  stage = "UUID 180 native policy/shared/B25 comparisons";
  const uuidVectors: [string, boolean][] = [];
  for (let v = 1; v <= 8; v++) for (const variant of ["8", "9", "a", "b"]) uuidVectors.push([`01890abc-1234-${v}abc-${variant}abc-123456789abc`, true]);
  uuidVectors.push(["00000000-0000-0000-0000-000000000000", true], ["ffffffff-ffff-ffff-ffff-ffffffffffff", true]);
  for (const v of ["0", "9", "a", "b", "c", "d", "e", "f"]) uuidVectors.push([`01890abc-1234-${v}abc-8abc-123456789abc`, false]);
  for (const variant of ["0", "1", "2", "3", "4", "5", "6", "7", "c", "d", "e", "f"]) uuidVectors.push([`01890abc-1234-4abc-${variant}abc-123456789abc`, false]);
  uuidVectors.push(["01890ABC-1234-4abc-8abc-123456789abc", false], ["FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", false],
    ["01890abc12344abc8abc123456789abc", false], ["01890abc-1234-4abc-8abc-123456789abg", false],
    ["01890abc-1234-4abc-8abc-123456789abc\n", false], ["01890abc-1234-4abc-8abc-123456789abc ", false]);
  for (const [value, expected] of uuidVectors) for (const field of ["verifiers", "collectors", "policyManagers"] as const) {
    const body = { ...baseBody, [field]: [value] };
    const reservation = { ownerId: owner, objectId: uid(1), assetId: uid(2), intentId: uid(3), intentExpiresAt: 3000,
      issueEnvelopeUntil: 2000, maxIssues: 3, verifiers: body.verifiers, collectors: body.collectors, policyManagers: body.policyManagers,
      policyEpoch: 1, policyDigest: "b".repeat(64), incoming: { bucket: body.incomingBucket, key: `${owner}/incoming/${uid(1)}/${uid(3)}`, providerVersion: null } };
    let codecAccepted = false;
    try {
      const model = reserveUpload(reservation, { principalId: owner, now: 1000, expectedRevision: 0 });
      encodeUploadReservation({ model, requestJson: JSON.stringify({ codecVersion: 1, requestId: uid(4), maxBytes: 1024, reservedAt: 1000, reservation }) }); codecAccepted = true;
    } catch { /* Actual accepted model/codec decides the JS side. */ }
    verify(codecAccepted === expected && (value.length === 36 && id.safeParse(value).success) === expected, "shared/B19/B25 frozen UUID vector outcome");
    await check("uuid-policy", `${field}:${value}`, "SELECT dream_reservation.policy_v1($1) AS value", [canonicalJson(body)], expected, expected ? body : undefined);
  }
  await save("checks.json", facts); await save("counts.json", helperCounts); console.log("B30 UUID native: 102 accepted / 78 rejected, all shared/B25 matched");
  const wireGood = [
    ["empty", "{}"], ["order/whitespace", ' \n{"z":2,"a":1}\t '],
    ["escaped-ascii-key/value", String.raw`{"\u0061":"\u0041\/\\\""}`],
    ["nested/null/array", '{"a":[0,true,false,null,{"b":"x"}]}'],
    ["safe-integer", '{"n":9007199254740991}'], ["zero", '{"n":0}'],
  ] as const;
  for (const [label, raw] of wireGood) {
    await check("wire", label, "SELECT dream_reservation.parse_wire_v1($1) AS value", [raw], true, JSON.parse(raw));
    await check("canonical", label, "SELECT dream_reservation.canonical_json_v1($1::json,0) AS value", [raw], true, canonicalJson(JSON.parse(raw)));
  }
  const wireBad = [
    ["duplicate-root", '{"a":1,"a":2}'], ["duplicate-decoded", String.raw`{"a":1,"\u0061":2}`],
    ["duplicate-nested", '{"x":{"a":1,"a":2}}'], ["duplicate-in-array", String.raw`{"x":[{"a":1,"\u0061":2}]}`],
    ["json-null", "null"], ["root-array", "[]"], ["root-string", '"x"'], ["root-number", "1"],
    ["unicode-literal", '{"x":"한글"}'], ["unicode-escaped", String.raw`{"x":"\u00e9"}`],
    ["nul-escaped", String.raw`{"x":"\u0000"}`], ["nul-literal-transport", '{"x":"\u0000"}'],
    ["high-surrogate", String.raw`{"x":"\ud800"}`], ["low-surrogate", String.raw`{"x":"\udc00"}`],
    ["surrogate-pair-nonascii", String.raw`{"x":"\ud83d\ude00"}`], ["decoded-control", String.raw`{"x":"\n"}`],
    ["negative-zero", '{"n":-0}'], ["negative", '{"n":-1}'], ["exponent", '{"n":1e0}'], ["fraction", '{"n":1.0}'],
    ["over-safe-integer", '{"n":9007199254740992}'], ["leading-zero", '{"n":01}'], ["plus", '{"n":+1}'],
    ["trailing-data", '{}{}'], ["broken-escape", String.raw`{"x":"\q"}`],
  ] as const;
  for (const [label, raw] of wireBad) await check("wire", label, "SELECT dream_reservation.parse_wire_v1($1) AS value", [raw], false);
  let deep: unknown = 0;
  for (let n = 0; n < 16; n++) deep = { x: deep };
  const atDepth = JSON.stringify(deep), overDepth = JSON.stringify({ x: deep });
  await check("wire", "depth16", "SELECT dream_reservation.parse_wire_v1($1) AS value", [atDepth], true, deep);
  await check("canonical", "depth16", "SELECT dream_reservation.canonical_json_v1($1::json,0) AS value", [atDepth], true, canonicalJson(deep));
  await check("wire", "depth17", "SELECT dream_reservation.parse_wire_v1($1) AS value", [overDepth], false);
  await check("canonical", "depth17", "SELECT dream_reservation.canonical_json_v1($1::json,0) AS value", [overDepth], false);
  const exactBytes = " ".repeat(65529) + '{"x":1}';
  verify(Buffer.byteLength(exactBytes, "utf8") === 65536, "fixture exact byte boundary");
  await check("wire", "bytes65536", "SELECT dream_reservation.parse_wire_v1($1) AS value", [exactBytes], true, { x: 1 });
  await check("wire", "bytes65537", "SELECT dream_reservation.parse_wire_v1($1) AS value", [" " + exactBytes], false);
  await check("wire-sql-null", "STRICT SQL NULL", "SELECT dream_reservation.parse_wire_v1($1) AS value", [null], true, null);
  for (const raw of ["null", "true", '[3,2,1]', '"ASCII"', "0", "9007199254740991"]) await check("canonical", `scalar:${raw}`,
    "SELECT dream_reservation.canonical_json_v1($1::json,0) AS value", [raw], true, canonicalJson(JSON.parse(raw)));
  for (const raw of ["-0", "-1", "1e0", "1.0", "9007199254740992", String.raw`"\u00e9"`, String.raw`"\u0000"`]) await check("canonical", `invalid:${raw}`,
    "SELECT dream_reservation.canonical_json_v1($1::json,0) AS value", [raw], false);
  const clientText = (mime: string, bytes: string) => `{"claimedMime":"${mime}","clientVersion":1,"requestedMaxBytes":${bytes}}`;
  for (const mime of ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "video/webm"]) for (const bytes of ["1", "1024", "2147483648"]) {
    const raw = clientText(mime, bytes); await check("client", `${mime}:${bytes}`, "SELECT dream_reservation.client_v1($1) AS value", [raw], true, JSON.parse(raw));
  }
  const clientBad = [
    ...["0", "-0", "-1", "2147483649", "9007199254740991", "01", "+1", "1.0", "1e0", '"1"'].map(n => clientText("image/png", n)),
    clientText("image/PNG", "1"), clientText("video/avi", "1"), clientText(String.raw`image\/png`, "1"),
    ' {"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1}',
    '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1} ',
    '{"clientVersion":1,"claimedMime":"image/png","requestedMaxBytes":1}',
    '{"claimedMime":"image/png", "clientVersion":1,"requestedMaxBytes":1}',
    '{"claimedMime":"image/png","clientVersion":2,"requestedMaxBytes":1}',
    '{"claimedMime":"image/png","clientVersion":"1","requestedMaxBytes":1}',
    '{"claimedMime":"image/png","claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1}',
    String.raw`{"claimedM\u0069me":"image/png","clientVersion":1,"requestedMaxBytes":1}`,
    '{"claimedMime":"image/png","clientVersion":1,"requestedMaxBytes":1,"x":0}',
    "null", "[]", "", " ".repeat(160), " ".repeat(161),
  ];
  for (let n = 0; n < clientBad.length; n++) await check("client", `negative${n}`, "SELECT dream_reservation.client_v1($1) AS value", [clientBad[n]], false);
  await save("checks.json", facts); await save("counts.json", helperCounts); console.log("B30 wire/canonical/client native boundaries complete");
  const maximum = 9007199254740991n;
  for (const zone of ["UTC", "Asia/Seoul", "America/New_York"]) {
    await management.query("SELECT set_config('TimeZone',$1,false)", [zone]);
    for (const ms of [0n, 1n, 86399999n, 86400000n, 86400001n, maximum - 2n, maximum - 1n, maximum]) {
      const value = await check("epoch", `${zone}:${ms}`, "SELECT (extract(epoch FROM dream_reservation.epoch_ms_v1($1::bigint))*1000)::text AS value", [ms.toString()], true);
      verify(typeof value === "string" && /^(0|[1-9][0-9]*)(?:\.0+)?$/.test(value) && BigInt(value.split(".")[0]) === ms, "exact numeric epoch text, no Date/double rounding");
    }
    for (const ms of [-1n, maximum + 1n]) await check("epoch", `${zone}:reject:${ms}`, "SELECT (extract(epoch FROM dream_reservation.epoch_ms_v1($1::bigint))*1000)::text AS value", [ms.toString()], false);
  }
  await save("checks.json", facts); await save("counts.json", helperCounts); console.log("B30 epoch native: 24 exact text accepts / 6 rejects across three zones");
  await observer.query("INSERT INTO auth.users(id) VALUES($1),($2)", [owner, worker]);
  await admin.query(`CREATE ROLE b30_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'; GRANT dream_api TO b30_api WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  const api = await connect("b30_fixture", "b30_api");
  const runtimeIdentity = (await api.query("SELECT current_user,session_user,pg_backend_pid() AS pid,current_user::regrole::oid AS oid,r.rolsuper,r.rolbypassrls,r.rolcreaterole FROM pg_roles r WHERE r.oid=current_user::regrole")).rows[0];
  verify(!runtimeIdentity.rolsuper && !runtimeIdentity.rolbypassrls && !runtimeIdentity.rolcreaterole, "actual restricted entry login");
  const representatives = ["01890abc-1234-1abc-8abc-123456789abc", "01890abc-1234-7abc-8abc-123456789abc", "01890abc-1234-8abc-8abc-123456789abc",
    "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"];
  for (let index = 0; index < representatives.length; index++) {
    stage = `restricted entry representative ${index}`;
    const authority = representatives[index], epoch = index + 1, digest = sha(`B30-synthetic-policy-${index}`);
    const body = { ...baseBody, verifiers: [authority], collectors: [authority], policyManagers: [authority] };
    const rawBody = canonicalJson(body);
    await observer.query("INSERT INTO dream.storage_policy_versions VALUES('asset-upload',$1,$2,clock_timestamp())", [epoch, digest]);
    await observer.query("INSERT INTO dream_reservation.upload_policy_versions VALUES('asset-upload',$1,$2,$3,$4)", [epoch, digest, rawBody, sha(`upload-policy-body:v1\n${rawBody}`)]);
    if (index === 0) await observer.query("INSERT INTO dream.storage_policies VALUES('asset-upload',$1,$2,0,clock_timestamp())", [epoch, digest]);
    else await observer.query("UPDATE dream.storage_policies SET epoch=$1,digest=$2,revision=revision+1,updated_at=clock_timestamp() WHERE policy_id='asset-upload'", [epoch, digest]);
    await api.query("BEGIN; SET LOCAL ROLE dream_api"); await api.query("SELECT set_config('dream.actor_id',$1,true)", [owner]);
    const client = clientText("image/png", "1024"), requestId = uid(1000 + index * 10 + 4);
    const seed = (await api.query("SELECT dream_reservation.read_upload_seed_v1($1,$2) AS value", [requestId, client])).rows[0].value;
    verify(seed.tag === "seed", `representative seed ${String(seed.tag)}`);
    const reservation = { ownerId: owner, objectId: uid(1000 + index * 10 + 1), assetId: uid(1000 + index * 10 + 2), intentId: uid(1000 + index * 10 + 3),
      intentExpiresAt: seed.now + body.intentTtlMs, issueEnvelopeUntil: seed.now + body.issueEnvelopeMs,
      maxIssues: body.maxIssues, verifiers: body.verifiers, collectors: body.collectors, policyManagers: body.policyManagers,
      policyEpoch: epoch, policyDigest: digest,
      incoming: { bucket: body.incomingBucket, key: `${owner}/incoming/${uid(1000 + index * 10 + 1)}/${uid(1000 + index * 10 + 3)}`, providerVersion: null } };
    const model = reserveUpload(reservation, { principalId: owner, now: seed.now, expectedRevision: 0 });
    const plain = JSON.stringify({ codecVersion: 1, requestId, maxBytes: 1024, reservedAt: seed.now, reservation });
    const raw = ` \n${plain.replace('"codecVersion"', '"\\u0063odecVersion"').replace('synthetic-incoming', 'synthetic-\\u0069ncoming').replace('/incoming/', '\\/incoming\\/')}\t `;
    const codec = encodeUploadReservation({ model, requestJson: raw }), unescaped = encodeUploadReservation({ model, requestJson: plain });
    verify(codec.fingerprint === unescaped.fingerprint && codec.rawSha !== unescaped.rawSha, "raw escapes change raw hash, not semantic snapshot");
    const staged = (await api.query("SELECT dream_reservation.reserve_upload_v1($1,$2,$3) AS value", [requestId, client, raw])).rows[0].value;
    verify(staged.tag === "staged" && staged.commitConfirmed === false && staged.issuanceAuthorized === false, `representative reserve ${String(staged.tag)}`);
    verify((await api.query("COMMIT")).command === "COMMIT", "representative actual COMMIT");
    const object = (await observer.query(codec.selectObject.text, [...codec.selectObject.values])).rows[0];
    const intent = (await observer.query(codec.selectIntent.text, [...codec.selectIntent.values])).rows[0];
    const decoded = decodeUploadReservation({ object, intent });
    verify(canonicalJson(decoded.model) === canonicalJson(model) && decoded.requestJson === raw && decoded.rawSha === codec.rawSha && decoded.fingerprint === codec.fingerprint,
      "restricted actual native projections preserve original escaped raw and B25 model/hash");
    facts.push({ layer: "restricted entry COMMIT", group: "entry", authority, epoch, runtimeIdentity, requestId,
      raw, rawSha: codec.rawSha, plainRawSha: unescaped.rawSha, fingerprint: codec.fingerprint, staged, confirmedCommit: true, nativeB25Roundtrip: true });
    count("entry", true); await save("checks.json", facts); await save("counts.json", helperCounts);
  }
  const totals = (await observer.query("SELECT (SELECT count(*) FROM dream_reservation.upload_requests) AS requests,(SELECT count(*) FROM dream.storage_objects) AS objects,(SELECT count(*) FROM dream.upload_intents) AS intents,(SELECT count(*) FROM dream.storage_capability_issues) AS capabilities")).rows[0];
  verify(Number(totals.requests) === 5 && Number(totals.objects) === 5 && Number(totals.intents) === 5 && Number(totals.capabilities) === 0, "five representative triples only/no capabilities");
  await save("totals.json", totals); await close(api); await close(management); await close(observer); await close(admin); completed = true;
  console.log(`B30 complete: ${JSON.stringify(helperCounts)}`);
} catch (error) {
  const e = nativeError(error); let location: unknown;
  const position = Number((error as { position?: string }).position);
  if (activeSource && position > 0) {
    const at = activeSource.offset + position - 1, line = activeSource.text.slice(0, at).split("\n").length;
    location = { source: activeSource.label, line, position: at + 1, context: activeSource.text.split("\n").slice(Math.max(0, line - 3), line + 2) };
  }
  await save("checks-at-first-failure.json", facts);
  await save("first-failure.json", { stage, error: e, location, nativeStatementsWereNotRelaxed: true });
  console.error(JSON.stringify({ stage, firstFailure: e, location })); process.exitCode = 1;
} finally {
  for (const c of clients) { await c.query("ROLLBACK").catch(() => undefined); await close(c).catch(() => undefined); }
  let pidAbsent = false, listenerAbsent = false;
  try {
    if (startAttempted) await stopOwnedCluster();
    try { await access(join(cluster, "postmaster.pid")); } catch { pidAbsent = true; }
    if (port) {
      await run(powershell, ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output 'Owned port listener absent'`], "stopped-listener.log"); listenerAbsent = true;
    }
  } catch (error) { await save("cleanup-failure.json", nativeError(error)); process.exitCode = 1; }
  await save("cleanup-safe.json", { pid, port, postmasterPidAbsent: pidAbsent, listenerAbsent, completed });
  if (!completed || !pidAbsent || !listenerAbsent) process.exitCode = 1;
  console.log(`B30 retained owned evidence: ${root}; stopped=${pidAbsent && listenerAbsent}`);
}

async function stopOwnedCluster() {
  let text: string;
  try { text = await readFile(join(cluster, "postmaster.pid"), "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return; throw error; }
  const lines = text.trim().split(/\r?\n/);
  verify(resolve(lines[1]) === resolve(cluster) && Number(lines[3]) === port && (!pid || Number(lines[0]) === pid), "cleanup owned cluster identity");
  await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
}
