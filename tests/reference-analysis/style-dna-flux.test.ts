import sharp from "sharp";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createFluxAdapter, fluxEndpoint, fluxEstimate, fluxOutput } from "@/lib/reference-analysis/style-dna-flux-provider";

vi.mock("server-only", () => ({}));
const id = "44d67c3b-fa5d-4d2f-9ef0-219a89cef76a";
const polling = "https://api.eu4.bfl.ai/v1/get_result?id=" + id;
const download = "https://delivery.us1.bfl.ai/out.png?signature=fixture";
const request = { apiKey: "bfl-fixture-key", prompt: "A warm street" };
const accepted = (url = polling) => Response.json({ id, polling_url: url });
const ready = (url = download, taskId = id) => Response.json({ id: taskId, status: "Ready", result: { sample: url } });
const file = (bytes: Buffer, contentType = "image/png") => new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } });
let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: fluxOutput.width, height: fluxOutput.height, channels: 3, background: "#72a3b2" } }).png().toBuffer();
});

describe("FLUX.2 pro provider boundary", () => {
  it("rounds reference and output independently, caps one reference at 4 MP, and prices zero references accurately", () => {
    expect(fluxEstimate()).toMatchObject({ referenceCount: 0, totalMicros: 30_000 });
    expect(fluxEstimate({ width: 1024, height: 1024 })).toMatchObject({ referenceCount: 1, totalMicros: 45_000 });
    expect(fluxEstimate({ width: 1025, height: 1024 }, { width: 1025, height: 1024 }))
      .toMatchObject({ outputMicros: 45_000, referenceMicros: 30_000, totalMicros: 75_000 });
    expect(fluxEstimate({ width: 3000, height: 3000 }).referenceMicros).toBe(60_000);
    expect(() => fluxEstimate({ width: Infinity, height: 1024 })).toThrow();
  });

  it("submits once, polls the returned regional path, and downloads without credentials", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ id, status: "Generating" }))
      .mockResolvedValueOnce(ready()).mockResolvedValueOnce(file(png));
    const result = await createFluxAdapter(send, { pollDelayMs: 1 }).generate({ ...request, reference: Buffer.from("fixture reference") });
    expect(send.mock.calls.map(([url]) => url)).toEqual([fluxEndpoint, polling, polling, download]);
    expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual({ prompt: request.prompt, width: 1024, height: 1024,
      output_format: "png", input_image: Buffer.from("fixture reference").toString("base64") });
    expect(new Headers(send.mock.calls[0][1]?.headers).get("x-key")).toBe(request.apiKey);
    for (const [url, init] of send.mock.calls.slice(1)) {
      expect(init).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
      expect(new Headers(init?.headers).get("x-key")).toBe(url === polling ? request.apiKey : null);
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
    }
    expect(result.png).toEqual({ width: 1024, height: 1024, byteLength: png.length,
      sha256: createHash("sha256").update(png).digest("hex") });
    expect(result.image).toMatchObject({ width: 1024, height: 1024, mime: "image/webp" });
  });

  it("retries a transient poll without repeating the submission", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockRejectedValueOnce(new Error("Temporary network error"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(ready()).mockResolvedValueOnce(file(png));
    await expect(createFluxAdapter(send, { pollDelayMs: 1 }).generate(request)).resolves.toHaveProperty("image.mime", "image/webp");
    expect(send.mock.calls.map(([url]) => url)).toEqual([fluxEndpoint, polling, polling, polling, download]);
  });

  it.each([
    "https://api.bfl.ai.example.invalid/v1/get_result?id=" + id,
    "https://api.bfl.ai@other.invalid/v1/get_result?id=" + id,
    polling.replace(id, "different"),
    polling + "&id=" + id,
    polling.replace("/v1/get_result", "/elsewhere"),
    polling.replace("https:", "http:"),
  ])("rejects a poll outside the returned task boundary", async url => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted(url));
    await expect(createFluxAdapter(send).generate(request)).rejects.toMatchObject({ code: "invalid_model_response", keepPending: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [ready(download, "wrong-task"), "invalid_model_response"],
    [ready("https://delivery.us1.bfl.ai.example.invalid/out.png?signature=fixture"), "invalid_model_response"],
    [ready(download + "&Expires=10"), "generation_result_lost"],
  ])("rejects an unbound or expired result before download", async (response, code) => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted()).mockResolvedValueOnce(response);
    await expect(createFluxAdapter(send, { now: () => 11_000 }).generate(request)).rejects.toMatchObject({ code, keepPending: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => new Response(null, { status: 403 }),
    () => new Response(null, { status: 302, headers: { location: "https://outside.invalid" } }),
    () => new Response("invalid", { headers: { "content-type": "image/png" } }),
    () => new Response("invalid", { headers: { "content-type": "image/png", "content-length": "99999999" } }),
    () => file(png, "text/plain"),
  ])("does not accept image failure or follow redirects", async reply => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted()).mockResolvedValueOnce(ready()).mockResolvedValueOnce(reply());
    await expect(createFluxAdapter(send).generate(request)).rejects.toMatchObject({ keepPending: true });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("distinguishes an uncertain submit, a timed-out accepted task, and explicit moderation", async () => {
    const lost = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("lost"));
    await expect(createFluxAdapter(lost).generate(request)).rejects.toMatchObject({ code: "generation_submission_unknown", keepPending: true });
    const pending = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockImplementation(async () => Response.json({ id, status: "Pending" }));
    await expect(createFluxAdapter(pending, { deadlineMs: 12, pollDelayMs: 4 }).generate(request)).rejects
      .toMatchObject({ code: "generation_result_lost", keepPending: true });
    const rejected = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ id, status: "Content Moderated" }));
    await expect(createFluxAdapter(rejected).generate(request)).rejects.toMatchObject({ code: "content_rejected", keepPending: false });
  });
});
