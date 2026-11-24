import { requireApiAuth } from "@/lib/auth/api";
import { localRenderRequestsEnabled } from "@/lib/cloud/local-render-request";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  if (process.env.NODE_ENV === "production" || !localRenderRequestsEnabled())
    return await requireApiAuth() ?? Response.json({ code: "EXPORT_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const { localEditingExport } = await import("@/lib/cloud/local-editing-export");
  return localEditingExport(request, params);
}
