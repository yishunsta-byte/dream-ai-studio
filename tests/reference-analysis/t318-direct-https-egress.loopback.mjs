/* global console, process */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile, fork } from "node:child_process";
import { randomUUID, X509Certificate } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer, request } from "node:https";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const host = "127.0.0.1";
const body = Buffer.from('{"analysis":"synthetic protected HTTPS result"}');
const prefix = body.subarray(0,Math.ceil(body.length/2));
const tail = body.subarray(prefix.length);
const exec = promisify(execFile);

function within(promise,label) {
  let timer;
  const expired = new Promise((_,reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)),4000);
  });
  return Promise.race([promise,expired]).finally(() => clearTimeout(timer));
}

function blank(res,status) {
  res.writeHead(status,{"Connection":"close","Cache-Control":"private, no-store","Content-Length":0});
  res.end();
}

function sender() {
  assert.equal(typeof process.send,"function");
  const jobs = new Map();
  const sockets = new Set();
  let next = 0;
  let server;
  let generation;
  const report = message => { if (process.connected) process.send(message); };

  function handle(req,res) {
    if (req.socket.localAddress!==host || req.socket.remoteAddress!==host || !req.socket.encrypted ||
      req.method!=="POST" || req.url!=="/protected") {
      blank(res,404);
      return;
    }
    if (generation===undefined) {
      blank(res,409);
      return;
    }
    const id = ++next;
    const socket = res.socket;
    const job = { res, bytes:0, finished:false, authorized:false };
    jobs.set(id,job);
    res.once("finish",() => { job.finished=true; });
    socket.once("close",() => {
      jobs.delete(id);
      report({kind:"closed",id,bytes:job.bytes,finished:job.finished});
    });
    req.resume();
    report({kind:"attach",id,generation,ticket:req.headers["x-fixture-ticket"],session:req.headers["x-fixture-session"]});
  }

  function first(id,job) {
    if (!job.authorized || job.generation!==generation || job.bytes!==0) return;
    // This process owns the TLS socket. No await separates its local
    // authorization check, first enqueue, and event recording.
    job.res.writeHead(200,{"Connection":"close","Cache-Control":"private, no-store",
      "Content-Type":"application/json","Content-Length":body.length});
    job.res.write(prefix);
    job.bytes=prefix.length;
    report({kind:"first",id,bytes:job.bytes});
  }

  process.on("message",message => {
    const {kind,id} = message;
    if (kind==="tls") {
      assert.equal(server,undefined);
      server = createServer({key:message.key,cert:message.cert,minVersion:"TLSv1.2"},handle);
      server.on("connection",socket => {
        sockets.add(socket);
        socket.once("close",() => sockets.delete(socket));
      });
      server.listen({host,port:0},() => report({kind:"ready",address:server.address()}));
      return;
    }
    if (kind==="own") {
      generation=message.generation;
      report({kind:"owned",generation});
      return;
    }
    if (kind==="fence") {
      generation=undefined;
      report({kind:"fenced",generation:message.generation});
      return;
    }
    if (kind==="inspect") {
      report({kind:"inspection",sockets:sockets.size,jobs:jobs.size});
      return;
    }
    const job = jobs.get(id);
    if (!job || job.res.writableEnded || job.res.destroyed) return;
    if (kind==="grant" && generation===message.generation) {
      job.authorized=true;
      job.generation=message.generation;
      if (message.hold) report({kind:"armed",id});
      else first(id,job);
    } else if (kind==="release") {
      first(id,job);
    } else if (kind==="finish" && job.bytes===prefix.length) {
      job.bytes=body.length;
      job.res.end(tail);
    } else if (kind==="stop") {
      job.authorized=false;
      if (job.bytes) job.res.destroy();
      else blank(job.res,message.status);
    }
  });

  process.once("disconnect",() => {
    for (const socket of sockets) socket.destroy();
    server?.close();
  });
}

function launch(tls,receive) {
  const visibleEnv = new Set(["SYSTEMROOT","WINDIR","SYSTEMDRIVE","TEMP","TMP"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => visibleEnv.has(key.toUpperCase())));
  const child = fork(fileURLToPath(import.meta.url),["sender"],{windowsHide:true,execArgv:[],env});
  const worker = {child,ready:Promise.withResolvers(),exited:Promise.withResolvers(),inspection:undefined};
  child.on("message",message => {
    if (message.kind==="ready") {
      assert.equal(message.address.address,host);
      worker.port=message.address.port;
      worker.ready.resolve();
    } else if (message.kind==="inspection") worker.inspection?.resolve(message);
    else receive(worker,message);
  });
  child.once("error",worker.ready.reject);
  child.once("exit",(code,signal) => { worker.dead=true; worker.exited.resolve({code,signal}); });
  child.send({kind:"tls",...tls});
  return worker;
}

function controller() {
  const tickets = new Map();
  const clientsByWorker = new Map();
  const sessions = new Map([[randomUUID(),{id:"A",permitted:true}],[randomUUID(),{id:"B",permitted:true}]]);
  let owner;
  let generation=1;
  let revision=1;
  let now=0;
  let transition;
  let ownerReady;

  const send = (worker,message) => {
    assert(worker.child.connected && !worker.dead);
    worker.child.send(message);
  };
  const current = ticket => !transition && ticket.generation===generation && ticket.revision===revision &&
    ticket.user.permitted && now<ticket.deadline;

  function own(worker) {
    owner=worker;
    ownerReady=Promise.withResolvers();
    send(worker,{kind:"own",generation});
    return ownerReady.promise;
  }

  function advanceTransition() {
    if (!transition || transition.activating || (!transition.fenced && !transition.previous.dead)) return;
    if ([...tickets.values()].some(ticket => ticket.generation===generation && !ticket.terminal)) return;
    const {next,ready}=transition;
    // Keep admissions closed until the new listener acknowledges ownership.
    generation++;
    void own(next).then(() => { transition=undefined; ready.resolve(generation); });
    transition.activating=true;
  }

  function settled(ticket,state) {
    ticket.state=state;
    ticket.terminal=true;
    ticket.closed.resolve(state);
    if (!transition?.activating) advanceTransition();
  }

  function stop(ticket,status) {
    if (ticket.terminal || ticket.state==="closing") return;
    if (ticket.state==="ready") settled(ticket,"cancelled");
    else if (ticket.state!=="unknown") {
      ticket.state="closing";
      send(ticket.worker,{kind:"stop",id:ticket.channel,status});
    }
  }

  function receive(worker,message) {
    const {kind,id}=message;
    if (kind==="owned" && worker===owner && message.generation===generation) {
      ownerReady.resolve();
      return;
    }
    if (kind==="fenced" && transition?.previous===worker && message.generation===generation) {
      transition.fenced=true;
      advanceTransition();
      return;
    }
    if (!clientsByWorker.has(worker)) clientsByWorker.set(worker,new Map());
    const bindings=clientsByWorker.get(worker);
    if (kind==="attach") {
      const ticket=tickets.get(message.ticket);
      const session=sessions.get(message.session);
      if (!ticket || session!==ticket.user) {
        send(worker,{kind:"stop",id,status:403});
        return;
      }
      if (worker!==owner || ticket.state!=="ready" || message.generation!==generation || !current(ticket)) {
        send(worker,{kind:"stop",id,status:409});
        return;
      }
      ticket.state="held";
      ticket.worker=worker;
      ticket.channel=id;
      bindings.set(id,ticket);
      ticket.held.resolve();
      return;
    }
    const ticket=bindings.get(id);
    if (!ticket) return;
    if (kind==="armed") ticket.armed.resolve();
    if (kind==="first") {
      assert.equal(ticket.consumed,0);
      assert.equal(message.bytes,prefix.length);
      ticket.consumed++;
      if (ticket.state==="authorized") ticket.state="sending";
      ticket.first.resolve();
    }
    if (kind==="closed") {
      bindings.delete(id);
      if (ticket.loseClose) {
        ticket.state="unknown";
        ticket.unobserved.resolve();
      } else settled(ticket,message.finished && message.bytes===body.length ? "finished" : "cancelled");
    }
  }

  function issue(session,lifetime=20) {
    const user=sessions.get(session);
    if (transition || !user?.permitted) return;
    const ticket={token:randomUUID(),user,generation,revision,deadline:now+lifetime,consumed:0,
      state:"ready",terminal:false,held:Promise.withResolvers(),armed:Promise.withResolvers(),
      first:Promise.withResolvers(),closed:Promise.withResolvers(),unobserved:Promise.withResolvers()};
    tickets.set(ticket.token,ticket);
    return ticket;
  }

  function start(ticket,hold=false) {
    if (ticket.state!=="held") return false;
    if (!current(ticket)) {
      stop(ticket,now>=ticket.deadline ? 410 : 403);
      return false;
    }
    ticket.state="authorized";
    send(ticket.worker,{kind:"grant",id:ticket.channel,generation,hold});
    return true;
  }

  function release(ticket) {
    if (ticket.state!=="authorized") return false;
    if (!current(ticket)) {
      stop(ticket,now>=ticket.deadline ? 410 : 403);
      return false;
    }
    send(ticket.worker,{kind:"release",id:ticket.channel});
    return true;
  }

  function revoke(session) {
    assert(sessions.has(session));
    sessions.get(session).permitted=false;
    revision++;
    for (const ticket of tickets.values()) stop(ticket,403);
  }

  function cutover(next,cancel=false) {
    assert.equal(transition,undefined);
    assert.notEqual(next,owner);
    const ready=Promise.withResolvers();
    transition={previous:owner,next,ready,fenced:false,activating:false};
    send(owner,{kind:"fence",generation});
    for (const ticket of tickets.values()) {
      if (cancel || ticket.state!=="sending") stop(ticket,409);
    }
    return ready.promise;
  }

  async function confirmIsolation(ticket,client) {
    if (ticket.state!=="unknown" || !ticket.worker.dead || !client.closed) return false;
    const exit=await ticket.worker.exited.promise;
    assert(exit.signal || exit.code!==0);
    settled(ticket,"isolated");
    return true;
  }

  function finish(ticket) {
    if (ticket.state!=="sending") return false;
    send(ticket.worker,{kind:"finish",id:ticket.channel});
    return true;
  }

  return { receive,own,issue,start,release,revoke,cutover,confirmIsolation,finish,
    sessions:[...sessions.keys()],advance:amount => { now+=amount; },
    inspect:() => ({generation,draining:Boolean(transition),fenced:transition?.fenced ?? false}) };
}

function client(worker,tls,session,ticket,requests) {
  const result=Promise.withResolvers();
  const first=Promise.withResolvers();
  const ended=Promise.withResolvers();
  const chunks=[];
  const exchange={result:result.promise,first:first.promise,ended:ended.promise,closed:false,verified:false};
  let response;
  const collect=aborted => result.resolve({status:response?.statusCode,headers:response?.headers,aborted,body:Buffer.concat(chunks)});
  const req=request({host,port:worker.port,path:"/protected",method:"POST",ca:tls.cert,rejectUnauthorized:true,
    agent:false,headers:{"x-fixture-ticket":ticket.token,"x-fixture-session":session}},res => {
    response=res;
    res.on("data",chunk => { chunks.push(chunk); first.resolve(); });
    res.once("end",() => collect(false));
    res.once("aborted",() => collect(true));
    res.once("error",() => collect(true));
  });
  requests.add(req);
  req.once("socket",socket => socket.once("secureConnect",() => {
    exchange.verified=socket.authorized && socket.getPeerCertificate().fingerprint256===tls.fingerprint;
  }));
  req.once("error",() => collect(true));
  req.once("close",() => {
    exchange.closed=true;
    requests.delete(req);
    ended.resolve();
  });
  req.end();
  exchange.abort=() => req.destroy();
  return exchange;
}

async function run() {
  assert.equal(process.argv.length,2,"The probe accepts no target arguments");
  assert.equal(process.platform,"win32");
  const openssl=join(process.env.ProgramFiles,"Git","usr","bin","openssl.exe");
  const temp=await realpath(tmpdir());
  const root=await mkdtemp(join(temp,"dream-t318-"));
  const workers=[];
  const requests=new Set();
  const gate=controller();
  try {
    const key=join(root,"fixture-key.pem");
    const cert=join(root,"fixture-cert.pem");
    await exec(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=T318 fixture",
      "-addext","subjectAltName=IP:127.0.0.1","-keyout",key,"-out",cert],{windowsHide:true,timeout:10000});
    const pem=await readFile(cert,"utf8");
    const tls={cert:pem,key:await readFile(key,"utf8"),fingerprint:new X509Certificate(pem).fingerprint256};
    const a=launch(tls,gate.receive);
    workers.push(a);
    const b=launch(tls,gate.receive);
    workers.push(b);
    await within(Promise.all(workers.map(w => w.ready.promise)),"two owned TLS listeners");
    assert.notEqual(a.child.pid,b.child.pid);
    assert.notEqual(a.port,b.port);
    await within(gate.own(a),"first TLS owner");
    const [sessionA,sessionB]=gate.sessions;
    const open=(worker,session,ticket) => client(worker,tls,session,ticket,requests);
    const bodyOf=async exchange => {
      const result=await within(exchange.result,"TLS response");
      assert(exchange.verified,"Expected a verified synthetic TLS connection");
      return result;
    };
    const empty=async (exchange,status) => {
      const seen=await bodyOf(exchange);
      assert.equal(seen.status,status);
      assert.equal(seen.body.length,0);
    };

    const normal=gate.issue(sessionA);
    await empty(open(a,sessionB,normal),403);
    const data=open(a,sessionA,normal);
    const wrongInstance=open(b,sessionA,normal);
    await within(normal.held.promise,"held on first owner");
    await empty(wrongInstance,409);
    await empty(open(a,sessionA,normal),409);
    assert(gate.start(normal));
    await within(Promise.all([normal.first.promise,data.first]),"first protected bytes on current owner");
    await empty(open(a,sessionA,normal),409);
    assert(gate.finish(normal));
    const delivered=await bodyOf(data);
    assert.equal(delivered.status,200);
    assert.equal(delivered.headers["cache-control"],"private, no-store");
    assert.deepEqual(delivered.body,body);
    assert.equal(await within(normal.closed.promise,"normal TLS close"),"finished");
    await empty(open(a,sessionA,normal),409);
    assert.equal(normal.consumed,1);
    console.log("Two live TLS instances: wrong subject/owner and repeated admission were empty; one verified full body");

    const revoked=gate.issue(sessionA);
    const stopped=open(a,sessionA,revoked);
    await within(revoked.held.promise,"held before revocation");
    assert(gate.start(revoked,true));
    await within(revoked.armed.promise,"grant arrived before first write");
    gate.revoke(sessionA);
    assert.equal(gate.release(revoked),false);
    await empty(stopped,403);
    assert.equal(await within(revoked.closed.promise,"revoked TLS close"),"cancelled");
    assert.equal(revoked.consumed,0);
    assert.equal(gate.issue(sessionA),undefined);

    const expired=gate.issue(sessionB);
    const expiring=open(a,sessionB,expired);
    await within(expired.held.promise,"held before expiry");
    assert(gate.start(expired,true));
    await within(expired.armed.promise,"expiry grant waiting at sender");
    gate.advance(20);
    assert.equal(gate.release(expired),false);
    await empty(expiring,410);
    assert.equal(await within(expired.closed.promise,"expired TLS close"),"cancelled");
    assert.equal(expired.consumed,0);
    console.log("No first protected bytes escaped a received grant held across revocation or expiry");

    const draining=gate.issue(sessionB);
    const streaming=open(a,sessionB,draining);
    await within(draining.held.promise,"hold before draining");
    assert(gate.start(draining));
    await within(Promise.all([draining.first.promise,streaming.first]),"old owner admitted prefix");
    const waiting=gate.issue(sessionB);
    const waitingClient=open(a,sessionB,waiting);
    await within(waiting.held.promise,"second response attached during old stream");
    assert(gate.start(waiting,true));
    await within(waiting.armed.promise,"second grant arrived before cutover");
    const toB=gate.cutover(b);
    assert(gate.inspect().draining);
    assert.equal(gate.inspect().generation,1);
    assert.equal(gate.issue(sessionB),undefined);
    assert.equal(gate.release(waiting),false);
    await empty(waitingClient,409);
    assert.equal(await within(waiting.closed.promise,"unstarted old channel closed"),"cancelled");
    assert.equal(waiting.consumed,0);
    assert.equal(gate.inspect().generation,1);
    assert(gate.finish(draining));
    assert.deepEqual((await bodyOf(streaming)).body,body);
    assert.equal(await within(draining.closed.promise,"old TLS stream fully closed"),"finished");
    assert.equal(await within(toB,"handoff after real TLS close"),2);
    await empty(open(a,sessionB,draining),409);

    const uncertain=gate.issue(sessionB);
    uncertain.loseClose=true;
    const interrupted=open(b,sessionB,uncertain);
    await within(uncertain.held.promise,"second owner held");
    assert(gate.start(uncertain));
    await within(Promise.all([uncertain.first.promise,interrupted.first]),"second owner admitted prefix");
    const returnToA=gate.cutover(a,true);
    const partial=await bodyOf(interrupted);
    assert(partial.aborted);
    assert.deepEqual(partial.body,prefix);
    await within(interrupted.ended,"client independently confirmed TLS close");
    await within(uncertain.unobserved.promise,"lost terminal report");
    assert.deepEqual(gate.inspect(),{generation:2,draining:true,fenced:true});
    assert.equal(await gate.confirmIsolation(uncertain,interrupted),false);
    assert.equal(gate.issue(sessionB),undefined);
    await empty(open(a,sessionB,uncertain),409);
    await empty(open(b,sessionB,uncertain),409);
    assert(b.child.kill());
    await within(b.exited.promise,"old owner process exit");
    assert(await gate.confirmIsolation(uncertain,interrupted));
    assert.equal(await within(returnToA,"handoff after actual old-process isolation"),3);
    assert.equal(uncertain.consumed,1);
    console.log("Known TLS completion allowed handoff; lost completion waited after fencing and client close until old-process exit");

    const fresh=gate.issue(sessionB);
    const active=open(a,sessionB,fresh);
    await within(fresh.held.promise,"new generation held");
    assert(gate.start(fresh));
    await within(fresh.first.promise,"new generation starts");
    assert(gate.finish(fresh));
    assert.deepEqual((await bodyOf(active)).body,body);
    assert.equal(await within(fresh.closed.promise,"new generation closed"),"finished");
    assert.equal(fresh.consumed,1);
    a.inspection=Promise.withResolvers();
    a.child.send({kind:"inspect"});
    assert.deepEqual(await within(a.inspection.promise,"TLS socket inspection"),{kind:"inspection",sockets:0,jobs:0});
  } finally {
    for (const req of requests) req.destroy();
    for (const worker of workers) if (worker.child.connected && !worker.dead) worker.child.disconnect();
    await within(Promise.all(workers.map(w => w.exited.promise)),"owned sender process exits").catch(async error => {
      for (const worker of workers) if (!worker.dead) worker.child.kill();
      await within(Promise.all(workers.map(w => w.exited.promise)),"forced owned sender cleanup");
      throw error;
    }).finally(async () => {
      const resolved=await realpath(root);
      assert.equal(dirname(resolved).toLowerCase(),temp.toLowerCase());
      assert(basename(resolved).startsWith("dream-t318-"));
      await rm(resolved,{recursive:true,force:false});
    });
  }
  assert(workers.every(w => w.dead));
  assert.equal(requests.size,0);
  for (const worker of workers) {
    await assert.rejects(within(new Promise((resolve,reject) => {
      const socket=createConnection({host,port:worker.port});
      socket.once("connect",() => { socket.destroy(); resolve(); });
      socket.once("error",reject);
    }),"old listener refusal"),{code:"ECONNREFUSED"});
  }
  await assert.rejects(access(root),{code:"ENOENT"});
  console.log("Both owned TLS processes/listeners and all client sessions closed; ephemeral certificate directory removed");
}

if (process.argv[2]==="sender") sender();
else await run();
