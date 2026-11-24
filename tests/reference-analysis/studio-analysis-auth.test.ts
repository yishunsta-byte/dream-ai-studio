import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIsolatedStudioAuth } from "../../lib/reference-analysis/studio-analysis-auth";

vi.mock("server-only", () => ({}));

const ownerId = "10000000-0000-4000-8000-000000000010";
const owner = { id: ownerId, email: "owner@example.invalid", aud: "authenticated" };
const token = "synthetic-access";
const refreshedToken = "synthetic-refreshed-access";
const refreshToken = "synthetic-refresh";
const anonKey = "synthetic-project-key";
const sessionCookie = "sb-127-auth-token";
const unavailable = { kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" };
const required = { kind: "denied", status: 401, code: "AUTH_REQUIRED" };
const forbidden = { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" };
const verified = { kind: "verified", userId: ownerId, email: owner.email };
const refreshPath = "/auth/v1/token?grant_type=refresh_token";
const userPath = "/auth/v1/user";
const refreshPayload = () => ({
  access_token: refreshedToken, refresh_token: "synthetic-new-refresh", token_type: "bearer", expires_in: 3600, user: owner,
});

function cookie(expired = false) {
  const session = { access_token: token, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) +
    (expired ? -300 : 3600), expires_in: 3600, user: { ...owner, email: "unverified-cookie@example.invalid" } };
  return { name: sessionCookie, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url") };
}

type Call = { method?: string; url?: string; auth?: string; apikey?: string; body: string };
type Handler = (call: Call, response: ServerResponse) => void;
let base: string;
let handle: Handler;
const calls: Call[] = [];
const send = (response: ServerResponse, status: number, body: unknown) => response.writeHead(status, {
  "content-type": "application/json", "x-supabase-api-version": "2024-01-01",
  "set-cookie": "synthetic-upstream-cookie=should-never-be-published; Path=/",
}).end(JSON.stringify(body));

function normal(call: Call, response: ServerResponse) {
  if (call.url === refreshPath && call.method === "POST") send(response, 200, refreshPayload());
  else if (call.url === userPath && call.method === "GET") send(response, 200, owner);
  else send(response, 404, { code: "unexpected_test_endpoint" });
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", part => { body += part; });
  request.on("end", () => {
    const call = { method: request.method, url: request.url, auth: request.headers.authorization, apikey: request.headers.apikey as string, body };
    calls.push(call);
    handle(call, response);
  });
});

function resolver(input: Partial<Parameters<typeof createIsolatedStudioAuth>[0]> = {}) {
  return createIsolatedStudioAuth({ profile: "synthetic", projectUrl: base, anonKey, allowedEmailList: owner.email,
    cookies: [cookie()], timeoutMs: 2500, ...input });
}

function stallAt(path: string, phase: "headers" | "body") {
  const started = Promise.withResolvers<ServerResponse>();
  const closed = Promise.withResolvers<boolean>();
  handle = (call, response) => {
    if (call.url !== path) return normal(call, response);
    response.once("close", () => closed.resolve(!response.writableFinished));
    if (phase === "body") response.writeHead(200, { "content-type": "application/json" }).write("{");
    started.resolve(response);
  };
  return { started: started.promise, closed: closed.promise };
}

beforeAll(async () => {
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback listener unavailable");
  base = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { calls.length = 0; handle = normal; });
afterAll(async () => {
  if (server.listening) {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

describe("analysis-only Supabase request transport", () => {
  it("asks the real SDK for an independently verified user and never trusts the cookie's user record", async () => {
    const cookies = [cookie()];
    const original = structuredClone(cookies);
    const resolveAuth = resolver({ cookies, allowedEmailList: "  OWNER@example.invalid  " });
    expect(await resolveAuth()).toEqual(verified);
    expect(calls).toEqual([{ method: "GET", url: userPath, auth: `Bearer ${token}`, apikey: anonKey, body: "" }]);
    expect(cookies).toEqual(original);
  });

  it("keeps a real refresh inside one SSR client for subsequent checks", async () => {
    const cookies = [cookie(true)];
    const original = structuredClone(cookies);
    const resolveAuth = resolver({ cookies });
    expect(await resolveAuth()).toEqual(verified);
    expect(await resolveAuth()).toEqual(verified);
    expect(calls.map(call => [call.method, call.url, call.auth])).toEqual([
      ["POST", refreshPath, `Bearer ${anonKey}`], ["GET", userPath, `Bearer ${refreshedToken}`],
      ["GET", userPath, `Bearer ${refreshedToken}`],
    ]);
    expect(JSON.parse(calls[0].body)).toEqual({ refresh_token: refreshToken });
    expect(cookies).toEqual(original);

    expect(await resolver({ cookies: [] })()).toEqual(required);
    expect(calls).toHaveLength(3);
    const freshCaller = resolver({ cookies: [cookie()] });
    expect(await freshCaller()).toEqual(verified);
    expect(calls.at(-1)?.auth).toBe(`Bearer ${token}`);
  });

  it.each([
    [userPath, "headers", "cancel"], [userPath, "body", "deadline"],
    [refreshPath, "headers", "deadline"], [refreshPath, "body", "cancel"],
  ] as const)("aborts %s in %s on %s and suppresses late success and follow-up requests", async (path, phase, mode) => {
    const { started, closed } = stallAt(path, phase);
    const caller = new AbortController();
    const cookies = [cookie(path === refreshPath)];
    const original = structuredClone(cookies);
    const resolveAuth = resolver({ cookies, signal: caller.signal, timeoutMs: mode === "deadline" ? 240 : 2500 });
    const pending = resolveAuth();
    const response = await started;
    if (mode === "cancel") caller.abort();
    expect(await pending).toEqual(unavailable);
    expect(await closed).toBe(true);
    const late = path === refreshPath ? refreshPayload() : owner;
    if (phase === "headers") send(response, 200, late);
    else response.end(JSON.stringify(late).slice(1));
    await delay(235);
    expect(calls.map(call => call.url)).toEqual([path]);
    expect(cookies).toEqual(original);
    expect(await resolveAuth()).toEqual(unavailable);

    handle = normal;
    expect(await resolver()()).toEqual(verified);
    expect(calls.at(-1)?.auth).toBe(`Bearer ${token}`);
  });

  it("discards a refresh that succeeded locally when the subsequent user lookup is cancelled", async () => {
    const { started, closed } = stallAt(userPath, "body");
    const caller = new AbortController();
    const cookies = [cookie(true)];
    const original = structuredClone(cookies);
    const resolveAuth = resolver({ cookies, signal: caller.signal });
    const pending = resolveAuth();
    const response = await started;
    expect(calls.map(call => [call.url, call.auth])).toEqual([
      [refreshPath, `Bearer ${anonKey}`], [userPath, `Bearer ${refreshedToken}`],
    ]);
    caller.abort();
    expect(await pending).toEqual(unavailable);
    expect(await closed).toBe(true);
    response.end(JSON.stringify(owner).slice(1));
    expect(await resolveAuth()).toEqual(unavailable);
    expect(cookies).toEqual(original);
    expect(calls).toHaveLength(2);
  });

  it("rejects configuration, a pre-aborted request, and missing auth before network", async () => {
    expect(await resolver({ projectUrl: base + "/extra" })()).toEqual(unavailable);
    expect(await resolver({ projectUrl: base.replace("127.0.0.1", "localhost") })()).toEqual(unavailable);
    expect(await resolver({ allowedEmailList: " " })()).toEqual(unavailable);
    expect(await resolver({ signal: AbortSignal.abort() })()).toEqual(unavailable);
    expect(await resolver({ cookies: [] })()).toEqual(required);
    expect(calls).toEqual([]);
  });

  it("rejects denied, forbidden and malformed users without disclosing raw SDK errors", async () => {
    handle = (_call, response) => send(response, 401, { code: "session_not_found", message: "private error" });
    expect(await resolver()()).toEqual(required);
    handle = (_call, response) => send(response, 200, { ...owner, email: "other@example.invalid" });
    expect(await resolver()()).toEqual(forbidden);
    handle = (_call, response) => send(response, 200, { ...owner, id: "malformed" });
    expect(await resolver()()).toEqual(unavailable);
  });

  it("fails closed on refresh transport errors without retrying or following redirects", async () => {
    for (const fail of [
      (_call: Call, response: ServerResponse) => send(response, 503, { message: "private upstream error" }),
      (_call: Call, response: ServerResponse) => response.writeHead(307, { location: `${base}/should-not-follow` }).end(),
      (_call: Call, response: ServerResponse) => response.writeHead(200).end("{invalid"),
      (_call: Call, response: ServerResponse) => send(response, 200, { tooLarge: "a".repeat(256 * 1024) }),
    ]) {
      handle = fail;
      const length = calls.length;
      expect(await resolver({ cookies: [cookie(true)] })()).toEqual(unavailable);
      expect(calls.slice(length).map(call => call.url)).toEqual([refreshPath]);
    }
  });
});
