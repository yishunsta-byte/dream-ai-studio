// T-266 레퍼런스 분석 합성 체험 화면의 상태 규칙(순수 함수). 실제 전송·분석·저장은 하지 않는다.
// 기준: T265 시안·명세, T265-R 수정 요구(이전 결과 소속, 늦은 결과 차단, 복사 대기 중 초안 변경).
import { classifyReferenceInput, type ReferenceInputDecision } from "@/lib/reference-analysis/input";

export type SourceMode = "sample" | "url" | "file" | "body";
export type SampleId = "video" | "music" | "image";
export type Scenario = "complete" | "empty" | "failed";
export type JobPhase = "queued" | "running" | "cancelRequested" | "canceled" | "failed" | "complete" | "empty";

export type LabJob = Readonly<{ id: number; sample: SampleId; scenario: Scenario; phase: JobPhase }>;
export type LabNotice = Readonly<{ tone: "info" | "error"; text: string; alternatives: readonly SourceMode[]; invalidField: boolean }>;
export type LabState = Readonly<{
  source: SourceMode;
  nextJobId: number;
  job: LabJob | null;
  notice: LabNotice | null;
  // 새 입력 확인으로 이전 결과를 닫았는지(화면 안내용)
  closedPrevious: boolean;
  // 지금 보이는 파일 칸에서 고른 파일(이름·크기·형식만)과 지금 입력에 대한 권한 확인.
  // 입력 방식을 바꾸면 둘 다 지운다(T266-R P1: 다시 만든 빈 파일 칸이 이전 파일로 확인되지 않게).
  file: LocalFile | null;
  authorized: boolean;
}>;
export type LocalFile = Readonly<{ name: string; size: number; type: string }>;

export const initialLabState: LabState = Object.freeze({ source: "sample", nextJobId: 1, job: null, notice: null, closedPrevious: false, file: null, authorized: false });

export const BUSY_PHASES: readonly JobPhase[] = ["queued", "running", "cancelRequested"];
export const isBusy = (state: LabState) => !!state.job && BUSY_PHASES.includes(state.job.phase);

// 작업 이벤트가 그 작업에 적용 가능한지. 다른 작업(이전 작업)의 늦은 이벤트, 종료된 작업의 이벤트,
// 취소 요청 뒤 종료 확인 외의 이벤트는 버린다.
const ALLOWED: Readonly<Record<JobPhase, readonly JobPhase[]>> = {
  queued: ["running", "cancelRequested"],
  running: ["complete", "empty", "failed", "cancelRequested"],
  cancelRequested: ["canceled"],
  canceled: [], failed: [], complete: [], empty: [],
};

export type LabAction =
  | { type: "source"; source: SourceMode }
  | { type: "startSample"; sample: SampleId; scenario: Scenario }
  | { type: "jobEvent"; jobId: number; phase: JobPhase }
  | { type: "inputChecked"; notice: LabNotice }
  | { type: "pickFile"; file: LocalFile | null }
  | { type: "authorize"; authorized: boolean };

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case "source":
      if (isBusy(state)) return state;
      if (action.source === state.source) return { ...state, notice: null };
      return { ...state, source: action.source, notice: null, file: null, authorized: false };
    case "startSample": {
      if (isBusy(state)) return state;
      const job: LabJob = { id: state.nextJobId, sample: action.sample, scenario: action.scenario, phase: "queued" };
      return { ...state, nextJobId: state.nextJobId + 1, job, notice: null, closedPrevious: false };
    }
    case "jobEvent": {
      const job = state.job;
      if (!job || job.id !== action.jobId || !ALLOWED[job.phase].includes(action.phase)) return state;
      return { ...state, job: { ...job, phase: action.phase } };
    }
    case "inputChecked":
      if (isBusy(state)) return state;
      // 새 입력을 확인하면 이전 합성 결과는 이 입력의 결과가 아니므로 닫는다.
      return { ...state, notice: action.notice, closedPrevious: !!state.job, job: null };
    case "pickFile":
      return state.source === "file" ? { ...state, file: action.file } : state;
    case "authorize":
      return { ...state, authorized: action.authorized };
  }
}

// 모의 작업 진행 계획. 화면은 이 순서대로 jobId를 붙여 이벤트를 보낸다.
export function plannedEvents(job: LabJob): readonly { phase: JobPhase; afterMs: number }[] {
  return [{ phase: "running", afterMs: 700 }, { phase: job.scenario, afterMs: 1900 }];
}
export const CANCEL_CONFIRM_MS = 1100;

const REPLACEMENT_TEXT: Record<string, string> = {
  profile_url: "채널·프로필 주소는 분석할 수 없어요. 작품 하나를 담은 본문이나 캡처 이미지, 파일을 사용해 주세요.",
  access_restricted: "접근이 제한된 주소예요. 본문이나 캡처 이미지, 파일로 바꿔 주세요.",
  permission_required: "사용 권한을 확인하지 않은 자료는 분석하지 않아요. 권한이 있는 본문이나 캡처 이미지, 파일을 사용해 주세요.",
  url_not_accessed: "이 체험 화면은 주소를 열지 않아요. 본문이나 캡처 이미지, 파일로 바꿔 주세요.",
};
const INVALID_TEXT: Record<string, string> = {
  invalid_input: "확인할 자료를 입력하거나 선택해 주세요.",
  invalid_url: "http 또는 https로 시작하는 올바른 주소를 입력해 주세요.",
  unsupported_file_type: "지원하지 않는 파일 형식이에요. PNG·JPG·WebP·MP4·MOV·WebM·MP3·WAV·M4A만 고를 수 있어요.",
  file_type_mismatch: "파일 이름과 실제 형식 표시가 맞지 않아요. 다른 파일을 골라 주세요.",
  invalid_file: "파일 이름을 확인해 주세요.",
  file_too_large: "64MB 이하 파일만 고를 수 있어요.",
};
const READY_TEXT = "형식은 확인했어요. 이 체험 화면은 자료를 보내거나 분석하지 않아요. 결과는 합성 표본으로 확인해 주세요.";

// T263 입력 계약의 판정을 화면 안내로 바꾼다. 입력 원문(주소·본문·파일명)은 안내에 넣지 않는다.
export function noticeFor(decision: ReferenceInputDecision): LabNotice {
  if (decision.status === "invalid") return { tone: "error", text: INVALID_TEXT[decision.reason] ?? INVALID_TEXT.invalid_input, alternatives: [], invalidField: true };
  if (decision.status === "replacement_required") return { tone: "info", text: REPLACEMENT_TEXT[decision.reason], alternatives: ["body", "file"], invalidField: false };
  return { tone: "info", text: READY_TEXT, alternatives: ["sample"], invalidField: false };
}

export type LocalInput =
  | { kind: "url"; url: string }
  | { kind: "body"; text: string; authorized: boolean }
  | { kind: "file"; file: LocalFile | null; authorized: boolean };

// 지금 상태에서 확인할 입력. 파일은 지금 파일 칸에서 고른 것만 쓴다.
export function currentInput(state: LabState, url: string, body: string): LocalInput | null {
  if (state.source === "url") return { kind: "url", url };
  if (state.source === "body") return { kind: "body", text: body, authorized: state.authorized };
  if (state.source === "file") return { kind: "file", file: state.file, authorized: state.authorized };
  return null;
}

// 파일은 이름·크기·형식 표시만 본다(내용을 읽거나 보내지 않음).
export function checkLocalInput(input: LocalInput): LabNotice {
  const permission = "authorized" in input && input.authorized ? "authorized" : "unknown";
  if (input.kind === "url") return noticeFor(classifyReferenceInput({ kind: "url", url: input.url.trim(), permission: "unknown" }));
  if (input.kind === "body") return noticeFor(classifyReferenceInput({ kind: "body", text: input.text, permission }));
  if (!input.file) return noticeFor({ status: "invalid", reason: "invalid_input" });
  return noticeFor(classifyReferenceInput({
    kind: "file", name: input.file.name, sizeBytes: input.file.size, permission,
    ...(input.file.type ? { mime: input.file.type } : {}),
  }));
}

// 복사 요청은 누른 시점의 요청 번호·초안 판·작업에 귀속한다(T265-R P2, T266-R P2).
// - ignore: 더 새 요청이 있거나 작업이 바뀌었거나 결과가 닫혔다. 알림·초점·선택을 모두 버린다.
// - stale*: 같은 작업에서 초안·근거 선택이 바뀌었거나 누른 탭을 벗어났다. 알림만 바꾸고 초점·선택은 건드리지 않는다.
// - copied/denied: 누른 그대로다. 거절이면 표시된 문구를 선택해 직접 복사하게 한다.
// - deniedAway: 누른 그대로지만 기다리는 사이 사용자가 초점을 다른 곳으로 옮겼다. 알림만 하고 초점·선택은 건드리지 않는다(T272-R P2).
export type CopyTicket = Readonly<{ id: number; text: string; draftVersion: number; jobId: number }>;
export type CopyOutcome = "ignore" | "staleCopied" | "staleFailed" | "copied" | "denied" | "deniedAway";
export function copyOutcome(ticket: CopyTicket, current: { ticketId: number; draftVersion: number; jobId: number | null; onSameTab: boolean; focusUnchanged: boolean }, ok: boolean): CopyOutcome {
  if (ticket.id !== current.ticketId || ticket.jobId !== current.jobId) return "ignore";
  if (ticket.draftVersion !== current.draftVersion || !current.onSameTab) return ok ? "staleCopied" : "staleFailed";
  if (ok) return "copied";
  return current.focusUnchanged ? "denied" : "deniedAway";
}

export type Tone = "clear" | "soft" | "active";
export const TONES: Readonly<Record<Tone, { label: string; line: string }>> = {
  clear: { label: "간결하고 선명하게", line: "요소를 간결하고 선명하게 정리하세요." },
  soft: { label: "차분하고 부드럽게", line: "변화를 차분하고 부드럽게 다듬으세요." },
  active: { label: "리듬감 있게", line: "강약과 전환에 리듬을 더하세요." },
};

export type SampleResult = Readonly<{
  label: string; option: string; visual: string; meta: string; note: string;
  place: string; observation: string; guess: string; alternative: string; unknown: string;
  // 합성 표본 길이(시간 매체만). 프로젝트 미리보기의 원본 위치 표시 막대에 쓴다.
  durationMs?: number;
  // 도식 강조 위치(0~1 비율)
  mark: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;
export const SAMPLES: Readonly<Record<SampleId, SampleResult>> = {
  video: {
    label: "영상", option: "영상 · 색 면 전환", visual: "영상 위치표", meta: "MP4 · 32 × 24 · 500 ms", durationMs: 500,
    note: "색 면 사이에 짧은 전환을 배치하세요.", place: "00:00.120–00:00.340",
    observation: "왼쪽 색 면에서 오른쪽 색 면으로 강조점이 옮겨가요.",
    guess: "두 장면 사이 전환일 수 있어요.", alternative: "단일 장면의 색 변화일 가능성도 있어요.",
    unknown: "제작 도구와 원래 프롬프트는 확인할 수 없어요.", mark: { x: 0.24, y: 0.06, width: 0.44, height: 0.88 },
  },
  music: {
    label: "음악", option: "음악 · 짧은 지속음", visual: "시간 위치를 보여 주는 파형 도식", meta: "WAV · 500 ms", durationMs: 500,
    note: "짧은 소리를 시작점으로 삼고 뒤를 부드럽게 정리하세요.", place: "00:00.080–00:00.420",
    observation: "합성 표본의 가운데 구간에 일정한 신호가 있어요.",
    guess: "지속음으로 들릴 수 있어요.", alternative: "이 표본 길이로는 곡의 박자를 판단하기 어려워요.",
    unknown: "BPM과 사용 악기는 확인할 수 없어요.", mark: { x: 0.16, y: 0.06, width: 0.68, height: 0.88 },
  },
  image: {
    label: "이미지", option: "이미지 · 중앙 색 면", visual: "이미지 영역 도식", meta: "PNG · 12 × 8",
    note: "밝은 색 면을 중심에 두고 주변에 충분한 여백을 남기세요.", place: "왼쪽 25% · 위 20% · 너비 50% · 높이 55%",
    observation: "중앙 색 면과 주변 배경의 밝기가 달라요.",
    guess: "중앙으로 시선을 모으려는 배치일 수 있어요.", alternative: "단순한 색 대비 예시일 수도 있어요.",
    unknown: "시드와 생성 모델은 확인할 수 없어요.", mark: { x: 0.25, y: 0.2, width: 0.5, height: 0.55 },
  },
};

// 기본 복사 문구: 화면에 보이는 구성 문구만. 입력 본문·주소·파일명·편집 메모는 재료가 아니다.
export const promptText = (sample: SampleId, tone: Tone) => `${SAMPLES[sample].note} ${TONES[tone].line}`;

export const PHASE_TEXT: Readonly<Record<JobPhase | "idle", { label: string; detail: string }>> = {
  idle: { label: "시작 전", detail: "합성 표본을 고르고 분석을 시작하세요." },
  queued: { label: "대기 중", detail: "모의 작업이 시작되기 전이에요." },
  running: { label: "분석 중", detail: "합성 표본의 파일 정보와 근거 위치를 읽는 모의 단계예요." },
  cancelRequested: { label: "취소 요청됨", detail: "작업 종료 확인을 기다리고 있어요. 확인 전에는 결과를 보여 주지 않아요." },
  canceled: { label: "취소 완료", detail: "작업 종료가 확인됐어요. 같은 표본으로 다시 시작할 수 있어요." },
  failed: { label: "실패", detail: "모의 작업에서 합성 표본을 검사하지 못했어요. 같은 표본으로 다시 시도할 수 있어요." },
  complete: { label: "완료", detail: "검토할 근거와 편집 초안이 준비됐어요." },
  empty: { label: "완료 · 근거 없음", detail: "보고할 수 있는 근거가 없었어요. 편집용 프롬프트는 만들지 않아요." },
};

// T272 프로젝트 미리보기: 근거 선택은 누른 순서를 지킨다(서버 계약 응답도 요청 순서를 따른다).
export function togglePick(picked: readonly string[], selectionId: string): string[] {
  return picked.includes(selectionId) ? picked.filter((item) => item !== selectionId) : [...picked, selectionId];
}
// 복사 문구: 고른 순서대로 창작 제안 문장만. 관찰 수치·근거 ID·원본 위치는 넣지 않는다.
export function projectCopyText(proposals: readonly { selectionId: string; draft: { prompt: string } }[], picked: readonly string[]) {
  const byId = new Map(proposals.map((item) => [item.selectionId, item]));
  return picked.map((key) => byId.get(key)?.draft.prompt).filter((text): text is string => !!text).join("\n");
}
export const secondsText = (ms: number) => `${(ms / 1000).toFixed(3)}초`;

// T272-F1: 이미지 관찰의 상대 명도 구간·비중(서버 계약이 허용한 luminanceShares·luminanceEdges만 사용).
// 대표 구간은 비중이 가장 큰 구간이며, 계약의 이미지 제안도 같은 구간으로 명도 방향을 정한다.
export function luminanceSummary(shares: readonly number[], edges: readonly number[]) {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const band = (index: number) => `${edges[index].toFixed(2)}–${edges[index + 1].toFixed(2)}`;
  const top = shares.indexOf(Math.max(...shares));
  return {
    dominant: `명도 ${band(top)} 구간 ${pct(shares[top])}`,
    all: shares.map((share, index) => `${band(index)} ${pct(share)}`).join(" · "),
  };
}
