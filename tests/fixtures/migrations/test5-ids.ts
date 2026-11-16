// Test-only code migration helper (T-048): a stable id from a source key. Listed in the step's hashed files.
import { createHash } from "node:crypto";
export function derivedId(source:string){
  const hex=createHash("sha256").update(`test5:${source}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-${((parseInt(hex[16],16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
