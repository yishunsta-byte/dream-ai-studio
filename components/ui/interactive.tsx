"use client";

import Link from "next/link";
import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Button, IconButton } from "./primitives";
import { Icon } from "./Icon";
import styles from "./ui.module.css";

export function Field({ label, required, help, error, children }: { label: string; required?: boolean; help?: string; error?: string; children: ReactElement<InputHTMLAttributes<HTMLInputElement>> }) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const description = [children.props["aria-describedby"], help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return <div className={styles.field}><label htmlFor={id}>{label}{required && <span className={styles.required}> *<span className="sr-only">필수</span></span>}</label>
    {cloneElement(children, { id, required, "aria-required": required, "aria-invalid": !!error, "aria-describedby": description })}
    {help && <p id={`${id}-help`} className={styles.help}>{help}</p>}{error && <p id={`${id}-error`} className={styles.fieldError}>{error}</p>}
  </div>;
}
export function FormErrorSummary({ errors }: { errors: { id: string; label: string; message: string }[] }) {
  useEffect(() => { if (errors.length) document.getElementById(errors[0].id)?.focus(); }, [errors]);
  if (!errors.length) return null;
  return <div role="alert" className={`${styles.callout} ${styles.danger}`}><div><strong>{errors.length}개 항목을 확인해 주세요.</strong><ul>{errors.map((error) => <li key={error.id}><a href={`#${error.id}`} onClick={() => document.getElementById(error.id)?.focus()}>{error.label}: {error.message}</a></li>)}</ul></div></div>;
}
export function Tabs({ items, activeKey }: { items: { key: string; label: string; href: string; locked?: boolean; lockedReason?: string }[]; activeKey: string }) {
  const list = useRef<HTMLDivElement>(null);
  const locked = items.filter((item) => item.locked && item.lockedReason);
  return <div><div className={styles.tabs} role="tablist" aria-label="작업 단계" ref={list} onKeyDown={(event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(list.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]:not([aria-disabled="true"])') ?? []);
    const current = tabs.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
  }}>{items.map((item) => item.locked ? <span role="tab" aria-selected="false" aria-disabled="true" title={item.lockedReason} className={styles.tab} key={item.key}><Icon name="lock" />{item.label}</span> : <Link role="tab" aria-selected={item.key === activeKey} tabIndex={item.key === activeKey ? 0 : -1} className={styles.tab} href={item.href} key={item.key}>{item.label}</Link>)}</div>
    {locked.map((item) => <p className={styles.help} key={item.key}>{item.label}: {item.lockedReason}</p>)}
  </div>;
}
export function ConfirmPanel({ open, onDismiss, onConfirm, title, description, confirmLabel, tone = "default" }: { open: boolean; onDismiss: () => void; onConfirm: () => void; title: string; description: ReactNode; confirmLabel: string; tone?: "default" | "danger" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => { element?.close(); previous?.focus(); };
  }, [open]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); onDismiss(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'));
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div className={styles.panel}><h2 id={`${id}-title`}>{title}</h2><div id={`${id}-description`}>{description}</div><div className={styles.actions}><button type="button" ref={cancel} className={`${styles.button} ${styles.secondary} ${styles.md}`} onClick={onDismiss}>취소</button><Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button></div></div>
  </dialog>;
}
type Notice = { id: number; tone: "success" | "error"; message: string; undo?: () => void };
const ToastContext = createContext<(notice: Omit<Notice, "id">) => void>(() => {});
export function Toast({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  useEffect(() => {
    if (notice.tone === "error") return;
    const timer = setTimeout(() => dismiss(notice.id), 5000);
    return () => clearTimeout(timer);
  }, [notice.id, notice.tone, dismiss]);
  return <div role={notice.tone === "error" ? "alert" : "status"} className={`${styles.toast} ${notice.tone === "error" ? styles.dangerBorder : ""}`}><Icon name={notice.tone === "error" ? "warning" : "check"} /><span>{notice.message}</span>{notice.undo && <Button variant="ghost" onClick={() => { notice.undo?.(); dismiss(notice.id); }}>되돌리기</Button>}<IconButton label="알림 닫기" icon="close" onClick={() => dismiss(notice.id)} /></div>;
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const sequence = useRef(0);
  const push = useCallback((notice: Omit<Notice, "id">) => { setNotices((old) => [...old, { ...notice, id: ++sequence.current }]); }, []);
  const dismiss = useCallback((id: number) => setNotices((old) => old.filter((notice) => notice.id !== id)), []);
  return <ToastContext.Provider value={push}>{children}<div className={styles.toasts} aria-label="알림">{notices.map((notice) => <Toast key={notice.id} notice={notice} dismiss={dismiss} />)}</div></ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);
