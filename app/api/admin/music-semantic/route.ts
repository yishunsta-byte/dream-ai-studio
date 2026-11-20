import { currentGeminiSettings } from "@/lib/reference-analysis/analysis-gemini-settings";
import { createMusicSemanticHttp, musicProviderFromSettings } from "@/lib/reference-analysis/music-semantic-server";

export const runtime = "nodejs";
export const maxDuration = 45;

const handlers = createMusicSemanticHttp({
  async provider(owner) {
    const settings = await currentGeminiSettings(owner, "music");
    return settings && musicProviderFromSettings(settings);
  },
});
export const GET = handlers.get;
export const POST = handlers.post;
