"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 } from "uuid";
import { Button } from "@/components/ui/primitives";

// 로컬 PG 재편집 ZIP(편집 담당 계약 msg_819536689801·msg_e5a4f52442e4, 서버 e30db53).
// GET/POST /api/projects/{id}/exports, GET /api/projects/{id}/exports/{exportId}(현재 승인본 ZIP만).
type Row = { id: string; contentRevision: number; timelineId: string; status: string; sha256: string | null; sizeBytes: number | null; downloadHref: string | null };
type State = { contentRevision: number; timelineId: string | null; canCreate: boolean; rows: Row[] };
type Outcome = { tone: "status" | "alert"; text: string };
type Pending = { key: string; body: { revision: number; timelineId: string } };

const messages: Record<string, string> = {
  CURRENT_TIMELINE_CONFLICT: "그 사이 타임라인이 바뀌었어요. 새 버전을 검수 승인한 뒤 다시 만들어 주세요.",
  EXPORT_REVIEW_REQUIRED: "검수를 승인한 현재 버전만 ZIP으로 만들거나 받을 수 있어요.",
  EXPORT_IN_PROGRESS: "이 버전의 ZIP을 이미 만드는 중이에요. 잠시 뒤 상태를 다시 불러와 주세요.",
  REQUEST_CONFLICT: "같은 요청 번호가 다른 버전에 쓰였어요. 상태를 다시 불러온 뒤 새로 만들어 주세요.",
  PROJECT_MISSING: "프로젝트를 다시 열어 접근할 수 있는지 확인해 주세요.",
  EXPORT_MISSING: "ZIP을 찾을 수 없어요.",
  INVALID_REQUEST: "요청을 확인할 수 없어요. 이 페이지를 다시 열어 주세요.",
  // e30db53 409: 내용·원본이 바뀌어 지금 버전으로는 묶을 수 없다.
  EXPORT_TIMELINE_INVALID: "현재 타임라인은 ZIP으로 묶을 수 없는 구성이에요. 타임라인을 확인해 주세요.",
  EXPORT_ASSET_UNAVAILABLE: "장면 이미지나 음원 원본을 확인할 수 없어요. 장면 결과와 연결한 음원을 다시 확인해 주세요.",
  EXPORT_ASSET_CHANGED: "묶는 동안 장면 이미지나 음원 원본이 바뀌었어요. 상태를 다시 불러온 뒤 다시 만들어 주세요.",
  EXPORT_SNAPSHOT_CHANGED: "묶는 동안 승인 내용이 바뀌었어요. 상태를 다시 불러온 뒤 다시 만들어 주세요.",
  EXPORT_CLAIM_LOST: "만드는 작업이 중간에 끊겼어요. 같은 요청으로 다시 확인할 수 있어요.",
  // e30db53 503: 일시 실패. 같은 키·본문으로 다시 확인하면 서버가 이어서 처리한다.
  EXPORT_UNAVAILABLE: "지금은 ZIP을 만들거나 받을 수 없어요.",
  EXPORT_READ_UNAVAILABLE: "자료를 읽지 못했어요.",
  EXPORT_FONT_UNAVAILABLE: "ZIP에 넣을 글꼴을 찾지 못했어요. 운영 담당자에게 실행 환경 점검을 요청해 주세요.",
  EXPORT_INPUT_INVALID: "묶을 자료를 확인하지 못했어요.",
  EXPORT_CANCELED: "ZIP 만들기가 중간에 멈췄어요.",
};
const statusLabel: Record<string, string> = { queued: "대기 중", running: "만드는 중", failed: "실패", succeeded: "완료" };
const reloadHint = "최신 상태를 불러오지 못했어요. '상태 다시 불러오기'를 눌러 주세요.";
// 실패 뒤 자동 다시 불러오기 결과를 실제 결과대로만 덧붙인다.
const after = (fresh: boolean) => fresh ? "최신 상태를 다시 불러왔어요." : reloadHint;
const message = (code?: string) => (code && messages[code]) || "상태를 확인하지 못했어요. 다시 불러와 주세요.";
const size = (bytes: number | null) => bytes == null ? "" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

export function ProjectLocalEditingZip({ projectId }: { projectId: string }) {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/exports`;
  const root = useRef<HTMLElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const busyNow = useRef(false);
  const [state, setState] = useState<State>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"create" | "download" | "reload">();
  const [pending, setPending] = useState<Pending>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [focusTick, setFocusTick] = useState(0);

  // 버튼이 꺼지거나 사라질 때 초점이 BODY로 떨어지지 않도록 결과 문구(없으면 영역)로 옮긴다.
  useEffect(() => {
    if (focusTick) (outcomeRef.current ?? root.current)?.focus();
  }, [focusTick]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      const result = body?.result;
      if (!response.ok || !result || !Array.isArray(result.rows)) throw new Error();
      setState({ contentRevision: result.contentRevision, timelineId: result.timelineId ?? null, canCreate: result.canCreate === true, rows: result.rows });
      setLoadFailed(false);
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

  function begin(kind: NonNullable<typeof busy>) {
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
    if (!begin("reload")) return;
    try {
      const fresh = await load();
      finish({ tone: fresh ? "status" : "alert", text: after(fresh) });
    } finally {
      end();
    }
  }

  async function create() {
    if (loadFailed) return;
    const attempt = pending ?? (state?.timelineId
      ? { key: v7(), body: { revision: state.contentRevision, timelineId: state.timelineId } } : undefined);
    if (!attempt || !begin("create")) return;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body),
      });
      if (response.status === 409) setLoadFailed(true);
      const body = await response.json().catch(() => null);
      if ((!body && response.status !== 409) || response.status >= 500) {
        // 일시 실패·불명확한 결과는 같은 키·본문으로만 다시 확인한다(서버가 같은 결과를 돌려준다).
        setPending(attempt);
        const known = typeof body?.code === "string" && messages[body.code];
        finish({ tone: "alert", text: known ? `${known} 같은 요청으로 다시 확인해 주세요.` : "ZIP 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요." });
        return;
      }
      setPending(undefined);
      const fresh = await load();
      const hint = fresh ? "" : ` ${reloadHint}`;
      const failed = ` ${after(fresh)}`;
      if ((response.status === 201 || response.status === 200) && body?.result?.status === "succeeded") {
        finish({ tone: "status", text: `${response.status === 200 ? "이 버전의 ZIP은 이미 만들어져 있어요." : "ZIP을 만들었어요."} ${size(body.result.sizeBytes)}${fresh ? " · 아래에서 받을 수 있어요." : hint}` });
      } else finish({ tone: "alert", text: `${message(body?.code)}${failed}` });
    } catch {
      // 결과가 불명확하면 같은 키·본문으로만 다시 확인한다(서버가 같은 결과를 돌려준다).
      setPending(attempt);
      finish({ tone: "alert", text: "ZIP 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요." });
    } finally {
      end();
    }
  }

  async function download(row: Row) {
    if (loadFailed || !row.downloadHref || !begin("download")) return;
    try {
      const response = await fetch(row.downloadHref, { cache: "no-store" });
      if (response.ok) {
        // 실패 응답이 파일로 저장되지 않도록 성공을 확인한 뒤에만 내려받는다.
        const name = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `editing-r${row.contentRevision}.zip`;
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        finish({ tone: "status", text: `${name} 파일을 받았어요.` });
      } else {
        setLoadFailed(true);
        const body = await response.json().catch(() => null);
        const fresh = await load();
        finish({ tone: "alert", text: `${message(body?.code)} ${after(fresh)}` });
      }
    } catch {
      finish({ tone: "alert", text: "ZIP 파일을 받지 못했어요. 다시 시도해 주세요." });
    } finally {
      end();
    }
  }

  const current = state?.timelineId ? state.rows.find(row => row.status === "succeeded" && row.contentRevision === state.contentRevision && row.timelineId === state.timelineId) : undefined;
  const working = state?.rows.find(row => row !== current && row.contentRevision === state.contentRevision && row.timelineId === state.timelineId && row.status !== "succeeded");
  const older = state?.rows.filter(row => row !== current && row !== working) ?? [];
  const canCreate = !!state?.timelineId && state.canCreate && !current && !busy;

  // 결과 문구는 만들기·받기 버튼 바로 앞에 둔다. 초점이 문구에 있을 때 Tab 한 번에 다음 행동에 닿는다.
  const outcomeNode = outcome && <p ref={outcomeRef} tabIndex={-1} role={outcome.tone}>{outcome.text}</p>;
  const reloadButton = <p><button type="button" onClick={reload} disabled={!!busy}>상태 다시 불러오기</button></p>;

  return <section ref={root} tabIndex={-1} className="stack" aria-labelledby="local-zip-heading" aria-busy={!!busy || undefined}>
    <h2 id="local-zip-heading">재편집 ZIP</h2>
    <p>검수를 승인한 현재 버전의 장면 PNG·WAV 원본·타임라인·자막(SRT/VTT)·권리 기록을 다른 편집 도구에서 이어 쓸 수 있게 묶어요.</p>
    {loadFailed ? <>
        {state && <p>마지막 확인 버전 · 내용 리비전 {state.contentRevision}</p>}
        {outcomeNode ?? (busy ? <p role="status">ZIP 상태를 불러오는 중이에요.</p> : <p role="alert">{reloadHint}</p>)}
        {reloadButton}
      </>
      : !state ? <p role="status">ZIP 상태를 불러오는 중이에요.</p>
      : <>
        <p>현재 버전 · 내용 리비전 {state.contentRevision}{state.timelineId ? "" : " · 저장된 타임라인 없음"}</p>
        {!state.timelineId ? <p>첫 타임라인을 먼저 저장해 주세요. <Link href={`/cloud/projects/${projectId}/editing-audio`}>편집 음원 화면으로 이동</Link></p>
          : !current && !state.canCreate && <p>{messages.EXPORT_REVIEW_REQUIRED} <Link href={`/cloud/projects/${projectId}/review`}>검수로 이동</Link></p>}
        {working && <p>현재 버전 ZIP · <strong>{statusLabel[working.status] ?? working.status}</strong></p>}
        {outcomeNode}
        {current ? <div className="stack" aria-label="현재 버전 ZIP">
          <p>내용 r{current.contentRevision} · {size(current.sizeBytes)}{current.sha256 ? ` · SHA-256 ${current.sha256.slice(0, 12)}…` : ""}</p>
          <p><Button type="button" variant="secondary" loading={busy === "download"} loadingLabel="받는 중" disabled={!!busy} onClick={() => download(current)}>현재 버전 ZIP 받기</Button></p>
        </div> : state.timelineId && <p><Button type="button" loading={busy === "create"} loadingLabel="ZIP을 만드는 중" disabled={!!busy || (!pending && !canCreate)} onClick={create}>
          {pending ? "같은 요청 다시 확인" : "이 버전으로 ZIP 만들기"}
        </Button></p>}
        {reloadButton}
        {older.length > 0 && <div>
          <h3>이전 버전 ZIP</h3>
          <ul>{older.map(row => <li key={row.id}>내용 r{row.contentRevision} · {statusLabel[row.status] ?? row.status}{row.sizeBytes != null ? ` · ${size(row.sizeBytes)}` : ""} · 이전 버전이라 받을 수 없어요</li>)}</ul>
        </div>}
      </>}
  </section>;
}
