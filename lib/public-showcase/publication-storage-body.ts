import "server-only";
import { StorageReadError } from "../storage/supabase/errors";

export function advertisedSize(response: Response, limit: number) {
  const length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding !== "identity") throw new StorageReadError("STORAGE_INTEGRITY");
  if (length === null) return null;
  if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) throw new StorageReadError("STORAGE_INTEGRITY");
  if (Number(length) > limit) throw new StorageReadError("STORAGE_LIMIT");
  return Number(length);
}

export async function boundBody(body: ReadableStream<Uint8Array> | null, limit: number, length: number | null, signal: AbortSignal) {
  if (!body) throw new StorageReadError("STORAGE_INTEGRITY");
  const bytes = Buffer.alloc(length ?? limit);
  const reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > limit) throw new StorageReadError("STORAGE_LIMIT");
      if (nextSize > bytes.length) throw new StorageReadError("STORAGE_INTEGRITY");
      bytes.set(value, size);
      size = nextSize;
    }
    signal.throwIfAborted();
    if (size === 0 || (length !== null && size !== length)) throw new StorageReadError("STORAGE_INTEGRITY");
    return bytes.subarray(0, size);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
