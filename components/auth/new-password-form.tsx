"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Callout } from "@/components/ui/primitives";
import { PASSWORD_RULE, passwordProblem } from "@/lib/auth/config";
import styles from "./login.module.css";

export function NewPasswordForm() {
  const base = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

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
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      window.location.assign("/login?notice=password");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "비밀번호를 바꾸지 못했어요.");
      setBusy(false);
    }
  }

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
