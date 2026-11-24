"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 } from "uuid";
import { Button } from "@/components/ui/primitives";

// 로컬 PG 렌더 요청(8117f19)·수동 실행(d67a9d3, 2b892d9부터 PNG 1~2장 하드컷)·현재 버전 MP4 받기.
// 계약: docs/handoffs/FIRST-WORK-PG-RENDER-REQUEST.md, FIRST-WORK-PG-RENDER-EXECUTION.md.
type Request = { jobId: string; status: string; createdAt: string; timelineRevision: number; contentRevision: number; timelineId: string; stale: boolean };
type State = { contentRevision: number; timelineId: string | null; requests: Request[] };
type Made = { jobId: string; sizeBytes: number; frames: number };
type Outcome = { tone: "status" | "alert"; text: string; fix?: "disclosure" };
type Pending = { key: string; body: { revision: number; timelineId: string } };

const messages: Record<string, string> = {
  REVIEW_APPROVAL_REQUIRED: "이 버전의 검수 승인이 필요해요. 제작과 검수를 모두 승인한 버전만 영상으로 만들 수 있어요.",
  CURRENT_TIMELINE_CONFLICT: "그 사이 타임라인이 바뀌었어요. 최신 상태를 다시 불러왔어요.",
  INVALID_BASE_TIMELINE: "현재 타임라인은 이 화면에서 영상으로 만들 수 없는 구성이에요.",
  RENDER_INPUT_UNSUPPORTED: "현재 타임라인은 이 화면에서 영상으로 만들 수 없는 구성이에요.",
  RENDER_SOURCE_UNAVAILABLE: "장면 이미지나 음원을 확인할 수 없어요. 장면 결과와 연결한 음원을 다시 확인해 주세요.",
  RENDER_RUNNING: "이미 영상을 만드는 중이에요. 잠시 뒤 상태를 다시 확인해 주세요.",
  RENDER_RETRY_UNAVAILABLE: "다시 실행할 수 있는 횟수를 모두 썼어요. 새 버전으로 다시 요청해 주세요.",
  RENDER_REQUEST_MISSING: "요청을 찾을 수 없어요. 상태를 다시 불러왔어요.",
  RENDER_EXECUTION_FAILED: "영상을 만들지 못했어요. 다시 실행할 수 있어요.",
  RENDER_CLAIM_LOST: "실행이 중간에 끊겼어요. 다시 실행할 수 있어요.",
  // 편집 담당 공유 코드: 필수 표기는 내용 수정·재승인 경로, 글꼴·브라우저는 실행 환경 문제라 운영 점검으로 안내한다.
  RENDER_REQUIRED_DISCLOSURE_MISSING: "필수 표기가 영상에 들어가지 않아 만들 수 없어요. 자막 편집에서 필수 표기를 확인해 저장한 뒤, 편집 완료와 검수를 다시 승인해 주세요.",
  RENDER_FONT_MISSING: "영상에 쓸 글꼴을 이 컴퓨터에서 찾지 못했어요. 운영 담당자에게 실행 환경 점검을 요청해 주세요. 점검 뒤 다시 실행할 수 있어요.",
  RENDER_BROWSER_UNAVAILABLE: "글자를 그리는 실행 도구를 열지 못했어요. 운영 담당자에게 실행 환경 점검을 요청해 주세요. 점검 뒤 다시 실행할 수 있어요.",
  REQUEST_CONFLICT: "같은 요청 번호가 다른 버전에 쓰였어요. 새로 요청해 주세요.",
  PROJECT_MISSING: "프로젝트를 다시 열어 접근할 수 있는지 확인해 주세요.",
  INVALID_REQUEST: "요청을 확인할 수 없어요. 이 페이지를 다시 열어 주세요.",
  RENDER_EXECUTION_UNAVAILABLE: "이 환경에서는 영상을 만들 수 없어요.",
  RENDER_CANCELED: "영상 만들기가 중간에 멈췄어요. 만든 파일은 남지 않았고, 다시 실행할 수 있어요.",
};
const statusLabel: Record<string, string> = { queued: "대기 중", running: "만드는 중", failed: "실패", succeeded: "완료" };
const message = (code?: string) => (code && messages[code]) || "상태를 확인하지 못했어요. 다시 불러와 주세요.";

export function ProjectLocalRender({ projectId, produceApproved, reviewApproved }: {
  projectId: string;
  produceApproved: boolean;
  reviewApproved: boolean;
}) {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/renders`;
  const root = useRef<HTMLElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const busyNow = useRef(false);
  const [state, setState] = useState<State>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"request" | "execute">();
  const [pending, setPending] = useState<Pending>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [made, setMade] = useState<Made>();
  const [focusTick, setFocusTick] = useState(0);

  // 버튼이 꺼지거나 사라질 때 초점이 BODY로 떨어지지 않도록 결과 문구(없으면 영역)로 옮긴다.
  useEffect(() => {
    if (focusTick) (outcomeRef.current ?? root.current)?.focus();
  }, [focusTick]);

  // 검수 화면 링크(/render#local-render-heading)로 들어오면 주소만 이동하고 초점은 BODY에 남는다.
  // 그 경우에만 도착 제목으로 초점을 옮긴다(사용자가 이미 다른 곳에 초점을 두었으면 건드리지 않는다).
  useEffect(() => {
    if (window.location.hash !== "#local-render-heading") return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById("local-render-heading")?.focus();
  }, []);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      const result = body?.result;
      if (!response.ok || !result || !Array.isArray(result.requests)) throw new Error();
      setState({ contentRevision: result.contentRevision, timelineId: result.timelineId ?? null, requests: result.requests });
      return true;
    } catch {
      setLoadFailed(true);
      return false;
    }
  }, [endpoint]);

  useEffect(() => {
    let live = true;
    void (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  function finish(next: Outcome) {
    setOutcome(next);
    setFocusTick(value => value + 1);
  }

  async function begin(kind: "request" | "execute") {
    if (busyNow.current) return false;
    busyNow.current = true;
    root.current?.focus();
    setBusy(kind);
    setOutcome(undefined);
    return true;
  }

  function end() {
    busyNow.current = false;
    setBusy(undefined);
  }

  async function reload() {
    root.current?.focus();
    setOutcome(undefined);
    const ok = await load();
    finish(ok ? { tone: "status", text: "최신 상태를 불러왔어요." } : { tone: "alert", text: message() });
  }

  async function request() {
    const attempt = pending ?? (state?.timelineId
      ? { key: v7(), body: { revision: state.contentRevision, timelineId: state.timelineId } } : undefined);
    if (!attempt || !await begin("request")) return;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      const body = await response.json().catch(() => null);
      if (!body || response.status >= 500) throw new Error();
      setPending(undefined);
      await load();
      if (response.status === 202 && typeof body.result?.jobId === "string") {
        finish({ tone: "status", text: body.result.existing ? "이 버전은 이미 요청돼 있어요. 아래에서 실행할 수 있어요." : "영상 만들기를 요청했어요. 아래에서 실행해 주세요." });
      } else finish({ tone: "alert", text: message(body.code) });
    } catch {
      // 결과가 불명확하면 같은 키·본문으로만 다시 확인한다(서버가 같은 작업을 돌려준다).
      setPending(attempt);
      finish({ tone: "alert", text: "요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요." });
    } finally {
      end();
    }
  }

  async function execute(jobId: string) {
    if (!await begin("execute")) return;
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(jobId)}/execute`, { method: "POST" });
      const body = await response.json().catch(() => null);
      await load();
      if (response.ok && body?.result?.status === "succeeded") {
        setMade({ jobId, sizeBytes: Number(body.result.sizeBytes), frames: Number(body.result.frames) });
        finish({ tone: "status", text: "영상을 만들었어요. 아래에서 MP4를 받을 수 있어요." });
      } else finish({ tone: "alert", text: message(body?.code), ...(body?.code === "RENDER_REQUIRED_DISCLOSURE_MISSING" && { fix: "disclosure" as const }) });
    } catch {
      // 실행 결과가 불명확해도 상태 목록이 기준이다. 완료된 실행을 다시 요청하면 저장된 결과를 돌려준다.
      await load();
      finish({ tone: "alert", text: "실행 결과를 확인하지 못했어요. 아래 상태를 확인한 뒤 필요하면 다시 실행해 주세요." });
    } finally {
      end();
    }
  }

  const current = state?.requests.find(item => !item.stale);
  const older = state?.requests.filter(item => item !== current) ?? [];
  const canRequest = !!state?.timelineId && produceApproved && reviewApproved && !current && !busy;
  const href = (jobId: string) => `${endpoint}/${encodeURIComponent(jobId)}/execute`;

  // 결과 문구는 실행·요청 버튼 바로 앞에 둔다. 초점이 문구에 있을 때 Tab으로 다시 실행이나 안내 링크에 닿는다.
  const outcomeNode = outcome && <p ref={outcomeRef} tabIndex={-1} role={outcome.tone}>{outcome.text}{outcome.fix === "disclosure" && <>
      {" "}<Link href={`/cloud/projects/${projectId}/subtitles`}>자막 편집으로 이동</Link>{" · "}<Link href={`/cloud/projects/${projectId}/review`}>검수로 이동</Link>
    </>}</p>;

  return <section ref={root} tabIndex={-1} className="stack" aria-labelledby="local-render-heading" aria-busy={!!busy || undefined}>
    <h2 id="local-render-heading" tabIndex={-1}>영상 만들기</h2>
    <p>이 화면에서 만들 수 있는 영상: PNG 장면 1~2개 · 컷 전환 · 첨부한 WAV 음원 1~2개 · 승인된 한글 자막과 필수 표기. 결과는 16MB 이하 MP4예요.</p>
    {loadFailed && !state ? <p role="alert">영상 상태를 불러오지 못했어요. <button type="button" onClick={reload}>상태 다시 불러오기</button></p>
      : !state ? <p role="status">영상 상태를 불러오는 중이에요.</p>
      : <>
        <p>현재 버전 · 내용 리비전 {state.contentRevision}{state.timelineId ? "" : " · 저장된 타임라인 없음"}</p>
        {!state.timelineId && <p>첫 타임라인을 먼저 저장해 주세요. <Link href={`/cloud/projects/${projectId}/editing-audio`}>편집 음원 화면으로 이동</Link></p>}
        {!produceApproved && <p>장면 제작 승인이 필요해요.</p>}
        {!reviewApproved && <p>{messages.REVIEW_APPROVAL_REQUIRED}</p>}
        {outcomeNode}
        {current ? <div className="stack" aria-label="현재 버전 영상">
          <p>타임라인 r{current.timelineRevision} · 내용 r{current.contentRevision} · <strong>{statusLabel[current.status] ?? current.status}</strong></p>
          {current.status === "succeeded" ? <>
            {made?.jobId === current.jobId && <p>{Math.round(made.sizeBytes / 1024)}KB · {made.frames}프레임</p>}
            <a href={href(current.jobId)} download>현재 버전 MP4 받기</a>
          </> : <Button type="button" loading={busy === "execute"} loadingLabel="영상을 만드는 중" disabled={!!busy}
            onClick={() => execute(current.jobId)}>{current.status === "queued" ? "영상 만들기 실행" : current.status === "running" ? "이어서 실행" : "다시 실행"}</Button>}
        </div> : <Button type="button" loading={busy === "request"} loadingLabel="요청 중" disabled={!pending && !canRequest} onClick={request}>
          {pending ? "같은 요청 다시 확인" : "이 버전으로 영상 요청"}
        </Button>}
        <p><button type="button" onClick={reload} disabled={!!busy}>상태 다시 불러오기</button></p>
        {older.length > 0 && <div>
          <h3>이전 버전 요청</h3>
          <ul>{older.map(item => <li key={item.jobId}>타임라인 r{item.timelineRevision} · 내용 r{item.contentRevision} · {statusLabel[item.status] ?? item.status} · 이전 버전이라 받을 수 없어요</li>)}</ul>
        </div>}
      </>}
    {!state && outcomeNode}
  </section>;
}
