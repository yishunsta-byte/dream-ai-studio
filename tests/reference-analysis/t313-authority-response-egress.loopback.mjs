/* global console, process */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer, request } from "node:http";
import { clearTimeout, setTimeout } from "node:timers";

const host = "127.0.0.1";
const responses = {
  html: { method: "GET", type: "text/html; charset=utf-8", body: "<main>synthetic protected HTML</main>" },
  rsc: { method: "GET", type: "text/x-component; charset=utf-8", body: '1:["synthetic protected RSC"]\n' },
  post: { method: "POST", type: "application/json; charset=utf-8", body: '{"analysis":"synthetic protected JSON"}' },
};

function within(promise, label) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 3500);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function createEgress() {
  const tickets = new Map();
  let clock = 0;
  let generation = 1;
  let transition;
  let ticketId = 0;

  function finishTransition() {
    if (!transition) return;
    if ([...tickets.values()].some(ticket => ticket.generation === generation && !ticket.terminal)) return;
    generation++;
    const ready = transition.ready;
    transition = undefined;
    ready.resolve(generation);
  }

  function terminal(ticket, state) {
    ticket.state = state;
    ticket.terminal = true;
    ticket.settled.resolve(state);
    finishTransition();
  }

  function issue(kind, lifetime = 10) {
    if (transition) return;
    const response = responses[kind];
    const ticket = {
      id: String(++ticketId), generation, deadline: clock + lifetime, response,
      state: "prepared", consumed: 0, bytes: 0, terminal: false, closeObserved: false, suppressClose: false,
      attached: Promise.withResolvers(), first: Promise.withResolvers(), settled: Promise.withResolvers(),
      closed: Promise.withResolvers(),
    };
    tickets.set(ticket.id, ticket);
    return ticket;
  }

  function empty(res, status) {
    res.writeHead(status, { "Connection": "close", "Cache-Control": "no-store", "Content-Length": 0 });
    res.end();
  }

  function stop(ticket, status) {
    if (ticket.state === "prepared") {
      terminal(ticket, "cancelled");
    } else if (ticket.state === "held") {
      ticket.state = "closing";
      empty(ticket.channel, status);
    } else if (ticket.state === "sending") {
      ticket.state = "closing";
      ticket.tail = undefined;
      ticket.channel.destroy();
    }
  }

  function handle(req, res) {
    if (req.socket.localAddress !== host || req.socket.remoteAddress !== host) {
      empty(res, 403);
      return;
    }
    const match = /^\/(html|rsc|post)\/([1-9][0-9]*)$/.exec(req.url ?? "");
    if (!match || !Object.hasOwn(responses, match[1])) {
      empty(res, 404);
      return;
    }
    const response = responses[match[1]];
    const ticket = tickets.get(match[2]);
    if (req.method !== response.method || !ticket || ticket.response !== response) {
      empty(res, 404);
      return;
    }
    if (ticket.state !== "prepared") {
      empty(res, 409);
      return;
    }
    if (transition || ticket.generation !== generation) {
      empty(res, 409);
      return;
    }
    const socket = res.socket;
    ticket.state = "held";
    ticket.channel = res;
    ticket.finished = false;
    res.once("finish", () => { ticket.finished = true; });
    socket.once("close", () => {
      ticket.closeObserved = true;
      ticket.channel = undefined;
      ticket.tail = undefined;
      if (ticket.suppressClose) ticket.state = "unknown";
      else terminal(ticket, ticket.finished && ticket.state === "sending" ? "finished" : "cancelled");
      ticket.closed.resolve();
    });
    req.resume();
    ticket.attached.resolve();
  }

  function start(ticket) {
    if (ticket.state !== "held") return false;
    if (transition || ticket.generation !== generation || clock >= ticket.deadline) {
      stop(ticket, clock >= ticket.deadline ? 410 : 409);
      return false;
    }
    // The only code that can consume the ticket and enqueue the first bytes.
    // No yield point separates the final decision from admission to this socket.
    const content = Buffer.from(ticket.response.body);
    const split = Math.ceil(content.length / 2);
    const first = content.subarray(0, split);
    ticket.tail = content.subarray(split);
    ticket.state = "sending";
    ticket.consumed++;
    ticket.channel.writeHead(200, {
      "Connection": "close",
      "Cache-Control": "private, no-store",
      "Content-Type": ticket.response.type,
      "Content-Length": content.length,
    });
    ticket.channel.write(first);
    ticket.bytes += first.length;
    ticket.first.resolve(first.length);
    return true;
  }

  function complete(ticket) {
    if (ticket.state !== "sending" || !ticket.tail) return false;
    if (clock >= ticket.deadline) {
      stop(ticket, 410);
      return false;
    }
    const tail = ticket.tail;
    ticket.tail = undefined;
    ticket.bytes += tail.length;
    ticket.channel.end(tail);
    return true;
  }

  function cutover(cancelSending = false) {
    assert.equal(transition, undefined);
    const pending = { ready: Promise.withResolvers() };
    transition = pending;
    for (const ticket of tickets.values()) {
      if (ticket.generation !== generation) continue;
      if (cancelSending || ticket.state !== "sending") stop(ticket, 409);
    }
    finishTransition();
    return pending.ready.promise;
  }

  function confirmClosed(ticket) {
    if (ticket.state !== "unknown" || !ticket.closeObserved || ticket.channel) return false;
    ticket.tail = undefined;
    terminal(ticket, "cancelled");
    return true;
  }

  function inspect() {
    return { generation, draining: Boolean(transition), pending: [...tickets.values()].filter(ticket => !ticket.terminal).length };
  }

  return { issue, handle, start, complete, revoke: ticket => stop(ticket, 403), cutover, confirmClosed,
    inspect, advance: amount => { clock += amount; } };
}

function openClient(port, kind, ticket, activeRequests) {
  const response = responses[kind];
  const first = Promise.withResolvers();
  const settled = Promise.withResolvers();
  const closed = Promise.withResolvers();
  const chunks = [];
  let status;
  let headers;
  const collect = aborted => settled.resolve({ status, headers, aborted, body: Buffer.concat(chunks) });
  const req = request({ host, port, method: response.method, path: `/${kind}/${ticket.id}`, agent: false }, res => {
    status = res.statusCode;
    headers = res.headers;
    res.on("data", chunk => {
      chunks.push(chunk);
      first.resolve();
    });
    res.once("end", () => collect(false));
    res.once("aborted", () => collect(true));
    res.once("error", () => collect(true));
  });
  activeRequests.add(req);
  req.once("error", () => collect(true));
  req.once("close", () => {
    activeRequests.delete(req);
    closed.resolve();
  });
  req.end();
  return { first: first.promise, result: settled.promise, closed: closed.promise, abort: () => req.destroy() };
}

async function run() {
  assert.equal(process.argv.length, 2, "The probe takes no target arguments");
  const gate = createEgress();
  const sockets = new Set();
  const requests = new Set();
  const server = createServer(gate.handle);
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const listening = Promise.withResolvers();
  server.once("error", listening.reject);
  server.listen({ host, port: 0 }, listening.resolve);
  try {
    await within(listening.promise, "owned loopback listener");
    const address = server.address();
    assert.equal(address.address, host);
    const open = (kind, ticket) => openClient(address.port, kind, ticket, requests);
    const received = client => within(client.result, "HTTP response body");
    const attached = ticket => within(ticket.attached.promise, "held response");
    const settled = ticket => within(ticket.settled.promise, "verified transport termination");

    for (const [kind, response] of Object.entries(responses)) {
      const ticket = gate.issue(kind);
      const client = open(kind,ticket);
      await attached(ticket);
      assert.equal(ticket.bytes,0);
      const repeatBefore = await received(open(kind,ticket));
      assert.equal(repeatBefore.status,409);
      assert.equal(repeatBefore.body.length,0);
      assert(gate.start(ticket));
      await within(client.first,"first protected HTTP bytes");
      const repeatDuring = await received(open(kind,ticket));
      assert.equal(repeatDuring.status,409);
      assert.equal(repeatDuring.body.length,0);
      assert(gate.complete(ticket));
      const normal = await received(client);
      assert.equal(normal.status,200);
      assert.equal(normal.headers["content-type"],response.type);
      assert.equal(normal.headers["cache-control"],"private, no-store");
      assert.equal(normal.aborted,false);
      assert.deepEqual(normal.body,Buffer.from(response.body));
      assert.equal(await settled(ticket),"finished");
      assert.equal(ticket.consumed,1);
      assert.equal(ticket.bytes,normal.body.length);
      const repeatAfter = await received(open(kind,ticket));
      assert.equal(repeatAfter.status,409);
      assert.equal(repeatAfter.body.length,0);
      assert.equal(ticket.consumed,1);
    }
    console.log("HTML / RSC / POST bodies matched; duplicates before, during and after delivery contributed zero protected bytes");

    for (const kind of Object.keys(responses)) {
      for (const action of ["revoke","expire"]) {
        const ticket = gate.issue(kind);
        const client = open(kind,ticket);
        await attached(ticket);
        if (action === "revoke") gate.revoke(ticket);
        else gate.advance(10);
        assert.equal(gate.start(ticket),false);
        assert.equal(gate.complete(ticket),false);
        const denied = await received(client);
        assert.equal(denied.status,action === "revoke" ? 403 : 410);
        assert.equal(denied.body.length,0);
        assert.equal(denied.aborted,false);
        assert.equal(await settled(ticket),"cancelled");
        assert.equal(ticket.consumed,0);
        assert.equal(ticket.bytes,0);
      }
    }
    console.log("Held before first byte: expiry and revocation both yielded zero actual HTTP body bytes for each format");

    const finishing = gate.issue("html");
    const finisher = open("html",finishing);
    await attached(finishing);
    assert(gate.start(finishing));
    await within(finisher.first,"HTML prefix received");
    const next = gate.cutover();
    assert.deepEqual(gate.inspect(),{ generation:1, draining:true, pending:1 });
    assert.equal(gate.issue("html"),undefined);
    assert(gate.complete(finishing));
    assert.deepEqual((await received(finisher)).body,Buffer.from(responses.html.body));
    assert.equal(await settled(finishing),"finished");
    assert.equal(await within(next,"generation 2 after finished transport"),2);

    const aborting = gate.issue("rsc");
    const aborter = open("rsc",aborting);
    await attached(aborting);
    assert(gate.start(aborting));
    await within(aborter.first,"RSC prefix received");
    const afterCancel = gate.cutover(true);
    assert.deepEqual(gate.inspect(),{ generation:2, draining:true, pending:1 });
    assert.equal(gate.complete(aborting),false);
    assert.equal(gate.issue("post"),undefined);
    const partial = await received(aborter);
    assert(partial.aborted);
    assert.equal(partial.body.length,aborting.bytes);
    assert(partial.body.length < Buffer.byteLength(responses.rsc.body));
    assert.deepEqual(partial.body,Buffer.from(responses.rsc.body).subarray(0,aborting.bytes));
    assert.equal(await settled(aborting),"cancelled");
    assert.equal(await within(afterCancel,"generation 3 after cancelled transport"),3);
    console.log("An in-flight stream blocked generation change until its real finish or abort/close was observed");

    const unknown = gate.issue("post");
    unknown.suppressClose = true;
    const interrupted = open("post",unknown);
    await attached(unknown);
    assert(gate.start(unknown));
    await within(interrupted.first,"POST prefix received");
    const afterProof = gate.cutover();
    assert.equal(gate.confirmClosed(unknown),false);
    interrupted.abort();
    await within(interrupted.closed,"client termination");
    await within(unknown.closed.promise,"socket closed while terminal event unavailable");
    assert.deepEqual(gate.inspect(),{ generation:3, draining:true, pending:1 });
    assert.equal(unknown.state,"unknown");
    assert.equal(gate.start(unknown),false);
    assert.equal(gate.complete(unknown),false);
    assert.equal(gate.issue("post"),undefined);
    const deniedOld = await received(open("post",unknown));
    assert.equal(deniedOld.status,409);
    assert.equal(deniedOld.body.length,0);
    assert(gate.confirmClosed(unknown));
    assert.equal(await within(afterProof,"generation 4 after closure verification"),4);
    console.log("Lost terminal state: cutover stayed closed until a separate socket-closure observation was accepted");

    const held = gate.issue("html");
    const heldClient = open("html",held);
    await attached(held);
    const afterHeld = gate.cutover();
    assert.equal(gate.start(held),false);
    const cancelledBeforeStart = await received(heldClient);
    assert.equal(cancelledBeforeStart.status,409);
    assert.equal(cancelledBeforeStart.body.length,0);
    assert.equal(await within(afterHeld,"generation 5 after held response was closed"),5);
    assert.equal(held.consumed,0);
    const late = await received(open("html",held));
    assert.equal(late.status,409);
    assert.equal(late.body.length,0);
    const fresh = gate.issue("post");
    assert.equal(fresh.generation,5);
    const freshClient = open("post",fresh);
    await attached(fresh);
    assert(gate.start(fresh));
    assert(gate.complete(fresh));
    assert.deepEqual((await received(freshClient)).body,Buffer.from(responses.post.body));
    assert.equal(await settled(fresh),"finished");
    assert.equal(fresh.consumed,1);
    assert.deepEqual(gate.inspect(),{ generation:5, draining:false, pending:0 });
    console.log("A held old response sent zero bytes; the new generation then delivered its own body");
  } finally {
    await within(new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      for (const socket of sockets) socket.destroy();
      for (const req of requests) req.destroy();
    }),"owned listener closed");
  }
  assert.equal(server.listening,false);
  assert.equal(server.address(),null);
  assert.equal(sockets.size,0);
  assert.equal(requests.size,0);
  console.log("Owned HTTP listener closed; zero server sockets and client requests remain");
}

await run();
