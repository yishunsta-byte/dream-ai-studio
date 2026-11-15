import "server-only";
import { resolve } from "node:path";
// Runtime data is supplied by the local process and must never enter build traces.
export function runtimeRoot(){return resolve(/*turbopackIgnore: true*/process.env.DREAM_DATA_ROOT?.trim()||process.cwd());}
