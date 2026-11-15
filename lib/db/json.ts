import { z } from "zod";
export function encodeJson<T>(schema: z.ZodType<T>, input: unknown): string { return JSON.stringify(schema.parse(input)); }
export function decodeJson<T>(schema: z.ZodType<T>, raw: string): T { return schema.parse(JSON.parse(raw)); }
export const jsonObject = z.record(z.string(), z.unknown());
export const jsonArray = z.array(z.unknown());
