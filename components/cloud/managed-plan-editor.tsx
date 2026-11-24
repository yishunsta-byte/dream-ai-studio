"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { planningInputSchema } from "@/lib/domain/planning-draft";
import { Badge, Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import { Field } from "@/components/ui/interactive";
import {
  classifyApprovePlan, classifyPlanRead, classifySave, cloudPlanPath, initialScenes, planApiPath, sameDraft, savedByRead, totalSec,
  type PlanDraft, type PlanRead, type PlanState, type SceneDraft,
} from "./managed-plan-requests";

// P1-08 클라우드 기획 읽기·초안 저장·명시 승인(Backend 4fba696, Master msg_daf0eaf6b86c).
// - 저장은 서버가 준 revision·version을 그대로 보내고, 409면 최신 상태를 다시 읽는다. 내 수정은 지우지 않고 '최신 저장본으로 바꾸기'를 따로 둔다.
// - 저장 응답을 잃으면 다시 읽어 버전+1·같은 내용이면 저장된 것으로, 아니면 저장 안 됨으로 말한다.
// - 승인은 저장된 최신 초안(planId·version·revision)과 명시 확인으로만 보낸다. 결과를 모르면 같은 요청을 다시 보내도 서버가 같은 결과를 준다.
// - 쇼츠 작업실에서 가져온 부가 자료가 있으면 장면 구성은 잠그고 대본만 고친다(서버가 장면 변경을 거절).

type Message = { tone: "info" | "warning"; title: string; body: string; login?: boolean; replace?: boolean };
type Edit = { script: string; scenes: (Omit<SceneDraft, "durationSec"> & { durationSec: number | "" })[] };

async function readPlan(id: string, signal?: AbortSignal): Promise<PlanRead> {
  try {
    const response = await fetch(planApiPath(id), { credentials: "same-origin", cache: "no-store", signal });
    return classifyPlanRead(response.status, await response.json().catch(() => null));
  } catch { return { kind: "failed" }; }
}
async function post(id: string, body: unknown) {
  const response = await fetch(planApiPath(id), { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) as unknown };
}
const editOf = (plan: PlanState): Edit => plan.draft ? structuredClone(plan.draft) : { script: "", scenes: initialScenes(plan.steps, plan.lengthSec) };
const draftOf = (edit: Edit): PlanDraft => ({ script: edit.script, scenes: edit.scenes.map(scene => ({ ...scene, durationSec: scene.durationSec === "" ? 0 : scene.durationSec })) });

export function ManagedPlanEditor({ projectId, scenesHref }: { projectId: string; scenesHref?: string }) {
  const [read, setRead] = useState<PlanRead | { kind: "loading" }>({ kind: "loading" });
  const [edit, setEdit] = useState<Edit>();
  const [message, setMessage] = useState<Message>();
  const [pending, setPending] = useState<"save" | "approve" | "reload">();
  const [ack, setAck] = useState(false);
  const [invalid, setInvalid] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void readPlan(projectId, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setRead(next);
      if (next.kind === "ok") setEdit(editOf(next.plan));
    });
    return () => controller.abort();
  }, [projectId]);

  /** 최신 상태를 다시 읽는다. keep이면 편집 중인 내용은 그대로 둔다. */
  async function refresh(keep: boolean) {
    const next = await readPlan(projectId);
    setRead(next);
    if (next.kind === "ok" && !keep) setEdit(editOf(next.plan));
    return next;
  }

  const plan = read.kind === "ok" ? read.plan : undefined;
  const saved = useMemo(() => plan ? editOf(plan) : undefined, [plan]);
  const dirty = !!edit && !!saved && !sameDraft(draftOf(edit), draftOf(saved));
  const locked = !!plan?.materials;
  const total = edit ? totalSec(draftOf(edit).scenes) : 0;

  async function save() {
    if (!plan || !edit || pending || !plan.writable) return;
    const draft = draftOf(edit);
    const checked = planningInputSchema.safeParse(draft);
    if (!checked.success) { setInvalid("대본과 모든 장면의 제목·설명·길이(1초 이상)를 채워 주세요."); return; }
    setInvalid(""); setMessage(undefined); setPending("save");
    const sent = { version: plan.version, draft: checked.data };
    let outcome: ReturnType<typeof classifySave>;
    try { const reply = await post(projectId, { revision: plan.revision, version: plan.version, draft: checked.data }); outcome = classifySave(reply.status, reply.body, sent); }
    catch { outcome = { kind: "unknown" }; }
    if (outcome.kind === "saved") {
      const latest = await refresh(false);
      setMessage(latest.kind === "ok" ? { tone: "info", title: `기획 초안 v${outcome.version}을 저장했어요`, body: latest.plan.canApprove ? "내용을 확인한 뒤 승인할 수 있어요." : "저장한 초안이에요." }
        : { tone: "warning", title: "저장은 됐지만 최신 상태를 읽지 못했어요", body: "잠시 뒤 다시 불러와 주세요." });
    } else if (outcome.kind === "unknown") {
      const latest = await refresh(true);
      if (latest.kind === "ok" && savedByRead(latest.plan, sent)) {
        setEdit(editOf(latest.plan));
        setMessage({ tone: "info", title: `기획 초안 v${latest.plan.version}을 저장했어요`, body: "응답이 끊겼지만 다시 읽어 보니 저장돼 있어요." });
      } else setMessage({ tone: "warning", title: "저장되지 않았어요", body: latest.kind === "ok"
        ? "연결이 끊겼거나 기획 저장소가 응답하지 않았어요. 최신 상태를 다시 읽었고, 내 수정은 남겨 두었어요. 다시 저장해 주세요."
        : "기획 저장소에 연결할 수 없어요. 내 수정은 화면에 남아 있어요. 잠시 뒤 다시 저장해 주세요." });
    } else if (outcome.kind === "conflict") {
      await refresh(true);
      setMessage({ tone: "warning", title: "기획이 바뀌었어요", body: "다른 곳에서 저장했거나 상태가 바뀌었어요. 최신 상태를 다시 불러왔고 내 수정은 남겨 두었어요. 확인한 뒤 다시 저장하거나 최신 저장본으로 바꿔 주세요.", replace: true });
    } else if (outcome.kind === "invalid") setMessage({ tone: "warning", title: "저장하지 못했어요", body: outcome.message });
    else if (outcome.kind === "too-large") setMessage({ tone: "warning", title: "초안이 너무 길어요", body: "대본이나 장면 설명을 줄여 주세요." });
    else if (outcome.kind === "missing") setRead({ kind: "missing" });
    else setMessage({ tone: "warning", title: "다시 로그인해 주세요", body: "로그인이 끝나 저장하지 않았어요. 내 수정은 화면에 남아 있어요.", login: true });
    setPending(undefined);
  }

  async function approve() {
    if (!plan || !plan.planId || !plan.canApprove || dirty || !ack || pending) return;
    setMessage(undefined); setPending("approve");
    const sent = { planId: plan.planId, version: plan.version };
    let outcome: ReturnType<typeof classifyApprovePlan>;
    try {
      const reply = await post(projectId, { action: "approve-plan", acknowledged: true, revision: plan.revision, version: plan.version, planId: plan.planId });
      outcome = classifyApprovePlan(reply.status, reply.body, sent);
    } catch { outcome = { kind: "unknown" }; }
    if (outcome.kind === "approved") {
      const latest = await refresh(false);
      setAck(false);
      setMessage(latest.kind === "ok" && latest.plan.approved
        ? { tone: "info", title: "기획을 승인했어요", body: outcome.hostedProduction ? "장면 제작 단계가 열렸어요." : "장면 제작 단계가 열렸어요. 클라우드 장면 제작 화면은 아직 준비 중이에요." }
        : { tone: "warning", title: "승인 결과를 다시 확인해 주세요", body: "승인 응답은 받았지만 최신 상태를 읽지 못했어요. 잠시 뒤 새로고침해 주세요." });
    } else if (outcome.kind === "unknown") setMessage({ tone: "warning", title: "승인됐는지 확인하지 못했어요",
      body: "연결이 끊겼거나 승인 저장소가 응답하지 않았어요. 다시 누르면 같은 승인 요청으로 확인해서 두 번 승인되지 않아요." });
    else if (outcome.kind === "conflict") { await refresh(false); setAck(false); setMessage({ tone: "warning", title: "기획이 바뀌었어요", body: "최신 상태를 다시 불러왔어요. 다시 살펴본 뒤 승인해 주세요." }); }
    else if (outcome.kind === "materials-stale") setMessage({ tone: "warning", title: "부가 자료를 다시 확인해 주세요", body: "대본과 부가 자료의 생성 조건이 맞지 않아요. 쇼츠 작업실에서 다시 가져와 주세요." });
    else if (outcome.kind === "not-here") setMessage({ tone: "warning", title: "지금은 승인할 수 없어요", body: "현재 환경에서는 기획 승인이 연결되지 않았어요." });
    else if (outcome.kind === "invalid") setMessage({ tone: "warning", title: "승인하지 못했어요", body: outcome.message });
    else if (outcome.kind === "missing") setRead({ kind: "missing" });
    else setMessage({ tone: "warning", title: "다시 로그인해 주세요", body: "로그인이 끝나 승인하지 않았어요. 로그인한 뒤 이 화면에서 다시 승인해 주세요.", login: true });
    setPending(undefined);
  }

  const loginLink = <Link href={`/login?next=${encodeURIComponent(cloudPlanPath(projectId))}`}>로그인</Link>;
  if (read.kind === "loading") return <p role="status" className="muted">기획을 불러오고 있어요.</p>;
  if (read.kind === "missing") return <Callout tone="warning" title="프로젝트를 찾을 수 없어요"><p>주소를 확인하거나 <Link href="/cloud/projects">내 프로젝트</Link>에서 열어 주세요.</p></Callout>;
  if (read.kind === "brief-first") return <Callout tone="info" title="브리프를 먼저 승인해 주세요"><p>브리프를 승인하면 기획 단계가 열려요. <Link href={`/cloud/projects/${projectId}/brief`}>브리프 확인</Link></p></Callout>;
  if (read.kind === "login" || read.kind === "forbidden") return <Callout tone="warning" title="기획을 볼 수 없어요"><p>{read.kind === "login" ? "로그인이 끝났어요." : "허용된 계정으로 로그인해 주세요."} {loginLink}</p></Callout>;
  if (read.kind !== "ok" || !plan || !edit) return <Callout tone="warning" title={read.kind === "unavailable" ? "기획 저장소에 연결할 수 없어요" : "기획을 불러오지 못했어요"}>
    <p>잠시 뒤 다시 불러와 주세요. 저장되지 않은 내용은 없어요.</p>
    <Button type="button" variant="secondary" size="sm" loading={pending === "reload"} onClick={async () => { setPending("reload"); await refresh(false); setPending(undefined); }}>다시 불러오기</Button>
  </Callout>;

  const editable = plan.writable && !plan.approved && !pending;
  const scenesEditable = editable && !locked;
  const setScene = (index: number, patch: Partial<Edit["scenes"][number]>) => setEdit(old => old && ({ ...old, scenes: old.scenes.map((scene, i) => i === index ? { ...scene, ...patch } : scene) }));
  const move = (index: number, by: number) => setEdit(old => {
    if (!old) return old; const scenes = [...old.scenes]; const [scene] = scenes.splice(index, 1); scenes.splice(index + by, 0, scene); return { ...old, scenes };
  });
  const status = plan.approved ? "승인됨" : plan.planId ? `저장된 초안 v${plan.version}` : "아직 저장하지 않음";
  const approveReason = dirty ? "고친 내용을 먼저 저장해 주세요" : !plan.planId ? "초안을 먼저 저장해 주세요"
    : total !== plan.lengthSec ? `장면 길이 합(${total}초)이 목표 길이(${plan.lengthSec}초)와 같아야 승인할 수 있어요`
    : !plan.canApprove ? "지금은 승인할 수 없어요" : !ack ? "내용을 살펴본 뒤 표시해 주세요" : undefined;

  return <div className="stack" aria-busy={pending ? true : undefined}>
    <Card><div className="stack">
      <h2>기획 상태</h2>
      <p><StatusPill status={plan.approved ? "done" : plan.planId ? "approval" : "queued"}>{status}</StatusPill>{dirty && <> <Badge>저장 안 한 수정 있음</Badge></>}</p>
      <p>목표 {plan.lengthSec}초 · 지금 {total}초 {total !== plan.lengthSec && <Badge>차이 {total - plan.lengthSec}초</Badge>}</p>
      {plan.approved && <p className="muted">{plan.produceOpen ? "장면 제작 단계가 열렸어요." : "장면 제작 단계는 아직 잠겨 있어요."}{plan.hostedProductionAvailable === false && " 클라우드 장면 제작 화면은 아직 준비 중이에요."}</p>}
    </div></Card>
    {message && <Callout tone={message.tone} title={message.title}>
      <p role={message.tone === "warning" ? "alert" : "status"}>{message.body}</p>
      {message.login && <p>{loginLink}</p>}
      {message.replace && dirty && <Button type="button" variant="secondary" size="sm" onClick={() => { setEdit(editOf(plan)); setMessage(undefined); }}>최신 저장본으로 바꾸기</Button>}
    </Callout>}
    {!plan.writable && !plan.approved && <Callout tone="info" title="지금은 기획을 고칠 수 없어요"><p>프로젝트 단계가 바뀌었어요. 저장된 내용만 볼 수 있어요.</p></Callout>}
    {locked && !plan.approved && <Callout tone="info" title="장면 구성은 쇼츠 작업실 자료에 맞춰 잠겨 있어요"><p>부가 자료와 연결된 장면이라 여기서는 대본만 고칠 수 있어요.</p></Callout>}
    {invalid && <Callout tone="warning" title="저장하기 전에 확인해 주세요"><p role="alert">{invalid}</p></Callout>}
    <Card><Field label="전체 대본" required>
      <textarea id="plan-script" value={edit.script} readOnly={!editable} maxLength={20000} rows={6} onChange={event => setEdit(old => old && ({ ...old, script: event.target.value }))} />
    </Field></Card>
    <ol className="stack" aria-label="장면">{edit.scenes.map((scene, index) => <li key={index}><Card><div className="stack">
      <h3>장면 {index + 1}</h3>
      <Field label="단계"><select id={`scene-${index}-step`} value={scene.stepId} disabled={!scenesEditable} onChange={event => setScene(index, { stepId: event.target.value })}>
        {plan.steps.map(step => <option key={step.id} value={step.id}>{step.label}</option>)}<option value="custom">직접 추가한 장면</option>
      </select></Field>
      <Field label="장면 제목" required><input id={`scene-${index}-title`} value={scene.title} readOnly={!scenesEditable} maxLength={120} onChange={event => setScene(index, { title: event.target.value })} /></Field>
      <Field label="장면 설명" required><textarea id={`scene-${index}-description`} value={scene.description} readOnly={!scenesEditable} maxLength={2000} rows={3} onChange={event => setScene(index, { description: event.target.value })} /></Field>
      <Field label="대사·나레이션"><textarea id={`scene-${index}-dialogue`} value={scene.dialogue} readOnly={!scenesEditable} maxLength={4000} rows={2} onChange={event => setScene(index, { dialogue: event.target.value })} /></Field>
      <Field label="길이(초)" required><input id={`scene-${index}-duration`} type="number" min={1} max={600} value={scene.durationSec} readOnly={!scenesEditable}
        onChange={event => setScene(index, { durationSec: event.target.value === "" ? "" : Math.trunc(Number(event.target.value)) })} /></Field>
      {scenesEditable && <div className="cluster">
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)}>위로</Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === edit.scenes.length - 1} onClick={() => move(index, 1)}>아래로</Button>
        <Button type="button" variant="ghost" size="sm" disabled={edit.scenes.length === 1} onClick={() => setEdit(old => old && ({ ...old, scenes: old.scenes.filter((_, i) => i !== index) }))}>장면 삭제</Button>
      </div>}
    </div></Card></li>)}</ol>
    {scenesEditable && edit.scenes.length < 100 && <div><Button type="button" variant="secondary" onClick={() => setEdit(old => old && ({ ...old, scenes: [...old.scenes,
      { stepId: "custom", title: "", description: "", dialogue: "", durationSec: 1, characterIds: [], assetIds: [] }] }))}>장면 추가</Button></div>}
    {plan.writable && !plan.approved && <div><Button type="button" loading={pending === "save"} loadingLabel="저장 중" disabled={!!pending || (!dirty && !!plan.planId)}
      disabledReason={!dirty && plan.planId ? "고친 내용이 없어요" : undefined} onClick={() => void save()}>{plan.planId ? "새 기획 버전 저장" : "기획 초안 저장"}</Button></div>}
    {!plan.approved && plan.planId && <Card><div className="stack">
      <h2>기획 승인</h2>
      <p>승인하면 장면표가 확정되고 장면 제작 단계가 열려요. 승인한 기획은 고칠 수 없어요.</p>
      <label><input type="checkbox" checked={ack} disabled={!!pending || dirty || !plan.canApprove} onChange={event => setAck(event.target.checked)} /> 대본과 장면 구성을 살펴봤어요</label>
      <div><Button type="button" loading={pending === "approve"} loadingLabel="승인 중" disabled={!!approveReason || !!pending} disabledReason={approveReason} onClick={() => void approve()}>기획 승인</Button></div>
    </div></Card>}
    {/* P2-MANAGED-SOURCE-SCENE-PANEL: 승인됐고 장면 제작 단계가 열렸으면 장면 결과 화면으로 이어 준다. */}
    <p className="cluster">{scenesHref && plan.approved && plan.produceOpen && <Link className="action-link" href={scenesHref}>장면 결과 보기</Link>}<Link href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link></p>
  </div>;
}
