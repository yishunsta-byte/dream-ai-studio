"use client";

import { AdminShortsAnalysis } from "@/components/admin/admin-shorts-analysis";
import { ShortsSourceAnalyze } from "../shorts-source-steps/shorts-source-analyze";
import { ShortsSourceSearch } from "../shorts-source-steps/shorts-source-search";
import { picksKey, type ShortsSourcePick } from "../shorts-source-steps/source-step-data";
import type { ShortsStepProps } from "./shorts-step-types";
import s from "./shorts-studio.module.css";

// P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: 셸이 고른 영상 목록(picks)을 주면 그대로, 아니면 예전 pick 하나로 본다.
const chosen = ({ pick, picks }: Pick<ShortsStepProps, "pick" | "picks">): readonly ShortsSourcePick[] => picks ?? (pick ? [pick] : []);

export function ShortsSearchStep({ pick, picks, onPick, onPicks, goTo, settingsHref, sourceSnapshot, onSourceSnapshot }: ShortsStepProps) {
  const update = (next: ShortsSourcePick[]) => { if (onPicks) onPicks(next); else onPick(next[0] ?? null); };
  return <ShortsSourceSearch picked={chosen({ pick, picks })} onPick={update} initialSnapshot={sourceSnapshot} onSnapshot={onSourceSnapshot}
    settingsHref={settingsHref} onAnalyze={next => { update(next); goTo("analyze"); }} />;
}

export function ShortsAnalyzeStep({ pick, picks, goTo, settingsHref, work, sourceAnalysis, onSourceAnalysis, sourceMulti, onSourceMulti }: ShortsStepProps) {
  const targets = chosen({ pick, picks });
  // 묶음(영상과 순서)이 바뀌면 새로 그린다: 진행 중 요청은 끊기고 동의도 새로 받는다.
  // 단건 성공만 ③ 소재 단계(work.setAnalysis)로 넘긴다. 묶음 결과는 셸 메모리(onSourceMulti)에만 둔다.
  if (targets.length) return <ShortsSourceAnalyze key={picksKey(targets)} picks={targets} initialAnalysis={sourceAnalysis} initialMulti={sourceMulti}
    settingsHref={settingsHref} onBack={() => goTo("search")} onNext={() => goTo("ideate")} onMultiResult={onSourceMulti} onResult={analysis => {
      onSourceAnalysis?.(analysis);
      work.setAnalysis(analysis.videoId, analysis.result, targets[0].query);
    }} />;

  return <div className={s.stepStack}>
    {!work.session.context && <p className={s.pickNote}>공개 YouTube 쇼츠 주소를 넣거나 <button type="button" className={s.inlineLink} onClick={() => goTo("search")}>① 쇼츠 떡상 검색</button>에서 영상을 골라 주세요.</p>}
    <AdminShortsAnalysis settingsHref={settingsHref} steps={false} onResult={({ videoId, result }) => work.setAnalysis(videoId, result)} />
    {work.session.context && <div className={s.nextBar} role="status">
      <p className={s.nextText}>분석한 영상 · <strong>{work.session.context.videoId}</strong> · 이 결과로 새 소재를 만들어요.</p>
      <button type="button" className={s.primary} onClick={() => goTo("ideate")}>💡 킬러 소재 발굴로</button>
    </div>}
  </div>;
}
