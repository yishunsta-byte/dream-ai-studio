"use client";

import { useId, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Button, Callout } from "@/components/ui/primitives";
import { PASSWORD_RULE, passwordProblem, validEmail } from "@/lib/auth/config";
import styles from "./login.module.css";

type Mode = "login" | "signup" | "reset";
type Notice = { tone: "info" | "danger"; title: string; text: string } | null;
type Errors = Partial<Record<"email" | "password" | "confirm", string>>;

async function post(url: string, body: Record<string, string>) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
  return result as { ok: true; message?: string };
}

function MailIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}
function LockIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function TextInput({ id, label, icon, error, help, aside, trailing, ...props }: ComponentProps<"input"> & { id: string; label: string; icon: ReactNode; error?: string; help?: string; aside?: ReactNode; trailing?: ReactNode }) {
  const described = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return <div className={styles.field}>
    <div className={styles.labelRow}><label htmlFor={id}>{label}</label>{aside}</div>
    <div className={`${styles.inputWrap} ${error ? styles.invalid : ""}`}><span className={styles.inputIcon}>{icon}</span><input id={id} aria-invalid={!!error} aria-describedby={described} {...props} />{trailing}</div>
    {help && <p id={`${id}-help`} className={styles.help}>{help}</p>}
    {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
  </div>;
}

function PasswordInput(props: { id: string; label: string; name: string; autoComplete: string; error?: string; help?: string; aside?: ReactNode; inputRef?: Ref<HTMLInputElement> }) {
  const [shown, setShown] = useState(false);
  const { inputRef, ...rest } = props;
  return <TextInput {...rest} ref={inputRef} type={shown ? "text" : "password"} icon={<LockIcon />} maxLength={72} spellCheck={false} autoCapitalize="none"
    trailing={<button type="button" className={styles.reveal} aria-pressed={shown} aria-controls={props.id} aria-label={`${props.label} ${shown ? "숨기기" : "보기"}`} onClick={() => setShown(!shown)}>{shown ? "숨기기" : "보기"}</button>} />;
}

export function LoginForm({ next, initialError, initialNotice }: { next: string; initialError?: string; initialNotice?: string }) {
  const base = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialError ? { tone: "danger", title: "로그인하지 못했어요", text: initialError } : initialNotice ? { tone: "info", title: "확인했어요", text: initialNotice } : null);
  const [errors, setErrors] = useState<Errors>({});
  const tabs = useRef<Record<"login" | "signup", HTMLButtonElement | null>>({ login: null, signup: null });

  function switchTo(next: Mode) { setMode(next); setErrors({}); setNotice(null); }
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? "login" : event.key === "End" ? "signup" : mode === "login" ? "signup" : "login";
    switchTo(target);
    tabs.current[target]?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const found: Errors = {};
    if (!validEmail(email)) found.email = "이메일 주소를 확인해 주세요.";
    if (mode === "login" && !password) found.password = "비밀번호를 넣어 주세요.";
    if (mode === "signup") {
      const problem = passwordProblem(password);
      if (problem) found.password = problem;
      if (password !== String(data.get("confirm") ?? "")) found.confirm = "비밀번호가 서로 달라요.";
    }
    setErrors(found);
    if (Object.keys(found).length) {
      const first = (["email", "password", "confirm"] as const).find((key) => found[key]);
      document.getElementById(`${base}-${mode}-${first}`)?.focus();
      return;
    }
    setBusy(true); setNotice(null);
    try {
      if (mode === "login") {
        await post("/api/auth/login", { email, password });
        window.location.assign(next);
        return;
      }
      const result = await post(mode === "signup" ? "/api/auth/signup" : "/api/auth/reset", mode === "signup" ? { email, password } : { email });
      setNotice({ tone: "info", title: "메일함을 확인해 주세요", text: `${result.message ?? ""} 메일이 안 보이면 스팸함도 확인해 주세요.` });
      form.reset();
    } catch (error) {
      setNotice({ tone: "danger", title: mode === "login" ? "로그인하지 못했어요" : mode === "signup" ? "가입하지 못했어요" : "메일을 보내지 못했어요", text: error instanceof Error ? error.message : "처리하지 못했어요." });
    } finally { setBusy(false); }
  }

  const id = (name: string) => `${base}-${mode}-${name}`;
  const message = notice && <div role={notice.tone === "danger" ? "alert" : "status"}><Callout tone={notice.tone} title={notice.title}>{notice.text}</Callout></div>;

  if (mode === "reset") return <div className={styles.form}>
    <div><h2 className={styles.subTitle}>비밀번호 찾기</h2><p className={styles.note}>가입한 이메일로 비밀번호를 새로 정하는 링크를 보내 드려요.</p></div>
    {message}
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextInput id={id("email")} label="이메일 주소" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" icon={<MailIcon />} error={errors.email} />
      <Button type="submit" size="lg" loading={busy} loadingLabel="보내는 중">재설정 메일 받기</Button>
    </form>
    <button type="button" className={styles.textButton} onClick={() => switchTo("login")}>← 로그인으로 돌아가기</button>
  </div>;

  return <div className={styles.form}>
    <div className={styles.tabs} role="tablist" aria-label="로그인 또는 회원가입" onKeyDown={onTabKey}>
      {(["login", "signup"] as const).map((key) => <button key={key} ref={(node) => { tabs.current[key] = node; }} type="button" role="tab" id={`${base}-tab-${key}`} aria-selected={mode === key} aria-controls={`${base}-panel`} tabIndex={mode === key ? 0 : -1} className={styles.tab} onClick={() => switchTo(key)}>{key === "login" ? "로그인" : "회원가입"}</button>)}
    </div>
    <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${mode}`} className={styles.form}>
      {message}
      <form key={mode} className={styles.form} onSubmit={submit} noValidate>
        <TextInput id={id("email")} label="이메일 주소" name="email" type="email" inputMode="email" autoComplete={mode === "login" ? "username" : "email"} autoCapitalize="none" spellCheck={false} placeholder="name@example.com" icon={<MailIcon />} error={errors.email} />
        <PasswordInput id={id("password")} label="비밀번호" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} error={errors.password} help={mode === "signup" ? PASSWORD_RULE : undefined}
          aside={mode === "login" ? <button type="button" className={styles.linkButton} onClick={() => switchTo("reset")}>비밀번호 찾기</button> : undefined} />
        {mode === "signup" && <PasswordInput id={id("confirm")} label="비밀번호 확인" name="confirm" autoComplete="new-password" error={errors.confirm} />}
        <Button type="submit" size="lg" loading={busy} loadingLabel={mode === "login" ? "로그인 중" : "보내는 중"}>{mode === "login" ? "로그인 →" : "가입 확인 메일 받기"}</Button>
      </form>
      {mode === "signup" && <p className={styles.note}>가입은 메일 인증을 마치면 끝나요. 허용된 계정만 작업실에 들어올 수 있어요.</p>}
    </div>
  </div>;
}
