import { sceneReadHandler } from "@/lib/services/postgres/scene-reads";

// P2 managed scene read (candidate): GET only. Available only when DREAM_SCENE_READ_BACKEND selects the managed store.
export const runtime = "nodejs";
export const GET = sceneReadHandler();
