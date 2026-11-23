import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortsSourceAnalyze } from "@/components/admin/shorts-source-steps/shorts-source-analyze";
import { ShortsSourceSearch } from "@/components/admin/shorts-source-steps/shorts-source-search";
import {
  filterShorts, picksKey, presetValues, sameOrder, shortsCsv, SOURCE_MAX_SELECT, toPick, togglePick,
  type ShortsSourceAnalysis, type ShortsSourceMultiAnalysis, type ShortsSourceSnapshot,
} from "@/components/admin/shorts-source-steps/source-step-data";
import { shortsAnalysisResultSchema, shortsMultiAnalysisResultSchema } from "@/lib/reference-analysis/shorts-analysis-contract";

// P1-08-ORIGINAL-SEARCH-ANALYZE(Master msg_db465e362824 배정 1, msg_48c8907e6c8b 배정 2): 원본 v2.01 SearchStep·AnalyzeStep을 옮긴 새 화면 부품.
// 모두 합성 값이며 실제 YouTube·Gemini·계정이 아니다. 기대값 근거: 원본 src/components/studio/SearchStep.tsx(applyPreset·filtered·exportCsv·문구),
// AnalyzeStep.tsx(빈 선택·대상 카드·단추 문구), 운영 지표 shorts-metrics(af3a65d), 서버 검사 형식(youtube-shorts-search·shorts-analysis).
const NOW = Date.UTC(2026, 10, 22, 3, 0, 0); // 2026-11-22T03:00Z
const candidate = (id: string, patch: Partial<ShortsSourceSnapshot["items"][number]> = {}) => ({
  id, url: `https://www.youtube.com/watch?v=${id}`, title: `합성 후보 ${id}`, channelId: "UC" + "a".repeat(22), channelTitle: "합성 채널",
  thumbnailUrl: null, publishedAt: "2026-11-21T03:00:00Z", durationSeconds: 45, views: 120_000, likes: 10, comments: 2, subscribers: 10_000, ...patch,
});
const items = [
  candidate("Aa000000001"), // 12배 초대박, VPH 5000
  candidate("Bb000000002", { durationSeconds: 150, views: 30_000, subscribers: 60_000 }), // 0.5배 보통
  candidate("Cc000000003", { durationSeconds: null, views: null, subscribers: null }), // 비공개·길이 미확인
  candidate("Dd000000004", { durationSeconds: 200, views: 8_000, subscribers: 1_000 }), // 3분 초과
];
const snapshot: ShortsSourceSnapshot = { query: "합성 검색어", order: "viewCount", dateFrom: "2026-10-23", dateTo: "2026-11-22", items, credentialVersion: 3, measuredAt: NOW };
const analysisResult = shortsAnalysisResultSchema.parse({ evidence: "youtube_video", findings: {
  summary: "합성 요약 문장", hook: "첫 1초에 질문 자막", composition: null, sound: "빠른 박자 효과음",
  segments: [{ timestamp: "00:00", evidence: "질문으로 시작" }, { timestamp: "00:05", evidence: "답을 숨긴 채 전환" }], draftPrompt: null,
} });
const read = (file: string) => readFileSync(`components/admin/shorts-source-steps/${file}`, "utf8");
afterEach(() => vi.unstubAllGlobals());

describe("P1-08 원본 ①② 주고받는 값과 계산", () => {
  it("고른 영상 값은 운영 V/S·VPH 계산을 그대로 싣고, 큰 정수는 문자열로 넘긴다", () => {
    const pick = toPick(items[0], snapshot);
    expect(pick).toEqual({
      videoId: "Aa000000001", url: "https://www.youtube.com/watch?v=Aa000000001", title: "합성 후보 Aa000000001", channelTitle: "합성 채널", thumbnailUrl: null,
      publishedAt: "2026-11-21T03:00:00Z", durationSeconds: 45, views: 120_000, subscribers: 10_000,
      vsTenths: "120", grade: "초대박", vph: 5000, query: "합성 검색어", measuredAt: "2026-11-22T03:00:00.000Z", credentialVersion: 3,
    });
    expect(JSON.parse(JSON.stringify(pick))).toEqual(pick);
    expect(toPick(items[2], snapshot)).toMatchObject({ vsTenths: null, grade: "판정불가", vph: null });
    expect(SOURCE_MAX_SELECT).toBe(3);
  });

  it("길이·최소 조회·최대 구독은 받은 결과에서만 거르고, 확인할 수 없는 비공개 값은 뺀다", () => {
    const ids = (filters: Parameters<typeof filterShorts>[1]) => filterShorts(items, filters).map(item => item.id);
    expect(ids({ maxDuration: "all", minViews: "", maxSubs: "" })).toEqual(["Aa000000001", "Bb000000002", "Cc000000003", "Dd000000004"]);
    expect(ids({ maxDuration: "180", minViews: "", maxSubs: "" })).toEqual(["Aa000000001", "Bb000000002"]);
    expect(ids({ maxDuration: "60", minViews: "", maxSubs: "" })).toEqual(["Aa000000001"]);
    expect(ids({ maxDuration: "all", minViews: "10000", maxSubs: "" })).toEqual(["Aa000000001", "Bb000000002"]);
    expect(ids({ maxDuration: "all", minViews: "", maxSubs: "50000" })).toEqual(["Aa000000001", "Dd000000004"]);
  });

  it("프리셋은 원본 applyPreset 값 그대로이고 기간은 UTC 날짜다(검색은 하지 않음)", () => {
    expect(presetValues("viral", NOW)).toEqual({ dateFrom: "2026-11-15", dateTo: "2026-11-22", filters: { maxDuration: "180", minViews: "50000", maxSubs: "" } });
    expect(presetValues("small", NOW)).toEqual({ dateFrom: "2026-10-23", dateTo: "2026-11-22", filters: { maxDuration: "180", minViews: "10000", maxSubs: "50000" } });
    expect(presetValues("trending", NOW)).toEqual({ dateFrom: "2026-11-21", dateTo: "2026-11-22", filters: { maxDuration: "180", minViews: "5000", maxSubs: "" } });
    expect(presetValues("reset", NOW)).toEqual({ dateFrom: "2026-10-23", dateTo: "2026-11-22", filters: { maxDuration: "180", minViews: "", maxSubs: "" } });
  });

  it("CSV는 받은 공개 값만 쓰고, 표 계산식으로 읽힐 첫 글자를 막는다", () => {
    const csv = shortsCsv([candidate("Ee000000005", { title: "=HYPERLINK(\"x\")", channelTitle: "+채널" }), items[2]], NOW);
    const lines = csv.split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe('﻿"제목","채널","게시일","길이(초)","조회수","좋아요","댓글","구독자","조회수÷구독자","등급","시간당 조회수(VPH)","링크"');
    expect(lines[1]).toBe('"\'=HYPERLINK(""x"")","\'+채널","2026-11-21","45","120000","10","2","10000","12.0","초대박","5000","https://www.youtube.com/shorts/Ee000000005"');
    expect(lines[2]).toBe('"합성 후보 Cc000000003","합성 채널","2026-11-21","","","10","2","","","판정불가","","https://www.youtube.com/shorts/Cc000000003"');
  });
});

describe("P1-08 원본 ① 떡상 쇼츠 검색 화면", () => {
  it("처음 그리기는 요청 없이 원본 구성(제목·프리셋·조건 칸·빈 결과)을 보이고, 키 확인 전에는 검색을 잠근다", () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const html = renderToStaticMarkup(createElement(ShortsSourceSearch, { onPick: () => {}, onAnalyze: () => {} }));
    expect(send).not.toHaveBeenCalled();
    for (const text of ["떡상 쇼츠 검색", "쇼츠 검색", "🔥 지금 떡상", "🚀 작은 채널 대박", "⚡ 급상승", "초기화", "게시 기간", "검색 정렬", "영상 길이",
      "최소 조회수", "최대 구독자", "📥 CSV 내보내기", "선택 영상 분석하기 ➔", "선택 0/3", "아직 검색 결과가 없어요", "YouTube 키 상태를 확인하는 중이에요."]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>쇼츠 검색<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>선택 영상 분석하기 ➔<\/button>/);
    expect(html).not.toContain("채널평균");
    expect(html).not.toContain("종교");
  });

  it("셸이 들고 있던 결과는 다시 검색하지 않고 V/S 높은 순·3분 이내로 보이며, 고른 영상만 표시한다", () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const html = renderToStaticMarkup(createElement(ShortsSourceSearch, { onPick: () => {}, onAnalyze: () => {}, initialSnapshot: snapshot, picked: [toPick(items[1], snapshot)] }));
    expect(send).not.toHaveBeenCalled();
    expect(html).toContain("(2개 / 전체 4개)");
    const table = html.slice(html.indexOf("<table"));
    expect(table.indexOf("합성 후보 Aa000000001")).toBeLessThan(table.indexOf("합성 후보 Bb000000002"));
    expect(html).not.toContain("합성 후보 Dd000000004");
    expect(html).toContain("12.0배");
    expect(html).toContain("초대박");
    expect(html).toContain("0.5배");
    expect(html).toContain("선택 1/3");
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/<tr data-picked="true">(?:(?!<\/tr>).)*합성 후보 Bb000000002/);
    expect(html).toContain('value="합성 검색어"');
    // 고른 영상이 있으면 '선택 영상 분석하기'가 열린다.
    expect(html).toMatch(/<button type="button" class="[^"]*">선택 영상 분석하기 ➔<\/button>/);
  });

  it("onAnalyze가 없으면 다음 단계 단추를 숨긴다", () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(renderToStaticMarkup(createElement(ShortsSourceSearch, { onPick: () => {} }))).not.toContain("선택 영상 분석하기");
  });
});

describe("P1-08 원본 ② 바이럴 분석 화면", () => {
  const pick = toPick(items[0], snapshot);
  const analysis: ShortsSourceAnalysis = { videoId: pick.videoId, url: pick.url, title: pick.title, result: analysisResult, analyzedAt: "2026-11-22T03:10:00.000Z" };

  it("고른 영상이 없으면 원본처럼 돌아가기만 보인다(요청 없음)", () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const html = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [], onBack: () => {} }));
    expect(send).not.toHaveBeenCalled();
    expect(html).toContain("분석할 영상이 선택되지 않았어요");
    expect(html).toContain("← 쇼츠 검색으로 돌아가기");
    expect(html).not.toContain("바이럴 공식 해체 시작");
  });

  it("분석 대상 카드와 동의 전 잠긴 시작 단추를 보이고, 설정 확인 전에는 아무것도 보내지 않는다", () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const html = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [pick], onBack: () => {}, onNext: () => {} }));
    expect(send).not.toHaveBeenCalled();
    for (const text of ["바이럴 분석", "분석 대상 영상", "(1개)", "영상 다시 선택", "합성 후보 Aa000000001", "12.0배", "초대박",
      "분석 권리를 확인했고 영상 주소를 Gemini에 보내는 데 동의해요.", "쇼츠 분석 모델 설정을 확인하는 중이에요."]) expect(html).toContain(text);
    expect(html).toMatch(/<input type="checkbox" disabled=""/);
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="">⚡ 바이럴 공식 해체 시작<\/button>/);
    expect(html).not.toContain("이 공식으로 소재 6개 발굴하기");
  });

  it("같은 영상의 앞 결과는 서버가 준 항목만 원본 섹션으로 보이고 없는 항목은 지어내지 않는다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const html = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [pick], onBack: () => {}, onNext: () => {}, initialAnalysis: analysis }));
    for (const text of ["🎬 영상 직접 분석", "합성 요약 문장", "🎯 바이럴 메커니즘", "(2개 · 영상에서 확인된 것만)", "훅(첫 장면)", "첫 1초에 질문 자막", "소리", "빠른 박자 효과음",
      "⏱️ 구간별 타임라인", "00:05", "답을 숨긴 채 전환", "다시 분석하기", "이 공식으로 소재 6개 발굴하기 ➔"]) expect(html).toContain(text);
    expect(html).not.toContain("구성</h4>");
    expect(html).not.toContain("재현용 초안 프롬프트");
    for (const missing of ["11대", "시각 연출 DNA", "시청자 반응", "지표·댓글 기반 추정"]) expect(html).not.toContain(missing);
  });

  it("다른 영상의 앞 결과는 보이지 않고, 새 분석이 성공해야 바뀐다고 알린다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const other = toPick(items[1], snapshot);
    const html = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [other], onBack: () => {}, initialAnalysis: analysis }));
    expect(html).toContain("앞서 분석한 ‘합성 후보 Aa000000001’의 결과가 있어요");
    expect(html).not.toContain("합성 요약 문장");
    expect(html).toContain("⚡ 바이럴 공식 해체 시작");
  });
});

describe("P1-08 원본 ①② 경계", () => {
  it("값 파일은 지시어 없이 계산만 하고, 화면은 공용 통신 함수와 기존 분석 경로만 쓴다", () => {
    const data = read("source-step-data.ts");
    const search = read("shorts-source-search.tsx");
    const analyze = read("shorts-source-analyze.tsx");
    expect(data).not.toMatch(/^["']use client["']/m);
    expect(data).not.toMatch(/fetch\(|localStorage|sessionStorage/);
    expect(search.startsWith('"use client";')).toBe(true);
    expect(analyze.startsWith('"use client";')).toBe(true);
    // 검색은 공용 함수(searchYouTubeShorts·readYouTubeKey)로만 보낸다.
    expect(search).not.toMatch(/fetch\(/);
    expect(search).toContain("searchYouTubeShorts(");
    // 분석은 기존 경로의 GET(설정)과, 동의 뒤 단건 POST {url, authorized:true}·묶음 POST {urls, authorized:true}만 보낸다.
    expect(analyze.match(/fetch\(/g)).toHaveLength(3);
    expect(analyze).toContain("JSON.stringify({ url: target.url, authorized: true })");
    expect(analyze).toContain("JSON.stringify({ urls: targets.map(target => target.url), authorized: true })");
    expect(analyze).toContain("shortsMultiAnalysisResultSchema.safeParse(body.result)");
    expect(analyze).toContain("!consent");
    for (const source of [data, search, analyze]) {
      expect(source).not.toMatch(/from "[^"]*shorts-original|localStorage|sessionStorage|indexedDB/);
      expect(source).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});

// P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI(Master msg_26c664890c91 배정 1, msg_54641a107f0b 배정 2): 최대 3개 고르기와 ② 묶음 분석 화면.
// 서버 계약은 881b367 shortsMultiAnalysisResultSchema(videoIds 요청 순서, segments[].video 1부터). 보내기·취소·늦은 응답·422는 브라우저 대역 확인(인계 문서).
describe("P1-08 ①② 여러 영상(최대 3개)", () => {
  const [a, b, c, d] = items.map(item => toPick(item, snapshot));
  const multiResult = shortsMultiAnalysisResultSchema.parse({ evidence: "youtube_video", videoIds: [a.videoId, b.videoId], findings: {
    summary: "두 영상 공통 요약", hook: "둘 다 결과를 먼저 보인다", composition: null, sound: null, draftPrompt: null,
    segments: [{ video: 1, timestamp: "00:01", evidence: "영상 1 결과 공개" }, { video: 2, timestamp: "00:03", evidence: "영상 2 질문 자막" }] } });
  const multi: ShortsSourceMultiAnalysis = { videoIds: [a.videoId, b.videoId], videos: [a, b].map(({ videoId, url, title }) => ({ videoId, url, title })),
    result: multiResult, analyzedAt: "2026-11-22T03:20:00.000Z" };
  const single = (pick: typeof a): ShortsSourceAnalysis => ({ videoId: pick.videoId, url: pick.url, title: pick.title, result: analysisResult, analyzedAt: "2026-11-22T03:10:00.000Z" });

  it("고른 순서를 지키고, 가운데를 해제해도 남은 순서는 그대로이며, 4번째는 막는다", () => {
    let picks = togglePick([], b).picks;
    picks = togglePick(picks, a).picks;
    picks = togglePick(picks, c).picks;
    expect(picks.map(pick => pick.videoId)).toEqual(["Bb000000002", "Aa000000001", "Cc000000003"]);
    const blocked = togglePick(picks, d);
    expect(blocked.full).toBe(true);
    expect(blocked.picks.map(pick => pick.videoId)).toEqual(["Bb000000002", "Aa000000001", "Cc000000003"]);
    const removed = togglePick(picks, a);
    expect(removed).toEqual({ picks: [b, c], full: false });
    expect(togglePick(removed.picks, d).picks.map(pick => pick.videoId)).toEqual(["Bb000000002", "Cc000000003", "Dd000000004"]);
    expect(picksKey([b, a])).toBe("Bb000000002,Aa000000001");
    expect(sameOrder(["x", "y"], ["x", "y"])).toBe(true);
    expect(sameOrder(["x", "y"], ["y", "x"])).toBe(false);
  });

  it("① 고른 영상 목록은 순서 번호·해제 단추를 보이고, 2개 이상이면 묶음 분석 단추가 된다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const html = renderToStaticMarkup(createElement(ShortsSourceSearch, { onPick: () => {}, onAnalyze: () => {}, initialSnapshot: snapshot, picked: [b, a] }));
    expect(html).toContain("선택 2/3");
    expect(html).toContain("고른 영상 · 고른 순서대로 분석해요");
    expect(html.indexOf("영상 1 · 합성 후보 Bb000000002")).toBeLessThan(html.indexOf("영상 2 · 합성 후보 Aa000000001"));
    expect(html).toContain('aria-label="영상 1 합성 후보 Bb000000002 해제"');
    expect(html).toContain('aria-label="합성 후보 Aa000000001 선택(영상 2)"');
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toMatch(/<button type="button" class="[^"]*">선택 영상 2개 묶음 분석하기 ➔<\/button>/);
    expect(html).toContain("2개 이상이면 한 번에 묶어 공통 패턴을 분석해요(묶음 결과는 ③ 소재 발굴로 넘기지 않아요)");
  });

  it("② 묶음은 고른 순서의 대상·범위 안내·동의 뒤에만 열리는 시작 단추를 보이고, 소재 단계 단추는 없다(요청 없음)", () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const html = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [b, a], onBack: () => {}, onNext: () => {}, initialAnalysis: single(a) }));
    expect(send).not.toHaveBeenCalled();
    for (const text of ["고른 영상 2개의 공통 패턴과 영상별 구간 근거를 한 번에 뽑아요.", "(2개 · 고른 순서)", "영상 1 · 합성 후보 Bb000000002", "영상 2 · 합성 후보 Aa000000001",
      "③ 소재 발굴·작업 프로젝트·프롬프트 보관함으로 넘기거나 저장하지 않아요", "영상 주소 2개를 Gemini에 보내는 데 동의해요."]) expect(html).toContain(text);
    expect(html.indexOf("합성 후보 Bb000000002")).toBeLessThan(html.indexOf("합성 후보 Aa000000001"));
    expect(html).toMatch(/<button type="button" class="[^"]*" aria-describedby="[^"]*" disabled="">⚡ 영상 2개 묶음 해체 시작<\/button>/);
    expect(html).not.toContain("이 공식으로 소재 6개 발굴하기");
    // 앞 단건 결과(영상 A)는 묶음 화면에 섞어 보이지 않는다.
    expect(html).not.toContain("합성 요약 문장");
  });

  it("② 같은 묶음·같은 순서의 앞 결과만 보이고, 근거마다 영상 번호·시간·영상 이름을 붙인다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const html = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [a, b], onBack: () => {}, onNext: () => {}, initialMulti: multi }));
    for (const text of ["🎬 영상 2개 묶음 분석", "공통 패턴 요약", "두 영상 공통 요약", "둘 다 결과를 먼저 보인다", "영상 1 · 00:01", "영상 2 · 00:03", "영상 2 질문 자막",
      "다시 묶음 분석하기", "이 묶음 결과는 여기서 읽기만 해요. ③ 소재 발굴은 영상 1개 분석 결과로 이어져요.", "영상 1개로 다시 고르기"]) expect(html).toContain(text);
    expect(html).toMatch(/영상 2 · 00:03<\/p><p class="[^"]*" title="합성 후보 Bb000000002">합성 후보 Bb000000002<\/p>/);
    expect(html).not.toContain("이 공식으로 소재 6개 발굴하기");
    // 순서가 다르면 다른 묶음이다: 결과를 보이지 않고 새 분석이 성공해야 바뀐다고 알린다.
    const swapped = renderToStaticMarkup(createElement(ShortsSourceAnalyze, { picks: [b, a], onBack: () => {}, initialMulti: multi }));
    expect(swapped).not.toContain("두 영상 공통 요약");
    expect(swapped).toContain("앞서 묶음 분석한 영상 2개(‘합성 후보 Aa000000001’, ‘합성 후보 Bb000000002’)의 결과가 있어요");
    expect(swapped).toContain("⚡ 영상 2개 묶음 해체 시작");
  });

  it("묶음 응답은 서버 계약으로만 읽는다: 영상 번호가 영상 수를 넘거나 같은 영상이 겹치면 거절", () => {
    const base = { evidence: "youtube_video", findings: { summary: "요약", hook: null, composition: null, sound: null, draftPrompt: null, segments: [] as unknown[] } };
    expect(shortsMultiAnalysisResultSchema.safeParse({ ...base, videoIds: [a.videoId, b.videoId], findings: { ...base.findings, segments: [{ video: 3, timestamp: "00:01", evidence: "x" }] } }).success).toBe(false);
    expect(shortsMultiAnalysisResultSchema.safeParse({ ...base, videoIds: [a.videoId, a.videoId] }).success).toBe(false);
    expect(shortsMultiAnalysisResultSchema.safeParse({ ...base, videoIds: [a.videoId, b.videoId, c.videoId] }).success).toBe(true);
  });
});
