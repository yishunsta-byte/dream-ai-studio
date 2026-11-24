"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { v7 } from "uuid";
import { Badge, Button, Callout, Card, StatusPill } from "@/components/ui/primitives";
import { assetChoicesPath, classifyChoices, mergeChoices, type AssetChoice } from "./managed-project-requests";
import {
  classifyOlder, classifyScenes, cloudScenesPath, kindLabel, mergeVersions, olderVersionsApiPath, pendingKey, registerContent, runWrite, scenesApiPath, selectContent,
  stageLabel, versionPill, versionStatusLabel, writeGate,
  type PendingWrite, type PendingWrites, type SceneRow, type SceneVersion, type ScenesRead, type WriteKind, type WriteOutcome, type WriteRequest,
} from "./managed-scene-requests";
import { browserPendingStorage, clearPending, loadPending, savePending } from "./managed-scene-pending-store";

// P2-MANAGED-SOURCE-SCENE-PANEL(-RETRY): 승인된 기획의 장면별 결과 보기·확인된 자료 등록·결과 선택(같은 출처 요청만).
// - 이 화면은 이미 있는 결과를 보고 고르는 곳이다. 결과를 새로 만드는 장면 제작·편집·렌더는 아직 클라우드에 연결되지 않았다.
// - 목록은 GET /scenes 한 번, 이전 결과는 장면별 커서로 더 읽고 선택·최근·이전 결과를 ID로 한 번만 보인다.
// - 등록은 서버가 확인한 내 자료 목록(GET /api/projects/asset-choices)에서만 고른다. 목록·커서는 장면 목록을 다시 읽어도 유지한다.
// - 결과를 모르는 쓰기는 작업(종류+장면)별로 처음 보낸 요청 번호·내용을 보존하고, 사용자가 다시 확인할 때만 그대로 보낸다(자동 재전송 없음).
// - RECOVERY: 그 기록을 보내기 전에 이 탭 저장소에 계정·프로젝트 범위(pendingScope)로 보관하고, 새로고침 뒤 읽어 같은 번호로 다시 확인한다.
// - 쓰기 버튼은 페이지가 넘긴 경로 열림(register·select)과 writeGate(기획 승인 + 장면 제작 시작 전·진행 중)일 때만 보인다(서버가 최종 판단).

type Message = { tone: "info" | "warning"; title: string; body: string; login?: boolean; reloadChoices?: boolean };
type Older = { versions: SceneVersion[]; cursor: string | null };
type Choices = { kind: "idle" } | { kind: "loading" } | Exclude<ReturnType<typeof classifyChoices>, { kind: "ok" }> | { kind: "ok"; assets: AssetChoice[]; nextCursor?: string };

const sameOrigin = { credentials: "same-origin", cache: "no-store" } as const;
const verbOf: Record<WriteKind, "등록" | "선택"> = { register: "등록", select: "선택" };
const dateText = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
};

async function readScenes(projectId: string, signal?: AbortSignal): Promise<ScenesRead> {
  try {
    const response = await fetch(scenesApiPath(projectId), { ...sameOrigin, signal });
    return classifyScenes(response.status, await response.json().catch(() => null));
  } catch { return { kind: "failed" }; }
}

async function readChoices(cursor?: string, signal?: AbortSignal): Promise<ReturnType<typeof classifyChoices>> {
  try {
    const response = await fetch(assetChoicesPath(cursor), { ...sameOrigin, signal });
    return classifyChoices(response.status, await response.json().catch(() => null));
  } catch { return { kind: "failed" }; }
}

/** 쓰기 결과 안내. 결과 모름은 그 장면의 '같은 요청으로 다시 확인'으로만 이어 간다. */
export function writeMessage(outcome: WriteOutcome, sent: Pick<PendingWrite, "kind" | "label">, number: number, kept?: boolean, held?: boolean): Message | undefined {
  const verb = verbOf[sent.kind];
  // RECOVERY-AUTH: 401·403으로 확인하지 못한 작업은 기록을 남겨 두고, 다시 로그인한 같은 계정에서 원래 번호로 확인하게 안내한다.
  const keptText = kept === false ? " 이 브라우저 저장소를 쓸 수 없어 새로고침하거나 다른 화면으로 가면 확인 기록이 사라져요." : " 처음 요청 번호는 이 탭에 남겨 뒀어요.";
  const heldText = `장면 ${number}의 ‘같은 요청으로 다시 확인’을 누르면 처음 보낸 요청 번호와 내용으로 확인해서 두 번 ${verb}되지 않아요.${keptText}`;
  if (held && outcome.kind === "login") return { tone: "warning", title: `장면 ${number}: 로그인이 끝나 ${verb}됐는지 확인하지 못했어요`,
    body: `같은 계정으로 다시 로그인한 뒤 ${heldText}`, login: true };
  if (held && outcome.kind === "forbidden") return { tone: "warning", title: `장면 ${number}: 이 계정으로는 확인할 수 없어요`,
    body: `처음 보낸 계정으로 다시 로그인한 뒤 ${heldText} 다른 계정에서는 이 기록이 보이지 않아요.`, login: true };
  if (held && outcome.kind === "invalid") return { tone: "warning", title: `장면 ${number}: ${verb}됐는지 확인하지 못했어요`,
    body: `요청이 거절돼 결과를 확인하지 못했어요. 이 화면을 새로고침한 뒤 ${heldText}` };
  if (outcome.kind === "done") return sent.kind === "register"
    ? { tone: "info", title: `장면 ${number}에 결과를 등록했어요`, body: outcome.replayed ? `이미 등록된 같은 요청이었어요(${sent.label}). 결과 목록을 다시 불러왔어요.` : `${sent.label}이(가) 새 결과 버전으로 목록에 보여요. 쓰려면 ‘이 결과 쓰기’를 눌러 주세요.` }
    : { tone: "info", title: `장면 ${number}에 ${sent.label}을(를) 쓰기로 했어요`, body: outcome.replayed ? "이미 저장된 같은 선택이었어요. 결과 목록을 다시 불러왔어요." : "선택한 결과가 ‘선택됨’으로 보여요." };
  if (outcome.kind === "conflict") return { tone: "warning", title: `장면 ${number}: ${verb}하지 못했어요`, body: outcome.message, reloadChoices: outcome.code === "ASSET_NOT_READY" };
  if (outcome.kind === "reused") return { tone: "warning", title: "다시 확인이 필요해요", body: "같은 요청 번호로 다른 내용이 저장돼 있어요. 최신 상태를 확인하고 새로 시도해 주세요." };
  if (outcome.kind === "missing") return { tone: "warning", title: "장면이나 자료를 찾을 수 없어요", body: "목록을 다시 불러왔어요. 다른 자료나 장면을 골라 주세요." };
  if (outcome.kind === "login") return { tone: "warning", title: "다시 로그인해 주세요", body: `로그인이 끝나 ${verb}하지 않았어요.`, login: true };
  if (outcome.kind === "forbidden") return { tone: "warning", title: "이 계정으로는 할 수 없어요", body: "허용된 계정으로 로그인해 주세요.", login: true };
  if (outcome.kind === "invalid") return { tone: "warning", title: `${verb}하지 못했어요`, body: outcome.message };
  if (outcome.kind === "unknown") return { tone: "warning", title: `장면 ${number}: ${verb}됐는지 확인하지 못했어요`,
    body: `연결이 끊겼거나 저장소가 응답하지 않았어요. 자동으로 다시 보내지 않아요. 장면 ${number}의 ‘같은 요청으로 다시 확인’을 누르면 처음 보낸 요청 번호와 내용으로 확인해서 두 번 ${verb}되지 않아요.${kept === undefined ? "" : kept
      ? " 이 탭에서 새로고침해도 확인 기록이 남아요." : " 이 브라우저 저장소를 쓸 수 없어, 새로고침하거나 탭을 닫으면 확인 기록이 사라져요."}` };
  return undefined;
}

export function ManagedScenePanel({ projectId, register, select, pendingScope }: { projectId: string; register: boolean; select: boolean; pendingScope?: string }) {
  // 첫 그리기에서 한 번 읽는다(서버 그리기에서는 저장소가 없어 빈 값, 첫 화면은 '불러오는 중'이라 표시가 같다).
  const [boot] = useState(() => loadPending(browserPendingStorage(), pendingScope, projectId));
  const [state, setState] = useState<ScenesRead | { kind: "loading" }>({ kind: "loading" });
  const [older, setOlder] = useState<Record<string, Older>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Choices>({ kind: register ? "loading" : "idle" });
  const [pendings, setPendings] = useState<PendingWrites>(boot.pendings);
  const [inFlight, setInFlight] = useState<string>();
  const [message, setMessage] = useState<Message | undefined>(boot.dropped
    ? { tone: "warning", title: "이전 확인 기록을 쓰지 않았어요", body: "이 탭에 남은 확인 기록이 이 계정·프로젝트와 맞지 않거나 오래돼서 지웠어요. 결과 목록에서 상태를 확인해 주세요." } : undefined);
  const messageRef = useRef<HTMLDivElement>(null);

  // 다시 읽기. 쓰기 뒤에는 이미 불러온 이전 결과·커서를 그대로 둔다(버전은 ID로 한 번만 보임). 커서가 무효(400·404)일 때만 비운다.
  const reload = useCallback(async (keepOlder = false) => {
    const next = await readScenes(projectId);
    setState(next); if (!keepOlder) setOlder({});
    return next;
  }, [projectId]);
  // 자료 목록 한 쪽을 반영한다. 더 불러오기(cursor) 실패는 이미 불러온 자료를 그대로 둔다. 처음부터 다시 읽기(cursor 없음)는 목록을 바꾼다.
  const applyChoices = useCallback((page: ReturnType<typeof classifyChoices>, cursor?: string) => {
    setChoices(current => page.kind !== "ok" ? (cursor && current.kind === "ok" ? current : page)
      : { kind: "ok", assets: current.kind === "ok" && cursor ? mergeChoices(current.assets, page.assets) : page.assets, nextCursor: page.nextCursor });
    if (page.kind !== "ok" && cursor) setMessage({ tone: "warning", title: "자료를 더 불러오지 못했어요", body: "이미 불러온 자료는 그대로 고를 수 있어요." });
  }, []);
  const loadChoices = useCallback(async (cursor?: string) => applyChoices(await readChoices(cursor), cursor), [applyChoices]);
  useEffect(() => {
    const controller = new AbortController();
    void readScenes(projectId, controller.signal).then(next => { if (!controller.signal.aborted) setState(next); });
    return () => controller.abort();
  }, [projectId]);
  useEffect(() => { if (boot.dropped) clearPending(browserPendingStorage(), pendingScope); }, [boot, pendingScope]);
  useEffect(() => {
    if (!register) return;
    const controller = new AbortController();
    void readChoices(undefined, controller.signal).then(page => { if (!controller.signal.aborted) applyChoices(page); });
    return () => controller.abort();
  }, [register, applyChoices]);

  const announce = (next: Message | undefined) => { setMessage(next); if (next) requestAnimationFrame(() => messageRef.current?.focus()); };

  async function loadOlder(sceneRow: SceneRow) {
    const cursor = older[sceneRow.id]?.cursor ?? sceneRow.olderCursor;
    if (!cursor || inFlight) return;
    setInFlight(`older:${sceneRow.id}`); setMessage(undefined);
    let outcome: ReturnType<typeof classifyOlder>;
    try {
      const response = await fetch(olderVersionsApiPath(projectId, sceneRow.id, cursor), sameOrigin);
      outcome = classifyOlder(response.status, await response.json().catch(() => null), sceneRow.id);
    } catch { outcome = { kind: "failed" }; }
    if (outcome.kind === "ok") {
      const page = outcome;
      setOlder(current => ({ ...current, [sceneRow.id]: { versions: mergeVersions(current[sceneRow.id]?.versions ?? [], page.versions), cursor: page.olderCursor } }));
    } else if (outcome.kind === "reload") {
      await reload();
      announce({ tone: "warning", title: "장면 목록이 바뀌었어요", body: "최신 목록을 다시 불러왔어요. 이전 결과를 다시 열어 주세요." });
    } else if (outcome.kind === "login") announce({ tone: "warning", title: "다시 로그인해 주세요", body: "로그인이 끝났어요.", login: true });
    else announce({ tone: "warning", title: "이전 결과를 불러오지 못했어요", body: "잠시 뒤 다시 눌러 주세요." });
    setInFlight(undefined);
  }

  // 쓰기 한 번. 같은 작업의 결과 모름 기록이 있으면 runWrite가 원래 번호·내용으로 보낸다.
  async function write(request: WriteRequest, number: number) {
    if (inFlight) return;
    setInFlight(pendingKey(request.kind, request.sceneId)); setMessage(undefined);
    const storage = browserPendingStorage();
    let kept = false;
    const run = await runWrite(projectId, pendings, request, (input, init) => fetch(input, init), () => v7(),
      next => { kept = savePending(storage, pendingScope, projectId, next); });
    kept = savePending(storage, pendingScope, projectId, run.pendings) && kept;
    setPendings(run.pendings);
    if (run.outcome.kind === "done" && run.sent.kind === "register") setChosen(current => { const next = { ...current }; delete next[run.sent.sceneId]; return next; });
    if (run.outcome.kind === "conflict" && run.outcome.code === "ASSET_NOT_READY") setChosen(current => { const next = { ...current }; delete next[run.sent.sceneId]; return next; });
    if (run.outcome.kind === "done" || run.outcome.kind === "conflict" || run.outcome.kind === "missing" || run.outcome.kind === "reused") await reload(true);
    announce(writeMessage(run.outcome, run.sent, number, kept, run.held));
    setInFlight(undefined);
  }

  const loginLink = <Link href={`/login?next=${encodeURIComponent(cloudScenesPath(projectId))}`}>로그인</Link>;
  const projectLink = <Link href={`/cloud/projects/${projectId}`}>프로젝트 보기</Link>;
  if (state.kind === "loading") return <p role="status" className="muted">장면을 불러오고 있어요.</p>;
  if (state.kind === "missing") return <Callout tone="warning" title="프로젝트를 찾을 수 없어요"><p>주소를 확인하거나 <Link href="/cloud/projects">내 프로젝트</Link>에서 열어 주세요.</p></Callout>;
  if (state.kind === "login" || state.kind === "forbidden") return <Callout tone="warning" title="장면을 볼 수 없어요"><p>{state.kind === "login" ? "로그인이 끝났어요." : "허용된 계정으로 로그인해 주세요."} {loginLink}</p></Callout>;
  if (state.kind === "limit") return <Callout tone="warning" title="장면이 너무 많아 한 번에 불러올 수 없어요"><p>관리자에게 알려 주세요. {projectLink}</p></Callout>;
  if (state.kind === "unlinked" || state.kind === "failed") return <Callout tone="warning" title={state.kind === "unlinked" ? "장면 저장소에 연결할 수 없어요" : "장면을 불러오지 못했어요"}>
    <p>잠시 뒤 다시 불러와 주세요.</p>
    <Button type="button" variant="secondary" size="sm" onClick={() => { setState({ kind: "loading" }); void reload(); }}>다시 불러오기</Button>
  </Callout>;

  const { view } = state;
  const writable = writeGate(view);
  const canRegister = register && writable, canSelect = select && writable;
  const assets = choices.kind === "ok" ? choices.assets : [];
  const busy = inFlight !== undefined;
  const titleOf = (assetId: string) => assets.find(asset => asset.id === assetId)?.title ?? "고른 자료";
  const retryButton = (pending: PendingWrite, number: number) => <Button type="button" variant="secondary" size="sm" loading={inFlight === pendingKey(pending.kind, pending.sceneId)}
    loadingLabel="확인 중" disabled={busy} onClick={() => void write(pending, number)}>같은 요청으로 다시 확인</Button>;
  return <div className="stack" aria-busy={busy ? true : undefined}>
    <Card><h2>진행 상태</h2>
      <dl className="stack">
        <div><dt>기획</dt><dd>{view.approvedPlanId !== null && view.stages.plan === "approved" ? `승인됨(v${view.approvedPlanVersion ?? "?"})` : "아직 승인되지 않았어요"}</dd></div>
        <div><dt>장면 제작 단계</dt><dd>{stageLabel[view.stages.produce]}</dd></div>
        <div><dt>이 화면에서 할 수 있는 일</dt><dd>{writable && (register || select)
          ? [register && "확인된 자료를 결과로 등록", select && "쓸 결과 고르기"].filter(Boolean).join(" · ")
          : "결과 보기만(지금은 등록·선택이 닫혀 있어요)"}</dd></div>
        <div><dt>아직 연결 전</dt><dd>결과를 새로 만드는 장면 제작, 편집·렌더</dd></div>
      </dl>
      <p className="muted">장면 {view.scenes.length}개 · 내용 버전 {view.revision}</p>
    </Card>
    <div ref={messageRef} tabIndex={-1} aria-live="polite">{message && <Callout tone={message.tone} title={message.title}>
      <p>{message.body}</p>
      {message.login && <p>{loginLink}</p>}
      {message.reloadChoices && register && <Button type="button" variant="secondary" size="sm" disabled={busy}
        onClick={() => { setChoices({ kind: "loading" }); void loadChoices(); }}>자료 목록 다시 불러오기</Button>}
    </Callout>}</div>
    {canRegister && choices.kind === "unlinked" && <Callout tone="info" title="아직 클라우드에서 자료를 고를 수 없어요"><p>확인된 자료 목록이 연결되면 여기서 장면 결과로 등록할 수 있어요.</p></Callout>}
    {canRegister && (choices.kind === "login" || choices.kind === "forbidden") && <Callout tone="warning" title="자료 목록을 볼 수 없어요"><p>{choices.kind === "login" ? "로그인이 끝났어요." : "허용된 계정으로 로그인해 주세요."} {loginLink}</p></Callout>}
    {canRegister && choices.kind === "failed" && <Callout tone="warning" title="자료 목록을 불러오지 못했어요">
      <p>잠시 뒤 다시 불러와 주세요. 목록을 읽기 전에는 등록하지 않아요.</p>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setChoices({ kind: "loading" }); void loadChoices(); }}>자료 목록 다시 불러오기</Button>
    </Callout>}
    {!view.scenes.length
      ? <Card><p>아직 장면이 없어요. 기획이 승인되면 장면표가 여기에 보여요.</p><p>{projectLink}</p></Card>
      : <ol className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="장면 목록">{view.scenes.map((row, index) => {
          const number = index + 1;
          const loaded = older[row.id];
          const versions = mergeVersions(row.selectedVersion ? [row.selectedVersion] : [], mergeVersions(row.recentVersions, loaded?.versions ?? []));
          const cursor = loaded ? loaded.cursor : row.olderCursor;
          const pendingRegister = pendings[pendingKey("register", row.id)], pendingSelect = pendings[pendingKey("select", row.id)];
          const selectId = `scene-asset-${row.id}`;
          return <li key={row.id}><Card>
            <h2>장면 {number}</h2>
            <p className="muted">{row.selectedVersion ? `선택된 결과 v${row.selectedVersion.version}` : "아직 고른 결과가 없어요"}</p>
            {versions.length === 0 ? <p>아직 결과가 없어요.</p>
              : <ul className="stack" aria-label={`장면 ${number} 결과`}>{versions.map(item => <li key={item.id}>
                  v{item.version} · {kindLabel[item.kind]} · <StatusPill status={versionPill[item.status]}>{versionStatusLabel[item.status]}</StatusPill>
                  {" "}· {item.origin === "direct" ? "직접 등록" : "생성"}{item.createdAt && ` · ${dateText(item.createdAt)}`}
                  {item.id === row.selectedVersionId && <> <Badge>선택됨</Badge></>}
                  {canSelect && !pendingSelect && item.status === "succeeded" && item.id !== row.selectedVersionId && <> <Button type="button" variant="secondary" size="sm"
                    disabled={busy} onClick={() => void write({ kind: "select", sceneId: row.id, content: selectContent(view.revision, row.id, item.id, row.selectedVersionId),
                      target: item.id, label: `결과 v${item.version}` }, number)}>이 결과 쓰기</Button></>}
                </li>)}</ul>}
            {cursor && <p><Button type="button" variant="secondary" size="sm" loading={inFlight === `older:${row.id}`} loadingLabel="불러오는 중" disabled={busy}
              onClick={() => void loadOlder(row)}>이전 결과 더 보기</Button></p>}
            {pendingSelect && <Callout tone="warning" title={`${pendingSelect.label} 선택 결과를 확인하지 못했어요`}>
              <p>처음 보낸 요청 번호와 내용으로 다시 확인해요. 확인이 끝나기 전에는 이 장면의 다른 선택을 받지 않아요.</p>{retryButton(pendingSelect, number)}</Callout>}
            {pendingRegister && <Callout tone="warning" title={`${pendingRegister.label} 등록 결과를 확인하지 못했어요`}>
              <p>처음 보낸 요청 번호와 내용으로 다시 확인해요. 확인이 끝나기 전에는 이 장면의 새 등록을 받지 않아요.</p>{retryButton(pendingRegister, number)}</Callout>}
            {canRegister && !pendingRegister && choices.kind === "ok" && <div className="stack">
              <label htmlFor={selectId}>등록할 자료</label>
              <select id={selectId} value={chosen[row.id] ?? ""} disabled={busy || !assets.length}
                onChange={event => setChosen(current => ({ ...current, [row.id]: event.target.value }))}>
                <option value="">{assets.length ? "선택해 주세요" : "고를 수 있는 확인된 자료가 없어요"}</option>
                {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.title} ({asset.kind === "image" ? "이미지" : "영상"})</option>)}
              </select>
              <p className="cluster">
                <Button type="button" loading={inFlight === pendingKey("register", row.id)} loadingLabel="등록 중" disabled={busy || !chosen[row.id]}
                  disabledReason={chosen[row.id] ? undefined : "등록할 자료를 먼저 골라 주세요"}
                  onClick={() => void write({ kind: "register", sceneId: row.id, content: registerContent(view.revision, row.id, chosen[row.id]), target: chosen[row.id], label: titleOf(chosen[row.id]) }, number)}>결과로 등록</Button>
                {choices.nextCursor && <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void loadChoices(choices.nextCursor)}>자료 더 불러오기</Button>}
              </p>
            </div>}
          </Card></li>;
        })}</ol>}
    {!writable && (register || select) && view.scenes.length > 0 && <Callout tone="info" title="지금은 결과를 등록하거나 고를 수 없어요">
      <p>기획이 승인되고 장면 제작 단계가 ‘시작 전’이나 ‘진행 중’일 때만 할 수 있어요. 지금 장면 제작 단계: {stageLabel[view.stages.produce]}. {projectLink}</p></Callout>}
    <p>{projectLink}</p>
  </div>;
}
