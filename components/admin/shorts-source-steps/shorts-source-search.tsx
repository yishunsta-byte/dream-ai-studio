"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { adminLoginPath } from "@/lib/auth/config";
import { durationText, metricText, safeThumbnail, searchProblem } from "../admin-shorts-search";
import { arrangeShorts, gradeRule, ratioText, viewsPerHour, vphText, vsGrade, vsTenths, type ShortsView } from "../shorts-metrics";
import { keyStatusText, readYouTubeKey, recordKeyCheck, useKeyCheck, useLatestKey, type KeyRead } from "../youtube-key-client";
import { searchYouTubeShorts, type SearchCode } from "../youtube-search-client";
import {
  filterShorts, presetValues, shortsCsv, SOURCE_MAX_SELECT, toPick, togglePick, watchUrl,
  type PresetKind, type SearchOrder, type ShortsSourcePick, type ShortsSourceSnapshot, type SourceFilters, type SourceQuery,
} from "./source-step-data";
import s from "./source-steps.module.css";

// P1-08-ORIGINAL-SEARCH-ANALYZE ①: 원본 v2.01 SearchStep의 구성·문구를 옮긴 화면(검색어+쇼츠 검색, 프리셋, 조건 칸, 결과 표, CSV, 선택 영상 분석하기).
// 통신은 운영 공용 함수 그대로: 키 상태 GET 한 번(공급자 호출 없음), '쇼츠 검색'을 누를 때만 POST(/api/admin/shorts-search). 결과는 화면 메모리에만 두고 저장하지 않는다.
// 영상을 고르기만 해서는 분석·저장·게시하지 않고 onPick으로 셸에 알린다. P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: 원본처럼 최대 3개를 고른 순서대로 고르고(4번째는 막고 안내),
// 고른 영상 목록에서 순서 번호를 보이며 해제할 수 있다. 2개 이상이면 ②가 한 번에 묶어 분석한다.
const loginHref = adminLoginPath({ next: "/admin/shorts-analysis" });
const orderLabels: Record<SearchOrder, string> = { viewCount: "조회수 높은 순", relevance: "관련도 순", date: "최신 순" };
const viewLabels: Record<ShortsView, string> = { ratio: "조회÷구독 높은 순", vph: "시간당 조회수(VPH) 높은 순", search: "검색 순서 그대로" };
const day = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });
const clock = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const messages: Record<Exclude<SearchCode, "stale" | "not_configured" | "invalid_key">, string> = {
  invalid_input: "검색어(1~100자)와 게시 기간을 확인해 주세요.",
  storage_unavailable: "서버의 YouTube 키 저장소가 준비되지 않아 검색하지 못했어요.",
  search_in_progress: "이 계정의 다른 쇼츠 검색이 진행 중이에요. 끝난 뒤 다시 검색해 주세요.",
  quota_exceeded: "YouTube 할당량이나 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.",
  provider_error: "YouTube 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  timed_out: "YouTube 응답이 20초 안에 오지 않았어요. 잠시 뒤 다시 시도해 주세요.",
  request_cancelled: "검색을 취소했어요.",
};
type Notice = { text: string; settings?: boolean; login?: boolean };

export type ShortsSourceSearchProps = {
  /** 지금 고른 영상들(셸이 들고 있는 값, 고른 순서). 비면 선택 없음. */
  picked?: readonly ShortsSourcePick[];
  /** 영상을 고르거나 해제할 때 고른 순서의 새 목록을 알린다(빈 목록은 모두 해제). 요청·저장 없음. */
  onPick: (picks: ShortsSourcePick[]) => void;
  /** '선택 영상 분석하기 ➔'를 눌렀을 때(고른 영상이 있을 때만). 없으면 단추를 숨긴다. */
  onAnalyze?: (picks: ShortsSourcePick[]) => void;
  /** 셸이 들고 있던 지난 검색 결과(단계를 옮겼다 돌아와도 다시 검색하지 않음). */
  initialSnapshot?: ShortsSourceSnapshot | null;
  /** 검색이 성공할 때마다 결과 한 벌을 알린다(셸 메모리용, 저장 안 함). */
  onSnapshot?: (snapshot: ShortsSourceSnapshot) => void;
  /** 키 미등록·거절 안내의 API연동 링크. */
  settingsHref?: string;
};

export function ShortsSourceSearch({ picked = [], onPick, onAnalyze, initialSnapshot = null, onSnapshot, settingsHref = "/admin#admin-api-integrations" }: ShortsSourceSearchProps) {
  const id = useId();
  const [ownKey, setKey] = useState<KeyRead | { kind: "loading" }>({ kind: "loading" });
  const [keyAttempt, setKeyAttempt] = useState(0);
  // 원본: 처음 열면 게시 기간 기본값 최근 30일(지난 결과가 없을 때만). 날짜는 검색 API와 같은 UTC 날짜.
  const [form, setForm] = useState<SourceQuery>(() => {
    if (initialSnapshot) return { query: initialSnapshot.query, order: initialSnapshot.order, dateFrom: initialSnapshot.dateFrom, dateTo: initialSnapshot.dateTo };
    const preset = presetValues("reset", Date.now());
    return { query: "", order: "viewCount", dateFrom: preset.dateFrom, dateTo: preset.dateTo };
  });
  const [filters, setFilters] = useState<SourceFilters>({ maxDuration: "180", minViews: "", maxSubs: "" });
  const [view, setView] = useState<ShortsView>("ratio");
  const [results, setResults] = useState<ShortsSourceSnapshot | null>(initialSnapshot);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pickNote, setPickNote] = useState("");
  const active = useRef<AbortController | null>(null);
  const queryField = useRef<HTMLInputElement>(null);
  const seen = useKeyCheck();
  const latest = useLatestKey();
  const key: KeyRead | { kind: "loading" } = ownKey.kind === "ok" && latest && latest.version > ownKey.value.version ? { kind: "ok", value: latest } : ownKey;
  const configured = key.kind === "ok" && key.value.configured;

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void readYouTubeKey(controller.signal).then(outcome => { if (!controller.signal.aborted) setKey(outcome); }, () => {});
    return () => controller.abort();
  }, [keyAttempt]);

  const stop = () => { active.current?.abort(); active.current = null; setRunning(false); };
  // 조건을 바꾸면 진행 중 검색을 끊는다(늦은 응답 버림). 앞 결과는 어떤 조건의 결과인지 표시된 채 남는다.
  const change = (patch: Partial<SourceQuery>) => {
    if (active.current) { stop(); setNotice({ text: "조건을 바꿔 진행 중 검색을 멈췄어요. 다시 검색해 주세요." }); }
    setError("");
    setForm(previous => ({ ...previous, ...patch }));
  };
  function applyPreset(kind: PresetKind) {
    const preset = presetValues(kind, Date.now());
    change({ dateFrom: preset.dateFrom, dateTo: preset.dateTo });
    setFilters(preset.filters);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!configured || active.current) return;
    const issue = searchProblem(form);
    if (issue) { setError(issue === "검색어를 넣어 주세요." ? "검색어를 입력해 주세요. (예: 다이어트, 재테크, 여행)" : issue); queryField.current?.focus(); return; }
    const version = key.value.version;
    const sent: SourceQuery = { ...form, query: form.query.trim() };
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setError("");
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
      const snapshot: ShortsSourceSnapshot = { ...sent, items: outcome.items, credentialVersion: outcome.credentialVersion, measuredAt: Date.now() };
      setResults(snapshot);
      onSnapshot?.(snapshot);
      // 원본: 새 검색이면 앞 선택을 비운다.
      if (picked.length) onPick([]);
      setPickNote("");
      setNotice({ text: outcome.items.length ? `공개 쇼츠 후보 ${outcome.items.length}개를 찾았어요.` : "" });
      return;
    }
    if (outcome.kind === "login") { setError("로그인이 끝났어요."); setNotice({ text: "", login: true }); return; }
    if (outcome.kind === "forbidden") { setError("이 계정에는 쇼츠 검색 권한이 없어요."); return; }
    if (outcome.kind === "failed") { setError("검색하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요."); return; }
    const code = outcome.code;
    if (code === "invalid_key") {
      recordKeyCheck(version, "rejected");
      setError("YouTube가 저장된 키나 API 사용을 거절했어요. API연동에서 YouTube 키를 교체해 주세요.");
      setNotice({ text: "", settings: true });
      return;
    }
    if (code === "stale" || code === "not_configured") {
      // 최신 키를 다시 읽는 동안 검색을 잠근다(자동 재검색 없음).
      setKey({ kind: "loading" });
      setKeyAttempt(value => value + 1);
      setError(code === "stale" ? "검색 사이에 YouTube 키가 바뀌었어요. 키 상태를 다시 확인한 뒤 다시 검색해 주세요." : "저장된 YouTube 키가 없어요. API연동에서 키를 저장해 주세요.");
      setNotice({ text: "", settings: code === "not_configured" });
      return;
    }
    setError(messages[code]);
  }

  const shown = useMemo(() => results ? arrangeShorts(filterShorts(results.items, filters), view, results.measuredAt) : [], [results, filters, view]);
  function toggle(itemId: string) {
    if (!results) return;
    const item = results.items.find(candidate => candidate.id === itemId);
    if (!item) return;
    const next = togglePick(picked, toPick(item, results));
    if (next.full) { setPickNote(`영상은 최대 ${SOURCE_MAX_SELECT}개까지 고를 수 있어요. 다른 영상을 해제한 뒤 골라 주세요.`); return; }
    setPickNote("");
    onPick(next.picks);
  }
  const unpick = (videoId: string) => { setPickNote(""); onPick(picked.filter(pick => pick.videoId !== videoId)); };
  const order = (videoId: string) => picked.findIndex(pick => pick.videoId === videoId);
  function exportCsv() {
    if (!results || shown.length === 0) return;
    const url = URL.createObjectURL(new Blob([shortsCsv(shown, results.measuredAt)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `shorts_search_${new Date(results.measuredAt).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  const status = key.kind === "ok" ? keyStatusText(key.value, seen) : null;

  return <div className={s.root} data-source-step="search">
    <header className={s.stepHead}>
      <span className={s.stepNum} aria-hidden="true">1</span>
      <div><h2 className={s.stepTitle}>떡상 쇼츠 검색</h2>
        <p className={s.stepDesc}>키워드로 쇼츠를 찾고, 구독자 대비 조회수가 터진 영상을 골라 분석해요.</p></div>
    </header>

    <form className={s.card} onSubmit={submit} noValidate aria-busy={running || undefined} aria-labelledby={`${id}-search`}>
      <h3 id={`${id}-search`} className={s.hidden}>쇼츠 검색 조건</h3>
      <div aria-live="polite">
        {key.kind === "loading" && <p className={s.notice} role="status">YouTube 키 상태를 확인하는 중이에요.</p>}
        {key.kind === "login" && <p className={s.notice} role="status">로그인이 끝났어요. <a className={s.link} href={loginHref}>관리자 로그인</a></p>}
        {key.kind === "forbidden" && <p className={s.notice} role="status">이 계정에는 쇼츠 검색 권한이 없어요.</p>}
        {(key.kind === "storage" || key.kind === "failed" || (key.kind === "ok" && !key.value.configured)) && <div className={s.notice}>
          <span role="status">{key.kind === "storage" ? "서버의 YouTube 키 저장소가 아직 준비되지 않았어요."
            : key.kind === "failed" ? "YouTube 키 상태를 확인하지 못했어요." : "YouTube 검색 키가 없어요. API연동에서 키를 저장하면 검색할 수 있어요."}</span>
          <a className={s.link} href={settingsHref}>API연동 보기</a>
          <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => { setKey({ kind: "loading" }); setKeyAttempt(value => value + 1); }}>키 상태 다시 확인</button>
        </div>}
        {status && configured && <p className={s.keyState} data-tone={status.tone} aria-label="YouTube 키 상태">{status.text}</p>}
      </div>
      <div className={s.queryRow} style={{ marginTop: 12 }}>
        <label className={s.hidden} htmlFor={`${id}-query`}>검색어</label>
        <input ref={queryField} id={`${id}-query`} className={s.input} type="search" autoComplete="off" maxLength={100} value={form.query}
          placeholder="검색어 (예: 다이어트, 재테크, 여행, 자취)" disabled={!configured} aria-invalid={!!error || undefined}
          onChange={event => change({ query: event.target.value })} />
        <button type="submit" className={s.primary} disabled={!configured || running}>{running ? "검색 중…" : "쇼츠 검색"}</button>
      </div>
      {running && <div className={s.actions}><button type="button" className={`${s.ghost} ${s.small}`} onClick={() => { stop(); setNotice({ text: messages.request_cancelled }); }}>검색 취소</button></div>}

      <div className={s.presets}>
        <span className={s.presetLabel}>프리셋</span>
        <button type="button" className={s.preset} disabled={!configured} onClick={() => applyPreset("viral")}>🔥 지금 떡상</button>
        <span className={s.sep} aria-hidden="true">|</span>
        <button type="button" className={s.preset} disabled={!configured} onClick={() => applyPreset("small")}>🚀 작은 채널 대박</button>
        <span className={s.sep} aria-hidden="true">|</span>
        <button type="button" className={s.preset} disabled={!configured} onClick={() => applyPreset("trending")}>⚡ 급상승</button>
        <span className={s.sep} aria-hidden="true">|</span>
        <button type="button" className={`${s.preset} ${s.presetReset}`} disabled={!configured} onClick={() => applyPreset("reset")}>초기화</button>
      </div>

      <fieldset className={s.fields} disabled={!configured}>
        <legend className={s.hidden}>검색 조건</legend>
        <div className={`${s.label} ${s.wide}`} role="group" aria-labelledby={`${id}-range`}>
          <span id={`${id}-range`}>게시 기간</span>
          <div className={s.range}>
            <input className={s.input} type="date" aria-label="게시 시작일" value={form.dateFrom} max={form.dateTo || undefined} onChange={event => change({ dateFrom: event.target.value })} />
            <span aria-hidden="true">~</span>
            <input className={s.input} type="date" aria-label="게시 종료일" value={form.dateTo} min={form.dateFrom || undefined} onChange={event => change({ dateTo: event.target.value })} />
          </div>
        </div>
        <label className={s.label}>검색 정렬
          <select className={s.input} value={form.order} onChange={event => change({ order: event.target.value as SearchOrder })}>
            {(["viewCount", "relevance", "date"] as const).map(order => <option key={order} value={order}>{orderLabels[order]}</option>)}
          </select>
        </label>
        <label className={s.label}>영상 길이
          <select className={s.input} value={filters.maxDuration} onChange={event => setFilters(previous => ({ ...previous, maxDuration: event.target.value as SourceFilters["maxDuration"] }))}>
            <option value="60">1분 이내</option>
            <option value="180">3분 이내 (쇼츠 최대)</option>
            <option value="all">전체</option>
          </select>
        </label>
        <div className={s.pair}>
          <label className={s.label}>최소 조회수
            <input className={s.input} type="number" min={0} inputMode="numeric" placeholder="10000" value={filters.minViews} onChange={event => setFilters(previous => ({ ...previous, minViews: event.target.value }))} />
          </label>
          <label className={s.label}>최대 구독자
            <input className={s.input} type="number" min={0} inputMode="numeric" placeholder="50000" value={filters.maxSubs} onChange={event => setFilters(previous => ({ ...previous, maxSubs: event.target.value }))} />
          </label>
        </div>
      </fieldset>
      <p className={s.help}>💡 검색어·정렬·게시 기간은 &lsquo;쇼츠 검색&rsquo;을 누를 때 YouTube에 보내고(게시 기간은 UTC 날짜, 최대 50개), 영상 길이·최소 조회수·최대 구독자는 받은 결과에서만 걸러요. 결과는 저장하지 않아요.</p>
      <p className={s.status} role="status">{running ? "YouTube에서 공개 쇼츠를 찾는 중이에요." : notice?.text ?? ""}</p>
    </form>

    {(error || notice?.settings || notice?.login) && <p className={s.error} role="alert">{error}
      {notice?.settings && <> <a className={s.link} href={settingsHref}>API연동 보기</a></>}
      {notice?.login && <> <a className={s.link} href={loginHref}>관리자 로그인</a></>}</p>}

    <section className={s.card} aria-labelledby={`${id}-results`}>
      <div className={s.cardHead}>
        <h3 id={`${id}-results`}>검색 결과 <span className={s.count}>({shown.length}개 / 전체 {results?.items.length ?? 0}개)</span></h3>
        <div className={s.actions} style={{ marginTop: 0 }}>
          <span className={s.count} style={{ fontWeight: 700 }} aria-live="polite">선택 {picked.length}/{SOURCE_MAX_SELECT}</span>
          <button type="button" className={`${s.ghost} ${s.small}`} disabled={shown.length === 0} onClick={exportCsv}>📥 CSV 내보내기</button>
          {onAnalyze && <button type="button" className={`${s.primary} ${s.small}`} disabled={picked.length === 0}
            onClick={() => { if (picked.length) onAnalyze([...picked]); }}>{picked.length > 1 ? `선택 영상 ${picked.length}개 묶음 분석하기 ➔` : "선택 영상 분석하기 ➔"}</button>}
        </div>
      </div>
      {pickNote && <p className={s.error} role="alert" style={{ marginBottom: 12 }}>{pickNote}</p>}
      {picked.length > 0 && <div className={s.pickList}>
        <p className={s.pickListTitle} id={`${id}-picked`}>고른 영상 · 고른 순서대로 분석해요</p>
        <ol className={s.pickItems} aria-labelledby={`${id}-picked`}>
          {picked.map((pick, index) => <li key={pick.videoId} className={s.pickItem}>
            <span className={s.pickOrder} aria-hidden="true">{index + 1}</span>
            <span className={s.pickTitle} title={pick.title}>영상 {index + 1} · {pick.title}</span>
            <button type="button" className={s.textLink} aria-label={`영상 ${index + 1} ${pick.title} 해제`} onClick={() => unpick(pick.videoId)}>해제</button>
          </li>)}
        </ol>
      </div>}
      {results && results.items.length > 0 && <div className={s.actions} style={{ marginTop: 0, marginBottom: 12 }}>
        <label className={s.viewPick}>결과 보기 순서
          <select className={s.input} value={view} onChange={event => setView(event.target.value as ShortsView)}>
            {(["ratio", "vph", "search"] as const).map(value => <option key={value} value={value}>{viewLabels[value]}</option>)}
          </select>
        </label>
        <span className={s.count}>&lsquo;{results.query}&rsquo; · {orderLabels[results.order]} · 검색 시각 {clock.format(results.measuredAt)}</span>
      </div>}
      {shown.length === 0 ? <p className={s.empty}>{!results ? "아직 검색 결과가 없어요. 키워드를 입력해 검색해 보세요."
        : results.items.length === 0 ? "검색 결과가 없어요. 다른 검색어나 기간으로 다시 검색해 보세요." : "조건에 맞는 영상이 없어요. 필터를 조정해 보세요."}</p>
        : <div className={s.tableWrap}><table className={s.table}>
          <caption className={s.hidden}>공개 쇼츠 검색 결과. 영상을 최대 {SOURCE_MAX_SELECT}개 고르면 다음 단계에서 고른 순서대로 분석할 수 있어요.</caption>
          <thead><tr>
            <th scope="col"><span className={s.hidden}>선택</span></th>
            <th scope="col">영상</th><th scope="col">조회수</th><th scope="col">구독자</th><th scope="col">조회÷구독</th>
            <th scope="col">시간당 조회(VPH)</th><th scope="col">등급</th>
          </tr></thead>
          <tbody>{shown.map(item => {
            const tenths = vsTenths(item);
            const grade = vsGrade(tenths);
            const thumb = safeThumbnail(item.thumbnailUrl);
            const rank = order(item.id);
            const chosen = rank >= 0;
            return <tr key={item.id} data-picked={chosen || undefined}>
              <td><span className={s.checkCell}>
                <input type="checkbox" className={s.check} checked={chosen} aria-label={chosen ? `${item.title} 선택(영상 ${rank + 1})` : `${item.title} 선택`} onChange={() => toggle(item.id)} />
                {chosen && <span className={s.pickOrder} aria-hidden="true">{rank + 1}</span>}
              </span></td>
              <td><div className={s.video}>
                <a className={s.thumb} href={watchUrl(item.id)} target="_blank" rel="noreferrer" aria-label={`${item.title} YouTube에서 보기(새 창)`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Public YouTube thumbnail host checked twice; not stored. */}
                  {thumb && <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" width={120} height={68} onError={event => { event.currentTarget.hidden = true; }} />}
                  <span className={s.duration}>{durationText(item.durationSeconds)}</span>
                </a>
                <div style={{ minWidth: 0 }}>
                  <p className={s.videoTitle} title={item.title}>{item.title}</p>
                  <p className={s.videoMeta}>{item.channelTitle} · <time dateTime={item.publishedAt}>{day.format(new Date(item.publishedAt))}</time></p>
                </div>
              </div></td>
              <td className={s.strong}>{metricText(item.views)}</td>
              <td className={s.muted}>{metricText(item.subscribers)}</td>
              <td className={s.muted}>{ratioText(tenths)}</td>
              <td className={s.muted}>{vphText(viewsPerHour(item, results!.measuredAt))}</td>
              <td><span className={s.grade} data-grade={grade}>{grade}</span></td>
            </tr>;
          })}</tbody>
        </table></div>}
      <p className={s.foot}>{gradeRule} VPH는 검색 시각 기준으로 조회수를 게시 후 지난 시간(최소 1시간)으로 나눈 값이에요. 영상은 최대 {SOURCE_MAX_SELECT}개까지 고를 수 있고, 2개 이상이면 한 번에 묶어 공통 패턴을 분석해요(묶음 결과는 ③ 소재 발굴로 넘기지 않아요).</p>
    </section>
  </div>;
}
