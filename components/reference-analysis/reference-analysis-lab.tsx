"use client";
// T-266 레퍼런스 분석 합성 체험 화면(Studio). T265 시안을 기존 디자인 시스템으로 옮겼다.
// 합성 표본만 모의 분석한다. 주소·본문·파일은 형식만 이 브라우저에서 확인하고 보내거나 읽지 않는다.
import { useCallback, useEffect, useId, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  CANCEL_CONFIRM_MS, PHASE_TEXT, SAMPLES, TONES, checkLocalInput, copyOutcome, currentInput, initialLabState, isBusy, labReducer,
  plannedEvents, promptText, type CopyTicket, type JobPhase, type SampleId, type Scenario, type SourceMode, type Tone,
} from "./lab-model";
import styles from "./reference-analysis-lab.module.css";

const SOURCE_LABEL: Record<SourceMode, string> = { sample: "합성 표본", url: "URL", file: "파일", body: "본문" };
const ALTERNATIVE_LABEL: Record<SourceMode, string> = { sample: "합성 표본 사용", url: "URL 입력", file: "파일 선택(캡처 이미지 포함)", body: "본문 입력" };
const SCENARIO_LABEL: Record<Scenario, string> = { complete: "근거가 있는 결과", empty: "근거 없는 결과", failed: "실패" };
const QUOTE = "색과 리듬으로 감각을 전합니다.";
type Tab = "evidence" | "prompt";

export function ReferenceAnalysisLab() {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [state, dispatch] = useReducer(labReducer, initialLabState);
  const [sample, setSample] = useState<SampleId>("video");
  const [scenario, setScenario] = useState<Scenario>("complete");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<Tab>("evidence");
  const [activeEvidence, setActiveEvidence] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [tone, setTone] = useState<Tone>("clear");
  const [notes, setNotes] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const busy = isBusy(state);
  const job = state.job;
  const result = job?.phase === "complete" ? job : null;

  const draftVersion = useRef(0);
  // 초점 이동은 그린 뒤에 한다.
  const pendingFocus = useRef<string | null>(null);
  const focusAfterRender = (target: string) => { pendingFocus.current = target; };
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    document.getElementById(id(target))?.focus();
  });

  // 모의 작업 이벤트. 각 이벤트는 만든 작업 번호를 들고 가고, 다른 작업·종료된 작업에는 적용되지 않는다(reducer).
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((timer) => window.clearTimeout(timer)); }, []);
  const schedule = useCallback((jobId: number, phase: JobPhase, afterMs: number) => {
    timers.current.push(window.setTimeout(() => dispatch({ type: "jobEvent", jobId, phase }), afterMs));
  }, []);
  const startedJob = useRef(0);
  useEffect(() => {
    if (!job || job.phase !== "queued" || startedJob.current === job.id) return;
    startedJob.current = job.id;
    plannedEvents(job).forEach((event) => schedule(job.id, event.phase, event.afterMs));
  }, [job, schedule]);

  // 상태가 바뀌면 다음 조작으로 초점을 옮긴다.
  const lastPhase = useRef<string>("");
  useEffect(() => {
    const key = job ? `${job.id}:${job.phase}` : "";
    if (!job || key === lastPhase.current) return;
    lastPhase.current = key;
    // 효과는 화면을 그린 뒤 실행되므로 대상 요소가 이미 있다.
    const target = job.phase === "complete" ? "tab-evidence" : job.phase === "failed" || job.phase === "canceled" ? "job-again" : job.phase === "empty" ? "job-status" : null;
    if (target) document.getElementById(`${uid}-${target}`)?.focus();
  }, [job, uid]);
  // 새 작업마다 결과 보기 상태를 처음으로 되돌린다(이전 작업의 초안·선택을 잇지 않음).
  const resetResultView = () => { setTab("evidence"); setActiveEvidence(false); setQuoteOpen(false); setTone("clear"); setNotes(""); setCopyStatus(""); draftVersion.current += 1; currentTicket.current = 0; };

  // 복사 요청 귀속(T265-R P2)
  const ticketSeq = useRef(0);
  const currentTicket = useRef(0);
  const jobRef = useRef<number | null>(null);
  const tabRef = useRef<Tab>("evidence");
  useEffect(() => { jobRef.current = result ? result.id : null; tabRef.current = tab; });
  const changeDraft = (next: Tone) => { draftVersion.current += 1; setTone(next); setCopyStatus(""); };

  const selectSource = (source: SourceMode) => {
    // 권한 확인과 고른 파일은 입력 방식을 바꾸면 reducer에서 지운다(T266-R P1).
    dispatch({ type: "source", source });
    focusAfterRender(source === "sample" ? "sample" : "field");
  };

  const submit = () => {
    if (busy) return;
    if (state.source === "sample") {
      resetResultView();
      dispatch({ type: "startSample", sample, scenario });
      focusAfterRender("job-cancel");
      return;
    }
    const input = currentInput(state, url, body);
    if (!input) return;
    const notice = checkLocalInput(input);
    dispatch({ type: "inputChecked", notice });
    // 실제 오류는 필드로, 대체 안내는 안내 영역으로(바로 다음 Tab이 첫 대안).
    focusAfterRender(notice.invalidField ? "field" : "notice");
  };

  const requestCancel = () => {
    if (!job || (job.phase !== "queued" && job.phase !== "running")) return;
    dispatch({ type: "jobEvent", jobId: job.id, phase: "cancelRequested" });
    schedule(job.id, "canceled", CANCEL_CONFIRM_MS);
    focusAfterRender("job-status");
  };
  const again = () => {
    if (!job) return;
    resetResultView();
    dispatch({ type: "startSample", sample: job.sample, scenario: job.scenario === "failed" ? "complete" : job.scenario });
    focusAfterRender("job-cancel");
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const order: Tab[] = ["evidence", "prompt"];
    const index = order.indexOf(tab);
    const next = ({ ArrowRight: order[(index + 1) % 2], ArrowLeft: order[(index + 1) % 2], Home: order[0], End: order[1] } as Partial<Record<string, Tab>>)[event.key];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    focusAfterRender(`tab-${next}`);
  };

  const copy = async () => {
    if (!result) return;
    const ticket: CopyTicket = { id: ++ticketSeq.current, text: promptText(result.sample, tone), draftVersion: draftVersion.current, jobId: result.id };
    currentTicket.current = ticket.id;
    setCopyStatus("복사하는 중이에요.");
    let ok: boolean;
    try { await navigator.clipboard.writeText(ticket.text); ok = true; } catch { ok = false; }
    const outcome = copyOutcome(ticket, { ticketId: currentTicket.current, draftVersion: draftVersion.current, jobId: jobRef.current, onPromptTab: tabRef.current === "prompt" }, ok);
    // 작업이 바뀌었거나 결과가 닫혔거나 더 새 요청이 있으면 아무것도 바꾸지 않는다.
    if (outcome === "ignore") return;
    if (outcome === "staleCopied") { setCopyStatus("이전 문구가 복사됐어요. 바뀐 문구가 필요하면 다시 복사해 주세요."); return; }
    if (outcome === "staleFailed") { setCopyStatus("복사하지 못했어요. 지금 문구로 다시 시도해 주세요."); return; }
    if (outcome === "copied") { setCopyStatus("표시된 프롬프트를 복사했어요."); return; }
    const output = document.getElementById(id("export"));
    if (output) {
      output.focus();
      const range = document.createRange();
      range.selectNodeContents(output);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setCopyStatus("복사 권한이 없어요. 선택된 문구를 직접 복사해 주세요.");
  };

  const phaseText = PHASE_TEXT[job?.phase ?? "idle"];
  const notice = state.notice;
  const noticeId = id("notice");

  let field: ReactNode;
  if (state.source === "sample") {
    field = <div className={styles.fields}>
      <div><label className={styles.label} htmlFor={id("sample")}>합성 자료</label>
        <select className={styles.field} id={id("sample")} value={sample} disabled={busy} onChange={(event) => setSample(event.target.value as SampleId)}>
          {(Object.keys(SAMPLES) as SampleId[]).map((key) => <option key={key} value={key}>{SAMPLES[key].option}</option>)}
        </select></div>
      <div><label className={styles.label} htmlFor={id("scenario")}>모의 작업 결과</label>
        <select className={styles.field} id={id("scenario")} value={scenario} disabled={busy} onChange={(event) => setScenario(event.target.value as Scenario)}>
          {(Object.keys(SCENARIO_LABEL) as Scenario[]).map((key) => <option key={key} value={key}>{SCENARIO_LABEL[key]}</option>)}
        </select></div>
      <p className={styles.hint}>미리 만든 합성 근거와 작업 상태를 체험해요.</p>
    </div>;
  } else {
    const described = notice ? noticeId : undefined;
    const invalid = notice?.invalidField || undefined;
    const permission = <label className={styles.check}><input type="checkbox" checked={state.authorized} onChange={(event) => dispatch({ type: "authorize", authorized: event.target.checked })} /> 이 자료를 쓸 권한이 있어요</label>;
    field = <div className={styles.fields}>
      {state.source === "url" && <div><label className={styles.label} htmlFor={id("field")}>참고 URL</label>
        <input className={styles.field} id={id("field")} type="url" inputMode="url" autoComplete="off" placeholder="https://example.invalid/…" value={url} aria-invalid={invalid} aria-describedby={described} onChange={(event) => setUrl(event.target.value)} />
        <p className={styles.hint}>체험 화면은 주소를 열지 않아요.</p></div>}
      {state.source === "body" && <div><label className={styles.label} htmlFor={id("field")}>참고 본문</label>
        <textarea className={styles.field} id={id("field")} maxLength={100_000} placeholder="합성 문구만 입력하세요." value={body} aria-invalid={invalid} aria-describedby={described} onChange={(event) => setBody(event.target.value)} />{permission}</div>}
      {state.source === "file" && <div><label className={styles.label} htmlFor={id("field")}>파일 선택</label>
        <input className={styles.field} id={id("field")} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4" aria-invalid={invalid} aria-describedby={described}
          onChange={(event) => { const picked = event.target.files?.[0]; dispatch({ type: "pickFile", file: picked ? { name: picked.name, size: picked.size, type: picked.type } : null }); }} />
        <p className={styles.hint}>이 브라우저에서 이름·크기·형식만 확인해요. 파일 내용을 읽거나 보내지 않아요.</p>{permission}</div>}
    </div>;
  }

  return (
    <div className={styles.lab}>
      <p className={styles.synthetic} role="note"><strong>합성 체험</strong> · 실제 자료를 보내거나 분석하지 않아요. 결과는 미리 만든 합성 표본이에요.</p>
      <div className={styles.layout}>
        <section className={styles.panel} aria-labelledby={id("input-title")}>
          <h2 id={id("input-title")}>분석 자료</h2>
          <div className={styles.sources} role="group" aria-label="입력 방식">
            {(Object.keys(SOURCE_LABEL) as SourceMode[]).map((source) => <button key={source} type="button" className={styles.button} aria-pressed={state.source === source} disabled={busy} onClick={() => selectSource(source)}>{SOURCE_LABEL[source]}</button>)}
          </div>
          {field}
          {notice && <div id={noticeId} className={notice.tone === "error" ? `${styles.notice} ${styles.error}` : styles.notice} tabIndex={-1}>
            <p role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>
            {notice.alternatives.length > 0 && <div className={styles.row}>{notice.alternatives.map((mode) => <button key={mode} type="button" className={styles.button} onClick={() => selectSource(mode)}>{ALTERNATIVE_LABEL[mode]}</button>)}</div>}
          </div>}
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={submit}>{state.source === "sample" ? "표본 분석 시작" : "입력 방식 확인"}</button>
          <div className={styles.job}>
            <h3>작업 상태{job ? ` · 작업 #${job.id}` : ""}</h3>
            <div id={id("job-status")} tabIndex={-1} role="status" className={styles.jobStatus}>
              <strong>{phaseText.label}</strong> <span>{phaseText.detail}</span>
            </div>
            {job && (job.phase === "queued" || job.phase === "running") && <button id={id("job-cancel")} type="button" className={styles.button} onClick={requestCancel}>취소 요청</button>}
            {job && (job.phase === "failed" || job.phase === "canceled") && <button id={id("job-again")} type="button" className={styles.button} onClick={again}>{job.phase === "failed" ? "같은 표본 다시 시도" : "같은 표본 다시 시작"}</button>}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby={id("result-title")}>
          <div className={styles.panelHead}>
            <h2 id={id("result-title")}>분석 결과</h2>
            {result && <span className={styles.badge}>{SAMPLES[result.sample].label} · 합성 · 작업 #{result.id}</span>}
          </div>
          {!result ? <div className={styles.empty}>
            <h3>{job?.phase === "empty" ? "확인된 근거가 없어요" : job?.phase === "failed" ? "결과를 만들지 못했어요" : job?.phase === "canceled" ? "작업이 취소됐어요" : job?.phase === "cancelRequested" ? "취소 확인을 기다리고 있어요" : state.closedPrevious ? "이전 결과를 닫았어요" : "아직 결과가 없어요"}</h3>
            <p className={styles.hint}>{job?.phase === "empty" ? "근거가 없으면 편집용 프롬프트와 위치 표시를 제공하지 않아요." : state.closedPrevious ? "새로 확인한 입력은 이 체험 화면에서 분석하지 않아요. 이전 합성 결과는 새 입력의 결과가 아니라서 닫았어요." : "합성 표본 작업이 끝나면 결과를 볼 수 있어요."}</p>
          </div> : <div className={styles.result}>
            <div role="tablist" aria-label="결과 보기" className={styles.tabs}>
              {(["evidence", "prompt"] as Tab[]).map((key) => <button key={key} type="button" role="tab" id={id(`tab-${key}`)} aria-controls={id(`panel-${key}`)} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} className={styles.button} onClick={() => setTab(key)} onKeyDown={onTabKey}>{key === "evidence" ? "근거" : "편집용 프롬프트"}</button>)}
            </div>
            <section id={id("panel-evidence")} role="tabpanel" aria-labelledby={id("tab-evidence")} tabIndex={0} hidden={tab !== "evidence"} className={styles.stack}>
              <figure className={styles.visual}>
                <svg viewBox="0 0 400 180" role="img" aria-label={`${SAMPLES[result.sample].visual}${activeEvidence ? ` · 강조 ${SAMPLES[result.sample].place}` : ""}`}>
                  {result.sample === "music"
                    ? <polyline fill="none" stroke="currentColor" strokeWidth="3" points={Array.from({ length: 81 }, (_, index) => `${index * 5},${90 + Math.sin(index * 1.1) * Math.sin(index * 0.04) * 60}`).join(" ")} />
                    : <><rect x="10" y="10" width="380" height="160" rx="8" className={styles.canvas} />
                      <rect x={result.sample === "image" ? 110 : 30} y="40" width={result.sample === "image" ? 180 : 160} height="100" className={styles.block} />
                      {result.sample === "video" && <rect x="210" y="40" width="160" height="100" className={styles.blockAlt} />}</>}
                  {activeEvidence && <rect x={SAMPLES[result.sample].mark.x * 400} y={SAMPLES[result.sample].mark.y * 180} width={SAMPLES[result.sample].mark.width * 400} height={SAMPLES[result.sample].mark.height * 180} className={styles.mark} />}
                </svg>
                <figcaption className={styles.hint}>{SAMPLES[result.sample].visual} · 합성 근거 위치 예시</figcaption>
              </figure>
              <p className={styles.position} aria-live="polite">{activeEvidence ? `${SAMPLES[result.sample].place} · 위치 표시가 바뀌었어요.` : "관찰 근거에서 위치를 고를 수 있어요."}</p>
              <article className={activeEvidence ? `${styles.finding} ${styles.selected}` : styles.finding}>
                <h3 className={styles.kind}>관찰</h3><p>{SAMPLES[result.sample].observation}</p><p className={styles.hint}>위치 {SAMPLES[result.sample].place}</p>
                <button id={id("observe")} type="button" className={styles.button} aria-pressed={activeEvidence} onClick={() => setActiveEvidence((value) => !value)}>관찰 위치 보기</button>
              </article>
              <article className={styles.finding}><h3 className={styles.kind}>파일 메타데이터</h3><p>{SAMPLES[result.sample].meta}</p></article>
              <article className={styles.finding}>
                <h3 className={styles.kind}>추정</h3><p>{SAMPLES[result.sample].guess}</p><p className={styles.hint}>다른 가능성: {SAMPLES[result.sample].alternative}</p>
                <button type="button" className={styles.button} onClick={() => { setActiveEvidence(true); focusAfterRender("observe"); }}>연결된 관찰 근거 보기</button>
              </article>
              <article className={styles.finding}><h3 className={styles.kind}>확인 불가</h3><p>{SAMPLES[result.sample].unknown}</p></article>
              <aside className={styles.quote} aria-labelledby={id("quote-title")}>
                <h3 id={id("quote-title")}>공개 문구 근거 · 별도 본문 예시</h3>
                <p>“{QUOTE}”</p>
                <p className={styles.hint}>제출자가 공개 문구로 표시한 합성 본문이에요. 위 매체 결과의 출처나 제작자 확인에 쓰지 않아요.</p>
                <button type="button" className={styles.button} aria-expanded={quoteOpen} aria-controls={id("quote-range")} onClick={() => setQuoteOpen((value) => !value)}>합성 인용 위치 보기</button>
                <p id={id("quote-range")} className={styles.position} hidden={!quoteOpen}>합성 본문 1–{QUOTE.length}번째 글자</p>
              </aside>
            </section>
            <section id={id("panel-prompt")} role="tabpanel" aria-labelledby={id("tab-prompt")} tabIndex={0} hidden={tab !== "prompt"} className={styles.stack}>
              <p className={styles.hint}>근거에서 착안한 편집 초안이에요. 원본의 제작 설정을 복원한 결과가 아니에요.</p>
              <div><label className={styles.label} htmlFor={id("tone")}>표현 방향</label>
                <select className={styles.field} id={id("tone")} value={tone} onChange={(event) => changeDraft(event.target.value as Tone)}>
                  {(Object.keys(TONES) as Tone[]).map((key) => <option key={key} value={key}>{TONES[key].label}</option>)}
                </select></div>
              <div><label className={styles.label} htmlFor={id("notes")}>내 편집 메모 · 복사 제외</label>
                <textarea className={styles.field} id={id("notes")} value={notes} placeholder="개인 메모예요. 페이지를 닫으면 사라져요." onChange={(event) => setNotes(event.target.value)} /></div>
              <div className={styles.privacy}>
                <h3>복사할 프롬프트</h3>
                <pre id={id("export")} className={styles.export} tabIndex={0}>{promptText(result.sample, tone)}</pre>
                <p className={styles.hint}>지금 보이는 문구만 복사해요. 입력 본문·URL·파일명과 편집 메모는 넣지 않아요.</p>
                <div className={styles.row}>
                  <button type="button" className={`${styles.button} ${styles.primary}`} onClick={copy}>프롬프트 복사</button>
                  <span className={styles.hint} role="status">{copyStatus}</span>
                </div>
              </div>
            </section>
          </div>}
        </section>
      </div>
    </div>
  );
}
