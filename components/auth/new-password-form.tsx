"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Callout } from "@/components/ui/primitives";
import { PASSWORD_RULE, passwordDonePath, passwordProblem, type PasswordContext } from "@/lib/auth/config";
import { requestLogout } from "@/lib/auth/logout-client";
import { announceSessionChange } from "@/lib/auth/session-sync";
import styles from "./login.module.css";

// context(T-245): 관리자 재설정이면 끝난 뒤 관리자 로그인으로 돌아간다. 비밀번호 변경·로그아웃 처리는 같다.
export function NewPasswordForm({ context = null }: { context?: PasswordContext | null }) {
  const base = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // 비밀번호는 바뀌었지만 로그아웃이 안 된 상태(T-186, F184-2). 성공으로 숨기지 않고 다시 시도하게 한다.
  const [logoutFailure, setLogoutFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  async function finishWithLogout() {
    setBusy(true); setLogoutFailure(null);
    const result = await requestLogout();
    if (result.state === "ended") { announceSessionChange(); window.location.assign(passwordDonePath(context, "ended")); return; }
    if (result.state === "partial") { announceSessionChange(); window.location.assign(passwordDonePath(context, "partial")); return; }
    setLogoutFailure(result.message); setBusy(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const found: typeof errors = {};
    const problem = passwordProblem(password);
    if (problem) found.password = problem;
    if (password !== String(data.get("confirm") ?? "")) found.confirm = "비밀번호가 서로 달라요.";
    setErrors(found);
    if (found.password || found.confirm) { document.getElementById(`${base}-${found.password ? "password" : "confirm"}`)?.focus(); return; }
    setBusy(true); setFailure(null);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "비밀번호를 바꾸지 못했어요.");
    } catch (error) {
      setFailure(error instanceof Error && error.message !== "Failed to fetch" ? error.message : "비밀번호를 바꾸지 못했어요. 인터넷 연결을 확인해 주세요.");
      setBusy(false);
      return;
    }
    await finishWithLogout();
  }

  if (logoutFailure) return <div className={styles.form}>
    <div role="alert"><Callout tone="danger" title="비밀번호는 바뀌었지만 로그아웃하지 못했어요">{logoutFailure} 이 브라우저는 아직 로그인된 상태일 수 있어요.</Callout></div>
    <Button type="button" size="lg" loading={busy} loadingLabel="로그아웃하는 중" onClick={finishWithLogout}>로그아웃 다시 시도</Button>
  </div>;

  const field = (name: "password" | "confirm", label: string, help?: string) => {
    const id = `${base}-${name}`;
    const described = [help && `${id}-help`, errors[name] && `${id}-error`].filter(Boolean).join(" ") || undefined;
    return <div className={styles.field}>
      <div className={styles.labelRow}><label htmlFor={id}>{label}</label></div>
      <div className={`${styles.inputWrap} ${errors[name] ? styles.invalid : ""}`}><input id={id} name={name} type="password" autoComplete="new-password" maxLength={72} aria-invalid={!!errors[name]} aria-describedby={described} /></div>
      {help && <p id={`${id}-help`} className={styles.help}>{help}</p>}
      {errors[name] && <p id={`${id}-error`} className={styles.error}>{errors[name]}</p>}
    </div>;
  };

  return <form className={styles.form} onSubmit={submit} noValidate>
    {failure && <div role="alert"><Callout tone="danger" title="바꾸지 못했어요">{failure}</Callout></div>}
    {field("password", "새 비밀번호", PASSWORD_RULE)}
    {field("confirm", "새 비밀번호 확인")}
    <Button type="submit" size="lg" loading={busy} loadingLabel="바꾸는 중">비밀번호 바꾸기</Button>
  </form>;
}
