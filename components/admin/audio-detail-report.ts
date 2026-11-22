import type { AudioMeasurement, DetailedAudioResponse } from "@/lib/reference-analysis/admin-audio-details-contract";

// P1-07 상세 오디오 보고서(v2, Backend d35eea5 DTO)의 화면 쪽 가공. 이미 받은 결과만 쓰고 모델을 부르지 않는다.
// 원본 v1.15 SpeechReportView의 전사 검색·발화 건수·회의록/인터뷰 Markdown을 옮기되, 문서를 만든 날짜와 실제 회의 일시를 구분하고
// 받지 못한 값은 '확인되지 않음'으로 적는다.
// P1-07 A-3: B-2 확장 프로필(7e7a264)의 선택 항목(음성 종합 통찰·화자 전환 분위기)을 모델 추정으로 문서에 더한다. 없으면 '확인되지 않음'.
export type DetailedSpeech = Extract<DetailedAudioResponse, { kind: "speech"; status: "ready" | "partial" }>;
export type DetailedMusic = Extract<DetailedAudioResponse, { kind: "music"; status: "ready" | "partial" }>;
export type SpeechSegment = Extract<DetailedSpeech["report"]["transcription"], { status: "sampled" }>["segments"][number];
export const unknownValue = "확인되지 않음";

/** 초를 m:ss(한 시간 이상이면 h:mm:ss)로. */
export function clockText(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}
export function segmentTime({ startSec, endSec }: Pick<SpeechSegment, "startSec" | "endSec">) {
  if (startSec === null) return "시각 미확인";
  return endSec === null ? clockText(startSec) : `${clockText(startSec)}–${clockText(endSec)}`;
}

export function measurementText(measurement: AudioMeasurement) {
  if (measurement.source === "unavailable") return "서버 실측을 하지 못했어요";
  const parts = [`길이 ${clockText(measurement.durationSeconds)}`];
  parts.push(measurement.sampleRateHz === null ? `샘플레이트 ${unknownValue}` : `${measurement.sampleRateHz.toLocaleString("ko-KR")} Hz`);
  parts.push(measurement.channels === null ? `채널 ${unknownValue}` : measurement.channels === 1 ? "모노" : measurement.channels === 2 ? "스테레오" : `${measurement.channels}채널`);
  return `서버 실측 · ${parts.join(" · ")}`;
}

/** 전사 표본 검색: 앞뒤 공백을 뺀 검색어가 글 또는 화자 이름에 들어 있는 구간(대소문자 무시). 빈 검색어면 전부. */
export function searchSegments(segments: readonly SpeechSegment[], query: string) {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  return segments.map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => !needle || segment.text.toLocaleLowerCase("ko-KR").includes(needle)
      || (segment.speaker ?? "").toLocaleLowerCase("ko-KR").includes(needle));
}

/** 화자별 발화 건수(받은 표본 기준). 이름이 없으면 '화자 미확인'. 많은 순. */
export function speakerCounts(segments: readonly SpeechSegment[]) {
  const counts = new Map<string, number>();
  for (const { speaker } of segments) counts.set(speaker ?? "화자 미확인", (counts.get(speaker ?? "화자 미확인") ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

const inline = (value: string | null | undefined) => value ? value.replace(/\s*\n\s*/g, " ").trim() : unknownValue;
const transcriptLine = (result: DetailedSpeech) => {
  const transcript = result.report.transcription;
  if (transcript.status === "unavailable") return "- 전사 구간을 받지 못했어요.";
  const reason = transcript.reason === "segment_limit" ? "최대 80구간까지만 담음" : "모델이 고른 표본";
  const range = transcript.range ? `${clockText(transcript.range.fromSec)}–${clockText(transcript.range.throughSec)}` : "시각 범위 미확인";
  return [`- 표본 ${transcript.segments.length}구간 · ${reason} · ${range} (전체 전사가 아니에요)`,
    ...transcript.segments.map(segment => `- [${segmentTime(segment)}] ${inline(segment.speaker ?? "화자 미확인")}: ${inline(segment.text)}`)].join("\n");
};
const header = (title: string, when: string, result: DetailedSpeech, fileName: string, today: string) => [
  `# ${title}`,
  "",
  `- 파일: ${inline(fileName)}`,
  `- 보고서 작성일: ${today} (이 화면에서 문서를 만든 날짜)`,
  `- 실제 ${when} 일시: 음원에서 확인하지 않았어요`,
  `- 실측: ${measurementText(result.measurement)}`,
  `- 근거: Gemini 모델 추정${result.status === "partial" ? " · 일부 항목만 확인" : ""}`,
  `- 참여자: ${result.report.speakers ? result.report.speakers.map(({ name, role }) => role ? `${inline(name)}(${inline(role)})` : inline(name)).join(", ") : unknownValue}`,
];
const speechExtra = (result: DetailedSpeech) => result.report.additionalFindings ?? undefined;
/** 원본 '종합 통찰' 칸(확장 프로필). 모델 추정이고, 받지 못했으면 확인되지 않음. */
const insightLines = (result: DetailedSpeech) => [
  "## 종합 통찰 (모델 추정)", inline(speechExtra(result)?.overallInsights)];

/** 전사 표본 복사용 글: [시각] 화자: 내용. 표본이라는 사실을 첫 줄에 남긴다. */
export function transcriptText(result: DetailedSpeech) {
  const transcript = result.report.transcription;
  if (transcript.status === "unavailable") return "";
  const reason = transcript.reason === "segment_limit" ? "최대 80구간까지만 담음" : "모델이 고른 표본";
  return [`전사 표본 ${transcript.segments.length}구간 · ${reason} · 전체 전사가 아니에요`,
    ...transcript.segments.map(segment => `[${segmentTime(segment)}] ${inline(segment.speaker ?? "화자 미확인")}: ${inline(segment.text)}`)].join("\n");
}
const list = <T,>(items: readonly T[] | null, line: (item: T, index: number) => string, empty: string) =>
  items?.length ? items.map(line).join("\n") : empty;

/** 원본 '회의록' 형식. today는 YYYY-MM-DD(문서를 만든 날짜). */
export function meetingMarkdown(result: DetailedSpeech, fileName: string, today: string) {
  const { summary, actionItems, questions, speakers, topicsAndKeywords } = result.report;
  return [...header("회의록", "회의", result, fileName, today), "",
    "## 요약", inline(summary), "",
    "## 실행 과제", list(actionItems, (item, index) => `${index + 1}. [ ] **${inline(item.task)}** (담당: ${inline(item.assignee)}, 기한: ${inline(item.dueDate)})`, "- 확인된 실행 과제가 없어요."), "",
    "## 주요 질문", list(questions, (item, index) => `${index + 1}. **${inline(item.text)}** (질문자: ${inline(item.speaker)})\n   - 맥락: ${inline(item.context)}`, "- 확인된 질문이 없어요."), "",
    "## 화자별 기여", list(speakers, item => `- **${inline(item.name)}** (${inline(item.role)}): ${inline(item.contribution)} (화법: ${inline(item.manner)})`, `- ${unknownValue}`), "",
    "## 주제·키워드", list(topicsAndKeywords, item => `- ${inline(item.topic)}: ${item.keywords ? item.keywords.map(inline).join(", ") : unknownValue}`, `- ${unknownValue}`), "",
    ...insightLines(result), "",
    "## 전사 표본", transcriptLine(result), ""].join("\n");
}

/** 원본 '인터뷰 결과 보고서' 형식. */
export function interviewMarkdown(result: DetailedSpeech, fileName: string, today: string) {
  const { summary, questions, speakers, delivery, acousticQuality } = result.report;
  return [...header("인터뷰 기록", "인터뷰", result, fileName, today), "",
    "## 개요", inline(summary), "",
    "## 주요 질문과 맥락", list(questions, (item, index) => `### Q${index + 1}. ${inline(item.text)} (질문자: ${inline(item.speaker)})\n- 맥락: ${inline(item.context)}`, "- 확인된 질문이 없어요."), "",
    "## 화법과 전달", [...delivery ? [`- 톤: ${inline(delivery.tone)}`, `- 속도: ${inline(delivery.pace)}`, `- 멈춤: ${inline(delivery.pauses)}`, `- 추임새: ${inline(delivery.fillers)}`] : [`- ${unknownValue}`],
      `- 화자 전환 분위기 (모델 추정): ${inline(speechExtra(result)?.speakerTransitionTone)}`].join("\n"), "",
    "## 음질·배경", acousticQuality ? [`- 명료도: ${inline(acousticQuality.clarity)}`, `- 배경: ${inline(acousticQuality.background)}`, `- 문제: ${inline(acousticQuality.issues)}`].join("\n") : `- ${unknownValue}`, "",
    "## 화자별 역할과 기여", list(speakers, item => `- **${inline(item.name)}** (${inline(item.role)}): ${inline(item.contribution)} (화법: ${inline(item.manner)})`, `- ${unknownValue}`), "",
    ...insightLines(result), "",
    "## 전사 표본", transcriptLine(result), ""].join("\n");
}

/** 내려받을 파일 이름: 원본 이름(확장자 제외, 경로·제어 문자 제거) + 문서 종류. */
export function markdownName(fileName: string, kind: "meeting" | "interview") {
  const stem = fileName.replace(/\.[^.]+$/u, "").replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").trim().slice(0, 80) || "audio";
  return `${stem}-${kind === "meeting" ? "회의록" : "인터뷰"}.md`;
}
