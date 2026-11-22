import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { createStyleDnaHttp } from "@/lib/reference-analysis/style-dna-http";
import type { StyleDnaStore } from "@/lib/reference-analysis/style-dna-store";

vi.mock("server-only", () => ({}));

const owner = "10000000-0000-4000-8000-000000000011";
const other = "10000000-0000-4000-8000-000000000022";
const recordId = "0190b0b0-0000-7000-8000-00000000b001";
const testId = "0190b0b0-0000-7000-8000-00000000b002";
const route = { params: Promise.resolve({ id: recordId, media: testId }) };
const verified = (userId: string): ServerAuthResult => ({ kind: "verified", userId, email: "owner@example.invalid" });

function harness(auth: ServerAuthResult, image: Buffer) {
  const media: StyleDnaStore["media"] = vi.fn(async (actor, id, key) =>
    actor === owner && id === recordId && key === testId ? image : undefined);
  const store = vi.fn(() => ({ media }) as StyleDnaStore);
  return { http: createStyleDnaHttp({ authenticate: async () => auth, store }), media, store };
}

describe("Style DNA protected media streaming", () => {
  it.each([4_499_999, 4_500_001, 6_893_544])("streams all %i bytes in bounded chunks", async size => {
    const image = Buffer.alloc(size);
    for (let index = 0; index < size; index++) image[index] = index % 251;
    const { http, media } = harness(verified(owner), image);
    const response = await http.media(route);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBeNull();

    const reader = response.body!.getReader();
    const checksum = createHash("sha256");
    let length = 0;
    let maxChunk = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      maxChunk = Math.max(maxChunk, value.byteLength);
      checksum.update(value);
    }
    expect(length).toBe(size);
    expect(maxChunk).toBe(64 * 1024);
    expect(checksum.digest("hex")).toBe(createHash("sha256").update(image).digest("hex"));
    expect(media).toHaveBeenCalledWith(owner, recordId, testId);
  });

  it("checks authentication before opening storage and returns 404 for another owner", async () => {
    const image = Buffer.from([1]);
    const anonymous = harness({ kind: "local" }, image);
    expect((await anonymous.http.media(route)).status).toBe(401);
    expect(anonymous.store).not.toHaveBeenCalled();

    const unrelated = harness(verified(other), image);
    const response = await unrelated.http.media(route);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found" });
    expect(unrelated.media).toHaveBeenCalledWith(other, recordId, testId);
  });
});
