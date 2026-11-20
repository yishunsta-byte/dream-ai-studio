"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import { SpectrumResults } from "./admin-reference-analysis-spectrum";
import {
  LIMITS, MEDIA_LABEL, URL_SIZE_LIMIT_LABEL, UPLOAD_SIZE_LIMIT_LABEL, SUPPORTED_FORMATS, SUPPORTED_ORIGINS,
  analysisInputIssue, createAdminReferenceAnalysisClient, draftFromResult, failureMessage,
  formatPublishedAt, isAuthFailure, unavailableMessage, validateDraft,
  type AdminReferenceAnalysisClient, type AnalysisMedia, type AnalysisSource, type DraftErrors, type Failure,
  type PublicationDraft, type PublishedReferenceAnalysis, type ReadyResult,
} from "./admin-reference-analysis-model";
import styles from "./admin-reference-analysis.module.css";

// 관리자 콘텐츠 분석·공개(이미지·음악·영상). 화면은 서버가 준 결과만 그리고, 권한·저장·공개 상태는 서버가 정한다.
// - 분석: 권리 확인 동작에서 선택한 URL 또는 파일만 보낸다. 입력 변경과 취소 뒤에는 늦은 응답을 버린다.
// - 공개: 관리자가 고른 결과 한 개의 제목·요약·생성 프롬프트(평문)만 보낸다. 권리·공개 동의 체크 뒤에만 보낸다.
//   같은 공개 의도의 재시도는 같은 요청 id를 쓰고, 초안을 고치면 새 id를 만든다.
// - 철회: 확인 단계를 한 번 더 거친다. 성공·대상 없음·이미 철회는 목록을 새로 읽어 서버 상태로 맞춘다.
// - 401·403: 모든 조작을 멈추고 로그인·권한 안내만 남긴다.

type AnalysisView =
  | { kind: "idle" } | { kind: "running" } | { kind: "ready"; result: ReadyResult }
  | { kind: "unavailable"; message: string } | { kind: "failed"; message: string };
type ListView = { kind: "loading" } | { kind: "ok"; items: readonly PublishedReferenceAnalysis[] } | { kind: "failed"; message: string };
type Notice = { tone: "success" | "danger"; text: string } | null;

const newId = () => crypto.randomUUID();

export function AdminReferenceAnalysis({ client: given, newRequestId = newId }: { client?: AdminReferenceAnalysisClient; newRequestId?: () => string }) {
  const client = useMemo(() => given ?? createAdminReferenceAnalysisClient(), [given]);
  const id = useId();
  const [blocked, setBlocked] = useState<Failure | null>(null);
  const block = useCallback((failure: Failure) => { if (isAuthFailure(failure)) { setBlocked(failure); return true; } return false; }, []);

  // ── 분석 ──
  const [sourceKind, setSourceKind] = useState<AnalysisSource["kind"]>("url");
  const [media, setMedia] = useState<AnalysisMedia>("image");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [multipleFiles, setMultipleFiles] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisView>({ kind: "idle" });
  const analysisSeq = useRef(0);
  const analysisAbort = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const restoreExecuteFocus = useRef(false);
  const cancelAnalysis = () => { analysisSeq.current++; analysisAbort.current?.abort(); analysisAbort.current = null; };
  useEffect(() => () => { analysisAbort.current?.abort(); }, []);
  const source: AnalysisSource | undefined = sourceKind === "url"
    ? (url.trim() ? { kind: "url", url: url.trim(), media } : undefined)
    : (file ? { kind: "file", file, media } : undefined);
  const issue = multipleFiles ? "한 번에 파일 하나를 선택해 주세요." : source && analysisInputIssue(source);

  async function runAnalysis() {
    if (!source || issue || analysisAbort.current || blocked) return;
    const mine = ++analysisSeq.current;
    const controller = new AbortController();
    analysisAbort.current = controller;
    setAnalysis({ kind: "running" });
    const outcome = await client.analyze(source, controller.signal);
    if (mine !== analysisSeq.current || controller.signal.aborted) return;
    analysisAbort.current = null;
    if (outcome.kind === "ready") setAnalysis({ kind: "ready", result: outcome.result });
    else if (outcome.kind === "unavailable") setAnalysis({ kind: "unavailable", message: unavailableMessage(outcome.reason) });
    else if (!block(outcome)) setAnalysis({ kind: "failed", message: failureMessage(outcome) });
  }
  function editInput(next: () => void) { cancelAnalysis(); next(); setAnalysis({ kind: "idle" }); }
  function chooseFiles(files: FileList | null) {
    const multiple = !!files && files.length > 1;
    editInput(() => {
      setMultipleFiles(multiple);
      setFile(multiple ? undefined : files?.[0]);
    });
  }

  // 실행 버튼은 분석 중 비활성이라 초점을 잃는다. 폼 안에서 시작했으면 바로 '분석 취소'로 옮긴다.
  useLayoutEffect(() => {
    if (restoreExecuteFocus.current && analysis.kind === "idle") {
      restoreExecuteFocus.current = false;
      document.getElementById(`${id}-run`)?.focus({ preventScroll: true });
    }
    if (analysis.kind !== "running") return;
    const active = document.activeElement;
    if (active === document.body || form.current?.contains(active)) document.getElementById(`${id}-cancel`)?.focus({ preventScroll: true });
  }, [analysis, id]);

  useLayoutEffect(() => {
    if (analysis.kind !== "ready" && analysis.kind !== "unavailable" && analysis.kind !== "failed") return;
    const active = document.activeElement;
    if (active !== document.body && !form.current?.contains(active)) return;
    resultHeading.current?.focus({ preventScroll: true });
    resultHeading.current?.scrollIntoView({ block: "nearest" });
  }, [analysis]);

  // ── 공개 목록 ──
  const [list, setList] = useState<ListView>({ kind: "loading" });
  const listSeq = useRef(0);
  const listAbort = useRef<AbortController | null>(null);
  // 늦게 온 목록은 순번·취소로 버린다. 상태 반영은 응답 뒤(then)에서만 한다.
  const loadList = useCallback(() => {
    const mine = ++listSeq.current;
    listAbort.current?.abort();
    const controller = new AbortController();
    listAbort.current = controller;
    return client.list(controller.signal).then((outcome) => {
      if (mine !== listSeq.current || controller.signal.aborted) return;
      if (outcome.kind === "ok") setList({ kind: "ok", items: outcome.items });
      else if (!block(outcome)) setList({ kind: "failed", message: failureMessage(outcome) });
    });
  }, [block, client]);
  // 다시 읽기: 이미 보이는 목록은 유지하고, 실패 안내만 '불러오는 중'으로 바꾼다.
  const refreshList = useCallback(() => {
    setList((previous) => previous.kind === "ok" ? previous : { kind: "loading" });
    return loadList();
  }, [loadList]);
  useEffect(() => {
    const seq = listSeq;
    const abort = listAbort;
    void loadList();
    return () => { seq.current++; abort.current?.abort(); };
  }, [loadList]);

  if (blocked) return <section className={styles.panel} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} tabIndex={-1}>콘텐츠 프롬프트 분석기</h2>
    <Callout tone="danger" title={blocked.kind === "login" ? "다시 로그인이 필요해요" : "관리 권한이 없어요"}>
      <p>{failureMessage(blocked)}</p>
      {blocked.kind === "login" && <p><a className={styles.link} href="/admin/login?next=%2Fadmin%23admin-reference-analysis">관리자 로그인</a></p>}
    </Callout>
  </section>;

  const running = analysis.kind === "running";
  const extensions = SUPPORTED_FORMATS.find((format) => format.media === media)?.extensions ?? [];
  return <section className={styles.panel} aria-labelledby={`${id}-heading`}>
    <div className={`${styles.head} ${styles.hero}`}>
      <div>
        <h2 id={`${id}-heading`} tabIndex={-1}>콘텐츠 프롬프트 분석기</h2>
        <p className={styles.labName}>스펙트럼 랩</p>
      </div>
      <Link className={styles.link} href="/analysis-results">공개 결과 페이지 보기</Link>
    </div>
    <div className={styles.workspace}>
      <form ref={form} className={`${styles.form} ${styles.surface}`} aria-labelledby={`${id}-source`} noValidate
        onSubmit={(event) => { event.preventDefault(); void runAnalysis(); }}>
        <h3 id={`${id}-source`}>미디어 소스</h3>
        <fieldset className={styles.choices} disabled={running}>
          <legend>소스 방식</legend>
          <div className={styles.options}>
            {(["url", "file"] as const).map((kind) => <label key={kind}>
              <input type="radio" name={`${id}-source-kind`} value={kind} checked={sourceKind === kind}
                onChange={() => editInput(() => { setSourceKind(kind); setFile(undefined); setMultipleFiles(false); })} />
              {kind === "url" ? "직접 URL" : "파일"}
            </label>)}
          </div>
        </fieldset>
        <fieldset className={styles.choices} disabled={running}>
          <legend>분석할 매체</legend>
          <div className={styles.options}>
            {SUPPORTED_FORMATS.map(({ media: option }) => <label key={option}>
              <input type="radio" name={`${id}-media`} value={option} checked={media === option}
                onChange={() => editInput(() => { setMedia(option); setFile(undefined); setMultipleFiles(false); })} />
              {MEDIA_LABEL[option]}
            </label>)}
          </div>
        </fieldset>
        {sourceKind === "url" ? <label className={styles.field} htmlFor={`${id}-url`}>
          미디어 파일 URL
          <input id={`${id}-url`} type="url" inputMode="url" autoComplete="off" spellCheck={false} required value={url} disabled={running}
            placeholder={`https://…/파일.${extensions[0]}`} aria-invalid={!!issue} aria-describedby={`${id}-input-help${issue ? ` ${id}-input-error` : ""}`}
            onChange={(event) => editInput(() => setUrl(event.target.value))} />
        </label> : <label className={`${styles.field} ${styles.drop}`} htmlFor={`${id}-file`}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = running ? "none" : "copy"; }}
          onDrop={(event) => {
            event.preventDefault();
            const { files } = event.dataTransfer;
            if (running || !files.length) return;
            const input = event.currentTarget.querySelector("input");
            if (input && files.length === 1) input.files = files;
            else if (input) input.value = "";
            chooseFiles(files);
          }}>
          미디어 파일
          <span className={styles.note}>파일을 이곳에 놓거나 파일 선택을 누르세요.</span>
          <input key={media} id={`${id}-file`} type="file" accept={extensions.map((extension) => `.${extension}`).join(",")} disabled={running}
            aria-invalid={!!issue} aria-describedby={`${id}-input-help${issue ? ` ${id}-input-error` : ""}`}
            onChange={(event) => chooseFiles(event.target.files)} />
        </label>}
        <p id={`${id}-input-help`} className={styles.note}>{sourceKind === "url" ? "지원 원본의 직접 HTTPS 파일 주소를 입력하세요."
          : `${extensions.join(" · ").toUpperCase()} · 최대 ${UPLOAD_SIZE_LIMIT_LABEL}`}</p>
        {issue && <p id={`${id}-input-error`} className={styles.error} role="status">{issue}</p>}
        {source && !issue && (source.kind === "file" || analysis.kind === "ready") && <SourcePreview
          key={source.kind === "url" ? source.url : "local-file"} source={source} />}

        <details className={styles.support}>
          <summary>지원 원본·형식 보기</summary>
          <div className={styles.supportBody}>
            <p>URL은 쿼리와 로그인 정보가 없는 직접 파일 주소만 지원해요.</p>
            <ul>{SUPPORTED_ORIGINS.map((origin) => <li key={origin}><code>{origin}</code></li>)}</ul>
            <p>URL 파일 {URL_SIZE_LIMIT_LABEL} · 직접 업로드 {UPLOAD_SIZE_LIMIT_LABEL}까지</p>
            <ul>{SUPPORTED_FORMATS.map((format) => <li key={format.media}>{MEDIA_LABEL[format.media]}: {format.extensions.join(" · ").toUpperCase()}
              {format.limit && ` · ${format.limit}`}</li>)}</ul>
          </div>
        </details>
        <p id={`${id}-rights`} className={styles.note}>분석할 권리가 있는 자료만 실행하세요.</p>
        <div className={styles.actions}>
          <Button id={`${id}-run`} className={styles.run} type="submit" loading={running} loadingLabel="분석 중"
            aria-describedby={`${id}-rights`} disabled={!source || !!issue}>권리 확인하고 분석</Button>
          {running && <Button id={`${id}-cancel`} type="button" variant="secondary" onClick={() => {
            restoreExecuteFocus.current = true;
            editInput(() => {});
          }}>분석 취소</Button>}
        </div>
      </form>

      <section className={`${styles.result} ${styles.surface}`} aria-labelledby={`${id}-results`}>
        <h3 id={`${id}-results`} ref={resultHeading} tabIndex={-1}>{analysis.kind === "failed" || analysis.kind === "unavailable"
          ? "분석하지 못했어요" : "분석 결과 · 근거 · 생성 프롬프트"}</h3>
        {analysis.kind === "idle" && <p className={styles.empty}>직접 URL을 넣거나 파일을 선택해 분석하세요.</p>}
        {running && <p className={styles.empty} role="status">서버에서 분석하고 있어요. 영상은 시간이 더 걸릴 수 있어요.</p>}
        {(analysis.kind === "unavailable" || analysis.kind === "failed") && <p className={styles.error} role="alert">{analysis.message}</p>}
        {analysis.kind === "ready" && <SpectrumResults result={analysis.result} />}
      </section>
    </div>

    {analysis.kind === "ready" && <div className={styles.surface}>
      <PublishForm key={analysis.result.proposals.map((proposal) => proposal.selectionId).join("|")} result={analysis.result} client={client}
        newRequestId={newRequestId} onBlocked={block} onPublished={() => void refreshList()} />
    </div>}

    <PublicationList list={list} client={client} onBlocked={block} reload={refreshList} />
  </section>;
}

function SourcePreview({ source }: { source: AnalysisSource }) {
  const [open, setOpen] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const file = source.kind === "file" ? source.file : undefined;
  const url = source.kind === "url" ? source.url : undefined;
  useEffect(() => {
    if (!open || !file) return;
    const element = preview.current?.querySelector("img, audio, video");
    if (!element) return;
    const objectUrl = URL.createObjectURL(file);
    element.setAttribute("src", objectUrl);
    return () => { element.removeAttribute("src"); URL.revokeObjectURL(objectUrl); };
  }, [file, open, source.media]);

  return <details className={`${styles.support} ${styles.preview}`} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>원본 미리보기</summary>
    {open && <div ref={preview}>
      {file && <p className={styles.note}>{file.name}</p>}
      {source.media === "music" && <audio src={url} crossOrigin={url ? "anonymous" : undefined} controls preload="none" aria-label="원본 음악" />}
      {source.media === "video" && <video src={url} crossOrigin={url ? "anonymous" : undefined} controls preload="none" aria-label="원본 영상" />}
      {source.media === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- A selected local file has a browser-owned blob URL, not an optimizable asset.
        <img src={url} alt="선택한 원본 이미지" referrerPolicy="no-referrer" />
      )}
    </div>}
  </details>;
}

function PublishForm({ result, client, newRequestId, onBlocked, onPublished }: {
  result: ReadyResult; client: AdminReferenceAnalysisClient; newRequestId: () => string;
  onBlocked: (failure: Failure) => boolean; onPublished: () => void;
}) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<PublicationDraft>(() => draftFromResult(result, 0));
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // 같은 초안의 재시도는 같은 id. 초안·결과 선택이 바뀌면 새 id.
  const requestId = useRef<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);

  function edit(next: PublicationDraft) { requestId.current = null; setDraft(next); setConsent(false); setNotice(null); setErrors({}); }
  async function publish() {
    if (sending || !consent) return;
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length) { document.getElementById(`${id}-${Object.keys(found)[0]}`)?.focus(); return; }
    requestId.current ??= newRequestId();
    setSending(true); setNotice(null);
    const outcome = await client.publish(requestId.current, draft);
    setSending(false);
    if (outcome.kind === "ok") {
      requestId.current = null; setConsent(false);
      setNotice({ tone: "success", text: `‘${outcome.item.title}’을 공개했어요. 공개 결과 페이지에 바로 보여요.` });
      onPublished();
      return;
    }
    if (onBlocked(outcome)) return;
    // 잘못된 요청은 초안을 고쳐야 하므로 id를 버린다. 응답 미확정(failed)은 같은 id로 다시 보낸다.
    if (outcome.kind === "rejected") {
      requestId.current = null;
      setConsent(false);
      // 충돌(같은 id, 다른 내용)은 서버에 이미 무언가 공개돼 있다는 뜻이라 목록을 다시 읽어 맞춘다.
      if (outcome.code === "publication_conflict") onPublished();
    }
    setNotice({ tone: "danger", text: failureMessage(outcome) + (outcome.kind === "failed" ? " 다시 누르면 같은 공개 요청을 다시 보내요." : "") });
  }

  const field = (name: "title" | "summary" | "prompt", label: string, multiline: boolean) => <label className={styles.field} htmlFor={`${id}-${name}`}>
    <span>{label} <span className={styles.count}>{draft[name].length}/{LIMITS[name]}</span></span>
    {multiline
      ? <textarea id={`${id}-${name}`} rows={name === "prompt" ? 6 : 3} value={draft[name]} disabled={sending} maxLength={LIMITS[name]}
        aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        onChange={(event) => edit({ ...draft, [name]: event.target.value })} />
      : <input id={`${id}-${name}`} value={draft[name]} disabled={sending} maxLength={LIMITS[name]}
        aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        onChange={(event) => edit({ ...draft, [name]: event.target.value })} />}
    {errors[name] && <span id={`${id}-${name}-error`} className={styles.error}>{errors[name]}</span>}
  </label>;

  return <form className={styles.publish} aria-labelledby={`${id}-heading`} onSubmit={(event) => { event.preventDefault(); void publish(); }}>
    <h3 id={`${id}-heading`}>공개 준비</h3>
    <p className={styles.note}>공개 페이지에는 아래 제목·요약·생성 프롬프트와 매체({MEDIA_LABEL[result.media]}), 공개 시각만 보여요. 원본 주소와 측정 원값은 나가지 않아요.</p>
    {result.proposals.length > 1 && <label className={styles.field} htmlFor={`${id}-pick`}>
      <span>공개할 결과</span>
      <select id={`${id}-pick`} value={index} disabled={sending}
        onChange={(event) => { const next = Number(event.target.value); setIndex(next); edit(draftFromResult(result, next)); }}>
        {result.proposals.map((proposal, itemIndex) => <option key={proposal.selectionId} value={itemIndex}>결과 {itemIndex + 1}</option>)}
      </select>
    </label>}
    {field("title", "제목", false)}
    {field("summary", "요약", true)}
    {field("prompt", "생성 프롬프트", true)}
    <label className={styles.check}>
      <input type="checkbox" checked={consent} disabled={sending} onChange={(event) => { setConsent(event.target.checked); setNotice(null); }} />
      이 결과를 공개할 권리를 확인했고, 공개 결과 페이지에 표시하는 데 동의해요.
    </label>
    <div className={styles.actions}>
      <Button type="submit" loading={sending} loadingLabel="공개 중" disabled={!consent || sending}>공개하기</Button>
    </div>
    {notice && <p ref={noticeRef} tabIndex={-1} className={notice.tone === "success" ? styles.success : styles.error} role={notice.tone === "success" ? "status" : "alert"}>{notice.text}</p>}
  </form>;
}

function PublicationList({ list, client, onBlocked, reload }: {
  list: ListView; client: AdminReferenceAnalysisClient; onBlocked: (failure: Failure) => boolean; reload: () => Promise<void>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function revoke(item: PublishedReferenceAnalysis) {
    if (revoking) return;
    setRevoking(item.id); setNotice(null);
    const outcome = await client.revoke(item.id);
    setRevoking(null); setConfirming(null);
    if (outcome.kind === "ok") {
      setNotice({ tone: "success", text: `‘${item.title}’을 철회했어요. 공개 결과 페이지에서 내려가요.` });
      await reload();
      headingRef.current?.focus({ preventScroll: true });
      return;
    }
    if (onBlocked(outcome)) return;
    setNotice({ tone: "danger", text: failureMessage(outcome) });
    if (outcome.kind === "rejected") await reload();
  }

  return <section className={styles.listSection} aria-labelledby={`${id}-heading`}>
    <div className={styles.head}>
      <h3 id={`${id}-heading`} ref={headingRef} tabIndex={-1}>공개한 분석 결과</h3>
      <Button type="button" variant="secondary" size="sm" disabled={list.kind === "loading" || !!revoking} onClick={() => { setNotice(null); void reload(); }}>목록 새로고침</Button>
    </div>
    {notice && <p className={notice.tone === "success" ? styles.success : styles.error} role={notice.tone === "success" ? "status" : "alert"}>{notice.text}</p>}
    {list.kind === "loading" && <p className={styles.note} role="status">공개 목록을 불러오고 있어요.</p>}
    {list.kind === "failed" && <Callout tone="warning" title="공개 목록을 불러오지 못했어요"><p>{list.message}</p></Callout>}
    {list.kind === "ok" && (list.items.length === 0
      ? <p className={styles.note}>아직 공개한 분석 결과가 없어요.</p>
      : <ul className={styles.items}>
        {list.items.map((item) => <li key={item.id}>
          <Card className={styles.item}>
            <div className={styles.itemHead}>
              <h4>{item.title}</h4>
              <StatusPill status={item.status === "published" ? "done" : "canceled"}>{item.status === "published" ? "공개 중" : "철회됨"}</StatusPill>
            </div>
            <p className={styles.note}>{MEDIA_LABEL[item.media]} · {formatPublishedAt(item.publishedAt)} 공개</p>
            <p className={styles.plain}>{item.summary}</p>
            <details className={styles.promptBox}><summary>생성 프롬프트 보기</summary><p className={styles.plain}>{item.prompt}</p></details>
            {item.status === "published" && (confirming === item.id
              ? <div className={styles.actions} role="group" aria-label={`${item.title} 철회 확인`}>
                <Button type="button" variant="danger" loading={revoking === item.id} loadingLabel="철회 중" disabled={!!revoking} onClick={() => void revoke(item)}>공개 철회 확인</Button>
                <Button type="button" variant="secondary" disabled={!!revoking} onClick={() => setConfirming(null)}>취소</Button>
              </div>
              : <div className={styles.actions}>
                <Button type="button" variant="secondary" disabled={!!revoking} onClick={() => { setNotice(null); setConfirming(item.id); }}>공개 철회</Button>
              </div>)}
          </Card>
        </li>)}
      </ul>)}
  </section>;
}
