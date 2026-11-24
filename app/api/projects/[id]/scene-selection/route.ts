import { sceneSelectHandler } from "@/lib/services/postgres/scene-select";

// P2 managed scene version selection (candidate): POST only. Available only when DREAM_SCENE_SELECT_BACKEND selects the
// managed store; the local SQLite selection stays on /api/projects/[id]/production.
export const runtime = "nodejs";
export const POST = sceneSelectHandler();
