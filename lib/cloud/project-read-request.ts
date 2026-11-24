import "server-only";

import { authMode, supabasePublicConfig } from "../auth/config";
import { createCookieProjectHttpsReadRequest } from "../services/project-https-read-assembly";
import { projectReadError, projectReadFailure } from "../services/postgres/project-read-errors";
import { createProjectReadRequest } from "../services/postgres/project-read-request";

type LegacyAuth = NonNullable<Parameters<typeof createProjectReadRequest>[0]>["resolveAuth"];
type Options =
  | { cookieMode: "route"; signal?: AbortSignal }
  | { cookieMode: "render"; resolveLegacyAuth: LegacyAuth; expectedUserId?: string };

const unavailable = async () => projectReadFailure(projectReadError("PROJECT_READ_UNAVAILABLE"));
const failedRead = Object.freeze({ list: unavailable, get: unavailable });

export function createAppProjectReadRequest(options: Options) {
  if (process.env.DREAM_PROJECT_READ_BACKEND !== "supabase-https") {
    const open = () => options.cookieMode === "render"
      ? createProjectReadRequest({ resolveAuth: options.resolveLegacyAuth })
      : createProjectReadRequest();
    return { mode: "legacy" as const, open };
  }

  const ref = process.env.DREAM_PROJECT_HTTPS_REF;
  const profile = process.env.DREAM_PROJECT_HTTPS_PROFILE;
  const config = supabasePublicConfig();
  if (authMode() !== "supabase" || !ref || !/^[a-z0-9]{20}$/.test(ref) ||
      !profile || !/^[a-z][a-z0-9_]{0,62}$/.test(profile) || !config ||
      config.url !== `https://${ref}.supabase.co`) return { mode: "https" as const, open: () => failedRead };

  return { mode: "https" as const, open: () => createCookieProjectHttpsReadRequest({
    project: { origin: config.url, ref, profile, publicKey: config.anonKey },
    cookieMode: options.cookieMode,
    expectedUserId: options.cookieMode === "render" ? options.expectedUserId : undefined,
    signal: options.cookieMode === "route" ? options.signal : undefined,
  }) };
}
