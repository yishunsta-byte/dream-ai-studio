// T-251/T-255 공개 메인 작품 목록 상태.
// 공개 메인("/")은 이 함수가 정한 상태만 그린다. 개인 프로젝트·DB 직접 조회·저장 파일·로그인 사용자 정보를 읽지 않는다.
//
// 상태 네 가지(설계 c9d5674 §5):
//   sample      명시적 예시 전용 모드(지금 운영). 예시 6개.
//   empty       공급원이 정상이고 활성 승인 작품이 0건. 예시 6개.
//   published   정상 승인 목록. 승인 작품만(예시와 섞지 않음), 최대 24건.
//   unavailable 설정 누락·권한·시간 초과·조회 실패·계약 오류. 예시로 숨기지 않고 장애 화면(로그인 링크 유지).
// 승인 여부·표시 문구·공개 주소 검사는 T-249 toPublishedWorks를 그대로 쓴다. 한 행이라도 빠지면 계약 오류다.
import "server-only";
import { toPublishedWorks } from "@/lib/public-showcase/published-works";
import { SHOWCASE_DISPLAY_LIMIT, SHOWCASE_FETCH_LIMIT, SHOWCASE_SOURCE, ShowcaseSourceError, fetchApprovedSnapshot, type ShowcaseFailure, type ShowcaseSource } from "@/lib/public-showcase/showcase-source";
import { SAMPLE_WORKS, type ShowcaseWork } from "@/lib/public-showcase/works";

export type ShowcaseFeed =
  | Readonly<{ state: "sample" | "empty"; works: readonly ShowcaseWork[] }>
  | Readonly<{ state: "published"; works: readonly ShowcaseWork[] }>
  | Readonly<{ state: "unavailable"; works: readonly ShowcaseWork[]; failure: ShowcaseFailure }>;

const NO_WORKS: readonly ShowcaseWork[] = Object.freeze([]);

function unavailable(failure: ShowcaseFailure, rows: number): ShowcaseFeed {
  // 서버 진단에는 안전한 분류 코드와 개수만 남긴다(원자료·주소·오류 원문 없음).
  console.error(`[showcase] unavailable code=${failure} rows=${rows}`);
  return Object.freeze({ state: "unavailable", works: NO_WORKS, failure });
}

export async function loadShowcaseFeed(source: ShowcaseSource = SHOWCASE_SOURCE, deadlineMs?: number): Promise<ShowcaseFeed> {
  if (source.mode === "sample") return Object.freeze({ state: "sample", works: SAMPLE_WORKS });
  let snapshot;
  try {
    snapshot = await fetchApprovedSnapshot(source.store, deadlineMs);
  } catch (error) {
    return unavailable(error instanceof ShowcaseSourceError ? error.code : "query", 0);
  }
  const rows = snapshot.records.length;
  if (rows === 0) return Object.freeze({ state: "empty", works: SAMPLE_WORKS });
  // 검사 한도는 25로 맞추고(제외·잘림·순서 어긋남은 모두 계약 오류), 표시는 상위 24건만.
  const result = toPublishedWorks(snapshot.records, { limit: SHOWCASE_FETCH_LIMIT, now: new Date(snapshot.nowMs) });
  const ids = result.works.map((work) => work.id);
  if (result.excluded.length > 0 || result.truncated || ids.length !== rows || ids.some((id, index) => id !== snapshot.ids[index])) {
    return unavailable("contract", rows);
  }
  return Object.freeze({ state: "published", works: Object.freeze(result.works.slice(0, SHOWCASE_DISPLAY_LIMIT)) });
}
