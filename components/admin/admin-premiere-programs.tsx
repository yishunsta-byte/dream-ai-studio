"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/primitives";
import type { ImageSemanticResult } from "@/lib/reference-analysis/image-semantic-result";
import { youtubeVideoId } from "@/lib/reference-analysis/shorts-analysis-contract";
import { readAnalysisSettings, settingsMessage, type AnalysisSettings } from "./admin-analysis-tools";
import { AdminAnalysisResults, type PreparedPublication } from "./admin-analysis-results";
import { imagePublicationDraft } from "./admin-analysis-publication-draft";
import { StyleDnaReport } from "./admin-style-dna-report";
import type { StyleDna } from "./admin-style-dna-extension";
import { AdminMusicSemantic } from "./admin-music-semantic";
import { AudioWaveform } from "./admin-audio-waveform";
import { PasteUrlField } from "./admin-paste-url";
import { analysisPrograms, analysisResultsSection, navigateAdminSection, useAdminSection } from "./admin-navigation";
import {
  analysisInputIssue, createAdminReferenceAnalysisClient, failureMessage, SUPPORTED_ORIGINS,
  unavailableMessage, UPLOAD_SIZE_LIMIT_LABEL, URL_SIZE_LIMIT_LABEL, type AnalysisSource, type PublicationDraft, type ReadyResult,
} from "./admin-reference-analysis-model";
import { AdminShortsAnalysis } from "./admin-shorts-analysis";
import hub from "./admin.module.css";
import styles from "./admin-premiere-programs.module.css";

const imageClient = createAdminReferenceAnalysisClient();
const apiLink = "#admin-api-integrations";
const loginLink = "/admin/login?next=%2Fadmin%23admin-style-dna";

const copy = [
  { kind: "image", description: "이미지의 색감·조명·구도를 분석해 한국어와 영어로 이미지 생성 프롬프트를 만들어요.", caption: "컬러·구도·조명" },
  { kind: "music", description: "음악의 장르, 악기, 추정 템포와 구간 구조를 살펴봐요.", caption: "장르·악기·템포" },
  { kind: "shorts", description: "YouTube 쇼츠의 첫 장면과 시간대별 근거를 확인해요.", caption: "첫 장면·시간대별 근거" },
] as const;

type Size = { width: number; height: number };
const naturalSize = (image: HTMLImageElement): Size | undefined =>
  image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : undefined;

function LocalMedia({ file, kind, onSize }: { file: File; kind: "image" | "music"; onSize?: (size?: Size) => void }) {
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const player = preview.current?.querySelector("img, audio");
    if (!player) return;
    const url = URL.createObjectURL(file);
    player.setAttribute("src", url);
    return () => {
      player.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file, kind]);

  return <div className={styles.localMedia} ref={preview}>
    {kind === "music" ? <audio controls preload="none" aria-label="선택한 음악 원본" /> : (
      // eslint-disable-next-line @next/next/no-img-element -- The selected file stays in a browser-owned blob URL.
      <img alt="선택한 원본 이미지" onLoad={event => onSize?.(naturalSize(event.currentTarget))} />
    )}
  </div>;
}

function Preview({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.preview} aria-label={title}>
    <h3>{title}</h3>
    <div className={styles.mediaStage}>{children}</div>
  </section>;
}

type ProgramWorkspaceProps = { onPrepare: (draft: PublicationDraft) => void };

function ImagePublicDraft({ result, onPrepare }: ProgramWorkspaceProps & {
  result: Exclude<ImageSemanticResult, { status: "unavailable" }>;
}) {
  const [preferred, setPreferred] = useState<"ko" | "en">("ko");
  const selected = result.prompts[preferred] ? preferred : result.prompts.ko ? "ko" : "en";
  return <div className={styles.publishEntry}>
    {result.prompts.ko && result.prompts.en && <label className={styles.field}>공개 프롬프트 언어
      <select value={selected} onChange={event => setPreferred(event.target.value === "en" ? "en" : "ko")}>
        <option value="ko">한국어</option><option value="en">영어</option>
      </select>
    </label>}
    <Button type="button" variant="secondary" onClick={() => onPrepare(imagePublicationDraft(result, selected))}>공개 준비</Button>
  </div>;
}

function ImageWorkspace({ onPrepare }: ProgramWorkspaceProps) {
  const [kind, setKind] = useState<AnalysisSource["kind"]>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [consent, setConsent] = useState(false);
  const [marker, setMarker] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [settings, setSettings] = useState<AnalysisSettings>();
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImageSemanticResult>();
  const [measured, setMeasured] = useState<ReadyResult>();
  const [styleDna, setStyleDna] = useState<StyleDna>();
  // 분석이 끝날 때마다 늘려 리포트를 새로 그린다(같은 원본·같은 제안이어도 이전 편집이 새 결과에 남지 않게).
  const [reportRun, setReportRun] = useState(0);
  const [size, setSize] = useState<Size>();
  const id = useId();
  const sourceInput = useRef<HTMLInputElement>(null);
  const retryId = `${id}-retry`;
  const analysisRequest = useRef<AbortController | null>(null);

  const source = kind === "url"
    ? (url.trim() ? { kind, url: url.trim(), media: "image" } as const : undefined)
    : (file ? { kind, file, media: "image" } as const : undefined);
  const issue = source && analysisInputIssue(source);
  const permittedSource = issue ? undefined : source;

  useEffect(() => {
    const controller = new AbortController();
    void readAnalysisSettings("image", controller.signal).then(outcome => {
      if (controller.signal.aborted) return;
      if (outcome.kind === "configured" && document.activeElement?.id === retryId) sourceInput.current?.focus();
      setSettings(outcome);
      setChecking(false);
    });
    return () => controller.abort();
  }, [attempt, retryId]);
  useEffect(() => () => analysisRequest.current?.abort(), []);

  function cancel() {
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    setRunning(false);
  }

  function resetSource() {
    cancel();
    setConsent(false);
    setReport(undefined);
    setMeasured(undefined);
    setStyleDna(undefined);
    setSize(undefined);
    setMarker("");
    setPreviewOpen(false);
    setPreviewFailed(false);
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || !consent || settings?.kind !== "configured" || analysisRequest.current) return;
    if (issue) {
      setMarker(issue);
      sourceInput.current?.focus();
      return;
    }
    const controller = new AbortController();
    analysisRequest.current = controller;
    setRunning(true);
    setMarker("");
    setReport(undefined);
    setMeasured(undefined);
    setStyleDna(undefined);
    const outcome = await imageClient.analyze(source, controller.signal, { imageSemantic: true });
    if (controller.signal.aborted || analysisRequest.current !== controller) return;
    analysisRequest.current = null;
    setRunning(false);
    if (outcome.kind === "ready") {
      setReport(outcome.semantic);
      setMeasured(outcome.result);
      setStyleDna(outcome.styleDna);
      setReportRun(value => value + 1);
      if (outcome.semantic?.status === "unavailable" && outcome.semantic.reason === "not_configured") {
        setSettings({ kind: "not_configured" });
        setConsent(false);
      }
    } else if (outcome.kind === "unavailable") {
      setMarker(unavailableMessage(outcome.reason));
    } else {
      setMarker(failureMessage(outcome));
      if (outcome.kind === "login" || outcome.kind === "forbidden") {
        setSettings({ kind: outcome.kind, message: failureMessage(outcome) });
        setConsent(false);
      }
    }
  }

  return <div className={styles.workbench}>
    <div className={styles.desk}>
      <section className={styles.control}>
        <h3>이미지 소스</h3>
        <form className={styles.form} noValidate onSubmit={(event) => void analyze(event)}>
          <fieldset className={styles.sourceOptions}><legend>입력 방식</legend>
            {(["url", "file"] as const).map(mode => <label key={mode}>
              <input type="radio" name={`${id}-source`} value={mode} checked={kind === mode} onChange={() => {
                resetSource(); setKind(mode); setFile(undefined);
              }} />{mode === "url" ? "직접 URL" : "파일 업로드"}
            </label>)}
          </fieldset>
          {kind === "url" ? <PasteUrlField input={sourceInput} value={url} noticeId={`${id}-paste`} disabled={running}
            onPaste={(text) => { resetSource(); setUrl(text); }}>
            <label className={styles.field}>이미지 직접 URL
              <input ref={sourceInput} type="url" aria-invalid={!!issue} value={url} placeholder="https://…/image.webp"
                aria-describedby={`${id}-paste`} onChange={(event) => { resetSource(); setUrl(event.target.value); }} />
            </label>
          </PasteUrlField> : <label className={styles.field}>이미지 파일
            <input ref={sourceInput} type="file" accept=".png,.jpg,.jpeg,.webp" aria-invalid={!!issue}
              onChange={(event) => { resetSource(); setFile(event.target.files?.[0]); }} />
          </label>}
          <p className={styles.note}>PNG · JPG · WebP · {kind === "url" ? `직접 URL 최대 ${URL_SIZE_LIMIT_LABEL}` : `최대 ${UPLOAD_SIZE_LIMIT_LABEL}`}</p>
          {kind === "url" && <details className={styles.guide}>
            <summary>지원 URL</summary>
            <ul>{SUPPORTED_ORIGINS.map(origin => <li key={origin}>{new URL(origin).hostname}</li>)}</ul>
          </details>}
          {checking || settings?.kind !== "configured" ? <div className={styles.settings}>
            <p role="status">{checking ? "이미지 분석 모델 설정을 확인하는 중이에요." : settings && settingsMessage(settings)}</p>
            {settings?.kind === "login" && <a className={hub.link} href={loginLink}>관리자 로그인</a>}
            {settings && settings.kind !== "login" && settings.kind !== "forbidden" && <Button
              id={retryId} type="button" variant="secondary" aria-disabled={checking}
              onClick={() => { if (!checking) { setChecking(true); setAttempt(value => value + 1); } }}>
              설정 다시 확인
            </Button>}
          </div> : <>
            <label className={styles.consent}><input type="checkbox" checked={consent} disabled={running}
              onChange={(event) => setConsent(event.target.checked)} />분석할 권리가 있으며 Gemini에 분석용 이미지 사본을 보내는 데 동의해요.</label>
            <div className={styles.actions}>
              <Button type="submit" loading={running} loadingLabel="이미지 분석 중" disabled={!source || !consent}>이미지 분석 실행</Button>
              {running && <Button type="button" variant="secondary" onClick={() => { cancel(); setMarker("분석을 취소했어요."); }}>취소</Button>}
            </div>
          </>}
          {(marker || running) && <p className={styles.note} role="status">{running ? "이미지의 스타일과 시각 단서를 확인하는 중이에요." : marker}</p>}
        </form>
        <a className={hub.link} href={apiLink}>API연동 보기 <Icon name="arrow" /></a>
      </section>
      <section className={styles.control} aria-label="이미지 분석 결과">
        <h3>스타일 리포트</h3>
        {report || measured ? <StyleDnaReport key={reportRun} semantic={report} result={measured} size={size} styleDna={styleDna} /> : <p className={styles.note}>분석이 완료되면 스타일 근거와 한영 프롬프트를 확인할 수 있어요.</p>}
        {report && report.status !== "unavailable" && <ImagePublicDraft result={report} onPrepare={onPrepare} />}
      </section>
    </div>
    <Preview title="이미지 프리뷰">
      {permittedSource?.kind === "file" ? <LocalMedia file={permittedSource.file} kind="image" onSize={setSize} />
        : permittedSource?.kind === "url" && previewOpen && !previewFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- The operator explicitly opens a validated direct reference URL.
          <img src={permittedSource.url} alt="선택한 원본 이미지" referrerPolicy="no-referrer"
            onLoad={event => setSize(naturalSize(event.currentTarget))} onError={() => setPreviewFailed(true)} />
        ) : <div className={styles.previewMessage}>
          <Icon name="flask" />
          <p>{previewFailed ? "원본 이미지를 표시하지 못했어요." : "선택한 이미지가 여기에 표시돼요."}</p>
          {permittedSource?.kind === "url" && !previewFailed && <Button variant="secondary" type="button" onClick={() => setPreviewOpen(true)}>URL 이미지 미리보기</Button>}
        </div>}
    </Preview>
  </div>;
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

// Audio Analyzer v1.01 업로드 화면처럼 끌어다 놓기·교체·해제를 지원한다. 끌어다 놓은 파일도 같은 형식·크기 검사를 거친다.
function MusicWorkspace({ onPrepare }: ProgramWorkspaceProps) {
  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const issue = file && analysisInputIssue({ kind: "file", media: "music", file });
  const selected = issue ? undefined : file;
  const replace = (next?: File) => {
    if (input.current && next !== input.current.files?.[0]) input.current.value = "";
    setFile(next);
  };
  return <div className={styles.workbench}>
    <div className={styles.desk}>
      <section className={styles.control}>
        <h3>음악 파일</h3>
        <div className={styles.dropzone} data-dragging={dragging || undefined}
          onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={event => { event.preventDefault(); setDragging(false); const dropped = event.dataTransfer.files[0];
            // 파일 칸에도 같은 파일을 넣어 '선택된 파일 없음'으로 보이지 않게 한다(지원하지 않는 브라우저는 이름 줄로 안내).
            if (dropped && input.current) { try { input.current.files = event.dataTransfer.files; } catch { /* 읽기 전용 */ } }
            if (dropped) replace(dropped); }}>
          <label className={styles.field}>{file ? "다른 파일로 교체" : "파일 선택"}
            <input ref={input} type="file" accept=".mp3,.wav,.m4a" aria-invalid={!!issue}
              onChange={(event) => replace(event.target.files?.[0])} />
          </label>
          <p className={styles.note}>음악 파일을 여기로 끌어다 놓아도 돼요. MP3 · WAV · M4A · 최대 {UPLOAD_SIZE_LIMIT_LABEL}</p>
        </div>
        {file && <div className={styles.picked}>
          <p className={styles.note}>선택한 파일 · {file.name} · {megabytes(file.size)}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => { replace(undefined); input.current?.focus(); }}>선택 해제</Button>
        </div>}
        {issue && <p role="status">{issue}</p>}
        <AdminMusicSemantic file={selected} onPrepare={onPrepare} />
      </section>
    </div>
    <Preview title="오디오 프리뷰">
      {selected ? <AudioWaveform file={selected} /> : <div className={styles.previewMessage}>
        <span className={styles.soundIcon} aria-hidden="true">≋</span>
        <p>음악 파일을 선택하면 파형을 보고 여기에서 재생할 수 있어요.</p>
      </div>}
    </Preview>
  </div>;
}

function ShortsWorkspace({ onPrepare }: ProgramWorkspaceProps) {
  const [url, setUrl] = useState("");
  const id = youtubeVideoId(url.trim());
  return <div className={styles.workbench}>
    <div className={styles.desk}>
      <div className={styles.control}><AdminShortsAnalysis onSourceChange={setUrl} onPrepare={onPrepare} appearance="premiere" /></div>
    </div>
    <Preview title="세로 영상 프리뷰">
      <div className={styles.filmFrame} aria-hidden="true"><Icon name="play" /></div>
      <div className={styles.previewMessage}>
        {id ? <a className={hub.link} href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">YouTube에서 원본 열기 <Icon name="arrow" /></a>
          : <p>공개 영상 주소를 입력하면 원본을 열 수 있어요.</p>}
      </div>
    </Preview>
  </div>;
}

const workspaces = [ImageWorkspace, MusicWorkspace, ShortsWorkspace] as const;

export function AdminPremierePrograms() {
  const current = useAdminSection();
  const [prepared, setPrepared] = useState<PreparedPublication>();
  const [publishing, setPublishing] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState("");

  function prepare(draft: PublicationDraft) {
    if (publishing) {
      setSelectionMessage("이미 진행 중인 공개 상태를 확인한 뒤 새 결과의 공개를 준비하세요.");
      navigateAdminSection(analysisResultsSection);
      return;
    }
    setSelectionMessage("");
    setPrepared(previous => {
      if (previous?.draft.media === draft.media && previous.draft.title === draft.title &&
          previous.draft.summary === draft.summary && previous.draft.prompt === draft.prompt) return previous;
      return { draft, revision: (previous?.revision ?? 0) + 1 };
    });
    navigateAdminSection(analysisResultsSection);
  }

  return <>{analysisPrograms.map(({ id, label, icon }, index) => {
    const active = current === id;
    const { kind, description, caption } = copy[index];
    const Workspace = workspaces[index];
    return <section key={id} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} data-program-active={active || undefined}
      data-program={kind} className={`${hub.target} ${styles.program}`}>
      {active && <>
        <header className={styles.mast}>
          <div><h2 id={`${id}-title`} tabIndex={-1}>{label}</h2><p>{description}</p></div>
          <div className={styles.cover} aria-hidden="true"><Icon name={icon} /><span>{caption}</span></div>
        </header>
        <Workspace onPrepare={prepare} />
      </>}
    </section>;
  })}<AdminAnalysisResults prepared={prepared} selectionMessage={selectionMessage}
    onSendingChange={sending => { setPublishing(sending); if (!sending) setSelectionMessage(""); }} /></>;
}
