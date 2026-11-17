import { createHash } from "node:crypto";
import { frozen, parse, receiptBodySchema, receiptSchema, ProtocolError, type Receipt } from "./schema";

// Same sorted-key JSON convention as edit/timeline; bounded, strict JSON here avoids
// importing a product timeline module and rejects lossy undefined/Date/NaN inputs.
export function canonicalJson(value: unknown): string {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): string {
    if (++nodes > 4096 || depth > 16) throw new ProtocolError("INPUT");
    if (v === null || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v === "string" && v.length <= 8192) return JSON.stringify(v);
    if (typeof v !== "object" || v === null || ancestors.has(v)) throw new ProtocolError("INPUT");
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new ProtocolError("INPUT");
    if (Object.getOwnPropertySymbols(v).length || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !Object.hasOwn(d, "value"))) throw new ProtocolError("INPUT");
    ancestors.add(v);
    let text: string;
    if (Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length !== v.length || keys.some((key, index) => key !== String(index))) throw new ProtocolError("INPUT");
      text = `[${v.map(child => visit(child, depth + 1)).join(",")}]`;
    } else {
      const keys = Object.keys(v).sort();
      if (keys.length > 128 || Object.getOwnPropertySymbols(v).length) throw new ProtocolError("INPUT");
      text = `{${keys.map(key => `${visit(key, depth + 1)}:${visit((v as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
    }
    ancestors.delete(v);
    if (text.length > 65536) throw new ProtocolError("INPUT");
    return text;
  }
  return visit(value, 0);
}
// Domain separated content digest, NOT a signature or evidence that media was inspected.
export function protocolDigest(domain: string, value: unknown): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(domain)) throw new ProtocolError("INPUT");
  return createHash("sha256").update(`${domain}:v1\n${canonicalJson(value)}`, "utf8").digest("hex");
}
export function makeReceipt(input: unknown): Receipt {
  const body = parse(receiptBodySchema, input);
  return frozen({ body, digest: protocolDigest("verification-receipt", body) });
}
export function checkedReceipt(input: unknown): Receipt {
  const receipt = parse(receiptSchema, input);
  if (receipt.digest !== protocolDigest("verification-receipt", receipt.body)) throw new ProtocolError("INPUT");
  return frozen(receipt);
}
