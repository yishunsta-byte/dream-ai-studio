// T-249 공개 승인 작품 → 공개 화면 자료(ShowcaseWork) 순수 변환.
//
// 이 파일은 발행·권한 검증 시스템이 아니다. 서버의 신뢰할 수 있는 담당 코드(아직 없음)가
// "누가 무엇을 공개 승인했는지"를 확인한 뒤 넘긴 원자료를, 공개해도 되는 칸만 골라 새 객체로 옮긴다.
// 원자료 안의 상태 값은 그 담당 코드가 만든 값이라고 가정하고, 여기서는 빠졌거나 모양이 틀리면 닫는다(제외).
// DB·파일·Supabase를 읽지 않고, 네트워크를 쓰지 않으며, 화면에 연결돼 있지 않다.
import { SHOWCASE_KINDS, type ShowcaseImage, type ShowcaseKind, type ShowcaseMedia, type ShowcaseWork } from "@/lib/public-showcase/works";

export type PublishedWorksPolicy = {
  // 공개 파일을 둘 수 있는 https 출처(scheme+host+port). 비우면 같은 사이트 공개 경로만 쓴다.
  allowedOrigins?: readonly string[];
  // 내보낼 최대 개수. 기본 24, 1~100.
  limit?: number;
  // 승인 시각이 미래인지 볼 기준 시각. 시험용.
  now?: Date;
};

export type ExclusionReason =
  | "invalid_record"
  | "invalid_id"
  | "duplicate_id"
  | "not_published"
  | "not_approved"
  | "rights_unconfirmed"
  | "revoked"
  | "artifact_incomplete"
  | "invalid_display"
  | "invalid_image"
  | "invalid_media";

export type PublishedWorksResult = {
  works: readonly ShowcaseWork[];
  // 제외된 원자료의 순번과 이유만 남긴다. 원자료 내용은 담지 않는다.
  excluded: readonly { index: number; reason: ExclusionReason }[];
  truncated: boolean;
};

// 같은 사이트에서 공개로 내보내는 고정 경로. 저장소 비공개 경로·임의 경로는 받지 않는다.
// 검사는 바깥에서 닿지 않는 내부 목록으로 하고, 내보내는 목록은 런타임에도 얼린 사본이다(T249-FIX F249-2).
const PUBLIC_PREFIXES: readonly string[] = Object.freeze(["/showcase/", "/media/public/"]);
export const PUBLIC_MEDIA_PREFIXES: readonly ["/showcase/", "/media/public/"] = Object.freeze(["/showcase/", "/media/public/"] as const);
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_INPUT = 1000;
const MAX_DIMENSION = 8192;
const IMAGE_EXT = /\.(png|jpe?g|webp|avif)$/;
const MEDIA_EXT = { video: /\.(mp4|webm)$/, audio: /\.(mp3|m4a)$/ } as const;
// 경로에는 이 글자만 허용한다: 공백·%·\·따옴표·제어 문자·물음표·# 등은 모두 거절.
const SAFE_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
// 비공개·서명 저장소 경로 조각(예: Supabase Storage sign/authenticated).
const PRIVATE_SEGMENT = /\/(?:sign|authenticated|private|signed)\//i;
const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// 제어 문자와 줄 구분 문자(U+2028·U+2029)를 막는다. 소스에 그 글자를 직접 넣지 않으려고 코드값으로 만든다.
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`);
const TEXT_LIMITS = { title: 80, subtitle: 120, creator: 60, genre: 40, format: 40, description: 400 } as const;

class Excluded extends Error {
  constructor(readonly reason: ExclusionReason) { super(reason); }
}
const fail = (reason: ExclusionReason): never => { throw new Excluded(reason); };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// 정책의 출처 목록은 https 정확한 출처만 남긴다(경로·계정·쿼리가 붙은 값은 버린다).
function normalizeOrigins(origins: readonly string[] | undefined): Set<string> {
  const result = new Set<string>();
  for (const origin of origins ?? []) {
    if (typeof origin !== "string") continue;
    try {
      const url = new URL(origin);
      if (url.protocol === "https:" && !url.username && !url.password && url.origin === origin.replace(/\/$/, "")) result.add(url.origin);
    } catch { /* 버린다 */ }
  }
  return result;
}

function safePath(path: string, extension: RegExp): boolean {
  return SAFE_PATH.test(path) && !path.split("/").some((part) => part === "." || part === "..") && !PRIVATE_SEGMENT.test(`${path}/`) && extension.test(path.toLowerCase());
}

// 공개 주소 계약: 같은 사이트의 고정 공개 경로, 또는 정책이 허용한 https 출처의 쿼리·조각 없는 주소.
export function publicAssetUrl(value: unknown, extension: RegExp, origins: ReadonlySet<string>): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || value !== value.trim()) return null;
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    return PUBLIC_PREFIXES.some((prefix) => value.startsWith(prefix)) && safePath(value, extension) ? value : null;
  }
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) return null;
  if (!origins.has(url.origin)) return null;
  if (`${url.origin}${url.pathname}` !== value) return null; // 정규화로 바뀌는 주소(%·대소문자·기본 포트 등)는 받지 않는다.
  return safePath(url.pathname, extension) ? value : null;
}

// 제어 문자·줄 구분 문자는 원문 어디에 있든(양 끝 포함) 거절한다. 그다음 보통 공백만 다듬는다(T249-FIX F249-3).
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || CONTROL.test(value)) return fail("invalid_display");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || EMAIL_LIKE.test(trimmed)) return fail("invalid_display");
  return trimmed;
}

function dimension(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION ? value : fail("invalid_image");
}

// 승인 시각은 원문에 적힌 달력 날짜·시각이 실제로 있어야 한다(T249-FIX F249-1).
// Date.parse가 2월 29일(평년)·4월 31일을 다음 달로 넘기거나 24:00을 다음 날로 받는 일을 막는다. 윤일과 시간대 표기는 그대로 받는다.
const APPROVED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;
function approvedTime(value: unknown, now: number): number {
  const match = typeof value === "string" ? APPROVED_AT.exec(value) : null;
  if (!match) return fail("not_approved");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  // 달력 검사는 직접 계산한다. Date.UTC는 0~99년을 1900년대로 바꾸므로 쓰지 않는다(T249-FIX2).
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  const realDate = daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
  if (!realDate || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return fail("not_approved");
  const time = Date.parse(value as string);
  return Number.isFinite(time) && time <= now ? time : fail("not_approved");
}

function convert(raw: unknown, origins: ReadonlySet<string>, now: number): { work: ShowcaseWork; approvedAt: number } {
  if (!isPlainObject(raw)) return fail("invalid_record");
  const id = raw.id;
  if (typeof id !== "string" || !ID.test(id)) return fail("invalid_id");

  const publication = raw.publication;
  if (!isPlainObject(publication) || publication.state !== "published") return fail("not_published");
  if (publication.revokedAt !== undefined && publication.revokedAt !== null) return fail("revoked");
  const approvedAt = approvedTime(publication.approvedAt, now);
  if (publication.rightsConfirmed !== true) return fail("rights_unconfirmed");

  const artifact = raw.artifact;
  if (!isPlainObject(artifact) || artifact.state !== "complete") return fail("artifact_incomplete");

  const display = raw.display;
  if (!isPlainObject(display)) return fail("invalid_display");
  const kind = display.kind;
  if (typeof kind !== "string" || !(SHOWCASE_KINDS as readonly string[]).includes(kind)) return fail("invalid_display");

  const imageRaw = display.image;
  if (!isPlainObject(imageRaw)) return fail("invalid_image");
  const src = publicAssetUrl(imageRaw.src, IMAGE_EXT, origins) ?? fail("invalid_image");
  const image: ShowcaseImage = Object.freeze({ src, width: dimension(imageRaw.width), height: dimension(imageRaw.height) });

  let media: ShowcaseMedia = null;
  const mediaRaw = artifact.media;
  if (mediaRaw !== undefined && mediaRaw !== null) {
    if (!isPlainObject(mediaRaw) || (mediaRaw.kind !== "video" && mediaRaw.kind !== "audio")) return fail("invalid_media");
    const mediaKind = mediaRaw.kind;
    const mediaSrc = publicAssetUrl(mediaRaw.src, MEDIA_EXT[mediaKind], origins) ?? fail("invalid_media");
    media = Object.freeze({ kind: mediaKind, src: mediaSrc });
  }

  const work: ShowcaseWork = Object.freeze({
    id,
    title: text(display.title, TEXT_LIMITS.title),
    subtitle: text(display.subtitle, TEXT_LIMITS.subtitle),
    creator: text(display.creator, TEXT_LIMITS.creator),
    kind: kind as ShowcaseKind,
    genre: text(display.genre, TEXT_LIMITS.genre),
    format: text(display.format, TEXT_LIMITS.format),
    description: text(display.description, TEXT_LIMITS.description),
    image,
    // 실제 승인 대상만 이 변환을 지나므로 예시 표시는 항상 false다.
    sample: false,
    media,
  });
  return { work, approvedAt };
}

// 원자료 목록 → 공개 화면 자료. 하나라도 조건이 빠지면 그 작품만 빼고, 이유 코드만 남긴다.
// 순서: 승인 시각 최신순, 같으면 id 순.
export function toPublishedWorks(records: unknown, policy: PublishedWorksPolicy = {}): PublishedWorksResult {
  const limitInput = policy.limit ?? DEFAULT_LIMIT;
  const limit = Number.isInteger(limitInput) ? Math.min(Math.max(limitInput, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const nowTime = policy.now instanceof Date && Number.isFinite(policy.now.getTime()) ? policy.now.getTime() : Date.now();
  const origins = normalizeOrigins(policy.allowedOrigins);
  if (!Array.isArray(records)) return Object.freeze({ works: Object.freeze([]), excluded: Object.freeze([Object.freeze({ index: -1, reason: "invalid_record" as const })]), truncated: false });

  const accepted: { work: ShowcaseWork; approvedAt: number }[] = [];
  const excluded: { index: number; reason: ExclusionReason }[] = [];
  const seen = new Set<string>();
  const scan = Math.min(records.length, MAX_INPUT);
  for (let index = 0; index < scan; index++) {
    try {
      const result = convert(records[index], origins, nowTime);
      if (seen.has(result.work.id)) fail("duplicate_id");
      seen.add(result.work.id);
      accepted.push(result);
    } catch (error) {
      // 원자료의 getter 등이 던진 다른 오류도 닫는다(내용은 남기지 않는다).
      excluded.push(Object.freeze({ index, reason: error instanceof Excluded ? error.reason : "invalid_record" }));
    }
  }
  accepted.sort((a, b) => b.approvedAt - a.approvedAt || (a.work.id < b.work.id ? -1 : a.work.id > b.work.id ? 1 : 0));
  const truncated = accepted.length > limit || records.length > MAX_INPUT;
  return Object.freeze({ works: Object.freeze(accepted.slice(0, limit).map((item) => item.work)), excluded: Object.freeze(excluded), truncated });
}
