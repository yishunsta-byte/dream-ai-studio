import type { ShortsView } from "./shorts-paths";
import type { ShortsWork } from "./shorts-work";
import type { ShortsSourceAnalysis, ShortsSourceMultiAnalysis, ShortsSourcePick, ShortsSourceSnapshot } from "../shorts-source-steps/source-step-data";

// P1-08 원본 쇼츠 전용 화면에서 단계 화면 하나가 셸에게서 받는 값.
// 셸(ShortsStudio)이 이 값을 들고 단계 사이를 옮긴다. 단계 화면을 새로 붙일 때(Backend ③~⑥·보관함)도 같은 모양을 쓴다.

export type ShortsStepProps = {
  /** 지금까지 고른 첫 영상(없으면 null). ③ 검색어 기본값·홈 이어서 작업하기가 쓴다. */
  pick: ShortsSourcePick | null;
  /** 영상 하나로 바꾸거나(값) 모두 해제(null)할 때 셸에 알린다(요청·저장 없음). */
  onPick: (value: ShortsSourcePick | null) => void;
  /** P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: 고른 영상 전체(고른 순서, 최대 3개). 없으면 pick 하나로 본다. */
  picks?: readonly ShortsSourcePick[];
  /** ① 검색에서 고른 영상 목록이 바뀌었을 때 셸에 알린다. 없으면 첫 영상만 onPick으로 알린다. */
  onPicks?: (value: ShortsSourcePick[]) => void;
  sourceSnapshot?: ShortsSourceSnapshot | null;
  onSourceSnapshot?: (value: ShortsSourceSnapshot) => void;
  sourceAnalysis?: ShortsSourceAnalysis | null;
  onSourceAnalysis?: (value: ShortsSourceAnalysis) => void;
  /** ② 묶음 분석(영상 2~3개) 결과. 셸 메모리에만 있고 ④·보관함·프로젝트로 넘기지 않는다. */
  sourceMulti?: ShortsSourceMultiAnalysis | null;
  onSourceMulti?: (value: ShortsSourceMultiAnalysis) => void;
  /** F6: 지금 단건 근거(work.session.context)보다 나중에 끝난 묶음 분석. 있으면 ③은 옛 단건 근거로 소재를 만들거나 저장하지 않는다. */
  newerMulti?: ShortsSourceMultiAnalysis | null;
  /** 다른 단계·홈·보관함으로 옮긴다(같은 주소 안, 요청 없음). */
  goTo: (view: ShortsView) => void;
  /** 미설정 안내의 설정 링크(관리자 허브 API키등록). */
  settingsHref: string;
  /** ②~⑥ 작업 상태와 저장(P1-08-SHORTS-STEPS). 단계 화면은 이 값으로 앞 단계 결과를 읽고 다음 단계로 넘긴다. */
  work: ShortsWork;
};
