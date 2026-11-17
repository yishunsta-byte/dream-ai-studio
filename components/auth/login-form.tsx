"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, Callout } from "@/components/ui/primitives";
import { Field } from "@/components/ui/interactive";
import styles from "./login.module.css";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string; message: string } | { kind: "error"; message: string };

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, setState] = useState<State>(initialError ? { kind: "error", message: initialError } : { kind: "idle" });
  const [fieldError, setFieldError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError("이메일 주소를 확인해 주세요."); input.current?.focus(); return; }
    setFieldError("");
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, next }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "로그인 링크를 보내지 못했어요.");
      setState({ kind: "sent", email, message: result.message });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "로그인 링크를 보내지 못했어요." });
    }
  }

  if (state.kind === "sent") return <div className={styles.sent} role="status">
    <Callout tone="info" title="메일함을 확인해 주세요">{state.message}</Callout>
    <p className={styles.note}>메일이 안 보이면 스팸함도 확인해 주세요. 링크는 이 브라우저에서 열어야 바로 로그인돼요.</p>
    <Button variant="secondary" onClick={() => setState({ kind: "idle" })}>다른 주소로 다시 보내기</Button>
  </div>;

  return <form className={styles.form} onSubmit={submit} noValidate>
    {state.kind === "error" && <div role="alert"><Callout tone="danger" title="로그인하지 못했어요">{state.message}</Callout></div>}
    <Field label="이메일" required error={fieldError}>
      <input ref={input} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" />
    </Field>
    <Button type="submit" size="lg" loading={state.kind === "sending"} loadingLabel="보내는 중">로그인 링크 받기</Button>
  </form>;
}
