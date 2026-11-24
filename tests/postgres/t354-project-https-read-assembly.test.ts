import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as supabaseServer from "../../lib/auth/server";
import { createCookieProjectHttpsReadRequest as assemble } from "../../lib/services/project-https-read-assembly";

vi.mock("server-only", () => ({}));
const next = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: next.cookies }));

const ref = "abcdefghijklmnopqrst";
const origin = `https://${ref}.supabase.co`;
const publicKey = "sb_publishable_synthetic_test_client_key";
const profile = "project_read";
const settings = { ref, origin, publicKey, profile };
const owner = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.invalid" };
const other = { id: "20000000-0000-4000-8000-000000000001", email: "other@example.invalid" };
const privateMarker = "sensitive-fixture-upstream";
const refreshToken = "synthetic-cookie-refresh-token";
const noStore = { "cache-control": "no-store" };
const cookieName = `sb-${ref}-auth-token`;
type AssemblyOptions = Parameters<typeof assemble>[0];
function createCookieProjectHttpsReadRequest(options: Omit<AssemblyOptions, "cookieMode"> & { cookieMode?: AssemblyOptions["cookieMode"] }) {
  return assemble({ cookieMode: "route", ...options });
}

function token(subject = owner.id, overrides: object = {}) {
  const payload = { sub: subject, aud: "authenticated", role: "authenticated", iss: `${origin}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 3600, ...overrides };
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function session(accessToken: string, expired = false) {
  return { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + (expired ? -10 : 3600), expires_in: 3600,
    user: { id: other.id, email: other.email } };
}

function cookieStore(value?: ReturnType<typeof session>) {
  const stored = new Map<string, string>();
  if (value) stored.set(cookieName, "base64-" + Buffer.from(JSON.stringify(value)).toString("base64url"));
  return {
    getAll: vi.fn(() => Array.from(stored, ([name, value]) => ({ name, value }))),
    set: vi.fn((name: string, value: string) => { stored.set(name, value); }),
  };
}

type Mode = Readonly<{ verified?: typeof owner; refresh?: { accessToken: string }; authStatus?: number; refreshStatus?: number }>;
function transport(mode: Mode = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error("unexpected origin");
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token" && mode.refresh) {
      if (mode.refreshStatus) return Response.json({ code: "refresh_token_not_found", message: privateMarker }, { status: mode.refreshStatus });
      return Response.json({ ...session(mode.refresh.accessToken), user: owner });
    }
    if (url.pathname === "/auth/v1/user") {
      if (mode.authStatus) return Response.json({ code: "bad_jwt", message: privateMarker }, { status: mode.authStatus });
      return Response.json(mode.verified ?? owner);
    }
    if (url.pathname === "/rest/v1/project_list" || url.pathname === "/rest/v1/project_detail") {
      if (init?.cache !== "no-store") throw new Error("unexpected data cache");
      return Response.json([], { headers: { "content-profile": profile, "content-range": "*/0" } });
    }
    throw new Error("unexpected fetch");
  });
}

const endpoint = (input: Parameters<typeof fetch>[0]) => new URL(input instanceof Request ? input.url : String(input)).pathname;
const bearer = (init: RequestInit | undefined) => new Headers(init?.headers).get("authorization");

beforeEach(() => {
  next.cookies.mockReset();
  next.cookies.mockResolvedValue(cookieStore());
  vi.stubEnv("DREAM_AUTH_MODE", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", publicKey);
  vi.stubEnv("DREAM_ALLOWED_EMAILS", owner.email);
  vi.stubGlobal("fetch", transport());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("T354 real SSR cookie client with isolated network", () => {
  it("denies a verified HTTPS account that differs from the account on the admin page before reading projects", async () => {
    vi.stubEnv("DREAM_ALLOWED_EMAILS", `${owner.email},${other.email}`);
    next.cookies.mockResolvedValue(cookieStore(session(token(other.id))));
    const fetch = transport({ verified: other });
    vi.stubGlobal("fetch", fetch);

    const request = createCookieProjectHttpsReadRequest({ project: settings, cookieMode: "render", expectedUserId: owner.id });
    expect(await request.list()).toMatchObject({ status: 403, body: { code: "AUTH_FORBIDDEN" }, headers: noStore });
    expect(fetch.mock.calls.map(([url]) => endpoint(url))).toEqual(["/auth/v1/user"]);
  });

  it("uses cookie access only, verifies its exact token, and returns no-store DTOs", async () => {
    const cookieToken = token();
    const cookies = cookieStore(session(cookieToken));
    next.cookies.mockResolvedValue(cookies);
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = createCookieProjectHttpsReadRequest({ project: settings });
    const [list, detail] = await Promise.all([request.list(), request.get(owner.id)]);
    expect(list).toEqual({ status: 200, body: [], headers: noStore });
    expect(detail).toMatchObject({ status: 404, body: { code: "NOT_FOUND" }, headers: noStore });
    expect(next.cookies).toHaveBeenCalledOnce();
    expect(cookies.getAll).toHaveBeenCalled();
    expect(cookies.set).not.toHaveBeenCalled();
    expect(fetch.mock.calls.map(([url]) => endpoint(url))).toEqual([
      "/auth/v1/user", "/auth/v1/user", "/rest/v1/project_list", "/rest/v1/project_detail",
    ]);
    expect(fetch.mock.calls.every(([, init]) => bearer(init) === `Bearer ${cookieToken}`)).toBe(true);
    expect(fetch.mock.calls.every(([, init]) => init?.cache === "no-store" && init.redirect === "error" &&
      init.credentials === "omit" && new Headers(init.headers).get("cache-control") === "no-store")).toBe(true);
    expect(JSON.stringify([list, detail])).not.toContain(cookieToken);
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes only the SDK-refreshed token after an expired cookie was rotated", async () => {
    const expired = token(owner.id, { exp: 1 });
    const renewed = token(owner.id, { jti: "rotated" });
    const cookies = cookieStore(session(expired, true));
    next.cookies.mockResolvedValue(cookies);
    const fetch = transport({ refresh: { accessToken: renewed } });
    vi.stubGlobal("fetch", fetch);
    const response = await createCookieProjectHttpsReadRequest({ project: settings }).list();
    expect(response).toEqual({ status: 200, body: [], headers: noStore });
    const calls = fetch.mock.calls;
    expect(calls.map(([url]) => endpoint(url))).toEqual([
      "/auth/v1/token", "/auth/v1/user", "/auth/v1/user", "/rest/v1/project_list",
    ]);
    expect(calls[0][1]?.method).toBe("POST");
    expect(calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    expect(calls[0][1]?.signal).toBe(calls[1][1]?.signal);
    expect(calls.slice(1).every(([, init]) => bearer(init) === `Bearer ${renewed}`)).toBe(true);
    expect(cookies.set.mock.calls.some(([name, value]) => name.startsWith(cookieName) && value.includes("base64-"))).toBe(true);
    expect(JSON.stringify(response)).not.toContain(renewed);
    expect(JSON.stringify(response)).not.toContain(refreshToken);
  });

  it.each([undefined, session(token(owner.id, { exp: 1 })), session(token(owner.id, { iss: "https://foreign.invalid/auth/v1" })),
    session("invalid\r\n")])("closes on missing or invalid cookie state before querying at case %#", async cookie => {
    next.cookies.mockResolvedValue(cookieStore(cookie));
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    const request = createCookieProjectHttpsReadRequest({ project: settings });
    expect(await request.list()).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails a rejected SDK refresh without using the old token or calling the data endpoint", async () => {
    next.cookies.mockResolvedValue(cookieStore(session(token(owner.id, { exp: 1 }), true)));
    const fetch = transport({ refresh: { accessToken: token() }, refreshStatus: 401 });
    vi.stubGlobal("fetch", fetch);
    const response = await createCookieProjectHttpsReadRequest({ project: settings }).list();
    expect(response).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
    expect(fetch.mock.calls.map(([url]) => endpoint(url))).toEqual(["/auth/v1/token"]);
    expect(JSON.stringify(response)).not.toContain(privateMarker);
  });

  it.each([
    { email: other.email, status: 403, code: "AUTH_FORBIDDEN" },
    { email: owner.email, status: 401, code: "AUTH_REQUIRED" },
  ])("stops before data when the SDK identity is blocked or does not match the token", async ({ email, status, code }) => {
    next.cookies.mockResolvedValue(cookieStore(session(token())));
    const fetch = transport({ verified: { id: other.id, email } });
    vi.stubGlobal("fetch", fetch);
    const lazyId = vi.fn();
    const response = await createCookieProjectHttpsReadRequest({ project: settings }).get(lazyId);
    expect(response).toMatchObject({ status, body: { code }, headers: noStore });
    expect(lazyId).not.toHaveBeenCalled();
    expect(fetch.mock.calls.map(([url]) => endpoint(url))).toEqual(["/auth/v1/user"]);
  });

  it.each([401, 503])("keeps SDK errors sealed at %s", async status => {
    const cookieToken = token();
    next.cookies.mockResolvedValue(cookieStore(session(cookieToken)));
    const fetch = transport({ authStatus: status });
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createCookieProjectHttpsReadRequest({ project: settings }).list();
    expect(response).toMatchObject({ status, body: { code: status === 401 ? "AUTH_REQUIRED" : "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(response)).not.toMatch(new RegExp(`${privateMarker}|${refreshToken}`));
    expect(JSON.stringify(response)).not.toContain(cookieToken);
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects a mismatched SSR project/key before loading cookies", async () => {
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_secret_unapproved_fixture_key");
    const request = createCookieProjectHttpsReadRequest({ project: { ...settings, publicKey: "sb_secret_unapproved_fixture_key" } });
    expect(await request.list()).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(next.cookies).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps parallel SSR requests bound to their own cookie tokens", async () => {
    const tokenA = token(owner.id);
    const tokenB = token(other.id);
    vi.stubEnv("DREAM_ALLOWED_EMAILS", `${owner.email},${other.email}`);
    next.cookies.mockResolvedValueOnce(cookieStore(session(tokenA))).mockResolvedValueOnce(cookieStore(session(tokenB)));
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const auth = bearer(init);
      if (auth !== `Bearer ${tokenA}` && auth !== `Bearer ${tokenB}`) throw new Error("unexpected token");
      const user = auth === `Bearer ${tokenA}` ? owner : other;
      return transport({ verified: user })(input, init);
    });
    vi.stubGlobal("fetch", fetch);
    const first = createCookieProjectHttpsReadRequest({ project: settings });
    const second = createCookieProjectHttpsReadRequest({ project: settings });
    expect(await Promise.all([first.list(), second.list()])).toEqual([
      { status: 200, body: [], headers: noStore }, { status: 200, body: [], headers: noStore },
    ]);
    for (const key of [tokenA, tokenB]) {
      expect(fetch.mock.calls.filter(([, init]) => bearer(init) === `Bearer ${key}`).map(([input]) => endpoint(input)))
        .toEqual(["/auth/v1/user", "/auth/v1/user", "/rest/v1/project_list"]);
    }
    expect(next.cookies).toHaveBeenCalledTimes(2);
  });

  it("stops before any SDK fetch when a request is canceled during cookie setup", async () => {
    const controller = new AbortController();
    const initialized = Promise.withResolvers<ReturnType<typeof cookieStore>>();
    next.cookies.mockReturnValue(initialized.promise);
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    const pending = createCookieProjectHttpsReadRequest({ project: settings, signal: controller.signal }).list();
    controller.abort();
    initialized.resolve(cookieStore(session(token())));
    expect(await pending).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("defers expired render cookies to the proxy and accepts a fresh cookie on a later request", async () => {
    const expired = cookieStore(session(token(owner.id, { exp: 1 }), true));
    const refreshed = cookieStore(session(token(owner.id, { jti: "proxy-rotated" })));
    next.cookies.mockResolvedValueOnce(expired).mockResolvedValueOnce(refreshed);
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    const request = () => createCookieProjectHttpsReadRequest({ project: settings, cookieMode: "render" });
    expect(await request().list()).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
    expect(fetch).not.toHaveBeenCalled();
    expect(expired.set).not.toHaveBeenCalled();
    expect(await request().list()).toEqual({ status: 200, body: [], headers: noStore });
    expect(fetch.mock.calls.map(([url]) => endpoint(url))).toEqual(["/auth/v1/user", "/auth/v1/user", "/rest/v1/project_list"]);
    expect(refreshed.set).not.toHaveBeenCalled();
  });

  it("fails closed when a route cannot persist the SDK refresh cookie", async () => {
    const expired = cookieStore(session(token(owner.id, { exp: 1 }), true));
    expired.set.mockImplementation(() => { throw new Error(privateMarker); });
    next.cookies.mockResolvedValue(expired);
    const fetch = transport({ refresh: { accessToken: token() } });
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createCookieProjectHttpsReadRequest({ project: settings }).list();
    expect(response).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(JSON.stringify(response)).not.toContain(privateMarker);
    expect(expired.set).toHaveBeenCalled();
    expect(fetch.mock.calls.map(([url]) => endpoint(url))).toEqual(["/auth/v1/token"]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    { path: "/auth/v1/user", method: "POST" },
    { path: "/auth/v1/user?extra=1", method: "GET" },
    { path: "/auth/v1/token?grant_type=password", method: "POST" },
    { path: "/auth/v1/token?grant_type=refresh_token&other=1", method: "POST" },
    { path: "https://foreign.invalid/auth/v1/user", method: "GET" },
  ])("rejects unexpected SDK traffic before the transport at case %#", async ({ path, method }) => {
    const create = supabaseServer.createSupabaseServer;
    vi.spyOn(supabaseServer, "createSupabaseServer").mockImplementationOnce(async options => {
      await options?.fetch?.(new URL(path, origin), { method });
      return create(options);
    });
    next.cookies.mockResolvedValue(cookieStore(session(token())));
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    expect(await createCookieProjectHttpsReadRequest({ project: settings }).list())
      .toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["user", "refresh"] as const)("rejects redirects on the initial SDK %s call", async phase => {
    const expired = phase === "refresh";
    next.cookies.mockResolvedValue(cookieStore(session(token(), expired)));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.redirect("https://foreign.invalid", 307));
    vi.stubGlobal("fetch", fetch);
    const response = await createCookieProjectHttpsReadRequest({ project: settings }).list();
    expect(response).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(fetch).toHaveBeenCalledOnce();
    expect(endpoint(fetch.mock.calls[0][0])).toBe(expired ? "/auth/v1/token" : "/auth/v1/user");
    expect(fetch.mock.calls[0][1]?.redirect).toBe("error");
  });

  it.each(["refresh cancellation", "user deadline"] as const)("stops the active SDK request on %s without a retry", async scenario => {
    const refresh = scenario === "refresh cancellation";
    const controller = new AbortController();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    next.cookies.mockResolvedValue(cookieStore(session(token(), refresh)));
    const begun = Promise.withResolvers<AbortSignal>();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("SDK request has no signal");
      begun.resolve(signal);
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error(privateMarker)), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetch);
    const pending = createCookieProjectHttpsReadRequest({ project: settings, signal: controller.signal }).list();
    const inFlight = await begun.promise;
    if (refresh) controller.abort();
    else deadline.abort();
    expect(inFlight.aborted).toBe(true);
    const response = await pending;
    expect(response).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(JSON.stringify(response)).not.toContain(privateMarker);
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves the default SSR helper's transport and best-effort cookie behavior", async () => {
    const expired = cookieStore(session(token(owner.id, { exp: 1 }), true));
    expired.set.mockImplementation(() => { throw new Error(privateMarker); });
    next.cookies.mockResolvedValue(expired);
    const renewed = token();
    const fetch = transport({ refresh: { accessToken: renewed } });
    vi.stubGlobal("fetch", fetch);
    const supabase = await supabaseServer.createSupabaseServer();
    const result = await supabase?.auth.getSession();
    expect(result?.error).toBeNull();
    expect(result?.data.session?.access_token).toBe(renewed);
    expect(expired.set).toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]?.cache).toBeUndefined();
    expect(fetch.mock.calls[0][1]?.redirect).toBeUndefined();
  });
});
