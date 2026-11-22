import "server-only";
import sharp from "sharp";
import type { StyleDnaComparisonFrame, StyleDnaSpot } from "./style-dna-contract";

type Point = Pick<StyleDnaSpot, "x" | "y">;
type Image = { pixels: Buffer; width: number; height: number; naturalWidth: number; naturalHeight: number };
type Color = [number, number, number];
const maxSide = 1024;
const maxDistance = Math.hypot(255, 255, 255);
const roundTenth = (number: number) => Math.round(number * 10) / 10;

async function sampleImage(bytes: Buffer): Promise<Image> {
  const pipeline = sharp(bytes, { limitInputPixels: 12_000_000, failOn: "warning" }).timeout({ seconds: 7 });
  const source = await pipeline.metadata();
  if (source.format !== "webp" || !source.width || !source.height || (source.pages ?? 1) !== 1) throw new Error("Invalid stored image");
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const { data: pixels, info } = await pipeline.resize(width, height, { fit: "fill", kernel: "linear" })
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width !== width || info.height !== height) throw new Error("Invalid comparison pixels");
  return { pixels, width, height, naturalWidth: source.width, naturalHeight: source.height };
}

function pick(image: Image, frame: StyleDnaComparisonFrame, point: Point): Color | undefined {
  const scale = Math.min(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const frameX = point.x / 100 * frame.width - (frame.width - drawWidth) / 2;
  const frameY = point.y / 100 * frame.height - (frame.height - drawHeight) / 2;
  if (frameX < 0 || frameY < 0 || frameX > drawWidth || frameY > drawHeight) return;

  const pixelX = Math.min(image.naturalWidth - 1, Math.floor(frameX / scale));
  const pixelY = Math.min(image.naturalHeight - 1, Math.floor(frameY / scale));
  const centerX = Math.floor(pixelX * image.width / image.naturalWidth);
  const centerY = Math.floor(pixelY * image.height / image.naturalHeight);
  let red = 0, green = 0, blue = 0, count = 0;
  for (let y = Math.max(0, centerY - 2); y <= Math.min(image.height - 1, centerY + 2); y++) {
    for (let x = Math.max(0, centerX - 2); x <= Math.min(image.width - 1, centerX + 2); x++) {
      const offset = (y * image.width + x) * 4;
      // Canvas returns zero RGB for a fully transparent sample.
      if (image.pixels[offset + 3] !== 0) {
        red += image.pixels[offset];
        green += image.pixels[offset + 1];
        blue += image.pixels[offset + 2];
      }
      count++;
    }
  }
  return [red / count, green / count, blue / count];
}

export async function measureComparisonSpots(original: Buffer, result: Buffer, frame: StyleDnaComparisonFrame, points: readonly Point[]): Promise<StyleDnaSpot[]> {
  if (!points.length) return [];
  const [before, after] = await Promise.all([sampleImage(original), sampleImage(result)]);
  return points.map(({ x, y }) => {
    const a = pick(before, frame, { x, y });
    const b = pick(after, frame, { x, y });
    const diff = a && b ? roundTenth(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / maxDistance * 100) : null;
    return { x, y, diff };
  });
}

export function summarizeComparisonSpots(points: readonly StyleDnaSpot[]) {
  const measured = points.flatMap(spot => spot.diff === null ? [] : [spot.diff]);
  if (!measured.length) return;
  return { avg: roundTenth(measured.reduce((sum, diff) => sum + diff, 0) / measured.length), n: measured.length };
}
