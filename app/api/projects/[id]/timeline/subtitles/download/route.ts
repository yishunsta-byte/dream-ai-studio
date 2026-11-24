import { requireApiAuth } from "@/lib/auth/api";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { downloadProjectSubtitles } from "@/lib/cloud/local-project-review";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) {
    return await requireApiAuth() ?? Response.json({ code: "SUBTITLES_UNAVAILABLE" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
  }
  return downloadProjectSubtitles(request, params);
}
