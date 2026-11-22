"use client";

import { useEffect, useState } from "react";
import hub from "./admin.module.css";
import styles from "./admin-premiere-programs.module.css";

// P1-06 작업실 → 관리자 이미지 분석 첫 연결.
// 작업실은 /admin?project=<프로젝트 ID>&scene=<장면 ID>#admin-style-dna 로 연다.
// 주소 값은 믿지 않는다: 형식이 맞으면 소유자 전용 제작 GET으로 다시 확인하고, 그 응답에 있는 장면일 때만 장면 이름과 복귀 링크를 보인다.
// 복귀 주소는 확인된 ID로 이 파일이 고정 작업실 경로를 만든다. 확인되지 않으면 아무것도 보이지 않고 주소에서 두 값을 지운다(관리자 기본 진입).
// 저장·전송·제작·공개·청구 요청은 없다(GET 한 번).

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

function forgetContext() {
  const url = new URL(window.location.href);
  url.searchParams.delete("project");
  url.searchParams.delete("scene");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** onScene: 소유자 확인이 끝난 장면(장면 초안 저장 대상). 확인되지 않으면 부르지 않는다. kind: 어느 분석 칸의 안내인지(P1-07 음악). */
export function AdminStudioReturn({ onScene, kind = "image" }: { onScene?: (scene: StudioScene) => void; kind?: "image" | "music" } = {}) {
  const [scene, setScene] = useState<StudioScene>();
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
        const found = response.ok ? verifiedScene(context, await response.json()) : undefined;
        if (controller.signal.aborted) return;
        if (found) { setScene(found); onScene?.(found); }
        else forgetContext();
      } catch {
        if (!controller.signal.aborted) forgetContext();
      }
    })();
    return () => controller.abort();
  }, [onScene]);
  if (!scene) return null;
  return <aside className={styles.settings} aria-label="작업실에서 연 장면">
    {kind === "image" ? <p>작업실 장면 {scene.position} · {scene.title}에서 열었어요. 분석 결과는 프롬프트 카드의 &lsquo;장면 {scene.position} 초안에 저장&rsquo;을 누를 때만 그 장면 이미지 초안으로 저장돼요.</p>
      : <p>작업실 장면 {scene.position} · {scene.title}에서 열었어요. 음악 분석 결과의 Suno 프롬프트는 &lsquo;장면 {scene.position} 초안에 저장&rsquo;을 누를 때만 그 장면 음악 초안으로 저장돼요. 분석·복사·음성 분석에는 저장하지 않아요.</p>}
    <a className={hub.link} href={studioReturnHref(scene)}>작업실로 돌아가기(장면 {scene.position} · 분석 중이면 취소돼요)</a>
  </aside>;
}
