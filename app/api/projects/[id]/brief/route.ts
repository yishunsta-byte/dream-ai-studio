import { managedProjectBrief } from "@/lib/cloud/managed-project-core-http";

export const runtime = "nodejs";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return managedProjectBrief(request, params);
}

export const POST = GET;
