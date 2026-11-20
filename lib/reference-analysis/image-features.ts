import "server-only";
import { inspectLocalReferenceFile, type ReferenceFileOptions, type ReferenceMediaSnapshot } from "./local-file";
import type { ReferenceAnalysisResult, ReferenceFinding } from "./result";

const maxInputPixels = 12_000_000;
const maxSampleSide = 96;
const gridSide = 4;
const luminanceEdges = [0, 0.25, 0.5, 0.75, 1] as const;
const linearSrgb = Array.from({ length: 256 }, (_, code) => {
  const value = code / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

type ImageRegion = Extract<ReferenceFinding["location"], { kind: "region" }>;
type Distribution = {
  alphaCoverage: number;
  palette: { bucket: string; visibleShare: number }[];
  luminanceShares: number[] | null;
};
type ImageFeatures =
  | {
    status: "completed";
    display: { width: number; height: number };
    sample: { width: number; height: number; columns: number; rows: number };
    luminanceEdges: typeof luminanceEdges;
    distribution: Distribution;
    regions: { location: ImageRegion; distribution: Distribution }[];
  }
  | { status: "not_analyzed" | "analysis_limit" | "multiple_frames" | "local_tool_unavailable" |
      "local_tool_failed" | "cancelled" | "timed_out" };

type Sample = { data: Buffer; width: number };

function distribution(sample: Sample, left: number, top: number, right: number, bottom: number): Distribution {
  const buckets = new Map<number, number>();
  const luminance = [0, 0, 0, 0];
  let alphaSum = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * sample.width + x) * 4;
      const alpha = sample.data[offset + 3];
      if (!alpha) continue;
      const red = sample.data[offset];
      const green = sample.data[offset + 1];
      const blue = sample.data[offset + 2];
      const bucket = (red >> 6) * 16 + (green >> 6) * 4 + (blue >> 6);
      const level = 0.2126 * linearSrgb[red] + 0.7152 * linearSrgb[green] + 0.0722 * linearSrgb[blue];
      alphaSum += alpha;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + alpha);
      luminance[Math.min(3, Math.floor(level * 4))] += alpha;
    }
  }
  return {
    alphaCoverage: alphaSum / ((right - left) * (bottom - top) * 255),
    palette: [...buckets.entries()].sort(([first, a], [second, b]) => b - a || first - second).slice(0, 3)
      .map(([bucket, weight]) => ({
        bucket: "#" + [Math.floor(bucket / 16), Math.floor(bucket / 4) % 4, bucket % 4]
          .map(channel => (32 + channel * 64).toString(16)).join(""),
        visibleShare: weight / alphaSum,
      })),
    luminanceShares: alphaSum ? luminance.map(weight => weight / alphaSum) : null,
  };
}

function measureImage(sample: Sample, height: number, display: { width: number; height: number }): ImageFeatures {
  const { width } = sample;
  const columns = Math.min(gridSide, width);
  const rows = Math.min(gridSide, height);
  const regions: Extract<ImageFeatures, { status: "completed" }>["regions"] = [];
  for (let row = 0; row < rows; row++) {
    const top = Math.floor(row * height / rows);
    const bottom = Math.floor((row + 1) * height / rows);
    for (let column = 0; column < columns; column++) {
      const left = Math.floor(column * width / columns);
      const right = Math.floor((column + 1) * width / columns);
      const x = left / width;
      const y = top / height;
      regions.push({
        location: { kind: "region", x, y, width: right / width - x, height: bottom / height - y },
        distribution: distribution(sample, left, top, right, bottom),
      });
    }
  }
  return {
    status: "completed", display, sample: { width, height, columns, rows }, luminanceEdges,
    distribution: distribution(sample, 0, 0, width, height), regions,
  };
}

async function readImage(snapshot: ReferenceMediaSnapshot): Promise<ImageFeatures> {
  const { width, height, signal, deadline, imageBytes } = snapshot;
  if (!width || !height || !imageBytes) return { status: "local_tool_failed" };
  if (width * height > maxInputPixels) return { status: "analysis_limit" };
  let sharp;
  try { ({ default: sharp } = await import("sharp")); }
  catch { return { status: "local_tool_unavailable" }; }
  const remaining = () => {
    signal.throwIfAborted();
    const ms = deadline - performance.now();
    if (ms <= 0) throw new DOMException("Image analysis timed out", "TimeoutError");
    return Math.ceil(ms / 1_000);
  };
  try {
    const image = sharp(imageBytes, { limitInputPixels: maxInputPixels, failOn: "warning" });
    const metadata = await image.timeout({ seconds: remaining() }).metadata();
    remaining();
    if ((metadata.pages ?? 1) > 1) return { status: "multiple_frames" };
    const display = metadata.autoOrient;
    const { data, info } = await image.autoOrient().toColourspace("srgb").ensureAlpha()
      .resize(maxSampleSide, maxSampleSide, { fit: "inside", withoutEnlargement: true, kernel: "nearest", fastShrinkOnLoad: false })
      .raw({ depth: "uchar" }).timeout({ seconds: remaining() }).toBuffer({ resolveWithObject: true });
    remaining();
    if (info.channels !== 4 || info.width < 1 || info.height < 1 || info.width > maxSampleSide ||
      info.height > maxSampleSide || data.length !== info.width * info.height * 4) return { status: "local_tool_failed" };
    return measureImage({ data, width: info.width }, info.height, { width: display.width, height: display.height });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && /timed?\s*out|timeout/i.test(error.message)) {
      throw new DOMException("Image analysis timed out", "TimeoutError");
    }
    return { status: "local_tool_failed" };
  }
}

function imageFindings(image: ImageFeatures): ReferenceFinding[] {
  if (image.status !== "completed") return [];
  return [{ location: { kind: "region", x: 0, y: 0, width: 1, height: 1 } as const,
    distribution: image.distribution }, ...image.regions].map(({ location, distribution }, index) => ({
    id: `image-region-${index}`, kind: "observation", location,
    text: distribution.alphaCoverage === 0 ? "Fully transparent in sampled pixels" :
      `Sampled alpha coverage ${(100 * distribution.alphaCoverage).toFixed(1)}%; sRGB color buckets ${distribution.palette
        .map(color => `${color.bucket} ${(100 * color.visibleShare).toFixed(1)}%`).join(", ")}; relative luminance bin shares ${distribution.luminanceShares
        ?.map(share => `${(100 * share).toFixed(1)}%`).join(", ")}`,
  }));
}

/** Measures the displayed raster using the same managed copy as the file probe. */
export async function analyzeLocalReferenceImage(
  path: string, submission: unknown, options: ReferenceFileOptions,
): Promise<{ inspection: ReferenceAnalysisResult; image: ImageFeatures }> {
  let image: ImageFeatures = { status: "not_analyzed" };
  const inspection = await inspectLocalReferenceFile(path, submission, options, { image: async snapshot => {
    image = await readImage(snapshot);
    return imageFindings(image);
  } });
  if (inspection.inspection !== "completed") {
    const { inspection: state } = inspection;
    image = { status: state === "cancelled" || state === "timed_out" || state === "local_tool_unavailable" ||
      state === "local_tool_failed" ? state : "not_analyzed" };
  }
  return { inspection, image };
}
