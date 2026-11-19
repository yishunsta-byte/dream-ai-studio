import { serveAdminRenderQueue } from "@/lib/services/postgres/admin-render-queue-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return serveAdminRenderQueue(request);
}
