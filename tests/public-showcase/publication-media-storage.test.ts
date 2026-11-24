import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicationMediaRangeReader } from "../../lib/public-showcase/publication-media-storage";

vi.mock("server-only", () => ({}));

const bucket = "publication-media-private";
const options = {
  profile: "synthetic", projectUrl: "http://127.0.0.1:12345", projectRef: "a".repeat(20),
  credential: { mode: "service-role", key: "synthetic-test-key" },
  timeoutMs: 5000, maxBytes: 262144, maxConcurrent: 1,
} as const;
const sha = "a".repeat(64);
const row = { objectKey: "sample/1/" + sha + ".mp3", sha, ext: "mp3", mime: "audio/mpeg", sizeBytes: 100, version: '"v1"' };
const metadata = (isPublic = false) => Response.json({ id: bucket, public: isPublic });
const partial = (version = row.version) => new Response(Uint8Array.of(10, 20), { status: 206,
  headers: { etag: version, "content-length": "2", "content-range": "bytes 1-2/100" } });

afterEach(() => vi.unstubAllGlobals());

describe("private publication media range reader", () => {
  it("checks bucket privacy and pins the object request to the verified version and range", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(metadata()).mockResolvedValueOnce(partial());
    vi.stubGlobal("fetch", fetch);
    const read = createPublicationMediaRangeReader(options);
    const response = await read(row, 1, 2, new AbortController().signal);
    expect(fetch.mock.calls[0][0]).toBe(options.projectUrl + "/storage/v1/bucket/" + bucket);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe(options.projectUrl + "/storage/v1/object/authenticated/" + bucket + "/" + row.objectKey);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("if-match")).toBe(row.version);
    expect(new Headers(init?.headers).get("range")).toBe("bytes=1-2");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(10, 20));
  });

  it("rejects a public bucket before reading bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(metadata(true));
    vi.stubGlobal("fetch", fetch);
    await expect(createPublicationMediaRangeReader(options)(row, 1, 2, new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an object replaced with the same size and releases the read slot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(partial('"v2"'))
      .mockResolvedValueOnce(metadata()).mockResolvedValueOnce(partial()));
    const read = createPublicationMediaRangeReader(options);
    const signal = new AbortController().signal;
    await expect(read(row, 1, 2, signal)).rejects.toThrow();
    expect((await read(row, 1, 2, signal)).status).toBe(206);
  });
});
