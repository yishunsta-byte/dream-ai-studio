import "server-only";
import { open } from "node:fs/promises";

export type RegisteredPcmWav = Readonly<{ channels: number; sampleRate: number; frames: number }>;

/** The caller has already verified the private snapshot's registered digest, size and generation. */
export async function readCanonicalPcmWav(path: string, sizeBytes: number, signal: AbortSignal): Promise<RegisteredPcmWav | undefined> {
  if (sizeBytes < 46) return;
  signal.throwIfAborted();
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(44);
    const { size } = await file.stat();
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    signal.throwIfAborted();
    if (size !== sizeBytes || bytesRead !== header.length || header.toString("latin1", 0, 4) !== "RIFF" ||
        header.readUInt32LE(4) !== size - 8 || header.toString("latin1", 8, 16) !== "WAVEfmt " ||
        header.readUInt32LE(16) !== 16 || header.readUInt16LE(20) !== 1 || header.readUInt16LE(34) !== 16 ||
        header.toString("latin1", 36, 40) !== "data" || header.readUInt32LE(40) !== size - header.length) return;
    const channels = header.readUInt16LE(22);
    const sampleRate = header.readUInt32LE(24);
    const blockSize = channels * 2;
    if ((channels !== 1 && channels !== 2) || sampleRate < 8000 || sampleRate > 192000 ||
        header.readUInt16LE(32) !== blockSize || header.readUInt32LE(28) !== sampleRate * blockSize ||
        (size - header.length) % blockSize !== 0) return;
    return { channels, sampleRate, frames: (size - header.length) / blockSize };
  } finally { await file.close(); }
}
