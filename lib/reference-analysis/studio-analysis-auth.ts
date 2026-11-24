import "server-only";
import { createServerClient } from "@supabase/ssr";
import { allowedEmails } from "../auth/config";
import type { ServerAuthResult } from "../auth/resolve";

type Options = Readonly<{
  profile: "synthetic";
  projectUrl: string;
  anonKey: string;
  allowedEmailList: string;
  cookies: readonly Readonly<{ name: string; value: string }>[];
  timeoutMs: number;
  signal?: AbortSignal;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const authUnavailable = { kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" } as const;
const authRequired = { kind: "denied", status: 401, code: "AUTH_REQUIRED" } as const;
const authForbidden = { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" } as const;
const maxAuthResponseBytes = 256 * 1024;

async function readAuthResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("STUDIO_AUTH_RESPONSE");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxAuthResponseBytes) throw new Error("STUDIO_AUTH_RESPONSE");
      text += decoder.decode(value, { stream: true });
    }
    const parsed: unknown = JSON.parse(text + decoder.decode());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("STUDIO_AUTH_RESPONSE");
    return parsed;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** One verifier per isolated analysis request. Auth may refresh its private SSR session in memory. */
export function createIsolatedStudioAuth(options: Options): () => Promise<ServerAuthResult> {
  try {
    const { profile, projectUrl, anonKey, allowedEmailList, timeoutMs, signal: callerSignal, cookies } = options;
    const origin = new URL(projectUrl);
    const emails = allowedEmails({ DREAM_ALLOWED_EMAILS: allowedEmailList });
    if (profile !== "synthetic" || projectUrl !== origin.origin || origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" || !origin.port || !/^[\x21-\x7e]{1,4096}$/.test(anonKey) ||
      !emails.size || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return async () => authUnavailable;

    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    if (signal.aborted) return async () => authUnavailable;
    const snapshot = cookies.map(({ name, value }) => ({ name, value }));
    const fetchAuth = globalThis.fetch;
    let transportFailed = false;

    // Auth SDK retries thrown fetch errors and 5xx refreshes. Return a terminal SDK error locally.
    const transportUnavailable = () => {
      transportFailed = true;
      return Response.json({ error_code: "studio_auth_unavailable" }, { status: 400 });
    };

    const client = createServerClient(projectUrl, anonKey, {
      cookies: {
        getAll: () => signal.aborted ? [] : snapshot.map(cookie => ({ ...cookie })),
        // SSR holds refreshed state inside this client. It has no external cookie/session writer.
        setAll: () => {},
      },
      global: { fetch: async (input, init) => {
        try {
          signal.throwIfAborted();
          if (transportFailed) return transportUnavailable();
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const userLookup = init?.method === "GET" && url === `${projectUrl}/auth/v1/user`;
          const refresh = init?.method === "POST" && url === `${projectUrl}/auth/v1/token?grant_type=refresh_token`;
          if (!userLookup && !refresh) return transportUnavailable();

          const response = await fetchAuth(url, { ...init, signal, redirect: "error", cache: "no-store" });
          if (response.status >= 500) {
            await response.body?.cancel();
            return transportUnavailable();
          }
          const data = await readAuthResponse(response, signal);
          const apiVersion = response.headers.get("x-supabase-api-version");
          return Response.json(data, { status: response.status,
            ...(apiVersion ? { headers: { "x-supabase-api-version": apiVersion } } : {}) });
        } catch { return transportUnavailable(); }
      } },
    });

    let active = false;
    return async () => {
      if (signal.aborted || transportFailed || active) return authUnavailable;
      active = true;
      try {
        const { data, error } = await client.auth.getUser();
        if (signal.aborted || transportFailed) return authUnavailable;
        if (error) return error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError" ||
          (error.status !== undefined && error.status >= 500) ? authUnavailable : authRequired;
        const user = data?.user;
        if (!user) return authRequired;
        if (typeof user.email !== "string" || !emails.has(user.email.trim().toLowerCase())) return authForbidden;
        if (typeof user.id !== "string" || !uuid.test(user.id)) return authUnavailable;
        return { kind: "verified", userId: user.id.toLowerCase(), email: user.email };
      } catch { return authUnavailable; }
      finally { active = false; }
    };
  } catch { return async () => authUnavailable; }
}
