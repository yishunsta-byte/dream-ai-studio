/* global console, process, setTimeout, clearTimeout */
import { spawn } from "node:child_process";
import { mkdir, open, readFile, realpath, writeFile, access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.platform !== "win32" || process.argv[2] !== "--bin" || !process.argv[3]) {
  throw new Error("Usage on Windows: node tests/postgres/run-versioned-source-catalog-local.mjs --bin <signed-portable-pg-bin> ");
}
const bin = await realpath(process.argv[3]);

if (process.argv.length !== 4) throw new Error("Only an explicit signed binary directory is supported");
const root = join(repo, "tmp", `b22-postgres-${randomUUID()}`);
await mkdir(root, { recursive: true });
const cluster = join(root, "cluster");
const env = { ...process.env, DREAM_PG_TEST_BIN: bin };
// Do not inherit PG* connection/SSL/startup defaults from the operator's shell.
for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];

async function run(exe, args, log, customEnv = env, timeout = 60000) {
  const output = await open(join(root, log), "a");
  try {
    return await new Promise((resolveRun, reject) => {
      const child = spawn(exe, args, { cwd: repo, env: customEnv, windowsHide: true, stdio: ["ignore", output.fd, output.fd] });
      // A timeout does not kill a process or prove it exited. Preserve owned logs
      // and report failure so the operator can inspect it before recovery.
      const timer = setTimeout(() => reject(new Error(`Owned test command timed out; inspect ${log}`)), timeout);
      child.once("error", () => { clearTimeout(timer); reject(new Error(`Owned test command failed; inspect ${log}`)); });
      child.once("exit", code => { clearTimeout(timer); resolveRun(code ?? 1); });
    });
  } finally { await output.close(); }
}
function checked(code, label) { if (code !== 0) throw new Error(label); }

let started = false;
let exitCode;
try {
  const signatureCheck = "$ErrorActionPreference='Stop'; foreach($name in @('postgres.exe','initdb.exe','pg_ctl.exe','createdb.exe')) { $sig=Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DREAM_PG_TEST_BIN $name); if($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Expected valid EDB signature' }; Write-Output ($name + ': Valid EnterpriseDB') }";
  checked(await run("powershell.exe", ["-NoProfile", "-Command", signatureCheck], "signatures.log"), "Portable binary signature verification failed");
  checked(await run(join(bin, "postgres.exe"), ["--version"], "version.txt"), "Postgres version check failed");
  const password = join(root, "synthetic-password.txt");
  await writeFile(password, "b3-synthetic-admin-only");
  // A concurrent build/copy can make the initial filesystem sync exceed 60s.
  // Keep sync enabled; extend only this owned initialization timeout.
  checked(await run(join(bin, "initdb.exe"), ["-D", cluster, "-U", "dream_test_admin", `--pwfile=${password}`, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], "initdb.log", env, 120000), "Synthetic initdb failed");
  const listener = createServer();
  const port = await new Promise((resolvePort, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
  checked(await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], "start.log"), "Synthetic PostgreSQL start failed");
  started = true;
  const pidInfo = (await readFile(join(cluster, "postmaster.pid"), "utf8")).trim().split(/\r?\n/);
  const pid = Number(pidInfo[0]);
  const ownListener = `$listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen); if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne ${pid}) { exit 1 }; Write-Output 'Owned loopback listener verified'`;
  checked(await run("powershell.exe", ["-NoProfile", "-Command", ownListener], "listener.log"), "Listener ownership mismatch");
  await writeFile(join(root, "run.json"), JSON.stringify({ root, pid, port, address: "127.0.0.1", database: "dream_test_b3" }, null, 2));
  checked(await run(join(bin, "createdb.exe"), ["-h", "127.0.0.1", "-p", String(port), "-U", "dream_test_admin", "dream_test_b3"], "createdb.log", { ...env, PGPASSWORD: "b3-synthetic-admin-only" }), "Synthetic database creation failed");
  const tests = ["tests/postgres/versioned-source-catalog.test.ts"];
  exitCode = await run(process.execPath, [join(repo, "node_modules/vitest/vitest.mjs"), "run", ...tests], "tests.log", {
    ...env, DREAM_PG_B22_SCHEMA_TEST: "1", DREAM_PG_B22_EVIDENCE_ROOT: root, DREAM_PG_TEST_ADMIN_URL: `postgresql://dream_test_admin:b3-synthetic-admin-only@127.0.0.1:${port}/dream_test_b3`,
  });
  console.log(await readFile(join(root, "tests.log"), "utf8"));
} finally {
  if (started) {
    const stopped = await run(join(bin, "pg_ctl.exe"), ["-D", cluster, "-m", "fast", "-w", "stop"], "stop.log");
    if (stopped !== 0) { exitCode = 1; console.error("Owned PostgreSQL stop failed; inspect stop.log"); }
    else {
      let remains = true; try { await access(join(cluster, "postmaster.pid")); } catch { remains = false; }
      const pidInfo = JSON.parse(await readFile(join(root, "run.json"), "utf8"));
      const listeners = await run("powershell.exe", ["-NoProfile", "-Command", `if(@(Get-NetTCPConnection -LocalPort ${pidInfo.port} -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { exit 1 }; Write-Output "Owned listener absent"`], "stopped-listener.log");
      if (remains || listeners !== 0) exitCode = 1;
      await writeFile(join(root, "cleanup-safe.json"), JSON.stringify({ postmasterPidAbsent: !remains, listenerAbsent: listeners === 0 }));
    }
  }
  console.log(`B22 synthetic evidence retained: ${root}`);
}
process.exitCode = exitCode ?? 1;
