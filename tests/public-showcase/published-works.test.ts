import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_MEDIA_PREFIXES, publicAssetUrl, toPublishedWorks, type PublishedWorksPolicy } from "@/lib/public-showcase/published-works";
import { filterWorks } from "@/lib/public-showcase/works";

// T-249 공개 승인 작품 변환. 순수 함수 시험이며 DB·파일·Supabase·네트워크를 쓰지 않는다.
// 기대값 근거: 명시 published + 승인 시각 + 공개 권리 확인 + 완료 결과물이 모두 있을 때만 통과, 공개 칸만 새 객체로 옮김.
const NOW = new Date("2026-11-18T08:00:00Z");
const CDN = "https://cdn.dream.test";
const policy: PublishedWorksPolicy = { allowedOrigins: [CDN], now: NOW };

type Raw = Record<string, unknown>;
function record(overrides: { id?: unknown; publication?: Raw; artifact?: Raw; display?: Raw; extra?: Raw } = {}): Raw {
  return {
    id: overrides.id ?? "night-drive",
    ownerId: "00000000-0000-4000-8000-000000000001",
    ownerEmail: "owner@example.com",
    storagePath: "projects/abc/private/render-final.mp4",
    signedUrl: "https://cdn.dream.test/storage/v1/object/sign/private/x.mp4?token=secret-token",
    publication: { state: "published", approvedAt: "2026-11-17T10:00:00Z", approvedBy: "admin-1", rightsConfirmed: true, ...overrides.publication },
    artifact: { state: "complete", media: { kind: "video", src: "/media/public/night-drive.mp4" }, internalPath: "D:/work/x.mp4", ...overrides.artifact },
    display: {
      title: "NIGHT DRIVE", subtitle: "밤의 도로", creator: "DREAM CREW", kind: "영상", genre: "신스웨이브", format: "뮤직 필름",
      description: "승인된 공개 작품이에요.", image: { src: "/showcase/published/night-drive.png", width: 1672, height: 941 }, ...overrides.display,
    },
    ...overrides.extra,
  };
}
const reasons = (records: unknown[], p: PublishedWorksPolicy = policy) => toPublishedWorks(records, p).excluded.map((item) => item.reason);

describe("T-249 통과: 명시 승인 + 권리 확인 + 완료 결과물", () => {
  it("공개 칸만 새 객체로 옮기고 sample은 false, 원자료의 소유자·메일·내부 경로·서명 주소는 없다", () => {
    const result = toPublishedWorks([record()], policy);
    expect(result.excluded).toEqual([]);
    expect(result.works).toHaveLength(1);
    const work = result.works[0];
    expect(Object.keys(work).sort()).toEqual(["creator", "description", "format", "genre", "id", "image", "kind", "media", "sample", "subtitle", "title"]);
    expect(work).toEqual({
      id: "night-drive", title: "NIGHT DRIVE", subtitle: "밤의 도로", creator: "DREAM CREW", kind: "영상", genre: "신스웨이브", format: "뮤직 필름",
      description: "승인된 공개 작품이에요.", image: { src: "/showcase/published/night-drive.png", width: 1672, height: 941 }, sample: false,
      media: { kind: "video", src: "/media/public/night-drive.mp4" },
    });
    const json = JSON.stringify(result);
    for (const leak of ["owner@example.com", "00000000-0000-4000", "projects/abc", "token", "sign/", "D:/work", "admin-1", "approvedAt", "rightsConfirmed"]) expect(json, leak).not.toContain(leak);
    expect(Object.isFrozen(result.works)).toBe(true);
    expect(Object.isFrozen(work) && Object.isFrozen(work.image) && Object.isFrozen(work.media)).toBe(true);
  });

  it("허용한 https 출처의 공개 파일, 미디어 없는 완료 작품, 기존 검색과 함께 쓴다", () => {
    const result = toPublishedWorks([
      record({ id: "cdn-work", artifact: { media: { kind: "audio", src: `${CDN}/public/works/cdn-work.mp3` } }, display: { image: { src: `${CDN}/public/works/cdn-work.webp`, width: 1254, height: 1254 } } }),
      record({ id: "still-work", artifact: { media: null } }),
    ], policy);
    expect(result.excluded).toEqual([]);
    expect(result.works.map((work) => [work.id, work.media?.src ?? null])).toEqual([["cdn-work", `${CDN}/public/works/cdn-work.mp3`], ["still-work", null]]);
    expect(filterWorks(result.works, "전체", "dream crew")).toHaveLength(2);
  });

  it("승인 시각 최신순(같으면 id 순), 개수 제한과 잘림 표시", () => {
    const items = [
      record({ id: "b-old", publication: { approvedAt: "2026-11-01T00:00:00Z" } }),
      record({ id: "z-new", publication: { approvedAt: "2026-11-18T07:59:59Z" } }),
      record({ id: "a-new", publication: { approvedAt: "2026-11-18T16:59:59+09:00" } }),
    ];
    expect(toPublishedWorks(items, policy).works.map((work) => work.id)).toEqual(["a-new", "z-new", "b-old"]);
    const limited = toPublishedWorks(items, { ...policy, limit: 2 });
    expect([limited.works.length, limited.truncated]).toEqual([2, true]);
    expect(toPublishedWorks(items, { ...policy, limit: 0 }).works).toHaveLength(1);
    expect(toPublishedWorks(items, { ...policy, limit: 1.5 }).works).toHaveLength(3);
    expect(toPublishedWorks(items, { ...policy, limit: 10_000 }).truncated).toBe(false);
  });
});

describe("T-249 닫힘: 승인·권리·완료 근거가 없으면 제외", () => {
  it("발행 상태가 정확히 published가 아니면 제외(초안·검토 중·대소문자·누락)", () => {
    for (const state of ["draft", "review", "approved", "Published", "", undefined, true]) expect(reasons([record({ publication: { state } })]), String(state)).toEqual(["not_published"]);
    expect(reasons([{ ...record(), publication: undefined }])).toEqual(["not_published"]);
  });
  it("승인 시각이 없거나 형식이 틀리거나 미래면 제외", () => {
    for (const approvedAt of [undefined, null, "", "2026-11-17", "yesterday", 1731830400000, "2026-13-40T00:00:00Z", "2026-11-18T08:00:01Z"]) expect(reasons([record({ publication: { approvedAt } })]), String(approvedAt)).toEqual(["not_approved"]);
  });
  it("공개 권리 확인은 정확히 true만, 철회 표시가 있으면 제외", () => {
    for (const rightsConfirmed of [undefined, false, "true", 1, null]) expect(reasons([record({ publication: { rightsConfirmed } })]), String(rightsConfirmed)).toEqual(["rights_unconfirmed"]);
    expect(reasons([record({ publication: { revokedAt: "2026-11-18T00:00:00Z" } })])).toEqual(["revoked"]);
  });
  it("결과물이 완료가 아니면 제외(렌더 중·실패·누락)", () => {
    for (const state of ["rendering", "failed", "queued", "Complete", undefined]) expect(reasons([record({ artifact: { state } })]), String(state)).toEqual(["artifact_incomplete"]);
  });
  it("원자료 모양이 틀리면 제외하고 목록이 아니면 빈 결과", () => {
    expect(reasons([null, "x", 3, [], new Date(), Object.assign(Object.create({ evil: 1 }), record())])).toEqual(Array(6).fill("invalid_record"));
    const throwing = Object.defineProperty(record(), "publication", { get() { throw new Error("secret detail"); }, enumerable: true });
    const result = toPublishedWorks([throwing], policy);
    expect(result.excluded).toEqual([{ index: 0, reason: "invalid_record" }]);
    expect(JSON.stringify(result)).not.toContain("secret detail");
    for (const input of [undefined, null, {}, "[]"]) expect(toPublishedWorks(input, policy)).toEqual({ works: [], excluded: [{ index: -1, reason: "invalid_record" }], truncated: false });
  });
  it("id는 공개용 짧은 이름만, 중복은 뒤쪽을 제외", () => {
    for (const id of ["", "Night", "a_b", "-a", "a-", "../x", "a/b", "x".repeat(65), 7]) expect(reasons([record({ id })]), String(id)).toEqual(["invalid_id"]);
    expect(reasons([record(), record()])).toEqual(["duplicate_id"]);
  });
});

describe("T-249 노출 방지: 표시 글·공개 주소 계약", () => {
  it("표시 글은 칸마다 길이·제어 문자·메일 주소를 막고, 종류는 정해 둔 값만", () => {
    for (const display of [{ title: "" }, { title: "   " }, { title: "x".repeat(81) }, { creator: "owner@example.com" }, { description: "연락: a.b@mail.example.kr" }, { subtitle: "줄\n바꿈" }, { genre: "\u2028" }, { format: 3 }, { kind: "드라마" }, { kind: undefined }])
      expect(reasons([record({ display })]), JSON.stringify(display)).toEqual(["invalid_display"]);
    for (const display of [{ genre: String.fromCharCode(0x2029) }, { format: String.fromCharCode(0x85) }, { title: `a${String.fromCharCode(0)}b` }]) expect(reasons([record({ display })]), JSON.stringify(display)).toEqual(["invalid_display"]);
    // 숫자·한글·기호가 섞인 보통 글은 통과한다.
    expect(reasons([record({ display: { title: "NIGHT DRIVE 2029 · Vol.10", subtitle: "0시 20분 8초, 9번 국도", genre: "K-팝 2.0" } })])).toEqual([]);
  });
  it("이미지 주소·크기가 계약 밖이면 제외", () => {
    const bad = [
      "/projects/abc/thumb.png", "/showcase/../private/x.png", "/showcase/a%2e%2e/x.png", "/showcase/x.png?token=1", "/showcase/x.png#a", "//evil.test/showcase/x.png",
      "/showcase/x.svg", "/showcase/private/x.png", "/showcase/x .png", "/showcase\\x.png", " /showcase/x.png",
      "javascript:alert(1)", "data:image/png;base64,AAAA", "file:///C:/x.png", "http://cdn.dream.test/public/x.png", "https://evil.test/public/x.png",
      "https://user:pass@cdn.dream.test/public/x.png", `${CDN}/public/x.png?X-Amz-Signature=abc`, `${CDN}/storage/v1/object/sign/public/x.png`,
      `${CDN}/storage/v1/object/authenticated/x.png`, `${CDN}:443/public/x.png`, "https://CDN.dream.test/public/x.png", `${CDN}/public/%78.png`,
    ];
    for (const src of bad) expect(reasons([record({ display: { image: { src, width: 10, height: 10 } } })]), src).toEqual(["invalid_image"]);
    for (const size of [{ width: 0, height: 10 }, { width: 10.5, height: 10 }, { width: 10, height: 9000 }, { width: "10", height: 10 }]) expect(reasons([record({ display: { image: { src: "/showcase/x.png", ...size } } })])).toEqual(["invalid_image"]);
  });
  it("미디어 주소·종류가 계약 밖이면 작품째 제외(조용히 빼지 않음)", () => {
    const bad: unknown[] = [{ kind: "video", src: "/media/public/x.mp3" }, { kind: "audio", src: "/media/public/x.mp4" }, { kind: "image", src: "/media/public/x.mp4" }, { kind: "video", src: "/media/private/x.mp4" }, { kind: "video", src: `${CDN}/storage/v1/object/sign/x.mp4?token=t` }, { kind: "video" }, "x", []];
    for (const media of bad) expect(reasons([record({ artifact: { media } })]), JSON.stringify(media)).toEqual(["invalid_media"]);
  });
  it("정책 출처는 https 정확한 출처만 쓰고, 출처가 없으면 같은 사이트 공개 경로만", () => {
    const cdnImage = { display: { image: { src: `${CDN}/public/x.png`, width: 10, height: 10 } } };
    expect(reasons([record(cdnImage)], { now: NOW })).toEqual(["invalid_image"]);
    for (const origin of ["http://cdn.dream.test", `${CDN}/public`, "https://u:p@cdn.dream.test", "cdn.dream.test", `${CDN}?a=1`]) expect(reasons([record(cdnImage)], { now: NOW, allowedOrigins: [origin] }), origin).toEqual(["invalid_image"]);
    expect(reasons([record(cdnImage)], { now: NOW, allowedOrigins: [`${CDN}/`] })).toEqual([]);
    expect(PUBLIC_MEDIA_PREFIXES).toEqual(["/showcase/", "/media/public/"]);
    expect(publicAssetUrl("/showcase/a/b-1.png", /\.png$/, new Set())).toBe("/showcase/a/b-1.png");
  });
});

describe("T-249-FIX 검수 지적 보완", () => {
  it("F249-1 승인 시각은 원문의 실제 달력 날짜만: 평년 2/29·4/31·13월·0일·24:00·61초·잘못된 시간대는 제외", () => {
    for (const approvedAt of ["2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2025-13-01T00:00:00Z", "2025-00-10T00:00:00Z", "2025-06-00T00:00:00Z", "2025-06-31T00:00:00Z",
      "2026-11-17T24:00:00Z", "2026-11-17T23:60:00Z", "2026-11-17T23:59:60Z", "2026-11-17T10:00:00+24:00", "2026-11-17T10:00:00+09:60", "1900-02-29T00:00:00Z"])
      expect(reasons([record({ publication: { approvedAt } })]), approvedAt).toEqual(["not_approved"]);
  });
  it("F249-1 정상 값은 그대로: 윤일·연말·밀리초·시간대 동치(같은 순간은 id 순)", () => {
    const ok = ["2024-02-29T23:59:59Z", "2000-02-29T00:00:00Z", "2025-12-31T23:59:59.999Z", "2026-11-17T23:59:59-05:00", "2026-11-18T16:59:59+09:00"];
    for (const approvedAt of ok) expect(reasons([record({ publication: { approvedAt } })]), approvedAt).toEqual([]);
    const same = toPublishedWorks([
      record({ id: "b-utc", publication: { approvedAt: "2026-11-17T15:00:00Z" } }),
      record({ id: "a-kst", publication: { approvedAt: "2026-11-18T00:00:00+09:00" } }),
      record({ id: "c-leap", publication: { approvedAt: "2024-02-29T12:00:00Z" } }),
    ], policy);
    expect(same.works.map((work) => work.id)).toEqual(["a-kst", "b-utc", "c-leap"]);
  });
  it("FIX2 0000~0099년도 원문 달력 그대로: 윤일 0000/0004 통과, 평년 윤일·잘못된 날·24:00 제외, 시간대 동치 유지", () => {
    for (const approvedAt of ["0000-02-29T00:00:00Z", "0004-02-29T12:00:00Z", "0001-01-01T00:00:00Z", "0099-12-31T23:59:59Z", "0050-06-30T23:59:59.5Z", "0001-01-01T09:00:00+09:00", "0099-12-31T18:59:59-05:00"])
      expect(reasons([record({ publication: { approvedAt } })]), approvedAt).toEqual([]);
    for (const approvedAt of ["0001-02-29T00:00:00Z", "0100-02-29T00:00:00Z", "0099-04-31T00:00:00Z", "0099-00-01T00:00:00Z", "0001-01-00T00:00:00Z", "0004-02-30T00:00:00Z", "0000-01-01T24:00:00Z", "0099-12-31T23:59:60Z"])
      expect(reasons([record({ publication: { approvedAt } })]), approvedAt).toEqual(["not_approved"]);
    expect(reasons([record({ publication: { approvedAt: "0400-02-29T00:00:00Z" } })])).toEqual([]);
    const same = toPublishedWorks([
      record({ id: "b-utc", publication: { approvedAt: "0001-01-01T00:00:00Z" } }),
      record({ id: "a-kst", publication: { approvedAt: "0001-01-01T09:00:00+09:00" } }),
      record({ id: "c-old", publication: { approvedAt: "0000-02-29T00:00:00Z" } }),
    ], policy);
    expect(same.works.map((work) => work.id)).toEqual(["a-kst", "b-utc", "c-old"]);
  });
  it("F249-2 내보낸 공개 경로 목록은 런타임에도 바꿀 수 없고, 바꾸려 해도 허용 범위가 그대로", () => {
    expect(Object.isFrozen(PUBLIC_MEDIA_PREFIXES)).toBe(true);
    const list = PUBLIC_MEDIA_PREFIXES as unknown as string[];
    expect(() => list.push("/projects/")).toThrow(TypeError);
    expect(() => { list[0] = "/"; }).toThrow(TypeError);
    expect(PUBLIC_MEDIA_PREFIXES).toEqual(["/showcase/", "/media/public/"]);
    expect(reasons([record({ display: { image: { src: "/projects/demo/a.png", width: 10, height: 10 } } })])).toEqual(["invalid_image"]);
    expect(publicAssetUrl("/projects/demo/a.png", /\.png$/, new Set())).toBeNull();
  });
  it("F249-3 제어·줄 구분 문자는 양 끝에 있어도 원문째 거절, 보통 공백만 다듬는다", () => {
    const ends = ["\n", "\r", "\t", String.fromCharCode(0x2028), String.fromCharCode(0x2029), String.fromCharCode(0x85), String.fromCharCode(0)];
    for (const mark of ends) {
      expect(reasons([record({ display: { title: `${mark}Night` } })]), JSON.stringify(mark)).toEqual(["invalid_display"]);
      expect(reasons([record({ display: { creator: `DREAM${mark}` } })]), JSON.stringify(mark)).toEqual(["invalid_display"]);
    }
    expect(toPublishedWorks([record({ display: { title: "  Night  " } })], policy).works[0].title).toBe("Night");
  });
});

describe("T-249 범위", () => {
  it("DB·파일·Supabase·네트워크·화면 연결 없이 works.ts는 import만", () => {
    const source = readFileSync(resolve(__dirname, "../../lib/public-showcase/published-works.ts"), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports).toEqual(["@/lib/public-showcase/works"]);
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\(|supabase|node:fs|process\.env|"use client"/i);
    expect(code).not.toMatch(/sample:\s*true/);
  });
});
