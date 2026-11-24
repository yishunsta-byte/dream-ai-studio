"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LocalProduction, ProductionResult, ProductionScene, SceneSelection } from "@/lib/cloud/local-project-production";
import { Field } from "@/components/ui/interactive";
import { Button, Card, StatusPill } from "@/components/ui/primitives";
import { ProjectPngAttachment } from "./project-png-attachment";

const readiness = {
  waiting: { pill: "queued", label: "선택한 결과 없음" },
  selected: { pill: "done", label: "결과 선택됨" },
  recheck: { pill: "warning", label: "다시 확인 필요" },
} as const satisfies Record<ProductionScene["readiness"], { pill: "queued" | "done" | "warning"; label: string }>;
const focusNotice = (element: HTMLParagraphElement | null) => element?.focus();

export function ProjectProductionScenes({ projectId }: { projectId: string }) {
  const endpoint = `/api/projects/${projectId}/production`;
  const editingPath = `/cloud/projects/${projectId}/editing-audio`;
  const router = useRouter();
  const [production, setProduction] = useState<LocalProduction>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pendingScene, setPendingScene] = useState<string>();
  const [notice, setNotice] = useState<{ sceneId: string; message: string; error?: boolean; reload?: boolean }>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [approving, setApproving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const busy = Boolean(pendingScene) || approving || attaching;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setError("승인된 기획의 제작 장면을 찾을 수 없어요.");
          return;
        }
        if (!response.ok) throw new Error();
        const result: LocalProduction = await response.json();
        if (!controller.signal.aborted) setProduction(result);
      } catch {
        if (!controller.signal.aborted) setError("제작 장면을 불러오지 못했어요.");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, endpoint]);

  function reload() {
    setProduction(undefined);
    setError("");
    setNotice(undefined);
    setApprovalError("");
    setAcknowledged(false);
    setAttempt(value => value + 1);
  }

  async function register(event: FormEvent<HTMLFormElement>, sceneId: string) {
    event.preventDefault();
    if (!production?.canRegister) return;
    const assetId = new FormData(event.currentTarget).get("assetId");
    if (typeof assetId !== "string" || !assetId) return;
    await mutate(sceneId, { action: "register-png", assetId });
  }

  async function mutate(sceneId: string, input: { action: "register-png"; assetId: string } |
    { action: "select"; versionId: string; expectedVersionId: string | null }) {
    if (!production || busy || notice?.reload || approvalError) return;
    setPendingScene(sceneId);
    setNotice(undefined);
    setAcknowledged(false);
    const failure = input.action === "select" ? "결과 선택을 확인하지 못했어요." : "결과 등록을 확인하지 못했어요.";
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, sceneId, planId: production.planId, revision: production.revision }),
      });
      if (!response.ok) {
        const reload = response.status === 409 || response.status === 404;
        setNotice({ sceneId, error: true, reload, message: reload ?
          "장면 또는 PNG 원본의 상태가 바뀌었어요. 목록을 다시 확인해 주세요." : failure + " 다시 시도해 주세요." });
        return;
      }
      if (input.action === "select") {
        const result: SceneSelection = await response.json();
        setProduction(current => current && {
          ...current, revision: result.revision, canApprove: result.canApprove,
          scenes: current.scenes.map(scene => scene.id === result.sceneId ?
            { ...scene, selectedVersionId: result.selectedVersionId, readiness: "selected" } : scene),
        });
        setNotice({ sceneId, message: "장면에서 사용할 결과를 선택했어요." });
      } else {
        const result: ProductionResult = await response.json();
        setProduction(current => current && {
          ...current,
          scenes: current.scenes.map(scene => scene.id !== sceneId || scene.results.some(row => row.id === result.id) ?
            scene : { ...scene, results: [result, ...scene.results] }),
        });
        setNotice({ sceneId, message: `결과 버전 ${result.version}을 등록했어요.` });
      }
    } catch {
      setNotice({ sceneId, error: true, message: failure + " 다시 시도해 주세요." });
    } finally { setPendingScene(undefined); }
  }

  async function approve() {
    if (!production?.canApprove || !acknowledged || busy || notice?.reload || approvalError) return;
    setApproving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-production", planId: production.planId,
          revision: production.revision, acknowledged }),
      });
      if (response.status === 409) {
        setApprovalError("제작 장면 또는 결과가 바뀌었어요. 목록을 다시 불러온 뒤 확인해 주세요.");
        return;
      }
      if (!response.ok) throw new Error();
      setProduction({ ...production, canApprove: false, canRegister: false, canSelect: false,
        productionApproved: true, editOpen: true });
      router.push(editingPath);
      router.refresh();
    } catch {
      setApprovalError("제작 승인 결과를 확인하지 못했어요. 목록을 다시 불러와 주세요.");
    } finally {
      setAcknowledged(false);
      setApproving(false);
    }
  }

  if (error) return <Card className="stack">
    <p role="alert">{error}</p>
    <div><Button type="button" onClick={reload}>다시 불러오기</Button></div>
  </Card>;
  if (!production) return <p role="status">제작 장면을 불러오는 중이에요.</p>;

  return <section className="stack" aria-labelledby="production-scenes-heading">
    <h2 id="production-scenes-heading">기획 버전 {production.planVersion}의 장면</h2>
    {production.canSelect && <ProjectPngAttachment endpoint={endpoint} planId={production.planId}
      revision={production.revision} disabled={Boolean(pendingScene) || approving || Boolean(notice?.reload || approvalError)}
      onBusy={setAttaching} onAttached={source => setProduction(current => current && {
        ...current, sources: current.sources.some(row => row.id === source.id) ? current.sources : [...current.sources, source],
      })} />}
    {production.canRegister && production.sources.length === 0 && <p>프로젝트에 등록할 수 있는 PNG 원본이 없어요.</p>}
    {!production.scenes.length ? <p>저장된 제작 장면이 없어요.</p> :
      <ol className="stack" aria-label="기획 순서대로 정렬한 장면">
        {production.scenes.map(scene => {
          const state = readiness[scene.readiness];
          const sources = production.sources.filter(source => !scene.results.some(result => result.assetId === source.id));
          const sceneNotice = notice?.sceneId === scene.id ? notice : undefined;
          return <li key={scene.id} value={scene.position}>
            <Card className="stack">
              <h3>장면 {scene.position} · {scene.title}</h3>
              <p>{scene.description}</p>
              <div className="row"><span>{scene.durationSec}초</span><StatusPill status={state.pill}>{state.label}</StatusPill></div>
              {scene.results.length > 0 && <ul aria-label="등록된 PNG 결과">
                {scene.results.map(result => {
                  const selected = scene.selectedVersionId === result.id && scene.readiness === "selected";
                  const selectable = production.canSelect && production.sources.some(source => source.id === result.assetId);
                  return <li key={result.id} className="row">
                    <span>버전 {result.version} · {result.title}</span>
                    {selected && <span>사용 중</span>}
                    {selectable && !selected && <Button type="button" variant="secondary" size="sm"
                      disabled={busy || notice?.reload || Boolean(approvalError)}
                      aria-label={`장면 ${scene.position} 버전 ${result.version}의 결과 선택`}
                      onClick={() => void mutate(scene.id, { action: "select", versionId: result.id,
                        expectedVersionId: scene.selectedVersionId })}>이 결과 사용</Button>}
                  </li>;
                })}
              </ul>}
              {production.canRegister && sources.length > 0 && <form className="stack" onSubmit={event => void register(event, scene.id)}>
                <Field label={`장면 ${scene.position}의 PNG 원본`} required>
                  <select name="assetId" disabled={busy}>
                    {sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}
                  </select>
                </Field>
                <div><Button type="submit" loading={pendingScene === scene.id}
                  disabled={busy || notice?.reload || Boolean(approvalError)} aria-label={`장면 ${scene.position} PNG 결과 등록`}>PNG 결과 등록</Button></div>
              </form>}
              {sceneNotice && <p role={sceneNotice.error ? "alert" : "status"} tabIndex={-1}
                ref={sceneNotice.error ? undefined : focusNotice}>{sceneNotice.message}</p>}
              {sceneNotice?.reload && <div><Button type="button" onClick={reload}>다시 불러오기</Button></div>}
            </Card>
          </li>;
        })}
      </ol>}
    <Card className="stack">
      <h2>제작 승인</h2>
      {production.productionApproved ? <>
        <p>장면 제작을 승인했어요.</p>
        {production.editOpen && <div><Link className="action-link" href={editingPath}>편집으로 이동</Link></div>}
      </> : <>
        {!production.canApprove && <p>모든 장면에서 사용할 결과를 선택하고 다시 확인이 필요한 장면을 확인해 주세요.</p>}
        <label><input type="checkbox" checked={acknowledged}
          disabled={!production.canApprove || busy || notice?.reload || Boolean(approvalError)}
          onChange={event => setAcknowledged(event.target.checked)} />선택한 장면 결과를 모두 확인했어요.</label>
        <div><Button type="button" loading={approving} loadingLabel="승인 중"
          disabled={!production.canApprove || !acknowledged || Boolean(pendingScene) || attaching || notice?.reload || Boolean(approvalError)}
          onClick={() => void approve()}>제작 승인하고 편집으로 이동</Button></div>
      </>}
      {approvalError && <><p role="alert">{approvalError}</p>
        <div><Button type="button" onClick={reload}>다시 불러오기</Button></div></>}
    </Card>
  </section>;
}
