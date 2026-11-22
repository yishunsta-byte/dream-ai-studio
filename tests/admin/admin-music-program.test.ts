import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminMusicSemantic, AudioReport } from "@/components/admin/admin-music-semantic";
import { createAdminMusicSemanticClient, MEDIA_UNAVAILABLE_MESSAGE } from "@/components/admin/admin-music-semantic-client";
import type { AdminAudioResponse } from "@/lib/reference-analysis/admin-audio-contract";
import { MUSIC_EXTERNAL_CONSENT_HEADER, MUSIC_SEMANTIC_URI } from "@/lib/reference-analysis/music-semantic-contract";

// P1-07 첫 이식 화면 쪽(서버 경로 시험은 tests/reference-analysis/admin-music-semantic.test.ts).
const report = { genre: "앰비언트", instruments: ["피아노"], tempoBpm: 96,
  structure: [{ label: "도입", description: "잔잔한 피아노 뒤에 리듬이 들어와요." }], sunoPrompt: "Ambient piano, understated drums, 96 BPM" };
const result = { status: "ready", provider: "gemini", report } as const;
const wav = () => new Uint8Array([..."RIFF"].map(char => char.charCodeAt(0)).concat(Array(40).fill(0)));

describe("P1-07 관리자 음악 분석 클라이언트", () => {
  it("동의 없이는 보내지 않고, 선택한 파일만 같은 출처 음악 경로로 보낸다", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ semantic: { music: "configured" } }))
      .mockResolvedValueOnce(Response.json({ semantic: result }));
    const client = createAdminMusicSemanticClient(send);
    const file = new File([wav()], "검수 곡.wav");
    expect((await client.analyze(file, false)).kind).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(await client.availability()).toEqual({ kind: "ok", configured: true });
    expect(send.mock.calls[0]).toMatchObject([MUSIC_SEMANTIC_URI, { method: "GET", credentials: "same-origin", cache: "no-store" }]);
    expect(await client.analyze(file, true)).toEqual({ kind: "ok", result });
    expect(send.mock.calls[1]).toMatchObject([MUSIC_SEMANTIC_URI, { method: "POST", body: file, credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", "x-dream-filename": encodeURIComponent(file.name), [MUSIC_EXTERNAL_CONSENT_HEADER]: "true" } }]);
  });

  it("요청 오류는 상태별 한국어 안내로, 알 수 없는 응답·네트워크 오류는 다시 시도 안내로 바꾼다", async () => {
    const file = new File([wav()], "a.wav");
    const messages: Record<number, RegExp> = { 400: /동의를 확인/, 401: /다시 로그인/, 403: /관리자 권한/, 413: /4 MiB까지/, 415: /파일 전송 형식/,
      422: /파일 형식과 내용을 확인/, 429: /다른 오디오 분석이 진행 중/, 500: /응답을 확인하지 못했어요/, 503: /연결할 수 없어요/ };
    for (const [status, pattern] of Object.entries(messages)) {
      const outcome = await createAdminMusicSemanticClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: Number(status) }))).analyze(file, true);
      expect(outcome).toMatchObject({ kind: "failed", message: expect.stringMatching(pattern) });
    }
    const broken = await createAdminMusicSemanticClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ semantic: { status: "ready" } }))).analyze(file, true);
    expect(broken).toMatchObject({ kind: "failed", message: expect.stringMatching(/다시 시도/) });
    const offline = await createAdminMusicSemanticClient(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"))).availability();
    expect(offline.kind).toBe("failed");
  });
});

describe("P1-07 A-2 서버 오디오 검사 도구 준비 실패(503 media_unavailable)", () => {
  it("세 바로 분석 경로 모두 검사 도구 준비 실패를 서비스 연결 실패와 다르게 안내한다(Gemini로 보내지 않음)", async () => {
    const file = new File([wav()], "곡.FLAC");
    const tool = () => vi.fn<typeof fetch>(async () => Response.json({ error: "media_unavailable" }, { status: 503 }));
    const other = () => vi.fn<typeof fetch>(async () => Response.json({ error: "unavailable" }, { status: 503 }));
    for (const make of [tool, other]) {
      const client = createAdminMusicSemanticClient(make());
      const replies = [await client.analyze(file, true), await client.analyzeAudio(file, "auto", true), await client.analyzeDetailed(file, "speech", true)];
      for (const reply of replies) {
        expect(reply).toEqual({ kind: "failed", message: make === tool ? MEDIA_UNAVAILABLE_MESSAGE : expect.stringMatching(/연결할 수 없어요/) });
      }
    }
    expect(MEDIA_UNAVAILABLE_MESSAGE).toMatch(/Gemini로 보내지 않았어요/);
    const bare = createAdminMusicSemanticClient(vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status: 503 })));
    expect(await bare.analyze(file, true)).toMatchObject({ kind: "failed", message: expect.stringMatching(/연결할 수 없어요/) });
  });
});

describe("P1-07 관리자 음악 분석 화면(서버 렌더)", () => {
  it("파일이 없으면 안내만, 결과 공개 준비 조작은 없다", () => {
    const html = renderToStaticMarkup(createElement(AdminMusicSemantic));
    expect(html).toContain("음악 파일을 선택하면 의미 분석을 실행할 수 있어요.");
    expect(html).not.toMatch(/공개 준비|<button|<input/);
  });

});

describe("P1-07 자동·음성 모드(0e511a0 계약)", () => {
  const speech: AdminAudioResponse = { schemaVersion: 1, requestedMode: "speech", status: "partial", provider: "gemini", kind: "speech",
    report: { summary: null, topicsAndKeywords: [{ topic: "출시", keywords: null }], actionItems: [{ task: "체크리스트", assignee: null, dueDate: null }],
      fullTranscription: [{ speaker: null, timestamp: null, text: "베타는 12월이에요." }] } };

  it("동의 없이는 보내지 않고, 모드 머리글을 더해 새 경로로 보내며 다른 모드·형식이 틀린 응답은 받지 않는다", async () => {
    const file = new File([wav()], "회의.m4a");
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(speech))
      .mockResolvedValueOnce(Response.json({ ...speech, requestedMode: "auto" })).mockResolvedValueOnce(Response.json({ ...speech, schemaVersion: 2 }));
    const client = createAdminMusicSemanticClient(send);
    expect((await client.analyzeAudio(file, "speech", false)).kind).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(await client.analyzeAudio(file, "speech", true)).toEqual({ kind: "ok", result: speech });
    expect(send.mock.calls[0]).toMatchObject(["/api/admin/audio-analysis", { method: "POST", body: file, credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/octet-stream", "x-dream-filename": encodeURIComponent(file.name), [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", "x-dream-audio-mode": "speech" } }]);
    expect((await client.analyzeAudio(file, "speech", true)).kind).toBe("failed");
    expect((await client.analyzeAudio(file, "auto", true)).kind).toBe("failed");
  });

  it("음성 보고서는 근거 없는 칸을 '알 수 없음'으로, 자동 판별 불가·판별 뒤 실패를 구분하고, 음악 판별은 기존 음악 보고서를 쓴다", () => {
    const view = renderToStaticMarkup(createElement(AudioReport, { result: speech }));
    expect(view).toContain("음성 분석 결과");
    expect(view).toContain("Gemini 추정 · 일부 항목만 확인");
    expect(view.match(/알 수 없음/g)!.length).toBeGreaterThanOrEqual(5);
    expect(view).toMatch(/요약<\/h5><p>알 수 없음<\/p>/);
    expect(view).toContain("키워드 알 수 없음");
    expect(view).toContain("담당 알 수 없음 · 기한 알 수 없음");
    expect(view).toContain("화자 알 수 없음");
    expect(view).toContain("시각 알 수 없음");
    expect(view).toContain("시각은 음원 시작 기준 추정값이에요.");
    expect(view).not.toContain("자동 판별 결과");

    const undetermined = renderToStaticMarkup(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "auto", status: "unavailable", kind: "undetermined", reason: "undetermined" } }));
    expect(undetermined).toContain("자동 판별 결과 · 판별 불가");
    expect(undetermined).toContain("음악인지 음성인지 판별하지 못했어요. 자동으로 다시 보내지 않았어요.");
    const afterClassify = renderToStaticMarkup(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "auto", status: "unavailable", kind: "speech", reason: "timed_out" } }));
    expect(afterClassify).toContain("음성으로 판별했지만 보고서를 만들지 못했어요. 응답 시간이 길어졌어요.");

    const music = renderToStaticMarkup(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "auto", ...result, kind: "music" } }));
    expect(music).toContain("자동 판별 결과 · 음악");
    expect(music).toContain("음악 의미 분석 결과");
    expect(music).toContain("Ambient piano, understated drums, 96 BPM");
    expect(music).not.toContain("공개 준비");
  });
});
