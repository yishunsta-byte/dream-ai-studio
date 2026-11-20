import "server-only";

import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth } from "../auth/resolve";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { credentialTestRequest, credentialWrite } from "./analysis-credential-contract";
import { openRuntimeGeminiCredentialStore } from "./analysis-credential-store";
import { geminiCredentialMetadata } from "./analysis-gemini-settings";
import { validateGeminiCredential } from "./analysis-gemini-validation";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

const failures = {
  invalid_input: [400, "입력 형식을 확인해 주세요."],
  stale: [409, "다른 저장이 먼저 반영됐어요. 설정을 다시 불러와 주세요."],
  invalid_key: [422, "Gemini가 API 키를 승인하지 않았어요."],
  model_not_found: [422, "요청한 Gemini 모델을 확인할 수 없어요."],
  storage_unavailable: [503, "키 저장소에 연결할 수 없어요."],
  provider_error: [503, "Gemini 설정을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요."],
  timed_out: [504, "Gemini 설정 확인 시간이 초과됐어요."],
} as const;

function fail(code: keyof typeof failures, field?: string) {
  const [status, error] = failures[code];
  return response({ code, error, ...(field && { field }) }, status);
}

const defaults = { authenticate: resolveServerAuth, store: openRuntimeGeminiCredentialStore,
  env: process.env as Readonly<Record<string, string | undefined>>, send: globalThis.fetch };
export function createGeminiCredentialHttp(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };

  async function withAdmin(handle: (owner: string) => Promise<Response>) {
    try {
      const auth = await deps.authenticate();
      if (auth.kind === "local") return authDeniedResponse({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
      if (auth.kind === "denied") return authDeniedResponse(auth);
      return await handle(auth.userId);
    } catch { return fail("storage_unavailable"); }
  }

  function withWrite(request: Request, handle: (owner: string, input: unknown) => Promise<Response>) {
    return withAdmin(async owner => {
      const rejected = rejectForeignWrite(request, deps.env);
      if (rejected) return rejected;
      const text = await readLimitedText(request, 8192);
      let value: unknown;
      try { value = JSON.parse(text); } catch { return fail("invalid_input"); }
      return await handle(owner, value);
    });
  }

  return {
    get: () => withAdmin(async owner => response(await geminiCredentialMetadata(owner, deps.store(), deps.env))),
    put: (request: Request) => withWrite(request, async (owner, value) => {
      const parsed = credentialWrite.safeParse(value);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.join(".");
        return fail("invalid_input", field);
      }

      const store = deps.store();
      if (!store) return fail("storage_unavailable");
      const { group, expectedVersion, models } = parsed.data;
      const current = await store.open(owner, group);
      if ((current?.version ?? 0) !== expectedVersion) return fail("stale");
      const apiKey = parsed.data.apiKey ?? current?.apiKey;
      if (!apiKey) return fail("invalid_input", "apiKey");
      const failed = await validateGeminiCredential(apiKey, models, deps.send);
      if (failed) return fail(failed.code, failed.field);
      if (!await store.write(owner, { group, models, apiKey }, expectedVersion)) return fail("stale");
      return response(await geminiCredentialMetadata(owner, store, deps.env));
    }),
    test: (request: Request) => withWrite(request, async (owner, value) => {
      const parsed = credentialTestRequest.safeParse(value);
      if (!parsed.success) return fail("invalid_input", parsed.error.issues[0]?.path.join("."));
      const store = deps.store();
      if (!store) return fail("storage_unavailable");
      const { group, program, version } = parsed.data;
      const current = await store.open(owner, group);
      const model = current?.models[program];
      if (!current || current.version !== version || !model) return fail("stale");
      const failed = await validateGeminiCredential(current.apiKey, { [program]: model }, deps.send);
      const saved = await store.recordTest(owner, group, version, program, failed?.code ?? null);
      return saved ? response({ program, ...saved }) : fail("stale");
    }),
  };
}
