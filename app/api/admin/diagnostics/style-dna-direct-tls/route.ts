import { authDeniedResponse } from "@/lib/auth/api";
import { resolveServerAuth } from "@/lib/auth/resolve";
import { inspectStyleDnaDirectTls } from "@/lib/reference-analysis/preview-direct-db-tls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 12;

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404, headers });

  const auth = await resolveServerAuth();
  if (auth.kind === "denied") return authDeniedResponse(auth);
  if (auth.kind !== "verified") return authDeniedResponse({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });

  return Response.json(await inspectStyleDnaDirectTls(), { headers });
}
