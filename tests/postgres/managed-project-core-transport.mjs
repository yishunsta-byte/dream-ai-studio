/* global AbortSignal, Buffer, Request, Response, URL, process */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { request } from "node:https";

const setup = JSON.parse(process.env.P102_SYNTHETIC_TRANSPORT);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  if (args[1] === setup.dbHost && args[0] === 5432) return connect.call(this,setup.dbPort,"127.0.0.1");
  return connect.apply(this,args);
};

const fetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const original = new Request(input, init);
  const endpoint = new URL(original.url);
  if (endpoint.origin === setup.appOrigin) return fetch(input,init);
  assert.equal(endpoint.origin,setup.authOrigin,"Unexpected outbound fetch");
  assert.equal(endpoint.pathname,"/auth/v1/user");
  assert.equal(original.method,"GET");
  return new Promise((resolve,reject)=>{
    const outgoing=request({
      hostname:"127.0.0.1",port:setup.authPort,servername:endpoint.hostname,path:endpoint.pathname,method:"GET",
      ca:readFileSync(setup.cert),rejectUnauthorized:true,agent:false,headers:Object.fromEntries(original.headers),
      signal:AbortSignal.any([original.signal,AbortSignal.timeout(5000)]),
    }, response=>{
      const chunks=[];
      response.on("data",chunk=>chunks.push(chunk));
      response.once("error",reject);
      response.once("end",()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
    outgoing.once("error",reject);
    outgoing.end();
  });
};
