"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { shortsVaultProjectLimit, shortsVaultPromptSetLimit, shortsVaultRetentionDays, shortsVaultSearchQueryLimit,
  type ShortsVaultProjectSummary, type ShortsVaultPromptSet, type ShortsVaultPromptSetSummary } from "@/lib/reference-analysis/shorts-vault-contract";
import {
  copyText, deleteProject, deletePromptSet, downloadText, limitVaultSearchInput, listProjects, listPromptSets, openPromptSet, replyMessage, searchPromptSets,
  vaultClosed, vaultSearchQuery, type Reply,
} from "./shorts-client";
import { fileName, promptSetMarkdown, timecode } from "./shorts-session";
import type { ShortsStepProps } from "./shorts-step-types";
import { CopyButton } from "./shorts-step-ui";
import s from "./shorts-studio.module.css";

// P1-08 원본 VaultPanel.tsx(프롬프트 보관함)와 HomePanel의 '최근 작업 프로젝트 보관함'.
// 보관함 서버가 아직 운영에 없으면(503) '연결 전' 안내만 보이고 단계 실행은 그대로 쓸 수 있다.
// 지우기는 브라우저 확인 창 대신 같은 자리에서 한 번 더 누르게 한다. 지운 뒤에는 보이는 순서의 다음 항목(없으면 앞 항목, 다 지웠으면 다음 할 일)으로 초점을 옮긴다.
type List<T> = { kind: "loading" } | { kind: "ready"; items: T[] } | { kind: "closed" } | { kind: "failed"; message: string };
const loading = { kind: "loading" } as const;

/** 목록 하나 불러오기. key(검색어)나 다시 시도가 바뀌면 앞 요청을 취소하고, 받은 결과는 그 key·시도의 것일 때만 보인다(늦게 온 앞 검색 결과는 버림). */
function useList<T>(load: (signal: AbortSignal) => Promise<Reply<T[]>>, key = "") {
  const [state, setState] = useState<{ key: string; attempt: number; list: List<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(reply => {
      if (controller.signal.aborted) return;
      setState({ key, attempt, list: reply.kind === "ok" ? { kind: "ready", items: reply.value } : vaultClosed(reply) ? { kind: "closed" }
        : { kind: "failed", message: replyMessage(reply as Exclude<typeof reply, { kind: "ok" }>) } });
    });
    return () => controller.abort();
  }, [load, key, attempt]);
  const list: List<T> = state && state.key === key && state.attempt === attempt ? state.list : loading;
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const remove = useCallback((match: (item: T) => boolean) => setState(current => current && current.list.kind === "ready"
    ? { ...current, list: { kind: "ready", items: current.list.items.filter(item => !match(item)) } } : current), []);
  return { list, reload, remove };
}

function ListStatus<T>({ list, reload, closedText, loadingText = "불러오는 중…", failedPrefix = "" }:
  { list: List<T>; reload: () => void; closedText: string; loadingText?: string; failedPrefix?: string }) {
  if (list.kind === "loading") return <p role="status" className={s.empty}>{loadingText}</p>;
  if (list.kind === "closed") return <p role="status" className={s.empty}>{closedText}</p>;
  if (list.kind === "failed") return <div className={s.runStatus}><p role="status" className={s.statusText}>{failedPrefix}{list.message}</p>
    <button type="button" className={s.ghost} onClick={reload}>다시 불러오기</button></div>;
  return null;
}

/** 두 번 눌러 지우기. */
function DeleteButton({ label, onDelete }: { label: string; onDelete: () => Promise<string | null> }) {
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState("");
  return <>
    <button type="button" className={s.ghost} disabled={step === "busy"} aria-label={step === "confirm" ? `${label} 정말 지우기` : `${label} 지우기`}
      onClick={async () => {
        if (step === "idle") { setStep("confirm"); setError(""); return; }
        setStep("busy");
        const message = await onDelete();
        setStep("idle");
        if (message) setError(message);
      }} onBlur={() => { if (step === "confirm") setStep("idle"); }}>
      {step === "confirm" ? "한 번 더 누르면 지워요" : step === "busy" ? "지우는 중…" : "삭제"}
    </button>
    {error && <span role="status" className={s.fieldHint}>{error}</span>}
  </>;
}

/** 지운 항목 다음에 초점을 줄 항목: 보이는 순서에서 바로 다음, 없으면 바로 앞, 둘 다 없으면 null. */
export function nextFocusId(ids: readonly string[], removed: string) {
  const at = ids.indexOf(removed);
  if (at < 0) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

/** 목록이 다시 그려진 뒤 data-focus-key가 맞는 요소로 초점을 옮긴다(지운 항목이 빠진 다음). */
function useFocusAfter<E extends HTMLElement>(change: unknown) {
  const root = useRef<E>(null);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const key = pending.current;
    if (!key) return;
    pending.current = null;
    [...(root.current?.querySelectorAll<HTMLElement>("[data-focus-key]") ?? [])].find(node => node.dataset.focusKey === key)?.focus();
  }, [change]);
  const focusNext = useCallback((key: string) => { pending.current = key; }, []);
  return { root, focusNext };
}

/** 펼친 프롬프트 세트: ⑥ 결과처럼 장면마다 이미지·영상 이름표와 복사, BGM은 Suno 복사(원본 VaultPanel의 장면별 CopyBox). */
export function PromptSetDetail({ document }: { document: ShortsVaultPromptSet["document"] }) {
  const bgm = document.bgmPrompt;
  return <ol className={s.sceneList} aria-label={`${document.title} 장면별 프롬프트`}>
    {document.prompts.map(prompt => <li key={prompt.sceneNumber} className={s.sceneCard}>
      <div className={s.ideaHead}><span className={s.ideaTag}>SCENE {prompt.sceneNumber}</span><span className={s.cardMeta}>⏱️ {timecode(prompt)}</span></div>
      <p className={s.ideaBody}>{prompt.sceneSummary}</p>
      <div className={s.promptBox}><span className={s.hookLabel}>🖼️ Image prompt (9:16)</span><p lang="en">{prompt.imagePrompt}</p>
        <CopyButton copy={copyText} label="이미지 복사" text={prompt.imagePrompt} /></div>
      <div className={s.promptBox}><span className={s.hookLabel}>🎥 Video prompt</span><p lang="en">{prompt.videoPrompt}</p>
        <CopyButton copy={copyText} label="영상 복사" text={prompt.videoPrompt} /></div>
    </li>)}
    {bgm && <li className={s.sceneCard}>
      <div className={s.ideaHead}><span className={s.ideaTag}>BGM</span>
        {bgm.recommendedBpmRange && <span className={s.cardMeta}>{bgm.recommendedBpmRange.min}–{bgm.recommendedBpmRange.max} BPM</span>}</div>
      <p className={s.ideaTitle}>{bgm.title}</p>
      <div className={s.promptBox}><span className={s.hookLabel}>🎵 Suno prompt</span><p lang="en">{bgm.sunoPrompt}</p>
        <CopyButton copy={copyText} label="Suno 복사" text={bgm.sunoPrompt} /></div>
    </li>}
  </ol>;
}

const dateTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

/** 검색어를 멈춘 뒤 서버에 보내기까지 기다리는 시간. 지우면 바로 목록으로 돌아간다. */
export const vaultSearchDelayMs = 300;

export function ShortsVaultStep({ goTo }: ShortsStepProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  // 서버에 보낸 검색어(빈 값이면 GET 목록). 입력이 멈추면 바뀐다.
  const [applied, setApplied] = useState("");
  const typed = vaultSearchQuery(query);
  useEffect(() => {
    if (typed === applied) return;
    const timer = setTimeout(() => setApplied(typed), typed ? vaultSearchDelayMs : 0);
    return () => clearTimeout(timer);
  }, [typed, applied]);
  const load = useCallback((signal: AbortSignal) => applied ? searchPromptSets(applied, signal) : listPromptSets(signal), [applied]);
  const { list: received, reload, remove } = useList<ShortsVaultPromptSetSummary>(load, applied);
  // 입력이 아직 서버에 가지 않았으면(멈추기를 기다리는 중) 앞 결과 대신 찾는 중으로 보인다.
  const list = useMemo<List<ShortsVaultPromptSetSummary>>(() => typed === applied ? received : loading, [typed, applied, received]);
  const [open, setOpen] = useState<Record<string, ShortsVaultPromptSet | "loading" | string>>({});
  const live = useRef(new AbortController());
  useEffect(() => () => live.current.abort(), []);
  const { root, focusNext } = useFocusAfter<HTMLElement>(list);

  const expand = async (setId: string) => {
    if (open[setId]) { setOpen(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== setId))); return; }
    setOpen(current => ({ ...current, [setId]: "loading" }));
    const reply = await openPromptSet(setId, live.current.signal);
    if (live.current.signal.aborted) return;
    setOpen(current => current[setId] !== "loading" ? current
      : { ...current, [setId]: reply.kind === "ok" ? reply.value : reply.kind === "failed" && reply.status === 404 ? "이미 지워진 세트예요." : replyMessage(reply) });
  };
  // 서버 결과를 그대로 보인다(요약에는 프롬프트 본문이 없어서 화면에서 다시 거르면 본문으로 찾은 세트가 빠진다).
  const items = list.kind === "ready" ? list.items : [];
  const searching = typed !== "";
  const showSearch = searching || applied !== "" || list.kind === "ready" || list.kind === "loading";

  return <section ref={root} className={s.card} aria-labelledby={`${id}-head`}>
    <div className={s.cardHead}>
      <h3 id={`${id}-head`}>저장한 프롬프트 세트</h3>
      <span className={s.cardMeta}>{list.kind !== "ready" ? "" : searching ? `${items.length}세트 찾음` : `전체 ${items.length}세트 · 최대 ${shortsVaultPromptSetLimit}세트`}</span>
    </div>
    {showSearch && <label className={s.field}><span className={s.fieldLabel}>검색</span>
      <input className={s.input} type="search" data-focus-key="search" value={query} placeholder="제목·소재·키워드·프롬프트 내용으로 검색"
        aria-describedby={`${id}-search-hint`} onChange={event => setQuery(limitVaultSearchInput(event.target.value))} />
      <span id={`${id}-search-hint`} className={s.fieldHint}>{shortsVaultSearchQueryLimit}자까지, 입력을 멈추면 내 보관함 안에서만 찾아요. 검색어는 저장하지 않아요.</span>
    </label>}
    <ListStatus list={list} reload={reload} loadingText={searching ? `‘${typed}’ 찾는 중…` : "불러오는 중…"} failedPrefix={searching ? "검색하지 못했어요. " : ""}
      closedText="프롬프트 보관함이 아직 연결되지 않았어요. ⑥에서 만든 프롬프트는 복사하거나 Markdown으로 내려받아 주세요." />
    {list.kind === "ready" && <>
      {searching && items.length > 0 && <p role="status" className={s.statusText}>검색어 ‘{typed}’에 맞는 세트 {items.length}개를 찾았어요.</p>}
      {items.length === 0 ? searching
        ? <p role="status" className={s.empty}>검색어 ‘{typed}’에 맞는 세트가 없어요. 다른 낱말로 찾거나 검색어를 지워 보세요.</p>
        : <div className={s.empty}><p>저장한 세트가 없어요.</p>
          <button type="button" className={s.inlineLink} data-focus-key="empty" onClick={() => goTo("prompts")}>⑥ 9:16 비주얼 프롬프트에서 저장하기</button></div>
        : <ul className={s.vaultList}>
          {items.map(item => {
            const detail = open[item.id];
            return <li key={item.id} className={s.sceneCard}>
              <div className={s.ideaHead}>
                <h4 className={s.ideaTitle}>{item.title}</h4>
                <span className={s.cardMeta}>{item.sceneCount}씬{item.hasBgm ? " · BGM 포함" : ""} · 저장 {dateTime.format(new Date(item.createdAt))}</span>
              </div>
              <p className={s.fieldHint}>{item.ideaTitle}{item.keyword ? ` · ${item.keyword}` : ""}</p>
              <div className={s.rowActions}>
                <button type="button" className={s.ghost} data-focus-key={`item:${item.id}`} aria-expanded={!!detail && detail !== "loading"} onClick={() => void expand(item.id)}>
                  {detail === "loading" ? "여는 중…" : detail ? "접기" : "펼쳐 보기"}</button>
                {typeof detail === "object" && <>
                  <CopyButton copy={copyText} label="세트 전체 복사" text={promptSetMarkdown(detail.document)} />
                  <button type="button" className={s.ghost} onClick={() => downloadText(fileName(detail.document.title, "prompts"), promptSetMarkdown(detail.document))}>📥 .md 저장</button>
                </>}
                <DeleteButton label={item.title} onDelete={async () => {
                  const reply = await deletePromptSet(item.id, live.current.signal);
                  if (reply.kind === "ok" || (reply.kind === "failed" && reply.status === 404)) {
                    const next = nextFocusId(items.map(set => set.id), item.id);
                    focusNext(next ? `item:${next}` : searching ? "search" : "empty");
                    remove(set => set.id === item.id);
                    return null;
                  }
                  return `지우지 못했어요. ${replyMessage(reply)}`;
                }} />
              </div>
              {typeof detail === "string" && detail !== "loading" && <p role="status" className={s.statusText}>{detail}</p>}
              {typeof detail === "object" && <PromptSetDetail document={detail.document} />}
            </li>;
          })}
        </ul>}
    </>}
  </section>;
}

const day = 86_400_000;
export const daysLeft = (expiresAt: string, now = Date.now()) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / day));

/** 홈 '최근 작업 프로젝트 보관함': 30일 탐색 프로젝트 목록·열기·삭제.
 * onDeleted: 서버에서 지운 것이 확인된 뒤(성공·이미 없음)에만 부른다. 지금 작업 중인 프로젝트였으면 셸이 작업을 비우고 true를 돌려준다(원본 HomePanel). */
export function ShortsProjectList({ onOpen, currentId, onDeleted }:
  { onOpen: (id: string) => Promise<string | null>; currentId: string | null; onDeleted?: (id: string) => boolean }) {
  const { list, reload, remove } = useList<ShortsVaultProjectSummary>(listProjects);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const live = useRef(new AbortController());
  useEffect(() => () => live.current.abort(), []);
  const { root, focusNext } = useFocusAfter<HTMLDivElement>(list);
  return <div ref={root}>
    <ListStatus list={list} reload={reload} closedText="프로젝트 보관함이 아직 연결되지 않았어요. 단계는 그대로 진행할 수 있지만, 이 화면을 떠나면 작업이 남지 않아요." />
    {list.kind === "ready" && (list.items.length === 0
      ? <p className={s.empty} tabIndex={-1} data-focus-key="empty">저장된 프로젝트가 없어요. ② 분석을 마치면 단계마다 자동으로 저장돼요({shortsVaultRetentionDays}일 보관).</p>
      : <>
        <p className={s.fieldHint}>단계마다 자동 저장 · 처음 저장한 날부터 {shortsVaultRetentionDays}일 보관 · 최대 {shortsVaultProjectLimit}개</p>
        <ul className={s.vaultList}>
          {list.items.map(item => <li key={item.id} className={s.projectRow} data-current={item.id === currentId || undefined}>
            <div className={s.projectText}>
              <strong className={s.ideaTitle}>{item.title}</strong>
              <span className={s.cardMeta}>{item.step}단계까지 · {daysLeft(item.expiresAt)}일 뒤 자동 삭제{item.keyword ? ` · ${item.keyword}` : ""}</span>
            </div>
            <span className={s.rowActions}>
              <button type="button" className={s.primary} data-focus-key={`project:${item.id}`} disabled={!!busy} onClick={async () => {
                setBusy(item.id); setMessage("");
                const failed = await onOpen(item.id);
                setBusy("");
                if (failed) { setMessage(failed); reload(); }
              }}>{busy === item.id ? "여는 중…" : item.id === currentId ? "이어서 작업" : "열기"}</button>
              <DeleteButton label={item.title} onDelete={async () => {
                const reply = await deleteProject(item.id, live.current.signal);
                if (reply.kind === "ok" || (reply.kind === "failed" && reply.status === 404)) {
                  const next = nextFocusId(list.items.map(project => project.id), item.id);
                  focusNext(next ? `project:${next}` : "empty");
                  remove(project => project.id === item.id);
                  setMessage(onDeleted?.(item.id) ? "지금 작업하던 프로젝트를 지워서 새 작업으로 비웠어요." : "");
                  return null;
                }
                return `지우지 못했어요. ${replyMessage(reply)}`;
              }} />
            </span>
          </li>)}
        </ul>
      </>)}
    {message && <p role="status" className={s.statusText}>{message}</p>}
  </div>;
}
