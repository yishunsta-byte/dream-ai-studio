import { z } from "zod";

const cameraKeys = ["angle", "shotType", "lens", "focusDistance", "depthOfField"] as const;
const lightingKeys = ["timeOfDay", "direction", "altitude", "contrast", "shadows"] as const;
const text = (limit: number) => z.string().trim().min(1).max(limit).refine(value => !/[<>\0]/.test(value));
const finding = z.strictObject({ description: text(480), basis: text(240) });
const fact = finding.extend({ label: text(80) });
const score = z.number().min(0).max(100);
const scoredFact = z.strictObject({ label: text(40), score });

type Cell = { certainty: "estimated" } & z.infer<typeof finding> | { certainty: "unconfirmed" };
type Estimate = { score: number; source: "model_estimate" };
export type StyleDnaReportSections = { blueprint?: z.infer<typeof fact>[]; style?: z.infer<typeof fact>[] };
export type StyleDnaAnalysisReport = StyleDnaReportSections & {
  schemaVersion: 1;
  titles?: { ko?: string; en?: string };
  camera?: Partial<Record<(typeof cameraKeys)[number], Cell>>;
  lighting?: Partial<Record<(typeof lightingKeys)[number], Cell>>;
  tips?: string[];
  keywords?: string[];
  dna?: (Estimate & { label: string })[];
  matchRate?: Estimate;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// lens and focusDistance are visual estimates, never capture metadata. A number written as a bare measurement (no range or
// approximation) or a value attributed to EXIF/metadata is not kept as an estimate; the cell stays unconfirmed.
const visualEstimateKeys = new Set<string>(["lens", "focusDistance"]);
const approximate = /약|대략|추정|상당|정도|내외|이내|이상|이하|안팎|전후|범위|사이|~|∼|〜|–|—|\d\s*-\s*\d|approx|about|around|roughly|equivalent|estimat|range|between/i;
const metadataClaim = /(?:exif|메타\s*데이터|metadata|촬영\s*정보)\s*(?:기준|상|값|에\s*(?:따르면|의하면|따라|기록)|에서\s*확인|according|based|record|show|say)/i;
function visualEstimate(item: z.infer<typeof finding>) {
  return !metadataClaim.test(`${item.description} ${item.basis}`) && (!/\d/.test(item.description) || approximate.test(item.description));
}

function cells<Key extends string>(keys: readonly Key[], value: unknown) {
  const raw = object(value);
  const entries: [Key, Cell][] = [];
  for (const key of keys) {
    if (!Object.hasOwn(raw, key)) continue;
    const item = finding.safeParse(raw[key]);
    const kept = item.success && (!visualEstimateKeys.has(key) || visualEstimate(item.data));
    entries.push([key, kept ? { certainty: "estimated", ...item.data } : { certainty: "unconfirmed" }]);
  }
  return entries.length ? Object.fromEntries(entries) as Partial<Record<Key, Cell>> : undefined;
}

function list<Schema extends z.ZodType>(value: unknown, schema: Schema, limit: number) {
  if (!Array.isArray(value)) return;
  const items = value.slice(0, limit).flatMap(item => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return items.length ? items : undefined;
}

export function parseStyleDnaSections(value: unknown): StyleDnaReportSections | undefined {
  const raw = object(value);
  const blueprint = list(raw.blueprint, fact, 5);
  const style = list(raw.style, fact, 5);
  return blueprint || style ? { ...(blueprint && { blueprint }), ...(style && { style }) } : undefined;
}

export function parseStyleDnaReport(value: unknown): StyleDnaAnalysisReport | undefined {
  const raw = object(value);
  const rawTitles = object(raw.titles);
  const ko = text(80).safeParse(rawTitles.ko).data;
  const en = text(80).safeParse(rawTitles.en).data;
  const titles = ko || en ? { ...(ko && { ko }), ...(en && { en }) } : undefined;
  const camera = cells(cameraKeys, raw.camera);
  const lighting = cells(lightingKeys, raw.lighting);
  const sections = parseStyleDnaSections(raw);
  const tips = list(raw.tips, text(480), 5);
  const keywords = list(raw.keywords, text(40), 10);
  const dna = list(raw.dna, scoredFact, 6)?.map(item => ({ ...item, source: "model_estimate" as const }));
  const match = score.safeParse(raw.matchRate).data;
  if (!titles && !camera && !lighting && !sections && !tips && !keywords && !dna && match === undefined) return;
  return { schemaVersion: 1, ...sections, ...(titles && { titles }), ...(camera && { camera }), ...(lighting && { lighting }),
    ...(tips && { tips }), ...(keywords && { keywords }), ...(dna && { dna }),
    ...(match !== undefined && { matchRate: { score: match, source: "model_estimate" } }) };
}

const string = { type: "string" };
const number = { type: "number", minimum: 0, maximum: 100 };
const findingProperties = { description: string, basis: string };
const findingJson = { type: "object", properties: findingProperties, required: ["description", "basis"], additionalProperties: false };
const facts = { type: "array", maxItems: 5, items: { type: "object", properties: { label: string, ...findingProperties },
  required: ["label", "description", "basis"], additionalProperties: false } };
const sectionProperties = { blueprint: facts, style: facts };
// Shared output contract for every analysis engine: the two optical cells say what they mean.
const cellMeaning: Record<string, string> = {
  lens: "렌즈 화각과 35mm 환산 초점거리의 범위 또는 정성 추정. 원근 왜곡·배경 압축·화각 같은 시각 단서 기반이며 촬영 메타데이터가 아님",
  focusDistance: "카메라에서 초점이 맞은 피사체까지 거리의 범위 또는 정성 추정. 렌즈 초점거리(mm)가 아니며 피사체 크기·초점면·배경 흐림 단서 기반",
};
const cellJson = (keys: readonly string[]) => ({ type: "object", additionalProperties: false,
  properties: Object.fromEntries(keys.map(key => [key, cellMeaning[key] ? { ...findingJson, description: cellMeaning[key] } : findingJson])) });

export const styleDnaSectionsJson = { type: "object", additionalProperties: false, properties: sectionProperties };
export const styleDnaAnalysisJson = { type: "object", additionalProperties: false, properties: {
  titles: { type: "object", properties: { ko: string, en: string }, additionalProperties: false },
  camera: cellJson(cameraKeys), lighting: cellJson(lightingKeys), ...sectionProperties,
  tips: { type: "array", items: string, maxItems: 5 }, keywords: { type: "array", items: string, maxItems: 10 },
  dna: { type: "array", maxItems: 6, items: { type: "object", properties: { label: string, score: number },
    required: ["label", "score"], additionalProperties: false } },
  matchRate: number,
} };
