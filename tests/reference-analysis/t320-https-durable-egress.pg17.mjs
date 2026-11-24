/* global console, process */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer as httpsServer, request } from "node:https";
import { execFile, fork, spawn } from "node:child_process";
import { randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { access, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const exec=promisify(execFile);
const { Client }=pg;
const host="127.0.0.1";
const database="dream_test_t319";
const bootstrap="t319_bootstrap";
const statusSql="SELECT rea_t319.status($1) AS value";
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
  return new Client({host,port,database:db,user,password,ssl:false,application_name:"t320-owned",
    options:"-c search_path=pg_catalog",connectionTimeoutMillis:1000,statement_timeout:8000});
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
    await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T320_TOOL
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
    {T320_TOOL:path});
    const {stdout}=await exec(path,["--version"],{env:childEnv,windowsHide:true,timeout:10000});
    assert.match(stdout.trim(),/\(PostgreSQL\) 17\.12$/);
  }
  const temp=await realpath(tmpdir());
  const port=await freePort();
  const root=await mkdtemp(join(temp,"dream-t320-"));
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
    await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T320_PID)
      $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T320_PORT) -ErrorAction SilentlyContinue)
      if (!$p -or $p.ExecutablePath -ine $env:T320_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T320_DATA) -or
          $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T320_PID -or $s[0].LocalAddress -ne '127.0.0.1') {
        throw 'Listener ownership failed'
      }`,{T320_PID:String(pid),T320_PG:join(bin,"postgres.exe"),T320_DATA:data,T320_PORT:String(port)});
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
    await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T320_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
      throw 'Unexpected listener'
    }`,{T320_PORT:String(port)});
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
    assert(same(dirname(resolved),temp) && basename(resolved).startsWith("dream-t320-"));
    await rm(resolved,{recursive:true,force:false});
    await assert.rejects(access(root),{code:"ENOENT"});
  }
  return {port,password,root,initialize,start,stop,remove};
}

const controllerLogin="t320_controller";
const supervisorLogin="t320_supervisor";
const controlSql="SELECT rea_t320.control_action($1,$2,$3,$4,$5) AS value";
const stepSql="SELECT rea_t320.send_step($1,$2,$3,$4) AS value";
const terminateSql="SELECT rea_t319.terminate($1,$2,$3,$4,$5) AS value";
const body=Buffer.from('{"analysis":"synthetic HTTPS response backed by PostgreSQL"}');
const prefix=body.subarray(0,Math.ceil(body.length/2));
const controlArgs=(action,epoch=null,actor=null,ticket=null,next=null) => [action,epoch,actor,ticket,next];

async function fromLedger(config,sql,args) {
  const db=connection(config.port,config.login,config.password);
  try { await db.connect(); return await value(db,sql,args); }
  catch (error) {
    if (["ECONNREFUSED","ECONNRESET","57P01","57P03"].includes(error.code)) return "ledger_unavailable";
    throw error;
  } finally { await db.end().catch(() => {}); }
}

function report(message) {
  if (process.connected) process.send(message);
}

function controllerChild() {
  assert.equal(typeof process.send,"function");
  let config;
  let epoch;
  process.on("message",async message => {
    if (message.kind==="configure") {
      config=message;
      epoch=await fromLedger(config,controlSql,controlArgs("boot"));
      report({kind:"ready",epoch,pid:process.pid});
    } else if (message.kind==="rpc") {
      const response=await fromLedger(config,controlSql,controlArgs(message.action,epoch,message.actor,message.ticket,message.next));
      report({kind:"rpc-result",tag:message.tag,response});
    }
  });
}

function empty(res,status) {
  res.writeHead(status,{"Connection":"close","Content-Length":0,"Cache-Control":"private, no-store"});
  res.end();
}

const denied=result => result==="ledger_unavailable" ? 503 : result==="stale_authority" ? 403 : 409;

function senderChild() {
  assert.equal(typeof process.send,"function");
  const sockets=new Set();
  const jobs=new Map();
  let config;
  let server;

  async function send(req,res) {
    if (req.socket.localAddress!==host || req.socket.remoteAddress!==host || !req.socket.encrypted ||
        req.method!=="POST" || req.url!=="/protected") { empty(res,404); return; }
    const ticket=req.headers["x-t320-ticket"];
    const subject=req.headers["x-t320-subject"];
    const uuid=/^[0-9a-f-]{36}$/;
    if (typeof ticket!=="string" || typeof subject!=="string" || !uuid.test(ticket) || !uuid.test(subject)) {
      empty(res,403);
      return;
    }
    req.resume();
    const channel=randomUUID();
    const step=action => fromLedger(config,stepSql,[action,ticket,subject,channel]);
    const release=Promise.withResolvers();
    const socket=res.socket;
    const socketClosed=Promise.withResolvers();
    socket.once("close",socketClosed.resolve);
    const admission=await step("consume");
    if (admission!=="starting") { if (!res.destroyed) empty(res,denied(admission)); return; }

    let firstReport;
    let ended=false;
    const job={release,finish:() => {
      if (firstReport && !res.destroyed && !res.writableEnded) res.end(body.subarray(prefix.length));
    },dropClose:false};
    jobs.set(ticket,job);
    res.once("finish",() => { ended=true; });
    const closeTask=socketClosed.promise.then(async () => {
      jobs.delete(ticket);
      release.resolve(false);
      report({kind:"socket-closed",tag:ticket});
      if (job.dropClose) { report({kind:"close-dropped",tag:ticket}); return; }
      if (firstReport) await firstReport;
      const terminal=await step(firstReport && ended ? "closed_complete" : "closed_aborted");
      report({kind:"terminal",tag:ticket,terminal});
    });
    void closeTask.catch(error => report({kind:"fault",tag:ticket,code:error.code ?? "unknown"}));
    report({kind:"held",tag:ticket});
    if (!await release.promise || res.destroyed) return;
    const verdict=await step("before_write");
    if (verdict!=="ready" || res.destroyed) { if (!res.destroyed) empty(res,denied(verdict)); return; }

    // The last committed check and this physical enqueue remain distinct.
    res.writeHead(200,{"Connection":"close","Content-Length":body.length,
      "Cache-Control":"private, no-store","Content-Type":"application/json"});
    res.write(prefix);
    firstReport=step("first_report");
    const recorded=await firstReport;
    report({kind:"first",tag:ticket,recorded,bytes:prefix.length});
  }

  process.on("message",message => {
    if (message.kind==="configure") {
      config=message;
      server=httpsServer({key:config.key,cert:config.cert,minVersion:"TLSv1.2"},(req,res) => {
        void send(req,res).catch(error => {
          report({kind:"fault",tag:req.headers["x-t320-ticket"],code:error.code ?? "unknown"});
          if (!res.headersSent && !res.destroyed) empty(res,503);
          else res.destroy();
        });
      });
      server.on("connection",socket => {
        sockets.add(socket);
        socket.once("close",() => sockets.delete(socket));
      });
      server.listen({host,port:0},() => report({kind:"ready",address:server.address(),pid:process.pid}));
      return;
    }
    if (message.kind==="inspect") { report({kind:"inspection",sockets:sockets.size,jobs:jobs.size}); return; }
    const job=jobs.get(message.ticket);
    if (!job) return;
    if (message.kind==="release") job.release.resolve(true);
    if (message.kind==="finish") job.finish();
    if (message.kind==="drop-close") {
      job.dropClose=true;
      report({kind:"will-drop-close",tag:message.ticket});
    }
  });
  process.once("disconnect",() => {
    for (const socket of sockets) socket.destroy();
    server?.close();
  });
}

function launch(role,config) {
  const child=fork(fileURLToPath(import.meta.url),[role],{windowsHide:true,execArgv:[],env:childEnv});
  const inbox=new Map();
  const exited=Promise.withResolvers();
  function slot(kind,tag="") {
    const id=`${kind}:${tag}`;
    if (!inbox.has(id)) inbox.set(id,Promise.withResolvers());
    return inbox.get(id);
  }
  const actor={child,exited:exited.promise,get:(kind,tag) => within(slot(kind,tag).promise,`${role} ${kind}`)};
  child.on("message",message => {
    if (message.kind==="fault") slot("terminal",message.tag).resolve({terminal:"fault",code:message.code});
    else slot(message.kind,message.tag).resolve(message);
  });
  child.once("error",slot("ready").reject);
  child.once("exit",(code,signal) => { actor.dead=true; exited.resolve({pid:child.pid,code,signal}); });
  child.send({kind:"configure",...config});
  actor.rpc=async (action,options={}) => {
    const tag=randomUUID();
    child.send({kind:"rpc",tag,action,...options});
    return (await actor.get("rpc-result",tag)).response;
  };
  return actor;
}

function openClient(sender,tls,ticket,subject,requests) {
  const result=Promise.withResolvers();
  const first=Promise.withResolvers();
  const closed=Promise.withResolvers();
  const chunks=[];
  let response;
  let verified=false;
  const collect=aborted => result.resolve({status:response?.statusCode,body:Buffer.concat(chunks),verified,aborted});
  const req=request({host,port:sender.port,path:"/protected",method:"POST",ca:tls.cert,rejectUnauthorized:true,
    agent:false,headers:{"x-t320-ticket":ticket,"x-t320-subject":subject}},res => {
    response=res;
    res.on("data",part => { chunks.push(part); first.resolve(); });
    res.once("end",() => collect(false));
    res.once("aborted",() => collect(true));
    res.once("error",() => collect(true));
  });
  requests.add(req);
  req.once("socket",socket => socket.once("secureConnect",() => {
    verified=socket.authorized && socket.getPeerCertificate().fingerprint256===tls.fingerprint;
  }));
  req.once("error",() => collect(true));
  req.once("close",() => { requests.delete(req); closed.resolve(); });
  req.end();
  return {result:result.promise,first:first.promise,closed:closed.promise,abort:() => req.destroy()};
}

async function fixture(admin, identities) {
  const sql=(await readFile(new URL("t319-egress-durable-control.sql",import.meta.url),"utf8")).replaceAll("\r\n","\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"),"03e2fbc4f0fd83b5cb17435af7152f0d59f81fbd69421248c8282be982999cda");
  await admin.query("SET rea_t319.synthetic='on'; SET rea_t320.synthetic='on'");
  await admin.query(sql);
  await admin.query(await readFile(new URL("t320-https-durable-egress.sql",import.meta.url),"utf8"));
  for (const identity of identities) {
    assert(/^t320_(controller|supervisor|sender_a|sender_b)$/.test(identity.login));
    assert(/^[0-9a-f]{48}$/.test(identity.password));
    await admin.query(`CREATE ROLE ${identity.login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${identity.password}'`);
  }
  await admin.query(`GRANT USAGE ON SCHEMA rea_t320 TO t320_controller,t320_sender_a,t320_sender_b;
    GRANT USAGE ON SCHEMA rea_t319 TO t320_supervisor;
    GRANT EXECUTE ON FUNCTION rea_t320.control_action(text,bigint,uuid,uuid,uuid) TO t320_controller;
    GRANT EXECUTE ON FUNCTION rea_t320.send_step(text,uuid,uuid,uuid) TO t320_sender_a,t320_sender_b;
    GRANT EXECUTE ON FUNCTION rea_t319.terminate(text,bigint,uuid,integer,uuid) TO t320_supervisor`);
}

async function run() {
  for (const key of Object.keys(process.env)) if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$)/i.test(key)) delete process.env[key];
  const cluster=await makeCluster();
  const children=[];
  const tlsPorts=[];
  const requests=new Set();
  const clients=new Set();
  const credential=login => ({login,password:randomBytes(24).toString("hex"),port:cluster.port});
  const ctl=credential(controllerLogin);
  const sup=credential(supervisorLogin);
  const credA=credential("t320_sender_a");
  const credB=credential("t320_sender_b");
  const ownerA=randomUUID();
  const ownerB=randomUUID();
  const actorA=randomUUID();
  const actorB=randomUUID();

  async function db(credential,dbName=database) {
    const client=connection(cluster.port,credential.login,credential.password,dbName);
    clients.add(client);
    await client.connect();
    return client;
  }
  async function closeDb() {
    await Promise.all([...clients].map(client => client.end()));
    clients.clear();
  }
  function child(role,config) {
    const instance=launch(role,config);
    children.push(instance);
    return instance;
  }
  async function kill(instance) {
    assert(instance.child.kill());
    const exit=await within(instance.exited,"owned child exit");
    assert.equal(exit.pid,instance.child.pid);
    assert(exit.signal || exit.code!==0);
    return exit;
  }
  try {
    await cluster.initialize();
    await cluster.start();
    const rootCredentials={login:bootstrap,password:cluster.password};
    const postgres=await db(rootCredentials,"postgres");
    await postgres.query("CREATE DATABASE dream_test_t319 TEMPLATE template0");
    let admin=await db(rootCredentials);
    await fixture(admin,[ctl,sup,credA,credB]);

    const openssl=join(process.env.ProgramFiles,"Git","usr","bin","openssl.exe");
    const keyfile=join(cluster.root,"tls-key.pem");
    const certfile=join(cluster.root,"tls-cert.pem");
    await exec(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=T320 fixture",
      "-addext","subjectAltName=IP:127.0.0.1","-keyout",keyfile,"-out",certfile],{windowsHide:true,timeout:10000});
    const cert=await readFile(certfile,"utf8");
    const tls={cert,key:await readFile(keyfile,"utf8"),fingerprint:new X509Certificate(cert).fingerprint256};
    const a=child("sender",{...credA,...tls});
    const b=child("sender",{...credB,...tls});
    for (const sender of [a,b]) {
      const ready=await sender.get("ready");
      assert.equal(ready.address.address,host);
      assert.equal(ready.pid,sender.child.pid);
      sender.port=ready.address.port;
      tlsPorts.push(sender.port);
    }
    assert.notEqual(a.port,b.port);
    assert.notEqual(a.child.pid,b.child.pid);
    await admin.query("INSERT INTO rea_t319.sender(boot_id,process_id) VALUES($1,$2),($3,$4)",[ownerA,a.child.pid,ownerB,b.child.pid]);
    await admin.query("INSERT INTO rea_t320.sender_login VALUES($1,$2),($3,$4)",[ownerA,credA.login,ownerB,credB.login]);
    await admin.query("INSERT INTO rea_t319.gate VALUES(true,1,$1,NULL)",[ownerA]);
    await admin.query("INSERT INTO rea_t320.actor(id) VALUES($1),($2)",[actorA,actorB]);
    let supervisor=await db(sup);
    const senderProbe=await db(credA);
    await assert.rejects(senderProbe.query(controlSql,controlArgs("boot")),{code:"42501"});
    await assert.rejects(senderProbe.query("SELECT * FROM rea_t319.permit"),{code:"42501"});
    await assert.rejects(supervisor.query(stepSql,["consume",null,null,null]),{code:"42501"});
    await senderProbe.end();
    clients.delete(senderProbe);
    let controller=child("controller",ctl);
    const firstBoot=await controller.get("ready");
    assert.equal(firstBoot.epoch,"1");

    const status=ticket => value(admin,statusSql,[ticket]);
    const open=(sender,ticket,subject) => openClient(sender,tls,ticket,subject,requests);
    const received=async exchange => {
      const actual=await within(exchange.result,"verified HTTPS client response");
      assert(actual.verified,"Expected the generated trusted loopback TLS peer");
      return actual;
    };
    const noBody=async (exchange,expected) => {
      const actual=await received(exchange);
      assert.equal(actual.status,expected);
      assert.equal(actual.body.length,0);
    };
    async function issue(actor) {
      const ticket=randomUUID();
      assert.equal(await controller.rpc("issue",{actor,ticket}),"issued");
      return ticket;
    }
    function signal(sender,kind,ticket) { sender.child.send({kind,ticket}); }
    async function started(sender,ticket,exchange) {
      signal(sender,"release",ticket);
      const [report]=await Promise.all([sender.get("first",ticket),within(exchange.first,"actual first protected bytes")]);
      assert.equal(report.recorded,"sending");
      assert.equal(report.bytes,prefix.length);
      assert.equal((await status(ticket)).state,"sending");
    }
    async function completed(sender,ticket,exchange) {
      signal(sender,"finish",ticket);
      const reply=await received(exchange);
      assert.equal(reply.status,200);
      assert.deepEqual(reply.body,body);
      assert.equal((await sender.get("terminal",ticket)).terminal,"finished");
    }

    const same=await issue(actorA);
    const one=open(a,same,actorA);
    const two=open(a,same,actorA);
    await a.get("held",same);
    await noBody(open(b,same,actorA),409);
    const {index,side}=await within(Promise.race([one.result.then(side => ({index:0,side})),
      two.result.then(side => ({index:1,side}))]),"duplicate HTTPS rejection");
    assert(side.verified);
    assert.equal(side.status,409);
    assert.equal(side.body.length,0);
    assert.deepEqual((await status(same)).events,["prepared","starting"]);
    const winner=[two,one][index];
    await started(a,same,winner);
    await completed(a,same,winner);
    assert.deepEqual((await status(same)).events,["prepared","starting","sending","finished"]);
    console.log("Concurrent real TLS requests and the non-owner listener: one durable consume and one full body");

    const beforeRestart=await issue(actorA);
    const staleController=open(a,beforeRestart,actorA);
    await a.get("held",beforeRestart);
    await kill(controller);
    controller=child("controller",ctl);
    const secondBoot=await controller.get("ready");
    assert.equal(secondBoot.epoch,"2");
    assert.notEqual(secondBoot.pid,firstBoot.pid);
    assert.equal((await status(beforeRestart)).state,"starting");
    signal(a,"release",beforeRestart);
    await noBody(staleController,403);
    assert.equal((await a.get("terminal",beforeRestart)).terminal,"cancelled");
    assert.deepEqual((await status(beforeRestart)).events,["prepared","starting","cancelled"]);

    const beforeRevocation=await issue(actorA);
    const revoked=open(a,beforeRevocation,actorA);
    await a.get("held",beforeRevocation);
    assert.equal(await controller.rpc("revoke",{actor:actorA}),"revoked");
    signal(a,"release",beforeRevocation);
    await noBody(revoked,403);
    assert.equal((await a.get("terminal",beforeRevocation)).terminal,"cancelled");
    assert.deepEqual((await status(beforeRevocation)).events,["prepared","starting","cancelled"]);
    assert.equal(await controller.rpc("issue",{actor:actorA,ticket:randomUUID()}),"unavailable");
    console.log("Committed controller restart and authority revocation before release each produced zero protected TLS bytes");

    const beforeOffline=await issue(actorB);
    const offline=open(a,beforeOffline,actorB);
    await a.get("held",beforeOffline);
    const beforeDbStop=await status(beforeOffline);
    const rejected=randomUUID();
    await closeDb();
    await cluster.stop();
    assert.equal(await controller.rpc("issue",{actor:actorB,ticket:rejected}),"ledger_unavailable");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"ledger_unavailable");
    signal(a,"release",beforeOffline);
    await noBody(offline,503);
    assert.equal((await a.get("terminal",beforeOffline)).terminal,"ledger_unavailable");
    await cluster.start();
    admin=await db(rootCredentials);
    supervisor=await db(sup);
    assert.deepEqual(await status(beforeOffline),beforeDbStop);
    assert.equal((await status(rejected)).state,null);
    console.log("Owned DB outage: zero protected bytes and no new grant or activation; unresolved consume survived restart");

    const live=await issue(actorB);
    const liveClient=open(a,live,actorB);
    await a.get("held",live);
    await started(a,live,liveClient);
    const unknown=await issue(actorB);
    const unknownClient=open(a,unknown,actorB);
    await a.get("held",unknown);
    await started(a,unknown,unknownClient);
    signal(a,"drop-close",unknown);
    await a.get("will-drop-close",unknown);
    assert.equal(await controller.rpc("drain",{next:ownerB}),"draining");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"waiting_for_isolation");
    assert.equal(await controller.rpc("issue",{actor:actorB,ticket:randomUUID()}),"draining");
    assert.equal((await status(live)).state,"sending");
    assert.equal((await status(live)).generation,1);
    await completed(a,live,liveClient);
    assert.equal((await status(live)).state,"finished");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"waiting_for_isolation");
    unknownClient.abort();
    const partial=await received(unknownClient);
    assert(partial.aborted);
    assert.deepEqual(partial.body,prefix);
    await within(unknownClient.closed,"client side of unknown TLS closed");
    await a.get("socket-closed",unknown);
    await a.get("close-dropped",unknown);
    assert.equal((await status(unknown)).state,"sending");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"waiting_for_isolation");
    assert.equal(await value(supervisor,terminateSql,["isolated",1,ownerA,b.child.pid,null]),"unknown_sender");
    const oldExit=await kill(a);
    assert.equal(await controller.rpc("activate",{next:ownerB}),"waiting_for_isolation");
    assert.equal(await value(supervisor,terminateSql,["isolated",1,ownerA,oldExit.pid,null]),"isolated");
    assert.equal((await status(unknown)).state,"isolated");
    assert.equal((await status(beforeOffline)).state,"isolated");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"activated");
    assert.equal((await status(live)).generation,2);
    await noBody(open(b,unknown,actorB),409);
    const fresh=await issue(actorB);
    const freshClient=open(b,fresh,actorB);
    await b.get("held",fresh);
    await started(b,fresh,freshClient);
    await completed(b,fresh,freshClient);
    assert.deepEqual(await status(fresh),{generation:2,owner:ownerB,candidate:null,state:"finished",
      events:["prepared","starting","sending","finished"]});
    signal(b,"inspect");
    const inspected=await b.get("inspection");
    assert.deepEqual(inspected,{kind:"inspection",sockets:0,jobs:0});
    assert.equal(await value(admin,`SELECT count(*)::int AS value FROM pg_stat_activity
      WHERE usename IN ('t320_controller','t320_sender_a','t320_sender_b') AND application_name='t320-owned'`),0);
    console.log("Live socket and lost close report blocked activation; owned exit proof permitted a fresh HTTPS response on generation 2");
  } finally {
    for (const req of requests) req.destroy();
    for (const instance of children) if (!instance.dead && instance.child.connected) instance.child.disconnect();
    const ended=Promise.all(children.map(instance => instance.exited));
    await within(ended,"owned HTTPS and controller exits").catch(async error => {
      for (const instance of children) if (!instance.dead) instance.child.kill();
      await within(ended,"forced owned child exits");
      throw error;
    }).finally(async () => {
      try { await closeDb(); }
      finally { await cluster.remove(); }
    });
  }
  assert(children.every(instance => instance.dead));
  assert.equal(requests.size,0);
  for (const port of tlsPorts) {
    await assert.rejects(within(new Promise((resolve,reject) => {
      const socket=createConnection({host,port});
      socket.once("connect",() => { socket.destroy(); resolve(); });
      socket.once("error",reject);
    }),"previous TLS port refused"),{code:"ECONNREFUSED"});
  }
  console.log("Owned HTTPS senders, controller, PostgreSQL process/listener, client requests, cluster and TLS files removed");
}

if (process.argv[2]==="controller") controllerChild();
else if (process.argv[2]==="sender") senderChild();
else await run();
