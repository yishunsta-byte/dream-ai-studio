import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminAudioUpload, uploadProblemText } from "@/components/admin/admin-audio-upload";
import { AUDIO_ACCEPT, createAudioUploadClient, directAudioIssue, guidance, largeAudioIssue } from "@/components/admin/audio-upload-client";
import { audioFormatFromFilename } from "@/lib/reference-analysis/admin-audio-upload-contract";
import { adminAudioChunkBytes, adminAudioUploadLimit, adminAudioUploadsPath, audioUploadCommand, audioUploadStart } from "@/lib/reference-analysis/admin-audio-upload-contract";

// P1-07 원본 v1.15 100 MiB 업로드 화면 쪽 통신(서버 경로 시험은 Backend 298cc8f tests). 보낸 본문은 서버 계약 스키마로 다시 검사한다.
const id = "0190a0b0-0000-7000-8000-900000000001";
const requestId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const view = (extra: Record<string, unknown> = {}) => ({ id, status: "uploading", sizeBytes: 5 * 1024 * 1024, receivedBytes: 0, chunkBytes: adminAudioChunkBytes,
  expiresAt: "2026-11-22T03:00:00.000Z", cleanup: "none", ...extra });
const speech = { schemaVersion: 1, requestedMode: "speech", status: "ready", provider: "gemini", kind: "speech",
  report: { summary: "회의 요약", topicsAndKeywords: null, actionItems: null, fullTranscription: null } };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const sized = (size: number, name = "회의 녹음.wav") => {
  const file = new File(["RIFF"], name, { type: "audio/wav" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("P1-07 대용량 오디오 업로드 클라이언트", () => {
  it("접수·분할·분석·취소·정리를 서버 계약 그대로 같은 출처로 보낸다", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => json({ upload: view() }, 201));
    const client = createAudioUploadClient(send);
    const signal = new AbortController().signal;
    await client.start({ requestId, credentialVersion: 2, filename: "회의 녹음.wav", sizeBytes: 5 * 1024 * 1024 }, signal);
    const [startUri, startInit] = send.mock.calls[0];
    expect(startUri).toBe(adminAudioUploadsPath);
    expect(startInit).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "content-type": "application/json" } });
    expect(audioUploadStart.safeParse(JSON.parse(String(startInit?.body))).success).toBe(true);

    const bytes = new Blob([new Uint8Array(adminAudioChunkBytes)]);
    await client.chunk(id, adminAudioChunkBytes, bytes, signal);
    expect(send.mock.calls[1]).toMatchObject([`${adminAudioUploadsPath}/${id}/chunks`, { method: "PUT", body: bytes,
      headers: { "content-type": "application/octet-stream", "x-dream-upload-offset": String(adminAudioChunkBytes) } }]);

    await client.analyze(id, { requestId, credentialVersion: 2, mode: "speech", context: "회의 녹음\n화자 3명" }, signal);
    const analyze = JSON.parse(String(send.mock.calls[2][1]?.body));
    expect(audioUploadCommand.safeParse(analyze)).toMatchObject({ success: true });
    expect(analyze).toEqual({ action: "analyze", authorized: true, requestId, credentialVersion: 2, mode: "speech", context: "회의 녹음\n화자 3명" });
    expect("reportVersion" in analyze).toBe(false);

    await client.cancel(id, signal);
    await client.cleanup(id, signal);
    await client.read(id, signal);
    expect(send.mock.calls.slice(3).map(([uri, init]) => [uri, init?.method, init?.body])).toEqual([
      [`${adminAudioUploadsPath}/${id}`, "POST", JSON.stringify({ action: "cancel" })],
      [`${adminAudioUploadsPath}/${id}`, "POST", JSON.stringify({ action: "cleanup" })],
      [`${adminAudioUploadsPath}/${id}`, "GET", undefined],
    ]);
    for (const [, init] of send.mock.calls.slice(3, 5)) expect(audioUploadCommand.safeParse(JSON.parse(String(init?.body))).success).toBe(true);
  });

  it("응답을 상태·문제·유실로 나누고, v1 보고서만 받는다", async () => {
    const signal = new AbortController().signal;
    const reply = (response: Response | Error) => createAudioUploadClient(vi.fn<typeof fetch>().mockImplementation(async () => {
      if (response instanceof Error) throw response;
      return response;
    })).read(id, signal);
    expect(await reply(json({ upload: view({ status: "completed", receivedBytes: 5 * 1024 * 1024, cleanup: "done", report: speech }) })))
      .toMatchObject({ kind: "ok", status: 200, upload: { status: "completed", report: speech } });
    expect(await reply(json({ upload: view({ status: "analyzing" }) }, 202))).toMatchObject({ kind: "ok", status: 202 });
    expect(await reply(json({ code: "stale_credential", upload: view({ status: "uploaded", receivedBytes: 5 * 1024 * 1024 }) }, 409)))
      .toMatchObject({ kind: "problem", status: 409, code: "stale_credential", upload: { status: "uploaded" } });
    expect(await reply(json({ code: "storage_unavailable" }, 503))).toEqual({ kind: "problem", status: 503, code: "storage_unavailable" });
    // P1-07-AUDIO-UPLOAD-STORAGE-FEEDBACK: 관리자 감싸개의 일시 장애 응답 { error: "unavailable" }만 코드로 읽는다(code가 있으면 code가 먼저).
    expect(await reply(json({ error: "unavailable" }, 503))).toEqual({ kind: "problem", status: 503, code: "unavailable" });
    expect(await reply(json({ code: "expired", error: "unavailable" }, 410))).toEqual({ kind: "problem", status: 410, code: "expired" });
    // 그 밖의 error 원문은 코드로 옮기지 않는다(대소문자·공백이 다른 값, 다른 낱말, 문자열이 아닌 값).
    for (const error of ["AUTH_REQUIRED", "Unavailable", " unavailable", "unavailable ", "<b>서버 원문</b>", 503, null])
      expect(await reply(json({ error }, 503))).toEqual({ kind: "problem", status: 503, code: "" });
    expect(await reply(new TypeError("Failed to fetch"))).toEqual({ kind: "lost" });
    expect(await reply(new Response("not json", { status: 200 }))).toEqual({ kind: "lost" });
    // 받은 크기가 전체보다 크거나, 상세 v2 보고서·잘못된 보고서·모르는 상태면 확인 실패(유실)로 본다.
    expect(await reply(json({ upload: view({ receivedBytes: 6 * 1024 * 1024 }) }))).toEqual({ kind: "lost" });
    expect(await reply(json({ upload: view({ status: "completed", report: { ...speech, schemaVersion: 2 } }) }))).toEqual({ kind: "lost" });
    expect(await reply(json({ upload: view({ status: "done" }) }))).toEqual({ kind: "lost" });
    expect(await reply(json({}, 201))).toEqual({ kind: "lost" });
    const controller = new AbortController();
    const aborted = createAudioUploadClient(vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); throw new DOMException("aborted", "AbortError"); }));
    expect(await aborted.read(id, controller.signal)).toEqual({ kind: "aborted" });
  });

  it("음악 키 그룹 버전과 저장된 음악 모델로만 접수할 수 있다", async () => {
    const settings = (music: Record<string, unknown>, version: number) => ({ storage: "ready",
      groups: { reference: { version: 1, updatedAt: null }, music: { version, updatedAt: version ? "2026-11-20T01:00:00.000Z" : null } },
      programs: { image: { configured: false, source: "none", modelId: null }, shorts: { configured: false, source: "none", modelId: null }, music } });
    // 설정 읽기는 API연동 화면과 같은 readCredentialSettings(전역 fetch)를 쓴다.
    const original = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(json(settings({ configured: true, source: "stored", modelId: "gemini-music" }, 3)));
      expect(await createAudioUploadClient().settings(new AbortController().signal)).toEqual({ kind: "ok", configured: true, version: 3 });
      globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(json(settings({ configured: true, source: "environment", modelId: "gemini-env" }, 0)));
      expect(await createAudioUploadClient().settings(new AbortController().signal)).toEqual({ kind: "ok", configured: false, version: 0 });
      globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(json({}, 401));
      expect(await createAudioUploadClient().settings(new AbortController().signal)).toEqual({ kind: "failed", login: true });
    } finally { globalThis.fetch = original; }
  });

  it("파일 크기·이름을 서버 규칙으로 미리 보고, 입력은 앞뒤 공백을 뺀다", () => {
    expect(largeAudioIssue(sized(adminAudioUploadLimit))).toBeUndefined();
    expect(largeAudioIssue(sized(adminAudioUploadLimit + 1))).toBe("업로드는 100 MiB까지 가능해요.");
    expect(largeAudioIssue(sized(0))).toBe("내용이 있는 파일을 선택해 주세요.");
    expect(largeAudioIssue(sized(5, "track.ogg"))).toBe("MP3 · WAV · M4A · FLAC 확장자의 오디오 파일만 올릴 수 있어요.");
    expect(largeAudioIssue(sized(5, "a.m4a"))).toBeUndefined();
    expect(largeAudioIssue(sized(5, ".mp3"))).toMatch(/5~255자/);
    expect(largeAudioIssue(sized(5, `${"가".repeat(252)}.mp3`))).toMatch(/5~255자/);
    expect(largeAudioIssue(sized(5, `${"가".repeat(251)}.MP3`))).toBeUndefined();
    for (const name of ["회의 녹음.wav", "Track 01.M4A", `${"가".repeat(251)}.MP3`]) {
      expect(audioUploadStart.safeParse({ requestId, authorized: true, credentialVersion: 1, filename: name, sizeBytes: adminAudioUploadLimit }).success).toBe(true);
    }
    expect([guidance("  회의\n녹음 "), guidance("   "), guidance("a\0b")]).toEqual(["회의\n녹음", undefined, undefined]);
  });

  it("P1-07 A-2 FLAC: 바로 분석·보호 업로드·파일 선택이 서버와 같은 관리자 형식 판정을 쓴다(대소문자·한글 이름, 경계 4 MiB·100 MiB)", () => {
    for (const name of ["곡.flac", "회의 녹음.FLAC", "Mix.Flac", "a.wav", "b.MP3", "c.m4a"]) {
      expect(audioFormatFromFilename(name)).toBeTruthy();
      expect(directAudioIssue(sized(5, name))).toBeUndefined();
    }
    for (const name of ["track.ogg", "track.flac.txt", "track", "track.aac"]) {
      expect(directAudioIssue(sized(5, name))).toBe("MP3 · WAV · M4A · FLAC 확장자의 오디오 파일만 분석할 수 있어요.");
      expect(largeAudioIssue(sized(5, name))).toMatch(/MP3 · WAV · M4A · FLAC 확장자/);
    }
    expect(directAudioIssue(sized(4 * 1024 * 1024, "곡.flac"))).toBeUndefined();
    expect(directAudioIssue(sized(4 * 1024 * 1024 + 1, "곡.flac"))).toBe("바로 분석은 4 MiB까지 가능해요.");
    expect(directAudioIssue(sized(0, "곡.flac"))).toBe("내용이 있는 파일을 선택해 주세요.");
    expect(largeAudioIssue(sized(adminAudioUploadLimit, "긴 곡.FLAC"))).toBeUndefined();
    expect(largeAudioIssue(sized(adminAudioUploadLimit + 1, "긴 곡.FLAC"))).toBe("업로드는 100 MiB까지 가능해요.");
    for (const name of ["긴 곡.FLAC", "Live.flac"]) {
      expect(audioUploadStart.safeParse({ requestId, authorized: true, credentialVersion: 1, filename: name, sizeBytes: adminAudioUploadLimit }).success).toBe(true);
    }
    expect(AUDIO_ACCEPT).toBe(".mp3,.wav,.m4a,.flac");
  });

  it("서버 렌더에서는 설정 확인 안내만 그리고 요청하지 않는다", () => {
    const send = vi.fn<typeof fetch>();
    const html = renderToStaticMarkup(createElement(AdminAudioUpload, { file: sized(5 * 1024 * 1024), client: createAudioUploadClient(send) }));
    expect(html).toContain("업로드 후 분석");
    expect(html).toContain("음악 분석 설정을 확인하는 중이에요.");
    expect(html).not.toContain("서버에 올리기");
    expect(send).not.toHaveBeenCalled();
  });
  it("P1-07-AUDIO-UPLOAD-STORAGE-FEEDBACK: 503 일시 장애는 고정 업로드 안내, 다른 실패 문구는 그대로", () => {
    const fixed = "서버가 지금 업로드를 처리할 수 없어요. 잠시 뒤 다시 시도해 주세요.";
    expect(uploadProblemText(503, "unavailable")).toBe(fixed);
    // 기존 코드·상태 문구는 바뀌지 않는다.
    expect(uploadProblemText(503, "storage_unavailable")).toBe("업로드 저장소를 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요.");
    expect(uploadProblemText(410, "expired")).toBe("접수 보관 기한이 지나 서버가 정리했어요. 새로 올려 주세요.");
    expect(uploadProblemText(401, "")).toBe("다시 로그인한 뒤 시도해 주세요.");
    expect(uploadProblemText(403, "")).toBe("관리자 권한과 현재 사이트에서 보낸 요청인지 확인해 주세요.");
    // 코드가 없는 503과 모르는 코드는 예전 일반 안내 그대로(서버 원문을 보이지 않는다).
    expect(uploadProblemText(503, "")).toBe("응답을 확인하지 못했어요. 다시 시도해 주세요.");
    expect(uploadProblemText(500, "<b>서버 원문</b>")).toBe("응답을 확인하지 못했어요. 다시 시도해 주세요.");
  });
});
