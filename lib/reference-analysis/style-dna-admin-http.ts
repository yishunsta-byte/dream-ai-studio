import "server-only";

import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth } from "../auth/resolve";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";

export const styleDnaJson = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
});

export const styleDnaAdminDefaults = {
  authenticate: resolveServerAuth,
  env: process.env as Readonly<Record<string, string | undefined>>,
};

export function createStyleDnaAdminAccess({ authenticate, env }: typeof styleDnaAdminDefaults) {
  async function withAdmin(handle: (owner: string) => Promise<Response>) {
    try {
      const auth = await authenticate();
      if (auth.kind === "local") return authDeniedResponse({ kind: "denied", code: "AUTH_REQUIRED", status: 401 });
      if (auth.kind === "denied") return authDeniedResponse(auth);
      return await handle(auth.userId);
    } catch { return styleDnaJson({ code: "storage_unavailable" }, 503); }
  }

  const withJson = (request: Request, handle: (owner: string, input: unknown) => Promise<Response>) =>
    withAdmin(async owner => {
      const blocked = rejectForeignWrite(request, env);
      if (blocked) return blocked;
      const raw = await readLimitedText(request, 8192);
      if (raw === "too-large") return styleDnaJson({ code: "too_large" }, 413);
      let input: unknown;
      try { input = JSON.parse(raw); } catch { return styleDnaJson({ code: "invalid_input" }, 400); }
      return handle(owner, input);
    });

  return { withAdmin, withJson };
}
