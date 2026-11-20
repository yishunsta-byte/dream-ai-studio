"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import { containsNonPublicText } from "@/lib/reference-analysis/publication-text";
import {
  failureMessage, formatPublishedAt, LIMITS, MEDIA_LABEL, trimmedDraft, validateDraft,
  type AdminReferenceAnalysisClient, type DraftErrors, type Failure, type PublicationDraft, type PublishedReferenceAnalysis,
} from "./admin-reference-analysis-model";
import styles from "./admin-reference-analysis.module.css";
import premiere from "./admin-premiere-programs.module.css";

export type PublicationListView =
  | { kind: "loading" }
  | { kind: "ok"; items: readonly PublishedReferenceAnalysis[] }
  | { kind: "failed"; message: string };

type Notice = { tone: "success" | "danger"; text: string } | null;

export function AnalysisPublicationForm({
  initialDraft, client,
  onBlocked, onPublished, onSendingChange,
}: {
  initialDraft: PublicationDraft;
  client: AdminReferenceAnalysisClient;
  onBlocked: (failure: Failure) => boolean;
  onPublished: () => void;
  onSendingChange?: (sending: boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initialDraft);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [sending, setSending] = useState(false);
  const [published, setPublished] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const requestId = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    if (notice && noticeRef.current?.getClientRects().length) noticeRef.current.focus({ preventScroll: true });
  }, [notice]);

  function edit(next: PublicationDraft) {
    requestId.current = null;
    setDraft(next);
    setConsent(false);
    setPublished(false);
    setNotice(null);
    setErrors({});
  }

  async function publish() {
    if (request.current || !consent || published) return;
    const found = validateDraft(draft);
    for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      if (containsNonPublicText(draft[key])) found[key] = "공개 문구에서 주소, 계정 또는 키를 지워 주세요.";
    }
    setErrors(found);
    const invalid = Object.keys(found)[0];
    if (invalid) {
      document.getElementById(`${id}-${invalid}`)?.focus();
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    requestId.current ??= crypto.randomUUID();
    setSending(true);
    onSendingChange?.(true);
    setNotice(null);
    const outcome = await client.publish(requestId.current, draft, controller.signal);
    if (controller.signal.aborted) return;
    request.current = null;
    setSending(false);
    onSendingChange?.(false);

    if (outcome.kind === "ok") {
      requestId.current = null;
      setConsent(false);
      setPublished(true);
      setNotice({ tone: "success", text: `‘${outcome.item.title}’을 공개했어요. 공개 결과 페이지에 바로 보여요.` });
      onPublished();
      return;
    }
    if (onBlocked(outcome)) return;
    if (outcome.kind === "rejected") {
      requestId.current = null;
      setConsent(false);
      if (outcome.code === "publication_conflict") onPublished();
    }
    setNotice({
      tone: "danger",
      text: failureMessage(outcome) + (outcome.kind === "failed" ? " 다시 누르면 같은 공개 요청을 다시 보내요." : ""),
    });
  }

  function field(name: keyof typeof LIMITS, label: string) {
    const fieldId = `${id}-${name}`;
    const props = {
      id: fieldId, value: draft[name], disabled: sending, maxLength: LIMITS[name],
      "aria-invalid": !!errors[name], "aria-describedby": errors[name] ? `${fieldId}-error` : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => edit({ ...draft, [name]: event.target.value }),
    };
    return <label className={styles.field} htmlFor={fieldId}>
      <span>{label} <span className={styles.count}>{draft[name].length}/{LIMITS[name]}</span></span>
      {name === "title" ? <input {...props} /> : <textarea {...props} rows={name === "prompt" ? 6 : 3} />}
      {errors[name] && <span id={`${fieldId}-error`} className={styles.error}>{errors[name]}</span>}
    </label>;
  }

  const edited = trimmedDraft(draft);
  const publicText = (value: string, placeholder: string) => containsNonPublicText(value)
    ? "공개 문구에서 주소, 계정 또는 키를 지워 주세요."
    : value || placeholder;
  return <form className={styles.publish} aria-labelledby={`${id}-heading`} onSubmit={event => { event.preventDefault(); void publish(); }}>
    <h3 id={`${id}-heading`}>공개 준비</h3>
    <p className={styles.note}>공개 페이지에는 아래 제목·요약·생성 프롬프트와 매체({MEDIA_LABEL[draft.media]}), 공개 시각만 보여요.</p>
    {field("title", "제목")}
    {field("summary", "요약")}
    {field("prompt", "생성 프롬프트")}
    <article className={premiere.publicPreview} aria-label="웹 공개 미리보기">
      <h4>웹 공개 미리보기</h4>
      <p>{MEDIA_LABEL[edited.media]} · 공개 시각은 공개 후 표시</p>
      <strong className={styles.plain}>{publicText(edited.title, "제목을 입력하세요.")}</strong>
      <p className={styles.plain}>{publicText(edited.summary, "공개할 요약을 입력하세요.")}</p>
      <h5>생성 프롬프트</h5>
      <p className={styles.plain}>{publicText(edited.prompt, "공개할 프롬프트를 입력하세요.")}</p>
    </article>
    <label className={styles.check}>
      <input type="checkbox" checked={consent} disabled={sending || published}
        onChange={event => { setConsent(event.target.checked); setNotice(null); }} />
      이 결과를 공개할 권리를 확인했고, 공개 결과 페이지에 표시하는 데 동의해요.
    </label>
    <div className={styles.actions}>
      <Button type="submit" loading={sending} loadingLabel="공개 중" disabled={!consent || sending || published}>공개하기</Button>
    </div>
    {notice && <p ref={noticeRef} tabIndex={-1} className={notice.tone === "success" ? styles.success : styles.error}
      role={notice.tone === "success" ? "status" : "alert"}>{notice.text}</p>}
  </form>;
}

export function PublicationList({ list, client, onBlocked, reload }: {
  list: PublicationListView; client: AdminReferenceAnalysisClient; onBlocked: (failure: Failure) => boolean; reload: () => Promise<void>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);

  async function revoke(item: PublishedReferenceAnalysis) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setRevoking(item.id); setNotice(null);
    const outcome = await client.revoke(item.id, controller.signal);
    if (controller.signal.aborted) return;
    mutation.current = null;
    setRevoking(null); setConfirming(null);
    if (outcome.kind === "ok") {
      setNotice({ tone: "success", text: `‘${item.title}’을 철회했어요. 공개 결과 페이지에서 내려가요.` });
      await reload();
      if (headingRef.current?.getClientRects().length) headingRef.current.focus({ preventScroll: true });
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
