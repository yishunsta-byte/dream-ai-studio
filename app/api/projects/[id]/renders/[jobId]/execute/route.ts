import { requireApiAuth } from "@/lib/auth/api";
import { localRenderRequestsEnabled } from "@/lib/cloud/local-render-request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; jobId: string }> };

async function handle(request: Request, { params }: Context, download: boolean) {
  if (!localRenderRequestsEnabled()) return await requireApiAuth() ?? Response.json({ code: "RENDER_EXECUTION_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "private, no-store" } });
  // The owned PG renderer needs the local checkout and is disabled on production servers.
  if (process.env.NODE_ENV === "production") return Response.json({ code: "RENDER_EXECUTION_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "private, no-store" } });

  const { executeLocalRender } = await import("@/lib/cloud/local-render-execute");
  return executeLocalRender(request, params, download);
}

export const GET = (request: Request, context: Context) => handle(request, context, true);
export const POST = (request: Request, context: Context) => handle(request, context, false);
