import { createShortsScenePromptPost } from "@/lib/reference-analysis/shorts-scene-prompt-http";

export const runtime = "nodejs";
export const maxDuration = 40;

export const POST = createShortsScenePromptPost();
