import { describe, expect, it, vi } from "vitest";
import type { CoverSource } from "@/lib/public-showcase/cover-source";
import type { PlaybackRow, PlaybackStore } from "@/lib/public-showcase/playback-source";

vi.mock("server-only", () => ({}));
const { servePlayback, PLAYBACK_CHUNK_BYTES } = await import("@/lib/public-showcase/playback-source");
const { readApprovedSnapshot } = await import("@/lib/public-showcase/showcase-source");

const sha = "a".repeat(64);
const url = "http://localhost/media/public/example/1/play.mp4";
function fixture(sizeBytes = 10) {
  const row: PlaybackRow = { sha, objectKey: `example/1/${sha}.mp4`, ext: "mp4", mime: "video/mp4", sizeBytes, version: '"v1"' };
  const findMedia = vi.fn<PlaybackStore["findMedia"]>(async () => row);
  const readRange = vi.fn<PlaybackStore["readRange"]>(async (_, start, end) => {
    const bytes = Uint8Array.from({ length: end - start + 1 }, (_, index) => (start + index) % 251);
    return new Response(bytes, { status: 206, headers: {
      "content-range": `bytes ${start}-${end}/${sizeBytes}`, "content-length": String(bytes.length), etag: row.version,
    } });
  });
  const source: CoverSource = { mode: "active", store: { findCover: vi.fn(), readObject: vi.fn(), media: { findMedia, readRange } } };
  const request = (headers?: HeadersInit, method = "GET") => servePlayback(new Request(url, { headers, method }), source);
  return { findMedia, readRange, source, request, row };
}

describe("published playback", () => {
  it.each([
    ["bytes=2-5", 2, 5], ["bytes=7-", 7, 9], ["bytes=-2", 8, 9], ["bytes=8-99", 8, 9], ["bytes=-100", 0, 9],
  ] as const)("serves single Range %s", async (range, start, end) => {
    const r = await fixture().request({range});
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes ${start}-${end}/10`);
    expect(r.headers.get("content-length")).toBe(String(end - start + 1));
    expect(r.headers.get("etag")).toBeNull();
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual(Array.from({length: end - start + 1}, (_, i) => i + start));
  });

  it.each(["bytes=-0", "bytes=10-", "bytes=3-2", "bytes=0-1,3-5", "bytes=-", "seconds=0-1"])("rejects %s only while active", async range => {
    const f = fixture();
    const response = await f.request({range});
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(response.headers.get("cache-control")).toBe("no-store");
    f.findMedia.mockResolvedValue(null);
    const revoked = await f.request({range});
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get("content-range")).toBeNull();
    expect(f.readRange).not.toHaveBeenCalled();
  });

  it("serves complete GET and ignores ranges on HEAD and If-Range", async () => {
    const f = fixture();
    const head = await f.request({range: "bytes=2-3"}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("content-length")).toBe("10");
    expect(f.readRange).not.toHaveBeenCalled();
    for (const response of [await f.request(), await f.request({range: "bytes=1-2", "if-range": '"v0"'})]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-range")).toBeNull();
      expect((await response.arrayBuffer()).byteLength).toBe(10);
    }
  });

  it("closes revoked and superseded generations before first byte and errors an in-flight stream", async () => {
    const f = fixture(PLAYBACK_CHUNK_BYTES + 10);
    const first = await f.request();
    const reader = first.body!.getReader();
    expect((await reader.read()).value?.length).toBe(PLAYBACK_CHUNK_BYTES);
    f.findMedia.mockResolvedValue(null);
    await expect(reader.read()).rejects.toThrow("playback interrupted");
    expect((await f.request({range:"bytes=0-1"})).status).toBe(404);
    f.findMedia.mockResolvedValueOnce(f.row).mockResolvedValueOnce(null);
    expect((await f.request()).status).toBe(404);
  });

  it("errors on invalid range headers, version or body length", async () => {
    for (const field of ["etag","content-range","content-length","content-encoding","short"]) {
      const f = fixture();
      const h = new Headers({etag: f.row.version, "content-range":"bytes 0-9/10","content-length":"10"});
      if (field !== "short") h.set(field, "invalid");
      f.readRange.mockResolvedValue(new Response(new Uint8Array(9), { status: 206, headers: h }));
      expect((await f.request()).status).toBe(503);
    }
  });

  it("bounds first-byte time and cancels a pending range read", async () => {
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.readRange.mockImplementation(async (_row, _start, _end, value) => {
      signal = value;
      return new Promise(() => {});
    });
    const r = await servePlayback(new Request(url), f.source, 20);
    expect(r.status).toBe(503);
    expect(signal?.aborted).toBe(true);
  });

  it("bounds provider initialization and stops the next read when the client disconnects", async () => {
    const cold = await servePlayback(new Request(url), () => new Promise(() => {}), 20);
    expect(cold.status).toBe(503);
    const f = fixture(PLAYBACK_CHUNK_BYTES + 10);
    const caller = new AbortController();
    const result = await servePlayback(new Request(url, { signal: caller.signal }), f.source);
    const reader = result.body!.getReader();
    await reader.read();
    caller.abort();
    await expect(reader.read()).rejects.toThrow("playback interrupted");
    expect(f.readRange).toHaveBeenCalledTimes(1);
  });

  it("rejects inactive, mismatched and noncanonical addresses", async () => {
    const f = fixture();
    expect((await servePlayback(new Request(url), { mode:"inactive" })).status).toBe(404);
    expect((await servePlayback(new Request(url.replace(".mp4", ".m4a")), f.source)).status).toBe(404);
    expect((await servePlayback(new Request(url + "?q=1"), f.source)).status).toBe(404);
    expect((await f.request({}, "POST")).status).toBe(405);
  });

  it("only publishes canonical paths from whitelisted list metadata and accepts old rows", () => {
    const base = { generation:"1", approvedMs:"1", display:{ creator:"a", description:"b", format:"c", genre:"d", height:1, kind:"영상", subtitle:"e", title:"f", width:1 }};
    const snapshot = readApprovedSnapshot({nowMs:"1", rows:[
      { ...base, slug:"a" }, { ...base, slug:"b", media:{ kind:"audio", ext:"m4a" } },
      { ...base, slug:"c", media:{ kind:"audio", ext:"mp4" } },
    ]});
    expect(snapshot.ids).toEqual(["a","b"]);
    expect(snapshot.records[1].artifact).toEqual({state:"complete",media:{kind:"audio",src:"/media/public/b/1/play.m4a"}});
  });
});
