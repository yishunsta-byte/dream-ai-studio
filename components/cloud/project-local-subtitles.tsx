"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 } from "uuid";
import { Button } from "@/components/ui/primitives";

// 로컬 PG 자막 편집. 명세: docs/design/web-admin-ui-review-20261119.md '로컬 PG 자막 편집의 화면 차이'(a4554d4).
// 서버 계약: GET·POST /api/projects/{id}/timeline/subtitles(45b3104). 편집 가능한 자막만 받고, 저장은 그 전체 목록을 보낸다.
const FPS = 30;
const MAX_SUBTITLES = 100;
const MAX_LENGTH = 500;

type Subtitle = { id: string; content: string; startFrame: number; endFrame: number };
type Server = { timelineId: string | null; contentRevision: number; timelineRevision: number | null; subtitles: Subtitle[];
  videoFrames: number; maxEndFrame: number; blockedReason: string | null };
type Row = { id: string; content: string; start: string; end: string; deleted: boolean; added?: boolean; fromConflict?: boolean };
type Field = "content" | "start" | "end";
type Problem = { id: string; field: Field; text: string };
type Attempt = { key: string; body: { expectedContentRevision: number; expectedTimelineId: string; subtitles: Subtitle[] } };
type Outcome = { tone: "status" | "alert"; text: string; review?: boolean };

const blocked: Record<string, { text: string; href: (id: string) => string; link: string }> = {
  PRODUCE_APPROVAL_REQUIRED: { text: "장면 제작을 먼저 승인해 주세요.", href: id => `/cloud/projects/${id}`, link: "프로젝트 상세로 이동" },
  BASE_TIMELINE_REQUIRED: { text: "첫 타임라인을 먼저 저장해 주세요.", href: id => `/cloud/projects/${id}/editing-audio`, link: "편집 음원 화면으로 이동" },
  INVALID_BASE_TIMELINE: { text: "저장된 타임라인을 확인할 수 없어요.", href: id => `/cloud/projects/${id}/editing-audio`, link: "편집 음원 화면으로 이동" },
  BASE_TIMELINE_STALE: { text: "선택한 장면 결과가 저장된 타임라인과 달라요. 장면 결과를 확인해 주세요.", href: id => `/cloud/projects/${id}`, link: "프로젝트 상세로 이동" },
};
const failures: Record<string, string> = {
  PRODUCE_APPROVAL_REQUIRED: "장면 제작을 먼저 승인해 주세요.",
  BASE_TIMELINE_REQUIRED: "첫 타임라인을 먼저 저장해 주세요.",
  INVALID_BASE_TIMELINE: "저장된 타임라인을 확인할 수 없어요.",
  OUTPUT_LENGTH_REQUIRED: "장면을 준비해 영상 길이를 먼저 정해 주세요.",
  PROTECTED_TEXT_LAYER: "보호된 글자 레이어는 바꿀 수 없어요. 최신 상태를 다시 불러와 주세요.",
  SUBTITLE_TIME_EXCEEDED: "끝 프레임이 입력 가능한 범위를 넘었어요.",
  REQUIRED_DISCLOSURE_INVALID: "필수 표기 레이어가 올바르지 않아요. 편집 화면에서 필수 표기를 확인해 주세요.",
  INVALID_TIMELINE: "이 자막으로 타임라인을 저장할 수 없어요. 시간과 문구를 확인해 주세요.",
  TIMELINE_TOO_LARGE: "타임라인 크기가 저장 한도를 넘었어요.",
  INVALID_REQUEST: "자막 내용을 확인할 수 없어요. 문구와 프레임을 확인해 주세요.",
  PROJECT_MISSING: "프로젝트를 다시 열어 접근할 수 있는지 확인해 주세요.",
  SUBTITLES_UNAVAILABLE: "이 환경에서는 자막을 저장할 수 없어요.",
};

const time = (frames: number) => {
  const seconds = frames / FPS;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
};
const toRow = (item: Subtitle): Row => ({ id: item.id, content: item.content, start: String(item.startFrame), end: String(item.endFrame), deleted: false });
const frame = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN);
const same = (row: Row, saved?: Subtitle) => !!saved && row.content === saved.content &&
  frame(row.start) === saved.startFrame && frame(row.end) === saved.endFrame;

function rowState(row: Row, saved?: Subtitle) {
  if (row.deleted) return saved ? "삭제 예정" : "추가 취소";
  if (!saved) return row.added ? "새 자막" : "최신본에 없음 · 저장하면 다시 추가돼요";
  if (row.fromConflict) return "다른 곳에서 추가됨";
  return same(row, saved) ? "" : "수정됨";
}

function isServer(value: unknown): value is Server {
  const v = value as Server;
  return !!v && Number.isSafeInteger(v.contentRevision) && Array.isArray(v.subtitles) &&
    Number.isSafeInteger(v.videoFrames) && Number.isSafeInteger(v.maxEndFrame);
}

// 승인 자막 받기(808fc01): GET .../subtitles/download?format=srt|vtt&revision=&timelineId=.
const downloadFailures: Record<string, string> = {
  REVIEW_APPROVAL_REQUIRED: "이 버전은 아직 검수 승인 전이에요. 검수를 승인한 뒤 받을 수 있어요.",
  CURRENT_TIMELINE_CONFLICT: "그 사이 다른 곳에서 자막이 바뀌어 이 승인본은 받을 수 없어요. 아래 '저장된 자막 다시 불러오기'로 최신 자막을 불러온 뒤, 검수를 다시 승인하면 받을 수 있어요.",
  BASE_TIMELINE_STALE: "선택한 장면 결과가 타임라인과 달라요. 장면 결과를 확인해 주세요.",
  SUBTITLES_EMPTY: "승인된 버전에 자막이 없어요.",
  PROJECT_MISSING: "프로젝트를 다시 열어 접근할 수 있는지 확인해 주세요.",
  INVALID_REQUEST: "받을 버전을 확인할 수 없어요. 저장된 자막을 다시 불러와 주세요.",
};

export function ProjectLocalSubtitles({ projectId, reviewApproved = false }: { projectId: string; reviewApproved?: boolean }) {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/timeline/subtitles`;
  const root = useRef<HTMLElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const savingNow = useRef(false);
  const [server, setServer] = useState<Server>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState<Attempt>();
  const [conflict, setConflict] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [focusTick, setFocusTick] = useState(0);
  const [focusField, setFocusField] = useState<{ id: string; field: Field; tick: number }>();
  // 자막을 바꿔 저장하면 서버가 기존 승인을 무효로 한다. 페이지가 준 승인 값은 그 뒤로 믿지 않는다.
  const [approvalLost, setApprovalLost] = useState(false);
  const [downloading, setDownloading] = useState<"srt" | "vtt">();
  const [downloadOutcome, setDownloadOutcome] = useState<Outcome>();
  const [downloadTick, setDownloadTick] = useState(0);
  const downloadRef = useRef<HTMLParagraphElement>(null);

  const saved = new Map((server?.subtitles ?? []).map(item => [item.id, item]));

  // 버튼이 꺼지거나 사라지면 초점이 BODY로 떨어지므로 결과 문구(없으면 영역)로 옮긴다.
  useEffect(() => {
    if (focusTick) (outcomeRef.current ?? root.current)?.focus();
  }, [focusTick]);
  useEffect(() => {
    if (downloadTick) downloadRef.current?.focus();
  }, [downloadTick]);
  useEffect(() => {
    if (focusField) document.getElementById(`subtitle-${focusField.field}`)?.focus();
  }, [focusField]);

  const fetchLatest = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !isServer(body)) throw new Error(body?.code);
    return body;
  }, [endpoint]);

  useEffect(() => {
    let live = true;
    fetchLatest().then(latest => {
      if (!live) return;
      setServer(latest);
      setRows(latest.subtitles.map(toRow));
      setSelected(latest.subtitles[0]?.id);
    }).catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [fetchLatest]);

  function finish(next: Outcome) {
    setOutcome(next);
    setFocusTick(value => value + 1);
  }

  async function reloadAll() {
    root.current?.focus();
    setOutcome(undefined);
    try {
      const latest = await fetchLatest();
      setLoadFailed(false);
      setServer(latest);
      setRows(latest.subtitles.map(toRow));
      setSelected(latest.subtitles[0]?.id);
      setConflict(false);
      setRetry(undefined);
      setProblem(undefined);
      finish({ tone: "status", text: "저장된 자막을 불러왔어요." });
    } catch {
      setLoadFailed(true);
      finish({ tone: "alert", text: "자막을 불러오지 못했어요. 다시 불러와 주세요." });
    }
  }

  function edit(id: string, patch: Partial<Row>) {
    setRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)));
    if (problem?.id === id) setProblem(undefined);
  }

  function add() {
    if (!server) return;
    const live = rows.filter(row => !row.deleted).length;
    if (live >= MAX_SUBTITLES) {
      finish({ tone: "alert", text: `자막은 ${MAX_SUBTITLES}개까지 넣을 수 있어요.` });
      return;
    }
    const last = rows.filter(row => !row.deleted).map(row => frame(row.end)).filter(Number.isFinite);
    const start = Math.min(last.length ? Math.max(...last) : 0, Math.max(server.maxEndFrame - 1, 0));
    const row: Row = { id: v7(), content: "", start: String(start), end: String(Math.min(start + FPS * 2, server.maxEndFrame)), deleted: false, added: true };
    setRows(current => [...current, row]);
    setSelected(row.id);
    setFocusField(prev => ({ id: row.id, field: "content", tick: (prev?.tick ?? 0) + 1 }));
  }

  function validate(): Problem | undefined {
    if (!server) return undefined;
    for (const row of rows) {
      if (row.deleted) continue;
      const start = frame(row.start);
      const end = frame(row.end);
      if (!row.content.trim()) return { id: row.id, field: "content", text: "문구를 입력해 주세요. 공백만으로는 저장할 수 없어요." };
      if (row.content.length > MAX_LENGTH) return { id: row.id, field: "content", text: `문구는 ${MAX_LENGTH}자까지 입력할 수 있어요.` };
      if (!Number.isSafeInteger(start) || start < 0) return { id: row.id, field: "start", text: "시작 프레임은 0 이상의 정수로 입력해 주세요." };
      if (!Number.isSafeInteger(end) || end <= start) return { id: row.id, field: "end", text: "끝 프레임은 시작 프레임보다 커야 해요." };
      // 상한을 넘는 기존 범위는 그대로 둘 수 있다. 그 행을 고쳤을 때만 새 범위를 확인한다.
      if (end > server.maxEndFrame && !same(row, saved.get(row.id)))
        return { id: row.id, field: "end", text: `끝 프레임은 ${server.maxEndFrame} 이하로 입력해 주세요.` };
    }
    if (rows.filter(row => !row.deleted).length > MAX_SUBTITLES) {
      const extra = rows.filter(row => !row.deleted)[MAX_SUBTITLES];
      return { id: extra.id, field: "content", text: `자막은 ${MAX_SUBTITLES}개까지 저장할 수 있어요.` };
    }
    return undefined;
  }

  async function save() {
    if (savingNow.current || !server?.timelineId) return;
    let attempt = retry;
    if (!attempt) {
      const issue = validate();
      if (issue) {
        setProblem(issue);
        setSelected(issue.id);
        setFocusField(prev => ({ id: issue.id, field: issue.field, tick: (prev?.tick ?? 0) + 1 }));
        return;
      }
      attempt = { key: v7(), body: { expectedContentRevision: server.contentRevision, expectedTimelineId: server.timelineId,
        subtitles: rows.filter(row => !row.deleted).map(row => ({ id: row.id, content: row.content, startFrame: frame(row.start), endFrame: frame(row.end) })) } };
    }
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
      if (!result || (response.status >= 500 && result.code !== "SUBTITLES_UNAVAILABLE")) throw new Error();
      setRetry(undefined);
      if (response.ok && typeof result.timelineId === "string" && Number.isSafeInteger(result.timelineRevision) && typeof result.changed === "boolean") {
        const latest = await fetchLatest().catch(() => undefined);
        if (latest) {
          setServer(latest);
          setRows(latest.subtitles.map(toRow));
          setSelected(current => (latest.subtitles.some(item => item.id === current) ? current : latest.subtitles[0]?.id));
        }
        setConflict(false);
        if (result.changed) setApprovalLost(true);
        setDownloadOutcome(undefined);
        finish(result.changed
          ? { tone: "status", review: true, text: `자막을 저장했어요. 현재 내용의 편집 완료와 검수를 다시 진행해 주세요. 타임라인 r${result.timelineRevision} · 내용 리비전 ${result.contentRevision}.` }
          : { tone: "status", text: `저장된 자막과 같아요. 타임라인 r${result.timelineRevision} · 내용 리비전 ${result.contentRevision} 그대로예요.` });
        return;
      }
      if (["CURRENT_TIMELINE_CONFLICT", "BASE_TIMELINE_STALE", "REQUEST_CONFLICT"].includes(result.code)) {
        await showLatest();
        return;
      }
      if (result.code === "SUBTITLE_TIME_EXCEEDED" && server) {
        const over = rows.find(row => !row.deleted && frame(row.end) > server.maxEndFrame);
        if (over) {
          setProblem({ id: over.id, field: "end", text: `끝 프레임은 ${server.maxEndFrame} 이하로 입력해 주세요.` });
          setSelected(over.id);
          setFocusField(prev => ({ id: over.id, field: "end", tick: (prev?.tick ?? 0) + 1 }));
          return;
        }
      }
      const reason = result.code === "EDIT_NOT_READY" && Array.isArray(result.reasons)
        ? result.reasons.map((code: string) => failures[code]).filter(Boolean).join(" ") : failures[result.code];
      finish({ tone: "alert", text: reason || "자막을 저장하지 못했어요. 최신 상태를 다시 불러와 주세요." });
    } catch {
      // 응답이 끊기면 같은 키와 본문으로만 다시 확인한다. 초안은 그대로 둔다.
      setRetry(attempt);
      finish({ tone: "alert", text: "저장 결과를 확인하지 못했어요. 같은 저장 요청으로 다시 확인해 주세요." });
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  // 다른 곳에서 먼저 저장했으면 최신 저장본을 기준으로 바꾸되, 초안은 덮어쓰지 않는다.
  // 최신본에만 있는 자막은 초안에 보이게 넣어(삭제하지 않으면 유지) 저장 때 사라지지 않게 한다.
  async function showLatest() {
    try {
      const latest = await fetchLatest();
      setServer(latest);
      setRows(current => {
        const known = new Set(current.map(row => row.id));
        const marked = current.map(row => ({ ...row, fromConflict: false }));
        return [...marked, ...latest.subtitles.filter(item => !known.has(item.id)).map(item => ({ ...toRow(item), fromConflict: true }))];
      });
      setConflict(true);
      finish({ tone: "alert", text: "다른 곳에서 자막이 먼저 저장됐어요. 내 초안은 그대로 두었어요. 아래 비교에서 최신 저장본과 다른 행을 확인한 뒤 다시 저장해 주세요." });
    } catch {
      finish({ tone: "alert", text: "저장 기준이 바뀌었는데 최신 자막을 불러오지 못했어요. 다시 불러와 주세요. 다시 불러오면 초안이 지워져요." });
    }
  }

  async function download(format: "srt" | "vtt") {
    if (!server?.timelineId || downloading) return;
    setDownloading(format);
    setDownloadOutcome(undefined);
    const query = new URLSearchParams({ format, revision: String(server.contentRevision), timelineId: server.timelineId });
    let next: Outcome;
    try {
      const response = await fetch(`${endpoint}/download?${query}`, { cache: "no-store" });
      if (response.ok) {
        // 실패 응답이 파일로 저장되지 않도록 성공을 확인한 뒤에만 내려받는다.
        const name = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `subtitles-r${server.contentRevision}.${format}`;
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        next = { tone: "status", text: `${name} 파일을 받았어요.` };
      } else {
        const body = await response.json().catch(() => null);
        // 다른 탭에서 자막이 바뀌면(409 CURRENT_TIMELINE_CONFLICT) 승인도 풀린다. 옛 버전 받기 버튼을 거둔다.
        if (body?.code === "REVIEW_APPROVAL_REQUIRED" || body?.code === "CURRENT_TIMELINE_CONFLICT") setApprovalLost(true);
        next = { tone: "alert", text: downloadFailures[body?.code] ?? "자막 파일을 받지 못했어요. 다시 시도해 주세요." };
      }
    } catch {
      next = { tone: "alert", text: "자막 파일을 받지 못했어요. 다시 시도해 주세요." };
    }
    setDownloading(undefined);
    setDownloadOutcome(next);
    setDownloadTick(value => value + 1);
  }

  if (loadFailed && !server) {
    return <section ref={root} tabIndex={-1} className="stack" aria-labelledby="local-subtitles-heading">
      <h2 id="local-subtitles-heading">자막 편집</h2>
      <p role="alert">자막을 불러오지 못했어요. <button type="button" onClick={reloadAll}>자막 다시 불러오기</button></p>
      {outcome && <p ref={outcomeRef} tabIndex={-1} role={outcome.tone}>{outcome.text}</p>}
    </section>;
  }
  if (!server) {
    return <section ref={root} tabIndex={-1} className="stack" aria-labelledby="local-subtitles-heading">
      <h2 id="local-subtitles-heading">자막 편집</h2>
      <p role="status">저장된 자막을 불러오는 중이에요.</p>
    </section>;
  }

  const stop = server.blockedReason ? blocked[server.blockedReason] ?? { text: failures[server.blockedReason] ?? "지금은 자막을 편집할 수 없어요.", href: (id: string) => `/cloud/projects/${id}`, link: "프로젝트 상세로 이동" } : undefined;
  const live = rows.filter(row => !row.deleted);
  const changes = rows.filter(row => rowState(row, saved.get(row.id)));
  const current = rows.find(row => row.id === selected);
  const savedCurrent = current && saved.get(current.id);
  const describe = (field: Field) => (problem && current && problem.id === current.id && problem.field === field ? "subtitle-problem" : undefined);

  // 결과 문구는 저장 버튼 바로 앞에 둔다. 초점이 문구에 있을 때 Tab 한 번으로 재시도·다시 저장에 닿는다.
  const outcomeNode = outcome && <p ref={outcomeRef} tabIndex={-1} role={outcome.tone}>{outcome.text}{outcome.review && <> <Link href={`/cloud/projects/${projectId}/review`}>검수로 이동</Link></>}</p>;

  return <section ref={root} tabIndex={-1} className="stack" aria-labelledby="local-subtitles-heading" aria-busy={saving || undefined}>
    <h2 id="local-subtitles-heading">자막 편집</h2>
    <p>현재 버전 · 타임라인 r{server.timelineRevision ?? "-"} · 내용 리비전 {server.contentRevision}</p>
    <p>영상 길이 {server.videoFrames}프레임({time(server.videoFrames)}) · 입력 가능한 끝 프레임 {server.maxEndFrame}({time(server.maxEndFrame)}) · 30fps</p>
    <p>필수 표기와 잠긴 글자 레이어는 보호돼요. 이 목록에는 편집할 수 있는 자막만 보여요.</p>
    {stop ? <><p>{stop.text} <Link href={stop.href(projectId)}>{stop.link}</Link></p>{outcomeNode}</> : <>
      <div role="group" aria-label={`자막 ${live.length}개`}>
        {rows.length === 0 ? <p>저장된 자막이 없어요. 자막을 추가해 주세요.</p> :
          <ul className="stack">{rows.map((row, index) => {
            const state = rowState(row, saved.get(row.id));
            return <li key={row.id}>
              <button type="button" aria-pressed={row.id === selected} onClick={() => {
                // 행을 고르면 바로 문구 입력으로 간다(명세: 행 선택 → 문구 → 시작 → 끝 → 저장).
                setSelected(row.id);
                setFocusField(prev => ({ id: row.id, field: "content", tick: (prev?.tick ?? 0) + 1 }));
              }}>
                {index + 1}. {Number.isFinite(frame(row.start)) ? time(frame(row.start)) : "?"}–{Number.isFinite(frame(row.end)) ? time(frame(row.end)) : "?"} · {row.content.trim() || "(문구 없음)"}{state && ` · ${state}`}
              </button>
            </li>;
          })}</ul>}
      </div>
      <p><button type="button" onClick={add} disabled={saving}>자막 추가</button></p>
      {/* 키보드 순서(명세): 행 선택 → 문구 → 시작 → 끝 → 저장. 추가·삭제는 편집 입력 앞에 둔다. */}
      {current && <fieldset className="stack">
        <legend>{rows.indexOf(current) + 1}번 자막{current.deleted ? " · 삭제 예정" : ""}</legend>
        <button type="button" onClick={() => edit(current.id, { deleted: !current.deleted })}>{current.deleted ? "삭제 취소" : "이 자막 삭제"}</button>
        <label htmlFor="subtitle-content">문구</label>
        <textarea id="subtitle-content" value={current.content} maxLength={MAX_LENGTH} disabled={current.deleted}
          aria-invalid={!!describe("content") || undefined} aria-describedby={describe("content")}
          onChange={event => edit(current.id, { content: event.target.value })} />
        <label htmlFor="subtitle-start">시작 프레임</label>
        <input id="subtitle-start" inputMode="numeric" value={current.start} disabled={current.deleted}
          aria-invalid={!!describe("start") || undefined} aria-describedby={describe("start")}
          onChange={event => edit(current.id, { start: event.target.value })} />
        <label htmlFor="subtitle-end">끝 프레임</label>
        <input id="subtitle-end" inputMode="numeric" value={current.end} disabled={current.deleted}
          aria-invalid={!!describe("end") || undefined} aria-describedby={describe("end") ?? "subtitle-end-limit"}
          onChange={event => edit(current.id, { end: event.target.value })} />
        <p id="subtitle-end-limit">입력 가능한 끝 프레임 {server.maxEndFrame}{savedCurrent && savedCurrent.endFrame > server.maxEndFrame ? ` · 저장된 끝 프레임 ${savedCurrent.endFrame}은 그대로 둘 수 있어요. 바꾸면 범위를 확인해요.` : ""}</p>
        {problem && problem.id === current.id && <p id="subtitle-problem" role="alert">{problem.text}</p>}
      </fieldset>}
      {changes.length > 0 && <div>
        <h3>{conflict ? "최신 저장본과 내 초안 비교" : "저장 전 비교"}</h3>
        <ul>{changes.map(row => {
          const before = saved.get(row.id);
          return <li key={row.id}>{rowState(row, before)} · 저장본: {before ? `${time(before.startFrame)}–${time(before.endFrame)} ${before.content}` : "없음"} → 수정본: {row.deleted ? "없음" : `${Number.isFinite(frame(row.start)) ? time(frame(row.start)) : "?"}–${Number.isFinite(frame(row.end)) ? time(frame(row.end)) : "?"} ${row.content}`}</li>;
        })}</ul>
      </div>}
      {/* f03a881(독립 통과): 승인된 버전의 자막과 필수 표기가 MP4에 들어간다. 로컬 검증 범위로만 안내한다. */}
      {live.length > 0 && <p>저장하고 검수를 승인한 버전의 자막은 영상 만들기에서 MP4에 함께 들어가요. 광고 등 필수 표기가 필요한 작품은 표기가 영상 전체 구간에 있어야 만들 수 있어요.</p>}
      {outcomeNode}
      <Button type="button" loading={saving} loadingLabel="저장 중" disabled={!retry && (!server.timelineId || saving)} onClick={save}>
        {retry ? "같은 저장 요청 다시 확인" : conflict ? "최신 저장본 기준으로 다시 저장" : "자막 저장"}
      </Button>
    </>}
    <div className="stack" role="group" aria-labelledby="subtitle-download-heading">
      <h3 id="subtitle-download-heading">승인된 자막 받기</h3>
      {!reviewApproved || approvalLost
        ? <p>검수를 승인한 버전의 자막만 받을 수 있어요. 자막을 저장하면 검수를 다시 승인해야 해요. <Link href={`/cloud/projects/${projectId}/review`}>검수로 이동</Link></p>
        : server.subtitles.length === 0
          ? <p>승인된 버전에 자막이 없어요. 자막을 저장하고 다시 검수하면 받을 수 있어요.</p>
          : <>
            <p>내용 리비전 {server.contentRevision} 승인본의 자막 {server.subtitles.length}개를 SRT 또는 WebVTT로 받아요.{changes.length > 0 ? " 저장하지 않은 초안은 파일에 들어가지 않아요." : ""}</p>
            {downloadOutcome && <p ref={downloadRef} tabIndex={-1} role={downloadOutcome.tone}>{downloadOutcome.text}</p>}
            <p>
              <Button type="button" variant="secondary" loading={downloading === "srt"} loadingLabel="받는 중" disabled={!!downloading} onClick={() => download("srt")}>SRT 받기</Button>{" "}
              <Button type="button" variant="secondary" loading={downloading === "vtt"} loadingLabel="받는 중" disabled={!!downloading} onClick={() => download("vtt")}>VTT 받기</Button>
            </p>
          </>}
      {downloadOutcome && (!reviewApproved || approvalLost || server.subtitles.length === 0) && <p ref={downloadRef} tabIndex={-1} role={downloadOutcome.tone}>{downloadOutcome.text}</p>}
    </div>
    <p><button type="button" onClick={reloadAll} disabled={saving}>저장된 자막 다시 불러오기{changes.length > 0 ? "(초안이 지워져요)" : ""}</button></p>
  </section>;
}
