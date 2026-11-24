import { afterEach, expect, it, vi } from "vitest";
import { validate, version } from "uuid";
import { createProjectFormRequest } from "../components/project-form-request";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const post = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", post);
  const key = (index: number) => new Headers(post.mock.calls[index][1]?.headers).get("Idempotency-Key")!;
  return { post, key, send: createProjectFormRequest() };
}

it("reuses the UUIDv7 and body after losing the response", async () => {
  const { post, key, send } = setup();
  post.mockRejectedValueOnce(new TypeError("connection closed"))
    .mockResolvedValueOnce(Response.json({ id: "project-a" }, { status: 201 }));
  await expect(send("shopping-shorts", { title: "A" })).rejects.toThrow();
  await expect(send("shopping-shorts", { title: "A" })).resolves.toEqual({ id: "project-a" });
  expect(validate(key(0))).toBe(true);
  expect(version(key(0))).toBe(7);
  expect(key(1)).toBe(key(0));
  expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
  expect(post.mock.calls[0][0]).toBe("/api/projects");
  expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toEqual({ menuId: "shopping-shorts", inputs: { title: "A" } });
});

it("preserves field errors and starts a new request for a changed submission", async () => {
  const { post, key, send } = setup();
  const errors = { title: "제목을 입력해 주세요." };
  post.mockResolvedValueOnce(Response.json({ errors }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ id: "project-b" }, { status: 201 }));
  await expect(send("shopping-shorts", { title: "" })).resolves.toEqual({ errors });
  await send("shopping-shorts", { title: "B" });
  expect(key(1)).not.toBe(key(0));
});

it("sends only once during the request and after success while navigation is pending", async () => {
  const { post, send } = setup();
  const pending = Promise.withResolvers<Response>();
  post.mockReturnValueOnce(pending.promise);
  const first = send("shopping-shorts", {});
  await expect(send("shopping-shorts", {})).resolves.toBeUndefined();
  pending.resolve(Response.json({ id: "project-c" }, { status: 201 }));
  await first;
  await expect(send("shopping-shorts", {})).resolves.toBeUndefined();
  expect(post).toHaveBeenCalledTimes(1);
});
