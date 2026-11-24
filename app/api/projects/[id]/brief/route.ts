import { managedProjectBrief } from "@/lib/cloud/managed-project-core-http";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.DREAM_PROJECT_CORE_BACKEND === undefined && localProjectFormEnabled()) {
    const { localProjectBrief } = await import("@/lib/cloud/local-project-brief");
    return localProjectBrief(request, { params });
  }
  return managedProjectBrief(request, params);
}

export const POST = GET;
