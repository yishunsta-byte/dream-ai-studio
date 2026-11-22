import "server-only";

import { openRuntimeStyleDnaEngineCredentialStore, type StyleDnaEngineCredentialStore } from "./analysis-credential-store";
import { styleDnaEngineCredentialWrite, type StyleDnaEngineCredentialMetadata } from "./style-dna-engine-credential-contract";
import { createStyleDnaAdminAccess, styleDnaAdminDefaults, styleDnaJson } from "./style-dna-admin-http";

const defaults = { authenticate: styleDnaAdminDefaults.authenticate, env: styleDnaAdminDefaults.env,
  store: openRuntimeStyleDnaEngineCredentialStore };
const unconfigured: StyleDnaEngineCredentialMetadata = { configured: false, modelId: null, version: 0, updatedAt: null };

type Dependencies = Omit<typeof defaults, "store"> & {
  store: () => Pick<StyleDnaEngineCredentialStore, "metadata" | "write"> | null;
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
      const saved = await store.write(owner, parsed.data);
      if (saved === "invalid_input") return styleDnaJson({ code: saved }, 400);
      if (saved === "stale") return styleDnaJson({ code: saved }, 409);
      return styleDnaJson({ provider: parsed.data.provider, setting: saved });
    }),
  };
}
