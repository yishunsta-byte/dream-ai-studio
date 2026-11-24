import "server-only";
import { isAbsolute } from "node:path";
import { StorageReadError } from "./errors";
export type PrivateStorageTransportOptions = Readonly<{
  profile: "managed" | "synthetic"; projectUrl: string; projectRef: string; bucket: string; privateBucket: true;
  credential: Readonly<{ mode: "service-role"; key: string }>;
  maxBytes: number; timeoutMs: number; maxConcurrent: number;
}>;
export type PrivateStorageOptions = PrivateStorageTransportOptions & Readonly<{ workRoot: string; ffprobePath: string }>;
// No environment access, default project/bucket/key or connection at import.
export function privateStorageTransportConfig<T extends PrivateStorageTransportOptions>(source: T): T {
  try {
    const snapshot = { ...source };
    const input = { ...snapshot, credential: { ...snapshot.credential } };
    const u = new URL(input.projectUrl);
    if (u.origin !== input.projectUrl || u.username || u.password || u.search || u.hash || u.pathname !== "/" ||
      !/^[a-z0-9]{20}$/.test(input.projectRef) || !/^[a-z][a-z0-9-]{0,62}$/.test(input.bucket) || input.privateBucket !== true ||
      input.credential?.mode !== "service-role" || typeof input.credential.key !== "string" || !/^[\x21-\x7e]{16,4096}$/.test(input.credential.key) ||
      !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 2 * 1024 ** 3 ||
      !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60000 ||
      !Number.isSafeInteger(input.maxConcurrent) || input.maxConcurrent < 1 || input.maxConcurrent > 8) throw new Error();
    if (input.profile === "managed") {
      if (u.protocol !== "https:" || u.port || u.hostname !== `${input.projectRef}.supabase.co`) throw new Error();
    } else if (input.profile === "synthetic") {
      if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port) throw new Error();
    } else throw new Error();
    return Object.freeze({ ...input, credential: Object.freeze({ ...input.credential }) });
  } catch { throw new StorageReadError("STORAGE_CONFIG"); }
}

export function privateStorageConfig(source: PrivateStorageOptions): PrivateStorageOptions {
  try {
    const input = privateStorageTransportConfig(source);
    if (!isAbsolute(input.workRoot) || input.workRoot.split(/[\\/]/).some(part => part.toLowerCase() === "public") ||
        !isAbsolute(input.ffprobePath) || /[\0\r\n]/.test(input.workRoot + input.ffprobePath)) throw new Error();
    return input;
  } catch { throw new StorageReadError("STORAGE_CONFIG"); }
}
