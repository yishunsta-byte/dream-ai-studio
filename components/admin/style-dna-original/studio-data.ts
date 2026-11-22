import { z } from "zod";
import type { StyleDnaRecord, StyleDnaRevision } from "@/lib/reference-analysis/style-dna-contract";
import type { ImageSemanticFinding } from "@/lib/reference-analysis/image-semantic-result";

// P1-06 Style DNA 원본(v1.39) 분석 화면에 넣을 값. 원본의 예시값(96.5%·예시 막대·예시 키워드·예시 팔레트)은 쓰지 않는다.
// ① 선택형 record.styleDna(Backend msg_bb7205123f65 계약: schemaVersion 1)가 오면 그 값을, ② 없으면 지금 응답의 semantic·original.palette만 쓴다.
// 서버 응답에 없는 칸은 비워 두고 "분석 결과에 없음"을 밝힌다. 형식이 맞지 않는 styleDna는 통째로 무시한다(기존 기록도 그대로 열림).
// 서버(1d7ee8d style-dna-report.ts)와 같은 한도로 묶음마다·항목마다 따로 읽는다. 한 칸이 틀려도 나머지 보고서는 그대로 보이고, 틀린 항목만 빠진다.
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[<>\0]/.test(value));
const finding = z.object({ description: text(480), basis: text(240) });
const row = finding.extend({ label: text(80) });
const score = z.number().min(0).max(100);
export const cameraFields = [["angle", "앵글"], ["shotType", "샷 타입"], ["lens", "렌즈"], ["focusDistance", "초점 거리"], ["depthOfField", "피사계 심도"]] as const;
export const lightingFields = [["timeOfDay", "시간대"], ["direction", "조명 방향"], ["altitude", "고도"], ["contrast", "대비"], ["shadows", "그림자"]] as const;
export type StudioCell = { certainty: "estimated"; description: string; basis: string } | { certainty: "unconfirmed" };
export type StudioRow = { label: string; description?: string; basis?: string; unconfirmed?: boolean };
type CameraKey = (typeof cameraFields)[number][0];
type LightingKey = (typeof lightingFields)[number][0];

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function cells<Key extends string>(fields: readonly (readonly [Key, string])[], value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const raw = object(value);
  const out: Partial<Record<Key, StudioCell>> = {};
  for (const [key] of fields) {
    if (!Object.hasOwn(raw, key)) continue;
    const cell = object(raw[key]);
    const parsed = cell.certainty === "estimated" ? finding.safeParse(cell) : null;
    out[key] = parsed?.success ? { certainty: "estimated", ...parsed.data } : { certainty: "unconfirmed" };
  }
  return out;
}
function list<T>(value: unknown, schema: z.ZodType<T>, limit: number) {
  if (!Array.isArray(value)) return undefined;
  const items = value.slice(0, limit).flatMap(item => { const parsed = schema.safeParse(item); return parsed.success ? [parsed.data] : []; });
  return items.length ? items : undefined;
}
const estimate = (value: unknown) => { const raw = object(value); return raw.source === "model_estimate" ? score.safeParse(raw.score).data : undefined; };

export function parseStudioStyleDna(value: unknown) {
  const raw = object(value);
  if (raw.schemaVersion !== 1) return undefined;
  const titles = object(raw.titles);
  return {
    titles: { ko: text(80).safeParse(titles.ko).data, en: text(80).safeParse(titles.en).data },
    camera: cells(cameraFields, raw.camera) as Partial<Record<CameraKey, StudioCell>> | undefined,
    lighting: cells(lightingFields, raw.lighting) as Partial<Record<LightingKey, StudioCell>> | undefined,
    blueprint: list(raw.blueprint, row, 5),
    style: list(raw.style, row, 5),
    tips: list(raw.tips, text(480), 5),
    keywords: list(raw.keywords, text(40), 10),
    dna: list(raw.dna, z.unknown(), 6)?.flatMap(item => {
      const label = text(40).safeParse(object(item).label).data, value = estimate(item);
      return label !== undefined && value !== undefined ? [{ label, score: value }] : [];
    }),
    matchRate: estimate(raw.matchRate),
  };
}
export function parseRevisionSections(value: unknown) {
  const raw = object(value);
  return { blueprint: list(raw.blueprint, row, 5), style: list(raw.style, row, 5) };
}
const extra = (value: unknown, key: string): unknown => object(value)[key];
export const readStyleDna = (record: StyleDnaRecord) => parseStudioStyleDna(extra(record, "styleDna"));
export const readRevisionStyleDna = (revision: StyleDnaRevision | undefined) => revision ? parseRevisionSections(extra(revision, "styleDna")) : undefined;

const categoryNames: Record<ImageSemanticFinding["category"], string> = {
  composition: "구도", people: "인물", objects: "사물", actions: "동작", lighting: "조명", context: "맥락",
};
const fromFindings = (record: StyleDnaRecord, categories: ImageSemanticFinding["category"][]): StudioRow[] => {
  if (record.semantic.status === "unavailable") return [];
  return categories.flatMap((category): StudioRow[] => {
    const found = record.semantic.status !== "unavailable" ? record.semantic.findings.find(item => item.category === category) : undefined;
    if (!found) return [];
    return found.certainty === "estimated" ? [{ label: categoryNames[category], description: found.description, basis: found.basis }]
      : [{ label: categoryNames[category], unconfirmed: true }];
  });
};

/** 원본 분석 화면 한 장에 필요한 값. revision은 보정 버전(없으면 최신). */
export function studioView(record: StyleDnaRecord, revisionNumber?: number) {
  const dna = readStyleDna(record);
  const revision = record.revisions.find(item => item.revision === revisionNumber) ?? record.revisions.at(-1);
  // 보정 버전은 바뀐 목록만 가질 수 있어서(서버 1d7ee8d), 고른 버전부터 거꾸로 올라가며 각 목록의 가장 가까운 값을 이어받는다.
  const upTo = record.revisions.filter(item => !revision || item.revision <= revision.revision).sort((x, y) => y.revision - x.revision);
  const inherited = (key: "blueprint" | "style") => {
    for (const item of upTo) { const found = readRevisionStyleDna(item)?.[key]; if (found) return found; }
    return undefined;
  };
  const revised = { blueprint: inherited("blueprint"), style: inherited("style") };
  const prompts = revision?.prompts ?? (record.semantic.status !== "unavailable" ? record.semantic.prompts : {});
  return {
    revision: revision?.revision ?? 1,
    titles: { ko: dna?.titles.ko ?? record.title, en: dna?.titles.en },
    camera: dna?.camera,
    lighting: dna?.lighting,
    // 청사진·스타일: 보정 버전 값 → 최초 styleDna → 지금 응답의 의미 분석(청사진=구도·인물·사물·동작, 스타일=조명·맥락) 순서.
    blueprint: { rows: revised?.blueprint ?? dna?.blueprint ?? fromFindings(record, ["composition", "people", "objects", "actions"]),
      source: revised?.blueprint ? "revision" : dna?.blueprint ? "styleDna" : "semantic" } as const,
    style: { rows: revised?.style ?? dna?.style ?? fromFindings(record, ["lighting", "context"]),
      source: revised?.style ? "revision" : dna?.style ? "styleDna" : "semantic" } as const,
    tips: dna?.tips ?? [],
    // dna 막대는 0도 유효한 값(서버 계약: 명시적 0 유효)
    keywords: dna?.keywords ?? [],
    bars: dna?.dna ?? [],
    matchRate: dna?.matchRate ?? null,
    prompts: { ko: prompts.ko, en: prompts.en },
    palette: record.original.palette.map(color => ({ hex: color.hex, percent: Math.round(color.share * 1000) / 10 })),
    semanticUnavailable: record.semantic.status === "unavailable",
  };
}
export type StudioView = ReturnType<typeof studioView>;

/** 원본 lib/dna/palette.ts paletteFromRgba를 그대로 옮긴 브라우저 미리 추출(분석 전 파일 선택 때만). 채널당 4비트 묶음, 거리 60 이상 대표색 최대 5개, 합계 100. */
export function paletteFromRgba(data: ArrayLike<number>, count = 5) {
  type Bin = { count: number; r: number; g: number; b: number };
  const bins = new Map<number, Bin>();
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++; bin.r += r; bin.g += g; bin.b += b;
    bins.set(key, bin);
    total++;
  }
  if (!total) return [];
  const sorted = Array.from(bins.values()).map(bin => ({ ...bin, ar: bin.r / bin.count, ag: bin.g / bin.count, ab: bin.b / bin.count }))
    .sort((a, b) => b.count - a.count);
  const dist = (a: { ar: number; ag: number; ab: number }, b: { ar: number; ag: number; ab: number }) => Math.hypot(a.ar - b.ar, a.ag - b.ag, a.ab - b.ab);
  const centers: typeof sorted = [];
  for (const bin of sorted) {
    if (centers.every(center => dist(center, bin) >= 60)) centers.push(bin);
    if (centers.length >= count) break;
  }
  const groups = centers.map(() => ({ count: 0, r: 0, g: 0, b: 0 }));
  for (const bin of sorted) {
    let best = 0, bestD = Infinity;
    centers.forEach((center, index) => { const d = dist(center, bin); if (d < bestD) { bestD = d; best = index; } });
    const group = groups[best];
    group.count += bin.count; group.r += bin.r; group.g += bin.g; group.b += bin.b;
  }
  const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const out = groups.filter(group => group.count > 0)
    .map(group => ({ hex: `#${hex2(group.r / group.count)}${hex2(group.g / group.count)}${hex2(group.b / group.count)}`.toUpperCase(), share: group.count / total }))
    .sort((a, b) => b.share - a.share)
    .map(color => ({ hex: color.hex, percent: Math.round(color.share * 100) }));
  const diff = 100 - out.reduce((sum, color) => sum + color.percent, 0);
  if (out.length) out[0].percent += diff;
  return out.filter(color => color.percent > 0);
}

/** 고른 파일을 128px 캔버스로 읽어 미리 추출한다(서버 전송 없음). 실패하면 빈 목록. */
export async function previewPalette(url: string): Promise<{ hex: string; percent: number }[]> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 128 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 128) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 128) * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return paletteFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch { return []; }
}
