/* global console, process */
import assert from "node:assert/strict";
import { execFile, fork, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const exec=promisify(execFile);
const { Client }=pg;
const host="127.0.0.1";
const database="dream_test_t319";
const bootstrap="t319_bootstrap";
const controllerLogin="t319_controller";
const supervisorLogin="t319_supervisor";
const changeSql="SELECT rea_t319.change($1,$2,$3,$4,$5,$6) AS value";
const statusSql="SELECT rea_t319.status($1) AS value";
const terminateSql="SELECT rea_t319.terminate($1,$2,$3,$4,$5) AS value";
const command=(code,generation,owner,id=null,actor=null,candidate=null) => [code,generation,owner,id,actor,candidate];
const allowedEnv=new Set(["SYSTEMROOT","WINDIR","SYSTEMDRIVE","COMSPEC","TEMP","TMP"]);
const childEnv=Object.fromEntries(Object.entries(process.env).filter(([key]) => allowedEnv.has(key.toUpperCase())));

function within(promise,label,ms=4500) {
  let timer;
  const expired=new Promise((_,reject) => {
    timer=setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)),ms);
  });
  return Promise.race([promise,expired]).finally(() => clearTimeout(timer));
}

const value=async (client,sql,args=[]) => (await client.query(sql,args)).rows[0]?.value;
function connection(port,user,password,db=database) {
  return new Client({host,port,database:db,user,password,ssl:false,application_name:"t319-owned",
    options:"-c search_path=pg_catalog",connectionTimeoutMillis:1000,statement_timeout:8000});
}

function controllerChild() {
  assert.equal(typeof process.send,"function");
  let config;
  const holds=new Map();
  const report=message => { if (process.connected) process.send(message); };
  process.on("message",async message => {
    const {kind,id}=message;
    if (kind==="configure") {
      assert.equal(config,undefined);
      config={ port:message.port,password:message.password };
      report({kind:"ready",pid:process.pid});
      return;
    }
    if (kind==="commit") { holds.get(id)?.resolve(); return; }
    if (kind!=="rpc" || !config) return;
    const client=connection(config.port,controllerLogin,config.password);
    try {
      await client.connect();
      report({kind:"pid",id,pid:client.processID});
      if (message.hold) await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result=message.status
        ? await value(client,statusSql,message.args)
        : await value(client,changeSql,message.args);
      if (message.hold) {
        const latch=Promise.withResolvers();
        holds.set(id,latch);
        report({kind:"held",id});
        await latch.promise;
        await client.query("COMMIT");
      }
      if (!message.dropReply) report({kind:"result",id,result});
    } catch (error) {
      const unavailable=["ECONNREFUSED","ECONNRESET","57P01","57P03"].includes(error.code);
      report({kind:"result",id,result:unavailable ? "ledger_unavailable" : {error:error.code ?? "unknown"}});
    } finally {
      holds.delete(id);
      await client.end().catch(() => {});
    }
  });
  process.once("disconnect",() => { for (const latch of holds.values()) latch.reject(new Error("controller disconnected")); });
}

function senderChild() {
  assert.equal(typeof process.send,"function");
  let boot;
  process.on("message",message => {
    if (message.kind==="configure") {
      assert.equal(boot,undefined);
      boot=message.boot;
      process.send({kind:"ready",pid:process.pid,boot});
    }
    if (message.kind==="close-report") {
      // A synthetic transport event, separate from the process-exit evidence.
      process.send({kind:"close-report",pid:process.pid,boot,permit:message.permit});
    }
  });
}

function launch(role,config) {
  const child=fork(fileURLToPath(import.meta.url),[role],{windowsHide:true,execArgv:[],env:childEnv});
  const ready=Promise.withResolvers();
  const ended=Promise.withResolvers();
  const calls=new Map();
  let next=0;
  const actor={child,ready:ready.promise,exited:ended.promise,config,notice:undefined};
  child.on("message",message => {
    const {kind,id}=message;
    if (kind==="ready") ready.resolve(message);
    if (kind==="close-report") actor.notice?.resolve(message);
    const call=calls.get(id);
    if (!call) return;
    if (kind==="pid") call.pid.resolve(message.pid);
    if (kind==="held") call.held.resolve();
    if (kind==="result") { call.done.resolve(message.result); calls.delete(id); }
  });
  child.once("error",ready.reject);
  child.once("exit",(code,signal) => {
    actor.dead=true;
    for (const call of calls.values()) call.done.resolve("reply_lost");
    calls.clear();
    ended.resolve({pid:child.pid,code,signal});
  });
  child.send({kind:"configure",...config});
  actor.rpc=(args,options={}) => {
    const id=++next;
    const call={pid:Promise.withResolvers(),held:Promise.withResolvers(),done:Promise.withResolvers()};
    calls.set(id,call);
    child.send({kind:"rpc",id,args,...options});
    return {pid:call.pid.promise,held:call.held.promise,done:call.done.promise,commit:() => child.send({kind:"commit",id})};
  };
  return actor;
}

async function freePort() {
  const server=createServer();
  await new Promise((resolve,reject) => { server.once("error",reject); server.listen(0,host,resolve); });
  const {port}=server.address();
  await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function makeCluster() {
  assert.equal(process.argv.length,2,"The probe accepts no target arguments");
  assert.equal(process.platform,"win32");
  const bin=fileURLToPath(new URL("../../.tools/t253-postgres-17.12/pgsql/bin",import.meta.url));
  const same=(a,b) => a.replaceAll("/","\\").toLowerCase()===b.replaceAll("/","\\").toLowerCase();
  assert(same(await realpath(bin),bin));
  const powershell=join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe");
  async function ps(script,env={}) {
    await exec(powershell,["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop'; "+script],
      {env:{...childEnv,...env},windowsHide:true,timeout:25000});
  }
  for (const name of ["postgres.exe","initdb.exe","pg_ctl.exe"]) {
    const path=join(bin,name);
    assert(same(await realpath(path),path));
    await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T319_TOOL
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
    {T319_TOOL:path});
    const {stdout}=await exec(path,["--version"],{env:childEnv,windowsHide:true,timeout:10000});
    assert.match(stdout.trim(),/\(PostgreSQL\) 17\.12$/);
  }
  const temp=await realpath(tmpdir());
  const port=await freePort();
  const root=await mkdtemp(join(temp,"dream-t319-"));
  const data=join(root,"cluster");
  const pidfile=join(data,"postmaster.pid");
  const password=randomBytes(24).toString("hex");
  async function initialize() {
    const passfile=join(root,"bootstrap-password");
    await writeFile(passfile,password,{flag:"wx"});
    try {
      await exec(join(bin,"initdb.exe"),["-D",data,"-U",bootstrap,"--pwfile="+passfile,
        "--auth=scram-sha-256","--encoding=UTF8","--locale=C"],{env:childEnv,windowsHide:true,timeout:120000});
    } finally { await unlink(passfile); }
  }
  async function verify() {
    const lines=(await readFile(pidfile,"utf8")).split(/\r?\n/);
    assert(same(lines[1],data) && Number(lines[3])===port);
    const pid=Number(lines[0]);
    assert(Number.isSafeInteger(pid) && pid>0);
    await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T319_PID)
      $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T319_PORT) -ErrorAction SilentlyContinue)
      if (!$p -or $p.ExecutablePath -ine $env:T319_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T319_DATA) -or
          $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T319_PID -or $s[0].LocalAddress -ne '127.0.0.1') {
        throw 'Listener ownership failed'
      }`,{T319_PID:String(pid),T319_PG:join(bin,"postgres.exe"),T319_DATA:data,T319_PORT:String(port)});
  }
  async function start() {
    const log=await open(join(root,"launcher.log"),"a");
    try {
      const command=spawn(join(bin,"pg_ctl.exe"),["-D",data,"-l",join(root,"postgres.log"),
        "-o","-h 127.0.0.1 -p "+port,"-w","-t","30","start"],
      {env:childEnv,windowsHide:true,stdio:["ignore",log.fd,log.fd],timeout:40000});
      await new Promise((resolve,reject) => {
        command.once("error",reject);
        command.once("exit",code => code===0 ? resolve() : reject(new Error("Owned postmaster startup failed")));
      });
    } finally { await log.close(); }
    await verify();
  }
  async function noListener() {
    await assert.rejects(access(pidfile),{code:"ENOENT"});
    await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T319_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
      throw 'Unexpected listener'
    }`,{T319_PORT:String(port)});
  }
  async function stop() {
    const present=await access(pidfile).then(() => true,error => {
      if (error.code==="ENOENT") return false;
      throw error;
    });
    if (present) {
      await verify();
      await exec(join(bin,"pg_ctl.exe"),["-D",data,"-m","fast","-w","-t","25","stop"],
        {env:childEnv,windowsHide:true,timeout:30000});
    }
    await noListener();
  }
  async function remove() {
    await stop();
    const resolved=await realpath(root);
    assert(same(dirname(resolved),temp) && basename(resolved).startsWith("dream-t319-"));
    await rm(resolved,{recursive:true,force:false});
    await assert.rejects(access(root),{code:"ENOENT"});
  }
  return {port,password,initialize,start,stop,remove};
}

async function waitUntil(check,label) {
  for (let i=0;i<150;i++) {
    const result=await check();
    if (result) return result;
    await delay(15);
  }
  assert.fail(`Expected ${label}`);
}

async function provision(admin, credentials, oldSender, nextSender) {
  await admin.query("SET rea_t319.synthetic='on'");
  await admin.query(await readFile(new URL("t319-egress-durable-control.sql",import.meta.url),"utf8"));
  await admin.query(`CREATE ROLE ${controllerLogin} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${credentials.controller}';
    CREATE ROLE ${supervisorLogin} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${credentials.supervisor}';
    GRANT USAGE ON SCHEMA rea_t319 TO ${controllerLogin},${supervisorLogin};
    GRANT EXECUTE ON FUNCTION rea_t319.change(text,bigint,uuid,uuid,uuid,uuid),rea_t319.status(uuid) TO ${controllerLogin};
    GRANT EXECUTE ON FUNCTION rea_t319.terminate(text,bigint,uuid,integer,uuid) TO ${supervisorLogin}`);
  await admin.query("INSERT INTO rea_t319.sender(boot_id,process_id) VALUES($1,$2),($3,$4)",
    [oldSender.config.boot,oldSender.child.pid,nextSender.config.boot,nextSender.child.pid]);
  await admin.query("INSERT INTO rea_t319.gate(singleton,generation,owner_id) VALUES(true,1,$1)",[oldSender.config.boot]);
}

async function closeReport(sender,permit) {
  const notice=Promise.withResolvers();
  sender.notice=notice;
  sender.child.send({kind:"close-report",permit});
  const report=await within(notice.promise,"synthetic sender close report");
  assert.deepEqual(report,{kind:"close-report",pid:sender.child.pid,boot:sender.config.boot,permit});
  return report;
}

async function run() {
  for (const key of Object.keys(process.env)) if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$)/i.test(key)) delete process.env[key];
  const cluster=await makeCluster();
  const children=[];
  const clients=new Set();
  const credentials={controller:randomBytes(24).toString("hex"),supervisor:randomBytes(24).toString("hex")};
  const ownerA=randomUUID();
  const ownerB=randomUUID();
  const actor=randomUUID();
  const subjectMismatch=randomUUID();
  const prepared=randomUUID();
  const starting=randomUUID();
  const sending=randomUUID();
  const finished=randomUUID();
  const rejected=randomUUID();
  const fresh=randomUUID();
  const old=(code,id,subject=actor) => command(code,1,ownerA,id,subject);
  const transfer=code => command(code,1,ownerA,null,null,ownerB);
  const ask=(controller,args) => within(controller.rpc(args).done,"owned controller RPC");
  const status=(controller,id) => within(controller.rpc([id],{status:true}).done,"durable status");
  function child(role,config) {
    const instance=launch(role,config);
    children.push(instance);
    return instance;
  }
  async function controller() {
    const instance=child("controller",{port:cluster.port,password:credentials.controller});
    assert.equal((await within(instance.ready,"controller readiness")).pid,instance.child.pid);
    return instance;
  }
  async function connect(user=bootstrap,password=cluster.password,db=database) {
    const client=connection(cluster.port,user,password,db);
    clients.add(client);
    await client.connect();
    return client;
  }
  async function closeDatabaseClients() {
    await Promise.all([...clients].map(client => client.end()));
    clients.clear();
  }
  async function identity(admin) {
    return value(admin,`SELECT jsonb_build_object('id',x.system_identifier::text,
      'started',pg_postmaster_start_time()::text) AS value FROM pg_control_system() x`);
  }
  const stopChild=async instance => {
    assert(instance.child.kill());
    const exit=await within(instance.exited,"owned process exit");
    assert.equal(exit.pid,instance.child.pid);
    assert(exit.signal || exit.code!==0);
    return exit;
  };
  try {
    await cluster.initialize();
    await cluster.start();
    const rootDatabase=await connect(bootstrap,cluster.password,"postgres");
    await rootDatabase.query("CREATE DATABASE dream_test_t319 TEMPLATE template0");
    let admin=await connect();
    const senderA=child("sender",{boot:ownerA});
    const senderB=child("sender",{boot:ownerB});
    for (const sender of [senderA,senderB]) assert.deepEqual(await within(sender.ready,"owned synthetic sender"),
      {kind:"ready",pid:sender.child.pid,boot:sender.config.boot});
    await provision(admin,credentials,senderA,senderB);
    let supervisor=await connect(supervisorLogin,credentials.supervisor);
    const direct=await connect(controllerLogin,credentials.controller);
    await assert.rejects(direct.query("SELECT * FROM rea_t319.permit"),{code:"42501"});
    await assert.rejects(direct.query(terminateSql,["isolated",1,ownerA,senderA.child.pid,null]),{code:"42501"});
    await assert.rejects(supervisor.query(changeSql,old("issue",rejected)),{code:"42501"});
    const c1=await controller();
    const c2=await controller();
    assert.notEqual(c1.child.pid,c2.child.pid);
    await assert.rejects(direct.query("SET ROLE t319_guard"),{code:"42501"});
    await direct.end();
    clients.delete(direct);
    assert.equal(await ask(c1,old("issue",starting)),"issued");
    assert.equal(await ask(c2,old("consume",starting,subjectMismatch)),"unavailable");

    const winner=c1.rpc(old("consume",starting),{hold:true});
    await within(winner.held,"first consumer holding the actual transaction");
    const firstPid=await within(winner.pid,"first consumer backend");
    assert.equal((await status(c2,starting)).state,"prepared");
    const loser=c2.rpc(old("consume",starting));
    const secondPid=await within(loser.pid,"second consumer backend");
    await waitUntil(() => value(admin,`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE pid=$1 AND application_name='t319-owned' AND wait_event_type='Lock'
        AND $2::integer=ANY(pg_blocking_pids(pid))) AS value`,[secondPid,firstPid]),"same permit native lock");
    winner.commit();
    assert.equal(await within(winner.done,"first committed consume"),"starting");
    assert.equal(await within(loser.done,"competing consume settled"),"already_consumed");
    const startRecord=await status(c2,starting);
    assert.deepEqual(startRecord.events,["prepared","starting"]);
    console.log("Two controller PIDs raced one permit under a native PG lock; one durable consume event");

    assert.equal(await ask(c1,old("issue",finished)),"issued");
    assert.equal(await ask(c1,old("consume",finished)),"starting");
    assert.equal(await ask(c1,old("first_report",finished)),"sending");
    const notice=await closeReport(senderA,finished);
    assert.equal(await value(supervisor,terminateSql,["finished",1,notice.boot,notice.pid,notice.permit]),"finished");
    const finishedRecord=await status(c2,finished);
    assert.deepEqual(finishedRecord.events,["prepared","starting","sending","finished"]);
    assert.equal(await ask(c1,old("issue",sending)),"issued");
    assert.equal(await ask(c1,old("consume",sending)),"starting");
    const noReply=c1.rpc(old("first_report",sending),{dropReply:true});
    const sendingRecord=await waitUntil(async () => {
      const current=await value(admin,statusSql,[sending]);
      return current.state==="sending" && current;
    },"committed sending before a reply");
    await stopChild(c1);
    assert.equal(await within(noReply.done,"lost controller reply"),"reply_lost");
    const restarted=await controller();
    assert.notEqual(restarted.child.pid,c1.child.pid);
    assert.deepEqual(await status(restarted,starting),startRecord);
    assert.deepEqual(await status(restarted,sending),sendingRecord);
    assert.deepEqual(await status(restarted,finished),finishedRecord);
    assert.equal(await ask(restarted,old("consume",sending)),"already_consumed");
    assert.equal(await ask(restarted,old("issue",prepared)),"issued");
    assert.equal(await ask(restarted,transfer("drain")),"draining");
    assert.equal((await status(restarted,prepared)).state,"cancelled");
    assert.equal(await ask(restarted,old("issue",rejected)),"draining");
    assert.equal(await ask(restarted,transfer("activate")),"waiting_for_isolation");
    assert.equal(await value(supervisor,terminateSql,["isolated",1,ownerA,senderB.child.pid,null]),"unknown_sender");
    assert.equal(await value(supervisor,terminateSql,["finished",1,ownerA,senderA.child.pid,starting]),"invalid_state");
    await admin.query("UPDATE rea_t319.permit SET not_after=clock_timestamp()-interval '1 second' WHERE id IN ($1,$2)",[starting,sending]);
    assert.equal(await ask(restarted,transfer("activate")),"waiting_for_isolation");
    console.log("Controller killed with an unreturned result; replacement preserved starting, sending and finished states");

    const beforeRestart=await identity(admin);
    const beforeRecords=await Promise.all([prepared,starting,sending,finished].map(id => status(restarted,id)));
    await closeDatabaseClients();
    await cluster.stop();
    assert.equal(await ask(restarted,old("issue",rejected)),"ledger_unavailable");
    assert.equal(await ask(c2,transfer("activate")),"ledger_unavailable");
    assert.equal(await status(restarted,finished),"ledger_unavailable");
    await cluster.start();
    admin=await connect();
    supervisor=await connect(supervisorLogin,credentials.supervisor);
    const afterRestart=await identity(admin);
    assert.equal(afterRestart.id,beforeRestart.id);
    assert.notEqual(afterRestart.started,beforeRestart.started);
    assert.deepEqual(await Promise.all([prepared,starting,sending,finished].map(id => status(restarted,id))),beforeRecords);
    assert.equal((await status(restarted,rejected)).state,null);
    assert.equal(await ask(restarted,transfer("activate")),"waiting_for_isolation");
    console.log("Owned postmaster clean stop/restart: mutations refused while offline, then the same data and blocked transition returned");

    const oldExit=await stopChild(senderA);
    assert.equal(await ask(restarted,transfer("activate")),"waiting_for_isolation");
    assert.equal(await value(supervisor,terminateSql,["isolated",1,ownerA,oldExit.pid,null]),"isolated");
    assert.deepEqual((await status(restarted,starting)).events,["prepared","starting","isolated"]);
    assert.deepEqual((await status(restarted,sending)).events,["prepared","starting","sending","isolated"]);
    assert.equal(await ask(restarted,transfer("activate")),"activated");
    assert.equal(await ask(c2,old("first_report",starting)),"stale_owner");
    assert.equal(await ask(c2,old("issue",rejected)),"stale_owner");
    assert.equal(await value(supervisor,terminateSql,["finished",1,ownerA,oldExit.pid,sending]),"stale_owner");
    assert.equal(await ask(restarted,command("consume",2,ownerB,starting,actor)),"unavailable");
    assert.equal((await status(restarted,finished)).state,"finished");
    assert.equal(await ask(restarted,command("issue",2,ownerB,fresh,actor)),"issued");
    assert.equal(await ask(c2,command("consume",2,ownerB,fresh,actor)),"starting");
    assert.equal(await ask(restarted,command("first_report",2,ownerB,fresh,actor)),"sending");
    const freshNotice=await closeReport(senderB,fresh);
    assert.equal(await value(supervisor,terminateSql,["finished",2,freshNotice.boot,freshNotice.pid,freshNotice.permit]),"finished");
    assert.deepEqual(await status(restarted,fresh),{generation:2,owner:ownerB,candidate:null,
      state:"finished",events:["prepared","starting","sending","finished"]});
    await waitUntil(async () => (await value(admin,`SELECT count(*)::int AS value FROM pg_stat_activity
      WHERE usename='t319_controller' AND application_name='t319-owned'`))===0,"no controller DB sessions");
    console.log("Only recorded owned-sender exit enabled recovery; old generation commands failed and new owner completed normally");
  } finally {
    for (const instance of children) if (!instance.dead && instance.child.connected) instance.child.disconnect();
    const exitAll=Promise.all(children.map(instance => instance.exited));
    await within(exitAll,"controller and synthetic sender exits").catch(async error => {
      for (const instance of children) if (!instance.dead) instance.child.kill();
      await within(exitAll,"forced owned child exits");
      throw error;
    }).finally(async () => {
      try { await closeDatabaseClients(); }
      finally { await cluster.remove(); }
    });
  }
  assert(children.every(instance => instance.dead));
  console.log("Owned controllers, senders, PostgreSQL process, PID/listener and temporary cluster removed");
}

if (process.argv[2]==="controller") controllerChild();
else if (process.argv[2]==="sender") senderChild();
else await run();
