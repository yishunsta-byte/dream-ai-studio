import { afterEach, expect, it, vi } from "vitest";
import { createPrivatePngUpload } from "../components/cloud/private-png-request";

afterEach(() => vi.unstubAllGlobals());

it("retries the same note and issues a new key for edits and removal", async () => {
  const post = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(Response.json({ id: "first" }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ id: "edited" }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ id: "removed" }, { status: 201 }));
  vi.stubGlobal("fetch", post);
  const upload = createPrivatePngUpload();
  const file = new File(["png"], "사진.png");
  await expect(upload(file, "  직접 촬영 & 편집  ")).rejects.toThrow();
  await expect(upload(file, "직접 촬영 & 편집")).resolves.toBe("first");
  await expect(upload(file, " 직접 촬영 & 편집 ")).resolves.toBe("first");
  await expect(upload(file, "사용 허락")).resolves.toBe("edited");
  await expect(upload(file, " ")).resolves.toBe("removed");
  const keys = post.mock.calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));
  expect(keys[0]).toBe(keys[1]);
  expect(new Set(keys).size).toBe(3);
  const notes = post.mock.calls.map(([url]) => new URL(String(url), "https://test.invalid").searchParams.get("rightsNote"));
  expect(notes).toEqual(["직접 촬영 & 편집", "직접 촬영 & 편집", "사용 허락", null]);
});
