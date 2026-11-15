import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
const schema=z.strictObject({schemaVersion:z.literal(1),mock:z.strictObject({image:z.string().min(1),video:z.string().min(1),speech:z.string().min(1),text:z.string().min(1)}),manualQa:z.strictObject({randomFailureEnabled:z.boolean(),failureRate:z.number().min(0).max(1)}).default({randomFailureEnabled:false,failureRate:0.1})});
export function providerConfig(){return schema.parse(JSON.parse(readFileSync(join(process.cwd(),"config/providers.json"),"utf8")));}
