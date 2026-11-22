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

function cells<Key extends string>(keys: readonly Key[], value: unknown) {
  const raw = object(value);
  const entries: [Key, Cell][] = [];
  for (const key of keys) {
    if (!Object.hasOwn(raw, key)) continue;
    const item = finding.safeParse(raw[key]);
    entries.push([key, item.success ? { certainty: "estimated", ...item.data } : { certainty: "unconfirmed" }]);
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
const cellJson = (keys: readonly string[]) => ({ type: "object", additionalProperties: false,
  properties: Object.fromEntries(keys.map(key => [key, findingJson])) });

export const styleDnaSectionsJson = { type: "object", additionalProperties: false, properties: sectionProperties };
export const styleDnaAnalysisJson = { type: "object", additionalProperties: false, properties: {
  titles: { type: "object", properties: { ko: string, en: string }, additionalProperties: false },
  camera: cellJson(cameraKeys), lighting: cellJson(lightingKeys), ...sectionProperties,
  tips: { type: "array", items: string, maxItems: 5 }, keywords: { type: "array", items: string, maxItems: 10 },
  dna: { type: "array", maxItems: 6, items: { type: "object", properties: { label: string, score: number },
    required: ["label", "score"], additionalProperties: false } },
  matchRate: number,
} };
