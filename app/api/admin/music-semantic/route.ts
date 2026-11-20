import { createMusicSemanticHttp } from "@/lib/reference-analysis/music-semantic-server";

export const runtime = "nodejs";
export const maxDuration = 45;

const handlers = createMusicSemanticHttp();
export const GET = handlers.get;
export const POST = handlers.post;
