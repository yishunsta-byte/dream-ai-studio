"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { Button } from "@/components/ui/primitives";

// 첫 편집 타임라인 저장(POST /api/projects/{id}/timeline/initial, 42314b4).
// 계약: docs/handoffs/FIRST-WORK-PG-INITIAL-TIMELINE.md. 제작 승인과 장면 결과 선택이 끝난 프로젝트에서
// 사용자가 직접 한 번 저장한다. 장면 준비 여부는 상세 응답에 없으므로 서버가 돌려준 사유를 그대로 안내한다.
type Basis = { contentRevision: number; timelineId: string | null };
type Attempt = { key: string; body: { expectedContentRevision: number; expectedTimelineId: null } };
type Saved = { timelineId: string; timelineRevision: number; contentRevision: number };
type Outcome = { tone: "status" | "alert"; text: string };

const reasons: Record<string, string> = {
  PRODUCE_APPROVAL_REQUIRED: "장면 제작을 먼저 승인해 주세요.",
  SCENE_RESULTS_REQUIRED: "모든 장면에 검토를 마친 이미지나 영상 결과를 선택해 주세요. 다시 검토할 장면이나 보관한 결과가 있으면 저장할 수 없어요.",
  BASE_TIMELINE_STALE: "저장하는 동안 장면 결과가 바뀌었어요. 최신 상태를 확인한 뒤 다시 저장해 주세요.",
  INVALID_TIMELINE: "선택한 장면 결과로 타임라인을 만들 수 없어요. 장면 길이와 결과를 확인해 주세요.",
  TIMELINE_TOO_LARGE: "타임라인 크기가 저장 한도를 넘었어요.",
  PROJECT_MISSING: "프로젝트를 다시 열어 접근할 수 있는지 확인해 주세요.",
  INVALID_REQUEST: "요청을 확인할 수 없어요. 이 페이지를 다시 열어 주세요.",
  TIMELINE_UNAVAILABLE: "이 환경에서는 타임라인을 저장할 수 없어요.",
  AUTH_REQUIRED: "다시 로그인해 주세요.",
};

function failureMessage(result: { code?: string; reasons?: string[] }) {
  if (result.code === "EDIT_NOT_READY" && Array.isArray(result.reasons)) {
    return result.reasons.map(reason => reasons[reason]).filter(Boolean).join(" ") || "편집 준비 상태를 다시 확인해 주세요.";
  }
  return (result.code && reasons[result.code]) || "프로젝트 저장 상태를 다시 확인해 주세요.";
}

function confirmed(result: Partial<Saved> | null): result is Saved {
  return !!result && typeof result.timelineId === "string" &&
    Number.isSafeInteger(result.timelineRevision) && Number.isSafeInteger(result.contentRevision);
}

export function ProjectInitialTimelineSave({ projectId, basis, produceApproved }: {
  projectId: string;
  basis?: Basis;
  produceApproved: boolean;
}) {
  const router = useRouter();
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/timeline/initial`;
  const root = useRef<HTMLElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const savingNow = useRef(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [retry, setRetry] = useState<Attempt>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [conflictBasis, setConflictBasis] = useState<Basis>();
  const [saved, setSaved] = useState<Saved>();
  const [focusOutcome, setFocusOutcome] = useState(0);

  // 저장 중에는 버튼이 비활성으로 바뀌어 초점이 사라지므로, 결과 문구가 그려지면 그 문구로 초점을 옮긴다.
  useEffect(() => {
    if (focusOutcome) outcomeRef.current?.focus();
  }, [focusOutcome]);

  function refreshBasis() {
    startRefresh(() => router.refresh());
  }

  function finish(next: Outcome) {
    setOutcome(next);
    setFocusOutcome(value => value + 1);
  }

  const stale = !!basis && conflictBasis?.contentRevision === basis.contentRevision && conflictBasis.timelineId === basis.timelineId;
  const alreadySaved = !!basis?.timelineId;
  const ready = !!basis && !alreadySaved && produceApproved && !stale && !refreshing && !saved;

  async function submit() {
    if (savingNow.current) return;
    const attempt = retry ?? (ready && basis
      ? { key: v7(), body: { expectedContentRevision: basis.contentRevision, expectedTimelineId: null } }
      : undefined);
    if (!attempt) return;
    savingNow.current = true;
    root.current?.focus();
    setSaving(true);
    setOutcome(undefined);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      const result = await response.json().catch(() => null);
      if (result?.code === "TIMELINE_UNAVAILABLE" || result?.code === "AUTH_REQUIRED") {
        setRetry(undefined);
        finish({ tone: "alert", text: failureMessage(result) });
        return;
      }
      if (!result || response.status >= 500) throw new Error();
      if (response.ok) {
        if (!confirmed(result)) throw new Error();
        setRetry(undefined);
        setSaved(result);
        finish({ tone: "status", text: `첫 타임라인을 r${result.timelineRevision}로 저장했어요. 내용 리비전 ${result.contentRevision}.` });
        refreshBasis();
        return;
      }
      setRetry(undefined);
      if (result.code === "CURRENT_TIMELINE_CONFLICT" || result.code === "REQUEST_CONFLICT") {
        // 같은 기준으로는 다시 보내지 않는다. 최신 상세를 읽어 기준이 바뀐 뒤에만 다시 저장할 수 있다.
        setConflictBasis({ contentRevision: attempt.body.expectedContentRevision, timelineId: null });
        finish({ tone: "alert", text: "다른 곳에서 먼저 저장했거나 저장 기준이 달라졌어요. 최신 상태를 확인해 주세요." });
        refreshBasis();
      } else {
        // 장면 변경(BASE_TIMELINE_STALE)은 내용 리비전이 그대로일 수 있어 기준 잠금 없이 새 요청을 허용한다.
        finish({ tone: "alert", text: failureMessage(result) });
      }
    } catch {
      setRetry(attempt);
      finish({ tone: "alert", text: "저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요." });
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  return <section ref={root} tabIndex={-1} className="stack" aria-labelledby="initial-timeline-heading">
    <h2 id="initial-timeline-heading">첫 타임라인 저장</h2>
    {!basis ? <p>저장 기준을 불러오지 못했어요. 페이지를 다시 열어 주세요.</p>
      : alreadySaved && !saved ? <p>기준 타임라인이 이미 저장돼 있어요. 아래에서 배경 음악을 저장할 수 있어요.</p>
      : !saved && <>
        <p>선택한 장면 결과를 순서대로 이어 첫 편집 타임라인을 저장해요. 한 번만 저장할 수 있어요.</p>
        {!produceApproved && <p>{reasons.PRODUCE_APPROVAL_REQUIRED}</p>}
      </>}
    {outcome && <p ref={outcomeRef} tabIndex={-1} role={outcome.tone}>{outcome.text}</p>}
    {refreshing && <p role="status">최신 저장 기준을 확인하는 중이에요.</p>}
    {stale && !refreshing && <button type="button" onClick={refreshBasis}>저장 기준 다시 확인</button>}
    {(retry || (!alreadySaved && !saved && basis)) &&
      <Button type="button" loading={saving} loadingLabel="저장 중" disabled={!retry && !ready} onClick={submit}>
        {retry ? "같은 저장 요청 다시 확인" : "첫 타임라인 저장"}
      </Button>}
  </section>;
}
