/* global console, process, URL */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { checkServerIdentity } from "node:tls";
import { promisify } from "node:util";
import pg from "pg";

const run = promisify(execFile);
const loopback = "127.0.0.1";
const projectRef = "abcdefghijklmnopqrst";
const dbHost = "db." + projectRef + ".supabase.co";
const authHost = projectRef + ".supabase.co";
const rootPath = new URL("../../", import.meta.url);
const externalBin = process.env.P102_PG_BIN;
assert(externalBin, "Set P102_PG_BIN to the local PostgreSQL 17 bin directory.");
const bin = await realpath(externalBin);
const openssl = process.env.P102_OPENSSL || join(process.env.ProgramFiles, "Git", "usr", "bin", "openssl.exe");
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|TEMP|TMP|PATH)$/i.test(name)));
const exec = (file, args) => run(file, args, {env, windowsHide:true, timeout:120_000});
const pgExec = (name, args) => exec(join(bin, name + ".exe"), args);
for (const name of ["initdb", "pg_ctl", "postgres"]) assert.match((await pgExec(name, ["--version"])).stdout, /\(PostgreSQL\) 17\./);

const approved = [
  ["0001_schema.sql","3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19"],
  ["0002_invariants.sql","1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100"],
  ["0003_rls.sql","7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d"],
];
const sources = [];
for (const [file,hash] of approved) {
  const sql = (await readFile(new URL("lib/db/postgres/" + file, rootPath), "utf8")).replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"),hash,file);
  sources.push(sql);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve,reject)=>server.once("error",reject).listen(0,loopback,resolve));
  const port = server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent,"dream-p102-"));
const data = join(root,"cluster");
const password = randomBytes(28).toString("hex");
const port = await freePort();
let started = false;
let admin;
try {
  const pw = join(root,"bootstrap.txt");
  await writeFile(pw,password+"\n",{flag:"wx"});
  await pgExec("initdb",["-D",data,"--username=p102_root","--pwfile="+pw,"--auth=scram-sha-256","--encoding=UTF8","--locale=C","--no-sync"]);
  await rm(pw);
  const ca = join(data,"server.crt"), key = join(data,"server.key"), cfg = join(root,"openssl.cnf");
  await writeFile(cfg,"[req]\ndistinguished_name=dn\n[dn]\n");
  await exec(openssl,["req","-x509","-newkey","rsa:2048","-noenc","-days","1","-config",cfg,"-subj","/CN=P102 Isolated",
    "-addext","subjectAltName=IP:"+loopback+",DNS:"+dbHost+",DNS:"+authHost,"-keyout",key,"-out",ca]);
  started = true;
  const output = await open(join(root,"pg-start.log"),"wx");
  try {
    await new Promise((resolve,reject) => {
      const server = spawn(join(bin,"pg_ctl.exe"),["-D",data,"-l",join(root,"postgres.log"),"-o",
        "-h "+loopback+" -p "+port+" -c ssl=on","-w","-t","30","start"],
      {env,windowsHide:true,stdio:["ignore",output.fd,output.fd],timeout:40_000});
      server.once("error",reject);
      server.once("exit",code=>code===0?resolve():reject(new Error("Local PostgreSQL startup failed.")));
    });
  } finally { await output.close(); }
  const cert = await readFile(ca,"utf8");
  const connect = async (user,secret=password,servername=dbHost,database="postgres") => {
    const client = new pg.Client({host:loopback,port,database,user,password:secret,
      ssl:{ca:cert,servername,rejectUnauthorized:true,checkServerIdentity},
      connectionTimeoutMillis:5000,query_timeout:15000});
    await client.connect();
    return client;
  };
  admin = await connect("p102_root");
  assert.equal(admin.connection.stream.authorized,true);
  const {rows:[transport]} = await admin.query("SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl");
  assert.equal(transport.version,admin.connection.stream.getProtocol());
  const localPlan=process.argv.includes("--plan-local");
  const target=localPlan?"dream_test_t367":"postgres";
  if(localPlan){
    await admin.query("CREATE DATABASE dream_test_t367 TEMPLATE template0");
    await admin.end();
    admin=await connect("p102_root",password,dbHost,target);
  }
  await admin.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE authenticator NOLOGIN");
  await admin.query("CREATE ROLE p102_migrate NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS CREATEROLE; GRANT CREATE ON DATABASE "+target+" TO p102_migrate; GRANT USAGE ON SCHEMA auth TO p102_migrate; GRANT REFERENCES ON auth.users TO p102_migrate; SET ROLE p102_migrate");
  for (const sql of sources) assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
  await admin.query("RESET ROLE");
  const {rows:[catalog]} = await admin.query("SELECT current_setting('server_version') AS version, "+
    "(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dream' AND c.relrowsecurity AND c.relforcerowsecurity) AS forced, "+
    "(SELECT count(*)::int FROM pg_roles r WHERE r.rolname IN ('dream_api','dream_worker') AND NOT (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolbypassrls)) AS roles, "+
    "(SELECT count(*)::int FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator') AND has_schema_privilege(r.oid,'dream','USAGE')) AS browser_grants");
  assert.equal(catalog.forced,18);
  assert.equal(catalog.roles,2);
  assert.equal(catalog.browser_grants,0);
  console.log(JSON.stringify({postgres:catalog.version,tls:transport.version,hashes:approved.length,
    nonSuperuserInstaller:true,forcedRls:catalog.forced,restrictedBaseRoles:catalog.roles,browserGrants:catalog.browser_grants}));
  if(localPlan){
    const {verifyLocalPlan}=await import("./managed-plan-core-local.mjs");
    await verifyLocalPlan({admin,rootPath,password,port,loopback,freePort});
  } else if (process.argv.includes("--http")) {
    const { verifyHttp } = await import("./managed-project-core-http.mjs");
    await verifyHttp({admin,root,rootPath,connect,cert,key,dbHost,authHost,projectRef,port,password,freePort,loopback});
  }
} catch (error) {
  const log = await readFile(join(root,"postgres.log"),"utf8").catch(() => "");
  console.error(log.split(/\r?\n/).filter(line => / (?:ERROR|FATAL):/.test(line)).slice(-12).join("\n"));
  throw error;
} finally {
  await admin?.end().catch(()=>{});
  if (started) await pgExec("pg_ctl",["-D",data,"-m","fast","-w","-t","50","stop"]);
  const actual = await realpath(root);
  assert.equal(dirname(actual),parent);
  assert.match(basename(actual),/^dream-p102-[A-Za-z0-9]+$/);
  await rm(actual,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
