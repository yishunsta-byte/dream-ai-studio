"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import { readYouTubeKey, recordKeyCheck, keyStatusText, useKeyCheck, useLatestKey, type KeyRead } from "./youtube-key-client";
import { searchYouTubeShorts, type SearchCode, type YouTubeShortCandidate } from "./youtube-search-client";
import { ADMIN_SETTINGS_HREF, SettingsLink } from "./admin-settings-link";
import panel from "./admin-reference-analysis.module.css";
import styles from "./admin-shorts-search.module.css";

// P1-08 관리자 공개 쇼츠 검색(Backend 3404b8f 계약). 키 상태는 GET 한 번(공급자 호출 없음)으로 읽고, '검색'을 눌렀을 때만 POST한다.
// 결과는 공개 메타데이터(최대 50개)를 화면에만 보여 주고 저장하지 않는다. 후보를 고르면 아래 단건 분석의 주소 칸에만 넣는다
// (분석·저장·게시 없음, 외부 분석은 그 칸에서 동의한 뒤에만). 검색 중 입력을 바꾸거나 취소하거나 화면을 떠나면 요청을 끊고 늦은 응답은 버린다.
const loginLink = adminLoginPath({ next: "/admin#admin-shorts-analysis" });
const orders = [
  { value: "relevance", label: "관련도순" },
  { value: "viewCount", label: "조회수순" },
  { value: "date", label: "최신순" },
] as const;
type Order = (typeof orders)[number]["value"];
type Query = { query: string; order: Order; dateFrom: string; dateTo: string };
type Results = Query & { items: YouTubeShortCandidate[]; credentialVersion: number };
type Notice = { tone: "status" | "alert"; text: string; settings?: boolean; login?: boolean; refresh?: "stale" | "not_configured" };
const number = new Intl.NumberFormat("ko-KR");
const day = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

const messages: Record<Exclude<SearchCode, "stale" | "not_configured" | "invalid_key">, string> = {
  invalid_input: "검색어(1~100자)와 기간을 확인해 주세요.",
  storage_unavailable: "서버의 YouTube 키 저장소가 준비되지 않아 검색하지 못했어요.",
  search_in_progress: "이 계정의 다른 쇼츠 검색이 진행 중이에요. 끝난 뒤 다시 검색해 주세요.",
  quota_exceeded: "YouTube 할당량이나 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.",
  provider_error: "YouTube 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  timed_out: "YouTube 응답이 20초 안에 오지 않았어요. 잠시 뒤 다시 시도해 주세요.",
  request_cancelled: "검색을 취소했어요.",
};

/** 검색어는 앞뒤 공백을 뺀 1~100자, 제어 문자 없음(계약과 같음). 기간은 시작일이 종료일보다 늦으면 안 된다. */
export function searchProblem({ query, dateFrom, dateTo }: Query) {
  const text = query.trim();
  if (!text) return "검색어를 넣어 주세요.";
  if ([...text].length > 100) return "검색어는 100자까지 쓸 수 있어요.";
  if ([...text].some(character => { const code = character.charCodeAt(0); return code < 32 || code === 127; })) return "검색어에 쓸 수 없는 문자가 있어요.";
  if (dateFrom && dateTo && dateFrom > dateTo) return "시작일이 종료일보다 늦어요.";
  return undefined;
}

export const metricText = (value: number | null) => value === null ? "비공개" : number.format(value);
export function durationText(seconds: number | null) {
  if (seconds === null) return "길이 미확인";
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
/** 서버가 거른 썸네일 주소를 화면에서도 한 번 더 확인한다(https·YouTube 이미지 호스트만). */
export function safeThumbnail(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.port && /^(?:i\d{0,2}\.ytimg\.com|img\.youtube\.com)$/.test(parsed.hostname) ? parsed.href : null;
  } catch { return null; }
}
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const rangeText = ({ dateFrom, dateTo }: Query) => dateFrom || dateTo ? ` · 기간 ${dateFrom || "처음"} ~ ${dateTo || "오늘"}` : "";

export function AdminShortsSearch({ onPick, picked }: { onPick: (url: string, title: string, query: string) => void; picked?: string }) {
  const id = useId();
  const [ownKey, setKey] = useState<KeyRead | { kind: "loading" }>({ kind: "loading" });
  const [keyAttempt, setKeyAttempt] = useState(0);
  const [form, setForm] = useState<Query>({ query: "", order: "relevance", dateFrom: "", dateTo: "" });
  const [problem, setProblem] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [results, setResults] = useState<Results>();
  const active = useRef<AbortController | null>(null);
  const queryField = useRef<HTMLInputElement>(null);
  const seen = useKeyCheck();
  // 같은 화면의 다른 칸이 더 새 키 버전을 읽었으면 그것을 쓴다(옛 버전 상태를 계속 보이거나 옛 버전으로 검색하지 않음).
  const latest = useLatestKey();
  const key: KeyRead | { kind: "loading" } = ownKey.kind === "ok" && latest && latest.version > ownKey.value.version ? { kind: "ok", value: latest } : ownKey;
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void readYouTubeKey(controller.signal).then(outcome => { if (!controller.signal.aborted) setKey(outcome); }, () => {});
    return () => controller.abort();
  }, [keyAttempt]);

  const stop = () => { active.current?.abort(); active.current = null; setRunning(false); };
  // 입력을 바꾸면 진행 중 검색을 끊는다(늦은 응답 버림). 앞 결과는 어떤 조건의 결과인지 표시된 채 남는다.
  const change = (patch: Partial<Query>) => { if (active.current) { stop(); setNotice({ tone: "status", text: "조건을 바꿔 진행 중 검색을 멈췄어요. 다시 검색해 주세요." }); } setProblem(""); setForm(previous => ({ ...previous, ...patch })); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (key.kind !== "ok" || !key.value.configured || active.current) return;
    const issue = searchProblem(form);
    if (issue) { setProblem(issue); queryField.current?.focus(); return; }
    const version = key.value.version;
    const sent: Query = { ...form, query: form.query.trim() };
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setNotice(null);
    let outcome;
    try {
      outcome = await searchYouTubeShorts({ query: sent.query, order: sent.order, credentialVersion: version,
        ...(sent.dateFrom && { dateFrom: sent.dateFrom }), ...(sent.dateTo && { dateTo: sent.dateTo }) }, controller.signal);
    } catch { return; }
    if (controller.signal.aborted || active.current !== controller) return;
    active.current = null;
    setRunning(false);
    if (outcome.kind === "ok") {
      recordKeyCheck(outcome.credentialVersion, "accepted");
      setResults({ ...sent, items: outcome.items, credentialVersion: outcome.credentialVersion });
      setNotice({ tone: "status", text: outcome.items.length ? `공개 쇼츠 후보 ${outcome.items.length}개를 찾았어요.` : "검색 결과가 없어요. 다른 검색어나 기간으로 다시 검색해 보세요." });
      return;
    }
    if (outcome.kind === "login") { setNotice({ tone: "alert", text: "로그인이 끝났어요.", login: true }); return; }
    if (outcome.kind === "forbidden") { setNotice({ tone: "alert", text: "이 계정에는 쇼츠 검색 권한이 없어요." }); return; }
    if (outcome.kind === "failed") { setNotice({ tone: "alert", text: "검색하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요." }); return; }
    const code = outcome.code;
    if (code === "invalid_key") {
      recordKeyCheck(version, "rejected");
      setNotice({ tone: "alert", text: "YouTube가 저장된 키나 API 사용을 거절했어요. API연동에서 YouTube 키를 교체해 주세요.", settings: true });
      return;
    }
    if (code === "stale" || code === "not_configured") {
      // 즉시 키 상태를 '확인 중'으로 돌려 최신 키를 다시 읽는 동안 검색 조건·검색을 잠근다(구버전 재검색 방지). 자동 재검색은 없고,
      // 다시 읽기는 키 확인 효과(keyAttempt)가 맡아 화면을 떠나면 끊기며 실패하면 '키 상태 다시 확인' 단추가 남는다.
      setKey({ kind: "loading" });
      setKeyAttempt(value => value + 1);
      setNotice({ tone: "alert", text: "", settings: code === "not_configured", refresh: code });
      return;
    }
    setNotice({ tone: "alert", text: messages[code] });
  }

  const configured = key.kind === "ok" && key.value.configured;
  // 409·미설정 뒤 안내: 다시 읽는 동안과 읽은 뒤를 그때그때의 키 상태로 쓴다.
  const refreshText = (code: "stale" | "not_configured") => key.kind === "loading"
    ? code === "stale" ? "검색 사이에 YouTube 키가 바뀌어 최신 키를 확인하는 중이에요. 확인이 끝나면 다시 검색해 주세요." : "저장된 YouTube 키를 다시 확인하는 중이에요."
    : code === "not_configured" ? "저장된 YouTube 키가 없어요. API연동에서 키를 저장해 주세요."
    : key.kind === "ok" && key.value.configured ? `검색 사이에 YouTube 키가 바뀌어 최신 키(버전 ${key.value.version})를 불러왔어요. 다시 검색해 주세요.`
    : "검색 사이에 YouTube 키가 바뀌었어요. 키 상태를 확인해 주세요.";
  const status = key.kind === "ok" ? keyStatusText(key.value, seen) : null;
  return <section className={panel.panel} data-appearance="premiere" aria-labelledby={`${id}-title`}>
    <div className={panel.surface}>
      <form className={panel.form} onSubmit={submit} noValidate aria-busy={running || undefined}>
        <h3 id={`${id}-title`}>공개 쇼츠 검색</h3>
        <p className={panel.note}>검색어를 넣고 &lsquo;검색&rsquo;을 누를 때만 저장된 YouTube 키로 공개 메타데이터를 찾아요. 결과는 저장하지 않고, 고른 영상은 아래 쇼츠 분석의 주소 칸에만 넣어요.</p>
        <div aria-live="polite">
          {key.kind === "loading" && <p className={panel.status} role="status">YouTube 키 상태를 확인하는 중이에요.</p>}
          {key.kind === "login" && <p className={panel.status} role="status">로그인이 끝났어요. <a className={panel.link} href={loginLink}>관리자 로그인</a></p>}
          {key.kind === "forbidden" && <p className={panel.status} role="status">이 계정에는 쇼츠 검색 권한이 없어요.</p>}
          {(key.kind === "storage" || key.kind === "failed" || (key.kind === "ok" && !key.value.configured)) && <div className={panel.actions}>
            <p className={panel.status} role="status">{key.kind === "storage" ? "서버의 YouTube 키 저장소가 아직 준비되지 않았어요."
              : key.kind === "failed" ? "YouTube 키 상태를 확인하지 못했어요." : "YouTube 검색 키가 없어요. API연동에서 키를 저장하면 검색할 수 있어요."}</p>
            <SettingsLink className={panel.link} href={ADMIN_SETTINGS_HREF} />
            <Button type="button" variant="secondary" onClick={() => { setKey({ kind: "loading" }); setKeyAttempt(value => value + 1); }}>키 상태 다시 확인</Button>
          </div>}
          {status && configured && <p className={styles.keyState} data-tone={status.tone} aria-label="YouTube 키 상태">{status.text}</p>}
        </div>
        <fieldset className={styles.fields} disabled={!configured}>
          <legend className={styles.hidden}>검색 조건</legend>
          <label className={`${panel.field} ${styles.query}`} htmlFor={`${id}-query`}>
            검색어
            <input ref={queryField} id={`${id}-query`} type="search" autoComplete="off" maxLength={100} value={form.query}
              aria-invalid={!!problem} aria-describedby={problem ? `${id}-problem` : undefined} onChange={event => change({ query: event.target.value })} />
          </label>
          <label className={panel.field} htmlFor={`${id}-order`}>
            정렬
            <select id={`${id}-order`} value={form.order} onChange={event => change({ order: event.target.value as Order })}>
              {orders.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className={panel.field} htmlFor={`${id}-from`}>
            시작일(선택)
            <input id={`${id}-from`} type="date" value={form.dateFrom} max={form.dateTo || undefined} onChange={event => change({ dateFrom: event.target.value })} />
          </label>
          <label className={panel.field} htmlFor={`${id}-to`}>
            종료일(선택)
            <input id={`${id}-to`} type="date" value={form.dateTo} min={form.dateFrom || undefined} onChange={event => change({ dateTo: event.target.value })} />
          </label>
        </fieldset>
        {problem && <p id={`${id}-problem`} className={panel.error} role="alert">{problem}</p>}
        <p className={panel.note}>기간은 UTC 날짜 기준이에요. 결과는 최대 50개예요.</p>
        <div className={panel.actions}>
          <Button className={panel.run} type="submit" loading={running} loadingLabel="검색 중" disabled={!configured}>검색</Button>
          {running && <Button type="button" variant="secondary" onClick={() => { stop(); setNotice({ tone: "status", text: messages.request_cancelled }); }}>검색 취소</Button>}
        </div>
        <p className={panel.status} role={notice?.tone === "alert" ? "alert" : "status"}>
          {running ? "YouTube에서 공개 쇼츠를 찾는 중이에요." : notice?.refresh ? refreshText(notice.refresh) : notice?.text ?? ""}
          {!running && notice?.settings && <> <SettingsLink className={panel.link} href={ADMIN_SETTINGS_HREF} /></>}
          {!running && notice?.login && <> <a className={panel.link} href={loginLink}>관리자 로그인</a></>}
        </p>
      </form>
      {results && <section className={styles.results} aria-labelledby={`${id}-results`}>
        <h4 id={`${id}-results`}>&lsquo;{results.query}&rsquo; 검색 결과 {results.items.length}개 · {orders.find(item => item.value === results.order)!.label}{rangeText(results)}</h4>
        <p className={panel.note}>YouTube 공개 메타데이터예요. 숨겨진 지표는 &lsquo;비공개&rsquo;로 보여 줘요. 고르기만 해서는 분석·저장·게시하지 않아요.</p>
        {results.items.length === 0 ? <p className={panel.status}>검색 결과가 없어요.</p> : <ol className={styles.list}>
          {results.items.map(item => {
            const thumb = safeThumbnail(item.thumbnailUrl);
            const chosen = picked === watchUrl(item.id);
            return <li key={item.id} className={styles.item} data-picked={chosen || undefined}>
              <div className={styles.thumb} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- Public YouTube thumbnail host checked twice; not stored. */}
                {thumb && <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" width={120} height={90}
                  onError={event => { event.currentTarget.hidden = true; }} />}
              </div>
              <div className={styles.body}>
                <h5>{item.title}</h5>
                <p className={panel.note}>{item.channelTitle} · <time dateTime={item.publishedAt}>{day.format(new Date(item.publishedAt))}</time> · {durationText(item.durationSeconds)}</p>
                <dl className={styles.metrics}>
                  <div><dt>조회수</dt><dd>{metricText(item.views)}</dd></div>
                  <div><dt>좋아요</dt><dd>{metricText(item.likes)}</dd></div>
                  <div><dt>댓글</dt><dd>{metricText(item.comments)}</dd></div>
                  <div><dt>구독자</dt><dd>{metricText(item.subscribers)}</dd></div>
                </dl>
                <Button type="button" variant="secondary" size="sm" aria-label={`${item.title} 영상을 쇼츠 분석 주소 칸에 넣기`} aria-pressed={chosen}
                  onClick={() => onPick(watchUrl(item.id), item.title, results.query)}>{chosen ? "주소 칸에 넣음" : "이 영상 고르기"}</Button>
              </div>
            </li>;
          })}
        </ol>}
      </section>}
    </div>
  </section>;
}
