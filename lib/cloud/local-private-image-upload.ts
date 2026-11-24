import { readBoundedUpload } from "./read-bounded-upload";
import "server-only";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { authDeniedResponse } from "../auth/api";
import { resolveServerAuth } from "../auth/resolve";
import { actorFromVerifiedUserId } from "../db/postgres/types";
import { createOwnedPrivateImageUpload, ImageUploadError } from "../services/postgres/private-image-upload";

const maxBytes = 1024 * 1024;
const reply = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const unavailable = () => reply(503, "파일을 저장할 수 없어요. 같은 요청 번호로 다시 시도해 주세요.");

export async function localPrivateImageUpload(request: Request) {
  const env = process.env;
  const url = new URL(request.url);
  const loopback = /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/;
  if (env.DREAM_PRIVATE_UPLOAD_BACKEND !== "owned-pg17" || env.VERCEL || env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1"].includes(url.hostname) || env.DREAM_AUTH_MODE !== "supabase" ||
      !loopback.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "") || !loopback.test(env.DREAM_OWNED_UPLOAD_ORIGIN ?? "")) return unavailable();
  const auth = await resolveServerAuth();
  if (auth.kind === "denied") return authDeniedResponse(auth);
  if (auth.kind !== "verified") return unavailable();
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key))
    return reply(400, "파일 업로드 요청 번호를 확인해 주세요.");
  if (Number(request.headers.get("content-length")) > maxBytes) return reply(413, "1 MiB 이하 PNG를 선택해 주세요.");
  const port = Number(env.DREAM_OWNED_CREATE_PG_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !env.DREAM_OWNED_CREATE_PG_PASSWORD) return unavailable();
  const opened: Pool[] = [];
  try {
    const actor = actorFromVerifiedUserId(auth.userId);
    const verifier = actorFromVerifiedUserId(env.DREAM_OWNED_CREATE_REGISTRAR ?? "");
    if (actor.id === verifier.id) return reply(403, "업로드할 수 없는 계정이에요.");
    const bytes = await readBoundedUpload(request,maxBytes);
    if (bytes?.length === 0) throw new ImageUploadError("INPUT");
    if (!bytes) return reply(413, "1 MiB 이하 PNG를 선택해 주세요.");
    const pool = (role: string) => {
      const db = new Pool({ host: "127.0.0.1", database: "dream_test_t367", user: role + "_login", port,
        password: env.DREAM_OWNED_CREATE_PG_PASSWORD, ssl: false, max: 1, connectionTimeoutMillis: 3000 });
      opened.push(db);
      return db;
    };
    const api = createOwnedPrivateImageUpload({ t367_ingest: pool("t367_ingest"), t367_verify: pool("t367_verify"),
      t367_cleanup: pool("t367_cleanup") }, env.DREAM_OWNED_UPLOAD_ORIGIN!, verifier);
    await api.reserve(actor, key, { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, url.searchParams.get("rightsNote") ?? "", url.searchParams.get("filename"));
    try {
      try { await api.receive(actor, key, bytes); }
      catch (error) {
        // A retry can reach a sealed or already registered object. Complete rechecks its evidence.
        if (!(error instanceof ImageUploadError && error.code === "CLOSED")) throw error;
      }
      const { assetId } = await api.complete(actor, key);
      return Response.json({ id: assetId }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof ImageUploadError && (error.code === "EXPIRED" || error.code === "CLOSED")) await api.cancel(actor, key);
      throw error;
    }
  } catch (error) {
    if (error instanceof ImageUploadError) {
      if (error.code === "INVALID_FILENAME") return reply(400, "파일 이름은 255자 이내로 입력해 주세요.");
      if (error.code === "INVALID_RIGHTS_NOTE") return reply(400, "권리 메모는 500자 이내로 입력하고 널 문자를 제거해 주세요.");
      if (error.code === "INPUT" || error.code === "INVALID_IMAGE") return reply(400, "검증 가능한 PNG 파일을 선택해 주세요.");
      if (["CONFLICT", "CLOSED", "EXPIRED"].includes(error.code)) return reply(409, "업로드 요청과 파일 상태를 확인해 주세요.");
    }
    return unavailable();
  } finally { await Promise.all(opened.map(db => db.end())); }
}
