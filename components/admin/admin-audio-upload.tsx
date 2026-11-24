"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { AdminAudioMode } from "@/lib/reference-analysis/admin-audio-contract";
import { completedDetail, DetailedAudioReport } from "./admin-audio-detail-report";
import { AudioReport } from "./admin-music-semantic";
import { AudioAnalysisProgress, audioWaitSeconds, largeFilePreparationSeconds } from "./audio-analysis-progress";
import {
  createAudioUploadClient, guidance, guidanceLimit, type AudioUploadClient, type AudioUploadView, type UploadReply,
} from "./audio-upload-client";
import styles from "./admin-music-semantic.module.css";
import own from "./admin-audio-upload.module.css";
import analysisStyles from "./admin-reference-analysis.module.css";
import { ADMIN_SETTINGS_HREF, SettingsLink, type SettingsHref } from "./admin-settings-link";

// P1-07 원본 v1.15 대용량(최대 100 MiB) 업로드 분석 화면(Backend 298cc8f 계약).
// 1) 명시 동의 뒤 서버의 비공개 임시 저장소에 접수하고 2 MiB씩 서버가 받은 위치부터 보낸다(끊기면 상태를 읽어 잇는다, Gemini 전송 없음).
// 2) 다 받은 뒤에만 모드·분석 맥락·특별 요청과 Gemini 전송 동의를 확인해 분석을 한 번 실행한다(같은 요청 ID로만 다시 보낸다).
// 접수·분석 요청 ID는 화면이 만든 UUID이고, 응답이 끊기면 같은 ID로 다시 확인한다. 설정(키 버전)·파일·조건이 바뀌면 동의를 다시 받는다
// (조건을 바꿨다가 되돌려도 이전 동의는 살아나지 않는다).
// 취소·정리는 사용자가 누를 때만 보낸다. FLAC는 A-2에서 서버(3580c96)와 같은 형식 판정으로 켰다.
// P1-07 A-1: 분석 모드·보고서 종류·분석 맥락·특별 요청은 원본 셸(audio-original/audio-studio)의 입력을 받는다(생략하면 음악·기본·빈 값).
// 셸에는 접수가 시작됐는지(이 경로 고정)와 분석 중인지(입력 잠금)를 알린다.
const defaultClient = createAudioUploadClient();
const modes = [
  { mode: "music", label: "음악", hint: "장르·악기·템포·구간 구조와 Suno 프롬프트를 분석해요." },
  { mode: "auto", label: "자동 판별", hint: "먼저 음악인지 음성인지 판별하고, 판별되면 그 종류로 한 번 분석해요. 판별하지 못하면 다시 보내지 않아요." },
  { mode: "speech", label: "음성", hint: "말소리의 요약·주제·할 일과 화자별 전사를 분석해요." },
] as const satisfies readonly { mode: AdminAudioMode; label: string; hint: string }[];
const modeName = (mode: AdminAudioMode) => modes.find(item => item.mode === mode)!.label;
export const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

const codeText: Record<string, string> = {
  stale_credential: "음악 분석 설정이 바뀌었어요. 최신 설정을 다시 읽었어요.",
  not_configured: "음악 분석 모델이 설정되지 않았어요.",
  storage_unavailable: "업로드 저장소를 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요.",
  // 관리자 감싸개의 일시 장애(로그인 확인·저장소 열기 예외, 503). 서버 원문은 보이지 않고 이 고정 안내만 보인다.
  unavailable: "서버가 지금 업로드를 처리할 수 없어요. 잠시 뒤 다시 시도해 주세요.",
  upload_limit: "끝나지 않은 업로드가 많아요. 다른 업로드를 끝내거나 취소한 뒤 다시 시도해 주세요.",
  too_large: "업로드는 100 MiB까지 가능해요.",
  invalid_input: "파일 이름·크기나 분석 입력을 확인해 주세요.",
  not_found: "이 접수를 찾을 수 없어요. 새로 올려 주세요.",
  expired: "접수 보관 기한이 지나 서버가 정리했어요. 새로 올려 주세요.",
  cancelled: "취소한 접수예요.",
  upload_closed: "이 접수는 더 받을 수 없는 상태예요.",
  analysis_conflict: "이 접수는 다른 분석 요청으로 이미 처리 중이거나 끝났어요. ‘상태 확인’으로 결과를 읽어 주세요.",
  request_conflict: "같은 요청 번호로 다른 내용이 접수돼 있어요. 다시 시도하면 새 번호로 보내요.",
  invalid_file: "올린 파일을 오디오로 확인하지 못했어요. 파일 형식과 내용을 확인해 주세요.",
  // 3580c96: 서버의 오디오 검사 도구(FFprobe·FFmpeg) 준비 실패. 검사는 Gemini 전송 전에 하므로 공급자 실패와 다르다.
  media_unavailable: "서버의 오디오 검사 도구를 준비하지 못해 분석하지 못했어요. Gemini로 보내지 않았어요. 서버 준비를 확인한 뒤 새로 올려 다시 시도해 주세요.",
  processing_stopped: "분석이 중단됐어요.",
  timed_out: "응답 시간이 길어졌어요. 잠시 뒤 새로 올려 다시 시도해 주세요.",
  provider_error: "모델의 응답을 받지 못했어요. 잠시 뒤 새로 올려 다시 시도해 주세요.",
  invalid_response: "모델의 분석 결과를 확인할 수 없어요.",
};
const statusText: Record<number, string> = {
  401: "다시 로그인한 뒤 시도해 주세요.",
  403: "관리자 권한과 현재 사이트에서 보낸 요청인지 확인해 주세요.",
};
/** 실패 응답(상태·코드)의 화면 안내. 아는 코드 → 상태 → 일반 안내 순서. */
export const uploadProblemText = (status: number, code: string) => codeText[code] ?? statusText[status] ?? "응답을 확인하지 못했어요. 다시 시도해 주세요.";
const terminal = (upload?: AudioUploadView) => !!upload && ["completed", "failed", "cancelled", "expired"].includes(upload.status);
const cleanupText = {
  none: "Gemini로 보낸 파일은 없어요.",
  done: "Gemini로 보낸 임시 파일까지 정리했어요.",
  pending: "Gemini로 보낸 임시 파일 정리를 아직 확인하지 못했어요. ‘정리 다시 시도’를 누르면 이 접수의 같은 파일만 다시 지워요.",
  unconfirmed: "Gemini에 보낸 파일 이름을 서버가 확인하지 못해 정리 여부를 알 수 없어요.",
} as const;

type Settings = { kind: "ok"; configured: boolean; version: number } | { kind: "failed"; login: boolean };
type Notice = { tone: "status" | "alert"; text: string };
type Work = "" | "start" | "send" | "analyze" | "check" | "cancel" | "cleanup";
type Sent = { mode: AdminAudioMode; context?: string; specialRequest?: string; reportVersion?: 2 };
export type UploadState = { started: boolean; locked: boolean };
type Props = {
  file: File; client?: AudioUploadClient; settingsHref?: SettingsHref;
  mode?: AdminAudioMode; detail?: boolean; context?: string; special?: string; onState?: (state: UploadState) => void;
  /** 결과에서 '새 파일 분석'을 누르면 셸이 파일을 비운다(A-3). */
  onReset?: () => void;
  /** A-5 원본 셸: 정상 완료 상세 보고서를 보이는지 알린다. 주면 그동안 1·2단계 칸을 접는다(정리·새로 올리기·안내는 그대로). */
  onReport?: (shown: boolean) => void;
};

/** 큰 파일(또는 업로드 방식을 고른 작은 파일)의 업로드 분석. 파일이 바뀌면 안쪽을 새로 그려 진행 중 요청·동의·결과를 버린다. */
export function AdminAudioUpload({ file, client = defaultClient, settingsHref = ADMIN_SETTINGS_HREF, ...input }: Props) {
  const [selection, setSelection] = useState({ file, version: 0 });
  if (selection.file !== file) setSelection({ file, version: selection.version + 1 });
  const id = useId();
  return <section className={styles.panel} aria-labelledby={id}>
    <h3 id={id}>업로드 후 분석</h3>
    <p className={styles.hint}>파일을 서버의 비공개 임시 저장소에 2 MiB씩 나눠 올리고, 모두 받은 뒤 따로 분석을 실행해요. 올리는 동안에는 Gemini로 보내지 않아요.</p>
    <UploadBody key={selection.version} file={file} client={client} settingsHref={settingsHref} {...input} />
  </section>;
}

function UploadBody({ file, client, settingsHref, mode = "music", detail = false, context = "", special = "", onState, onReset, onReport }: Props & { client: AudioUploadClient }) {
  const [settings, setSettings] = useState<Settings>();
  const [check, setCheck] = useState(0);
  const [upload, setUpload] = useState<AudioUploadView>();
  const [work, setWork] = useState<Work>("");
  const [notice, setNotice] = useState<Notice>();
  const [startLost, setStartLost] = useState(false);
  const [analysisLost, setAnalysisLost] = useState(false);
  const [sent, setSent] = useState<Sent>();
  const run = useRef<AbortController | null>(null);
  const startId = useRef<{ id: string; version: number } | null>(null);
  const analysisId = useRef<{ id: string; key: string } | null>(null);
  // A-3: 이 접수에 상세(v2) 분석을 보낸 뒤에는 조회·같은 요청 재전송·취소·정리·조각 요청에 확장 프로필을 그대로 붙인다.
  // 기본(v1) 분석이나 분석 전 요청은 머리글 없이(서버 기본). 새 접수('새로 올리기')에서 다시 정한다.
  const expanded = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void client.settings(controller.signal).then(outcome => { if (!controller.signal.aborted) setSettings(outcome); });
    return () => controller.abort();
  }, [check, client]);
  useEffect(() => () => run.current?.abort(), []);
  const started = !!upload || startLost || work === "start";
  const locked = work === "analyze" || upload?.status === "analyzing";
  useEffect(() => {
    onState?.({ started, locked });
    return () => onState?.({ started: false, locked: false });
  }, [started, locked, onState]);
  const done = upload?.status === "completed" ? upload.report : undefined;
  const reported = !!done && !!sent && done.schemaVersion === 2 && sent.reportVersion === 2 && done.requestedMode === sent.mode && completedDetail(done);
  useEffect(() => { onReport?.(reported); }, [reported, onReport]);
  useEffect(() => () => onReport?.(false), [onReport]);
  const folded = reported && !!onReport;

  const ready = settings?.kind === "ok" && settings.configured ? settings : undefined;
  const wanted: Sent = { mode, context: guidance(context), specialRequest: guidance(special), ...(detail && { reportVersion: 2 as const }) };
  // 상세 여부도 동의·요청 ID 조건에 묶는다(서버는 reportVersion을 같은 요청 ID 재전송 비교에 넣는다).
  const conditionKey = upload && ready ? JSON.stringify([upload.id, ready.version, wanted.mode, wanted.context ?? "", wanted.specialRequest ?? "", detail ? 2 : 1]) : "";
  // 주인님 지시(2026-11-24): 동의 상자 없이 버튼으로 바로 진행한다(원본 키트와 같음). 요청 ID는 여전히 조건 키에 묶는다.
  const transferAgreed = !!ready;
  const analysisAgreed = !!conditionKey;
  const tooLong = [...context.trim()].length > guidanceLimit || [...special.trim()].length > guidanceLimit;

  const say = (tone: Notice["tone"], text: string) => setNotice({ tone, text });
  function begin(kind: Work) {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setWork(kind);
    setNotice(undefined);
    return controller;
  }
  const live = (controller: AbortController) => run.current === controller && !controller.signal.aborted;
  function finish(controller: AbortController) {
    if (run.current !== controller) return;
    run.current = null;
    setWork("");
  }
  // 설정이 바뀌었거나 모델이 없어졌으면 최신 설정을 다시 읽고 두 동의를 모두 풀어 다시 받는다.
  function reloadSettings() {
    setSettings(undefined);
    setCheck(value => value + 1);
    startId.current = null;
    analysisId.current = null;
  }

  function describe(current: AudioUploadView) {
    if (current.status === "uploaded") say("status", "파일을 모두 올렸어요. 위에서 고른 분석 조건과 아래 보낼 내용을 확인한 뒤 실행해 주세요.");
    else if (current.status === "uploading") say("status", "아직 다 올리지 않았어요. ‘이어 올리기’를 누르면 서버가 받은 위치부터 보내요.");
    else if (current.status === "analyzing") say("status", "분석이 진행 중이에요. ‘상태 확인’을 누르면 같은 접수의 결과를 읽어요.");
    else if (current.status === "completed") say("status", "분석을 마쳤어요.");
    else if (current.status === "cancelled") say("status", "업로드를 취소했어요.");
    else if (current.status === "expired") say("alert", codeText.expired);
    else say("alert", `${uploadProblemText(0, current.code ?? "")} 이 접수는 끝났어요. 다시 분석하려면 ‘새로 올리기’를 눌러 주세요.`);
  }
  function problem(reply: Extract<UploadReply, { kind: "problem" }>) {
    if (reply.upload) setUpload(reply.upload);
    if (reply.code === "stale_credential" || reply.code === "not_configured") reloadSettings();
    if (reply.code === "request_conflict") { startId.current = null; analysisId.current = null; }
    const stuck = reply.code === "stale_credential" && reply.upload && !terminal(reply.upload)
      ? " 이 접수는 이전 설정으로 만들어져 이어서 쓸 수 없어요. 취소한 뒤 새로 올려 주세요." : "";
    const again = reply.code === "stale_credential" ? " 확인한 뒤 다시 동의해 주세요." : "";
    say("alert", uploadProblemText(reply.status, reply.code) + again + stuck);
  }

  // 서버가 받은 위치(receivedBytes)부터 chunkBytes씩 보낸다. 끊김·위치 차이는 상태를 읽어 잇고, 연달아 세 번 넘게 진척이 없으면 멈춘다.
  async function send(controller: AbortController, first: AudioUploadView) {
    setWork("send");
    let current = first;
    let misses = 0;
    while (current.status === "uploading" && misses <= 3) {
      const offset = current.receivedBytes;
      const reply = await client.chunk(current.id, offset, file.slice(offset, Math.min(offset + current.chunkBytes, current.sizeBytes)), controller.signal, expanded.current);
      if (!live(controller) || reply.kind === "aborted") return;
      if (reply.kind === "ok") {
        misses = reply.upload.receivedBytes > offset ? 0 : misses + 1;
        current = reply.upload;
        setUpload(current);
        continue;
      }
      if (reply.kind === "problem" && !["offset_conflict", "chunk_conflict", "chunk_size", "timed_out"].includes(reply.code)) {
        finish(controller);
        problem(reply);
        return;
      }
      misses += 1;
      const state = await client.read(current.id, controller.signal, expanded.current);
      if (!live(controller) || state.kind === "aborted") return;
      if (state.kind !== "ok") break;
      current = state.upload;
      setUpload(current);
    }
    finish(controller);
    if (current.status === "uploading") say("alert", "전송이 끊겨 멈췄어요. ‘이어 올리기’를 누르면 서버가 받은 위치부터 다시 보내요.");
    else describe(current);
  }

  async function start() {
    if (!ready || !transferAgreed || work || upload) return;
    const receipt = startId.current?.version === ready.version ? startId.current : { id: crypto.randomUUID(), version: ready.version };
    startId.current = receipt;
    const controller = begin("start");
    const reply = await client.start({ requestId: receipt.id, credentialVersion: ready.version, filename: file.name.trim(), sizeBytes: file.size },
      controller.signal);
    if (!live(controller) || reply.kind === "aborted") return;
    if (reply.kind === "lost") {
      finish(controller);
      setStartLost(true);
      say("alert", "접수 응답을 받지 못했어요. ‘접수 다시 확인’을 누르면 같은 접수 번호로 확인해요. 새 접수를 만들지 않아요.");
      return;
    }
    setStartLost(false);
    if (reply.kind === "problem") {
      startId.current = null;
      finish(controller);
      problem(reply);
      return;
    }
    setUpload(reply.upload);
    if (reply.upload.status === "uploading") await send(controller, reply.upload);
    else { finish(controller); describe(reply.upload); }
  }

  // 지금 상태를 읽는다(이어 올리기 전 위치 확인, 분석 결과·취소 응답 유실 확인).
  async function readState(kind: "send" | "check") {
    if (!upload || work) return;
    const controller = begin(kind);
    const reply = await client.read(upload.id, controller.signal, expanded.current);
    if (!live(controller) || reply.kind === "aborted") return;
    if (reply.kind === "lost") { finish(controller); say("alert", "상태를 읽지 못했어요. 잠시 뒤 다시 확인해 주세요."); return; }
    if (reply.kind === "problem") { finish(controller); problem(reply); return; }
    setUpload(reply.upload);
    if (kind === "send" && reply.upload.status === "uploading") { await send(controller, reply.upload); return; }
    finish(controller);
    if (analysisLost && reply.upload.status === "uploaded") {
      say("alert", "분석 요청이 서버에 닿지 않았어요. ‘같은 요청 다시 보내기’를 누르면 같은 요청 번호로 한 번 보내요.");
      return;
    }
    if (reply.upload.status !== "uploaded") setAnalysisLost(false);
    describe(reply.upload);
  }

  async function analyze() {
    if (!upload || upload.status !== "uploaded" || !ready || !analysisAgreed || tooLong || work) return;
    const ask = analysisId.current?.key === conditionKey ? analysisId.current : { id: crypto.randomUUID(), key: conditionKey };
    analysisId.current = ask;
    const request = { ...wanted };
    const controller = begin("analyze");
    setSent(request);
    // 같은 요청 ID는 같은 조건(상세 여부 포함)에서만 다시 쓰므로 프로필도 그대로다.
    expanded.current = request.reportVersion === 2;
    const reply = await client.analyze(upload.id, { requestId: ask.id, credentialVersion: ready.version, ...request }, controller.signal, expanded.current);
    if (!live(controller) || reply.kind === "aborted") return;
    if (reply.kind === "lost") {
      // 응답이 끊기면 같은 접수의 상태를 한 번 읽는다. 아직 'uploaded'면 요청이 닿지 않은 것이라 같은 ID로만 다시 보낼 수 있게 한다.
      setAnalysisLost(true);
      const state = await client.read(upload.id, controller.signal, expanded.current);
      if (!live(controller) || state.kind === "aborted") return;
      finish(controller);
      if (state.kind !== "ok") { say("alert", "분석 응답과 상태를 확인하지 못했어요. ‘상태 확인’을 눌러 다시 읽어 주세요."); return; }
      setUpload(state.upload);
      if (state.upload.status === "uploaded") {
        say("alert", "분석 요청이 서버에 닿지 않았어요. ‘같은 요청 다시 보내기’를 누르면 같은 요청 번호로 한 번 보내요.");
        return;
      }
      setAnalysisLost(false);
      describe(state.upload);
      return;
    }
    finish(controller);
    setAnalysisLost(false);
    if (reply.kind === "problem") { problem(reply); return; }
    setUpload(reply.upload);
    describe(reply.upload);
  }

  async function command(kind: "cancel" | "cleanup") {
    if (!upload) return;
    const controller = begin(kind);
    const reply = kind === "cancel" ? await client.cancel(upload.id, controller.signal, expanded.current)
      : await client.cleanup(upload.id, controller.signal, expanded.current);
    if (!live(controller) || reply.kind === "aborted") return;
    finish(controller);
    if (reply.kind === "lost") { say("alert", `${kind === "cancel" ? "취소" : "정리"} 응답을 받지 못했어요. ‘상태 확인’을 눌러 결과를 읽어 주세요.`); return; }
    if (reply.kind === "problem") { problem(reply); return; }
    setUpload(reply.upload);
    setAnalysisLost(false);
    describe(reply.upload);
  }

  function restart() {
    run.current?.abort();
    run.current = null;
    setWork("");
    setUpload(undefined);
    setNotice(undefined);
    setStartLost(false);
    setAnalysisLost(false);
    setSent(undefined);
    startId.current = null;
    analysisId.current = null;
    expanded.current = false;
  }

  if (!settings) return <p role="status">음악 분석 설정을 확인하는 중이에요.</p>;
  if (settings.kind === "failed") return <div className={own.row}>
    <p role="alert">{settings.login ? "다시 로그인한 뒤 시도해 주세요." : "음악 분석 설정을 확인하지 못했어요."}</p>
    <Button type="button" variant="secondary" onClick={reloadSettings}>설정 다시 확인</Button>
  </div>;
  if (!ready) return <>
    <p role="status">큰 파일 분석에는 API연동에 저장한 음악 분석 키와 모델이 필요해요.</p>
    <SettingsLink href={settingsHref ?? null} className={analysisStyles.link} />
  </>;

  const status = upload?.status;
  const received = upload?.receivedBytes ?? 0;
  const cancellable = status === "uploading" || status === "uploaded" || status === "analyzing";
  const ended = terminal(upload);
  const report = status === "completed" ? upload?.report : undefined;
  const matching = report && sent && report.requestedMode === sent.mode && report.schemaVersion === (sent.reportVersion ?? 1);
  const changed = !!sent && JSON.stringify(sent) !== JSON.stringify(wanted);
  return <>
    {!folded && <ol className={own.steps}>
      <li className={own.step}>
        <h4>1. 서버에 올리기</h4>
        <p className={styles.hint}>{file.name} · {megabytes(file.size)}</p>
        <div className={own.row}>
          {!upload && <Button type="button" loading={work === "start"} loadingLabel="접수 중" disabled={!transferAgreed || !!work} onClick={start}>
            {startLost ? "접수 다시 확인" : "서버에 올리기"}</Button>}
          {status === "uploading" && !work && <Button type="button" onClick={() => readState("send")}>이어 올리기</Button>}
          {cancellable && <Button type="button" variant="danger" loading={work === "cancel"} loadingLabel="취소 중" onClick={() => command("cancel")}>업로드 취소</Button>}
          {upload && !work && status !== "uploading" && !ended && <Button type="button" variant="secondary" onClick={() => readState("check")}>상태 확인</Button>}
        </div>
        {upload && <div className={own.progress}>
          <progress max={upload.sizeBytes} value={received} aria-label="서버가 받은 크기" />
          <p>서버가 받은 크기 {megabytes(received)} / {megabytes(upload.sizeBytes)} ({Math.floor(received / upload.sizeBytes * 100)}%)
            {work === "send" ? " · 올리는 중" : ""}</p>
          {!ended && <p className={styles.hint}>접수 보관 기한 {new Date(upload.expiresAt).toLocaleString("ko-KR")} · 기한이 지나면 서버가 지워요.{" "}
            파일이나 방식을 바꾸기 전에 ‘업로드 취소’를 누르면 올린 조각을 바로 지워요.</p>}
        </div>}
      </li>
      <li className={own.step}>
        <h4>2. 보낼 내용 확인과 분석</h4>
        <dl className={own.summary} aria-label="Gemini로 보낼 내용">
          <div><dt>파일</dt><dd>{file.name} · {megabytes(file.size)}</dd></div>
          <div><dt>분석 모드</dt><dd>{modeName(mode)}</dd></div>
          <div><dt>보고서 종류</dt><dd>{detail ? "상세 보고서" : "기본 보고서"}</dd></div>
          <div><dt>분석 맥락</dt><dd>{preview(wanted.context)}</dd></div>
          <div><dt>특별 요청</dt><dd>{preview(wanted.specialRequest)}</dd></div>
        </dl>
        {status !== "uploaded" && !ended && <p className={styles.hint}>파일을 모두 올린 뒤 실행할 수 있어요.</p>}
        {tooLong && <p role="alert">분석 맥락과 특별 요청은 각각 {guidanceLimit.toLocaleString("ko-KR")}자까지 보낼 수 있어요.</p>}
        <Button type="button" loading={work === "analyze"} loadingLabel="분석 중" disabled={status !== "uploaded" || !analysisAgreed || tooLong || !!work}
          onClick={analyze}>{analysisLost ? "같은 요청 다시 보내기" : "업로드한 파일 분석 실행"}</Button>
      </li>
    </ol>}
    {work === "send" && <p role="status">파일을 나눠 올리는 중이에요.</p>}
    {work === "analyze" && <p role="status">{modeName(sent?.mode ?? mode)} 모드로 분석하는 중이에요. 큰 파일은 몇 분 걸릴 수 있어요.</p>}
    {work === "analyze" && <AudioAnalysisProgress limitSeconds={largeFilePreparationSeconds + (sent?.reportVersion === 2 ? audioWaitSeconds.detailed : audioWaitSeconds.basic)} />}
    {notice && <p role={notice.tone}>{notice.text}</p>}
    {ended && upload && <div className={own.row}>
      <p className={styles.hint}>서버에 올린 조각은 지웠어요. {cleanupText[upload.cleanup]}</p>
      {upload.cleanup === "pending" && !work && <Button type="button" variant="secondary" onClick={() => command("cleanup")}>정리 다시 시도</Button>}
      {!work && <Button type="button" variant="secondary" onClick={restart}>새로 올리기</Button>}
    </div>}
    {report && !matching && <p role="alert">분석 결과의 모드나 보고서 종류가 보낸 요청과 달라 표시하지 않았어요. ‘새로 올리기’로 다시 시도해 주세요.</p>}
    {report && matching && <div className={styles.report}>
      <p className={own.basis}>{`이 결과의 조건 · ${file.name} · ${modeName(sent.mode)} 모드 · 분석 맥락 ${sent.context ? `${[...sent.context].length}자` : "없음"}`
        + ` · 특별 요청 ${sent.specialRequest ? `${[...sent.specialRequest].length}자` : "없음"} · ${sent.reportVersion === 2 ? "상세 보고서" : "기본 보고서"}`}</p>
      {changed && <p role="status">지금 입력은 이 결과를 만든 조건과 달라요. 새 조건으로 분석하려면 ‘새로 올리기’를 눌러 주세요.</p>}
      {report.schemaVersion === 2 ? <DetailedAudioReport result={report} fileName={file.name} onReset={onReset} focusOnShow={folded} /> : <AudioReport result={report} />}
      {report.status === "unavailable" && report.reason === "undetermined" &&
        <p className={styles.hint}>이 접수는 끝났어요. 음성 또는 음악 모드를 고른 뒤 ‘새로 올리기’로 다시 올려 분석해 주세요.</p>}
    </div>}
  </>;
}

function preview(text?: string) {
  if (!text) return "없음";
  const chars = [...text];
  return `${chars.length}자 · ${chars.slice(0, 60).join("").replace(/\s+/g, " ")}${chars.length > 60 ? "…" : ""}`;
}
