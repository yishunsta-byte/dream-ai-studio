"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useSessionBoundary } from "@/components/auth/session-boundary";
import { Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import { useAdminSection } from "./admin-navigation";
import styles from "./admin.module.css";

const payloadSchema = z.object({
  jobs: z.array(z.object({
    jobId: z.uuid(), projectId: z.uuid(), projectTitle: z.string(),
    status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
    statusLabel: z.string(),
    createdAt: z.iso.datetime(),
  })).max(50),
});
type Job = z.infer<typeof payloadSchema>["jobs"][number];
type Queue = { kind: "loading" | "unavailable" | "denied" | "failed" } | { kind: "ready"; jobs: Job[] };
const pills = { queued: "queued", running: "running", succeeded: "done", failed: "failed", canceled: "canceled" } as const;
const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

async function loadQueue(signal: AbortSignal): Promise<Queue> {
  try {
    const response = await fetch("/api/admin/render-queue", { signal, credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) return { kind: "denied" };
    if (response.status === 503) return { kind: "unavailable" };
    if (!response.ok) return { kind: "failed" };
    const parsed = payloadSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", jobs: parsed.data.jobs } : { kind: "failed" };
  } catch { return { kind: "failed" }; }
}

function RenderQueueList() {
  const [state, setState] = useState<Queue>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadQueue(controller.signal).then(next => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, [attempt]);

  return <>
    <div aria-live="polite">
      {state.kind === "loading" && <p role="status">렌더 작업을 불러오고 있어요.</p>}
      {state.kind === "unavailable" && <Callout tone="warning" title="렌더 대기열에 연결할 수 없어요">
        <p>연결 상태를 확인한 뒤 다시 조회해 주세요.</p>
      </Callout>}
      {state.kind === "denied" && <Callout tone="warning" title="렌더 대기열을 볼 수 없어요">
        <p>관리자 계정으로 다시 로그인해 주세요.</p>
        <Link href="/admin/login" className={styles.link}>관리자 로그인</Link>
      </Callout>}
      {state.kind === "failed" && <Callout tone="warning" title="렌더 작업을 불러오지 못했어요">
        <p>잠시 뒤 다시 조회해 주세요.</p>
      </Callout>}
      {state.kind === "ready" && <Card>
        <p className={styles.note}>격리 환경에서 확인한 본인 렌더 작업 {state.jobs.length}건</p>
        {state.jobs.length === 0 ? <p>렌더 작업이 없어요.</p> : <ul className={styles.renderQueueRows}>
          {state.jobs.map(job => <li key={job.jobId}>
            <Link className={styles.link} href={`/cloud/projects/${job.projectId}#admin-project-heading`}>{job.projectTitle}</Link>
            <StatusPill status={pills[job.status]}>{job.statusLabel}</StatusPill>
            <time className={styles.note} dateTime={job.createdAt}>{time.format(new Date(job.createdAt))} (한국시간)</time>
          </li>)}
        </ul>}
      </Card>}
    </div>
    {state.kind !== "denied" && <div>
      <Button variant="secondary" aria-disabled={state.kind === "loading" || undefined} onClick={() => {
        if (state.kind === "loading") return;
        setState({ kind: "loading" });
        setAttempt(value => value + 1);
      }}>렌더 대기열 다시 조회</Button>
    </div>}
  </>;
}

export function AdminRenderQueue() {
  const section = useAdminSection();
  const session = useSessionBoundary();
  const active = section === "admin-render-queue" && (!session || (!session.cleared && session.view === "current"));
  return <>
    <h2 id="admin-render-queue-heading" tabIndex={-1}>렌더 작업 대기열</h2>
    <p className={styles.note}>내 프로젝트의 최근 작업을 최대 50건까지 보여줘요.</p>
    {active && <RenderQueueList key={session?.epoch ?? 0} />}
  </>;
}
