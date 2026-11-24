"use client";
// T272 프로젝트 적용 미리보기 탭. 서버 전용 미리보기 계약이 고정 합성 입력에 낸 허용 출력(project-preview-sample)만 보여 준다.
// 이 화면은 소유자·리비전·만료를 판정하지 않고, 프로젝트·타임라인에 쓰지 않으며, 실제 재생기를 연결하지 않는다.
import { useState } from "react";
import { luminanceSummary, secondsText } from "./lab-model";
import type { ProjectProposal } from "./project-preview-sample";
import styles from "./reference-analysis-lab.module.css";

type Observation = ProjectProposal["observations"][number];
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function proposalLabel(item: ProjectProposal) {
  const first = item.observations[0];
  if (item.inference?.measure === "candidate_cut") return `컷 후보 · ${secondsText(item.inference.location.startMs)} → ${secondsText(item.inference.location.endMs)}`;
  if (first.measure === "decoded_frame") return `관찰 프레임 · ${secondsText(first.location.startMs)}`;
  if (first.measure === "normalized_full_scale_rms") return `음량 · ${secondsText(first.location.startMs)}–${secondsText(first.location.endMs)}`;
  if (first.measure === "energy_onsets") return `소리 시작점 · ${first.timesMs.length}곳`;
  if (first.measure !== "region_color_luminance") return "관찰";
  const { x, y, width, height } = first.location;
  return x === 0 && y === 0 && width === 1 && height === 1 ? "색·명도 · 화면 전체" : `색·명도 · 왼쪽 ${percent(x)} 위 ${percent(y)} 영역`;
}

function observationText(item: Observation) {
  switch (item.measure) {
    case "decoded_frame": return `${secondsText(item.location.startMs)}에 디코딩된 프레임을 확인했어요.`;
    case "adjacent_rgb_mean_difference": return `${secondsText(item.location.startMs)}와 ${secondsText(item.location.endMs)} 사이 색 변화량 ${item.score.toFixed(2)}.`;
    case "normalized_full_scale_rms": return `${secondsText(item.location.startMs)}–${secondsText(item.location.endMs)} · ${item.channels}채널 · 최대 정규화 RMS ${item.peakRms.toFixed(2)}.`;
    case "energy_onsets": return `소리 시작점 ${item.timesMs.length}곳 · 간격 중앙값 ${item.medianIntervalMs}ms.`;
    case "region_color_luminance": {
      const { x, y, width, height } = item.location;
      const colors = item.palette.map((color) => `${color.bucket} ${percent(color.visibleShare)}`).join(", ");
      const luminance = luminanceSummary(item.luminanceShares, item.luminanceEdges);
      return `왼쪽 ${percent(x)}·위 ${percent(y)}·너비 ${percent(width)}·높이 ${percent(height)} · 보이는 비율 ${percent(item.alphaCoverage)} · 색 ${colors} · 대표 ${luminance.dominant} (상대 명도 비중 ${luminance.all}).`;
    }
  }
}

const TARGET_LABEL = { cut: "컷 구성", image: "이미지", music: "음악" } as const;

export function ProjectPreviewPanel({ idPrefix, proposals, picked, durationMs, onToggle, onCopy, copyStatus, copyText }: {
  idPrefix: string; proposals: readonly ProjectProposal[]; picked: readonly string[]; durationMs?: number;
  onToggle: (selectionId: string) => void; onCopy: () => void; copyStatus: string; copyText: string;
}) {
  const [seekShown, setSeekShown] = useState<string | null>(null);
  const id = (name: string) => `${idPrefix}-${name}`;
  const byId = new Map(proposals.map((item) => [item.selectionId, item]));
  const chosen = picked.map((key) => byId.get(key)).filter((item): item is ProjectProposal => !!item);
  const shown = chosen.find((item) => item.selectionId === seekShown && item.media === "video");

  return <div className={styles.stack}>
    <p className={styles.hint}>합성 고정 입력을 서버 미리보기 계약에 넣어 얻은 허용 결과예요. 미리보기 전용이라 프로젝트·타임라인에 쓰지 않고, 이 화면에서 소유자나 버전을 확인하지 않아요.</p>
    <fieldset className={styles.picks}>
      <legend className={styles.label}>미리볼 근거 · 고른 순서대로 보여요</legend>
      {proposals.map((item) => <label key={item.selectionId} className={styles.check}>
        <input type="checkbox" checked={picked.includes(item.selectionId)} onChange={() => onToggle(item.selectionId)} /> {proposalLabel(item)}
      </label>)}
    </fieldset>

    {!chosen.length ? <p className={styles.position} role="note">근거를 하나 이상 고르면 미리보기가 나와요. 고른 근거가 없으면 미리보기를 만들지 않아요.</p> : <>
      {durationMs !== undefined && chosen.some((item) => item.media === "video") && <figure className={styles.visual}>
        <svg viewBox="0 0 400 48" role="img" aria-label={shown?.media === "video" ? `원본 위치 ${secondsText(shown.sourceSeek.ptsMs)} 표시` : "원본 위치 표시 막대"}>
          <rect x="0" y="18" width="400" height="12" rx="6" className={styles.canvas} />
          {shown?.media === "video" && <rect x={Math.min(396, (shown.sourceSeek.ptsMs / durationMs) * 400)} y="6" width="4" height="36" className={styles.seek} />}
        </svg>
        <figcaption className={styles.hint}>합성 표본 0–{secondsText(durationMs)} 위치 막대 · 실제 재생기는 연결하지 않았어요</figcaption>
      </figure>}
      {chosen.some((item) => item.media === "video") && <p className={styles.position} aria-live="polite">{shown?.media === "video" ? `원본 위치 ${secondsText(shown.sourceSeek.ptsMs)}를 표시했어요. 관찰 프레임에서 확인한 시각이에요.` : "영상 근거의 원본 위치 보기를 누르면 막대에 표시돼요."}</p>}
      <ol className={styles.proposals}>
        {chosen.map((item) => <li key={item.selectionId} className={styles.finding}>
          <h3>{proposalLabel(item)} · {TARGET_LABEL[item.draft.target]}</h3>
          <div><h4 className={styles.kind}>관찰</h4><ul>{item.observations.map((observation) => <li key={observation.findingId}>{observationText(observation)}</li>)}</ul></div>
          {item.inference && <div><h4 className={styles.kind}>추정</h4><p>{item.inference.measure === "candidate_cut" ? "이 구간에서 컷이 바뀌었을 수 있어요." : `템포가 약 ${item.inference.bpm} BPM일 수 있어요.`} <span className={styles.hint}>근거 {item.inference.evidenceIds.length}개 연결</span></p></div>}
          <div><h4 className={styles.kind}>제안</h4><p>{item.draft.prompt}</p>
            {item.draft.target === "cut" && item.draft.transition && <p className={styles.hint}>연결 방식: 바로 이어 붙이기(전환 0프레임)</p>}</div>
          {item.media === "video" && <div className={styles.seekBox}>
            <p><strong>원본 탐색</strong> {secondsText(item.sourceSeek.ptsMs)} · 관찰 프레임 기준</p>
            <button type="button" className={styles.button} aria-pressed={seekShown === item.selectionId} onClick={() => setSeekShown((value) => value === item.selectionId ? null : item.selectionId)}>원본 위치 보기</button>
            {item.draft.target === "cut" && item.draft.editGridApproximation && <p className={styles.hint}><strong>편집 격자 근사</strong> {item.draft.editGridApproximation.fps}fps 기준 {item.draft.editGridApproximation.frame}번 프레임 · 편집용 제안이라 원본 위치와 다를 수 있어요.</p>}
          </div>}
        </li>)}
      </ol>
      <div className={styles.privacy}>
        <h3>복사할 프로젝트 프롬프트</h3>
        <pre id={id("project-export")} className={styles.export} tabIndex={0}>{copyText}</pre>
        <p className={styles.hint}>고른 순서대로 제안 문장만 복사해요. 관찰 수치·근거 번호·원본 위치는 넣지 않아요.</p>
        <div className={styles.row}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onCopy}>프로젝트 프롬프트 복사</button>
          <span className={styles.hint} role="status">{copyStatus}</span>
        </div>
      </div>
    </>}
  </div>;
}
