// P1-08 쇼츠 검색 지표(Shorts Viral Studio v2.01 원본 lib/youtube/metrics.ts의 정의를 따름).
// V/S = 조회수 ÷ 구독자(구독자 비공개·0 또는 조회수 비공개면 판정불가). 등급: 10배↑ 초대박 · 5배↑ 대박 · 3배↑ 떡상 · 1배↑ 양호 · 그 밖 보통.
// VPH(시간당 조회수) = 조회수 ÷ 게시 후 지난 시간(최소 1시간, 원본과 같음). 기준 시각은 검색 응답을 받은 때다.
// 원본은 게시 시각이 기준보다 늦어도 1시간으로 셌지만, 여기서는 잘못된 시간으로 보고 계산하지 않는다(꾸며낸 지표를 보이지 않음).
// 모두 받은 공개 지표로만 계산한다(요청·모델 호출 없음).
export type ViralGrade = "초대박" | "대박" | "떡상" | "양호" | "보통" | "판정불가";
export type ShortsView = "search" | "ratio" | "vph";
type Metrics = { views: number | null; subscribers: number | null; publishedAt: string };

export const gradeRule = "등급 기준(조회수 ÷ 구독자): 초대박 10배 이상 · 대박 5배 이상 · 떡상 3배 이상 · 양호 1배 이상 · 그 밖 보통. 구독자나 조회수가 비공개면 판정불가예요.";

export function viewsPerSubscriber({ views, subscribers }: Pick<Metrics, "views" | "subscribers">) {
  return views === null || subscribers === null || subscribers <= 0 ? null : views / subscribers;
}

export function viralGrade(ratio: number | null): ViralGrade {
  if (ratio === null) return "판정불가";
  if (ratio >= 10) return "초대박";
  if (ratio >= 5) return "대박";
  if (ratio >= 3) return "떡상";
  if (ratio >= 1) return "양호";
  return "보통";
}

/** V/S의 10배를 정수로 버린 값(조회수·구독자는 정수라 BigInt로 정확히 나눈다). 판정불가면 null.
 * 화면의 배율 글자와 등급을 이 한 값에서 함께 정해, 부동소수 오차로 '5.0배'인데 떡상처럼 엇갈리지 않게 한다. */
export function vsTenths({ views, subscribers }: Pick<Metrics, "views" | "subscribers">) {
  if (views === null || subscribers === null || subscribers <= 0 || !Number.isSafeInteger(views) || !Number.isSafeInteger(subscribers)) return null;
  return BigInt(views) * 10n / BigInt(subscribers);
}

/** 원본 등급 경계(10·5·3·1배 이상)를 정확한 V/S로 판정한다. floor(10×V/S) ≥ 50 ⇔ V/S ≥ 5. */
export function vsGrade(tenths: bigint | null): ViralGrade {
  if (tenths === null) return "판정불가";
  if (tenths >= 100n) return "초대박";
  if (tenths >= 50n) return "대박";
  if (tenths >= 30n) return "떡상";
  if (tenths >= 10n) return "양호";
  return "보통";
}

/** 시간당 조회수. 조회수 비공개, 읽을 수 없는 시각, 기준 시각보다 늦은 게시 시각이면 null. */
export function viewsPerHour({ views, publishedAt }: Pick<Metrics, "views" | "publishedAt">, measuredAt: number) {
  const published = Date.parse(publishedAt);
  if (views === null || !Number.isFinite(published) || !Number.isFinite(measuredAt) || published > measuredAt) return null;
  return views / Math.max((measuredAt - published) / 3_600_000, 1);
}

const countFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const smallFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
// 배율은 소수 첫째 자리에서 버린다(4.99배를 '5.0배'로 보이면서 등급은 떡상인 엇갈림 방지. 원본은 toFixed(1) 반올림이었음).
export const ratioText = (tenths: bigint | null) => tenths === null ? "판정불가" : `${countFormat.format(tenths / 10n)}.${tenths % 10n}배`;
// 10회 미만은 소수 한 자리(버림)까지 보여 0.4회를 '0회'로 뭉개지 않는다.
export const vphText = (vph: number | null) => vph === null ? "계산 불가"
  : vph < 10 ? `${smallFormat.format(Math.floor(vph * 10) / 10)}회` : `${countFormat.format(Math.round(vph))}회`;

/** 받은 결과의 보기 순서만 바꾼다(검색 요청 없음). 계산할 수 없는 값은 뒤로, 같은 값은 원래 검색 순서를 지킨다. */
export function arrangeShorts<T extends Metrics>(items: readonly T[], view: ShortsView, measuredAt: number): T[] {
  if (view === "search") return [...items];
  const score = (item: T) => view === "ratio" ? viewsPerSubscriber(item) : viewsPerHour(item, measuredAt);
  return items.map((item, index) => ({ item, index, value: score(item) }))
    .sort((a, b) => a.value === b.value ? a.index - b.index : a.value === null ? 1 : b.value === null ? -1 : b.value - a.value || a.index - b.index)
    .map(row => row.item);
}
