import { requireApiAuth } from "@/lib/auth/api";
import { localProjectFormEnabled } from "@/lib/cloud/local-project-form-enabled";
import { readProjectSubtitles, saveProjectTimeline } from "@/lib/cloud/local-timeline-audio";

export const runtime = "nodejs";

async function subtitles(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localProjectFormEnabled()) {
    return await requireApiAuth() ?? Response.json({ code: "SUBTITLES_UNAVAILABLE" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
  }
  return request.method === "GET" ? readProjectSubtitles(request, params) : saveProjectTimeline(request, params, "subtitles");
}

export { subtitles as GET, subtitles as POST };
