import "server-only";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth } from "../auth/resolve";
import { actorFromVerifiedUserId } from "../db/postgres/types";
import { getMenuConfig } from "../menus/server";
import { snapshotForMenu } from "../menus/snapshot";
import { createOwnedPrivateImageProject } from "../services/postgres/private-image-project-create";
import { isProjectCreateError } from "../services/postgres/project-create";
import { createPrivateObjectReader } from "../storage/supabase/reader";

const bodySchema = z.strictObject({ menuId: z.literal("shopping-shorts"), inputs: z.record(z.string(), z.unknown()) });
const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const unavailable = () => reply(503, { code: "PROJECT_CREATE_UNAVAILABLE" });

export async function localProjectCreate(request: Request) {
  const env = process.env;
  if (env.DREAM_PROJECT_CREATE_BACKEND !== "owned-pg17" || env.VERCEL || env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1"].includes(new URL(request.url).hostname) || env.DREAM_AUTH_MODE !== "supabase" ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) return unavailable();
  const auth = await resolveServerAuth();
  if (auth.kind === "denied") return authDeniedResponse(auth);
  if (auth.kind !== "verified") return unavailable();
  const key = request.headers.get("idempotency-key") ?? "";
  if (!uuid7.test(key)) return reply(400, { errors: { _form: "프로젝트 생성 요청 번호를 확인해 주세요." } });
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply(400, { errors: { _form: "입력 항목을 확인해 주세요." } });

  let pool: Pool | undefined;
  try {
    const port = Number(env.DREAM_OWNED_CREATE_PG_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !env.DREAM_OWNED_CREATE_PG_PASSWORD) return unavailable();
    const registrar = actorFromVerifiedUserId(env.DREAM_OWNED_CREATE_REGISTRAR ?? "");
    if (registrar.id === auth.userId) return reply(403, { code: "AUTH_FORBIDDEN" });
    const config = getMenuConfig();
    const menu = config.menus.find(item => item.id === input.data.menuId);
    if (!menu) return unavailable();
    const reader = createPrivateObjectReader({
      profile: "synthetic", projectUrl: env.DREAM_OWNED_CREATE_STORAGE_ORIGIN ?? "", projectRef: "abcdefghijklmnopqrst",
      bucket: "t367-private", privateBucket: true, credential: { mode: "service-role", key: "t368-synthetic-credential" },
      maxBytes: 1024 * 1024, timeoutMs: 6500, maxConcurrent: 1, workRoot: tmpdir(), ffprobePath: resolve(".tools/ffmpeg/ffprobe.exe"),
    });
    pool = new Pool({ host: "127.0.0.1", port, database: "dream_test_t367", user: "t368_writer",
      password: env.DREAM_OWNED_CREATE_PG_PASSWORD, ssl: false, max: 1, connectionTimeoutMillis: 3000 });
    const service = createOwnedPrivateImageProject(pool, reader, registrar, snapshotForMenu(config, menu));
    const id = await service.create(actorFromVerifiedUserId(auth.userId), key, input.data.inputs, request.signal);
    return reply(201, { id });
  } catch (error) {
    if (isProjectCreateError(error)) return reply(error.status, { code: error.code, ...(error.errors && { errors: error.errors }) });
    return unavailable();
  } finally {
    await pool?.end();
  }
}
