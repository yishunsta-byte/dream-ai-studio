import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStudioAnalysisPost } from "../../lib/reference-analysis/studio-analysis-http";
import { studioAnalysisResultSchema } from "../../lib/reference-analysis/studio-analysis-result-dto";

vi.mock("server-only", () => ({}));

// Explicit network smoke test. Only these public fixtures are fetched. The product
// handler still receives the same owner-scoped registered selection as the UI.
const samples = [
  { media: "image", mime: "image/jpeg", digest: "6c60544bcf3cad38dcb3015e79a377d3fbe443b42e0fdf95a35e85f366cf152c", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg" },
  { media: "music", mime: "audio/mpeg", digest: "a62df24a2c84cea8d18c1fa8aca7c18c877ba2b76a00a591256fa74d3ce54ac3", url: "https://tonejs.github.io/audio/salamander/A4.mp3" },
  { media: "video", mime: "video/mp4", digest: "0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
];

describe.skipIf(process.env.DREAM_REA_LIVE_URL_CHECK !== "1")("public media URL to registered analysis result", () => {
  it.each(samples)("analyzes a live $media file and returns its measured observations and prompt", async ({ media, mime, url, digest }) => {
    const downloaded = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    expect(downloaded.status).toBe(200);
    if (!downloaded.body) throw new Error("Missing media");
    const parts: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of downloaded.body) {
      length += chunk.byteLength;
      if (length > 8 * 1024 * 1024) throw new Error("Sample exceeds the test budget");
      parts.push(chunk);
    }
    const bytes = Buffer.concat(parts, length);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe(digest);
    const name = new URL(url).pathname.split("/").pop()!;
    const root = await realpath(await mkdtemp(join(tmpdir(), "dream-rea-live-")));
    const path = join(root, name);
    const ownerId = randomUUID();
    const selection = { projectId: randomUUID(), assetId: randomUUID() };
    try {
      await writeFile(path, bytes, { flag: "wx" });
      const post = createStudioAnalysisPost({
        async resolveAuth() { return { kind: "verified", userId: ownerId, email: "test@example.invalid" }; },
        async resolveRegisteredSource(actor, chosen) {
          if (actor.id !== ownerId || chosen.projectId !== selection.projectId || chosen.assetId !== selection.assetId) return;
          return { status: "authorized", ownerId, ...selection, storeId: "isolated", restoreGeneration: "1",
            linkGeneration: "1", scopePermissionGeneration: "1", ownerPermissionGeneration: "1", sourceGeneration: "1",
            sha256, name, mime, sizeBytes: bytes.length, path, managedRoot: root };
        },
      });
      const origin = "http://127.0.0.1:3000";
      const response = await post(new Request(origin + "/api/studio/reference-analysis", {
        method: "POST", headers: { origin, host: "127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(selection),
      }));
      expect(response.status).toBe(200);
      const result = studioAnalysisResultSchema.parse(await response.json());
      expect(result).toMatchObject({ status: "ready", media });
      if (result.status !== "ready") throw new Error(result.reason);
      const observations = result.proposals.flatMap(p => p.observations.map(o => o.measure));
      expect(observations.length).toBeGreaterThan(0);
      expect(result.proposals.every(p => p.draft.prompt.trim().length > 0)).toBe(true);
      console.info(JSON.stringify({ media, bytes: bytes.length, sha256, proposals: result.proposals.length, measures: [...new Set(observations)], sample: result.proposals[0].draft.prompt }));
    } finally {
      await rm(path, { force: true });
      await rmdir(root);
    }
  }, 30_000);
});
