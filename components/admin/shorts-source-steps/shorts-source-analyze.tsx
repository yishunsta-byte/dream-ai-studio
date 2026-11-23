"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  SHORTS_ANALYSIS_URI, shortsAnalysisAvailabilitySchema, shortsAnalysisResultSchema, shortsMultiAnalysisResultSchema, youtubeVideoId,
  type ShortsAnalysisResult, type ShortsMultiAnalysisResult,
} from "@/lib/reference-analysis/shorts-analysis-contract";
import { durationText, metricText, safeThumbnail } from "../admin-shorts-search";
import { ratioText, vphText } from "../shorts-metrics";
import { picksKey, sameOrder, type ShortsSourceAnalysis, type ShortsSourceMultiAnalysis, type ShortsSourcePick } from "./source-step-data";
import s from "./source-steps.module.css";

// P1-08-ORIGINAL-SEARCH-ANALYZE ②: 원본 v2.01 AnalyzeStep의 구성·문구를 옮긴 화면(분석 대상 카드, 해체 시작, 로딩, 결과 섹션, 다음 단계 단추).
// 통신은 기존 쇼츠 분석과 같다: 설정 상태 GET(8초 제한, 공급자 호출 없음) → 사용자가 동의하고 '바이럴 공식 해체 시작'을 누를 때만 POST {url, authorized:true}.
// 결과는 서버 검사 형식(shortsAnalysisResultSchema)을 통과한 값만 보이고, 원본의 11대 메커니즘·시각 DNA·댓글 반응처럼 지금 서버가 주지 않는 항목은 지어내지 않는다.
// 저장·게시 없음. 성공한 결과만 onResult로 셸에 알린다(앞 결과는 새 분석이 성공할 때만 바뀜).
// P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: 영상 2~3개를 고르면 같은 경로에 POST {urls(고른 순서), authorized:true}를 한 번 보내고
// shortsMultiAnalysisResultSchema로 읽는다. 받은 videoIds가 보낸 순서와 다르면 형식 오류로 본다. 근거마다 '영상 n · 시간'을 보인다.
// 묶음 결과는 onMultiResult로 셸 메모리에만 알리고, ③ 소재·프로젝트·보관함(영상 하나 계약)으로 줄여 넘기지 않는다. 영상 1개면 단건 흐름 그대로다.
const errors: Record<string, string> = {
  invalid_input: "공개 YouTube 쇼츠 주소가 아니에요. 검색에서 영상을 다시 골라 주세요.",
  not_configured: "쇼츠 분석 모델이 연결되면 이 기능을 쓸 수 있어요.",
  provider_error: "Gemini가 영상을 분석하지 못했어요. 공개 영상인지 확인해 주세요.",
  invalid_key: "Gemini가 키를 받아 주지 않았어요. API연동에서 Gemini 키와 쇼츠 모델을 확인해 주세요.",
  quota_exceeded: "Gemini 사용 한도에 걸렸어요. 잠시 뒤 다시 시도하거나 API연동에서 키의 사용 한도를 확인해 주세요.",
  invalid_response: "분석 결과 형식이 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.",
  timed_out: "영상 응답이 늦어졌어요. 잠시 뒤 다시 시도해 주세요.",
};
const multiErrors: Record<string, string> = {
  ...errors,
  invalid_input: "고른 영상 주소를 확인하지 못했거나 같은 영상이 겹쳤어요. 검색에서 영상을 다시 골라 주세요.",
  provider_error: "Gemini가 영상들을 함께 분석하지 못했어요. 모두 공개 영상인지 확인하거나 영상 수를 줄여 다시 시도해 주세요.",
  timed_out: "영상 여러 개를 분석하느라 응답이 늦어졌어요. 영상 수를 줄이거나 잠시 뒤 다시 시도해 주세요.",
  multi_video_unsupported: "지금 연결된 분석 모델은 한 번에 영상 1개만 분석할 수 있어요. 검색에서 영상을 1개만 남기면 분석할 수 있어요.",
};
const unreachable = "지금 쇼츠 분석에 연결할 수 없어요.";
const denied = "관리자 로그인과 권한을 확인해 주세요.";
type Availability = { kind: "checking" } | { kind: "configured" } | { kind: "not_configured" } | { kind: "failed"; message: string };
// Tester D3: Gemini 쪽 실패(키 거절·한도·공급자 오류)에는 API연동 링크를 함께 보인다(⑥ BGM 실패 안내와 같은 방식).
const settingsCodes = new Set(["invalid_key", "quota_exceeded", "provider_error"]);
type Notice = { tone: "status" | "alert"; text: string; settings?: boolean };

export type ShortsSourceAnalyzeProps = {
  /** ①에서 고른 영상들(고른 순서, 최대 3개). 비면 '돌아가기'만 보인다. 1개면 단건, 2개 이상이면 묶음 분석이다. */
  picks: readonly ShortsSourcePick[];
  /** '← 쇼츠 검색으로 돌아가기'·'영상 다시 선택'. */
  onBack: () => void;
  /** 단건 분석이 성공할 때마다 알린다(셸 메모리용, 저장 안 함). */
  onResult?: (analysis: ShortsSourceAnalysis) => void;
  /** '이 공식으로 소재 6개 발굴하기 ➔'(단건만). 없으면 단추를 숨긴다. */
  onNext?: (analysis: ShortsSourceAnalysis) => void;
  /** 셸이 들고 있던 앞 단건 분석(단계를 옮겼다 돌아와도 다시 분석하지 않음). */
  initialAnalysis?: ShortsSourceAnalysis | null;
  /** 묶음 분석이 성공할 때마다 알린다(셸 메모리용, 저장·③ 연결 없음). */
  onMultiResult?: (analysis: ShortsSourceMultiAnalysis) => void;
  /** 셸이 들고 있던 앞 묶음 분석. 고른 영상과 순서가 같을 때만 보인다. */
  initialMulti?: ShortsSourceMultiAnalysis | null;
  /** 모델 미설정 안내의 API연동 링크. */
  settingsHref?: string;
};

/** 설정 상태 GET(요청 1번, 8초 제한). 실패하면 '설정 다시 확인'으로 다시 읽는다. */
function useAvailability() {
  const [availability, setAvailability] = useState<Availability>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function check(): Promise<Availability> {
      try {
        const response = await fetch(SHORTS_ANALYSIS_URI, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) });
        if (response.status === 401 || response.status === 403) return { kind: "failed", message: denied };
        if (response.ok) {
          const status = shortsAnalysisAvailabilitySchema.safeParse(await response.json());
          if (status.success) return { kind: status.data.semantic.shorts };
        }
      } catch { /* 설정 상태는 분석 요청 없이 다시 확인할 수 있다. */ }
      return { kind: "failed", message: "쇼츠 모델 설정을 확인하지 못했어요." };
    }
    void check().then(status => { if (!controller.signal.aborted) setAvailability(status); });
    return () => controller.abort();
  }, [attempt]);
  const recheck = () => { setAvailability({ kind: "checking" }); setAttempt(value => value + 1); };
  return { availability, setAvailability, recheck };
}

function Header({ count }: { count: number }) {
  return <header className={s.stepHead}>
    <span className={s.stepNum} aria-hidden="true">2</span>
    <div><h2 className={s.stepTitle}>바이럴 분석</h2>
      <p className={s.stepDesc}>{count > 1 ? `고른 영상 ${count}개의 공통 패턴과 영상별 구간 근거를 한 번에 뽑아요.`
        : "선택한 영상의 훅·구성·소리와 구간별 전략을 영상에서 직접 뽑아요."}</p></div>
  </header>;
}

function Target({ pick, order }: { pick: ShortsSourcePick; order?: number }) {
  const thumb = safeThumbnail(pick.thumbnailUrl);
  return <div className={s.target}>
    {order !== undefined && <span className={s.pickOrder} aria-hidden="true">{order}</span>}
    {/* eslint-disable-next-line @next/next/no-img-element -- Public YouTube thumbnail host checked twice; not stored. */}
    {thumb ? <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" width={64} height={40} /> : <span className={s.targetBlank} aria-hidden="true" />}
    <div className={s.targetText}>
      <p className={s.targetTitle} title={pick.title}>{order !== undefined && `영상 ${order} · `}{pick.title}</p>
      <p className={s.targetMeta}>{pick.channelTitle} · 조회수 {metricText(pick.views)} · 구독자 {metricText(pick.subscribers)} · {durationText(pick.durationSeconds)}</p>
      <p className={s.targetMeta}>조회÷구독 {ratioText(pick.vsTenths === null ? null : BigInt(pick.vsTenths))} · 시간당 조회 {vphText(pick.vph)} · <span className={s.grade} data-grade={pick.grade}>{pick.grade}</span></p>
    </div>
  </div>;
}

function AvailabilityNotice({ availability, settingsHref, recheck }: { availability: Availability; settingsHref: string; recheck: () => void }) {
  return <div aria-live="polite">
    {availability.kind === "checking" && <p className={s.notice} role="status">쇼츠 분석 모델 설정을 확인하는 중이에요.</p>}
    {availability.kind === "not_configured" && <p className={s.notice} role="status">{errors.not_configured} <a className={s.link} href={settingsHref}>API연동 보기</a></p>}
    {availability.kind === "failed" && <div className={s.notice}>
      <span role="status">{availability.message}</span>
      <button type="button" className={`${s.ghost} ${s.small}`} onClick={recheck}>설정 다시 확인</button>
    </div>}
  </div>;
}

/** 서버가 준 항목만 원본 섹션으로 보인다. videos가 있으면(묶음) 근거마다 '영상 n'을 붙인다. */
function Findings({ id, result, heading, videos, badge }: {
  id: string; result: ShortsAnalysisResult | ShortsMultiAnalysisResult; heading: RefObject<HTMLHeadingElement | null>;
  videos?: readonly { title: string }[]; badge: string;
}) {
  const findings = result.findings;
  const mechanisms = ([
    { icon: "🪝", name: "훅(첫 장면)", tactic: "시선을 붙잡는 방식", text: findings.hook },
    { icon: "🧩", name: "구성", tactic: "장면·자막·편집 흐름", text: findings.composition },
    { icon: "🔊", name: "소리", tactic: "음악·효과음·말투", text: findings.sound },
  ] as const).filter(item => item.text);
  const segments: readonly { timestamp: string; evidence: string; video?: number }[] = findings.segments;
  return <>
    <section className={s.card} data-tone="video" aria-labelledby={`${id}-result`}>
      <div className={s.badgeRow}>
        <span className={s.evidence}>{badge}</span>
        <span className={s.engine}>Gemini · 공개 영상 근거</span>
      </div>
      <h3 id={`${id}-result`} ref={heading} tabIndex={-1} className={s.sectionTitle} style={{ marginTop: 12 }}>{videos ? "공통 패턴 요약" : "분석 요약"}</h3>
      <p className={s.summary}>{findings.summary}</p>
    </section>

    <section className={s.card} aria-labelledby={`${id}-mech`}>
      <h3 id={`${id}-mech`} className={s.sectionTitle}>🎯 바이럴 메커니즘 <span className={s.count}>({mechanisms.length}개 · 영상에서 확인된 것만)</span></h3>
      {mechanisms.length === 0 ? <p className={s.empty}>{videos ? "이 영상들에서는" : "이 영상에서는"} 훅·구성·소리를 따로 확인하지 못했어요.</p> : <div className={s.mechanisms}>
        {mechanisms.map(item => <article key={item.name} className={s.mechanism}>
          <h4 className={s.mechanismTitle}><span aria-hidden="true">{item.icon}</span>{item.name}</h4>
          <p className={s.mechanismTactic}>{item.tactic}</p>
          <p className={s.mechanismBody}>{item.text}</p>
        </article>)}
      </div>}
    </section>

    <section className={s.card} aria-labelledby={`${id}-timeline`}>
      <h3 id={`${id}-timeline`} className={s.sectionTitle}>⏱️ 구간별 타임라인 <span className={s.count}>({segments.length}개)</span></h3>
      {segments.length === 0 ? <p className={s.empty}>시간이 표시된 구간 근거가 없어요.</p> : <ol className={s.timeline}>
        {segments.map((segment, index) => <li key={`${segment.video ?? 0}-${segment.timestamp}-${index}`} className={s.timelineItem}>
          <p className={s.timelineRange}>{videos && segment.video !== undefined ? `영상 ${segment.video} · ${segment.timestamp}` : segment.timestamp}</p>
          {videos && segment.video !== undefined && <p className={s.timelineSource} title={videos[segment.video - 1]?.title}>{videos[segment.video - 1]?.title}</p>}
          <p className={s.timelineText}>{segment.evidence}</p>
        </li>)}
      </ol>}
    </section>

    {findings.draftPrompt && <section className={s.card} aria-labelledby={`${id}-prompt`}>
      <h3 id={`${id}-prompt`} className={s.sectionTitle}>🎨 재현용 초안 프롬프트</h3>
      <p className={s.prompt}>{findings.draftPrompt}</p>
    </section>}
  </>;
}

export function ShortsSourceAnalyze(props: ShortsSourceAnalyzeProps) {
  const { picks, onBack } = props;
  if (picks.length === 0) return <div className={s.root} data-source-step="analyze">
    <Header count={0} />
    <div className={s.card}>
      <p className={s.status} style={{ marginTop: 0 }}>분석할 영상이 선택되지 않았어요. 먼저 쇼츠 검색에서 영상을 골라 주세요.</p>
      <div className={s.actions}><button type="button" className={s.ghost} onClick={onBack}>← 쇼츠 검색으로 돌아가기</button></div>
    </div>
  </div>;
  return picks.length === 1 ? <SingleAnalyze {...props} pick={picks[0]} /> : <MultiAnalyze {...props} />;
}

function SingleAnalyze({ pick, onBack, onResult, onNext, initialAnalysis = null, settingsHref = "/admin#admin-api-integrations" }: ShortsSourceAnalyzeProps & { pick: ShortsSourcePick }) {
  const id = useId();
  const { availability, setAvailability, recheck } = useAvailability();
  // 동의는 영상마다 새로 받는다(영상을 바꾸면 자동으로 풀림).
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [analysis, setAnalysis] = useState<ShortsSourceAnalysis | null>(initialAnalysis);
  const active = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const videoId = pick.videoId;
  const consent = consentFor === videoId;

  useEffect(() => () => active.current?.abort(), []);
  // 분석 중에 영상이 바뀌면 그 요청을 끊는다(늦은 응답이 다른 영상 결과로 보이지 않게).
  useEffect(() => () => { active.current?.abort(); active.current = null; setRunning(false); }, [videoId]);

  async function analyze() {
    if (availability.kind !== "configured" || !consent || active.current) return;
    if (youtubeVideoId(pick.url) !== pick.videoId) { setNotice({ tone: "alert", text: errors.invalid_input }); return; }
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setNotice(null);
    const target = pick;
    try {
      const response = await fetch(SHORTS_ANALYSIS_URI, { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ url: target.url, authorized: true }), signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setNotice({ tone: "alert", text: denied }); return; }
      const body: { error?: unknown; result?: unknown } = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (body.error === "not_configured") { setAvailability({ kind: "not_configured" }); setConsentFor(null); return; }
        setNotice({ tone: "alert", text: typeof body.error === "string" && Object.hasOwn(errors, body.error) ? errors[body.error] : unreachable,
          settings: typeof body.error === "string" && settingsCodes.has(body.error) });
        return;
      }
      const parsed = shortsAnalysisResultSchema.safeParse(body.result);
      if (!parsed.success) { setNotice({ tone: "alert", text: errors.invalid_response }); return; }
      const next: ShortsSourceAnalysis = { videoId: target.videoId, url: target.url, title: target.title, result: parsed.data, analyzedAt: new Date().toISOString() };
      setAnalysis(next);
      setNotice({ tone: "status", text: "쇼츠 분석을 마쳤어요." });
      onResult?.(next);
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: false }));
    } catch {
      if (!controller.signal.aborted) setNotice({ tone: "alert", text: unreachable });
    } finally {
      if (active.current === controller) { active.current = null; setRunning(false); }
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = null;
    setRunning(false);
    setNotice({ tone: "status", text: "분석을 취소했어요. 앞 결과는 그대로예요." });
  }

  const shown = analysis && analysis.videoId === pick.videoId ? analysis : null;
  const other = analysis && analysis.videoId !== pick.videoId ? analysis : null;

  return <div className={s.root} data-source-step="analyze">
    <Header count={1} />
    <section className={s.card} aria-labelledby={`${id}-targets`}>
      <div className={s.cardHead}>
        <h3 id={`${id}-targets`}>분석 대상 영상 <span className={s.count}>(1개)</span></h3>
        <button type="button" className={s.textLink} onClick={onBack}>영상 다시 선택</button>
      </div>
      <div className={s.targets}><Target pick={pick} /></div>

      <AvailabilityNotice availability={availability} settingsHref={settingsHref} recheck={recheck} />
      <label className={s.consent}>
        <input type="checkbox" checked={consent} disabled={availability.kind !== "configured" || running}
          onChange={event => setConsentFor(event.target.checked ? pick.videoId : null)} />
        <span>분석 권리를 확인했고 영상 주소를 Gemini에 보내는 데 동의해요.</span>
      </label>
      <div className={s.actions}>
        <button type="button" className={s.primary} disabled={availability.kind !== "configured" || !consent || running} onClick={() => void analyze()}>
          {running ? "분석 중…" : shown ? "다시 분석하기" : "⚡ 바이럴 공식 해체 시작"}</button>
        {running && <button type="button" className={s.ghost} onClick={cancel}>분석 취소</button>}
      </div>
      <p className={s.help}>동의하고 단추를 누를 때만 영상 주소를 보내요. 분석 결과는 자동으로 게시되지 않아요.</p>
      {other && !running && <p className={s.notice}>앞서 분석한 &lsquo;{other.title}&rsquo;의 결과가 있어요. 이 영상을 분석해 성공하면 새 결과로 바뀌어요.</p>}
    </section>

    {running && <div className={`${s.card} ${s.loading}`} role="status">
      <span className={s.spinner} aria-hidden="true" />
      <div><p className={s.loadingTitle}>영상 분석 중…</p><p className={s.loadingDesc}>Gemini가 영상을 직접 보고 훅·구성·소리와 구간을 정리하고 있어요.</p></div>
    </div>}
    {notice && <p className={notice.tone === "alert" ? s.error : s.notice} role={notice.tone === "alert" ? "alert" : "status"}>{notice.text}{notice.settings && <> <a className={s.link} href={settingsHref}>API연동 보기</a></>}</p>}

    {shown && <>
      <Findings id={id} result={shown.result} heading={resultHeading} badge="🎬 영상 직접 분석" />
      {onNext && <div className={s.next}>
        <button type="button" className={s.primary} disabled={running} onClick={() => onNext(shown)}>이 공식으로 소재 6개 발굴하기 ➔</button>
      </div>}
    </>}
  </div>;
}

function MultiAnalyze({ picks, onBack, onMultiResult, initialMulti = null, settingsHref = "/admin#admin-api-integrations" }: ShortsSourceAnalyzeProps) {
  const id = useId();
  const { availability, setAvailability, recheck } = useAvailability();
  const key = picksKey(picks);
  const ids = picks.map(pick => pick.videoId);
  // 동의는 고른 묶음(영상과 순서)마다 새로 받는다.
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [multi, setMulti] = useState<ShortsSourceMultiAnalysis | null>(initialMulti);
  const active = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const consent = consentFor === key;

  useEffect(() => () => active.current?.abort(), []);
  // 분석 중에 고른 영상이나 순서가 바뀌면 그 요청을 끊는다(늦은 응답이 다른 묶음 결과로 섞이지 않게).
  useEffect(() => () => { active.current?.abort(); active.current = null; setRunning(false); }, [key]);

  async function analyze() {
    if (availability.kind !== "configured" || !consent || active.current) return;
    const targets = [...picks];
    const sent = targets.map(target => target.videoId);
    if (targets.some(target => youtubeVideoId(target.url) !== target.videoId) || new Set(sent).size !== sent.length) {
      setNotice({ tone: "alert", text: multiErrors.invalid_input });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setNotice(null);
    try {
      const response = await fetch(SHORTS_ANALYSIS_URI, { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ urls: targets.map(target => target.url), authorized: true }), signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setNotice({ tone: "alert", text: denied }); return; }
      const body: { error?: unknown; result?: unknown } = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (body.error === "not_configured") { setAvailability({ kind: "not_configured" }); setConsentFor(null); return; }
        setNotice({ tone: "alert", text: typeof body.error === "string" && Object.hasOwn(multiErrors, body.error) ? multiErrors[body.error] : unreachable,
          settings: typeof body.error === "string" && settingsCodes.has(body.error) });
        return;
      }
      const parsed = shortsMultiAnalysisResultSchema.safeParse(body.result);
      // 서버는 보낸 순서 그대로 videoIds를 돌려준다. 다르면 근거의 '영상 n'이 다른 영상을 가리키므로 보이지 않는다.
      if (!parsed.success || !sameOrder(parsed.data.videoIds, sent)) { setNotice({ tone: "alert", text: errors.invalid_response }); return; }
      const next: ShortsSourceMultiAnalysis = { videoIds: sent, videos: targets.map(({ videoId, url, title }) => ({ videoId, url, title })),
        result: parsed.data, analyzedAt: new Date().toISOString() };
      setMulti(next);
      setNotice({ tone: "status", text: `영상 ${sent.length}개 묶음 분석을 마쳤어요.` });
      onMultiResult?.(next);
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: false }));
    } catch {
      if (!controller.signal.aborted) setNotice({ tone: "alert", text: unreachable });
    } finally {
      if (active.current === controller) { active.current = null; setRunning(false); }
    }
  }
  function cancel() {
    active.current?.abort();
    active.current = null;
    setRunning(false);
    setNotice({ tone: "status", text: "분석을 취소했어요. 앞 결과는 그대로예요." });
  }

  const shown = multi && sameOrder(multi.videoIds, ids) ? multi : null;
  const other = multi && !shown ? multi : null;

  return <div className={s.root} data-source-step="analyze" data-analysis="multi">
    <Header count={picks.length} />
    <section className={s.card} aria-labelledby={`${id}-targets`}>
      <div className={s.cardHead}>
        <h3 id={`${id}-targets`}>분석 대상 영상 <span className={s.count}>({picks.length}개 · 고른 순서)</span></h3>
        <button type="button" className={s.textLink} onClick={onBack}>영상 다시 선택</button>
      </div>
      <div className={s.targets}>{picks.map((pick, index) => <Target key={pick.videoId} pick={pick} order={index + 1} />)}</div>
      <p className={s.scope} id={`${id}-scope`}>묶음 분석은 영상 {picks.length}개를 Gemini에 한 번에 보내 공통 패턴과 영상별 구간 근거를 받아요.
        결과는 이 화면에서 읽기만 할 수 있고, ③ 소재 발굴·작업 프로젝트·프롬프트 보관함으로 넘기거나 저장하지 않아요. 소재로 이어 가려면 영상을 1개만 골라 분석해 주세요.</p>

      <AvailabilityNotice availability={availability} settingsHref={settingsHref} recheck={recheck} />
      <label className={s.consent}>
        <input type="checkbox" checked={consent} disabled={availability.kind !== "configured" || running}
          onChange={event => setConsentFor(event.target.checked ? key : null)} />
        <span>분석 권리를 확인했고 영상 주소 {picks.length}개를 Gemini에 보내는 데 동의해요.</span>
      </label>
      <div className={s.actions}>
        <button type="button" className={s.primary} aria-describedby={`${id}-scope`} disabled={availability.kind !== "configured" || !consent || running} onClick={() => void analyze()}>
          {running ? "분석 중…" : shown ? "다시 묶음 분석하기" : `⚡ 영상 ${picks.length}개 묶음 해체 시작`}</button>
        {running && <button type="button" className={s.ghost} onClick={cancel}>분석 취소</button>}
      </div>
      <p className={s.help}>동의하고 단추를 누를 때만 영상 주소를 보내요(요청 1번). 분석 결과는 자동으로 게시되지 않아요.</p>
      {other && !running && <p className={s.notice}>앞서 묶음 분석한 영상 {other.videos.length}개({other.videos.map(video => `‘${video.title}’`).join(", ")})의 결과가 있어요. 지금 고른 영상으로 분석해 성공하면 새 결과로 바뀌어요.</p>}
    </section>

    {running && <div className={`${s.card} ${s.loading}`} role="status">
      <span className={s.spinner} aria-hidden="true" />
      <div><p className={s.loadingTitle}>영상 {picks.length}개 묶음 분석 중…</p>
        <p className={s.loadingDesc}>Gemini가 고른 영상을 한 번에 보고 공통 패턴과 영상별 구간을 정리하고 있어요. 영상이 많을수록 오래 걸릴 수 있어요.</p></div>
    </div>}
    {notice && <p className={notice.tone === "alert" ? s.error : s.notice} role={notice.tone === "alert" ? "alert" : "status"}>{notice.text}{notice.settings && <> <a className={s.link} href={settingsHref}>API연동 보기</a></>}</p>}

    {shown && <>
      <Findings id={id} result={shown.result} heading={resultHeading} videos={shown.videos} badge={`🎬 영상 ${shown.videos.length}개 묶음 분석`} />
      <div className={s.notice} role="note">
        <span>이 묶음 결과는 여기서 읽기만 해요. ③ 소재 발굴은 영상 1개 분석 결과로 이어져요.</span>
        <button type="button" className={`${s.ghost} ${s.small}`} disabled={running} onClick={onBack}>영상 1개로 다시 고르기</button>
      </div>
    </>}
  </div>;
}
