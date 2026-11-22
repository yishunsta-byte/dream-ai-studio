import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { completedDetail, DetailedAudioReport } from "@/components/admin/admin-audio-detail-report";
import { createAdminMusicSemanticClient } from "@/components/admin/admin-music-semantic-client";
import {
  clockText, interviewMarkdown, markdownName, measurementText, meetingMarkdown, searchSegments, segmentTime, speakerCounts, transcriptText,
  type DetailedMusic, type DetailedSpeech,
} from "@/components/admin/audio-detail-report";
import { createAudioUploadClient } from "@/components/admin/audio-upload-client";
import { ADMIN_AUDIO_ANALYSIS_URI } from "@/lib/reference-analysis/admin-audio-contract";
import {
  ADMIN_AUDIO_REPORT_PROFILE_HEADER, ADMIN_AUDIO_REPORT_VERSION_HEADER, detailedAudioResponseSchema,
} from "@/lib/reference-analysis/admin-audio-details-contract";
import { adminAudioChunkBytes, audioUploadCommand } from "@/lib/reference-analysis/admin-audio-upload-contract";

// P1-07 상세 오디오 보고서(v2) 화면 쪽: 가공 함수·Markdown·검색과 상세 요청(바로 분석 머리글, 업로드 reportVersion). 표본은 서버 DTO 스키마로 먼저 검사한다.
const segments = [
  { speaker: "민지", text: "베타는 12월 첫 주에 열어요.", startSec: 3, endSec: 7.5 },
  { speaker: "도윤", text: "예산은 다음 회의에서 볼게요.", startSec: 65, endSec: null },
  { speaker: null, text: "Keyboard 소리가 들려요.", startSec: null, endSec: null },
];
const speech = detailedAudioResponseSchema.parse({
  schemaVersion: 2, requestedMode: "speech", status: "partial", provider: "gemini", evidence: "model_estimate", unknownValueReason: "not_established_from_audio",
  measurement: { source: "server_probe", durationSeconds: 3725.9, sampleRateHz: 16000, channels: 1 }, kind: "speech",
  report: { summary: "출시 일정을\n정했어요.", topicsAndKeywords: null,
    actionItems: [{ task: "체크리스트", assignee: null, dueDate: null }],
    speakers: [{ name: "민지", role: "진행자", manner: null, contribution: "일정을 정했어요." }],
    questions: [{ text: "베타는 언제 열까요?", speaker: null, context: null }],
    delivery: null, acousticQuality: { clarity: "또렷해요.", background: null, issues: null },
    transcription: { status: "sampled", reason: "model_sample", range: { fromSec: 3, throughSec: 65 }, segments } },
}) as DetailedSpeech;
// A-3 확장 프로필(B-2 7e7a264) 표본: 음성 통찰·전환 분위기, 음악 스타일·채보·비트·출처 추정.
const expandedSpeech = detailedAudioResponseSchema.parse({ ...speech, report: { ...speech.report,
  additionalFindings: { overallInsights: "일정은 정했지만\n예산은 미뤘어요.", speakerTransitionTone: "조심스러워져요." } } }) as DetailedSpeech;
const music = detailedAudioResponseSchema.parse({
  schemaVersion: 2, requestedMode: "music", status: "ready", provider: "gemini", evidence: "model_estimate", unknownValueReason: "not_established_from_audio",
  measurement: { source: "unavailable", reason: "probe_unavailable" }, kind: "music",
  report: { genre: "로파이", instruments: null, tempoBpm: null, structure: null, sunoPrompt: null, mood: null, rhythm: null, harmony: null,
    lyrics: { status: "undetermined", text: null }, stems: null, qualityEstimates: null,
    additionalFindings: { style: { vocalStyle: "낮은 보컬" }, composition: { notation: { format: "abc", text: "X:1\nK:C\n|C2 E2|" }, beatGrid: null },
      suspectedSource: { description: "재저장 음원", basis: "고역이 잘림" } } },
}) as DetailedMusic;

describe("P1-07 상세 오디오 보고서 가공", () => {
  it("시각·실측을 사람이 읽는 글로 바꾸고 모르는 값은 그대로 밝힌다", () => {
    expect([clockText(0), clockText(65.9), clockText(3725), clockText(-3)]).toEqual(["0:00", "1:05", "1:02:05", "0:00"]);
    expect(segments.map(segmentTime)).toEqual(["0:03–0:07", "1:05", "시각 미확인"]);
    expect(measurementText(speech.measurement)).toBe("서버 실측 · 길이 1:02:05 · 16,000 Hz · 모노");
    expect(measurementText({ source: "server_probe", durationSeconds: 9, sampleRateHz: null, channels: 6 })).toBe("서버 실측 · 길이 0:09 · 샘플레이트 확인되지 않음 · 6채널");
    expect(measurementText({ source: "unavailable", reason: "probe_unavailable" })).toBe("서버 실측을 하지 못했어요");
  });

  it("전사 검색은 받은 표본 안에서 글·화자를 대소문자 없이 찾고, 발화 건수는 표본 기준이다", () => {
    expect(searchSegments(segments, "").map(item => item.index)).toEqual([0, 1, 2]);
    expect(searchSegments(segments, "  KEYBOARD ").map(item => item.index)).toEqual([2]);
    expect(searchSegments(segments, "도윤").map(item => item.index)).toEqual([1]);
    expect(searchSegments(segments, "없는 말")).toEqual([]);
    expect(speakerCounts([...segments, segments[0]])).toEqual([{ name: "민지", count: 2 }, { name: "도윤", count: 1 }, { name: "화자 미확인", count: 1 }]);
  });

  it("회의록·인터뷰 Markdown은 문서 날짜와 실제 일시를 나누고, 줄바꿈·미확인·전사 없음을 그대로 적는다", () => {
    const meeting = meetingMarkdown(speech, "주간 회의.wav", "2026-11-21");
    expect(meeting.startsWith("# 회의록\n\n- 파일: 주간 회의.wav\n- 보고서 작성일: 2026-11-21 (이 화면에서 문서를 만든 날짜)\n- 실제 회의 일시: 음원에서 확인하지 않았어요\n")).toBe(true);
    expect(meeting).toContain("- 실측: 서버 실측 · 길이 1:02:05 · 16,000 Hz · 모노\n- 근거: Gemini 모델 추정 · 일부 항목만 확인\n- 참여자: 민지(진행자)");
    expect(meeting).toContain("## 요약\n출시 일정을 정했어요.");
    expect(meeting).toContain("1. [ ] **체크리스트** (담당: 확인되지 않음, 기한: 확인되지 않음)");
    expect(meeting).toContain("1. **베타는 언제 열까요?** (질문자: 확인되지 않음)\n   - 맥락: 확인되지 않음");
    expect(meeting).toContain("## 주제·키워드\n- 확인되지 않음");
    expect(meeting).toContain("- 표본 3구간 · 모델이 고른 표본 · 0:03–1:05 (전체 전사가 아니에요)\n- [0:03–0:07] 민지: 베타는 12월 첫 주에 열어요.");
    expect(meeting).toContain("- [시각 미확인] 화자 미확인: Keyboard 소리가 들려요.");
    const interview = interviewMarkdown(speech, "주간 회의.wav", "2026-11-21");
    expect(interview).toContain("- 실제 인터뷰 일시: 음원에서 확인하지 않았어요");
    expect(interview).toContain("### Q1. 베타는 언제 열까요? (질문자: 확인되지 않음)\n- 맥락: 확인되지 않음");
    expect(interview).toContain("## 화법과 전달\n- 확인되지 않음");
    expect(interview).toContain("## 음질·배경\n- 명료도: 또렷해요.\n- 배경: 확인되지 않음\n- 문제: 확인되지 않음");
    const none = { ...speech, report: { ...speech.report, speakers: null, transcription: { status: "unavailable", reason: "no_reported_segments" } } } as DetailedSpeech;
    expect(meetingMarkdown(none, "a.wav", "2026-11-21")).toContain("- 참여자: 확인되지 않음");
    expect(meetingMarkdown(none, "a.wav", "2026-11-21")).toContain("## 전사 표본\n- 전사 구간을 받지 못했어요.");
    expect([markdownName("주간 회의.wav", "meeting"), markdownName("a*b?<c>.mp3", "interview"), markdownName(".wav", "meeting")])
      .toEqual(["주간 회의-회의록.md", "a b c-인터뷰.md", "audio-회의록.md"]);
  });

  it("서버 렌더에서 원본 순서(핵심 카드·요약·탭)와 실측·추정·미확인, 시각 리포트 탭의 검색을 그린다(문서 탭은 고를 때만)", () => {
    const html = renderToStaticMarkup(createElement(DetailedAudioReport, { result: speech, fileName: "주간 회의.wav" }));
    for (const part of ["상세 음성 보고서", "서버 실측 · 길이 1:02:05", "일부 항목만 확인", "확인되지 않음", "총 화자 수", "1:02:05", "전체 대화 핵심 요약",
      'role="tab"', 'aria-selected="true"', "시각적 인텔리전스 리포트", "비즈니스 문서 생성 (회의록·인터뷰)", "전사 검색", "전사 표본 복사", "종합 통찰"]) {
      expect(html).toContain(part);
    }
    expect(html).not.toContain("회의록 Markdown 미리보기");
    expect(html).not.toContain("새 파일 분석");
    const order = ["총 화자 수", "전체 대화 핵심 요약", "시각적 인텔리전스 리포트", "화자별 발언 점유율", "주요 질문 및 논점", "주요 주제 및 키워드", "종합 통찰", "타임라인별 전사 표본"]
      .map(part => html.indexOf(part));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]))).toBe(true);
    expect(renderToStaticMarkup(createElement(DetailedAudioReport, { result: speech, fileName: "a.wav", onReset: () => undefined }))).toContain("새 파일 분석");
    const unavailable = renderToStaticMarkup(createElement(DetailedAudioReport, { fileName: "a.wav",
      result: { schemaVersion: 2, requestedMode: "auto", kind: "speech", status: "unavailable", reason: "timed_out" } }));
    expect(unavailable).toContain("음성으로 판별했지만 상세 보고서를 만들지 못했어요.");
  });
});

describe("P1-07 A-3 확장 프로필 표시", () => {
  it("음악은 원본 순서로, 확장 항목은 모델 추정으로 그리고 받지 못한 값을 지어내지 않는다(120 BPM·C Major 없음)", () => {
    const html = renderToStaticMarkup(createElement(DetailedAudioReport, { result: music, fileName: "곡.flac" }));
    const order = ["장르 &amp; 스타일", "BPM &amp; 템포", "Key &amp; Scale (조성)", "기술 사양", "Suno AI v6 역설계 프롬프트", "음향 포렌식", "4대 스템",
      "곡 구조 분석", "작곡 및 채보 데이터", "가사 전사", "스타일 및 편곡 사운드 심층 분석"].map(part => html.indexOf(part));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]))).toBe(true);
    for (const part of ["로파이", "서버 실측을 하지 못했어요", "ABC 악보", "X:1\nK:C\n|C2 E2|", "재저장 음원", "근거 고역이 잘림", "낮은 보컬", "모델 추정", "서버 실측"]) {
      expect(html).toContain(part);
    }
    for (const made of ["120", "C Major", "44.1kHz", "Stereo", "순정 마스터"]) expect(html).not.toContain(made);
    expect(html.match(/확인되지 않음/g)!.length).toBeGreaterThan(8);
  });

  it("음성 확장 항목은 화면·Markdown 두 형식에 모델 추정으로 들어가고, 없으면 확인되지 않음", () => {
    const html = renderToStaticMarkup(createElement(DetailedAudioReport, { result: expandedSpeech, fileName: "a.wav" }));
    expect(html).toContain("일정은 정했지만\n예산은 미뤘어요.");
    expect(html).toContain("조심스러워져요.");
    const meeting = meetingMarkdown(expandedSpeech, "a.wav", "2026-11-22");
    expect(meeting).toContain("## 종합 통찰 (모델 추정)\n일정은 정했지만 예산은 미뤘어요.\n");
    expect(interviewMarkdown(expandedSpeech, "a.wav", "2026-11-22")).toContain("- 화자 전환 분위기 (모델 추정): 조심스러워져요.");
    expect(meetingMarkdown(speech, "a.wav", "2026-11-22")).toContain("## 종합 통찰 (모델 추정)\n확인되지 않음\n");
    expect(interviewMarkdown(speech, "a.wav", "2026-11-22")).toContain("- 화자 전환 분위기 (모델 추정): 확인되지 않음");
    expect(transcriptText(speech)).toBe("전사 표본 3구간 · 모델이 고른 표본 · 전체 전사가 아니에요\n[0:03–0:07] 민지: 베타는 12월 첫 주에 열어요.\n"
      + "[1:05] 도윤: 예산은 다음 회의에서 볼게요.\n[시각 미확인] 화자 미확인: Keyboard 소리가 들려요.");
  });
});

describe("P1-07 A-5 완료 화면", () => {
  it("정상 완료(ready·partial)만 완료 화면으로 보고, 원본 셸일 때만 제목을 초점 대상(tabindex -1)으로 그린다", () => {
    expect([completedDetail(speech), completedDetail(music)]).toEqual([true, true]);
    const unavailable = { schemaVersion: 2, requestedMode: "auto", kind: "speech", status: "unavailable", reason: "timed_out" } as const;
    expect(completedDetail(unavailable)).toBe(false);
    expect(renderToStaticMarkup(createElement(DetailedAudioReport, { result: speech, fileName: "a.wav", focusOnShow: true }))).toContain('<h4 tabindex="-1" data-report-heading="true">상세 음성 보고서</h4>');
    expect(renderToStaticMarkup(createElement(DetailedAudioReport, { result: speech, fileName: "a.wav" }))).toContain("<h4>상세 음성 보고서</h4>");
    expect(renderToStaticMarkup(createElement(DetailedAudioReport, { result: unavailable, fileName: "a.wav", focusOnShow: true }))).not.toContain("tabindex");
  });
});

describe("P1-07 상세 요청", () => {
  it("바로 분석은 상세를 고를 때만 v2 머리글로 보내고, v2·같은 모드 응답만 받는다", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(speech))
      .mockResolvedValueOnce(Response.json({ ...speech, requestedMode: "auto" }))
      .mockResolvedValueOnce(Response.json({ schemaVersion: 1, requestedMode: "speech", status: "unavailable", kind: "speech", reason: "timed_out" }));
    const client = createAdminMusicSemanticClient(send);
    const file = new File(["RIFF"], "회의.wav");
    expect((await client.analyzeDetailed(file, "speech", false)).kind).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(await client.analyzeDetailed(file, "speech", true)).toEqual({ kind: "ok", result: speech });
    expect(send.mock.calls[0]).toMatchObject([ADMIN_AUDIO_ANALYSIS_URI, { method: "POST", body: file,
      headers: { "x-dream-audio-mode": "speech", [ADMIN_AUDIO_REPORT_VERSION_HEADER]: "2", [ADMIN_AUDIO_REPORT_PROFILE_HEADER]: "expanded" } }]);
    expect((await client.analyzeDetailed(file, "speech", true)).kind).toBe("failed");
    expect((await client.analyzeDetailed(file, "speech", true)).kind).toBe("failed");
    const basic = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ schemaVersion: 1, requestedMode: "speech", status: "unavailable", kind: "speech", reason: "timed_out" }));
    await createAdminMusicSemanticClient(basic).analyzeAudio(file, "speech", true);
    expect(ADMIN_AUDIO_REPORT_VERSION_HEADER in (basic.mock.calls[0][1]?.headers as Record<string, string>)).toBe(false);
    expect(ADMIN_AUDIO_REPORT_PROFILE_HEADER in (basic.mock.calls[0][1]?.headers as Record<string, string>)).toBe(false);
  });

  it("업로드 분석은 reportVersion 2를 서버 계약대로 보내고 v2 보고서를 읽는다", async () => {
    const view = { id: "0190a0b0-0000-7000-8000-900000000001", status: "completed", sizeBytes: 5, receivedBytes: 5, chunkBytes: adminAudioChunkBytes,
      expiresAt: "2026-11-22T03:00:00.000Z", cleanup: "done" };
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ upload: { ...view, report: speech } }))
      .mockResolvedValueOnce(Response.json({ upload: { ...view, report: { ...speech, measurement: { source: "server_probe" } } } }));
    const client = createAudioUploadClient(send);
    const signal = new AbortController().signal;
    const reply = await client.analyze(view.id, { requestId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", credentialVersion: 2, mode: "speech", reportVersion: 2 }, signal);
    expect(reply).toMatchObject({ kind: "ok", upload: { report: speech } });
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(audioUploadCommand.safeParse(body).success).toBe(true);
    expect(body.reportVersion).toBe(2);
    expect(await client.read(view.id, signal)).toEqual({ kind: "lost" });
  });

  it("A-3 업로드: expanded를 고르면 분석·조회·취소·정리·조각 모두 같은 프로필 머리글, 고르지 않으면 머리글 없음", async () => {
    const view = { id: "0190a0b0-0000-7000-8000-900000000001", status: "uploaded", sizeBytes: 5, receivedBytes: 5, chunkBytes: adminAudioChunkBytes,
      expiresAt: "2026-11-22T03:00:00.000Z", cleanup: "none" };
    const send = vi.fn<typeof fetch>(async () => Response.json({ upload: view }));
    const client = createAudioUploadClient(send);
    const signal = new AbortController().signal;
    const ask = { requestId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", credentialVersion: 2, mode: "speech" as const, reportVersion: 2 as const };
    for (const expanded of [true, false, undefined]) {
      send.mockClear();
      await client.analyze(view.id, ask, signal, expanded);
      await client.read(view.id, signal, expanded);
      await client.cancel(view.id, signal, expanded);
      await client.cleanup(view.id, signal, expanded);
      await client.chunk(view.id, 0, new Blob(["x"]), signal, expanded);
      const profiles = send.mock.calls.map(([, init]) => (init?.headers as Record<string, string> | undefined)?.[ADMIN_AUDIO_REPORT_PROFILE_HEADER] ?? null);
      expect(profiles).toEqual(Array(5).fill(expanded ? "expanded" : null));
      expect((send.mock.calls[0][1]?.headers as Record<string, string>)["content-type"]).toBe("application/json");
      expect((send.mock.calls[4][1]?.headers as Record<string, string>)["x-dream-upload-offset"]).toBe("0");
    }
  });
});
