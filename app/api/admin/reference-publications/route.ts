import { createAdminReferenceHttp } from "@/lib/reference-analysis/admin-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep this route separate from the URL analysis function and its native tools.
const { publications } = createAdminReferenceHttp();
export const GET = publications;
export const POST = publications;
export const DELETE = publications;
