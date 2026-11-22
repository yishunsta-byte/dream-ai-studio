import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteStyleDna } from "@/components/admin/style-dna-client";

// P1-06 ④-4b 보관함 삭제 요청(Backend 0727932 계약): 같은 출처·본문 없음·Content-Type 없음, 204는 본문을 읽지 않는다.
const id = "0190b0b0-0000-7000-8000-00000000b001";
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("P1-06 보관함 삭제 요청(deleteStyleDna)", () => {
  it("DELETE /api/admin/style-dna/{id}, 본문·Content-Type 없이 같은 출처로 보내고 204는 성공", async () => {
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, "json");
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    await expect(deleteStyleDna(id)).resolves.toEqual({ kind: "ok", value: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(`/api/admin/style-dna/${id}`);
    expect(init).toMatchObject({ method: "DELETE", credentials: "same-origin", cache: "no-store" });
    expect([init.body, init.headers]).toEqual([undefined, undefined]);
    expect(json).not.toHaveBeenCalled();
  });

  it("404 없음·다시 삭제·다른 계정은 같은 not_found, 400 invalid_input, 503 저장소 미연결, 401·403, 그 밖은 failed", async () => {
    const cases: [Response, unknown][] = [
      [reply(404, { code: "not_found" }), { kind: "error", code: "not_found", status: 404 }],
      [reply(400, { code: "invalid_input" }), { kind: "error", code: "invalid_input", status: 400 }],
      [reply(503, { code: "not_connected" }), { kind: "error", code: "storage_unavailable", status: 503 }],
      [new Response(null, { status: 503 }), { kind: "error", code: "storage_unavailable", status: 503 }],
      [reply(401, {}), { kind: "login" }],
      [reply(403, {}), { kind: "forbidden" }],
      [reply(500, { code: "boom" }), { kind: "error", code: "failed", status: 500 }],
      [new Response("not json", { status: 502 }), { kind: "error", code: "failed", status: 502 }],
    ];
    for (const [response, expected] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      await expect(deleteStyleDna(id)).resolves.toEqual(expected);
    }
  });

  it("연결이 끊기면 lost(지워졌는지 모름), 멈추면 그대로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(deleteStyleDna(id)).resolves.toEqual({ kind: "lost" });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(deleteStyleDna(id, controller.signal)).rejects.toThrow("aborted");
  });
});
