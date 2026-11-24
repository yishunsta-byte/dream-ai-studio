import { afterEach, expect, it, vi } from "vitest";
import { version } from "uuid";
import { createPrivatePngUpload } from "../components/cloud/private-png-request";
import { createProjectFormRequest } from "../components/project-form-request";

afterEach(() => vi.unstubAllGlobals());

it("keeps a pending upload recoverable after rejecting an invalid rights note", async () => {
  const { post, key, upload } = setup();
  const file = new File(["image"], "product.png");
  const limit = "한".repeat(500);
  post.mockRejectedValueOnce(new TypeError("upload response lost"))
    .mockResolvedValueOnce(Response.json({ id: "asset-a" }, { status: 201 }));
  await expect(upload(file, limit)).rejects.toThrow("upload response lost");
  await expect(upload(file, limit + "글")).rejects.toThrow("500");
  await expect(upload(file, "a\0b")).rejects.toThrow("널 문자");
  expect(post).toHaveBeenCalledTimes(1);
  await expect(upload(file, " " + limit + " ")).resolves.toBe("asset-a");
  expect(post).toHaveBeenCalledTimes(2);
  expect(key(1)).toBe(key(0));
  const query = new URL(String(post.mock.calls[1][0]), "http://localhost").searchParams;
  expect(query.get("rightsNote")).toBe(limit);
});

function setup() {
  const post = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", post);
  const key = (i: number) => new Headers(post.mock.calls[i][1]?.headers).get("Idempotency-Key")!;
  return { post, key, upload: createPrivatePngUpload() };
}

it("recovers independently from loss of the upload and project responses", async () => {
  const { post, key, upload } = setup();
  const save = createProjectFormRequest();
  const file = new File(["image"], "a & b.png", { type: "image/png" });
  const submit = async () => save("shopping-shorts", { productAssets: [await upload(file)] });
  post.mockRejectedValueOnce(new TypeError("upload response lost"))
    .mockResolvedValueOnce(Response.json({ id: "asset-a" }, { status: 201 }))
    .mockRejectedValueOnce(new TypeError("project response lost"))
    .mockResolvedValueOnce(Response.json({ id: "project-a" }, { status: 201 }));
  await expect(submit()).rejects.toThrow("upload response lost");
  await expect(submit()).rejects.toThrow("project response lost");
  await expect(submit()).resolves.toEqual({ id: "project-a" });
  expect(post).toHaveBeenCalledTimes(4);
  const url = new URL(String(post.mock.calls[0][0]), "http://localhost");
  expect(url.pathname).toBe("/api/assets/upload");
  expect(url.searchParams.get("filename")).toBe(file.name);
  expect(post.mock.calls[0][1]?.body).toBe(file);
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  expect(post.mock.calls[2][0]).toBe("/api/projects");
  expect(JSON.parse(String(post.mock.calls[2][1]?.body)).inputs.productAssets).toEqual(["asset-a"]);
  expect(post.mock.calls[3]).toEqual(post.mock.calls[2]);
  expect(version(key(0))).toBe(7);
  expect(version(key(2))).toBe(7);
  expect(key(0)).not.toBe(key(2));
});

it("only caches a confirmed ID and separates same-name selections and form instances", async () => {
  const { post, key, upload } = setup();
  const first = new File(["one"], "product.png");
  const replacement = new File(["two"], first.name);
  post.mockResolvedValueOnce(Response.json({ error: "retry" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ id: "first" }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ id: "replacement" }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ id: "new-form" }, { status: 201 }));
  await expect(upload(first)).rejects.toThrow("retry");
  await expect(upload(first)).rejects.toThrow();
  await expect(upload(first)).resolves.toBe("first");
  await expect(upload(replacement)).resolves.toBe("replacement");
  await expect(upload(first)).resolves.toBe("first");
  await expect(createPrivatePngUpload()(first)).resolves.toBe("new-form");
  expect(post).toHaveBeenCalledTimes(5);
  expect(key(1)).toBe(key(0));
  expect(key(2)).toBe(key(0));
  expect(new Set([key(0), key(3), key(4)]).size).toBe(3);
});
