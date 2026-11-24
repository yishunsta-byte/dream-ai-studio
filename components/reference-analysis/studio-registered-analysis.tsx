"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { StudioAnalysisResult } from "@/lib/reference-analysis/studio-analysis-result-dto";
import styles from "./studio-registered-analysis.module.css";
import { PromptComparison } from "./prompt-comparison";

type Selection = Readonly<{ projectId: string; assetId: string }>;
type Material = Selection & Readonly<{ label: string }>;
export type RegisteredAnalysisResult = StudioAnalysisResult;
type Ready = Extract<RegisteredAnalysisResult, { status: "ready" }>;
type Proposal = Ready["proposals"][number];
type Unavailable = Extract<RegisteredAnalysisResult, { status: "unavailable" }>["reason"];

export type RegisteredAnalysisProvider = Readonly<{
  materials: readonly Material[];
  analyze: (selection: Selection, signal: AbortSignal) => Promise<RegisteredAnalysisResult>;
}>;

type Job = {
  provider: RegisteredAnalysisProvider;
  key: string;
  controller: AbortController;
};
type View = { job: Job } & (
  | { phase: "running" | "cancelling" | "discarded" }
  | { phase: "ready"; result: Ready }
  | { phase: "unavailable"; reason: Unavailable }
);

const failureMessage: Record<Unavailable, string> = {
  invalid_selection: "선택한 자료가 유효하지 않아요. 등록 자료를 다시 선택해 주세요.",
  source_unavailable: "선택한 등록 자료에 접근할 수 없어요.",
  analysis_unavailable: "이 자료의 분석 결과를 가져오지 못했어요. 다시 시도해 주세요.",
  cancelled: "분석을 취소했어요.",
  timed_out: "분석 시간이 초과됐어요. 다시 시도해 주세요.",
};

const materialKey = (material: Selection) => JSON.stringify([material.projectId, material.assetId]);
const percent = (fraction: number) => `${(fraction * 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
const mediaLabel = { video: "영상", image: "이미지", music: "음악" };

function describeLocation(location: Proposal["observations"][number]["location"]) {
  if (location.kind === "region") {
    return `이미지 내 위치 가로 ${percent(location.x)}, 세로 ${percent(location.y)} · 너비 ${percent(location.width)}, 높이 ${percent(location.height)}`;
  }
  return location.startMs === location.endMs
    ? `${location.startMs} ms`
    : `${location.startMs}–${location.endMs} ms`;
}

function describeObservation(observation: Proposal["observations"][number]) {
  switch (observation.measure) {
    case "decoded_frame": return "디코딩된 영상 프레임";
    case "adjacent_rgb_mean_difference": return `인접 프레임의 평균 RGB 차이 ${percent(observation.score)}`;
    case "normalized_full_scale_rms": return `오디오 ${observation.channels}채널 · 최대 정규화 RMS ${percent(observation.peakRms)}`;
    case "energy_onsets": return `에너지 시작점 ${observation.timesMs.join(", ")} ms · 간격 중앙값 ${observation.medianIntervalMs} ms`;
    case "region_color_luminance": return `불투명도 반영 면적 ${percent(observation.alphaCoverage)} · 주요 색 ${observation.palette.map(({ bucket, visibleShare }) => `${bucket} ${percent(visibleShare)}`).join(", ") || "없음"} · 밝기 구간 비중 ${observation.luminanceShares.map(percent).join(" / ")}`;
  }
}

function DraftEditor({ prompt, isEdited, onEdit, id }: { prompt: string; isEdited: boolean; onEdit: (prompt: string) => void; id: string }) {
  const [message, setMessage] = useState("");
  const clipboardAttempt = useRef(0);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => () => { clipboardAttempt.current++; }, []);

  async function copyDraft() {
    const attempt = ++clipboardAttempt.current;
    setMessage("");
    try {
      await navigator.clipboard.writeText(prompt);
      if (clipboardAttempt.current === attempt) setMessage(isEdited ? "수정본을 복사했어요." : "창작 초안을 복사했어요.");
    } catch {
      if (clipboardAttempt.current === attempt) {
        draftRef.current?.focus();
        draftRef.current?.select();
        setMessage("자동 복사를 사용할 수 없어요. 선택된 문구를 직접 복사해 주세요.");
      }
    }
  }

  return <>
    <label className={styles.label} htmlFor={id}>내 수정본</label>
    <textarea className={styles.field} id={id} ref={draftRef} rows={5} value={prompt} onChange={(event) => {
      clipboardAttempt.current++;
      setMessage("");
      onEdit(event.target.value);
    }} />
    <div className={styles.actions}>
      <button className={styles.button} type="button" disabled={!prompt.trim()} onClick={copyDraft}>{isEdited ? "수정본 복사" : "초안 복사"}</button>
      <span className={styles.muted} role="status">{message}</span>
    </div>
  </>;
}

export function RegisteredAnalysisResults({ result, sourceUrl, savedDrafts }: {
  result: Ready;
  sourceUrl?: string;
  savedDrafts?: { values: Readonly<Record<number, string>>; onEdit: (index: number, prompt: string) => void };
}) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const proposal = result.proposals[index];
  if (!proposal) return <p className={styles.muted}>표시할 분석 결과가 없어요.</p>;
  const { observations, inference, draft, sourceSeek } = proposal;
  const edited = (savedDrafts?.values ?? drafts)[index] ?? draft.prompt;
  const evidenceNumbers = inference?.evidenceIds.map((finding) => observations.findIndex(({ findingId }) => findingId === finding) + 1).filter(Boolean);

  return <>
    <div className={styles.resultMeta}>
      <p className={styles.muted} role={sourceUrl ? "status" : undefined}>{mediaLabel[result.media]} 분석 · 결과 {result.proposals.length}개</p>
      {result.proposals.length > 1 && <div>
        <label className={styles.label} htmlFor={`${id}-result`}>결과 선택</label>
        <select className={styles.field} id={`${id}-result`} value={index} onChange={(event) => setIndex(Number(event.target.value))}>
          {result.proposals.map((item, itemIndex) => <option key={item.selectionId} value={itemIndex}>
            결과 {itemIndex + 1}{item.sourceSeek ? ` · ${item.sourceSeek.ptsMs} ms` : ""}{item.inference?.measure === "candidate_cut" ? " · 장면 전환 후보" : ""}
          </option>)}
        </select>
      </div>}
    </div>
    <div className={sourceUrl ? styles.evidenceGrid : styles.contents}>
    <div className={sourceUrl ? styles.evidenceColumn : styles.contents}>
    {sourceUrl && <section className={styles.findings}><h4>공개 원본</h4><a href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceUrl}</a></section>}
    <section className={styles.findings} aria-labelledby={`${id}-observed`}>
      <h4 id={`${id}-observed`}>관찰 근거</h4>
      {sourceSeek && <p className={styles.muted}>원본 프레임 표시 시각 {sourceSeek.ptsMs} ms</p>}
      <ol>
        {observations.map((observation) => <li key={observation.findingId}>
          {describeObservation(observation)} <span className={styles.detail}>{describeLocation(observation.location)}</span>
        </li>)}
      </ol>
    </section>
    <section className={styles.inference} aria-labelledby={`${id}-inferred`}>
      <h4 id={`${id}-inferred`}>분석 추정</h4>
      {inference ? <>
        <p>{inference.measure === "candidate_cut" ? "장면 전환 후보" : `추정 템포 ${inference.bpm} BPM`} <span className={styles.detail}>{describeLocation(inference.location)}</span></p>
        {!!evidenceNumbers?.length && <p className={styles.muted}>관련 관찰 근거 {evidenceNumbers.join(", ")}번</p>}
      </> : <p className={styles.muted}>이 결과에 포함된 추정이 없어요.</p>}
    </section>
    </div>
    <section className={styles.draft} aria-labelledby={`${id}-draft`}>
      <h4 id={`${id}-draft`}>창작 초안</h4>
      {draft.target === "cut" && draft.editGridApproximation && <p className={styles.muted}>편집 그리드 기준 약 {draft.editGridApproximation.frame}프레임 · {draft.editGridApproximation.fps} fps</p>}
      <DraftEditor key={index} id={`${id}-prompt`} prompt={edited} isEdited={edited !== draft.prompt} onEdit={(prompt) => {
        if (savedDrafts) savedDrafts.onEdit(index, prompt);
        else setDrafts((previous) => ({ ...previous, [index]: prompt }));
      }} />
      <PromptComparison original={draft.prompt} edited={edited} />
    </section>
    </div>
  </>;
}

/**
 * requireRightsConfirmation: 보호 목록 격리 연결에서만 켠다. 선택한 자료마다 사용 권리를 명시적으로 확인해야 분석을 요청한다.
 * 확인은 그 공급자·그 선택에만 묶이고, 선택·목록(공급자)이 바뀌거나 해제하면 진행 중 요청을 취소하고 결과를 지운다.
 * 기본값(꺼짐)이면 기존 호출자의 동작은 그대로다.
 */
export function StudioRegisteredAnalysis({ provider, requireRightsConfirmation = false }: {
  provider?: RegisteredAnalysisProvider; requireRightsConfirmation?: boolean;
}) {
  const id = useId();
  const [selection, setSelection] = useState<{ provider: RegisteredAnalysisProvider; key: string }>();
  const [view, setView] = useState<View>();
  const [rights, setRights] = useState<{ provider: RegisteredAnalysisProvider; key: string }>();
  const [resultVersion, setResultVersion] = useState(0);
  const activeJob = useRef<Job | null>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef<Job | null>(null);
  const materials = provider?.materials ?? [];
  const keys = materials.map(materialKey);
  const selectedIndex = provider === selection?.provider && selection ? keys.indexOf(selection.key) : -1;
  if (selection && selectedIndex < 0) {
    setSelection(undefined);
    setView(undefined);
  }
  const key = keys[selectedIndex];
  const confirmed = !requireRightsConfirmation || (selectedIndex >= 0 && rights?.provider === provider && rights?.key === key);
  const current = confirmed && view?.job.provider === provider && view?.job.key === key ? view : undefined;
  const busy = current?.phase === "running" || current?.phase === "cancelling";

  useLayoutEffect(() => () => {
    const job = activeJob.current;
    if (job && job.provider === provider && job.key === key) {
      activeJob.current = null;
      job.controller.abort();
    }
  }, [provider, key]);

  useLayoutEffect(() => {
    if (current?.phase === "running" && document.activeElement === runRef.current) cancelRef.current?.focus();
    if (current?.phase === "cancelling" && document.activeElement === cancelRef.current) statusRef.current?.focus();
    if (!current || busy || restoreFocus.current !== current.job) return;
    restoreFocus.current = null;
    if (current.phase === "ready") resultRef.current?.focus();
    else runRef.current?.focus();
  }, [busy, current]);

  function changeSelection(index: number) {
    const job = activeJob.current;
    activeJob.current = null;
    job?.controller.abort();
    setView(undefined);
    setRights(undefined);
    setSelection(provider && keys[index] !== undefined ? { provider, key: keys[index] } : undefined);
  }

  function changeRights(checked: boolean) {
    // 해제하면 진행 중 요청을 취소하고 결과를 지운다. 늦게 온 응답은 activeJob 비교로 버려진다.
    const job = activeJob.current;
    activeJob.current = null;
    job?.controller.abort();
    setView(undefined);
    setRights(checked && provider && selectedIndex >= 0 ? { provider, key } : undefined);
  }

  async function run() {
    if (!provider || selectedIndex < 0 || !confirmed || activeJob.current) return;
    const { projectId, assetId } = materials[selectedIndex];
    const job = { provider, key, controller: new AbortController() };
    activeJob.current = job;
    setView({ job, phase: "running" });
    let result: RegisteredAnalysisResult;
    try {
      result = await provider.analyze({ projectId, assetId }, job.controller.signal);
    } catch {
      result = { schemaVersion: 1, status: "unavailable", reason: "analysis_unavailable" };
    }
    if (activeJob.current !== job) return;
    activeJob.current = null;
    if (document.activeElement === cancelRef.current || document.activeElement === statusRef.current) restoreFocus.current = job;
    if (job.controller.signal.aborted && !(result.status === "unavailable" && result.reason === "cancelled")) {
      setView({ job, phase: "discarded" });
    } else if (result.status === "ready") {
      setResultVersion((version) => version + 1);
      setView({ job, phase: "ready", result });
    } else {
      setView({ job, phase: "unavailable", reason: result.reason });
    }
  }

  function cancel() {
    const job = activeJob.current;
    if (!job || job.controller.signal.aborted) return;
    setView({ job, phase: "cancelling" });
    job.controller.abort();
  }

  let notice = "분석할 등록 자료를 선택해 주세요.";
  if (!provider) notice = "등록 자료 분석 공급자가 아직 연결되지 않았어요.";
  else if (!materials.length) notice = "분석할 수 있는 등록 자료가 없어요.";
  else if (current?.phase === "running") notice = "등록 자료를 분석하고 있어요.";
  else if (current?.phase === "cancelling") notice = "취소를 요청했어요. 응답을 기다리고 있어요.";
  else if (current?.phase === "discarded") notice = "취소 완료를 확인할 수 없어 결과를 표시하지 않았어요.";
  else if (current?.phase === "unavailable") notice = failureMessage[current.reason];
  else if (current?.phase === "ready") notice = "분석이 완료됐어요.";
  else if (selectedIndex >= 0 && !confirmed) notice = "이 자료를 분석할 권리가 있는지 확인해 주세요.";
  else if (selectedIndex >= 0) notice = "선택한 자료를 분석할 수 있어요.";

  return <section className={styles.analysis} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>등록 자료 분석</h2>
    <div className={styles.layout}>
      <section className={styles.panel} aria-labelledby={`${id}-selection`}>
        <h3 id={`${id}-selection`}>분석 자료</h3>
        <div>
          <label className={styles.label} htmlFor={`${id}-material`}>등록 자료 선택</label>
          <select className={styles.field} id={`${id}-material`} disabled={!materials.length} aria-describedby={`${id}-status`}
            value={selectedIndex < 0 ? "" : selectedIndex} onChange={(event) => changeSelection(event.target.value === "" ? -1 : Number(event.target.value))}>
            <option value="">등록 자료를 선택하세요</option>
            {materials.map((material, index) => <option key={keys[index]} value={index}>{material.label}</option>)}
          </select>
        </div>
        {requireRightsConfirmation && <label className={styles.label} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", minHeight: "var(--touch-min)" }}>
          <input type="checkbox" checked={confirmed && selectedIndex >= 0} disabled={selectedIndex < 0} aria-describedby={`${id}-status`}
            style={{ width: 20, height: 20 }} onChange={(event) => changeRights(event.target.checked)} />
          이 자료를 분석할 권리가 있어요.
        </label>}
        <div className={styles.actions}>
          <button className={`${styles.button} ${styles.primary}`} type="button" ref={runRef} disabled={selectedIndex < 0 || !confirmed} aria-disabled={busy || undefined} onClick={run}>
            {current && !busy ? "다시 분석" : "분석 실행"}
          </button>
          {busy && <button className={styles.button} type="button" ref={cancelRef} aria-disabled={current.phase === "cancelling" || undefined} onClick={cancel}>분석 취소</button>}
        </div>
        <p className={styles.notice} id={`${id}-status`} ref={statusRef} tabIndex={-1} role="status">{notice}</p>
      </section>
      <section className={styles.panel} aria-labelledby={`${id}-output`} aria-busy={busy}>
        <h3 id={`${id}-output`} ref={resultRef} tabIndex={-1}>분석 결과</h3>
        {current?.phase === "ready"
          ? <RegisteredAnalysisResults key={resultVersion} result={current.result} />
          : <p className={styles.muted}>분석이 완료되면 관찰 근거와 편집할 수 있는 창작 초안을 볼 수 있어요.</p>}
      </section>
    </div>
  </section>;
}
