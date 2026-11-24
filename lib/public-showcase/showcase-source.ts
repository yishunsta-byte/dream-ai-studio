// T-255 공개 홈 승인 목록 공급원(서버 전용).
// T-253 list_approved()가 돌려주는 스냅숏 { nowMs, rows[] }를 받아 T-249 원자료 모양으로 옮긴다.
// 이 파일은 검증·변환만 한다. 실제 DB 연결(전용 목록 자격·풀러·TLS)은 후속 단계에서 store로 주입한다.
//
// 공급원 선택은 아래 SHOWCASE_SOURCE 하나뿐이다. 운영은 명시적 예시 모드다(공개 승인 저장소 미개통).
// 환경변수·요청 값으로 고르는 경로와 시험용 공개 우회는 두지 않는다. 합성 시험은 격리 사본·시험 주입으로만 한다.
import "server-only";
import { isPlaybackExtension, playbackFormats } from "./playback-path";
import { coverPath, isCoverGeneration, isCoverSlug } from "@/lib/public-showcase/cover-path";

// DB는 정렬된 상위 최대 25행을 준다. 25번째는 "더 있음" 확인용이며 같은 계약으로 검증한 뒤 상위 24건만 쓴다.
export const SHOWCASE_DISPLAY_LIMIT = 24;
export const SHOWCASE_FETCH_LIMIT = 25;
export const SHOWCASE_DEADLINE_MS = 3000;

export type ShowcaseListStore = Readonly<{
  // T-253 list_approved() 결과 jsonb 그대로. 조회 실패는 throw(권한 거부면 code "42501").
  listApproved(signal: AbortSignal): Promise<unknown>;
}>;
// sample: 명시적 예시 전용 모드. active인데 store가 없으면 설정 누락이다.
export type ShowcaseSource = Readonly<{ mode: "sample" }> | Readonly<{ mode: "active"; store: ShowcaseListStore | null }>;

export const SHOWCASE_SOURCE: ShowcaseSource = Object.freeze({ mode: "sample" });

// 장애 분류. 화면에는 보내지 않고 서버 진단에만 쓴다.
export type ShowcaseFailure = "config" | "permission" | "timeout" | "query" | "contract";

export class ShowcaseSourceError extends Error {
  constructor(readonly code: ShowcaseFailure) { super(`showcase source: ${code}`); }
}
const contract = (): never => { throw new ShowcaseSourceError("contract"); };

export type ApprovedSnapshot = Readonly<{
  nowMs: number;
  // T-249 toPublishedWorks 입력 모양. 순서는 DB 순서(approvedMs 내림차순, slug C 오름차순) 그대로.
  records: readonly Readonly<Record<string, unknown>>[];
  ids: readonly string[];
}>;

const MS = /^(0|[1-9][0-9]{0,15})$/;
const DISPLAY_KEYS = ["creator", "description", "format", "genre", "height", "kind", "subtitle", "title", "width"];
const ROW_KEYS = ["approvedMs", "display", "generation", "slug"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, index) => key === keys[index]);
}
function epochMs(value: unknown): number {
  if (typeof value !== "string" || !MS.test(value)) return contract();
  const ms = Number(value);
  return Number.isSafeInteger(ms) && ms <= 8_640_000_000_000_000 ? ms : contract();
}
function dimension(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4096 ? value : contract();
}

// 스냅숏 계약 검사. 어긋나면 ShowcaseSourceError("contract").
// 개별 표시 문구·종류의 세부 검사는 T-249 변환기가 같은 기준으로 다시 하며, 거기서 하나라도 빠지면 피드가 계약 오류로 닫는다.
export function readApprovedSnapshot(value: unknown): ApprovedSnapshot {
  if (!isPlainObject(value) || !exactKeys(value, ["nowMs", "rows"])) return contract();
  const nowMs = epochMs(value.nowMs);
  const rows = value.rows;
  if (!Array.isArray(rows) || rows.length > SHOWCASE_FETCH_LIMIT) return contract();
  const records: Readonly<Record<string, unknown>>[] = [];
  const ids: string[] = [];
  let previous: { ms: number; slug: string } | null = null;
  for (const row of rows) {
    if (!isPlainObject(row) || !(exactKeys(row, ROW_KEYS) || exactKeys(row, ["approvedMs", "display", "generation", "media", "slug"]))) return contract();
    const { slug, generation, display } = row;
    if (!isCoverSlug(slug) || !isCoverGeneration(generation)) return contract();
    const approvedMs = epochMs(row.approvedMs);
    if (approvedMs > nowMs) return contract();
    // DB 정렬과 같은지 확인: 승인 ms 내림차순, 같으면 slug ASCII 오름차순, 중복 없음.
    if (previous && (approvedMs > previous.ms || (approvedMs === previous.ms && !(slug > previous.slug)))) return contract();
    previous = { ms: approvedMs, slug };
    if (!isPlainObject(display) || !exactKeys(display, DISPLAY_KEYS)) return contract();
    let media = null;
    if (row.media !== null && row.media !== undefined) {
      if (!isPlainObject(row.media) || !exactKeys(row.media, ["ext", "kind"])) return contract();
      const { ext, kind } = row.media;
      if (!isPlaybackExtension(ext) || playbackFormats[ext].kind !== kind) continue;
      media = Object.freeze({ kind, src: `/media/public/${slug}/${generation}/play.${ext}` });
    }
    records.push(Object.freeze({
      id: slug,
      // 활성 행은 T-253 발행 명령이 동일 소유자·권리 근거·완료 사본을 확인한 뒤에만 생긴다.
      publication: Object.freeze({ state: "published", approvedAt: new Date(approvedMs).toISOString(), rightsConfirmed: true }),
      artifact: Object.freeze({ state: "complete", ...(media && { media }) }),
      display: Object.freeze({
        kind: display.kind, title: display.title, subtitle: display.subtitle, creator: display.creator,
        genre: display.genre, format: display.format, description: display.description,
        image: Object.freeze({ src: coverPath({ slug, generation }), width: dimension(display.width), height: dimension(display.height) }),
      }),
    }));
    ids.push(slug);
  }
  return Object.freeze({ nowMs, records: Object.freeze(records), ids: Object.freeze(ids) });
}

function classify(error: unknown): ShowcaseFailure {
  if (error instanceof ShowcaseSourceError) return error.code;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "42501" || code === "28000" || code === "28P01" ? "permission" : "query";
}

// 공급원에서 스냅숏을 읽는다. 매 요청마다 새로 조회한다(캐시 없음). 실패는 ShowcaseSourceError로 분류해 던진다.
export async function fetchApprovedSnapshot(store: ShowcaseListStore | null, deadlineMs: number = SHOWCASE_DEADLINE_MS): Promise<ApprovedSnapshot> {
  if (!store) throw new ShowcaseSourceError("config");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    // 먼저 시간 초과로 닫고 그다음 중단 신호를 보낸다(중단 신호를 받고 늦게 돌려준 결과가 이기지 않게).
    timer = setTimeout(() => { reject(new ShowcaseSourceError("timeout")); controller.abort(); }, deadlineMs);
  });
  let raw: unknown;
  try {
    raw = await Promise.race([store.listApproved(controller.signal), deadline]);
    if (controller.signal.aborted) throw new ShowcaseSourceError("timeout");
  } catch (error) {
    throw new ShowcaseSourceError(classify(error));
  } finally {
    clearTimeout(timer);
  }
  return readApprovedSnapshot(raw);
}
