// T-254 공개 커버 이미지 제공(서버 전용).
// 정규 주소(/media/public/<slug>/<generation>/cover.webp)의 GET·HEAD만 처리한다.
// - 공급원 비활성(지금 운영): 정규 주소도 404. 공개된 작품이 있을 수 없는 상태다.
// - 공급원 활성: 정확히 일치하는 활성 세대만 200. 미등록·준비·철회·과거 세대는 404.
//   설정 누락·조회 실패·파일 부재·무결성(길이·SHA-256·WebP 완전 디코딩·크기) 실패·시간 초과는 503.
// - 모든 응답 Cache-Control: no-store, X-Content-Type-Options: nosniff. Range는 무시하고 전체 200.
// - 응답에는 검증한 바이트만 싣는다. 저장 키·서명 주소·자격 정보는 응답에 넣지 않는다.
// 공급원은 아래 COVER_SOURCE 하나로만 정한다. 환경변수·요청 값으로 고르는 경로나 시험용 공개 우회는 두지 않는다.
// 합성 시험은 격리 사본에서 이 값을 바꿔 주입한다(docs/handoffs/T254-SHOWCASE-IMAGE-IMPLEMENTATION.md).
import "server-only";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import sharp from "sharp";
import { COVER_ALLOW, isCoverReadMethod, parseCoverPath, type CoverAddress } from "@/lib/public-showcase/cover-path";

export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_MAX_DIMENSION = 4096;
export const COVER_DEADLINE_MS = 5000;
const SHA256 = /^[a-f0-9]{64}$/;

// T-253 find_cover(slug, generation) 결과 한 행(object_key, mime, size_bytes, sha).
export type CoverRow = Readonly<{ objectKey: string; mime: string; sizeBytes: number; sha: string }>;
export type CoverStore = Readonly<{
  // 활성 세대가 정확히 일치하면 한 행, 아니면 null. 조회 실패는 throw.
  findCover(address: CoverAddress, signal: AbortSignal): Promise<CoverRow | null>;
  // DB가 준 불변 객체 키의 바이트 전체. maxBytes를 넘기면 throw.
  readObject(objectKey: string, options: { maxBytes: number; signal: AbortSignal }): Promise<Uint8Array>;
  // Optional final authority check after all byte verification. False closes this exact address and metadata.
  confirmCover?(address: CoverAddress, expected: CoverRow, signal: AbortSignal): Promise<boolean>;
}>;
// active인데 store가 없으면 설정 누락(503).
export type CoverSource = Readonly<{ mode: "inactive" }> | Readonly<{ mode: "active"; store: CoverStore | null }>;

// 운영 공급원. 공개 승인 저장소와 전용 다운로드 자격이 아직 없어서 비활성이다.
export const COVER_SOURCE: CoverSource = Object.freeze({ mode: "inactive" });

const STATUS_TEXT = { 404: "Not Found", 405: "Method Not Allowed", 503: "Service Unavailable" } as const;
function baseHeaders() {
  return new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
}

export function coverStatus(status: 404 | 405 | 503, method: string): Response {
  const headers = baseHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  if (status === 405) headers.set("allow", COVER_ALLOW);
  return new Response(method === "HEAD" ? null : STATUS_TEXT[status], { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRow(row: unknown, address: CoverAddress): row is CoverRow {
  if (!isRecord(row)) return false;
  const { objectKey, mime, sizeBytes, sha } = row;
  return typeof sha === "string" && SHA256.test(sha)
    && mime === "image/webp"
    && typeof sizeBytes === "number" && Number.isInteger(sizeBytes) && sizeBytes >= 1 && sizeBytes <= COVER_MAX_BYTES
    // T-253이 만드는 불변 키 형식과 정확히 같아야 한다(주소의 slug·세대와 해시에 묶임).
    && objectKey === `${address.slug}/${address.generation}/${sha}.webp`;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

// 바이트 무결성: 길이·SHA-256이 행과 같고, RIFF/WEBP 컨테이너 길이가 정확하며,
// 정지 WebP 한 장으로 끝까지 디코딩되고 가로·세로가 각각 4096 이하여야 한다. 하나라도 어긋나면 throw.
export async function verifyCoverBytes(bytes: unknown, row: CoverRow): Promise<Uint8Array> {
  if (!(bytes instanceof Uint8Array)) throw new Error("cover: not bytes");
  if (bytes.length !== row.sizeBytes || bytes.length > COVER_MAX_BYTES) throw new Error("cover: length");
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha) throw new Error("cover: hash");
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") throw new Error("cover: container");
  const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] * 2 ** 24);
  if (riffSize + 8 !== bytes.length) throw new Error("cover: container length");
  const options = { failOn: "warning", limitInputPixels: COVER_MAX_DIMENSION * COVER_MAX_DIMENSION, animated: false } as const;
  const meta = await sharp(bytes, options).metadata();
  if (meta.format !== "webp" || (meta.pages ?? 1) !== 1) throw new Error("cover: format");
  const { info } = await sharp(bytes, options).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== meta.width || info.height !== meta.height || info.width < 1 || info.height < 1 || info.width > COVER_MAX_DIMENSION || info.height > COVER_MAX_DIMENSION) {
    throw new Error("cover: dimension");
  }
  return bytes;
}

async function load(store: CoverStore, address: CoverAddress, method: string, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  const row: unknown = await store.findCover(address, signal);
  if (row === null) return coverStatus(404, method);
  if (!validRow(row, address)) throw new Error("cover: row");
  const expected = Object.freeze({ objectKey: row.objectKey, mime: row.mime, sizeBytes: row.sizeBytes, sha: row.sha });
  signal.throwIfAborted();
  const bytes = await store.readObject(expected.objectKey, { maxBytes: COVER_MAX_BYTES, signal });
  signal.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected.sizeBytes) throw new Error("cover: length");
  const payload = Uint8Array.from(bytes);
  await verifyCoverBytes(payload, expected);
  signal.throwIfAborted();
  if (store.confirmCover && (await store.confirmCover(address, expected, signal)) !== true) {
    return new Response(null, { status: 404, headers: baseHeaders() });
  }
  signal.throwIfAborted();

  const headers = baseHeaders();
  headers.set("content-type", "image/webp");
  headers.set("content-length", String(payload.length));
  return new Response(method === "HEAD" ? null : payload, { status: 200, headers });
}

export async function serveCover(request: Request, source: CoverSource = COVER_SOURCE, deadlineMs: number = COVER_DEADLINE_MS): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!isCoverReadMethod(method)) return coverStatus(405, method);
  const url = new URL(request.url);
  const address = url.search === "" ? parseCoverPath(url.pathname) : null;
  if (!address || source.mode !== "active") return coverStatus(404, method);
  if (!source.store) return coverStatus(503, method);

  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  if (signal.aborted) return coverStatus(503, method);
  const cancelled = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => cancelled.reject(new Error("cover: cancelled")));
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await Promise.race([load(source.store, address, method, signal), cancelled.promise]);
    return signal.aborted ? coverStatus(503, method) : response;
  } catch {
    return coverStatus(503, method);
  } finally {
    clearTimeout(timer);
    listener[Symbol.dispose]();
  }
}
