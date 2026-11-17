import "server-only";
import { AUTH_MESSAGES, authMode, authReady, isAllowedEmail } from "./config";
import { createSupabaseServer } from "./server";

function deny(status: 401 | 403 | 503, code: string, error: string) {
  return Response.json({ error, code }, { status, headers: { "cache-control": "no-store" } });
}

// Every protected route calls this before reading params/body or touching data.
// The proxy refreshes cookies; this check independently verifies the user with Auth.
// A null result means the existing single-user API may run, not owner/RLS migration completion.
export async function requireApiAuth(): Promise<Response | null> {
  if (authMode() === "off") return null;
  if (!authReady()) return deny(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
  try {
    const supabase = await createSupabaseServer();
    if (!supabase) return deny(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error && ((error.status !== undefined && error.status >= 500) || error.name === "AuthRetryableFetchError")) {
      return deny(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
    }
    if (error || !user) return deny(401, "AUTH_REQUIRED", AUTH_MESSAGES.required);
    if (!isAllowedEmail(user.email)) return deny(403, "AUTH_FORBIDDEN", AUTH_MESSAGES.forbidden);
    return null;
  } catch {
    // Auth/network/cookie failures must not enter the service or disclose provider details.
    return deny(503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
  }
}
