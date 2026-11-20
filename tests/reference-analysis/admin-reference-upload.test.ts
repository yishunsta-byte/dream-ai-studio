import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { mediaBinary, runMedia } from "../../lib/media/tools";
import { createAdminReferenceHttp } from "../../lib/reference-analysis/admin-reference-http";
import { referenceUploadByteLimit, type ReferenceMedia } from "../../lib/reference-analysis/input";
import { analyzeLocalMediaUpload, analyzeLocalMediaUrl } from "../../lib/reference-analysis/local-media-url";

vi.mock("server-only", () => ({}));

const origin = "https://studio.example.com";
const target = `${origin}/api/admin/reference-analysis`;
const host = new URL(origin).host;
const adminOptions = {
  authenticate: async () => ({ kind: "verified", userId: "10000000-0000-4000-8000-000000000011", email: "admin@example.com" } as const),
  env: { DREAM_SITE_URL: origin },
  analyzeUpload: analyzeLocalMediaUpload,
  analyze: analyzeLocalMediaUrl,
};

function upload(
  name: string, media: string, body?: BodyInit, options: { signal?: AbortSignal; headers?: HeadersInit } = {},
) {
  const headers = new Headers({
    host, origin, "content-type": "application/octet-stream",
    "x-dream-filename": encodeURIComponent(name), "x-dream-media": media,
  });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  const init = { method: "POST", headers, body, signal: options.signal, duplex: "half" as const };
  return new Request(target, init);
}

function urlRequest(media?: ReferenceMedia) {
  return new Request(target, {
    method: "POST", headers: { host, origin, "content-type": "application/json" },
    body: JSON.stringify({ url: "https://mdn.github.io/material.png", authorized: true, media }),
  });
}

async function tempUploads() {
  return (await readdir(tmpdir())).filter(name => name.startsWith("dream-rea-upload-")).sort();
}

describe("관리자 직접 파일 분석", () => {
  it("기존 관리자 인증과 출처 제한을 파일 입력보다 먼저 적용한다", async () => {
    const analyzeUpload = vi.fn();
    const anonymous = createAdminReferenceHttp({ ...adminOptions, authenticate: async () => ({ kind: "local" }), analyzeUpload });
    const admin = createAdminReferenceHttp({ ...adminOptions, analyzeUpload });
    expect((await anonymous.analyze(upload("source.png", "image", "data"))).status).toBe(401);
    expect((await admin.analyze(upload("source.png", "image", "data", { headers: { origin: "https://other.example.com" } }))).status).toBe(403);
    expect(analyzeUpload).not.toHaveBeenCalled();
  });

  it("업로드 조건과 URL 매체 선택을 입력 단계에서 검증한다", async () => {
    const admin = createAdminReferenceHttp(adminOptions);
    const cases: Array<[Request, number, string]> = [
      [upload("picture.png", "audio", "data"), 400, "invalid_input"],
      [upload("picture.png", "image", "data", { headers: { "x-dream-filename": "%ZZ" } }), 400, "invalid_file"],
      [upload("../picture.png", "image", "data"), 400, "invalid_file"],
      [upload("picture.png", "image"), 400, "invalid_file"],
      [upload("picture.png", "image", new Uint8Array()), 400, "invalid_file"],
      [upload("picture.gif", "image", "data"), 422, "unsupported_format"],
      [upload("picture.png", "video", "data"), 422, "file_type_mismatch"],
      [urlRequest("video"), 422, "file_type_mismatch"],
    ];
    for (const [request, status, error] of cases) {
      const response = await admin.analyze(request);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
  });

  it("동일한 이미지로 URL 및 업로드의 결과 스키마를 유지하고 위장된 파일을 거부한다", async () => {
    const bytes = new Uint8Array(await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#2867ac" },
    }).png().toBuffer());
    const before = await tempUploads();
    const fetch = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    try {
      const admin = createAdminReferenceHttp(adminOptions);
      const direct = await admin.analyze(upload("샘플 자료.png", "image", bytes));
      const legacy = await admin.analyze(urlRequest());
      const explicit = await admin.analyze(urlRequest("image"));
      expect(direct.status).toBe(200);
      expect(legacy.status).toBe(200);
      expect(explicit.status).toBe(200);
      const body = await direct.json();
      expect(body.result).toMatchObject({ schemaVersion: 1, status: "ready", media: "image" });
      expect(Object.keys(body.result).sort()).toEqual(["media", "proposals", "schemaVersion", "status"]);
      expect(body.result.proposals.length).toBeGreaterThan(0);
      expect(await legacy.json()).toEqual(body);
      expect(await explicit.json()).toEqual(body);
      const spoofed = await admin.analyze(upload("picture.mp4", "video", bytes));
      expect(spoofed.status).toBe(422);
      expect(await spoofed.json()).toEqual({ error: "file_type_mismatch" });
      const corrupt = await admin.analyze(upload("picture.png", "image", "corrupt"));
      expect(corrupt.status).toBe(422);
      expect(await corrupt.json()).toEqual({ error: "invalid_file" });
      expect(await tempUploads()).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("헤더 초과와 실제 스트림 초과를 막고 정확히 4 MiB는 검사까지 전달한다", async () => {
    const before = await tempUploads();
    const admin = createAdminReferenceHttp(adminOptions);
    const declared = await admin.analyze(upload("picture.png", "image", "data", {
      headers: { "content-length": String(referenceUploadByteLimit + 1) },
    }));
    expect(declared.status).toBe(413);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(referenceUploadByteLimit));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const overflow = await admin.analyze(upload("picture.png", "image", stream));
    expect(overflow.status).toBe(413);
    expect(await overflow.json()).toEqual({ error: "too_large" });
    expect(cancel).toHaveBeenCalledOnce();
    const boundary = await admin.analyze(upload("picture.png", "image", new Uint8Array(referenceUploadByteLimit)));
    expect(boundary.status).toBe(422);
    expect(await boundary.json()).toEqual({ error: "invalid_file" });
    expect(await tempUploads()).toEqual(before);
  });

  it.each(["cancelled", "timed_out"] as const)("수신 중 %s이면 정리하고 URL과 공유하는 분석 슬롯을 반환한다", async detail => {
    const transport = new AbortController();
    const deadline = new AbortController();
    const timer = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await tempUploads();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let start!: () => void;
    const reading = new Promise<void>(resolve => { start = resolve; });
    const body = new ReadableStream<Uint8Array>({ pull: start, cancel }, { highWaterMark: 0 });
    const admin = createAdminReferenceHttp(adminOptions);
    const running = admin.analyze(upload("picture.png", "image", body, { signal: transport.signal }));
    try {
      await Promise.race([reading, running.then(() => { throw new Error("분석이 본문을 읽기 전에 응답했습니다."); })]);
      expect((await admin.analyze(urlRequest())).status).toBe(429);
      if (detail === "cancelled") transport.abort();
      else deadline.abort(new DOMException("test deadline", "TimeoutError"));
      const interrupted = await running;
      expect(interrupted.status).toBe(422);
      expect(await interrupted.json()).toMatchObject({ error: "analysis_failed", stage: "download", detail });
      expect(cancel).toHaveBeenCalledOnce();
      expect((await admin.analyze(upload("picture.png", "image"))).status).toBe(400);
      expect(await tempUploads()).toEqual(before);
    } finally {
      transport.abort();
      timer.mockRestore();
      log.mockRestore();
    }
  });

  it("음악·영상 역시 실제 로컬 분석기로 처리한다", async () => {
    const temp = await mkdtemp(join(tmpdir(), "reference-upload-test-"));
    try {
      const audioPath = join(temp, "sample.wav");
      const videoPath = join(temp, "sample.mp4");
      const output = { windowsHide: true };
      const ffmpeg = mediaBinary("ffmpeg");
      await runMedia(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=1",
        "-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "pcm_s16le", audioPath], output);
      await runMedia(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=10:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath], output);
      const admin = createAdminReferenceHttp(adminOptions);
      const music = await admin.analyze(upload("sample.wav", "music", new Uint8Array(await readFile(audioPath))));
      const moving = await admin.analyze(upload("sample.mp4", "video", new Uint8Array(await readFile(videoPath))));
      expect(music.status).toBe(200);
      expect(moving.status).toBe(200);
      expect(await music.json()).toMatchObject({ result: { schemaVersion: 1, status: "ready", media: "music" } });
      expect(await moving.json()).toMatchObject({ result: { schemaVersion: 1, status: "ready", media: "video" } });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
