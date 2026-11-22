"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/primitives";
import { adminLoginPath } from "@/lib/auth/config";
import { languageName, lostSaveOutcome, promptProblem, readSceneDraftState, saveBody, sceneDraftPath,
  type DraftInput, type DraftKind, type SceneDraftState } from "./admin-scene-draft-model";
import type { StudioScene } from "./admin-studio-return";
import hub from "./admin.module.css";

// P1-06: 작업실에서 연(소유자 확인된) 장면이 있을 때만, 이미지 분석 결과의 언어 카드마다 '장면 초안에 저장'을 둔다.
// 조회는 장면이 확인된 뒤 GET 한 번(쓰기 아님). 저장은 버튼을 눌렀을 때만 PUT 한 번. 분석 실행·탭 이동·복귀에는 저장하지 않는다.
// 충돌(409)·응답 유실에서는 편집본을 그대로 두고 최신 상태를 읽은 뒤 사용자가 다시 고르게 한다(자동 재저장 없음).
// P1-07: 같은 흐름을 음악 분석의 Suno 프롬프트(kind music → …/prompts/music, 언어 없음)에도 쓴다.

type Load = { kind: "loading" } | { kind: "ready"; state: SceneDraftState } | { kind: "missing" } | { kind: "login" } | { kind: "failed" };
type Shared = { scene: StudioScene; kind: DraftKind; load: Load; reload: (signal?: AbortSignal) => Promise<Load>; accept: (state: SceneDraftState) => void };
const SceneDraftContext = createContext<Shared | null>(null);
const loginHref = { image: adminLoginPath({ next: "/admin#admin-style-dna" }), music: adminLoginPath({ next: "/admin#admin-music-analysis" }) };
const kindName = { image: "이미지", music: "음악" } as const;

async function readDraft(scene: StudioScene, kind: DraftKind, signal?: AbortSignal): Promise<Load> {
  try {
    const response = await fetch(sceneDraftPath(scene, kind), { cache: "no-store", signal });
    if (response.status === 401) return { kind: "login" };
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failed" };
    const state = readSceneDraftState(await response.json().catch(() => null), scene, kind);
    return state ? { kind: "ready", state } : { kind: "failed" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "failed" };
  }
}

/** 확인된 장면의 초안(kind) 버전·기준을 한 번 읽어 저장 버튼들이 함께 쓴다. 장면이 없으면 아무것도 하지 않는다. */
export function SceneDraftProvider({ scene, kind = "image", children }: { scene?: StudioScene; kind?: DraftKind; children: ReactNode }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const current = useRef(scene);
  useEffect(() => { current.current = scene; }, [scene]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const target = current.current;
    if (!target) return { kind: "failed" } as const;
    const next = await readDraft(target, kind, signal);
    // 그사이 다른 장면으로 바뀌었으면 이전 장면 응답은 버린다.
    if (current.current === target) setLoad(next);
    return next;
  }, [kind]);
  const accept = useCallback((state: SceneDraftState) => {
    const target = current.current;
    if (target && state.projectId === target.projectId && state.sceneId === target.sceneId) setLoad({ kind: "ready", state });
  }, []);
  useEffect(() => {
    if (!scene) return;
    const controller = new AbortController();
    reload(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [scene, reload]);
  const value = useMemo(() => scene ? { scene, kind, load, reload, accept } : null, [scene, kind, load, reload, accept]);
  return <SceneDraftContext.Provider value={value}>{children}</SceneDraftContext.Provider>;
}

export function useSceneDraftTarget() {
  return useContext(SceneDraftContext);
}

type Outcome =
  | { kind: "idle" } | { kind: "saving" }
  | { kind: "saved"; version: number; input: DraftInput; recovered?: boolean }
  | { kind: "conflict"; latest?: SceneDraftState; text: string }
  | { kind: "error"; text: string; login?: boolean };

const versionText = (state: SceneDraftState, kind: DraftKind) => state.version ? `지금 장면 초안 버전 ${state.version}` : `아직 이 장면의 ${kindName[kind]} 초안이 없어요`;

/** 카드 하나의 명시 저장. 카드의 제안 원문·지금 편집문(이미지는 언어도)을 그대로 보낸다. */
export function SceneDraftSave({ input }: { input: DraftInput }) {
  const shared = useSceneDraftTarget();
  const id = useId();
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const statusRef = useRef<HTMLParagraphElement>(null);
  const inflight = useRef<AbortController | null>(null);
  const focusStatus = useRef(false);
  useEffect(() => () => inflight.current?.abort(), []);
  useEffect(() => {
    if (focusStatus.current && outcome.kind !== "saving") { focusStatus.current = false; statusRef.current?.focus(); }
  }, [outcome]);
  if (!shared) return null;
  const { scene, kind, load, reload, accept } = shared;
  const kindLabel = kindName[kind];
  const sceneName = `장면 ${scene.position}`;
  const problem = promptProblem(input);
  const blocked = load.kind === "loading" ? "장면 초안 정보를 불러오는 중이에요."
    : load.kind === "missing" ? "이 장면은 지금 승인된 계획에 없어 초안을 저장할 수 없어요."
    : load.kind === "login" ? "로그인이 끝났어요. 다시 로그인한 뒤 저장해 주세요."
    : load.kind === "failed" ? "장면 초안 정보를 불러오지 못했어요."
    : problem;

  async function save() {
    if (load.kind !== "ready" || problem) return;
    const sent = load.state;
    const controller = new AbortController();
    inflight.current?.abort();
    inflight.current = controller;
    setOutcome({ kind: "saving" });
    focusStatus.current = true;
    let response: Response | undefined;
    try {
      response = await fetch(sceneDraftPath(scene, kind), { method: "PUT", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify(saveBody(sent, input, kind)) });
    } catch {
      if (controller.signal.aborted) return;
    }
    if (controller.signal.aborted) return;
    if (response?.status === 201) {
      const saved = readSceneDraftState(await response.json().catch(() => null), scene, kind);
      if (controller.signal.aborted) return;
      if (saved) { accept(saved); setOutcome({ kind: "saved", version: saved.version, input }); return; }
    }
    if (response && response.status === 409) {
      const latest = await reload(controller.signal).catch(() => undefined);
      if (controller.signal.aborted) return;
      setOutcome({ kind: "conflict", latest: latest?.kind === "ready" ? latest.state : undefined,
        text: latest?.kind === "missing" ? `${sceneName}의 승인 계획이 바뀌어 이 장면에 저장할 수 없어요. 고친 프롬프트는 그대로 두었어요.`
          : `다른 곳에서 ${sceneName} ${kindLabel} 초안이나 승인 계획이 먼저 바뀌었어요. 고친 프롬프트는 그대로 두었어요. 최신 상태를 확인하고 다시 저장할지 골라 주세요.` });
      return;
    }
    if (response && response.status !== 201) {
      const text = response.status === 401 ? "로그인이 끝났어요. 다시 로그인한 뒤 저장해 주세요."
        : response.status === 403 ? "이 화면에서 보낸 요청으로 확인되지 않아 저장하지 않았어요."
        : response.status === 404 ? "이 장면을 찾을 수 없거나 승인된 계획에 없어 저장하지 않았어요."
        : response.status === 413 ? "프롬프트가 너무 길어 저장하지 않았어요."
        : response.status === 400 ? "저장할 수 없는 프롬프트 형식이라 저장하지 않았어요."
        : undefined;
      if (text) {
        if (response.status === 404) await reload(controller.signal).catch(() => undefined);
        if (controller.signal.aborted) return;
        setOutcome({ kind: "error", text, login: response.status === 401 });
        return;
      }
    }
    // 응답이 끊기거나 알 수 없는 응답: 저장됐는지 먼저 다시 읽고, 판정이 안 되면 사용자가 고르게 한다.
    const latest = await reload(controller.signal).catch(() => undefined);
    if (controller.signal.aborted) return;
    if (latest?.kind !== "ready") {
      setOutcome({ kind: "error", text: "저장 결과를 확인하지 못했어요. 고친 프롬프트는 그대로 두었어요. 잠시 뒤 다시 저장해 주세요." });
      return;
    }
    const verdict = lostSaveOutcome(latest.state, sent, input);
    if (verdict === "saved") setOutcome({ kind: "saved", version: latest.state.version, input, recovered: true });
    else if (verdict === "not_saved") setOutcome({ kind: "error", text: "응답이 끊겨 다시 확인해 보니 저장되지 않았어요. 고친 프롬프트는 그대로 두었어요. 다시 저장할 수 있어요." });
    else setOutcome({ kind: "conflict", latest: latest.state,
      text: `응답이 끊긴 사이 ${sceneName} ${kindLabel} 초안이 바뀌었어요. 고친 프롬프트는 그대로 두었어요. 최신 상태를 확인하고 다시 저장할지 골라 주세요.` });
  }

  const saving = outcome.kind === "saving";
  const label = outcome.kind === "conflict" && load.kind === "ready" ? `최신 버전 ${load.state.version} 다음으로 저장` : `${sceneName} 초안에 저장`;
  return <div className={hub.sceneDraft} aria-labelledby={`${id}-title`} role="group">
    {kind === "image" ? <p id={`${id}-title`} className={hub.note}>
      작업실 {sceneName} · {scene.title}의 이미지 초안으로 이 카드({languageName(input.language)})의 제안 원문과 지금 편집문을 저장해요.
      {load.kind === "ready" && <> {versionText(load.state, kind)}.</>}
      {" "}한국어·영어 카드는 같은 장면 이미지 초안 이력에 새 버전으로 차례로 쌓이고, 마지막에 저장한 버전이 그 장면의 최신 초안이에요.
    </p> : <p id={`${id}-title`} className={hub.note}>
      작업실 {sceneName} · {scene.title}의 음악 초안으로 Suno 프롬프트 제안 원문과 지금 편집문을 저장해요.
      {load.kind === "ready" && <> {versionText(load.state, kind)}.</>}
      {" "}저장할 때마다 그 장면 음악 초안 이력에 새 버전으로 쌓여요.
    </p>}
    <Button type="button" size="sm" variant="secondary" loading={saving} loadingLabel="저장 중" disabledReason={saving ? undefined : blocked}
      aria-describedby={`${id}-title`} onClick={() => void save()}>{label}</Button>
    <p ref={statusRef} tabIndex={-1} role="status" className={hub.note}>
      {outcome.kind === "saved" && outcome.input.text === input.text && `${sceneName} ${kindLabel} 초안 버전 ${outcome.version}로 저장했어요(${kind === "image" ? `${languageName(input.language)} · ` : ""}${input.text === input.suggested ? "제안 원문 그대로" : "편집본"}).${outcome.recovered ? " 응답이 끊겨 다시 확인한 결과예요." : ""}`}
      {outcome.kind === "conflict" && <>{outcome.text}{outcome.latest && ` ${versionText(outcome.latest, kind)}${outcome.latest.draft ? `(${kind === "image" ? `${languageName(outcome.latest.draft.language)}, ` : ""}${new Date(outcome.latest.draft.savedAt).toLocaleString("ko-KR")} 저장)` : ""}.`}</>}
      {outcome.kind === "error" && <>{outcome.text}{outcome.login && <> <a className={hub.link} href={loginHref[kind]}>관리자 로그인</a></>}</>}
    </p>
  </div>;
}
