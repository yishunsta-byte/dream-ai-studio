"use client";

import type { StyleDnaSummary } from "@/lib/reference-analysis/style-dna-contract";
import { useEffect, useRef, useState } from "react";
import { Dna, Loader2, Trash2 } from "./icons";
import l from "./studio-library.module.css";

// P1-06 원본 v1.39 보관함(app/(dashboard)/dashboard/page.tsx): 제목·설명·'새 이미지 분석', 카드 격자(넓으면 3열·중간 2열·좁으면 1열 — 썸네일 4:3·팔레트 막대·제목·
// 복제/변형·날짜·'열기'), 빈 상태 카드, 불러오는 중, 오류. 카드를 누르면 기록을 열고 1단계로 간다(원본 router.push("/analyze")).
// 제품 차이: 보관 한도(100)·버전 수·열려 있는 기록 표시(열기 대신 '열려 있음'), 팔레트는 서버 실측 5색(share), 키 등록 안내는 관리자 'API연동'으로.
// 삭제: 원본처럼 휴지통(분석 삭제) → '삭제 확인'(rose-600)/'취소'. 실패하면 확인 상태와 목록을 그대로 두고 안내만(원본 remove의 setError).
// 제품 차이: 삭제 중 표시·중복 누름 막기, 결과 안내(note)를 목록 위에 보여 준다.
export type LibraryState = { kind: "loading" } | { kind: "ok"; items: StyleDnaSummary[] } | { kind: "error"; text: string; retry?: () => void; login?: string };
export type LibraryNote = { tone: "status" | "alert"; text: string; retry?: () => void; login?: string };
type Props = { state: LibraryState; limit: number; current?: string; opening: string | null; when: (iso: string) => string;
  onOpen: (id: string) => void; onNew: () => void; settingsHref: string;
  deleting?: string | null; onDelete?: (id: string) => Promise<boolean>; note?: LibraryNote | null };

export function StudioLibrary({ state, limit, current, opening, when, onOpen, onNew, settingsHref, deleting = null, onDelete, note }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // 제품 보완(키보드): 휴지통을 누르면 그 단추가 사라지므로 초점을 '취소'로, 취소하면 다시 휴지통으로, 삭제되면 결과 안내로 옮긴다.
  const box = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const after = useRef<{ to: "trash" | "note"; id: string } | null>(null);
  useEffect(() => {
    if (confirmId) { cancelButton.current?.focus(); return; }
    const target = after.current; after.current = null;
    if (target) box.current?.querySelector<HTMLElement>(target.to === "trash" ? `[data-trash="${CSS.escape(target.id)}"]` : "[data-note]")?.focus();
  }, [confirmId]);
  useEffect(() => {
    if (after.current?.to === "note" && note) { after.current = null; box.current?.querySelector<HTMLElement>("[data-note]")?.focus(); }
  }, [note]);
  const remove = async (id: string) => {
    if (!onDelete) return;
    if (await onDelete(id)) { after.current = { to: "note", id }; setConfirmId(null); }
  };
  const cancel = (id: string) => { after.current = { to: "trash", id }; setConfirmId(null); };
  return <section ref={box} className={l.page} aria-label="보관함">
    <div className={l.head}>
      <div>
        <h4>보관함</h4>
        <p>분석한 이미지는 자동으로 저장됩니다. 카드를 눌러 다시 열고 보정·테스트를 이어가세요.{state.kind === "ok" && <span className={l.count}> 보관 {state.items.length} / {limit}</span>}</p>
      </div>
      <button type="button" className={l.primary} onClick={onNew}><Dna size={16} aria-hidden /><span>새 이미지 분석</span></button>
    </div>

    {note && (note.tone === "alert" ? <div className={l.error} role="alert" tabIndex={-1} data-note="">
      <span>{note.text}</span>
      {note.login ? <a href={note.login}>관리자 로그인</a> : note.retry && <button type="button" disabled={!!deleting}
        onClick={() => { after.current = { to: "note", id: "" }; note.retry?.(); }}>다시 확인</button>}
    </div> : <p className={l.done} role="status" tabIndex={-1} data-note="">{note.text}</p>)}

    {state.kind === "error" && <div className={l.error} role="alert">
      <span>{state.text}</span>
      {state.login ? <a href={state.login}>관리자 로그인</a> : state.retry && <button type="button" onClick={state.retry}>다시 확인</button>}
    </div>}

    {state.kind === "loading" ? <p className={l.loading} role="status"><Loader2 size={16} className={l.spin} aria-hidden /> 불러오는 중…</p>
      : state.kind === "ok" && !state.items.length ? <div className={`${l.card} ${l.empty}`}>
        <p className={l.emptyTitle}>아직 분석한 이미지가 없습니다.</p>
        <p>1단계에서 이미지를 올리면 카메라·조명·색상·스타일을 분석해 마스터 프롬프트를 만들어 드립니다. 먼저 <a href={settingsHref}>계정설정 및 API 연동</a>에서 Gemini(또는 OpenAI·Claude) 키를 등록해주세요.</p>
        <div><button type="button" className={l.primary} onClick={onNew}><span>첫 이미지 분석하기</span></button></div>
      </div>
      : state.kind === "ok" && <ul className={l.grid}>
        {state.items.map(item => {
          const open = item.id === current;
          const label = item.mode === "mutate" ? "스타일 변형" : "스타일 복제";
          return <li key={item.id} className={`${l.card} ${l.item}`} aria-current={open || undefined}>
            <button type="button" className={l.cover} onClick={() => onOpen(item.id)} disabled={open || opening === item.id}
              aria-label={`${item.title} ${open ? "(열려 있음)" : "열기"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.original.href} alt="" />
              <span className={l.palette} aria-hidden>{item.original.palette.map(color => <span key={color.hex} style={{ background: color.hex, width: `${color.share * 100}%` }} />)}</span>
              <span className={l.title}>{item.title}</span>
              <span className={l.meta}><b>{label}</b> · 버전 {item.revision} · {when(item.createdAt)}</span>
            </button>
            <div className={l.foot}>
              <button type="button" className={l.ghost} disabled={open || opening === item.id || deleting === item.id} onClick={() => onOpen(item.id)}>
                {opening === item.id && <Loader2 size={14} className={l.spin} aria-hidden />}<span>{open ? "열려 있음" : "열기"}</span>
              </button>
              {onDelete && (confirmId === item.id ? <span className={l.confirm}>
                <button type="button" className={l.danger} disabled={!!deleting} aria-label={`'${item.title}' 삭제 확인`} onClick={() => void remove(item.id)}>
                  {deleting === item.id && <Loader2 size={14} className={l.spin} aria-hidden />}삭제 확인</button>
                <button ref={cancelButton} type="button" className={l.cancel} disabled={deleting === item.id} onClick={() => cancel(item.id)}>취소</button>
              </span> : <button type="button" className={l.trash} data-trash={item.id} aria-label="분석 삭제" title={`'${item.title}' 삭제`} disabled={!!deleting || opening === item.id}
                onClick={() => setConfirmId(item.id)}><Trash2 size={16} /></button>)}
            </div>
          </li>;
        })}
      </ul>}
  </section>;
}
