"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { AdminAudioMode, AdminAudioResponse, SpeechReport } from "@/lib/reference-analysis/admin-audio-contract";
import type { DetailedAudioResponse } from "@/lib/reference-analysis/admin-audio-details-contract";
import type { MusicSemanticResult } from "@/lib/reference-analysis/music-semantic-contract";
import { musicPublicationDraft } from "./admin-analysis-publication-draft";
import { completedDetail, DetailedAudioReport } from "./admin-audio-detail-report";
import { createAdminMusicSemanticClient, type AdminMusicSemanticClient } from "./admin-music-semantic-client";
import styles from "./admin-music-semantic.module.css";
import analysisStyles from "./admin-reference-analysis.module.css";
import type { PublicationDraft } from "./admin-reference-analysis-model";
import { ADMIN_SETTINGS_HREF, SettingsLink, type SettingsHref } from "./admin-settings-link";
import { SunoPrompt } from "./admin-suno-prompt";
import { AudioAnalysisProgress, audioWaitSeconds } from "./audio-analysis-progress";
import { directAudioIssue } from "./audio-upload-client";

// P1-07 관리자 오디오 분석. 음악 모드는 첫 이식 그대로(3febbd9 화면, Backend a849538 /api/admin/music-semantic 호출·DTO),
// 자동·음성 모드는 Backend 0e511a0 /api/admin/audio-analysis 계약. 운영 허브 음악 칸은 onPrepare로 음악 결과 공개 준비를 그대로 쓴다(P1-07 운영 이식).
// P1-07 A-1: 분석 모드·보고서 종류는 원본 셸(audio-original/audio-studio)이 정해 넘긴다(생략하면 예전 기본값 음악·기본 보고서).
// 파일·모드·보고서 종류가 바뀌면 진행 중 요청을 끊고 결과·전송 동의를 지운다(동의 문구에 모드가 들어가 있어 다시 받는다).
// 이전 조건의 늦은 응답은 버리고, 실패·판별 불가에서 자동으로 다시 보내지 않는다.
const defaultClient = createAdminMusicSemanticClient();
const unknown = "확인되지 않았어요.";
const notKnown = "알 수 없음";
const unavailableMessage = {
  not_configured: "음악 분석 모델이 설정되지 않았어요.",
  provider_error: "모델의 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  invalid_response: "모델의 음악 분석 결과를 확인할 수 없어요.",
  timed_out: "응답 시간이 길어졌어요. 더 짧은 파일로 다시 시도해 주세요.",
} as const;
const audioUnavailable = {
  ...unavailableMessage,
  invalid_response: "모델의 분석 결과를 확인할 수 없어요.",
  undetermined: "음악인지 음성인지 판별하지 못했어요. 자동으로 다시 보내지 않았어요. ‘음성’ 또는 ‘음악’ 모드를 골라 다시 실행해 주세요.",
} as const;
const modes = [
  { mode: "music", label: "음악", run: "음악 의미 분석 실행", busy: "장르, 악기, 템포와 구간 구조를 분석하는 중이에요." },
  { mode: "auto", label: "자동 판별", run: "자동 판별 분석 실행", busy: "음악인지 음성인지 판별한 뒤 분석하는 중이에요." },
  { mode: "speech", label: "음성", run: "음성 분석 실행", busy: "요약, 주제, 할 일과 화자별 전사를 분석하는 중이에요." },
] as const satisfies readonly { mode: AdminAudioMode; label: string; run: string; busy: string }[];
const kindName = { music: "음악", speech: "음성", undetermined: "판별 불가" } as const;
/** P1-07-AUDIO-ORIGINAL-PARITY-UI G2: 원본 '분석 엔진 가동 중 (길이에 따라 …)' 안내를 기존 모드별 진행 문장 뒤에 붙인다.
 *  분석 중에만 role=status 한 줄로 나오고, 바로 아래 AudioAnalysisProgress가 움직이는 막대와 지난 시간을 보여 준다.
 *  2026-11-24 대기 시간을 원본처럼 늘려(기본 120초·상세 200초) 안내도 '몇 분'으로 바꿨다. */
export function analyzingStatus(mode: AdminAudioMode) {
  return `${modes.find(item => item.mode === mode)!.busy} 파일 길이에 따라 몇 분 걸릴 수 있어요.`;
}

type Props = {
  file?: File; client?: AdminMusicSemanticClient; disabled?: boolean;
  /** 운영 허브 음악 칸(admin-premiere-programs)의 결과 공개 준비. 음악 모드 기본 보고서에만 단추를 둔다(운영 33ff5a0 동작 유지). */
  onPrepare?: (draft: PublicationDraft) => void;
  /** 원본 셸이 고른 분석 모드와 상세 보고서(v2) 여부. */
  mode?: AdminAudioMode; detail?: boolean;
  /** 상세 결과의 '새 파일 분석'(A-3): 셸이 파일을 비운다. */
  onReset?: () => void;
  /** A-5 원본 셸: 정상 완료 상세 보고서를 보이는지 알린다. 주면 완료 뒤 동의·실행 칸을 접고 보고서 제목으로 초점을 옮긴다. */
  onReport?: (shown: boolean) => void;
  /** 미설정 안내의 설정 링크. 생략하면 관리자 API연동, null이면 숨김. */
  settingsHref?: SettingsHref;
};

/** Pass the currently selected music file from the existing analyzer. */
export function AdminMusicSemantic({ file, client = defaultClient, disabled, onPrepare, settingsHref = ADMIN_SETTINGS_HREF, mode = "music", detail = false, onReset, onReport }: Props) {
  const [selection, setSelection] = useState({ file, version: 0 });
  if (selection.file !== file) setSelection({ file, version: selection.version + 1 });
  // 주인님 지시(2026-11-24): 원본 키트처럼 제목·동의 상자 없이 분석 버튼으로 바로 실행한다.
  return <section className={styles.panel} aria-label="오디오 분석 실행">
    {file ? <MusicFileAnalysis key={selection.version} file={file} client={client} disabled={disabled} onPrepare={onPrepare} settingsHref={settingsHref} mode={mode} detail={detail} onReset={onReset} onReport={onReport} />
      : <p>음악 파일을 선택하면 의미 분석을 실행할 수 있어요.</p>}
  </section>;
}

type Outcome = { mode: "music"; result: MusicSemanticResult } | { mode: Exclude<AdminAudioMode, "music">; result: AdminAudioResponse }
  | { mode: "detail"; result: DetailedAudioResponse };
function MusicFileAnalysis({ file, client, disabled, onPrepare, settingsHref, mode, detail, onReset, onReport }: Props & { file: File; client: AdminMusicSemanticClient; mode: AdminAudioMode; detail: boolean }) {
  const [outcome, setOutcome] = useState<Outcome>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<Awaited<ReturnType<AdminMusicSemanticClient["availability"]>>>();
  const [check, setCheck] = useState(0);
  const request = useRef<AbortController | null>(null);
  const fileIssue = directAudioIssue(file);
  const current = modes.find(item => item.mode === mode)!;
  useEffect(() => {
    const controller = new AbortController();
    void client.availability(controller.signal).then(outcome => {
      if (!controller.signal.aborted) setAvailability(outcome);
    });
    return () => controller.abort();
  }, [check, client]);
  // 모드·보고서 종류가 바뀌면 그린 직후(화면 반영 전) 진행 중 요청을 끊는다. 떠날 때도 같다. 자동 실행은 없다.
  const [basis, setBasis] = useState({ mode, detail });
  if (basis.mode !== mode || basis.detail !== detail) {
    setBasis({ mode, detail });
    setBusy(false);
    setOutcome(undefined);
    setError("");
  }
  useLayoutEffect(() => () => { request.current?.abort(); request.current = null; }, [mode, detail]);
  const reported = outcome?.mode === "detail" && completedDetail(outcome.result);
  useEffect(() => { onReport?.(reported); }, [reported, onReport]);
  useEffect(() => () => onReport?.(false), [onReport]);
  const folded = reported && !!onReport;

  async function analyze() {
    if (disabled || fileIssue || availability?.kind !== "ok" || !availability.configured || request.current) return;
    const controller = new AbortController();
    const sent = mode;
    request.current = controller;
    setBusy(true);
    setOutcome(undefined);
    setError("");
    const detailed = detail;
    const reply = detailed ? await client.analyzeDetailed(file, sent, true, controller.signal)
      : sent === "music" ? await client.analyze(file, true, controller.signal) : await client.analyzeAudio(file, sent, true, controller.signal);
    if (controller.signal.aborted || request.current !== controller) return;
    request.current = null;
    setBusy(false);
    if (reply.kind === "failed") { setError(reply.message); return; }
    const result = reply.result;
    if (result.status === "unavailable" && result.reason === "not_configured") {
      setAvailability({ kind: "ok", configured: false });
      return;
    }
    setOutcome(detailed ? { mode: "detail", result: result as DetailedAudioResponse }
      : sent === "music" ? { mode: "music", result: result as MusicSemanticResult } : { mode: sent, result: result as AdminAudioResponse });
  }

  const configured = availability?.kind === "ok" && availability.configured;
  // 완료 보고서를 보이는 동안(원본 셸)은 동의·실행 칸을 접는다. 새 파일 분석이나 모드·보고서 종류를 바꾸면 다시 나온다.
  if (folded && outcome?.mode === "detail") return <DetailedAudioReport result={outcome.result} fileName={file.name} onReset={onReset} focusOnShow />;
  return <>
    {!availability && <p role="status">음악 모델 설정을 확인하는 중이에요.</p>}
    {availability?.kind === "failed" && <div>
      <p role="alert">{availability.message}</p>
      <Button type="button" variant="secondary" onClick={() => { setAvailability(undefined); setCheck(value => value + 1); }}>설정 다시 확인</Button>
    </div>}
    {availability?.kind === "ok" && !configured && <>
      <p role="status">{unavailableMessage.not_configured}</p>
      <SettingsLink href={settingsHref ?? null} className={analysisStyles.link} />
    </>}
    {fileIssue && <p role="status">{fileIssue}</p>}
    {configured && <>
      <Button type="button" loading={busy} loadingLabel="분석 중" disabled={!!fileIssue || disabled} onClick={analyze}>{detail ? `${current.run} (상세)` : current.run}</Button>
    </>}
    {busy && <p role="status">{analyzingStatus(mode)}</p>}
    {busy && <AudioAnalysisProgress limitSeconds={detail ? audioWaitSeconds.detailed : audioWaitSeconds.basic} />}
    {error && <p role="alert">{error}</p>}
    {outcome?.mode === "music" && <MusicReport result={outcome.result} onPrepare={onPrepare} />}
    {outcome && outcome.mode !== "music" && outcome.mode !== "detail" && <AudioReport result={outcome.result} />}
    {outcome?.mode === "detail" && <DetailedAudioReport result={outcome.result} fileName={file.name} onReset={onReset} />}
  </>;
}

// 자동·음성 응답: 음악으로 판별되면 기존 음악 보고서를 그대로 쓰고, 음성은 요약·주제·할 일·화자별 전사를 보여 준다.
export function AudioReport({ result }: { result: AdminAudioResponse }) {
  const auto = result.requestedMode === "auto";
  const detected = auto && <p>자동 판별 결과 · {kindName[result.kind]}</p>;
  if (result.status === "unavailable") {
    const message = audioUnavailable[result.reason];
    return <div className={styles.report}>
      {detected}
      <p role="status">{auto && result.kind !== "undetermined" && result.reason !== "undetermined" ? `${kindName[result.kind]}으로 판별했지만 보고서를 만들지 못했어요. ${message}` : message}</p>
    </div>;
  }
  if (result.kind === "music") return <div className={styles.report}>
    {detected}
    <MusicReport result={{ status: result.status, provider: result.provider, report: result.report }} />
  </div>;
  return <div className={styles.report}>
    {detected}
    <SpeechReportView report={result.report} partial={result.status === "partial"} />
  </div>;
}

function SpeechReportView({ report, partial }: { report: SpeechReport; partial: boolean }) {
  const { summary, topicsAndKeywords, actionItems, fullTranscription } = report;
  return <div className={styles.report}>
    <h4>음성 분석 결과</h4>
    <p>Gemini 추정 · {partial ? "일부 항목만 확인" : "제공된 음성 파일 기준"}</p>
    <h5>요약</h5>
    <p>{summary ?? notKnown}</p>
    <h5>주제·키워드</h5>
    {topicsAndKeywords ? <ul className={styles.topics}>{topicsAndKeywords.map(({ topic, keywords }, index) => <li key={index}>
      <strong>{topic}</strong>
      {keywords ? <ul className={styles.chips} aria-label={`${topic} 키워드`}>{keywords.map((keyword, at) => <li key={at}>{keyword}</li>)}</ul>
        : <span className={styles.hint}>키워드 {notKnown}</span>}
    </li>)}</ul> : <p>{notKnown}</p>}
    <h5>할 일</h5>
    {actionItems ? <ol className={styles.structure}>{actionItems.map(({ task, assignee, dueDate }, index) => <li key={index}>
      <span className={styles.step}>{index + 1}</span>
      <div><strong>{task}</strong><p className={styles.hint}>담당 {assignee ?? notKnown} · 기한 {dueDate ?? notKnown}</p></div>
    </li>)}</ol> : <p>{notKnown}</p>}
    <h5>화자별 전사</h5>
    {fullTranscription ? <>
      <p className={styles.hint}>시각은 음원 시작 기준 추정값이에요.</p>
      <ol className={styles.transcript}>{fullTranscription.map(({ speaker, timestamp, text }, index) => <li key={index}>
        <p className={styles.speaker}><strong>{speaker ?? `화자 ${notKnown}`}</strong> · <span>{timestamp ?? `시각 ${notKnown}`}</span></p>
        <p>{text}</p>
      </li>)}</ol>
    </> : <p>{notKnown}</p>}
  </div>;
}

// Audio Analyzer v1.01 MusicReportView 순서(장르·스타일 → BPM·템포 → Suno 프롬프트 → 곡 구조)로, 지금 서버가 주는
// 다섯 값만 보여 준다. 조성·박자·코드·스템·가사처럼 서버가 주지 않는 칸은 만들지 않는다.
function MusicReport({ result, onPrepare }: { result: MusicSemanticResult; onPrepare?: Props["onPrepare"] }) {
  if (result.status === "unavailable") return <p role="status">{unavailableMessage[result.reason]}</p>;
  const { genre, instruments, tempoBpm, structure, sunoPrompt } = result.report;
  return <div className={styles.report}>
    <h4>음악 의미 분석 결과</h4>
    <p>Gemini 추정 · {result.status === "partial" ? "일부 항목만 확인" : "제공된 음악 파일 기준"}</p>
    <dl className={styles.details}>
      <div className={styles.tile}><dt>장르 · 악기</dt><dd>
        <strong className={styles.big}>{genre ?? unknown}</strong>
        {instruments ? <ul className={styles.chips} aria-label="악기">{instruments.map((item, index) => <li key={index}>{item}</li>)}</ul> : <span>악기 {unknown}</span>}
      </dd></div>
      <div className={styles.tile}><dt>추정 템포</dt><dd>
        {tempoBpm === null ? unknown : <><strong className={styles.big}>{tempoBpm}</strong> BPM</>}
      </dd></div>
    </dl>
    <h5>Suno용 프롬프트 제안</h5>
    {sunoPrompt ? <SunoPrompt original={sunoPrompt} /> : <p>{unknown}</p>}
    <h5>구간 구조</h5>
    {structure ? <ol className={styles.structure}>{structure.map(({ label, description }, index) => <li key={index}>
      <span className={styles.step}>{index + 1}</span><div><strong>{label}</strong><p>{description}</p></div>
    </li>)}</ol> : <p>{unknown}</p>}
    {onPrepare && <Button type="button" variant="secondary" onClick={() => onPrepare(musicPublicationDraft(result.report))}>공개 준비</Button>}
  </div>;
}
