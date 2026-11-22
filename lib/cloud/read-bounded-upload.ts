import "server-only";

export async function readBoundedUpload(request: Request, maxBytes: number) {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      parts.push(Buffer.from(value));
    }
    if (!size) return Buffer.alloc(0);
    return Buffer.concat(parts, size);
  } finally { reader.releaseLock(); }
}
