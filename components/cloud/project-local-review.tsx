"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { Field } from "@/components/ui/interactive";
import { Button, Card, StatusPill } from "@/components/ui/primitives";

const statuses = z.enum(["unchecked", "pass", "hold"]);
const reasons = z.enum(["PRODUCE_APPROVAL_REQUIRED", "TIMELINE_REQUIRED", "BASE_TIMELINE_STALE"]);
const itemSchema = z.object({
  id: z.string(), label: z.string(), source: z.enum(["common", "menu", "conditional"]),
  required: z.boolean(), status: statuses, note: z.string().nullable(),
});
const reviewSchema = z.object({
  revision: z.number().int().positive(), timelineId: z.uuid().nullable(),
  editCompleted: z.boolean(), approved: z.boolean(), items: z.array(itemSchema), blockedReason: reasons.nullable(),
});
type Review = z.infer<typeof reviewSchema>;
type Item = z.infer<typeof itemSchema>;
type Command = { action: "complete-edit" | "approve-review" } |
  { action: "review-item"; input: { itemId: string; status: Item["status"]; note: string } };
type Notice = { text: string; action?: "reload" | "approval" | "login" | "projects" };

const groups = [["common", "공통 검수"], ["menu", "분야별 검수"], ["conditional", "조건별 검수"]] as const;
const display = {
  unchecked: { status: "queued", label: "미확인" },
  pass: { status: "done", label: "통과" },
  hold: { status: "warning", label: "보류" },
} as const;
const blocks = {
  PRODUCE_APPROVAL_REQUIRED: { label: "장면 제작을 먼저 승인해 주세요.", path: "produce" },
  TIMELINE_REQUIRED: { label: "편집에서 기준 타임라인을 저장해 주세요.", path: "editing-audio" },
  BASE_TIMELINE_STALE: { label: "편집에서 지금 선택으로 저장해 주세요.", path: "editing-audio" },
} as const;
const reloadMessages: Record<string, string> = {
  CURRENT_TIMELINE_CONFLICT: "내용이 바뀌었어요. 최신 버전에서 검수해 주세요.",
  REQUIRED_ITEMS_INCOMPLETE: "최신 필수 항목을 확인하고 통과 상태를 저장해 주세요.",
  EDIT_COMPLETION_REQUIRED: "현재 버전의 편집을 먼저 완료해 주세요.",
  REVIEW_STAGE_LOCKED: "검수 상태가 바뀌었어요. 현재 상태를 확인해 주세요.",
  ...Object.fromEntries(Object.entries(blocks).map(([code, block]) => [code, block.label])),
};

class ReviewRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("Review request failed");
  }
}

async function reviewRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ReviewRequestError(response.status, typeof body?.code === "string" ? body.code : undefined);
  return reviewSchema.parse(body);
}

function accessNotice(error: unknown): Notice | null {
  if (!(error instanceof ReviewRequestError)) return null;
  if (error.status === 401) return { text: "로그인한 뒤 검수를 다시 열어 주세요.", action: "login" };
  if (error.status === 404 && error.code !== "REVIEW_ITEM_MISSING") {
    return { text: "검수할 프로젝트를 찾을 수 없어요.", action: "projects" };
  }
  return null;
}

function focus(ref: RefObject<HTMLElement | null>) {
  requestAnimationFrame(() => ref.current?.focus());
}

export function ProjectLocalReview({ projectId, entry = false }: { projectId: string; entry?: boolean }) {
  const router = useRouter();
  const project = `/cloud/projects/${encodeURIComponent(projectId)}`;
  const reviewPath = `${project}/review#review-status`;
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/review`;
  const [state, setState] = useState<Review | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const approvedHeading = useRef<HTMLHeadingElement>(null);
  const message = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void reviewRequest(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState(data);
    }).catch(error => {
      if (!controller.signal.aborted) {
        setNotice(accessNotice(error) ?? { text: "검수 상태를 불러오지 못했어요.", action: "reload" });
      }
    });
    return () => controller.abort();
  }, [endpoint]);

  useEffect(() => {
    if (!entry && window.location.hash === "#review-status" && document.activeElement === document.body) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [entry]);

  function report(next: Notice) {
    setNotice(next);
    focus(message);
  }

  async function reload(action: "approval" | "reload", text?: string) {
    try {
      const fresh = await reviewRequest(endpoint);
      setState(fresh);
      const changed = state && (fresh.revision !== state.revision || fresh.timelineId !== state.timelineId);
      if (changed) {
        report({ text: reloadMessages.CURRENT_TIMELINE_CONFLICT });
      } else if (fresh.approved && !entry) {
        setNotice(null);
        focus(approvedHeading);
      } else if (text) {
        report({ text });
      } else {
        setNotice(null);
        focus(heading);
      }
    } catch (error) {
      const permission = accessNotice(error);
      if (permission) setState(null);
      report(permission ?? {
        text: "현재 검수 상태를 확인하지 못했어요.", action,
      });
    }
  }

  async function run(command?: Command) {
    if (busy.current || (command && (!state?.timelineId || notice?.action))) return;
    busy.current = true;
    setPending(true);
    setNotice(null);
    try {
      if (!command) {
        await reload(notice?.action === "approval" ? "approval" : "reload");
        return;
      }
      const saved = await reviewRequest(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: state?.revision, timelineId: state?.timelineId, ...command }),
      });
      setState(saved);
      if (command.action === "complete-edit" && saved.editCompleted) {
        if (entry) router.push(reviewPath);
        else focus(heading);
      }
      if (command.action === "review-item") {
        setNotes(current => {
          const next = { ...current };
          delete next[command.input.itemId];
          return next;
        });
        return true;
      }
      if (command.action === "approve-review") {
        if (saved.approved) focus(approvedHeading);
        else report({ text: "승인 결과를 확인해 주세요.", action: "approval" });
      }
    } catch (error) {
      const permission = accessNotice(error);
      if (permission) {
        setState(null);
        report(permission);
      } else {
        const code = error instanceof ReviewRequestError ? error.code : undefined;
        if (code && reloadMessages[code]) {
          await reload("reload", reloadMessages[code]);
        } else if (code === "REVIEW_ALREADY_APPROVED" || command?.action === "approve-review") {
          report({ text: "승인 결과를 확인하지 못했어요. 현재 승인 상태를 다시 확인해 주세요.", action: "approval" });
        } else {
          report({ text: "저장하지 못했어요. 입력한 내용을 확인하고 다시 시도해 주세요." });
        }
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const blocked = state?.blockedReason ? blocks[state.blockedReason] : null;
  const required = state?.items.filter(item => item.required) ?? [];
  const passed = required.filter(item => item.status === "pass").length;
  const incomplete = required.filter(item => item.status !== "pass");
  const unsavedNote = state?.items.some(item => item.id in notes && notes[item.id].trim() !== (item.note ?? ""));
  const unavailable = pending || !!notice?.action;
  return <Card className="stack">
    <h2 ref={heading} id={entry ? undefined : "review-status"} tabIndex={-1}>현재 버전 검수</h2>
    {state && <p>내용 버전 r{state.revision}</p>}
    {!state && !notice && <p role="status">검수 상태를 불러오는 중이에요.</p>}
    {notice && <div className="stack">
      <p ref={message} tabIndex={-1} role="alert">{notice.text}</p>
      {notice.action === "login" && <Link href={`/login?next=${encodeURIComponent(project + (entry ? "/editing-audio" : "/review"))}`}>로그인하기</Link>}
      {notice.action === "projects" && <Link href="/cloud/projects">프로젝트 목록으로 이동</Link>}
      {(notice.action === "reload" || notice.action === "approval") &&
        <div><Button loading={pending} loadingLabel="확인 중" onClick={() => void run()}>
          {notice.action === "approval" ? "승인 상태 다시 확인" : "검수 상태 다시 확인"}
        </Button></div>}
    </div>}
    {state && (blocked ? <p>{blocked.label} <Link href={`${project}/${blocked.path}`}>해당 단계로 이동</Link></p> :
      !state.editCompleted ? <div><Button disabled={unavailable} onClick={() => void run({ action: "complete-edit" })}>
        수정 확인 완료 · 검수로
      </Button></div> : entry ? <Link className="action-link" href={reviewPath}>현재 내용 검수하기</Link> : <>
        {state.approved && <div className="stack">
          <h3 ref={approvedHeading} tabIndex={-1}>내용 버전 r{state.revision}의 검수를 승인했어요</h3>
          <Link className="action-link" href={`${project}/render#local-render-heading`}>영상 만들기로 이동</Link>
        </div>}
        <p>필수 {required.length}개 중 {passed}개 통과</p>
        {groups.map(([source, title]) => {
          const items = state.items.filter(item => item.source === source);
          return items.length > 0 && <section className="stack" key={source} aria-label={title}>
            <h3>{title}</h3>
            {items.map(item => <ProjectReviewItem key={item.id} item={item} readOnly={state.approved}
              busy={unavailable} note={notes[item.id] ?? item.note ?? ""}
              setNote={note => setNotes(current => ({ ...current, [item.id]: note }))}
              save={status => run({ action: "review-item", input: { itemId: item.id, status, note: (notes[item.id] ?? item.note ?? "").trim() } })} />)}
          </section>;
        })}
        {!state.approved && <>
          {incomplete.length > 0 && <ul aria-label="남은 필수 검수 항목">{incomplete.map(item => <li key={item.id}>{item.label}</li>)}</ul>}
          <div><Button disabled={unavailable} focusableWhenBlocked
            disabledReason={incomplete.length > 0 ? `필수 ${incomplete.length}개를 통과해야 해요.` :
              required.length === 0 ? "필수 검수 항목을 확인해 주세요." :
              unsavedNote ? "편집한 검수 메모를 먼저 저장해 주세요." : undefined}
            onClick={() => void run({ action: "approve-review" })}>검수 승인</Button></div>
        </>}
      </>)}
  </Card>;
}

function ProjectReviewItem({ item, note, busy, readOnly, save, setNote }: {
  item: Item; note: string; busy: boolean; readOnly: boolean;
  save: (status: Item["status"]) => Promise<boolean | undefined>; setNote: (note: string) => void;
}) {
  const headingId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const [holding, setHolding] = useState(false);
  const status = display[item.status];
  async function saveAndFocus(status: Item["status"]) {
    if (await save(status)) {
      setHolding(false);
      focus(title);
    }
  }

  return <Card className="stack" aria-labelledby={headingId}>
    <h4 ref={title} id={headingId} tabIndex={-1}>{item.label}{item.required ? " · 필수" : ""}</h4>
    <StatusPill status={status.status}>{status.label}</StatusPill>
    {readOnly ? item.note && <p style={{ whiteSpace: "pre-wrap" }}>{item.note}</p> : <>
      <Field label={holding ? "보류 사유" : "검수 메모"}
        help={note.trim() !== (item.note ?? "") ? "판정을 저장하면 이 메모도 함께 저장돼요." : undefined}>
        <textarea ref={noteInput} value={note} maxLength={2000} disabled={busy} onChange={event => setNote(event.target.value)} />
      </Field>
      <div className="row">
        <Button size="sm" variant="secondary" disabled={busy} aria-pressed={item.status === "pass"} onClick={() => void saveAndFocus("pass")}>통과</Button>
        <Button size="sm" variant="secondary" disabled={busy} aria-pressed={item.status === "hold"} onClick={() => {
          setHolding(true);
          noteInput.current?.focus();
        }}>보류</Button>
        <Button size="sm" variant="ghost" disabled={busy} aria-pressed={item.status === "unchecked"} onClick={() => void saveAndFocus("unchecked")}>미확인</Button>
        {holding && <Button size="sm" disabled={busy} disabledReason={!note.trim() ? "보류 사유를 적어 주세요." : undefined}
          onClick={() => void saveAndFocus("hold")}>보류 사유 저장</Button>}
      </div>
    </>}
  </Card>;
}
