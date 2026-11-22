"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import { isYouTubeKeyFormat, keyStatusText, readYouTubeKey, saveYouTubeKey, useKeyCheck, type KeySave, type YouTubeKeyState } from "./youtube-key-client";
import styles from "./admin-gemini-settings.module.css";

// P1-08 관리자 YouTube 키 등록·교체(Backend a9582d5 계약: GET {configured, version, updatedAt}, PUT {expectedVersion, apiKey}, 409 stale, 503 저장소).
// Gemini 설정과 따로 저장하고, 새 키는 서버가 YouTube에서 확인한 뒤 교체한다.
// 키는 가려진 입력에만 두고(화면 상태 없음) 저장에 성공하면 바로 지운다. 409면 입력은 그대로 두고 최신 상태를 다시 읽는다.
const loginLink = adminLoginPath({ next: "/admin#admin-api-integrations" });
const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
type Read = { kind: "loading" } | { kind: "login" } | { kind: "forbidden" } | { kind: "storage" } | { kind: "failed" } | { kind: "ok"; value: YouTubeKeyState };
type Notice = { tone: "success" | "warning" | "danger"; text: string };

const saveFailure = (outcome: Exclude<KeySave, { kind: "ok" } | { kind: "stale" } | { kind: "login" }>) => {
  switch (outcome.kind) {
    case "invalid": return "키 형식을 확인해 주세요. 영문·숫자·밑줄·하이픈 16~256자예요.";
    case "too_large": return "입력이 너무 커요. 키만 넣어 주세요.";
    case "forbidden": return "이 계정에는 키를 등록할 권한이 없어요.";
    case "storage": return "서버의 YouTube 키 저장소가 준비되지 않아 저장하지 못했어요.";
    case "invalid_key": return "YouTube가 키를 받아들이지 않았어요. 키와 Data API 사용 설정을 확인해 주세요.";
    case "quota_exceeded": return "YouTube API 요청 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.";
    case "timed_out": return "YouTube 확인 시간이 초과됐어요. 잠시 뒤 다시 시도해 주세요.";
    default: return "저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.";
  }
};

function KeyForm({ state, onState, onLogin }: { state: YouTubeKeyState; onState: (value: YouTubeKeyState | null) => void; onLogin: () => void }) {
  const base = useId();
  const keyId = `${base}-key`;
  const input = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(!state.configured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const seen = useKeyCheck();
  const status = keyStatusText(state, seen);
  const active = useRef<AbortController | null>(null);
  const focus = useRef<"key" | "notice" | null>(null);
  useLayoutEffect(() => {
    const target = focus.current;
    if (!target) return;
    focus.current = null;
    (target === "key" ? input.current : noticeRef.current)?.focus();
  });
  useEffect(() => () => active.current?.abort(), []);
  const showKey = !state.configured || open;
  const clear = () => { if (input.current) input.current.value = ""; };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const apiKey = input.current?.value.trim() ?? "";
    if (!isYouTubeKeyFormat(apiKey)) {
      setError(apiKey ? "키 형식을 확인해 주세요. 영문·숫자·밑줄·하이픈 16~256자예요." : "YouTube API 키를 넣어 주세요.");
      setNotice(null);
      focus.current = "key";
      return;
    }
    setError("");
    setNotice(null);
    setSaving(true);
    const controller = new AbortController();
    active.current = controller;
    let outcome: KeySave;
    try { outcome = await saveYouTubeKey(state.version, apiKey, controller.signal); }
    catch { return; }
    finally { if (active.current === controller) { active.current = null; setSaving(false); } }
    // 안내문을 채우는 같은 렌더에서만 초점을 옮긴다(빈 안내문은 보이지 않아 초점을 받지 못함).
    if (outcome.kind !== "stale") focus.current = "notice";
    if (outcome.kind === "ok") {
      clear();
      setOpen(false);
      onState(outcome.value);
      setNotice({ tone: "success", text: `YouTube에서 확인한 키를 ${state.configured ? "교체" : "저장"}했어요(버전 ${outcome.value.version}).` });
      return;
    }
    if (outcome.kind === "login") { clear(); onLogin(); return; }
    if (outcome.kind === "stale") {
      const latest = await readYouTubeKey().catch(() => null);
      focus.current = "notice";
      if (latest?.kind === "ok") {
        onState(latest.value);
        setNotice({ tone: "warning", text: `다른 곳에서 YouTube 키가 먼저 바뀌어 최신 상태(${latest.value.configured ? `버전 ${latest.value.version}` : "미등록"})를 불러왔어요. 입력한 키는 그대로 두었어요. 확인한 뒤 다시 저장해 주세요.` });
      } else setNotice({ tone: "danger", text: "다른 곳에서 YouTube 키가 먼저 바뀌었지만 최신 상태를 불러오지 못했어요. 다시 불러온 뒤 저장해 주세요." });
      return;
    }
    if (outcome.kind === "storage") onState(null);
    setNotice({ tone: "danger", text: saveFailure(outcome) });
  }

  return <>
    <dl className={styles.status}>
      <div><dt>저장 상태</dt><dd data-tone={status.tone}>{state.configured ? `저장됨 · 버전 ${state.version}` : "미등록"}</dd></div>
      <div><dt>마지막 저장</dt><dd>{state.updatedAt ? <time dateTime={state.updatedAt}>{time.format(new Date(state.updatedAt))}</time> : "없음"}</dd></div>
    </dl>
    <p className={styles.state} role="status" aria-label="YouTube 키 확인 상태" data-tone={status.tone}>
      {status.text}{"at" in status && status.at && <> · <time dateTime={status.at}>{time.format(new Date(status.at))}</time></>}
    </p>
    <form className={styles.form} onSubmit={submit} noValidate aria-label="YouTube API 키" aria-busy={saving || undefined}>
      <fieldset className={styles.fieldset} disabled={saving}>
        <legend>YouTube Data API 키</legend>
        <div className={styles.field}>
          {showKey ? <>
            <label htmlFor={keyId}>{state.configured ? "새 YouTube API 키" : "YouTube API 키"}</label>
            <input ref={input} id={keyId} name="youtube-api-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="off"
              maxLength={256} aria-invalid={!!error} aria-describedby={`${keyId}-help${error ? ` ${keyId}-error` : ""}`} />
            <p id={`${keyId}-help`} className={styles.help}>Gemini 키와 따로 저장돼요. 저장한 키는 다시 보여 주지 않아요.</p>
            {error && <p id={`${keyId}-error`} className={styles.error}>{error}</p>}
            {state.configured && <div><Button type="button" variant="ghost" size="sm" onClick={() => { clear(); setError(""); setOpen(false); }}>교체 취소</Button></div>}
          </> : <div className={styles.keyStored}>
            <span id={`${keyId}-help`} className={styles.help}>저장된 키를 써요. 값은 보이지 않아요.</span>
            <Button type="button" variant="secondary" size="sm" aria-describedby={`${keyId}-help`}
              onClick={() => { setNotice(null); focus.current = "key"; setOpen(true); }}>YouTube 키 교체</Button>
          </div>}
        </div>
      </fieldset>
      <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice} data-tone={notice?.tone}>{notice?.text ?? ""}</p>
      {showKey && <div><Button type="submit" loading={saving} loadingLabel="YouTube에서 확인 중">검증 및 금고 보관</Button></div>}
    </form>
  </>;
}

/** API연동 칸의 YouTube 키 카드. 칸을 열었을 때만 그려진다(조회는 GET 한 번, 공급자 호출 없음). */
export function YouTubeSettingsCard() {
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readYouTubeKey(controller.signal).then(outcome => { if (!controller.signal.aborted) setRead(outcome); }, () => {});
    return () => controller.abort();
  }, [attempt]);
  const retry = <Button type="button" variant="secondary" size="sm" onClick={() => { setRead({ kind: "loading" }); setAttempt(value => value + 1); }}>다시 불러오기</Button>;
  return <Card className={styles.card}>
    <div className={styles.head}>
      <h4>YouTube 검색 키</h4>
      <p className={styles.help}>YouTube에 연결할 수 있는 키인지 확인한 뒤 서버 금고에 저장해요.</p>
    </div>
    <div aria-live="polite">
      {read.kind === "loading" && <p role="status">YouTube 키 상태를 불러오고 있어요.</p>}
      {read.kind === "login" && <p role="status">로그인이 끝났어요. <a className={styles.link} href={loginLink}>관리자 로그인</a></p>}
      {read.kind === "forbidden" && <p role="status">이 계정에는 YouTube 키를 볼 권한이 없어요.</p>}
      {read.kind === "storage" && <div className={styles.failed}><p role="status">서버의 YouTube 키 저장소가 아직 준비되지 않았어요. Gemini 설정은 그대로 쓸 수 있어요.</p>{retry}</div>}
      {read.kind === "failed" && <div className={styles.failed}><p role="status">YouTube 키 상태를 불러오지 못했어요.</p>{retry}</div>}
    </div>
    {read.kind === "ok" && <KeyForm state={read.value} onState={value => setRead(value ? { kind: "ok", value } : { kind: "storage" })} onLogin={() => setRead({ kind: "login" })} />}
  </Card>;
}
