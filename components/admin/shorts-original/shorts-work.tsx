"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShortsAnalysisResult } from "@/lib/reference-analysis/shorts-analysis-contract";
import { shortsVaultRetentionDays } from "@/lib/reference-analysis/shorts-vault-contract";
import { createProject, newRequestId, openProject, replaceProject, replyMessage, type Reply } from "./shorts-client";
import { emptyShortsSession, projectDocument, sessionFromProject, viewOfStep, withAnalysis, type ShortsSession } from "./shorts-session";
import type { ShortsStepId } from "./shorts-paths";
import s from "./shorts-studio.module.css";

// P1-08 원본 StudioProvider에 해당하는 셸 상태. 단계 화면은 work로 상태를 읽고 바꾼다.
// - commit: 단계가 끝날 때 상태를 바꾸고 30일 탐색 프로젝트로 저장한다. 저장은 한 줄로 세워(앞 저장이 끝난 뒤 최신 상태로) 버전 경합을 줄인다.
// - 저장이 503(보관함 연결 전)이거나 실패해도 단계 진행은 막지 않는다. 409 stale_revision은 최신 버전 열기·새로 저장을 고르게 한다.
// - 다른 프로젝트를 열거나 새로 시작하면 epoch가 바뀌어, 그 전에 보낸 저장·생성의 늦은 응답은 버린다.
export type ShortsSave =
  | { kind: "idle" } | { kind: "saving" } | { kind: "saved"; expiresAt: string }
  | { kind: "closed" } | { kind: "stale"; id: string } | { kind: "expired" } | { kind: "limit" } | { kind: "failed"; message: string };

export type Project = { id: string; revision: number; expiresAt: string };

/** 프로젝트 저장 응답 → 저장 상태. 성공이면 다음 저장에 쓸 프로젝트(버전)도 돌려준다. 404면 그 프로젝트를 잊는다(forget). */
export function saveResult(reply: Reply<Project>, current: Project | null): { save: ShortsSave; project?: Project; forget?: true } {
  if (reply.kind === "ok") return { save: { kind: "saved", expiresAt: reply.value.expiresAt }, project: reply.value };
  if (reply.kind === "failed" && reply.status === 503) return { save: { kind: "closed" } };
  if (reply.kind === "failed" && reply.code === "stale_revision" && current) return { save: { kind: "stale", id: current.id } };
  if (reply.kind === "failed" && reply.code === "limit_reached") return { save: { kind: "limit" } };
  if (reply.kind === "failed" && reply.status === 404 && current) return { save: { kind: "expired" }, forget: true };
  return { save: { kind: "failed", message: replyMessage(reply as Exclude<typeof reply, { kind: "ok" }>) } };
}

/** F7 지우기 확인을 받았을 때 할 일(순수 판단, 시험 대상).
 * - ignore: 지운 것이 지금 프로젝트가 아니다(다른 프로젝트, 또는 이미 다른 프로젝트로 바뀜).
 * - defer: 지금 프로젝트를 지웠지만 다른 프로젝트를 여는 중이다. 여는 요청은 끊지 않고, 지운 프로젝트 ID만 놓고 저장을 멈춘다.
 *   열기가 성공하면 그 프로젝트로 바뀌고, 실패하면 그때 작업을 비운다(열기 실패 → reset).
 * - reset: 지금 프로젝트를 지웠고 여는 중인 것이 없다. 남은 저장을 끊고 새 작업으로 비운다. */
export function forgetPlan(currentId: string | null, opening: string | null, deletedId: string): "ignore" | "defer" | "reset" {
  if (currentId !== deletedId) return "ignore";
  return opening !== null ? "defer" : "reset";
}

export type ShortsWork = {
  session: ShortsSession;
  /** 저장 없이 상태만 바꾼다(입력 중인 값). */
  update: (patch: Partial<ShortsSession>) => void;
  /** 상태를 바꾸고 프로젝트로 저장한다(단계 완료). */
  commit: (patch: Partial<ShortsSession>) => void;
  /** ② 분석 성공: 근거를 바꾸고 뒤 단계 결과를 비운 뒤 저장한다. */
  setAnalysis: (videoId: string, result: ShortsAnalysisResult, keyword?: string) => void;
  /** 이 시점에 시작한 비동기 작업이 아직 유효한지(다른 프로젝트를 열거나 새로 시작하면 false). */
  alive: () => () => boolean;
  consent: boolean;
  setConsent: (value: boolean) => void;
  save: ShortsSave;
  projectId: string | null;
  /** 보관함 프로젝트를 열어 상태를 바꾸고 이어갈 단계를 돌려준다. */
  /** 실패에 cleared가 true면, 여는 동안 지금 프로젝트가 지워져 작업을 비웠다는 뜻이다(셸은 ①② 화면 상태도 비운다). */
  open: (id: string) => Promise<{ view: ShortsStepId } | { message: string; closed: boolean; cleared?: true }>;
  /** 새 작업으로 비운다(저장된 프로젝트는 그대로). */
  reset: () => void;
  /** 보관함에서 프로젝트를 지운 뒤 부른다. 그 프로젝트가 지금 작업이면 아직 안 끝난 저장을 버리고 새 작업으로 비운 뒤 true, 아니면 false.
   * F7: 다른 프로젝트를 여는 중이면 여는 요청은 끊지 않고 저장만 멈춘 뒤 false(열기 결과가 화면을 정한다). */
  forget: (id: string) => boolean;
  /** 지금 이 순간의 작업 상태(렌더 사이에 끝난 비동기 응답이 최신 값을 볼 때). */
  snapshot: () => ShortsSession;
  /** F1: 지금 이어 쓰는 프로젝트(ID·버전·만료). 탭 저장에 남긴다. 없으면 null. */
  project: () => Project | null;
  /** F1: 탭에 남긴 작업을 되살린다(앞 요청은 끊고, 프로젝트가 있으면 그 버전부터 이어 저장). 저장 요청은 보내지 않는다. */
  restore: (session: ShortsSession, project: Project | null) => void;
  /** 버전이 어긋났을 때 지금 내용을 새 프로젝트로 저장한다. */
  saveAsNew: () => void;
  /** Tester D4: 지금 Gemini 결과를 만드는 중인 단계(없으면 null). 셸은 이때 다른 단계로 옮기기 전에 머무를지 묻는다. */
  busy?: string | null;
  /** Tester D4: running은 단계 요청의 시작·끝을 알린다. mark·take는 만들던 중 떠나 취소된 단계를 남기고, 돌아오면 한 번 알린다.
   *  새 작업·프로젝트 열기·복원(begin)에서 둘 다 비운다. */
  interrupted?: { mark: (step: string) => void; take: (step: string) => boolean; running: (step: string, on: boolean) => void };
};

export function useShortsWork(): ShortsWork {
  const [session, setSession] = useState(emptyShortsSession);
  const [save, setSave] = useState<ShortsSave>({ kind: "idle" });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const latest = useRef(emptyShortsSession);
  const project = useRef<Project | null>(null);
  const epoch = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // F7: 지금 여는 중인 프로젝트 ID, 여는 동안 지워진 지금 프로젝트 ID(지운 작업은 다시 저장하지 않는다).
  const opening = useRef<string | null>(null);
  const deleted = useRef<string | null>(null);
  const controller = useRef(new AbortController());
  useEffect(() => () => controller.current.abort(), []);

  const apply = useCallback((next: ShortsSession) => { latest.current = next; setSession(next); }, []);
  const update = useCallback((patch: Partial<ShortsSession>) => apply({ ...latest.current, ...patch }), [apply]);

  const persist = useCallback(() => {
    const mine = epoch.current;
    queue.current = queue.current.then(async () => {
      // 지운 프로젝트의 작업은 다시 만들거나(POST) 고치지(PUT) 않는다.
      if (mine !== epoch.current || deleted.current) return;
      const document = projectDocument(latest.current);
      if (!document) return;
      setSave({ kind: "saving" });
      const current = project.current;
      const signal = controller.current.signal;
      const reply = current
        ? await replaceProject(current.id, current.revision, document, signal)
        : await createProject(newRequestId(), document, signal);
      if (mine !== epoch.current) return;
      const next = saveResult(reply, current);
      if (next.project) { project.current = { id: next.project.id, revision: next.project.revision, expiresAt: next.project.expiresAt }; setProjectId(next.project.id); }
      // 처음 저장한 제목을 기억해 다음 저장부터 그대로 쓴다(원본: 첫 저장 때 한 번만 정함).
      if (next.project && !latest.current.title) apply({ ...latest.current, title: document.title });
      if (next.forget) { project.current = null; setProjectId(null); }
      setSave(next.save);
    });
  }, [apply]);

  const commit = useCallback((patch: Partial<ShortsSession>) => { update(patch); persist(); }, [update, persist]);
  const setAnalysis = useCallback((videoId: string, result: ShortsAnalysisResult, keyword?: string) => {
    apply(withAnalysis(latest.current, videoId, result, keyword));
    persist();
  }, [apply, persist]);
  const alive = useCallback(() => { const mine = epoch.current; return () => mine === epoch.current; }, []);

  const interruptedSteps = useRef(new Set<string>());
  const [busy, setBusy] = useState<string | null>(null);
  const interrupted = useMemo(() => ({
    mark: (step: string) => { interruptedSteps.current.add(step); },
    take: (step: string) => interruptedSteps.current.delete(step),
    running: (step: string, on: boolean) => setBusy(current => on ? step : current === step ? null : current),
  }), []);

  const begin = useCallback(() => {
    epoch.current += 1;
    interruptedSteps.current.clear();
    setBusy(null);
    opening.current = null;
    deleted.current = null;
    controller.current.abort();
    controller.current = new AbortController();
    queue.current = Promise.resolve();
  }, []);

  const reset = useCallback(() => {
    begin();
    project.current = null;
    setProjectId(null);
    setSave({ kind: "idle" });
    apply(emptyShortsSession);
  }, [apply, begin]);

  const open = useCallback(async (id: string) => {
    begin();
    const mine = epoch.current;
    opening.current = id;
    const reply = await openProject(id, controller.current.signal);
    if (mine !== epoch.current) return { message: "다른 작업이 먼저 열렸어요.", closed: false };
    opening.current = null;
    if (reply.kind !== "ok") {
      const message = reply.kind === "failed" && reply.status === 404 ? "이 프로젝트는 지워졌거나 보관 기간이 지났어요." : replyMessage(reply);
      const closed = reply.kind === "failed" && reply.status === 503;
      // 여는 동안 지금 프로젝트가 지워졌으면, 그 작업을 되살리지 않도록 이제 비운다.
      if (!deleted.current) return { message, closed };
      reset();
      return { message: `${message} 지운 프로젝트의 작업은 비웠어요.`, closed, cleared: true as const };
    }
    deleted.current = null;
    project.current = { id: reply.value.id, revision: reply.value.revision, expiresAt: reply.value.expiresAt };
    setProjectId(reply.value.id);
    setSave({ kind: "saved", expiresAt: reply.value.expiresAt });
    apply(sessionFromProject(reply.value.document));
    return { view: viewOfStep(reply.value.document.step) };
  }, [apply, begin, reset]);

  const saveAsNew = useCallback(() => { project.current = null; setProjectId(null); persist(); }, [persist]);
  const forget = useCallback((id: string) => {
    const plan = forgetPlan(project.current?.id ?? null, opening.current, id);
    if (plan === "ignore") return false;
    if (plan === "defer") {
      // 여는 요청은 그대로 두고, 지운 프로젝트 ID만 놓는다. 열기 결과에 따라 바뀌거나(성공) 비운다(실패).
      deleted.current = id;
      project.current = null;
      setProjectId(null);
      setSave({ kind: "idle" });
      return false;
    }
    reset();
    return true;
  }, [reset]);
  const snapshot = useCallback(() => latest.current, []);
  const currentProject = useCallback(() => project.current, []);
  const restore = useCallback((next: ShortsSession, saved: Project | null) => {
    begin();
    project.current = saved;
    setProjectId(saved?.id ?? null);
    setSave(saved ? { kind: "saved", expiresAt: saved.expiresAt } : { kind: "idle" });
    apply(next);
  }, [apply, begin]);

  return { session, update, commit, setAnalysis, alive, consent, setConsent, save, projectId, open, reset, saveAsNew, forget, snapshot,
    project: currentProject, restore, busy, interrupted };
}

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" });

/** 단계 화면 위 저장 상태 한 줄. 저장 실패는 알리기만 하고 단계는 계속 쓸 수 있다. */
export function ShortsSaveBar({ work, onOpen }: { work: ShortsWork; onOpen: (id: string) => void }) {
  const { save } = work;
  if (save.kind === "idle") return null;
  const text = {
    saving: "프로젝트를 저장하고 있어요…",
    saved: save.kind === "saved" ? `프로젝트에 저장했어요 · ${dateFormat.format(new Date(save.expiresAt))}까지 ${shortsVaultRetentionDays}일 보관` : "",
    closed: "프로젝트 보관함이 아직 연결되지 않아 저장하지 않았어요. 단계는 계속 진행할 수 있어요.",
    stale: "다른 곳에서 이 프로젝트가 먼저 바뀌어 저장하지 않았어요.",
    expired: "보관 기간이 지났거나 지워진 프로젝트라 저장하지 않았어요.",
    limit: "프로젝트를 100개까지 보관할 수 있어요. 홈에서 오래된 프로젝트를 지운 뒤 다시 저장해 주세요.",
    failed: save.kind === "failed" ? `저장하지 못했어요. ${save.message}` : "",
  }[save.kind];
  return <div className={s.saveBar} role="status" data-save={save.kind}>
    <span>{text}</span>
    {save.kind === "stale" && <span className={s.rowActions}>
      <button type="button" className={s.ghost} onClick={() => onOpen(save.id)}>최신 버전 다시 열기</button>
      <button type="button" className={s.ghost} onClick={work.saveAsNew}>지금 내용을 새 프로젝트로 저장</button>
    </span>}
    {save.kind === "expired" && <button type="button" className={s.ghost} onClick={work.saveAsNew}>새 프로젝트로 저장</button>}
  </div>;
}
