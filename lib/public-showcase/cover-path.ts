// T-254 공개 커버 이미지 주소 판정(순수 함수). proxy와 이미지 route가 같은 판정을 쓴다.
// Node 전용 모듈을 가져오지 않는다(proxy에서도 실행되기 때문).
//
// 정규형은 하나뿐이다: /media/public/<slug>/<generation>/cover.webp
// - slug: T-249 작품 id·T-253 slots.slug CHECK와 같은 소문자 ASCII 규칙(최대 64자), 예약어 4개 제외
// - generation: 1 이상 signed BIGINT(9223372036854775807) 이하, 선행 0 없는 ASCII 십진 문자열.
//   JS 숫자로 바꾸지 않고 문자열 그대로 비교·전달한다(정밀도 손실 방지).
// 쿼리·조각·퍼센트 인코딩·중복 구분자·역슬래시·점 경로·대문자·후행 슬래시·다른 파일명은 모두 정규형이 아니다.

export const COVER_FILE = "cover.webp";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED = new Set(["sign", "authenticated", "private", "signed"]);
const GENERATION = /^[1-9][0-9]{0,18}$/;
const MAX_BIGINT = "9223372036854775807";
// "/media/public/" + 64 + "/" + 19 + "/cover.webp"
const MAX_PATH = 14 + 64 + 1 + 19 + 1 + COVER_FILE.length;

export type CoverAddress = Readonly<{ slug: string; generation: string }>;

export function isCoverSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value) && !RESERVED.has(value);
}

export function isCoverGeneration(value: unknown): value is string {
  return typeof value === "string" && GENERATION.test(value) && (value.length < MAX_BIGINT.length || value <= MAX_BIGINT);
}

// pathname만 받는다. 쿼리 유무는 호출하는 쪽이 따로 확인한다(proxy·route 모두 search === "" 요구).
export function parseCoverPath(pathname: unknown): CoverAddress | null {
  if (typeof pathname !== "string" || pathname.length > MAX_PATH) return null;
  const parts = pathname.split("/");
  if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "media" || parts[2] !== "public" || parts[5] !== COVER_FILE) return null;
  const [, , , slug, generation] = parts;
  if (!isCoverSlug(slug) || !isCoverGeneration(generation)) return null;
  return Object.freeze({ slug, generation });
}

export function coverPath(address: CoverAddress): string {
  return `/media/public/${address.slug}/${address.generation}/${COVER_FILE}`;
}

// 정규 경로에서 허용하는 메서드는 GET·HEAD뿐이다. 나머지는 405(Allow: GET, HEAD).
export const COVER_ALLOW = "GET, HEAD";
export function isCoverReadMethod(method: string): method is "GET" | "HEAD" {
  return method === "GET" || method === "HEAD";
}
