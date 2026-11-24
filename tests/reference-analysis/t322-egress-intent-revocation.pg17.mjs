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
  return new Client({host,port,database:db,user,password,ssl:false,application_name:"t322-owned",
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
    await ps(`$sig=Get-AuthenticodeSignature -LiteralPath $env:T322_TOOL
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=EnterpriseDB Corporation') { throw 'Unexpected tool signature' }`,
    {T322_TOOL:path});
    const {stdout}=await exec(path,["--version"],{env:childEnv,windowsHide:true,timeout:10000});
    assert.match(stdout.trim(),/\(PostgreSQL\) 17\.12$/);
  }
  const temp=await realpath(tmpdir());
  const port=await freePort();
  const root=await mkdtemp(join(temp,"dream-t322-"));
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
    await ps(`$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:T322_PID)
      $s=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T322_PORT) -ErrorAction SilentlyContinue)
      if (!$p -or $p.ExecutablePath -ine $env:T322_PG -or !$p.CommandLine.Replace([char]47,[char]92).Contains($env:T322_DATA) -or
          $s.Count -ne 1 -or $s[0].OwningProcess -ne [int]$env:T322_PID -or $s[0].LocalAddress -ne '127.0.0.1') {
        throw 'Listener ownership failed'
      }`,{T322_PID:String(pid),T322_PG:join(bin,"postgres.exe"),T322_DATA:data,T322_PORT:String(port)});
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
    await ps(`if (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:T322_PORT) -ErrorAction SilentlyContinue).Count -ne 0) {
      throw 'Unexpected listener'
    }`,{T322_PORT:String(port)});
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
    assert(same(dirname(resolved),temp) && basename(resolved).startsWith("dream-t322-"));
    await rm(resolved,{recursive:true,force:false});
    await assert.rejects(access(root),{code:"ENOENT"});
  }
  return {port,password,root,initialize,start,stop,remove};
}

const controllerLogin="t322_controller";
const supervisorLogin="t322_supervisor";
const controlSql="SELECT rea_t322.control_action($1,$2,$3,$4,$5) AS value";
const stepSql="SELECT rea_t322.send_step($1,$2,$3,$4,$5) AS value";
const isolationSql="SELECT rea_t322.record_isolation($1,$2,$3) AS value";
const body=Buffer.from('{"analysis":"synthetic HTTPS response backed by PostgreSQL"}');
const prefix=body.subarray(0,Math.ceil(body.length/2));
const bodyDigest=createHash("sha256").update(body).digest("hex");
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
  const closureReports=new Map();
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
    const step=action => fromLedger(config,stepSql,[action,ticket,subject,channel,bodyDigest]);
    const attempt=Promise.withResolvers();
    const release=Promise.withResolvers();
    const socket=res.socket;
    const socketClosed=Promise.withResolvers();
    socket.once("close",socketClosed.resolve);
    const admission=await step("consume");
    if (admission!=="starting") { if (!res.destroyed) empty(res,denied(admission)); return; }

    let firstReport;
    let ended=false;
    const job={attempt,release,finish:() => {
      if (firstReport && !res.destroyed && !res.writableEnded) res.end(body.subarray(prefix.length));
    },cancel:() => {
      attempt.resolve(false);
      release.resolve(false);
      if (!res.headersSent && !res.destroyed) empty(res,409);
      else res.destroy();
    },dropFirst:false,holdClose:false};
    jobs.set(ticket,job);
    res.once("finish",() => { ended=true; });
    const closeTask=socketClosed.promise.then(async () => {
      jobs.delete(ticket);
      attempt.resolve(false);
      release.resolve(false);
      const latch=job.holdClose ? Promise.withResolvers() : undefined;
      if (latch) closureReports.set(ticket,latch);
      report({kind:"socket-closed",tag:ticket});
      if (latch && !await latch.promise) return;
      if (firstReport) await firstReport;
      const terminal=await step(firstReport && ended ? "closed_complete" : "closed_aborted");
      report({kind:"terminal",tag:ticket,terminal});
    });
    void closeTask.catch(error => report({kind:"fault",tag:ticket,code:error.code ?? "unknown"}));
    report({kind:"held",tag:ticket});
    if (!await attempt.promise || res.destroyed) return;
    const verdict=await step("intent");
    if (verdict!=="ready" || res.destroyed) { if (!res.destroyed) empty(res,denied(verdict)); return; }
    report({kind:"intent",tag:ticket});
    if (!await release.promise || res.destroyed) return;

    // Deliberate pause after the durable intent, before the physical enqueue.
    // The fixture requires an actual close before this intent can be settled.
    res.writeHead(200,{"Connection":"close","Content-Length":body.length,
      "Cache-Control":"private, no-store","Content-Type":"application/json"});
    res.write(prefix);
    if (job.dropFirst) {
      report({kind:"first",tag:ticket,recorded:"simulated_report_loss",bytes:prefix.length});
      return;
    }
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
    if (message.kind==="record-close") {
      closureReports.get(message.ticket)?.resolve(true);
      closureReports.delete(message.ticket);
      return;
    }
    const job=jobs.get(message.ticket);
    if (!job) return;
    if (message.kind==="attempt") job.attempt.resolve(true);
    if (message.kind==="release") job.release.resolve(true);
    if (message.kind==="finish") job.finish();
    if (message.kind==="cancel") job.cancel();
    if (message.kind==="drop-first") {
      job.dropFirst=true;
      report({kind:"will-drop-first",tag:message.ticket});
    }
    if (message.kind==="hold-close") {
      job.holdClose=true;
      report({kind:"will-hold-close",tag:message.ticket});
    }
  });
  process.once("disconnect",() => {
    for (const latch of closureReports.values()) latch.resolve(false);
    closureReports.clear();
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
  await admin.query("SET rea_t319.synthetic='on'; SET rea_t320.synthetic='on'; SET rea_t322.synthetic='on'");
  await admin.query(sql);
  const storage=(await readFile(new URL("t320-https-durable-egress.sql",import.meta.url),"utf8")).replaceAll("\r\n","\n");
  assert.equal(createHash("sha256").update(storage).digest("hex"),"dcdeac87bda4d0f856ec28e38d1be4ffc33e0c6b371feedba29f53678fb816dd");
  await admin.query(storage);
  await admin.query(await readFile(new URL("t322-egress-intent-revocation.sql",import.meta.url),"utf8"));
  for (const identity of identities) {
    assert(/^t322_(controller|supervisor|sender_a|sender_b)$/.test(identity.login));
    assert(/^[0-9a-f]{48}$/.test(identity.password));
    await admin.query(`CREATE ROLE ${identity.login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${identity.password}'`);
  }
  await admin.query(`GRANT USAGE ON SCHEMA rea_t322 TO t322_controller,t322_sender_a,t322_sender_b,t322_supervisor;
    GRANT USAGE ON SCHEMA rea_t319 TO t322_supervisor;
    GRANT EXECUTE ON FUNCTION rea_t322.control_action(text,bigint,uuid,uuid,uuid) TO t322_controller;
    GRANT EXECUTE ON FUNCTION rea_t322.send_step(text,uuid,uuid,uuid,text) TO t322_sender_a,t322_sender_b;
    GRANT EXECUTE ON FUNCTION rea_t322.record_isolation(bigint,uuid,integer) TO t322_supervisor`);
}

async function run(supervised) {
  for (const key of Object.keys(process.env)) if (/^(PG|NODE_PG_|DREAM_|SUPABASE|VERCEL|POSTGRES|DATABASE_URL$)/i.test(key)) delete process.env[key];
  const cluster=await makeCluster();
  const clients=new Set();
  const children=[];
  const requests=new Set();
  const ports=[];
  const credentials=login => ({login,password:randomBytes(24).toString("hex"),port:cluster.port});
  const ctl=credentials(controllerLogin);
  const sup=credentials(supervisorLogin);
  const credA=credentials("t322_sender_a");
  const credB=credentials("t322_sender_b");
  const ownerA=randomUUID();
  const ownerB=randomUUID();
  const actorA=randomUUID();
  const actorB=randomUUID();
  const revocation=randomUUID();
  const generation=supervised ? 2 : 1;
  const historical=[];

  async function db(credential,dbName=database) {
    const client=connection(cluster.port,credential.login,credential.password,dbName);
    clients.add(client);
    await client.connect();
    return client;
  }
  function child(role,config) {
    const instance=launch(role,config);
    children.push(instance);
    return instance;
  }
  const signal=(sender,kind,ticket) => sender.child.send({kind,ticket});
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
    const root={login:bootstrap,password:cluster.password};
    const postgres=await db(root,"postgres");
    await postgres.query("CREATE DATABASE dream_test_t319 TEMPLATE template0");
    const admin=await db(root);
    await fixture(admin,[ctl,sup,credA,credB]);
    const openssl=join(process.env.ProgramFiles,"Git","usr","bin","openssl.exe");
    const keyPath=join(cluster.root,"tls-key.pem");
    const certPath=join(cluster.root,"tls-cert.pem");
    await exec(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=T322 fixture",
      "-addext","subjectAltName=IP:127.0.0.1","-keyout",keyPath,"-out",certPath],{windowsHide:true,timeout:10000});
    const cert=await readFile(certPath,"utf8");
    const tls={cert,key:await readFile(keyPath,"utf8"),fingerprint:new X509Certificate(cert).fingerprint256};
    const a=child("sender",{...credA,...tls});
    const b=child("sender",{...credB,...tls});
    for (const sender of [a,b]) {
      const ready=await sender.get("ready");
      assert.equal(ready.address.address,host);
      assert.equal(ready.pid,sender.child.pid);
      sender.port=ready.address.port;
      ports.push(sender.port);
    }
    assert.notEqual(a.child.pid,b.child.pid);
    assert.notEqual(a.port,b.port);
    await admin.query("INSERT INTO rea_t319.sender(boot_id,process_id) VALUES($1,$2),($3,$4)",[ownerA,a.child.pid,ownerB,b.child.pid]);
    await admin.query("INSERT INTO rea_t320.sender_login VALUES($1,$2),($3,$4)",[ownerA,credA.login,ownerB,credB.login]);
    await admin.query("INSERT INTO rea_t319.gate VALUES(true,$1,$2,NULL)",[generation,ownerA]);
    await admin.query("INSERT INTO rea_t320.actor(id) VALUES($1),($2)",[actorA,actorB]);
    if (supervised) {
      // Historical sentinels test scoping even if imported history has open rows.
      for (const owner of [ownerA,ownerB]) {
        const id=randomUUID();
        const channel=randomUUID();
        await admin.query(`INSERT INTO rea_t319.permit(id,subject,generation,owner_id,not_after,state,
          controller_epoch,authority_revision,channel_id)
          VALUES($1,$2,1,$3,now()+interval '5 minutes','starting',1,1,$4)`,[id,actorB,owner,channel]);
        await admin.query(`INSERT INTO rea_t322.intent(permit_id,subject,generation,owner_id,not_after,
          controller_epoch,authority_revision,channel_id,body_digest)
          VALUES($1,$2,1,$3,now()+interval '5 minutes',1,1,$4,$5)`,[id,actorB,owner,channel,bodyDigest]);
        historical.push(id);
      }
    }
    const supervisor=await db(sup);
    const senderProbe=await db(credA);
    const controllerProbe=await db(ctl);
    await assert.rejects(senderProbe.query("SELECT * FROM rea_t322.intent"),{code:"42501"});
    await assert.rejects(controllerProbe.query("SELECT rea_t320.control_action('revoke',1,$1,NULL,NULL)",[actorA]),{code:"42501"});
    await assert.rejects(senderProbe.query(controlSql,controlArgs("finish_revoke",1,actorA,revocation)),{code:"42501"});
    await assert.rejects(controllerProbe.query(isolationSql,[generation,ownerA,a.child.pid]),{code:"42501"});
    await assert.rejects(supervisor.query("SELECT rea_t319.terminate('isolated',$1,$2,$3,NULL)",[generation,ownerA,a.child.pid]),{code:"42501"});
    await senderProbe.end();
    await controllerProbe.end();
    clients.delete(senderProbe);
    clients.delete(controllerProbe);
    let controller=child("controller",ctl);
    const initialController=await controller.get("ready");
    assert.equal(initialController.epoch,"1");

    const open=(sender,ticket,actor) => openClient(sender,tls,ticket,actor,requests);
    const got=async client => {
      const response=await within(client.result,"verified TLS response");
      assert(response.verified);
      return response;
    };
    async function zero(client,status) {
      const response=await got(client);
      assert.equal(response.status,status);
      assert.equal(response.body.length,0);
    }
    async function issue(actor) {
      const ticket=randomUUID();
      assert.equal(await controller.rpc("issue",{actor,ticket}),"issued");
      return ticket;
    }
    const intent=ticket => value(admin,`SELECT to_jsonb(i) AS value FROM rea_t322.intent i WHERE permit_id=$1`,[ticket]);
    const status=ticket => value(admin,statusSql,[ticket]);
    const revoke=action => controller.rpc(action,{actor:actorA,ticket:revocation});
    async function hold(ticket,actor) {
      const client=open(a,ticket,actor);
      await a.get("held",ticket);
      return client;
    }
    async function authorize(sender,ticket) {
      signal(sender,"attempt",ticket);
      await sender.get("intent",ticket);
      const recorded=await intent(ticket);
      assert.equal(recorded.body_digest,bodyDigest);
      assert.equal(recorded.first_reported_at,null);
      assert.equal(recorded.terminal,null);
      return recorded;
    }
    async function closed(sender,ticket) {
      await sender.get("socket-closed",ticket);
      return (await sender.get("terminal",ticket)).terminal;
    }

    const before=await issue(actorA);
    const beforeClient=await hold(before,actorA);
    const beforeIntent=await authorize(a,before);
    assert.equal(beforeIntent.subject,actorA);
    assert.equal(beforeIntent.generation,generation);
    await zero(open(a,before,actorA),409);

    const after=await issue(actorA);
    const afterClient=await hold(after,actorA);
    await authorize(a,after);
    signal(a,"drop-first",after);
    await a.get("will-drop-first",after);
    signal(a,"release",after);
    const [first]=await Promise.all([a.get("first",after),within(afterClient.first,"actual received protected prefix")]);
    assert.equal(first.recorded,"simulated_report_loss");
    assert.equal(first.bytes,prefix.length);
    assert.equal((await intent(after)).first_reported_at,null);
    assert.equal((await status(after)).state,"starting");

    const notYet=await issue(actorB);
    const notYetClient=await hold(notYet,actorB);
    assert.equal(await intent(notYet),undefined);
    assert.equal(await revoke("accept_revoke"),"pending");
    assert.equal(await revoke("accept_revoke"),"pending");
    assert.equal(await controller.rpc("finish_revoke",{actor:actorB,ticket:revocation}),"conflict");
    assert.equal(await controller.rpc("issue",{actor:actorB,ticket:randomUUID()}),"revocation_pending");
    signal(a,"attempt",notYet);
    await zero(notYetClient,409);
    assert.equal(await closed(a,notYet),"cancelled");
    assert.equal(await intent(notYet),undefined);
    assert.equal(await revoke("finish_revoke"),"pending");
    assert.equal(await controller.rpc("drain",{next:ownerB}),"draining");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"revocation_pending");
    assert.equal((await intent(before)).terminal,null);
    assert.equal((await intent(after)).terminal,null);
    assert.equal(await value(admin,"SELECT enabled AS value FROM rea_t320.actor WHERE id=$1",[actorA]),true);
    console.log("Two durable intents, no new intent after accepted revocation, and no completion or new generation while pending");

    await kill(controller);
    controller=child("controller",ctl);
    const replacement=await controller.get("ready");
    assert.equal(replacement.epoch,"2");
    assert.notEqual(replacement.pid,initialController.pid);
    assert.deepEqual(await intent(before),beforeIntent);
    assert.equal((await intent(after)).terminal,null);
    assert.equal(await revoke("finish_revoke"),"pending");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"revocation_pending");

    const isolate=(pid,owner=ownerA,epoch=generation) => value(supervisor,isolationSql,[epoch,owner,pid]);
    async function settlesNormally() {
      signal(a,"cancel",before);
      await zero(beforeClient,409);
      assert.equal(await closed(a,before),"cancelled");
      assert.equal((await intent(before)).terminal,"cancelled");
      assert.equal((await intent(before)).first_reported_at,null);
      assert.equal(await revoke("finish_revoke"),"pending");
      assert.equal(await controller.rpc("activate",{next:ownerB}),"revocation_pending");
      signal(a,"hold-close",after);
      await a.get("will-hold-close",after);
      afterClient.abort();
      const partial=await got(afterClient);
      assert(partial.aborted);
      assert.deepEqual(partial.body,prefix);
      await within(afterClient.closed,"independent client TLS closure");
      await a.get("socket-closed",after);
      assert.equal((await intent(after)).terminal,null);
      assert.equal(await revoke("finish_revoke"),"pending");
      assert.equal(await controller.rpc("activate",{next:ownerB}),"revocation_pending");
      signal(a,"record-close",after);
      assert.equal(await closed(a,after),"cancelled");
    }
    async function settlesViaSupervisor() {
      const snapshot=() => value(admin,`SELECT jsonb_build_object(
        'senders',(SELECT jsonb_agg(to_jsonb(s) ORDER BY boot_id) FROM rea_t319.sender s),
        'permits',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM rea_t319.permit p),
        'intents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY permit_id) FROM rea_t322.intent i),
        'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY permit_id,state) FROM rea_t319.event e)) AS value`);
      const original=await snapshot();
      assert.equal(await isolate(null),"unknown_sender");
      assert.equal(await isolate(b.child.pid),"unknown_sender");
      assert.equal(await isolate(b.child.pid,ownerB),"stale_owner");
      assert.equal(await isolate(a.child.pid,ownerA,generation-1),"stale_owner");
      assert.deepEqual(await snapshot(),original);
      const oldExit=await kill(a);
      assert.equal((await got(beforeClient)).body.length,0);
      const partial=await got(afterClient);
      assert(partial.aborted);
      assert.deepEqual(partial.body,prefix);
      await within(Promise.all([beforeClient.closed,afterClient.closed]),"two TLS client closures");
      assert.deepEqual(await snapshot(),original);
      assert.equal(await revoke("finish_revoke"),"pending");
      assert.equal(await controller.rpc("activate",{next:ownerB}),"revocation_pending");

      // A mismatched channel must roll back the T319 isolation writes too.
      const channel=(await intent(after)).channel_id;
      await admin.query("UPDATE rea_t322.intent SET channel_id=$2 WHERE permit_id=$1",[after,randomUUID()]);
      const mismatched=await snapshot();
      await assert.rejects(isolate(oldExit.pid),{code:"23514",message:"T322_ISOLATION_INTENT_MISMATCH"});
      assert.deepEqual(await snapshot(),mismatched);
      assert.equal(await revoke("finish_revoke"),"pending");
      await admin.query("UPDATE rea_t322.intent SET channel_id=$2 WHERE permit_id=$1",[after,channel]);
      assert.deepEqual(await snapshot(),original);
      await supervisor.query("BEGIN");
      try {
        assert.equal(await isolate(oldExit.pid),"isolated");
        assert.deepEqual(await snapshot(),original);
      } finally { await supervisor.query("ROLLBACK"); }
      assert.deepEqual(await snapshot(),original);
      assert.equal(await revoke("finish_revoke"),"pending");
      assert.equal(await isolate(oldExit.pid),"isolated");
      const committed=await snapshot();
      assert.equal(await isolate(oldExit.pid),"isolated");
      assert.deepEqual(await snapshot(),committed);
      for (const id of [before,after]) {
        assert.equal((await status(id)).state,"isolated");
        assert.equal((await intent(id)).terminal,"isolated");
      }
      for (const id of historical) {
        assert.deepEqual(committed.permits.find(row => row.id===id),original.permits.find(row => row.id===id));
        assert.deepEqual(committed.intents.find(row => row.permit_id===id),original.intents.find(row => row.permit_id===id));
      }
      assert.deepEqual(committed.senders.find(row => row.boot_id===ownerB),original.senders.find(row => row.boot_id===ownerB));
      console.log("Supervisor matched the stopped sender; permit/intent isolation was atomic, rollback-safe and scoped");
    }

    if (supervised) await settlesViaSupervisor();
    else await settlesNormally();
    const afterClosed=await intent(after);
    const terminal=supervised ? "isolated" : "cancelled";
    assert.equal(afterClosed.terminal,terminal);
    assert.equal(afterClosed.first_reported_at,null);
    assert.equal(await revoke("finish_revoke"),"completed");
    assert.equal(await revoke("finish_revoke"),"completed");
    assert.equal(await value(admin,`SELECT bool_and(i.committed_at<=v.accepted_at AND v.accepted_at<=i.closed_at
      AND i.closed_at<=v.completed_at) AS value FROM rea_t322.intent i CROSS JOIN rea_t322.revocation v
      WHERE v.id=$1 AND i.permit_id IN ($2,$3)`,[revocation,before,after]),true);
    assert.equal(await value(admin,"SELECT enabled AS value FROM rea_t320.actor WHERE id=$1",[actorA]),false);
    assert.equal(await value(admin,"SELECT authority_revision::text AS value FROM rea_t320.control WHERE singleton"),"2");
    if (!supervised) {
      signal(a,"release",before);
      signal(a,"release",after);
      await zero(open(a,before,actorA),409);
      await zero(open(a,after,actorA),409);
      assert.equal(await controller.rpc("activate",{next:ownerB}),"waiting_for_isolation");
      const oldExit=await kill(a);
      assert.equal(await controller.rpc("activate",{next:ownerB}),"waiting_for_isolation");
      assert.equal(await isolate(oldExit.pid),"isolated");
    }
    await zero(open(b,after,actorA),409);
    assert.deepEqual((await status(after)).events,["prepared","starting",terminal]);
    assert.equal(await value(admin,"SELECT count(*)::int AS value FROM rea_t322.intent"),2+historical.length);
    console.log("Closed intent records preceded committed revocation; stale TLS requests returned zero bytes");
    assert.equal(await controller.rpc("activate",{next:ownerB}),"activated");
    assert.equal(await controller.rpc("issue",{actor:actorA,ticket:randomUUID()}),"unavailable");
    await zero(open(b,before,actorA),409);
    const fresh=await issue(actorB);
    const freshClient=open(b,fresh,actorB);
    await b.get("held",fresh);
    await authorize(b,fresh);
    signal(b,"release",fresh);
    const [started]=await Promise.all([b.get("first",fresh),within(freshClient.first,"fresh generation received bytes")]);
    assert.equal(started.recorded,"sending");
    signal(b,"finish",fresh);
    const response=await got(freshClient);
    assert.equal(response.status,200);
    assert.deepEqual(response.body,body);
    assert.equal(await closed(b,fresh),"finished");
    assert.equal((await intent(fresh)).terminal,"finished");
    assert.equal((await intent(fresh)).generation,generation+1);
    await zero(open(b,fresh,actorB),409);
    assert.deepEqual((await status(fresh)).events,["prepared","starting","sending","finished"]);
    assert.equal(await value(admin,`SELECT count(*)::int AS value FROM pg_stat_activity
      WHERE usename IN ('t322_controller','t322_sender_a','t322_sender_b') AND application_name='t322-owned'`),0);
    signal(b,"inspect");
    assert.deepEqual(await b.get("inspection"),{kind:"inspection",sockets:0,jobs:0});
    console.log("Fresh owner sent one complete TLS response; no extra write or retained application DB sessions");
  } finally {
    for (const req of requests) req.destroy();
    for (const instance of children) if (!instance.dead && instance.child.connected) instance.child.disconnect();
    const ended=Promise.all(children.map(instance => instance.exited));
    await within(ended,"owned TLS and controller exits").catch(async error => {
      for (const instance of children) if (!instance.dead) instance.child.kill();
      await within(ended,"forced owned child exits");
      throw error;
    }).finally(async () => {
      try { await Promise.all([...clients].map(client => client.end())); }
      finally { await cluster.remove(); }
    });
  }
  assert(children.every(instance => instance.dead));
  assert.equal(requests.size,0);
  for (const port of ports) {
    await assert.rejects(within(new Promise((resolve,reject) => {
      const socket=createConnection({host,port});
      socket.once("connect",() => { socket.destroy(); resolve(); });
      socket.once("error",reject);
    }),"previous TLS port refused"),{code:"ECONNREFUSED"});
  }
  console.log("Owned TLS/controller processes, client requests, PG listener, temporary cluster and TLS files removed");
}

if (process.argv[2]==="controller") controllerChild();
else if (process.argv[2]==="sender") senderChild();
else {
  await run(false);
  await run(true);
}
