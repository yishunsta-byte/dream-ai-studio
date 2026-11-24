import { requireApiAuth } from "@/lib/auth/api";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { localProjectReview } from "@/lib/cloud/local-project-review";

export const runtime = "nodejs";

async function review(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) {
    return await requireApiAuth() ?? Response.json({ code: "REVIEW_UNAVAILABLE" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
  }
  return localProjectReview(request, params);
}

export { review as GET, review as POST };
