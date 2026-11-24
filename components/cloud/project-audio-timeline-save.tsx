"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v7 } from "uuid";
import { Button } from "@/components/ui/primitives";

type Basis = { contentRevision: number; timelineId: string | null };
type Track = { id: string; title: string };
type Attempt = { key: string; title: string; body: { assetId: string; expectedContentRevision: number; expectedTimelineId: string } };
type Saved = { timelineRevision: number; contentRevision: number; timelineId: string; clipId: string };

const reasons: Record<string, string> = {
  PRODUCE_APPROVAL_REQUIRED: "장면 제작을 승인해 주세요.",
  BASE_TIMELINE_REQUIRED: "편집 화면에서 기준 타임라인을 먼저 저장해 주세요.",
  INVALID_BASE_TIMELINE: "저장된 기준 타임라인을 확인해 주세요.",
  BASE_TIMELINE_STALE: "현재 장면과 타임라인이 달라요. 편집 화면에서 타임라인을 다시 확인해 주세요.",
  OUTPUT_LENGTH_REQUIRED: "장면을 준비해 영상 길이를 먼저 정해 주세요.",
  SOURCE_UNAVAILABLE: "선택한 음원이 프로젝트에 연결돼 있는지 다시 확인해 주세요.",
  PROJECT_MISSING: "프로젝트를 다시 열어 접근 가능한지 확인해 주세요.",
  INVALID_REQUEST: "요청을 확인할 수 없어요. 이 페이지를 다시 열어 주세요.",
  INVALID_TIMELINE: "음원을 추가한 타임라인을 저장할 수 없어요. 편집 화면에서 현재 타임라인을 확인해 주세요.",
  TIMELINE_TOO_LARGE: "타임라인 크기가 저장 한도를 초과했어요.",
  AUTH_REQUIRED: "다시 로그인해 주세요.",
};

function failureMessage(result: { code?: string; reasons?: string[]; error?: string } | null) {
  if (result?.code === "EDIT_NOT_READY" && Array.isArray(result.reasons)) {
    return result.reasons.map(reason => reasons[reason]).filter(Boolean).join(" ") || "편집 준비 상태를 다시 확인해 주세요.";
  }
  if (result?.code === "CLIP_UNAVAILABLE" && typeof result.error === "string") return result.error;
  return result?.code && reasons[result.code] || "프로젝트 저장 상태를 다시 확인해 주세요.";
}

function confirmed(result: Partial<Saved> | null): result is Saved {
  return !!result && typeof result.timelineId === "string" && typeof result.clipId === "string" &&
    Number.isSafeInteger(result.timelineRevision) && Number.isSafeInteger(result.contentRevision);
}

export function ProjectAudioTimelineSave({ projectId, basis, produceApproved }: {
  projectId: string;
  basis?: Basis;
  produceApproved: boolean;
}) {
  const router = useRouter();
  const selection = useSearchParams()?.get("track");
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}`;
  const [tracks, setTracks] = useState<Track[]>();
  const [trackError, setTrackError] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [refreshing, startRefresh] = useTransition();
  const [retry, setRetry] = useState<Attempt>();
  const [message, setMessage] = useState("");
  const [conflictBasis, setConflictBasis] = useState<Basis>();
  const [saved, setSaved] = useState<{ title: string; result: Saved }>();
  const track = tracks?.find(item => item.id === selection);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTracks() {
      try {
        const response = await fetch(`${endpoint}/audio-assets`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const { assets } = await response.json();
        if (!Array.isArray(assets)) throw new Error();
        if (!controller.signal.aborted) setTracks(assets);
      } catch {
        if (!controller.signal.aborted) setTrackError(true);
      }
    }
    void loadTracks();
    return () => controller.abort();
  }, [endpoint, listVersion]);

  function reloadTracks() {
    setTracks(undefined);
    setTrackError(false);
    setListVersion(value => value + 1);
  }

  function refreshBasis() {
    reloadTracks();
    startRefresh(() => router.refresh());
  }

  async function submit() {
    if (savingNow.current) return;
    const attempt = retry ?? (track && basis?.timelineId && produceApproved && !blocked
      ? { key: v7(), title: track.title, body: { assetId: track.id, expectedContentRevision: basis.contentRevision, expectedTimelineId: basis.timelineId } }
      : undefined);
    if (!attempt) return;
    savingNow.current = true;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/timeline/audio-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      const result = await response.json().catch(() => null);
      if (!result || response.status >= 500) throw new Error();
      if (response.ok) {
        if (!confirmed(result)) throw new Error();
        setRetry(undefined);
        setSaved({ title: attempt.title, result });
        refreshBasis();
        return;
      }
      setRetry(undefined);
      if (result.code === "CURRENT_TIMELINE_CONFLICT" || result.code === "REQUEST_CONFLICT") {
        if (result.code === "CURRENT_TIMELINE_CONFLICT") setConflictBasis({
          contentRevision: attempt.body.expectedContentRevision, timelineId: attempt.body.expectedTimelineId,
        });
        setMessage("저장 기준이 달라졌어요. 최신 상태를 확인한 뒤 다시 저장해 주세요.");
        refreshBasis();
      } else {
        setMessage(failureMessage(result));
        if (result.code === "SOURCE_UNAVAILABLE") reloadTracks();
      }
    } catch {
      setRetry(attempt);
      setMessage("저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.");
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  const stale = !!basis && conflictBasis?.contentRevision === basis.contentRevision && conflictBasis.timelineId === basis.timelineId;
  const blocked = refreshing || !basis || stale ||
    (saved && saved.result.contentRevision > basis.contentRevision);
  return <section className="stack" aria-labelledby="audio-timeline-save-heading">
    <h2 id="audio-timeline-save-heading">배경 음악 저장</h2>
    {!produceApproved && <p>{reasons.PRODUCE_APPROVAL_REQUIRED}</p>}
    {!basis ? <p>저장 기준을 불러오지 못했어요.</p>
      : !basis.timelineId && <p>{reasons.BASE_TIMELINE_REQUIRED}</p>}
    {trackError ? <p>연결된 음원을 확인하지 못했어요. <button type="button" onClick={reloadTracks}>음원 목록 다시 확인</button></p>
      : !tracks ? <p role="status">연결된 음원을 확인하는 중이에요.</p>
      : track ? <p>저장할 음원 · {track.title}</p> : selection ? <p>선택한 음원을 사용할 수 없어요.</p> : <p>위에서 저장할 음원을 선택해 주세요.</p>}
    {saved && <p role="status">{saved.title}을(를) 타임라인 r{saved.result.timelineRevision}에 저장했어요. 내용 리비전 {saved.result.contentRevision}.</p>}
    {message && <p role="alert">{message}</p>}
    {retry && <p>다시 확인할 음원 · {retry.title}</p>}
    {refreshing && <p role="status">최신 저장 기준을 확인하는 중이에요.</p>}
    {stale && !refreshing &&
      <button type="button" onClick={refreshBasis}>저장 기준 다시 확인</button>}
    <Button type="button" loading={saving} loadingLabel="저장 중" disabled={!retry && (!!blocked || !track || !basis?.timelineId || !produceApproved)}
      onClick={submit}>{retry ? "같은 저장 요청 다시 확인" : "타임라인에 배경 음악 저장"}</Button>
  </section>;
}
