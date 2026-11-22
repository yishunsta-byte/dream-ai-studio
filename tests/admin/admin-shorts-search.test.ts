import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminShortsSearch, durationText, metricText, safeThumbnail, searchProblem } from "@/components/admin/admin-shorts-search";
import { searchYouTubeShorts } from "@/components/admin/youtube-search-client";
import { youtubeShortsSearchPath } from "@/lib/reference-analysis/youtube-shorts-search-contract";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = { id: "Fx00abcdefg", url: "https://www.youtube.com/watch?v=Fx00abcdefg", title: "후보", channelId: "UC" + "a".repeat(22), channelTitle: "채널",
  thumbnailUrl: null, publishedAt: "2026-11-01T03:00:00Z", durationSeconds: 30, views: 0, likes: null, comments: 0, subscribers: null };
afterEach(() => vi.unstubAllGlobals());

describe("P1-08 관리자 공개 쇼츠 검색(화면 쪽)", () => {
  it("검색은 계약 형식의 POST 하나이고, 선택 기간만 실어 보낸다", async () => {
    const send = vi.fn(async (_uri: string, init: RequestInit) => { void init; return reply(200, { schemaVersion: 1, evidence: "youtube_metadata", credentialVersion: 2, items: [item] }); });
    vi.stubGlobal("fetch", send);
    expect(await searchYouTubeShorts({ query: "캠핑", order: "date", credentialVersion: 2 })).toEqual({ kind: "ok", credentialVersion: 2, items: [item] });
    expect(send.mock.calls[0][0]).toBe(youtubeShortsSearchPath);
    expect(send.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect(JSON.parse(String(send.mock.calls[0][1].body))).toEqual({ query: "캠핑", order: "date", credentialVersion: 2 });
    // 계약 밖 응답(51개 이상·모르는 필드)은 쓰지 않는다.
    send.mockResolvedValueOnce(reply(200, { schemaVersion: 1, evidence: "youtube_metadata", credentialVersion: 2, items: [{ ...item, apiKey: "x" }] }));
    expect(await searchYouTubeShorts({ query: "캠핑", order: "date", credentialVersion: 2 })).toEqual({ kind: "error", code: "provider_error" });
  });

  it("형식이 틀린 요청은 보내지 않고, 서버 오류 코드는 그대로 구분한다", async () => {
    const send = vi.fn(async () => reply(429, { code: "quota_exceeded" }));
    vi.stubGlobal("fetch", send);
    expect(await searchYouTubeShorts({ query: "  ", order: "date", credentialVersion: 2 })).toEqual({ kind: "error", code: "invalid_input" });
    expect(await searchYouTubeShorts({ query: "a", order: "date", credentialVersion: 2, dateFrom: "2026-11-02", dateTo: "2026-11-01" })).toEqual({ kind: "error", code: "invalid_input" });
    expect(send).not.toHaveBeenCalled();
    expect(await searchYouTubeShorts({ query: "a", order: "date", credentialVersion: 2 })).toEqual({ kind: "error", code: "quota_exceeded" });
    for (const [status, code] of [[429, "search_in_progress"], [422, "invalid_key"], [409, "stale"], [503, "not_configured"], [502, "provider_error"], [504, "timed_out"]] as const) {
      send.mockResolvedValueOnce(reply(status, { code }));
      expect(await searchYouTubeShorts({ query: "a", order: "date", credentialVersion: 2 })).toEqual({ kind: "error", code });
    }
    send.mockResolvedValueOnce(reply(401, { error: "AUTH_REQUIRED" }));
    expect(await searchYouTubeShorts({ query: "a", order: "date", credentialVersion: 2 })).toEqual({ kind: "login" });
  });

  it("요청 전 검사와 표시 형식: 0은 그대로, 숨김은 비공개, 길이·썸네일 호스트 확인", () => {
    expect(searchProblem({ query: "", order: "relevance", dateFrom: "", dateTo: "" })).toBe("검색어를 넣어 주세요.");
    expect(searchProblem({ query: "가".repeat(101), order: "relevance", dateFrom: "", dateTo: "" })).toMatch(/100자/);
    expect(searchProblem({ query: "a\u0007", order: "relevance", dateFrom: "", dateTo: "" })).toMatch(/쓸 수 없는 문자/);
    expect(searchProblem({ query: "a", order: "relevance", dateFrom: "2026-11-02", dateTo: "2026-11-01" })).toMatch(/시작일/);
    expect(searchProblem({ query: " 캠핑 ", order: "date", dateFrom: "2026-11-01", dateTo: "2026-11-01" })).toBeUndefined();
    expect([metricText(0), metricText(null), metricText(1234567)]).toEqual(["0", "비공개", "1,234,567"]);
    expect([durationText(null), durationText(59), durationText(61), durationText(3725)]).toEqual(["길이 미확인", "0:59", "1:01", "1:02:05"]);
    expect(safeThumbnail("https://i.ytimg.com/vi/x/mqdefault.jpg")).toBe("https://i.ytimg.com/vi/x/mqdefault.jpg");
    for (const bad of ["http://i.ytimg.com/a.jpg", "https://evil.example/a.jpg", "https://i.ytimg.com:444/a.jpg", "javascript:alert(1)", null]) expect(safeThumbnail(bad)).toBeNull();
  });

  it("서버 렌더에서는 키 상태 확인 중만 그리고 검색은 잠겨 있다(요청 없음)", () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const html = renderToStaticMarkup(createElement(AdminShortsSearch, { onPick: () => {} }));
    expect(html).toContain("공개 쇼츠 검색");
    expect(html).toContain("YouTube 키 상태를 확인하는 중이에요.");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(send).not.toHaveBeenCalled();
  });
});
