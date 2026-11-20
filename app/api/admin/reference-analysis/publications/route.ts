import { createAdminReferenceHttp } from "@/lib/reference-analysis/admin-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { publications } = createAdminReferenceHttp();
export const GET = publications;
export const POST = publications;
export const DELETE = publications;
