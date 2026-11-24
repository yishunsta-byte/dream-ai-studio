import "server-only";

import { authMode, authReady, isAllowedEmail, supabasePublicConfig } from "../auth/config";
import type { ServerAuthResult } from "../auth/resolve";
import { createSupabaseServer } from "../auth/server";
import { createProjectHttpsReadRequest } from "./project-https-read";

type AdapterOptions = Parameters<typeof createProjectHttpsReadRequest>[0];
type CookieMode = "route" | "render";
type Options = Pick<AdapterOptions, "project" | "signal"> & Readonly<{ cookieMode: CookieMode; expectedUserId?: string }>;
type Denial = Extract<ServerAuthResult, { kind: "denied" }>;

const signedToken = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const blocked = (status: Denial["status"], code: Denial["code"]) => ({
  auth: { kind: "denied" as const, status, code },
});
const unavailable = () => blocked(503, "AUTH_UNAVAILABLE");
const loginRequired = () => blocked(401, "AUTH_REQUIRED");

function sdkFailure(error: { name: string; status?: number }) {
  return error.name === "AuthRetryableFetchError" || (error.status !== undefined && error.status >= 500)
    ? unavailable() : loginRequired();
}

function jwtPayload(token: string): Record<string, unknown> | undefined {
  if (token.length > 8192 || !signedToken.test(token)) return;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  } catch { return; }
}

function isProjectPublicKey(key: string, ref: string) {
  if (/^sb_publishable_[a-zA-Z0-9_-]{16,256}$/.test(key)) return true;
  const payload = jwtPayload(key);
  return payload?.role === "anon" && payload.ref === ref;
}

function isRefreshBody(body: RequestInit["body"]) {
  if (typeof body !== "string" || body.length > 8192) return false;
  try {
    const value = JSON.parse(body);
    return value && Object.keys(value).length === 1 && typeof value.refresh_token === "string" && value.refresh_token.length > 0;
  } catch { return false; }
}

function sdkTransport(origin: string, mode: CookieMode, signal: AbortSignal) {
  const fetcher = globalThis.fetch;
  let failed: ReturnType<typeof unavailable> | undefined;
  let refreshed = false;
  function stop(failure = unavailable()) {
    failed ??= failure;
    // Auth retries transport errors. Give the SDK a terminal response and keep the real result in this request.
    return Response.json({ message: "Auth request closed" }, { status: 400 });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (failed || signal.aborted || input instanceof Request) return stop();
    try {
      const url = new URL(input);
      const user = url.href === `${origin}/auth/v1/user` && init?.method === "GET" && init.body == null;
      const refresh = url.href === `${origin}/auth/v1/token?grant_type=refresh_token` && init?.method === "POST";
      if (!user && (!refresh || !isRefreshBody(init?.body))) return stop();
      if (refresh && mode === "render") return stop(loginRequired());

      const headers = new Headers(init?.headers);
      headers.delete("cookie");
      headers.set("cache-control", "no-store");
      const response = await fetcher(url, {
        ...init, headers, cache: "no-store", redirect: "error", credentials: "omit",
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      });
      if (response.status === 200 && !response.redirected && (!response.url || response.url === url.href)) {
        refreshed ||= refresh;
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.redirected || (response.url && response.url !== url.href)) return stop();
      return stop(response.status >= 400 && response.status < 500 && response.status !== 429 ? loginRequired() : unavailable());
    } catch { return stop(); }
  };
  return { fetch, failure: () => failed, refreshed: () => refreshed };
}

/** Call once in a Next server request. Auth and token acquisition use one SSR cookie client. */
export function createCookieProjectHttpsReadRequest({ project: settings, signal, cookieMode, expectedUserId }: Options) {
  const project = { ...settings };
  return createProjectHttpsReadRequest({
    project, signal,
    async resolveAccess() {
      try {
        const config = supabasePublicConfig();
        if ((cookieMode !== "route" && cookieMode !== "render") || authMode() !== "supabase" || !authReady() || !config ||
            !/^[a-z0-9]{20}$/.test(project.ref) || project.origin !== `https://${project.ref}.supabase.co` ||
            config.url !== project.origin || config.anonKey !== project.publicKey ||
            !isProjectPublicKey(config.anonKey, project.ref)) return unavailable();

        const deadline = AbortSignal.timeout(5000);
        const authSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
        authSignal.throwIfAborted();
        const transport = sdkTransport(project.origin, cookieMode, authSignal);
        let cookieWriteFailed = false;
        let cookiesWritten = false;
        const supabase = await createSupabaseServer({ fetch: transport.fetch,
          cookieWrites: cookieMode === "render" ? "disabled" : {
            onError: () => { cookieWriteFailed = true; }, onWritten: () => { cookiesWritten = true; },
          } });
        if (!supabase) return unavailable();
        authSignal.throwIfAborted();
        const session = await supabase.auth.getSession();
        authSignal.throwIfAborted();
        if (cookieWriteFailed || (transport.refreshed() && !cookiesWritten)) return unavailable();
        const sessionFailure = transport.failure();
        if (sessionFailure) return sessionFailure;
        if (session.error) return sdkFailure(session.error);
        const token = session.data.session?.access_token;
        if (typeof token !== "string") return loginRequired();
        const claims = jwtPayload(token);
        if (claims?.iss !== `${project.origin}/auth/v1` || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) ||
            claims.exp <= Math.floor(Date.now() / 1000)) return loginRequired();

        // Cookie data supplies the token only. The Auth response supplies the user's identity.
        const { data, error } = await supabase.auth.getUser(token);
        authSignal.throwIfAborted();
        if (cookieWriteFailed) return unavailable();
        const userFailure = transport.failure();
        if (userFailure) return userFailure;
        if (error) return sdkFailure(error);
        const user = data.user;
        if (!user) return loginRequired();
        if (typeof user.email !== "string" || !isAllowedEmail(user.email)) return blocked(403, "AUTH_FORBIDDEN");
        if (typeof user.id !== "string" || !uuid.test(user.id)) return unavailable();
        const userId = user.id.toLowerCase();
        if (expectedUserId !== undefined && userId !== expectedUserId) return blocked(403, "AUTH_FORBIDDEN");
        return { auth: { kind: "verified", userId, email: user.email }, accessToken: token };
      } catch {
        return unavailable();
      }
    },
  });
}
