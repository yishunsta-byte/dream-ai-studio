"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/primitives";
import type { ImageSemanticResult } from "@/lib/reference-analysis/image-semantic-result";
import { youtubeVideoId } from "@/lib/reference-analysis/shorts-analysis-contract";
import { readAnalysisSettings, settingsMessage, type AnalysisSettings } from "./admin-analysis-tools";
import { ImageSemanticReport } from "./admin-image-semantic";
import { AdminMusicSemantic } from "./admin-music-semantic";
import { analysisPrograms, useAdminSection } from "./admin-navigation";
import {
  analysisInputIssue, createAdminReferenceAnalysisClient, failureMessage, SUPPORTED_ORIGINS,
  unavailableMessage, UPLOAD_SIZE_LIMIT_LABEL, URL_SIZE_LIMIT_LABEL, type AnalysisSource,
} from "./admin-reference-analysis-model";
import { AdminShortsAnalysis } from "./admin-shorts-analysis";
import hub from "./admin.module.css";
import styles from "./admin-premiere-programs.module.css";

const imageClient = createAdminReferenceAnalysisClient();
const apiLink = "#admin-api-integrations";
const loginLink = "/admin/login?next=%2Fadmin%23admin-style-dna";

const copy = [
  { kind: "image", description: "이미지의 조명, 구도와 스타일을 읽고 한영 프롬프트를 얻어요.", caption: "컬러·구도·조명", guide: "지원하는 직접 URL이나 이미지 파일을 선택한 뒤 Gemini 전송에 동의하세요. Style DNA의 추정은 원본과 대조하세요." },
  { kind: "music", description: "음악의 장르, 악기, 추정 템포와 구간 구조를 살펴봐요.", caption: "장르·악기·템포", guide: "MP3·WAV·M4A 파일을 올리세요. 모델이 준비되면 음악 원본 전송에 동의한 뒤 Suno용 프롬프트를 만들 수 있어요." },
  { kind: "shorts", description: "YouTube 쇼츠의 첫 장면과 시간대별 근거를 확인해요.", caption: "첫 장면·시간대별 근거", guide: "공개 YouTube 쇼츠 또는 시청 주소를 입력하세요. 모델이 준비되면 공개 영상 주소 전송에 동의하고 분석하세요." },
] as const;

function LocalMedia({ file, kind }: { file: File; kind: "image" | "music" }) {
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
      <img alt="선택한 원본 이미지" />
    )}
  </div>;
}

function Preview({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.preview} aria-label={title}>
    <h3>{title}</h3>
    <div className={styles.mediaStage}>{children}</div>
  </section>;
}

function SourceGuide({ detail }: { detail: string }) {
  return <details className={styles.guide}>
    <summary>사용 매뉴얼</summary>
    <p>{detail}</p>
  </details>;
}

function StyleDnaWorkspace() {
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
    const outcome = await imageClient.analyze(source, controller.signal, { imageSemantic: true });
    if (controller.signal.aborted || analysisRequest.current !== controller) return;
    analysisRequest.current = null;
    setRunning(false);
    if (outcome.kind === "ready") {
      setReport(outcome.semantic);
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
          {kind === "url" ? <label className={styles.field}>이미지 직접 URL
            <input ref={sourceInput} type="url" aria-invalid={!!issue} value={url} placeholder="https://…/image.webp"
              onChange={(event) => { resetSource(); setUrl(event.target.value); }} />
          </label> : <label className={styles.field}>이미지 파일
            <input ref={sourceInput} type="file" accept=".png,.jpg,.jpeg,.webp" aria-invalid={!!issue}
              onChange={(event) => { resetSource(); setFile(event.target.files?.[0]); }} />
          </label>}
          <p className={styles.note}>PNG · JPG · WebP · {kind === "url" ? `직접 URL 최대 ${URL_SIZE_LIMIT_LABEL}` : `최대 ${UPLOAD_SIZE_LIMIT_LABEL}`}</p>
          {kind === "url" && <details className={styles.guide}>
            <summary>지원 URL</summary>
            <ul>{SUPPORTED_ORIGINS.map(origin => <li key={origin}>{new URL(origin).hostname}</li>)}</ul>
          </details>}
          {checking || settings?.kind !== "configured" ? <div className={styles.settings}>
            <p role="status">{checking ? "Style DNA 모델 설정을 확인하는 중이에요." : settings && settingsMessage(settings)}</p>
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
              <Button type="submit" loading={running} loadingLabel="Style DNA 분석 중" disabled={!source || !consent}>Style DNA로 분석</Button>
              {running && <Button type="button" variant="secondary" onClick={() => { cancel(); setMarker("분석을 취소했어요."); }}>취소</Button>}
            </div>
          </>}
          {(marker || running) && <p className={styles.note} role="status">{running ? "이미지의 스타일과 시각 단서를 확인하는 중이에요." : marker}</p>}
        </form>
        <a className={hub.link} href={apiLink}>API연동 보기 <Icon name="arrow" /></a>
      </section>
      <section className={styles.control} aria-label="Style DNA 결과">
        <h3>스타일 리포트</h3>
        {report ? <ImageSemanticReport semantic={report} /> : <p className={styles.note}>분석이 완료되면 스타일 근거와 한영 프롬프트를 확인할 수 있어요.</p>}
      </section>
      <SourceGuide detail={copy[0].guide} />
    </div>
    <Preview title="이미지 프리뷰">
      {permittedSource?.kind === "file" ? <LocalMedia file={permittedSource.file} kind="image" />
        : permittedSource?.kind === "url" && previewOpen && !previewFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- The operator explicitly opens a validated direct reference URL.
          <img src={permittedSource.url} alt="선택한 원본 이미지" referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)} />
        ) : <div className={styles.previewMessage}>
          <Icon name="flask" />
          <p>{previewFailed ? "원본 이미지를 표시하지 못했어요." : "선택한 이미지가 여기에 표시돼요."}</p>
          {permittedSource?.kind === "url" && !previewFailed && <Button variant="secondary" type="button" onClick={() => setPreviewOpen(true)}>URL 이미지 미리보기</Button>}
        </div>}
    </Preview>
  </div>;
}

function MusicWorkspace() {
  const [file, setFile] = useState<File>();
  const issue = file && analysisInputIssue({ kind: "file", media: "music", file });
  const selected = issue ? undefined : file;
  return <div className={styles.workbench}>
    <div className={styles.desk}>
      <section className={styles.control}>
        <h3>음악 파일</h3>
        <label className={styles.field}>파일 선택
          <input type="file" accept=".mp3,.wav,.m4a" aria-invalid={!!issue}
            onChange={(event) => setFile(event.target.files?.[0])} />
        </label>
        <p className={styles.note}>MP3 · WAV · M4A · 최대 {UPLOAD_SIZE_LIMIT_LABEL}</p>
        {issue && <p role="status">{issue}</p>}
        <AdminMusicSemantic file={selected} />
      </section>
      <SourceGuide detail={copy[1].guide} />
    </div>
    <Preview title="오디오 프리뷰">
      <div className={styles.previewMessage}>
        <span className={styles.soundIcon} aria-hidden="true">≋</span>
        <p>{selected ? selected.name : "음악 파일을 선택하면 여기에서 재생할 수 있어요."}</p>
      </div>
      {selected && <LocalMedia file={selected} kind="music" />}
    </Preview>
  </div>;
}

function ShortsWorkspace() {
  const [url, setUrl] = useState("");
  const id = youtubeVideoId(url.trim());
  return <div className={styles.workbench}>
    <div className={styles.desk}>
      <div className={styles.control}><AdminShortsAnalysis onSourceChange={setUrl} appearance="premiere" /></div>
      <SourceGuide detail={copy[2].guide} />
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

const workspaces = [StyleDnaWorkspace, MusicWorkspace, ShortsWorkspace] as const;

export function AdminPremierePrograms() {
  const current = useAdminSection();
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
        <Workspace />
      </>}
    </section>;
  })}</>;
}
