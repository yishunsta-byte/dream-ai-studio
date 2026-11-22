import { describe, expect, it } from "vitest";
import { mutationStage } from "@/components/admin/admin-style-dna-workflow";
import { paletteFromRgba, parseStudioStyleDna, studioView } from "@/components/admin/style-dna-original/studio-data";
import type { StyleDnaRecord } from "@/lib/reference-analysis/style-dna-contract";

// P1-06 원본 분석 화면 1단계: 서버(1d7ee8d) 선택 응답 record.styleDna·revisions[].styleDna를 화면 값으로 바꾸는 규칙.
const media = { mime: "image/webp" as const, width: 640, height: 400, sha256: "a".repeat(64), palette: [{ hex: "#1F6F6A", share: 0.625 }, { hex: "#F2E8D5", share: 0.375 }], href: "/x" };
const cell = (description: string) => ({ certainty: "estimated", description, basis: `${description} 근거` });
const row = (label: string) => ({ label, description: `${label} 설명`, basis: `${label} 근거` });
const semantic = { status: "ready", provider: "gemini", prompts: { en: "semantic en", ko: "의미 한글" }, findings: [
  { category: "people", certainty: "estimated", description: "한 사람", basis: "가운데 인물" }, { category: "objects", certainty: "unconfirmed" },
  { category: "actions", certainty: "unconfirmed" }, { category: "context", certainty: "estimated", description: "도시 밤거리", basis: "간판 불빛" },
  { category: "composition", certainty: "estimated", description: "삼분할", basis: "인물 위치" }, { category: "lighting", certainty: "estimated", description: "측면광", basis: "그림자 방향" }] };
const base = (extra: Record<string, unknown> = {}, revisions: Record<string, unknown>[] = [{}]) => ({
  id: "0190b0b0-0000-7000-8000-00000000b001", title: "보관된 도심 인물 사진", revision: revisions.length, mode: "replicate", original: media,
  createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z", options: {}, result: {}, semantic, tests: [],
  revisions: revisions.map((item, index) => ({ revision: index + 1, prompts: { en: `en v${index + 1}`, ko: `ko v${index + 1}` }, createdAt: "2026-11-22T00:00:00.000Z", ...item })),
  ...extra }) as unknown as StyleDnaRecord;

describe("P1-06 원본 분석 화면 값", () => {
  it("확장 없는 이전 기록: 카메라·조명·DNA·일치율·키워드·팁은 비우고, 청사진·스타일은 의미 분석으로, 팔레트는 서버 실측 비율로", () => {
    const view = studioView(base());
    expect([view.camera, view.lighting, view.bars, view.matchRate, view.keywords, view.tips]).toEqual([undefined, undefined, [], null, [], []]);
    expect(view.titles).toEqual({ ko: "보관된 도심 인물 사진", en: undefined });
    expect(view.blueprint).toEqual({ source: "semantic", rows: [
      { label: "구도", description: "삼분할", basis: "인물 위치" }, { label: "인물", description: "한 사람", basis: "가운데 인물" },
      { label: "사물", unconfirmed: true }, { label: "동작", unconfirmed: true }] });
    expect(view.style.rows.map(item => item.label)).toEqual(["조명", "맥락"]);
    expect(view.palette).toEqual([{ hex: "#1F6F6A", percent: 62.5 }, { hex: "#F2E8D5", percent: 37.5 }]);
    expect([view.revision, view.prompts]).toEqual([1, { en: "en v1", ko: "ko v1" }]);
  });

  it("styleDna는 묶음·항목마다 따로 읽는다: 틀린 항목만 빠지고, 빠진 칸 키는 미확인, 0점은 유효, 꺾쇠·한도 초과는 버림", () => {
    const parsed = parseStudioStyleDna({
      schemaVersion: 1, titles: { ko: "네온 밤", en: "<b>Neon</b>" },
      camera: { angle: cell("로우 앵글"), lens: { certainty: "estimated", description: "35mm" }, shotType: { certainty: "unconfirmed" } },
      lighting: "틀린 값", blueprint: [row("전경"), { label: "x" }, row("배경")], style: [row("a"), row("b"), row("c"), row("d"), row("e"), row("f")],
      tips: ["팁 하나", "", "x".repeat(481)], keywords: ["neon", "k".repeat(41)],
      dna: [{ label: "색", score: 0, source: "model_estimate" }, { label: "질감", score: 101, source: "model_estimate" }, { label: "빛", score: 70 }],
      matchRate: { score: 88.25, source: "model_estimate" },
    });
    expect(parsed?.titles).toEqual({ ko: "네온 밤", en: undefined });
    expect(parsed?.camera).toEqual({ angle: { certainty: "estimated", description: "로우 앵글", basis: "로우 앵글 근거" }, lens: { certainty: "unconfirmed" }, shotType: { certainty: "unconfirmed" } });
    expect(parsed?.lighting).toBeUndefined();
    expect(parsed?.blueprint?.map(item => item.label)).toEqual(["전경", "배경"]);
    expect(parsed?.style?.map(item => item.label)).toEqual(["a", "b", "c", "d", "e"]);
    expect([parsed?.tips, parsed?.keywords, parsed?.dna, parsed?.matchRate]).toEqual([["팁 하나"], ["neon"], [{ label: "색", score: 0 }], 88.25]);
    expect(parseStudioStyleDna({ schemaVersion: 2, titles: { ko: "x" } })).toBeUndefined();
    expect(parseStudioStyleDna(null)).toBeUndefined();
  });

  it("보정 버전은 바뀐 목록만 덮고 나머지는 가까운 이전 값을 이어받으며, 버전마다 다시 열 수 있다", () => {
    const record = base({ styleDna: { schemaVersion: 1, blueprint: [row("최초 청사진")], style: [row("최초 스타일")], camera: { angle: cell("하이 앵글") } } },
      [{}, { feedback: "배경 단순하게", styleDna: { blueprint: [row("v2 청사진")] } }, { feedback: "더 따뜻하게", styleDna: { style: [row("v3 스타일")] } }, { feedback: "그대로" }]);
    const pick = (revision?: number) => { const view = studioView(record, revision); return [view.revision, view.blueprint.rows[0].label, view.blueprint.source, view.style.rows[0].label, view.style.source, view.prompts.en]; };
    expect(pick(1)).toEqual([1, "최초 청사진", "styleDna", "최초 스타일", "styleDna", "en v1"]);
    expect(pick(2)).toEqual([2, "v2 청사진", "revision", "최초 스타일", "styleDna", "en v2"]);
    expect(pick(3)).toEqual([3, "v2 청사진", "revision", "v3 스타일", "revision", "en v3"]);
    expect(pick()).toEqual([4, "v2 청사진", "revision", "v3 스타일", "revision", "en v4"]);
    expect(studioView(record).camera?.angle).toEqual({ certainty: "estimated", description: "하이 앵글", basis: "하이 앵글 근거" });
  });

  it("브라우저 미리 추출은 원본 paletteFromRgba와 같다: 투명 제외, 거리 60 미만은 합침, 합계 100", () => {
    const px = (r: number, g: number, b: number, a = 255, n = 1) => Array.from({ length: n }, () => [r, g, b, a]).flat();
    const data = [...px(250, 10, 10, 255, 60), ...px(245, 12, 14, 255, 10), ...px(10, 10, 250, 255, 30), ...px(0, 255, 0, 0, 500)];
    expect(paletteFromRgba(data)).toEqual([{ hex: "#F90A0B", percent: 70 }, { hex: "#0A0AFA", percent: 30 }]);
    expect(paletteFromRgba([0, 0, 0, 0])).toEqual([]);
    expect(paletteFromRgba(px(1, 2, 3, 255, 3)).reduce((sum, item) => sum + item.percent, 0)).toBe(100);
  });

  it("변형 강도 단계 이름은 원본 그대로(30·70 경계)", () => {
    expect([0, 30, 31, 70, 71, 100].map(level => mutationStage(level).full)).toEqual([
      "안정 (원본 스타일 충실)", "안정 (원본 스타일 충실)", "조화 (스타일 변형·응용)", "조화 (스타일 변형·응용)", "파격 (과감한 재해석)", "파격 (과감한 재해석)"]);
  });
});
