import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COVER_ALLOW, coverPath, isCoverGeneration, isCoverReadMethod, isCoverSlug, parseCoverPath } from "@/lib/public-showcase/cover-path";

// T-254 공개 커버 주소 판정. 순수 함수 시험이며 서버·DB·Storage는 쓰지 않는다.
// 기대값 근거: 설계 c9d5674 §1(정규형 한 가지, GET·HEAD), T-253 slots.slug CHECK, PostgreSQL BIGINT 상한.
const root = resolve(__dirname, "../..");
const P = (slug: string, generation: string) => `/media/public/${slug}/${generation}/cover.webp`;

describe("T-254 정규 커버 주소", () => {
  it("정규형만 통과하고 slug·세대를 문자열 그대로 돌려준다", () => {
    for (const [slug, generation] of [["a", "1"], ["neon-after-hours", "42"], ["0", "9"], ["a".repeat(64), "9223372036854775807"], ["x-1-y", "1000000000000000000"]]) {
      const parsed = parseCoverPath(P(slug, generation));
      expect(parsed, `${slug}/${generation}`).toEqual({ slug, generation });
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(coverPath(parsed!)).toBe(P(slug, generation));
    }
  });

  it("비슷한 주소·별칭은 모두 정규형이 아니다", () => {
    const rejected = [
      "/media/public/a/1/cover.webp/", "/media/public/a/1/cover.WEBP", "/media/public/a/1/Cover.webp", "/media/public/A/1/cover.webp",
      "/media/public/a/1/cover.png", "/media/public/a/1/cover.webp.map", "/media/public/a/1/other.webp", "/media/public/a/1/",
      "/media/public/a/1", "/media/public/a", "/media/public/", "/media/public", "/media/x/a/1/cover.webp", "/MEDIA/public/a/1/cover.webp",
      "/media/Public/a/1/cover.webp", "//media/public/a/1/cover.webp", "/media//public/a/1/cover.webp", "/media/public//a/1/cover.webp",
      "/media/public/a//1/cover.webp", "/media/public/a/1//cover.webp", "/media/public/./a/1/cover.webp", "/media/public/a/./1/cover.webp",
      "/media/public/../public/a/1/cover.webp", "/media/public/a/1/../1/cover.webp", "/media/public/a%2F1/1/cover.webp", "/media/public/a/1/cover%2Ewebp",
      "/media/public/%61/1/cover.webp", "/media/public/a\\1/1/cover.webp", "\\media\\public\\a\\1\\cover.webp", "media/public/a/1/cover.webp",
      "/media/public/a/1/cover.webp?x=1", "/media/public/a/1/cover.webp#x", "/media/public/a/1/cover.webp ", " /media/public/a/1/cover.webp",
      "/media/public/a/1/extra/cover.webp", "/x/media/public/a/1/cover.webp", "/media/public/a/b/1/cover.webp",
    ];
    for (const path of rejected) expect(parseCoverPath(path), path).toBeNull();
    for (const value of [undefined, null, 1, {}, [], new String(P("a", "1"))]) expect(parseCoverPath(value)).toBeNull();
  });

  it("slug: T-249·T-253과 같은 소문자 ASCII 1~64자, 하이픈 끝 금지, 예약어 4개 제외", () => {
    for (const slug of ["", "-a", "a-", "A", "a_b", "a.b", "a b", "가", "a".repeat(65), "sign", "authenticated", "private", "signed"]) {
      expect(isCoverSlug(slug), slug).toBe(false);
      expect(parseCoverPath(P(slug, "1")), slug).toBeNull();
    }
    for (const slug of ["a--b", "signs", "private-1", "1"]) expect(isCoverSlug(slug), slug).toBe(true);
    const sql = readFileSync(resolve(root, "tests/fixtures/postgres/t253-showcase-publication.sql"), "utf8");
    expect(sql).toContain("slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'");
    expect(sql).toContain("slug NOT IN ('sign','authenticated','private','signed')");
    const works = readFileSync(resolve(root, "lib/public-showcase/published-works.ts"), "utf8");
    expect(works).toContain("const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;");
  });

  it("세대: 1 이상 BIGINT 상한 이하, 선행 0·부호·소수·공백 없음, JS 숫자 변환 없이 경계 판정", () => {
    for (const generation of ["1", "9", "10", "922337203685477580", "9223372036854775806", "9223372036854775807", "1000000000000000000"]) expect(isCoverGeneration(generation), generation).toBe(true);
    for (const generation of ["0", "00", "01", "-1", "+1", "1.0", "1e3", " 1", "1 ", "9223372036854775808", "9999999999999999999", "10000000000000000000", "", "a", "１"]) {
      expect(isCoverGeneration(generation), generation).toBe(false);
      expect(parseCoverPath(P("a", generation)), generation).toBeNull();
    }
    // 2^53 이상에서도 문자열이 그대로 유지된다.
    expect(parseCoverPath(P("a", "9007199254740993"))?.generation).toBe("9007199254740993");
  });

  it("메서드는 GET·HEAD만 읽기로 본다", () => {
    expect(COVER_ALLOW).toBe("GET, HEAD");
    for (const method of ["GET", "HEAD"]) expect(isCoverReadMethod(method)).toBe(true);
    for (const method of ["get", "head", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT", ""]) expect(isCoverReadMethod(method), method).toBe(false);
  });

  it("파서 모듈은 Node 전용 모듈·서버 전용 표시 없이 proxy에서 쓸 수 있다", () => {
    const source = readFileSync(resolve(root, "lib/public-showcase/cover-path.ts"), "utf8");
    expect([...source.matchAll(/^import\s/gm)]).toHaveLength(0);
    expect(source).not.toMatch(/server-only|node:|process\.env/);
  });
});
