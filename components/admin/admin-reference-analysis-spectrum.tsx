import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { PromptComparison } from "@/components/reference-analysis/prompt-comparison";
import { MEDIA_LABEL, type ReadyResult } from "./admin-reference-analysis-model";
import styles from "./admin-reference-analysis.module.css";

type Proposal = ReadyResult["proposals"][number];
type Observation = Proposal["observations"][number];
const percentage = new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 2 });

function locationLabel(location: Observation["location"]) {
  if (location.kind === "region") {
    const { x, y, width, height } = location;
    return `왼쪽 ${percentage.format(x)} · 위 ${percentage.format(y)} · 너비 ${percentage.format(width)} · 높이 ${percentage.format(height)}`;
  }
  return location.startMs === location.endMs ? `${location.startMs} ms` : `${location.startMs}–${location.endMs} ms`;
}

function Measurement({ observation }: { observation: Observation }) {
  switch (observation.measure) {
    case "decoded_frame": return <strong>디코딩된 영상 프레임</strong>;
    case "adjacent_rgb_mean_difference":
      return <strong>인접 프레임 평균 RGB 차이 {percentage.format(observation.score)}</strong>;
    case "normalized_full_scale_rms": return <>
      <strong>오디오 {observation.channels}채널 · 최대 정규화 RMS {percentage.format(observation.peakRms)}</strong>
      <meter min={0} max={1} value={observation.peakRms} aria-label="최대 정규화 RMS" />
    </>;
    case "energy_onsets": {
      const { startMs, endMs } = observation.location;
      const points = [...new Set(observation.timesMs)].filter((time) => time >= startMs && time <= endMs);
      return <>
        <strong>에너지 시작점</strong>
        {endMs > startMs && points.length > 0 && <div className={styles.onsets} aria-hidden="true">
          {points.map((time) => <span key={time} style={{ left: percentage.format((time - startMs) / (endMs - startMs)) }} />)}
        </div>}
        <p>{observation.timesMs.join(", ")} ms · 간격 중앙값 {observation.medianIntervalMs} ms</p>
      </>;
    }
    case "region_color_luminance": return <>
      <strong>불투명도 반영 면적 {percentage.format(observation.alphaCoverage)}</strong>
      <ul className={styles.palette} aria-label="주요 색">
        {observation.palette.map(({ bucket, visibleShare }, index) => <li key={`${bucket}-${index}`}>
          <span aria-hidden="true" style={{ backgroundColor: bucket }} />
          {bucket} · {percentage.format(visibleShare)}
        </li>)}
      </ul>
      <p>밝기 구간 비중</p>
      <ul className={styles.levels}>
        {observation.luminanceShares.map((share, index) => {
          const range = `${percentage.format(observation.luminanceEdges[index])}–${percentage.format(observation.luminanceEdges[index + 1])}`;
          return <li key={index}><span>{range} · {percentage.format(share)}</span>
            <meter min={0} max={1} value={share} aria-label={`밝기 ${range} 구간의 비중`} />
          </li>;
        })}
      </ul>
    </>;
  }
}

function PromptEditor({ proposal, value, onEdit }: { proposal: Proposal; value: string; onEdit: (value: string) => void }) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef(0);
  const [notice, setNotice] = useState("");
  useLayoutEffect(() => () => { attempt.current++; }, []);
  const changed = value !== proposal.draft.prompt;

  async function copy() {
    const mine = ++attempt.current;
    setNotice("");
    try {
      await navigator.clipboard.writeText(value);
      if (mine === attempt.current) setNotice(changed ? "수정본을 복사했어요." : "창작 초안을 복사했어요.");
    } catch {
      if (mine !== attempt.current) return;
      textarea.current?.focus();
      textarea.current?.select();
      setNotice("자동 복사를 사용할 수 없어요. 선택된 문구를 직접 복사해 주세요.");
    }
  }

  return <div className={styles.promptEditor}>
    {proposal.draft.target === "cut" && proposal.draft.editGridApproximation && <p className={styles.note}>
      편집 그리드 기준 약 {proposal.draft.editGridApproximation.frame}프레임 · {proposal.draft.editGridApproximation.fps} fps
    </p>}
    <label className={styles.field} htmlFor={id}>내 수정본
      <textarea ref={textarea} id={id} rows={5} value={value} onChange={(event) => {
        attempt.current++;
        setNotice("");
        onEdit(event.target.value);
      }} />
    </label>
    <div className={styles.actions}>
      <Button variant="secondary" onClick={copy} disabled={!value.trim()}>{changed ? "수정본 복사" : "초안 복사"}</Button>
    </div>
    <p className={styles.status} role="status">{notice}</p>
    <PromptComparison original={proposal.draft.prompt} edited={value} />
  </div>;
}

export function SpectrumResults({ result }: { result: ReadyResult }) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"evidence" | "prompt">("evidence");
  const [drafts, setDrafts] = useState(() => new Map<string, string>());
  const proposal = result.proposals[index];
  const { observations, inference, sourceSeek } = proposal;
  const evidenceNumbers = inference?.evidenceIds.map((id) => observations.findIndex(({ findingId }) => findingId === id) + 1).filter(Boolean);

  return <>
    <div className={styles.resultMeta}>
      <p className={styles.note}>{MEDIA_LABEL[result.media]} 분석 · 결과 {result.proposals.length}개</p>
      {result.proposals.length > 1 && <label className={styles.field} htmlFor={`${id}-result`}>결과 선택
        <select id={`${id}-result`} value={index} onChange={(event) => setIndex(Number(event.target.value))}>
          {result.proposals.map((item, itemIndex) => <option key={item.selectionId} value={itemIndex}>
            결과 {itemIndex + 1}{item.sourceSeek ? ` · ${item.sourceSeek.ptsMs} ms` : ""}
          </option>)}
        </select>
      </label>}
    </div>
    <div className={styles.switches} role="group" aria-label="결과 보기">
      <button type="button" aria-pressed={view === "evidence"} aria-controls={`${id}-evidence`} onClick={() => setView("evidence")}>관찰 근거</button>
      <button type="button" aria-pressed={view === "prompt"} aria-controls={`${id}-prompt`} onClick={() => setView("prompt")}>생성 프롬프트</button>
    </div>
    <div id={`${id}-evidence`} hidden={view !== "evidence"}>
      {sourceSeek && <p className={styles.note}>원본 프레임 표시 시각 {sourceSeek.ptsMs} ms</p>}
      <ol className={styles.observations}>
        {observations.map((observation) => <li key={observation.findingId}>
          <span className={styles.measureRange}>{locationLabel(observation.location)}</span>
          <div className={styles.measureValue}><Measurement observation={observation} /></div>
        </li>)}
      </ol>
      {inference && <div className={styles.inference}>
        <h4>분석 추정</h4>
        <p>{inference.measure === "estimated_bpm" ? `추정 템포 ${inference.bpm} BPM` : "장면 전환 후보"} · {locationLabel(inference.location)}</p>
        {!!evidenceNumbers?.length && <p className={styles.note}>관련 관찰 근거 {evidenceNumbers.join(", ")}번</p>}
      </div>}
    </div>
    <div id={`${id}-prompt`} hidden={view !== "prompt"}>
      {view === "prompt" && <PromptEditor key={proposal.selectionId} proposal={proposal}
        value={drafts.get(proposal.selectionId) ?? proposal.draft.prompt}
        onEdit={(value) => setDrafts((previous) => new Map(previous).set(proposal.selectionId, value))} />}
    </div>
  </>;
}
