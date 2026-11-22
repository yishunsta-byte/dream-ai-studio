"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import hub from "./admin.module.css";
import styles from "./admin-premiere-programs.module.css";

// P1-06 작업실 → 관리자 이미지 분석 첫 연결.
// 작업실은 /admin?project=<프로젝트 ID>&scene=<장면 ID>#admin-style-dna 로 연다.
// 주소 값은 믿지 않는다: 형식이 맞으면 소유자 전용 제작 GET으로 다시 확인하고, 그 응답에 있는 장면일 때만 장면 이름과 복귀 링크를 보인다.
// 복귀 주소는 확인된 ID로 이 파일이 고정 작업실 경로를 만든다. 확인되지 않으면 아무것도 보이지 않고 주소에서 두 값을 지운다(관리자 기본 진입).
// 저장·전송·제작·공개·청구 요청은 없다(GET 한 번).
// P1-07 운영 이식(Master msg_99235b334697): 제작 조회가 일시 실패(401·5xx·네트워크)면 형식이 맞는 project·scene을 지우지 않고
// 장면 이름·저장 대신 '다시 확인' 안내와 단추만 보인다. 형식 오류·403·404·응답에 없는 장면은 예전처럼 아무것도 보이지 않고 지운다(정보 노출 방지).

const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type StudioScene = { projectId: string; sceneId: string; position: number; title: string };

/** 주소의 작업실 문맥. project·scene이 하나씩이고 UUIDv7 형식일 때만. */
export function studioContext(search: string) {
  const query = new URLSearchParams(search);
  const [projectId, ...extraProject] = query.getAll("project");
  const [sceneId, ...extraScene] = query.getAll("scene");
  if (extraProject.length || extraScene.length || !projectId || !sceneId) return undefined;
  return uuidv7.test(projectId) && uuidv7.test(sceneId) ? { projectId, sceneId } : undefined;
}

/** 확인된 ID로만 만드는 작업실 복귀 경로. */
export function studioReturnHref(scene: Pick<StudioScene, "projectId" | "sceneId">) {
  return `/cloud/projects/${scene.projectId}/produce?${new URLSearchParams({ scene: scene.sceneId })}`;
}

/** 소유자 제작 응답에서 그 장면을 찾는다. 모양이 다르거나 없으면 undefined. */
export function verifiedScene(context: { projectId: string; sceneId: string }, production: unknown): StudioScene | undefined {
  const scenes = (production as { scenes?: unknown })?.scenes;
  if (!Array.isArray(scenes)) return undefined;
  const scene = scenes.find(row => (row as { id?: unknown })?.id === context.sceneId) as { position?: unknown; title?: unknown } | undefined;
  if (!scene || !Number.isSafeInteger(scene.position) || typeof scene.title !== "string") return undefined;
  return { ...context, position: scene.position as number, title: scene.title };
}

export type ProductionCheck = { kind: "verified"; scene: StudioScene } | { kind: "forget" } | { kind: "retry" };

/** 소유자 제작 조회 응답을 판정한다. 200이면 그 장면이 있을 때만 확인, 403·404·그 밖의 4xx는 지움, 401·5xx는 다시 확인. */
export function productionCheck(context: { projectId: string; sceneId: string }, status: number, body?: unknown): ProductionCheck {
  if (status >= 200 && status < 300) { const scene = verifiedScene(context, body); return scene ? { kind: "verified", scene } : { kind: "forget" }; }
  return status === 401 || status >= 500 ? { kind: "retry" } : { kind: "forget" };
}

function forgetContext() {
  const url = new URL(window.location.href);
  url.searchParams.delete("project");
  url.searchParams.delete("scene");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** onScene: 소유자 확인이 끝난 장면(장면 초안 저장 대상). 확인되지 않으면 부르지 않는다. kind: 어느 분석 칸의 안내인지(P1-07 음악). */
export function AdminStudioReturn({ onScene, kind = "image" }: { onScene?: (scene: StudioScene) => void; kind?: "image" | "music" | "audio" } = {}) {
  const [scene, setScene] = useState<StudioScene>();
  const [retry, setRetry] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const context = studioContext(window.location.search);
    if (!context) {
      if (new URLSearchParams(window.location.search).has("project") || new URLSearchParams(window.location.search).has("scene")) forgetContext();
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${context.projectId}/production`, { cache: "no-store", signal: controller.signal });
        const check = productionCheck(context, response.status, response.ok ? await response.json().catch(() => undefined) : undefined);
        if (controller.signal.aborted) return;
        setRetry(check.kind === "retry");
        if (check.kind === "verified") { setScene(check.scene); onScene?.(check.scene); }
        else if (check.kind === "forget") forgetContext();
      } catch {
        // 네트워크 오류도 일시 실패로 본다(문맥 유지, 다시 확인).
        if (!controller.signal.aborted) setRetry(true);
      }
    })();
    return () => controller.abort();
  }, [onScene, attempt]);
  if (retry && !scene) return <aside className={styles.settings} aria-label="작업실에서 연 장면">
    <p role="status">작업실 장면을 지금 확인하지 못했어요. 주소의 장면 정보는 그대로 두었어요. 잠시 뒤 다시 확인해 주세요.</p>
    <Button type="button" variant="secondary" size="sm" onClick={() => { setRetry(false); setAttempt(value => value + 1); }}>다시 확인</Button>
  </aside>;
  if (!scene) return null;
  return <aside className={styles.settings} aria-label="작업실에서 연 장면">
    {kind === "audio" ? <p>작업실 장면 {scene.position} · {scene.title}에서 열었어요. 장면에 저장하는 기능은 아직 연결되지 않았어요(분석 결과는 이 화면에서만 볼 수 있어요).</p>
      : kind === "image" ? <p>작업실 장면 {scene.position} · {scene.title}에서 열었어요. 분석 결과는 프롬프트 카드의 &lsquo;장면 {scene.position} 초안에 저장&rsquo;을 누를 때만 그 장면 이미지 초안으로 저장돼요.</p>
      : <p>작업실 장면 {scene.position} · {scene.title}에서 열었어요. 음악 분석 결과의 Suno 프롬프트는 &lsquo;장면 {scene.position} 초안에 저장&rsquo;을 누를 때만 그 장면 음악 초안으로 저장돼요. 분석·복사·음성 분석에는 저장하지 않아요.</p>}
    <a className={hub.link} href={studioReturnHref(scene)}>작업실로 돌아가기(장면 {scene.position} · 분석 중이면 취소돼요)</a>
  </aside>;
}
