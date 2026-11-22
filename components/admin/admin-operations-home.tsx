"use client";

import { useEffect, useState } from "react";
import { useSessionBoundary } from "@/components/auth/session-boundary";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/primitives";
import type { StyleDnaSummary } from "@/lib/reference-analysis/style-dna-contract";
import { analysisResultsSection, useAdminSection } from "./admin-navigation";
import { homeSectionId, reviewSectionId, styleDnaPath } from "./admin-paths";
import { stageOf, type PublicationList } from "./publication-model";
import { readStyleDnaLibrary } from "./style-dna-client";
import hub from "./admin.module.css";
import styles from "./admin-operations-home.module.css";

// 관리자 홈 2안(운영 대시보드, Design admin-renewal-options/HANDOFF.md · Master msg_d8399b51662f·msg_5ec7848cc1ad·msg_0e494ddbfe2f).
// 작업 상태 카드와 최근 분석 기록은 실제 조회한 응답으로 표시한다.
// - 검수 대기: 서버가 같은 인증 뒤 읽은 게시 큐 첫 목록(검수 대기 단계 수). 미연결·실패면 그대로 말한다.
// - 렌더 진행·재시도 필요: 기존 보호 GET /api/admin/render-queue(내 최근 작업 최대 50건). 전체 건수로 부풀리지 않고 제공 범위를 적는다.
// - 최근 분석 기록: 기존 보호 GET /api/admin/style-dna(소유자 이미지 보관함)만. 오디오·쇼츠는 저장 기록이 없어 나오지 않는다고 적는다.
// 이 칸이 보일 때(홈이 현재 칸이고 세션이 현재일 때)만 조회하고, 제목 등 사용자 데이터는 기록(console)에 남기지 않는다.

const RECENT_LIMIT = 5;
const time = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const jobStatuses = new Set(["queued", "running", "succeeded", "failed", "canceled"]);

export type HomeQueue = { kind: "loading" | "unavailable" | "denied" | "failed" } | { kind: "ready"; total: number; active: number; failed: number };
export type HomeLibrary = { kind: "loading" | "unavailable" | "denied" | "failed" } | { kind: "ready"; items: StyleDnaSummary[] };

/** 렌더 대기열 응답을 홈 카드 값으로 바꾼다(형식이 틀리면 실패, 건수를 지어내지 않음). */
export async function readHomeQueue(response: Response): Promise<HomeQueue> {
  if (response.status === 401 || response.status === 403) return { kind: "denied" };
  if (response.status === 503) return { kind: "unavailable" };
  if (!response.ok) return { kind: "failed" };
  const body = await response.json().catch(() => null) as { jobs?: unknown } | null;
  if (!Array.isArray(body?.jobs) || body.jobs.length > 50) return { kind: "failed" };
  const statuses = body.jobs.map(job => (job && typeof job === "object" && "status" in job ? String(job.status) : ""));
  if (statuses.some(status => !jobStatuses.has(status))) return { kind: "failed" };
  return { kind: "ready", total: statuses.length, active: statuses.filter(status => status === "queued" || status === "running").length,
    failed: statuses.filter(status => status === "failed").length };
}

async function loadQueue(signal: AbortSignal): Promise<HomeQueue> {
  try {
    return await readHomeQueue(await fetch("/api/admin/render-queue", { signal, credentials: "same-origin", cache: "no-store" }));
  } catch { return { kind: "failed" }; }
}

async function loadLibrary(signal: AbortSignal): Promise<HomeLibrary> {
  try {
    const outcome = await readStyleDnaLibrary(signal);
    if (outcome.kind === "ok") return { kind: "ready", items: [...outcome.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT_LIMIT) };
    if (outcome.kind === "login" || outcome.kind === "forbidden") return { kind: "denied" };
    return { kind: outcome.kind };
  } catch { return { kind: "failed" }; }
}

function Stat({ label, value, detail, href, tone }: { label: string; value: string; detail: string; href: string; tone: "review" | "render" | "retry" }) {
  return <a className={styles.stat} data-tone={tone} href={href}>
    <span className={styles.statLabel}>{label}</span>
    <strong className={styles.statValue}>{value}</strong>
    <small className={styles.statDetail}>{detail}</small>
  </a>;
}

export const queueValue = (queue: HomeQueue, pick: "active" | "failed") => queue.kind === "ready" ? `${queue[pick]}건`
  : { loading: "확인 중", unavailable: "연결 안 됨", denied: "볼 수 없음", failed: "불러오지 못함" }[queue.kind];
const queueDetail = (queue: HomeQueue) => queue.kind === "ready" ? `내 최근 렌더 작업 ${queue.total}건 기준(최대 50건)`
  : queue.kind === "loading" ? "렌더 대기열을 조회하고 있어요" : "렌더 대기열 목록에서 확인";

/** 검수 대기 카드: 화면을 연 시점의 게시 큐 첫 목록에서 검수 대기 단계 수. 미연결·실패는 그대로. */
export function reviewStat(publications: PublicationList) {
  if (publications.kind === "closed") return { value: "연결 안 됨", detail: "게시 저장소가 연결되지 않았어요" };
  if (publications.kind === "failed") return { value: "불러오지 못함", detail: "완성본 목록에서 다시 조회" };
  const waiting = publications.items.filter(item => stageOf(item) === "candidate").length;
  return { value: `${waiting}건`, detail: `화면을 연 시점의 완성본 ${publications.items.length}건 기준` };
}

function RecentRecords({ library, retry }: { library: HomeLibrary; retry: () => void }) {
  if (library.kind === "loading") return <p role="status" className={hub.note}>최근 이미지 분석 기록을 불러오고 있어요.</p>;
  if (library.kind === "unavailable") return <p className={hub.note}>이미지 분석 보관함에 연결할 수 없어요.</p>;
  if (library.kind === "denied") return <p className={hub.note}>기록을 볼 수 없어요. 관리자 계정으로 다시 로그인해 주세요. <a className={hub.link} href="/admin/login">관리자 로그인</a></p>;
  if (library.kind === "failed") return <div className={styles.recordProblem}>
    <p className={hub.note}>최근 이미지 분석 기록을 불러오지 못했어요.</p>
    <Button type="button" variant="secondary" size="sm" onClick={retry}>다시 불러오기</Button>
  </div>;
  if (library.kind !== "ready") return null;
  if (library.items.length === 0) return <p className={hub.note}>아직 보관함에 저장한 이미지 분석 기록이 없어요.</p>;
  return <ul className={styles.records}>
    {library.items.map(item => <li key={item.id}>
      <a className={styles.record} href={styleDnaPath}>
        <span className={styles.recordText}>
          <strong>{item.title}</strong>
          <small>이미지 분석 · <time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))}</time></small>
        </span>
        <span className={styles.recordState}>버전 {item.revision}</span>
        <Icon name="arrow" />
      </a>
    </li>)}
  </ul>;
}

function HomeData({ publications }: { publications: PublicationList }) {
  const [queue, setQueue] = useState<HomeQueue>({ kind: "loading" });
  const [library, setLibrary] = useState<HomeLibrary>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadQueue(controller.signal).then(next => { if (!controller.signal.aborted) setQueue(next); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadLibrary(controller.signal).then(next => { if (!controller.signal.aborted) setLibrary(next); });
    return () => controller.abort();
  }, [attempt]);
  const review = reviewStat(publications);
  return <>
    <section className={styles.stats} aria-label="작업 상태" aria-live="polite">
      <Stat tone="review" label="검수 대기" value={review.value} detail={review.detail} href={`#${reviewSectionId}`} />
      <Stat tone="render" label="렌더 진행" value={queueValue(queue, "active")} detail={queueDetail(queue)} href="#admin-render-queue" />
      <Stat tone="retry" label="재시도 필요" value={queueValue(queue, "failed")} detail={queueDetail(queue)} href="#admin-render-queue" />
    </section>
    <section className={styles.recent} aria-labelledby="admin-home-recent">
      <div className={styles.recentHead}>
        <h3 id="admin-home-recent">최근 분석 기록</h3>
        <a className={hub.link} href={`#${analysisResultsSection}`}>분석 결과 공개·게시 관리 <Icon name="arrow" /></a>
      </div>
      <div aria-live="polite"><RecentRecords library={library} retry={() => { setLibrary({ kind: "loading" }); setAttempt(value => value + 1); }} /></div>
      <p className={hub.note}>이미지 보관함의 최근 {RECENT_LIMIT}건까지 보여줘요. 오디오·영상 분석은 아직 기록을 저장하지 않아 여기에 나오지 않아요.</p>
    </section>
  </>;
}

export function AdminOperationsHome({ publications }: { publications: PublicationList }) {
  const section = useAdminSection();
  const session = useSessionBoundary();
  const active = section === homeSectionId && (!session || (!session.cleared && session.view === "current"));
  return <>
    <div className={styles.head}>
      <h2 id="admin-home-heading" tabIndex={-1}>관리자 운영 현황</h2>
      <p className={hub.note}>검수·렌더 대기열과 최근 분석 작업을 확인해요.</p>
    </div>
    {active && <HomeData key={session?.epoch ?? 0} publications={publications} />}
  </>;
}
