import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { observeStorageMedia, verifyStorageMedia } from "@/lib/storage/supabase/media";
import { privateObjectKey, type OwnedStorageAsset } from "@/lib/storage/supabase/object-key";
import { mediaSchema } from "@/lib/storage/uploads/schema";
vi.mock("server-only", () => ({}));

// Synthetic local files only: images from sharp, videos from the bundled ffmpeg lavfi test sources. No network or provider.
const run = promisify(execFile);
const ffmpeg = resolve(".tools/ffmpeg/ffmpeg.exe"), ffprobe = resolve(".tools/ffmpeg/ffprobe.exe");
let root: string;
const created: string[] = [];
const file = async (name: string, bytes: Buffer) => { const path = join(root, name); await writeFile(path, bytes); created.push(name); return path; };
const video = async (name: string, args: string[]) => {
  await run(ffmpeg, ["-v", "error", ...args, "-y", join(root, name)], { windowsHide: true, timeout: 20000 }); created.push(name); return join(root, name);
};
// Independent reading of the container duration, to pin the millisecond conversion.
const probedMs = async (path: string) => Math.round(Number(JSON.parse((await run(ffprobe, ["-v", "error", "-show_format", "-of", "json", path], { windowsHide: true })).stdout).format.duration) * 1000);
const live = () => new AbortController().signal, later = () => Date.now() + 20000;
const asset = (mime: OwnedStorageAsset["mime"], bytes: Buffer): OwnedStorageAsset => {
  const value = { ownerId: "00000000-0000-4000-8000-000000000001", id: v7(), sha256: createHash("sha256").update(bytes).digest("hex"), mime,
    kind: mime.startsWith("image/") ? "image" as const : "video" as const, sizeBytes: bytes.length };
  return { ...value, objectKey: privateObjectKey(value) };
};
const paths: Record<string, string> = {};

beforeAll(async () => {
  const parent = await realpath(resolve("tmp")); root = await mkdtemp(join(parent, "media-observe-"));
  const base = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#204060" } });
  paths.png = await file("a.png", await base(3, 2).png().toBuffer());
  paths.jpeg = await file("b.jpg", await base(5, 4).jpeg().toBuffer());
  paths.webp = await file("c.webp", await base(7, 3).webp().toBuffer());
  paths.pngNamedMp4 = await file("png-bytes.mp4", await readFile(paths.png));
  paths.mp4 = await video("d.mp4", ["-f", "lavfi", "-i", "color=c=gray:s=16x16:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  paths.mov = await video("e.mov", ["-f", "lavfi", "-i", "testsrc=s=32x18:d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mov"]);
  paths.webm = await video("f.webm", ["-f", "lavfi", "-i", "testsrc=s=24x12:d=0.4", "-c:v", "libvpx-vp9", "-b:v", "50k"]);
  paths.audioOnly = await video("g.mp4", ["-f", "lavfi", "-i", "sine=d=0.3", "-c:a", "aac", "-f", "mp4"]);
  const mp4 = await readFile(paths.mp4);
  paths.cutMp4 = await file("cut.mp4", mp4.subarray(0, Math.floor(mp4.length / 2)));
  paths.cutPng = await file("cut.png", (await readFile(paths.png)).subarray(0, 24));
  paths.cutJpeg = await file("cut.jpg", (await readFile(paths.jpeg)).subarray(0, 40));
  paths.junk = await file("junk.png", Buffer.alloc(100, 65));
  paths.gif = await file("h.gif", await base(2, 2).gif().toBuffer());
  paths.huge = await file("huge.png", await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "black" } }).png().toBuffer());
}, 60000);
afterAll(async () => {
  const actual = await realpath(root); if (dirname(actual) !== await realpath(resolve("tmp"))) throw new Error("Owned cleanup boundary failed");
  await rm(actual, { recursive: true });
});

describe("internal storage media observation (mediaSchema width/height/duration and detected format)", () => {
  it.each([
    ["png", "image/png", 3, 2], ["jpeg", "image/jpeg", 5, 4], ["webp", "image/webp", 7, 3],
  ] as const)("observes a synthetic %s image: decoded size, null duration", async (name, mime, width, height) => {
    const observed = await observeStorageMedia(paths[name], ffprobe, live(), later());
    expect(observed).toEqual({ format: { mime, kind: "image" }, media: { width, height, durationMs: null } });
    expect(mediaSchema.parse(observed.media)).toEqual(observed.media);
    expect(Object.isFrozen(observed) && Object.isFrozen(observed.format) && Object.isFrozen(observed.media)).toBe(true);
  });
  it.each([
    ["mp4", "video/mp4", 16, 16, 200], ["mov", "video/quicktime", 32, 18, 500], ["webm", "video/webm", 24, 12, 400],
  ] as const)("observes a synthetic %s video: coded size and positive whole-millisecond duration", async (name, mime, width, height, nominal) => {
    const observed = await observeStorageMedia(paths[name], ffprobe, live(), later());
    expect(observed.format).toEqual({ mime, kind: "video" });
    expect({ width: observed.media.width, height: observed.media.height }).toEqual({ width, height });
    expect(observed.media.durationMs).toBe(await probedMs(paths[name]));
    expect(Math.abs((observed.media.durationMs ?? 0) - nominal)).toBeLessThanOrEqual(60);
    expect(mediaSchema.parse(observed.media)).toEqual(observed.media);
  });
  it("reports the actual bytes' format, not the file name", async () => {
    expect((await observeStorageMedia(paths.pngNamedMp4, ffprobe, live(), later())).format).toEqual({ mime: "image/png", kind: "image" });
  });
  it.each(["cutPng", "cutJpeg", "junk", "gif", "huge", "cutMp4", "audioOnly"])("refuses a damaged, unsupported or out-of-policy local file (%s)", async name => {
    await expect(observeStorageMedia(paths[name], ffprobe, live(), later())).rejects.toMatchObject({ code: "STORAGE_TYPE" });
  });
  it("honours a pre-aborted signal before reading, and an abort right after the call starts", async () => {
    const before = new AbortController(); before.abort();
    await expect(observeStorageMedia(paths.png, ffprobe, before.signal, later())).rejects.toMatchObject({ name: "AbortError" });
    const during = new AbortController(), pending = observeStorageMedia(paths.mov, ffprobe, during.signal, later()); void pending.catch(() => {});
    during.abort(); const error = await pending.then(() => null, (reason: unknown) => reason as { name?: string; code?: string });
    expect(error?.name === "AbortError" || error?.code === "STORAGE_TYPE").toBe(true);
  });
  it("bounds the ffprobe call by the caller's deadline", async () => {
    await expect(observeStorageMedia(paths.mp4, ffprobe, live(), Date.now() - 1)).rejects.toMatchObject({ code: "STORAGE_TYPE" });
  });
  it("leaves the existing verification contract unchanged", async () => {
    const png = await readFile(paths.png), mp4 = await readFile(paths.mp4);
    await expect(verifyStorageMedia(paths.png, asset("image/png", png), ffprobe, live(), later())).resolves.toBeUndefined();
    await expect(verifyStorageMedia(paths.mp4, asset("video/mp4", mp4), ffprobe, live(), later())).resolves.toBeUndefined();
    await expect(verifyStorageMedia(paths.png, asset("image/jpeg", png), ffprobe, live(), later())).rejects.toMatchObject({ code: "STORAGE_TYPE" });
    await expect(verifyStorageMedia(paths.pngNamedMp4, asset("video/mp4", png), ffprobe, live(), later())).rejects.toMatchObject({ code: "STORAGE_TYPE" });
  });
  it("creates no files of its own", async () => {
    expect((await readdir(root)).sort()).toEqual([...created].sort());
  });
});
