import { sceneResultRegisterHandler } from "@/lib/services/postgres/scene-result-register";

// P2 managed scene result registration (candidate): POST only. Available only when DREAM_SCENE_RESULT_BACKEND and the
// managed project core are configured; the local SQLite scene results stay on /api/projects/[id]/production.
export const runtime = "nodejs";
export const POST = sceneResultRegisterHandler();
