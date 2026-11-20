import { z } from "zod";

// Backend 제안(V101-ADMIN-WIRE-CONTRACT 1장)의 이미지 응답 형제 필드 `styleDna`를 화면이 읽는 형식.
// 서버 계약 파일이 생기면 그 스키마로 바꾼다. 모든 칸이 선택이고, 형식이 맞지 않으면 통째로 무시해
// 기존 리포트(result·semantic)만 보여 준다. AI 자기 추정 점수(matchRate·DNA 백분율)는 받지 않는다.
const text = (max: number) => z.string().trim().min(1).max(max);
const cell = z.discriminatedUnion("certainty", [
  z.object({ certainty: z.literal("estimated"), description: text(480), basis: text(240) }),
  z.object({ certainty: z.literal("unconfirmed") }),
]);
export const cameraKeys = ["angle", "shotType", "lens", "focusDistance", "depthOfField"] as const;
export const lightingKeys = ["timeOfDay", "direction", "altitude", "contrast", "shadows"] as const;
const cells = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map(key => [key, cell.optional()])) as Record<K, z.ZodOptional<typeof cell>>);

export const styleDnaSchema = z.object({
  schemaVersion: z.literal(1),
  titles: z.object({ ko: text(200).optional(), en: text(200).optional() }).optional(),
  style: z.array(z.object({ label: text(80), description: text(480), basis: text(240) })).max(12).optional(),
  tips: z.array(text(480)).max(12).optional(),
  keywords: z.array(text(60)).max(30).optional(),
  dimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  aspectRatio: text(10).optional(),
  camera: cells(cameraKeys).optional(),
  lighting: cells(lightingKeys).optional(),
});
export type StyleDna = z.infer<typeof styleDnaSchema>;
export type StyleDnaCell = z.infer<typeof cell>;

export const parseStyleDna = (value: unknown): StyleDna | undefined => value === undefined ? undefined : styleDnaSchema.safeParse(value).data;
