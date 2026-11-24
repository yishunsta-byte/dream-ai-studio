"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 } from "uuid";
import { Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import { classifyApprove, classifyBriefRead, cloudBriefPath, nextAttempt, type Attempt, type Brief, type BriefRead } from "./managed-project-requests";

// P1-02 클라우드 브리프 확인·승인(Backend e91a89c GET/POST /api/projects/:id/brief).
// 화면은 서버가 준 최신 revision으로만 승인하고, 409(프로젝트 변경)면 최신 내용을 다시 읽어 다시 확인하게 한다.
// 결과를 모르는 승인(연결 끊김·503)은 같은 revision이면 같은 요청 키로 다시 보내 승인 기록이 하나만 남게 한다.
// 승인됐다고 말하는 것은 서버 200 {stage:"plan"} 뒤 다시 읽은 상태가 승인일 때뿐이다.
// P1-08: 페이지가 기획 주소를 넘겨 줬고(관리형 기획 지정) 다시 읽은 기획 단계가 열려 있을 때만 기획 링크를 보인다.
// P2-MANAGED-WORKSPACE-BRIEF-NEXT-STEP-COPY: 승인 뒤 다음 할 일 안내도 같은 두 조건(기획 주소·다시 읽은 기획 단계)으로 고른다.

type StageStatus = Brief["stages"]["plan"];
/** 브리프 승인 뒤 다음 할 일. 기획 링크가 보이는 조건과 같은 조건만 쓴다(추가 요청 없음). */
export function briefNextStep(planHref: string | undefined, plan: StageStatus): { planLink: boolean; body: string } {
  if (plan === "locked") return { planLink: false, body: "기획 단계는 아직 열리지 않았어요. 프로젝트 보기에서 단계 상태를 확인해 주세요." };
  if (planHref) return { planLink: true, body: "기획 단계가 열렸어요. ‘기획하러 가기’에서 이어 갈 수 있어요." };
  return { planLink: false, body: "클라우드 기획 화면은 아직 준비 중이라 프로젝트 보기에서 단계 상태를 확인할 수 있어요." };
}

type Message = { tone: "warning" | "info"; title: string; body: string; login?: boolean };
const stageLabel = { locked: "잠김", todo: "확인 전", in_progress: "진행 중", needs_approval: "승인 대기", approved: "승인됨", failed: "실패" } as const;
const stagePill = { locked: "locked", todo: "queued", in_progress: "running", needs_approval: "approval", approved: "done", failed: "failed" } as const;

async function readBrief(id: string, signal?: AbortSignal): Promise<BriefRead> {
  try {
    const response = await fetch(`/api/projects/${id}/brief`, { credentials: "same-origin", cache: "no-store", signal });
    return classifyBriefRead(response.status, await response.json().catch(() => null));
  } catch { return { kind: "failed" }; }
}

function Summary({ brief }: { brief: Brief }) {
  const rows: [string, string | number | null][] = [["제목", brief.title], ["목표", brief.goal], ["보는 사람(타깃)", brief.target], ["화면 비율", brief.aspect],
    ["목표 길이", `${brief.lengthSec}초`], ["상품명", brief.product], ["확인된 장점", brief.facts], ["장점 출처", brief.sources], ["제품 이미지 사용권", brief.rights]];
  return <Card><h2>등록한 내용</h2><dl className="project-inputs">
    {rows.filter(([, value]) => value !== null && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl></Card>;
}

export function ManagedBriefPanel({ projectId, planHref }: { projectId: string; planHref?: string }) {
  const [state, setState] = useState<BriefRead | { kind: "loading" }>({ kind: "loading" });
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>();
  const unresolved = useRef<Attempt | undefined>(undefined);
  const reload = useCallback(async () => {
    const next = await readBrief(projectId);
    setState(next);
    return next;
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    void readBrief(projectId, controller.signal).then(next => { if (!controller.signal.aborted) setState(next); });
    return () => controller.abort();
  }, [projectId]);

  async function approve() {
    if (pending || state.kind !== "ok" || !ack) return;
    const revision = state.brief.revision;
    const attempt = nextAttempt(unresolved.current, JSON.stringify({ acknowledged: true, revision }), () => v7());
    unresolved.current = attempt;
    setPending(true); setMessage(undefined);
    let outcome: ReturnType<typeof classifyApprove>;
    try {
      const response = await fetch(`/api/projects/${projectId}/brief`, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": attempt.key }, body: attempt.body });
      outcome = classifyApprove(response.status, await response.json().catch(() => null), revision);
    } catch { outcome = { kind: "unknown" }; }
    if (outcome.kind !== "unknown") unresolved.current = undefined;
    if (outcome.kind === "approved" || outcome.kind === "stale") {
      const latest = await reload();
      setAck(false);
      if (outcome.kind === "approved") setMessage(latest.kind === "ok" && latest.brief.stages.brief === "approved"
        ? { tone: "info", title: "브리프를 승인했어요", body: briefNextStep(planHref, latest.brief.stages.plan).body }
        : { tone: "warning", title: "승인 결과를 다시 확인해 주세요", body: "승인 응답은 받았지만 최신 상태를 읽지 못했어요. 잠시 뒤 새로고침해 주세요." });
      else setMessage({ tone: "warning", title: "프로젝트가 바뀌었어요", body: "최신 내용을 다시 불러왔어요. 다시 살펴본 뒤 승인해 주세요." });
    }
    if (outcome.kind === "unknown") setMessage({ tone: "warning", title: "승인됐는지 확인하지 못했어요",
      body: "연결이 끊겼거나 프로젝트 저장소가 응답하지 않았어요. 다시 누르면 같은 요청으로 확인해서 두 번 승인되지 않아요." });
    if (outcome.kind === "key-conflict") setMessage({ tone: "warning", title: "다시 확인이 필요해요", body: "이전 요청과 내용이 달라요. 최신 내용을 확인하고 다시 승인해 주세요." });
    if (outcome.kind === "missing") setState({ kind: "missing" });
    if (outcome.kind === "invalid") setMessage({ tone: "warning", title: "승인하지 못했어요", body: outcome.message });
    if (outcome.kind === "login" || outcome.kind === "forbidden") setMessage({ tone: "warning", title: "다시 로그인해 주세요",
      body: "로그인이 끝나 승인하지 않았어요. 로그인한 뒤 이 화면으로 돌아와 다시 승인해 주세요.", login: true });
    setPending(false);
  }

  const loginLink = <Link href={`/login?next=${encodeURIComponent(cloudBriefPath(projectId))}`}>로그인</Link>;
  if (state.kind === "loading") return <p role="status" className="muted">브리프를 불러오고 있어요.</p>;
  if (state.kind === "missing") return <Callout tone="warning" title="프로젝트를 찾을 수 없어요"><p>주소를 확인하거나 <Link href="/cloud/projects">내 프로젝트</Link>에서 열어 주세요.</p></Callout>;
  if (state.kind === "login" || state.kind === "forbidden") return <Callout tone="warning" title="브리프를 볼 수 없어요"><p>{state.kind === "login" ? "로그인이 끝났어요." : "허용된 계정으로 로그인해 주세요."} {loginLink}</p></Callout>;
  if (state.kind === "unavailable" || state.kind === "failed") return <Callout tone="warning" title={state.kind === "unavailable" ? "프로젝트 저장소에 연결할 수 없어요" : "브리프를 불러오지 못했어요"}>
    <p>잠시 뒤 다시 불러와 주세요.</p>
    <Button type="button" variant="secondary" size="sm" onClick={() => { setState({ kind: "loading" }); void reload(); }}>다시 불러오기</Button>
  </Callout>;
  const { brief } = state;
  const approved = brief.stages.brief === "approved";
  const next = briefNextStep(planHref, brief.stages.plan);
  const ready = brief.stages.intake === "approved" && brief.stages.brief === "todo" && brief.stages.plan === "locked";
  return <div className="stack" aria-busy={pending || undefined}>
    <Summary brief={brief} />
    <Card><h2>단계</h2><ul className="stack">
      {(["intake", "brief", "plan"] as const).map(stage => <li key={stage}>{{ intake: "등록", brief: "브리프", plan: "기획" }[stage]} · <StatusPill status={stagePill[brief.stages[stage]]}>{stageLabel[brief.stages[stage]]}</StatusPill></li>)}
    </ul><p className="muted">내용 버전 {brief.revision}</p></Card>
    {message && <Callout tone={message.tone} title={message.title}><p role={message.tone === "warning" ? "alert" : "status"}>{message.body}</p>{message.login && <p>{loginLink}</p>}</Callout>}
    {approved ? <>{!message && !next.planLink && <p className="muted">{next.body}</p>}<p className="cluster">{next.planLink && planHref && <Link className="action-link" href={planHref}>기획하러 가기</Link>}
      <Link className={next.planLink ? undefined : "action-link"} href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link></p></>
      : ready ? <Card><div className="stack">
        <label><input type="checkbox" checked={ack} disabled={pending} onChange={event => setAck(event.target.checked)} /> 등록한 내용과 확인할 내용을 살펴봤어요</label>
        <div><Button type="button" loading={pending} loadingLabel="승인 중" disabled={!ack} disabledReason={ack ? undefined : "내용을 살펴본 뒤 표시해 주세요"} onClick={() => void approve()}>브리프 승인</Button></div>
      </div></Card>
      : <Callout tone="info" title="지금은 브리프를 승인할 수 없어요"><p>프로젝트 단계가 승인할 수 있는 상태가 아니에요. <Link href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link></p></Callout>}
  </div>;
}
