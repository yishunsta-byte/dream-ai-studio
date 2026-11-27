import "server-only";

import { openRuntimeStyleDnaGenerationCredentialStore, type StyleDnaGenerationCredentialStore } from "./analysis-credential-store";
import { styleDnaGenerationCredentialWrite, styleDnaGenerationKey, unconfiguredGenerationCredential } from "./style-dna-generation-credential-contract";
import { createStyleDnaAdminAccess, styleDnaAdminDefaults, styleDnaJson } from "./style-dna-admin-http";

// 생성 공급자 키 등록(GET 상태, PUT 저장). 저장할 때 공급자를 부르지 않는다(무료 확인 경로를 확인하지 못했고,
// 유료 생성으로 키를 확인하지 않는다). 키가 틀리면 첫 생성에서 provider_rejected로 드러난다.
// 응답·기록 어디에도 키 원문·앞뒤 글자·길이를 넣지 않는다.
const defaults = { authenticate: styleDnaAdminDefaults.authenticate, env: styleDnaAdminDefaults.env,
  store: openRuntimeStyleDnaGenerationCredentialStore };
type Dependencies = Omit<typeof defaults, "store"> & {
  store: () => Pick<StyleDnaGenerationCredentialStore, "metadata" | "write"> | null;
};

export function createStyleDnaGenerationCredentialHttp(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createStyleDnaAdminAccess(deps);

  return {
    get: () => access.withAdmin(async owner => {
      const store = deps.store();
      if (!store) return styleDnaJson({ code: "storage_unavailable" }, 503);
      const { byteplus, bfl, openai } = await store.metadata(owner);
      const setting = (saved: typeof byteplus) => saved ? { configured: true, ...saved } : unconfiguredGenerationCredential;
      return styleDnaJson({ providers: { byteplus: setting(byteplus), bfl: setting(bfl), openai: setting(openai) } });
    }),
    put: (request: Request) => access.withJson(request, async (owner, input) => {
      const parsed = styleDnaGenerationCredentialWrite.safeParse(input);
      if (!parsed.success) return styleDnaJson({ code: "invalid_input" }, 400);
      const { provider, expectedVersion, apiKey } = parsed.data;
      if (!styleDnaGenerationKey.safeParse(apiKey).success) return styleDnaJson({ code: "invalid_key" }, 422);
      const store = deps.store();
      if (!store) return styleDnaJson({ code: "storage_unavailable" }, 503);
      const saved = await store.write(owner, provider, apiKey, expectedVersion);
      if (saved === "stale") return styleDnaJson({ code: "stale" }, 409);
      return styleDnaJson({ provider, setting: { configured: true, ...saved } });
    }),
  };
}
