"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SceneDraft } from "@/lib/domain/planning-draft";
import { Field } from "@/components/ui/interactive";
import { Button, Card } from "@/components/ui/primitives";

type Draft = { script: string; scenes: SceneDraft[] };
type SavedDraft = { revision: number; version: number; planId: string; draft: Draft };
type Plan = Omit<SavedDraft, "draft" | "planId"> & {
  draft: Draft | null; planId: string | null; writable: boolean; lengthSec: number;
  canApprove: boolean; approved: boolean; produceOpen: boolean; steps: { id: string; label: string }[];
};
const newScene = (stepId = "custom", title = "", durationSec = 1): SceneDraft =>
  ({ stepId, title, durationSec, description: "", dialogue: "", characterIds: [], assetIds: [] });

export function ProjectPlanDraft({ projectId }: { projectId: string }) {
  const endpoint = `/api/projects/${projectId}/plan`;
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>();
  const [script, setScript] = useState("");
  const [rows, setRows] = useState<{ key: number; scene: SceneDraft }[]>([]);
  const nextKey = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const savedCopy = Boolean(plan?.draft && plan.draft.script === script &&
    JSON.stringify(plan.draft.scenes) === JSON.stringify(rows.map(row => row.scene)));
  const busy = pending || approving;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const result: Plan = await response.json();
        if (controller.signal.aborted) return;
        const duration = Math.max(1, Math.floor(result.lengthSec / result.steps.length));
        const scenes = result.draft?.scenes ??
          result.steps.map(step => newScene(step.id, step.label, duration));
        setScript(result.draft?.script ?? "");
        setRows(scenes.map(scene => ({ key: nextKey.current++, scene })));
        setPlan(result);
      } catch {
        if (!controller.signal.aborted) setError("기획 초안을 불러오지 못했어요.");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, endpoint]);

  useEffect(() => {
    if (status && plan?.approved) resultHeading.current?.focus();
  }, [status, plan?.approved]);

  function reload() {
    setPlan(undefined);
    setConflict(false);
    setError("");
    setStatus("");
    setAcknowledged(false);
    setAttempt(value => value + 1);
  }

  function edited() {
    setStatus("");
    setAcknowledged(false);
  }

  function updateScene(key: number, change: Partial<SceneDraft>) {
    setRows(current => current.map(row => row.key === key ? { ...row, scene: { ...row.scene, ...change } } : row));
    edited();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan?.writable || busy || conflict) return;
    setPending(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: plan.revision, version: plan.version,
          draft: { script, scenes: rows.map(row => row.scene) } }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setConflict(true);
          setError("다른 변경이 먼저 저장됐어요. 편집 중인 내용을 복사한 뒤 저장된 초안을 불러올 수 있어요.");
        } else if (response.status === 400 || response.status === 413) {
          setError("대본과 장면의 제목, 설명, 길이를 확인해 주세요. 전체 장면은 7,200초까지 저장할 수 있어요.");
        } else {
          setError("저장 결과를 확인하지 못했어요. 다시 저장할 수 있어요.");
        }
        return;
      }
      const result: SavedDraft = await response.json();
      setPlan({ ...plan, ...result, canApprove: true });
      setAcknowledged(false);
      setScript(result.draft.script);
      setRows(rows.map((row, index) => ({ ...row, scene: result.draft.scenes[index] })));
      setStatus(`초안 버전 ${result.version}을 저장했어요.`);
    } catch {
      setError("저장 결과를 확인하지 못했어요. 다시 저장할 수 있어요.");
    } finally { setPending(false); }
  }

  async function approve() {
    if (!plan?.canApprove || !plan.planId || !savedCopy || !acknowledged || conflict || busy) return;
    setApproving(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-plan", acknowledged, revision: plan.revision,
          version: plan.version, planId: plan.planId }),
      });
      if (response.status === 409) {
        setConflict(true);
        setAcknowledged(false);
        setError("기획 상태가 바뀌었어요. 저장된 초안을 불러온 뒤 다시 확인해 주세요.");
        return;
      }
      if (!response.ok) throw new Error();
      setPlan({ ...plan, canApprove: false, writable: false, approved: true, produceOpen: true });
      setStatus(`기획 버전 ${plan.version}을 승인했어요.`);
      router.refresh();
    } catch {
      setError("승인 결과를 확인하지 못했어요. 저장된 초안을 불러와 승인 상태를 확인해 주세요.");
      setConflict(true);
      setAcknowledged(false);
    } finally { setApproving(false); }
  }

  return <Card className="stack">
    <h2 ref={resultHeading} tabIndex={-1}>{plan?.approved ? "승인된 기획" : "기획 초안"}</h2>
    {!plan && !error && <p role="status">기획 초안을 불러오는 중이에요.</p>}
    {plan?.produceOpen && <div className="stack"><p>장면 제작 단계가 열렸어요.</p>
      <div><Link className="action-link" href={`/cloud/projects/${projectId}/produce`}>장면 제작으로 이동</Link></div>
    </div>}
    {plan && <form className="stack" onSubmit={save}>
      {plan.version > 0 && <p>저장된 버전 {plan.version}</p>}
      {!plan.writable && !plan.approved && <p>저장된 기획을 읽을 수 있어요.</p>}
      <Field label="대본" required={plan.writable}>
        <textarea rows={7} required={plan.writable} maxLength={20000} value={script} readOnly={!plan.writable || busy}
          onChange={event => { setScript(event.target.value); edited(); }} />
      </Field>
      {rows.map(({ key, scene }, index) => <section className="stack" key={key} aria-labelledby={`plan-scene-${key}`}>
        <h3 id={`plan-scene-${key}`}>장면 {index + 1}</h3>
        <Field label="장면 제목" required={plan.writable}>
          <input required={plan.writable} maxLength={120} value={scene.title} readOnly={!plan.writable || busy}
            onChange={event => updateScene(key, { title: event.target.value })} />
        </Field>
        <Field label="장면 설명" required={plan.writable}>
          <textarea rows={3} required={plan.writable} maxLength={2000} value={scene.description} readOnly={!plan.writable || busy}
            onChange={event => updateScene(key, { description: event.target.value })} />
        </Field>
        <Field label="대사">
          <textarea rows={2} maxLength={4000} value={scene.dialogue} readOnly={!plan.writable || busy}
            onChange={event => updateScene(key, { dialogue: event.target.value })} />
        </Field>
        <Field label="길이(초)" required={plan.writable}>
          <input type="number" required={plan.writable} min={1} max={600} value={scene.durationSec || ""} readOnly={!plan.writable || busy}
            onChange={event => updateScene(key, { durationSec: Number(event.target.value) })} />
        </Field>
        {plan.writable && rows.length > 1 && <div><Button type="button" variant="secondary"
          disabled={busy} onClick={() => { setRows(current => current.filter(row => row.key !== key)); edited(); }}>
          장면 {index + 1} 삭제
        </Button></div>}
      </section>)}
      {plan.writable && <div className="row">
        <Button type="button" variant="secondary" disabled={busy || rows.length >= 100} onClick={() => {
          const key = nextKey.current++;
          setRows(current => [...current, { key, scene: newScene() }]);
          edited();
        }}>장면 추가</Button>
        <Button type="submit" loading={pending} disabled={conflict || approving}>초안 저장</Button>
      </div>}
    </form>}
    {plan?.canApprove && <div className="stack">
      {!savedCopy && <p>수정한 대본과 장면을 저장하면 승인할 수 있어요.</p>}
      <label><input type="checkbox" checked={acknowledged} disabled={!savedCopy || conflict || busy}
        onChange={event => setAcknowledged(event.target.checked)} />저장된 버전 {plan.version}의 대본과 장면을 확인했어요.</label>
      <div><Button type="button" loading={approving} loadingLabel="승인 중"
        disabled={!acknowledged || !savedCopy || pending || conflict} onClick={approve}>기획 승인하고 장면 제작 열기</Button></div>
    </div>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {(conflict || (!plan && error)) && <div><Button type="button" onClick={reload}>저장된 초안 불러오기</Button></div>}
  </Card>;
}
