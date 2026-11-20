"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import type { MusicSemanticResult } from "@/lib/reference-analysis/music-semantic-contract";
import { analysisInputIssue } from "./admin-reference-analysis-model";
import { createAdminMusicSemanticClient, type AdminMusicSemanticClient } from "./admin-music-semantic-client";
import styles from "./admin-music-semantic.module.css";

const defaultClient = createAdminMusicSemanticClient();
const unknown = "확인되지 않았어요.";
const unavailableMessage = {
  not_configured: "음악 분석 모델이 설정되지 않았어요.",
  provider_error: "모델의 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  invalid_response: "모델의 음악 분석 결과를 확인할 수 없어요.",
  timed_out: "응답 시간이 길어졌어요. 더 짧은 파일로 다시 시도해 주세요.",
} as const;

type Props = { file?: File; client?: AdminMusicSemanticClient; disabled?: boolean };

/** Pass the currently selected music file from the existing analyzer. */
export function AdminMusicSemantic({ file, client = defaultClient, disabled }: Props) {
  const [selection, setSelection] = useState({ file, version: 0 });
  if (selection.file !== file) setSelection({ file, version: selection.version + 1 });
  const id = useId();
  return <section className={styles.panel} aria-labelledby={id}>
    <h3 id={id}>음악 의미 분석</h3>
    {file ? <MusicFileAnalysis key={selection.version} file={file} client={client} disabled={disabled} />
      : <p>음악 파일을 선택하면 의미 분석을 실행할 수 있어요.</p>}
  </section>;
}

function MusicFileAnalysis({ file, client, disabled }: { file: File; client: AdminMusicSemanticClient; disabled?: boolean }) {
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<MusicSemanticResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<Awaited<ReturnType<AdminMusicSemanticClient["availability"]>>>();
  const [check, setCheck] = useState(0);
  const request = useRef<AbortController | null>(null);
  const fileIssue = analysisInputIssue({ kind: "file", media: "music", file });
  useEffect(() => {
    const controller = new AbortController();
    void client.availability(controller.signal).then(outcome => {
      if (!controller.signal.aborted) setAvailability(outcome);
    });
    return () => controller.abort();
  }, [check, client]);
  useEffect(() => () => request.current?.abort(), []);

  async function analyze() {
    if (disabled || fileIssue || !consent || availability?.kind !== "ok" || !availability.configured || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setResult(undefined);
    setError("");
    const outcome = await client.analyze(file, true, controller.signal);
    if (controller.signal.aborted || request.current !== controller) return;
    request.current = null;
    setBusy(false);
    if (outcome.kind === "ok") setResult(outcome.result);
    else setError(outcome.message);
  }

  const configured = availability?.kind === "ok" && availability.configured;
  return <>
    {!availability && <p role="status">음악 모델 설정을 확인하는 중이에요.</p>}
    {availability?.kind === "failed" && <div>
      <p role="alert">{availability.message}</p>
      <Button type="button" variant="secondary" onClick={() => { setAvailability(undefined); setCheck(value => value + 1); }}>설정 다시 확인</Button>
    </div>}
    {availability?.kind === "ok" && !configured && <p role="status">{unavailableMessage.not_configured}</p>}
    {fileIssue && <p role="status">{fileIssue}</p>}
    {configured && <>
      <label className={styles.consent}>
        <input type="checkbox" checked={consent} disabled={busy || disabled || !!fileIssue} onChange={event => setConsent(event.target.checked)} />
        이 파일을 분석할 권리가 있고, 음악 분석을 위해 Gemini에 원본 파일을 전송하는 데 동의해요.
      </label>
      <Button type="button" loading={busy} loadingLabel="음악 분석 중" disabled={!consent || !!fileIssue || disabled} onClick={analyze}>음악 의미 분석 실행</Button>
    </>}
    {busy && <p role="status">장르, 악기, 템포와 구간 구조를 분석하는 중이에요.</p>}
    {error && <p role="alert">{error}</p>}
    {result && <MusicReport result={result} />}
  </>;
}

function MusicReport({ result }: { result: MusicSemanticResult }) {
  const [copy, setCopy] = useState("");
  const prompt = useRef<HTMLTextAreaElement>(null);
  if (result.status === "unavailable") return <p role="status">{unavailableMessage[result.reason]}</p>;
  const { genre, instruments, tempoBpm, structure, sunoPrompt } = result.report;
  async function copyPrompt() {
    if (!sunoPrompt) return;
    try { await navigator.clipboard.writeText(sunoPrompt); setCopy("Suno 프롬프트를 복사했어요."); }
    catch { prompt.current?.focus(); prompt.current?.select(); setCopy("선택된 프롬프트를 직접 복사해 주세요."); }
  }

  return <div className={styles.report}>
    <h4>음악 의미 분석 결과</h4>
    <p>Gemini 추정 · {result.status === "partial" ? "일부 항목만 확인" : "제공된 음악 파일 기준"}</p>
    <dl className={styles.details}>
      <div><dt>장르</dt><dd>{genre ?? unknown}</dd></div>
      <div><dt>악기</dt><dd>{instruments?.join(" · ") ?? unknown}</dd></div>
      <div><dt>추정 템포</dt><dd>{tempoBpm === null ? unknown : `${tempoBpm} BPM`}</dd></div>
    </dl>
    <h5>구간 구조</h5>
    {structure ? <ol>{structure.map(({ label, description }, index) => <li key={index}><strong>{label}</strong> · {description}</li>)}</ol>
      : <p>{unknown}</p>}
    <h5>Suno용 프롬프트 제안</h5>
    {sunoPrompt ? <>
      <textarea ref={prompt} className={styles.prompt} aria-label="Suno용 프롬프트 제안" readOnly value={sunoPrompt} />
      <Button type="button" variant="secondary" onClick={copyPrompt}>Suno 프롬프트 복사</Button>
      <p role="status">{copy}</p>
    </> : <p>{unknown}</p>}
  </div>;
}
