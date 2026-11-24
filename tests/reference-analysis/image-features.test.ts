import { mkdtemp, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeLocalReferenceImage } from "../../lib/reference-analysis/image-features";
import { referenceAnalysisResultSchema } from "../../lib/reference-analysis/result";

vi.mock("server-only", () => ({}));

describe.skipIf(process.env.DREAM_REA_NATIVE_TEST !== "1")("owned synthetic image composition", () => {
  let root: string;
  const names = ["quadrants.png", "transparent.webp", "rotated.jpg", "large.png", "over-limit.png", "invalid.png", "animated.webp"];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "dream-rea-image-"));
    const rgba = Buffer.alloc(8 * 8 * 4);
    const colors = [[255, 0, 0, 255], [0, 255, 0, 0], [255, 255, 255, 128], [0, 0, 0, 255]];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) rgba.set(colors[(y >= 4 ? 2 : 0) + (x >= 4 ? 1 : 0)], (y * 8 + x) * 4);
    }
    const rgb = Buffer.alloc(32 * 16 * 3);
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 16; y++) rgb.set(x < 16 ? [255, 0, 0] : [0, 0, 255], (y * 32 + x) * 3);
    }
    const frames = Buffer.concat([Buffer.alloc(4 * 4 * 3, 255), Buffer.alloc(4 * 4 * 3)]);
    await Promise.all([
      sharp(rgba, { raw: { width: 8, height: 8, channels: 4 } }).png().toFile(join(root, "quadrants.png")),
      sharp({ create: { width: 1, height: 1, channels: 4, background: "#ff000000" } })
        .webp({ lossless: true }).toFile(join(root, "transparent.webp")),
      sharp(rgb, { raw: { width: 32, height: 16, channels: 3 } }).withMetadata({ orientation: 6 })
        .jpeg({ chromaSubsampling: "4:4:4" }).toFile(join(root, "rotated.jpg")),
      sharp({ create: { width: 200, height: 100, channels: 3, background: "#000000" } })
        .png().toFile(join(root, "large.png")),
      sharp({ create: { width: 4_000, height: 3_001, channels: 3, background: "#000000" } })
        .png().toFile(join(root, "over-limit.png")),
      sharp(frames, { raw: { width: 4, height: 8, pageHeight: 4, channels: 3 } })
        .webp({ lossless: true, delay: [100, 100] }).toFile(join(root, "animated.webp")),
      writeFile(join(root, "invalid.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])),
    ]);
  });

  afterAll(async () => {
    if (!root) return;
    await Promise.all(names.map(name => rm(join(root, name), { force: true })));
    await rmdir(root);
  });

  async function analyze(name: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}, presentedName = name) {
    const path = join(root, name);
    return analyzeLocalReferenceImage(path, {
      kind: "file", name: presentedName, sizeBytes: (await stat(path)).size, permission: "synthetic",
    }, { managedRoot: root, ...options });
  }

  it("locates contrasting quadrants and weights color and luminance by alpha", async () => {
    const { image, inspection } = await analyze("quadrants.png");
    expect(image.status).toBe("completed");
    if (image.status !== "completed") throw new Error("Missing image observations");
    const { distribution, regions } = image;
    expect(image.sample).toEqual({ width: 8, height: 8, columns: 4, rows: 4 });
    expect(distribution.alphaCoverage).toBeCloseTo((255 + 255 + 128) / (4 * 255), 8);
    expect(distribution.palette.map(color => color.bucket)).toEqual(["#202020", "#e02020", "#e0e0e0"]);
    expect(distribution.luminanceShares).toEqual([510 / 638, 0, 0, 128 / 638]);
    expect(regions[0]).toMatchObject({
      location: { x: 0, y: 0, width: 0.25, height: 0.25 },
      distribution: { palette: [{ bucket: "#e02020", visibleShare: 1 }], alphaCoverage: 1 },
    });
    expect(regions[3].distribution).toEqual({ palette: [], alphaCoverage: 0, luminanceShares: null });
    expect(regions[12].distribution.luminanceShares).toEqual([0, 0, 0, 1]);
    expect(regions[15].distribution.luminanceShares).toEqual([1, 0, 0, 0]);
    expect(inspection.findings.filter(item => item.kind === "observation")).toHaveLength(17);
    expect(referenceAnalysisResultSchema.safeParse(inspection).success).toBe(true);
    expect(JSON.stringify({ image, inspection })).not.toMatch(/dream-rea-inspect|dream-rea-image-|"type":"Buffer"|data:image/);
  });

  it("maps regions to the EXIF-oriented display", async () => {
    const { image, inspection } = await analyze("rotated.jpg");
    expect(inspection.findings[0]).toMatchObject({ kind: "file_metadata", values: { width: 32, height: 16 } });
    expect(image).toMatchObject({ status: "completed", display: { width: 16, height: 32 } });
    if (image.status !== "completed") throw new Error("Missing image observations");
    expect(image.regions[0].distribution.palette[0].bucket).toBe("#e02020");
    expect(image.regions[12].distribution.palette[0].bucket).toBe("#2020e0");
  });

  it("keeps fully transparent one-pixel images free of color and luminance claims", async () => {
    const { image, inspection } = await analyze("transparent.webp");
    expect(image, JSON.stringify(inspection)).toMatchObject({
      status: "completed", sample: { width: 1, height: 1, columns: 1, rows: 1 },
      distribution: { alphaCoverage: 0, palette: [], luminanceShares: null },
      regions: [{ location: { x: 0, y: 0, width: 1, height: 1 } }],
    });
  });

  it("bounds the sample raster and skips over-budget and animated input", async () => {
    expect((await analyze("large.png")).image).toMatchObject({
      status: "completed", display: { width: 200, height: 100 }, sample: { width: 96, height: 48 },
    });
    for (const [name, status] of [["over-limit.png", "analysis_limit"], ["animated.webp", "multiple_frames"]]) {
      const { image, inspection } = await analyze(name);
      expect(image, JSON.stringify(inspection)).toEqual({ status });
      expect(inspection.findings.map(item => item.kind)).toEqual(["file_metadata"]);
    }
  });

  it("rejects malformed or mismatched files without image observations", async () => {
    const invalid = await analyze("invalid.png");
    expect(invalid).toMatchObject({ image: { status: "not_analyzed" }, inspection: { inspection: "invalid_file", findings: [] } });
    const mismatch = await analyze("quadrants.png", {}, "quadrants.jpg");
    expect(mismatch).toMatchObject({
      image: { status: "not_analyzed" }, inspection: { input: { reason: "file_type_mismatch" }, findings: [] },
    });
  });

  it("publishes no stale image results after cancellation or timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    for (const [options, status] of [
      [{ signal: controller.signal }, "cancelled"],
      [{ timeoutMs: 1 }, "timed_out"],
    ] as const) {
      const { image, inspection } = await analyze("over-limit.png", options);
      expect(image, JSON.stringify(inspection)).toEqual({ status });
      expect(inspection.findings).toMatchObject([{ kind: "unavailable", reason: status }]);
    }
  });
});
