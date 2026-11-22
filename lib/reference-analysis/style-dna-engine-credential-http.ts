import "server-only";

import { z } from "zod";
import { openRuntimeStyleDnaEngineCredentialStore, type StyleDnaEngineCredentialStore } from "./analysis-credential-store";
import { isStyleDnaEngineModel, styleDnaEngineCredentialWrite, type StyleDnaEngine, type StyleDnaEngineCredentialMetadata } from "./style-dna-engine-credential-contract";
import { createStyleDnaAdminAccess, styleDnaAdminDefaults, styleDnaJson } from "./style-dna-admin-http";
import { readBounded } from "./read-bounded-body";

const defaults = { authenticate: styleDnaAdminDefaults.authenticate, env: styleDnaAdminDefaults.env,
  store: openRuntimeStyleDnaEngineCredentialStore, send: (...args: Parameters<typeof fetch>) => fetch(...args) };
const unconfigured: StyleDnaEngineCredentialMetadata = { configured: false, modelId: null, version: 0, updatedAt: null };
const model = z.object({ id: z.string().max(128) });

async function verifyModel(provider: StyleDnaEngine, modelId: string, key: string, signal: AbortSignal, send: typeof fetch) {
  const domain = provider === "openai" ? "api.openai.com" : "api.anthropic.com";
  const headers = new Headers({ authorization: `Bearer ${key}` });
  if (provider === "anthropic") headers.set("anthropic-version", "2026-10-21");
  try {
    const response = await send(`https://${domain}/v1/models/${encodeURIComponent(modelId)}`, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers, signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) return { code: "invalid_key", status: 422 };
      if (response.status === 404) return { code: "model_not_found", status: 422 };
      if (response.status === 429) return { code: "quota_exceeded", status: 429 };
      return { code: "provider_error", status: 502 };
    }
    const body = await readBounded(response.body, 256 * 1024, signal);
    if (!body || body.includes(key)) return { code: "provider_error", status: 502 };
    const result = model.safeParse(JSON.parse(body.toString("utf8")));
    if (result.success && isStyleDnaEngineModel(provider, result.data.id)) return null;
  } catch {
    if (signal.aborted) return { code: "timed_out", status: 504 };
  }
  return { code: "provider_error", status: 502 };
}

type Dependencies = Omit<typeof defaults, "store"> & {
  store: () => Pick<StyleDnaEngineCredentialStore, "metadata" | "open" | "write"> | null;
};
export function createStyleDnaEngineCredentialHttp(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createStyleDnaAdminAccess(deps);

  return {
    get: () => access.withAdmin(async owner => {
      const store = deps.store();
      if (!store) return styleDnaJson({ code: "storage_unavailable" }, 503);
      const { openai, anthropic } = await store.metadata(owner);
      return styleDnaJson({ providers: { openai: openai ?? unconfigured, anthropic: anthropic ?? unconfigured } });
    }),
    put: (request: Request) => access.withJson(request, async (owner, input) => {
      const parsed = styleDnaEngineCredentialWrite.safeParse(input);
      if (!parsed.success) return styleDnaJson({ code: "invalid_input" }, 400);
      const store = deps.store();
      if (!store) return styleDnaJson({ code: "storage_unavailable" }, 503);
      const { provider, modelId, expectedVersion, apiKey } = parsed.data;
      if (((await store.metadata(owner))[provider]?.version ?? 0) !== expectedVersion) return styleDnaJson({ code: "stale" }, 409);
      const existing = apiKey ? undefined : await store.open(owner, provider);
      if (!apiKey && existing?.version !== expectedVersion) return styleDnaJson({ code: "stale" }, 409);
      const key = apiKey ?? existing?.apiKey;
      if (!key) return styleDnaJson({ code: "invalid_input" }, 400);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(6_000)]);
      const problem = await verifyModel(provider, modelId, key, signal, deps.send);
      if (problem) return styleDnaJson({ code: problem.code }, problem.status);
      if (signal.aborted) return styleDnaJson({ code: "timed_out" }, 504);
      const saved = await store.write(owner, parsed.data);
      if (saved === "invalid_input") return styleDnaJson({ code: saved }, 400);
      if (saved === "stale") return styleDnaJson({ code: saved }, 409);
      return styleDnaJson({ provider: parsed.data.provider, setting: saved });
    }),
  };
}
