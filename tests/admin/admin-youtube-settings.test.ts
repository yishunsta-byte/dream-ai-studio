import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YouTubeSettingsCard } from "@/components/admin/admin-youtube-settings";
import { isYouTubeKeyFormat, keyStatusText, readYouTubeKey, saveYouTubeKey } from "@/components/admin/youtube-key-client";
import { youtubeCredentialPath } from "@/lib/reference-analysis/youtube-credential-contract";

const KEY = "SYNTHETIC-ONLY-YOUTUBE-KEY-1234567890";
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const saved = { configured: true, version: 2, updatedAt: "2026-11-21T01:00:00.000Z" } as const;
afterEach(() => vi.unstubAllGlobals());

describe("P1-08 관리자 YouTube 키 등록·교체(화면 쪽 통신)", () => {
  it("상태 조회는 같은 출처 GET 한 번이고, 계약 밖 필드(키·끝자리 등)가 섞인 응답은 쓰지 않는다", async () => {
    const send = vi.fn(async () => reply(200, { configured: false, version: 0, updatedAt: null }));
    vi.stubGlobal("fetch", send);
    expect(await readYouTubeKey()).toEqual({ kind: "ok", value: { configured: false, version: 0, updatedAt: null } });
    expect(send).toHaveBeenCalledWith(youtubeCredentialPath, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }));
    send.mockResolvedValueOnce(reply(200, { ...saved, last4: "7890" }));
    expect(await readYouTubeKey()).toEqual({ kind: "failed" });
    send.mockResolvedValueOnce(reply(503, { code: "storage_unavailable" }));
    expect(await readYouTubeKey()).toEqual({ kind: "storage" });
    send.mockResolvedValueOnce(reply(401, { error: "AUTH_REQUIRED" }));
    expect(await readYouTubeKey()).toEqual({ kind: "login" });
  });

  it("등록·교체는 PUT {expectedVersion, apiKey}뿐이고 409·400·503을 구분한다", async () => {
    const send = vi.fn(async (_uri: string, init: RequestInit) => { void init; return reply(200, saved); });
    vi.stubGlobal("fetch", send);
    expect(await saveYouTubeKey(1, KEY)).toEqual({ kind: "ok", value: saved });
    const init = send.mock.calls[0][1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 1, apiKey: KEY });
    send.mockResolvedValueOnce(reply(409, { code: "stale" }));
    expect(await saveYouTubeKey(1, KEY)).toEqual({ kind: "stale" });
    send.mockResolvedValueOnce(reply(400, { code: "invalid_input" }));
    expect(await saveYouTubeKey(1, KEY)).toEqual({ kind: "invalid" });
    send.mockResolvedValueOnce(reply(503, { code: "storage_unavailable" }));
    expect(await saveYouTubeKey(1, KEY)).toEqual({ kind: "storage" });
    send.mockResolvedValueOnce(reply(200, { configured: false, version: 0, updatedAt: null }));
    expect(await saveYouTubeKey(0, KEY)).toEqual({ kind: "failed" });
  });

  it("키 형식은 서버 계약과 같다(16~256자 영문·숫자·밑줄·하이픈)", () => {
    expect(isYouTubeKeyFormat(KEY)).toBe(true);
    expect(isYouTubeKeyFormat("short")).toBe(false);
    expect(isYouTubeKeyFormat("has space in the key value")).toBe(false);
  });

  it("상태 설명: 미등록, 저장만 됨(형식만 확인), 같은 버전의 검색에서 받아들임·거절. 다른 버전의 검색 결과는 쓰지 않는다", () => {
    expect(keyStatusText({ configured: false, version: 0, updatedAt: null }, null).text).toMatch(/^미등록/);
    expect(keyStatusText(saved, null).text).toBe("저장됨(버전 2) · 공개 쇼츠 검색에서 현재 연결을 확인할 수 있어요.");
    expect(keyStatusText(saved, { version: 1, result: "accepted", at: saved.updatedAt }).text).toMatch(/현재 연결/);
    expect(keyStatusText(saved, { version: 2, result: "accepted", at: saved.updatedAt })).toMatchObject({ tone: "success", text: expect.stringMatching(/YouTube가 키를 받아들였어요/) });
    expect(keyStatusText(saved, { version: 2, result: "rejected", at: saved.updatedAt })).toMatchObject({ tone: "danger", text: expect.stringMatching(/거절했어요\. 키를 교체해 주세요/) });
  });

  it("서버 렌더에서는 불러오는 중만 그리고 키 입력은 없다", () => {
    const html = renderToStaticMarkup(createElement(YouTubeSettingsCard));
    expect(html).toContain("YouTube 검색 키");
    expect(html).toContain("YouTube 키 상태를 불러오고 있어요.");
    expect(html).not.toContain("<input");
  });
});
