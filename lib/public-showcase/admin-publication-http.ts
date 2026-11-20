import "server-only";
import { authDeniedResponse } from "../auth/api";
import { trustedOrigins } from "../auth/config";
import { resolveServerAuth, type ServerAuthResult } from "../auth/resolve";
import { createAdminPublicationService, type AdminPublicationStore } from "./admin-publication-service";
import { getPublicationAdminStore } from "./publication-runtime";

// T297 관리자 게시 HTTP 경계(GET·POST /api/admin/publications).
// - 순서(POST): 인증 1회(관리자 허용 이메일·UUID, 공용 보호 계약) → 현재 요청 출처와 같은 Origin·JSON 형식(머리글만) → 저장소 연결 →
//   본문 크기 제한 읽기 → T290 서비스. 인증·출처 판정 전에는 본문을 읽지 않는다.
//   서비스가 다시 검증된 세션·게시자·작품 소유·요청 UUID 원장·권리·리비전을 판정한다. 화면이 보낸 actor·owner는 받지 않는다.
// - 인증 결과는 요청 하나 안에서만 기억한다(getUser 1회). 모듈 전역에 두지 않는다.
// - 서버 조립에 연결된 저장소가 없으면 목록은 closed(화면의 "게시 서버 미연결"),
//   쓰기는 서비스·저장소를 부르지 않고 503 PUBLICATION_UNLINKED로 닫는다.
export const PUBLICATION_BODY_LIMIT = 1024;
const NO_STORE = Object.freeze({ "cache-control": "no-store" });
const CLOSED = Object.freeze({ kind: "closed" as const });

type Dependencies = Readonly<{
  resolveAuth: () => Promise<ServerAuthResult>;
  store: () => AdminPublicationStore | null | Promise<AdminPublicationStore | null>;
  now: () => number;
  env: Readonly<Record<string, string | undefined>>;
}>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}
function error(status: number, code: string, message: string) {
  return json({ error: message, code }, status);
}

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

/**
 * T297-F1: 지금 요청이 들어온 실제 출처(scheme+host). Host 머리글을 등록된 사이트 주소(DREAM_SITE_URL·Vercel 주소)와
 * 대조해 scheme은 등록값에서 가져온다. 이 PC 실행(Vercel 아님)에서만 루프백 http를 허용한다. x-forwarded-* 같은
 * 전달 머리글은 보지 않는다. 같은 host로 scheme이 다른 등록값이 둘 이상이면 판정하지 않고 null(거절)이다.
 */
export function currentRequestOrigin(request: Request, env: Readonly<Record<string, string | undefined>>): string | null {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  if (!host) return null;
  const matches = trustedOrigins(env).filter((origin) => new URL(origin).host === host);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;
  if (!env.VERCEL && LOOPBACK_HOST.test(host)) return `http://${host}`;
  return null;
}

/**
 * 쓰기 요청 출처·형식 판정(머리글만). Origin은 현재 요청 출처와 정확히 같아야 한다. 별도로 등록된 다른 사이트 주소도 거절한다.
 * Fetch Metadata가 있으면 same-origin이어야 한다.
 */
export function rejectForeignWrite(
  request: Request, env: Readonly<Record<string, string | undefined>>, allowedTypes: readonly string[] = ["application/json"],
): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const current = currentRequestOrigin(request, env);
  if ((fetchSite !== null && fetchSite !== "same-origin") || !origin || !current || origin !== current) {
    return error(403, "AUTH_ORIGIN_REJECTED", "이 사이트 화면에서 보낸 요청만 받을 수 있어요. 화면을 새로 고친 뒤 다시 시도해 주세요.");
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!allowedTypes.includes(type)) return error(415, "UNSUPPORTED_MEDIA_TYPE", "요청 형식이 올바르지 않아요.");
  return null;
}

/** 본문을 limit 바이트까지만 읽는다. 넘으면 "too-large", UTF-8이 깨졌으면 "invalid". */
export async function readLimitedText(request: Request, limit: number): Promise<string | "too-large" | "invalid"> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d{1,9}$/.test(declared.trim()) || Number(declared) > limit)) return "too-large";
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // T297-F1: 정리(cancel)는 시작만 하고 기다리지 않는다. 느리거나 실패하는 정리에 413 응답이 묶이지 않게 한다.
      try { void reader.cancel().catch(() => undefined); } catch { /* 정리 실패는 응답과 무관 */ }
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return "invalid"; }
}

// 요청마다 한 번 만든다(전역 캐시 금지).
export function createAdminPublicationHttp(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { resolveAuth: resolveServerAuth, store: getPublicationAdminStore, now: Date.now, env: process.env, ...overrides };
  let auth: Promise<ServerAuthResult> | undefined;
  const resolveAuth = async (): Promise<ServerAuthResult> => {
    auth ??= deps.resolveAuth().catch((): ServerAuthResult => ({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" }));
    return auth;
  };
  let resolvedStore: Promise<AdminPublicationStore | null> | undefined;
  const service = async () => {
    const linked = await (resolvedStore ??= Promise.resolve().then(() => deps.store()).catch(() => null));
    return linked ? createAdminPublicationService(linked, resolveAuth, deps.now) : null;
  };

  /** 화면(서버 컴포넌트)용 목록. 관리자 화면이 인증을 확인한 뒤 부른다. 저장소가 없으면 closed. */
  async function list() {
    const linked = await service();
    if (!linked) return CLOSED;
    return linked.list();
  }

  async function verified(): Promise<Response | null> {
    const result = await resolveAuth();
    if (result.kind === "denied") return authDeniedResponse(result);
    if (result.kind !== "verified") return error(503, "PUBLICATION_UNLINKED", "이 실행 환경에서는 게시 기능을 쓸 수 없어요.");
    return null;
  }

  async function handleGet(): Promise<Response> {
    const denied = await verified();
    if (denied) return denied;
    return json(await list());
  }

  async function handlePost(request: Request): Promise<Response> {
    const denied = await verified();
    if (denied) return denied;
    const crossSite = rejectForeignWrite(request, deps.env);
    if (crossSite) return crossSite;
    const linked = await service();
    if (!linked) return error(503, "PUBLICATION_UNLINKED", "게시 서버가 아직 연결되지 않아 요청을 처리하지 않았어요.");
    const text = await readLimitedText(request, PUBLICATION_BODY_LIMIT);
    if (text === "too-large") return error(413, "PAYLOAD_TOO_LARGE", "요청 내용이 너무 커요.");
    if (text === "invalid") return error(400, "INVALID_BODY", "요청 내용을 읽을 수 없어요.");
    let input: unknown;
    try { input = JSON.parse(text); } catch { return error(400, "INVALID_BODY", "요청 내용을 읽을 수 없어요."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return error(400, "INVALID_BODY", "요청 내용을 읽을 수 없어요.");
    // 서비스 결과(성공·conflict·source-unavailable·denied·invalid·unavailable)는 모두 200 본문으로 돌려준다.
    return json(await linked.apply(input));
  }

  return Object.freeze({ list, handleGet, handlePost });
}
