"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import type { shortsBgmPromptResult } from "@/lib/reference-analysis/shorts-bgm-prompt-contract";
import {
  shortsScenePromptsBatchResult, shortsScenePromptsRangeMax, type ShortsScenePromptsRangeResult,
} from "@/lib/reference-analysis/shorts-scene-prompt-contract";
import {
  copyText, createPromptSet, downloadText, newRequestId, replyMessage, requestBgmPrompt, requestScenePromptRange, type Reply,
} from "./shorts-client";
import {
  clip, fileName, promptSetDocument, promptSetMarkdown, timecode, type ShortsScenePrompts, type ShortsScript, type ShortsSelection,
  type ShortsSource,
} from "./shorts-session";
import type { ShortsStepProps } from "./shorts-step-types";
import { Consent, CopyButton, Field, NeedsStep, RunningCard, RunStatus, useRun } from "./shorts-step-ui";
import s from "./shorts-studio.module.css";

// P1-08 원본 PromptsStep.tsx: 대본 전 장면의 9:16 이미지·영상 프롬프트와 전체 BGM 프롬프트를 만든다.
// P1-08-SHORTS-SCENE-CHUNKS: 서버 28초 마감 안에 들도록 장면을 최대 9개씩 구간으로 나눠 차례로 받고, BGM은 BGM 경로로 따로 받는다.
// 받은 구간·BGM은 같은 대본(기준 키)일 때만 남겨 실패한 부분만 다시 보내고, 전부 모여 계약을 통과할 때만 세션·프로젝트에 넣는다.
// 결과는 장면별·전체 복사, Markdown 내려받기, 프롬프트 보관함 저장. 저장 요청 ID는 같은 결과에 한 번만 만들어 재시도해도 두 번 저장되지 않는다.
type TimedPrompt = ShortsScenePrompts["prompts"][number];
type BgmPrompt = ShortsScenePrompts["bgmPrompt"];
type BgmResult = z.infer<typeof shortsBgmPromptResult>;
export type SceneChunk = { from: number; to: number };
/** 받아 둔 부분. key는 장면 구간의 기준(출처·소재·대본), bgm.key는 BGM 기준(+BGM 방향). */
export type ScenePromptParts = { key: string; chunks: Record<number, TimedPrompt[]>; bgm: { key: string; value: BgmPrompt } | null; version: number };
export type ScenePromptBasis = { source: ShortsSource; selected: Pick<ShortsSelection, "title" | "openingHook">; script: ShortsScript; bgmDirection: string };

/** 장면 수를 최대 9개짜리 구간으로 고르게 나눈다(45장면 → 9개씩 5구간). */
export function planSceneChunks(count: number, size = shortsScenePromptsRangeMax): SceneChunk[] {
  const parts = Math.ceil(count / size);
  const each = Math.ceil(count / parts);
  return Array.from({ length: parts }, (_, index) => ({ from: index * each + 1, to: Math.min(count, (index + 1) * each) }))
    .filter(chunk => chunk.from <= chunk.to);
}

const basisBody = ({ source, selected, script }: ScenePromptBasis) => ({ source,
  selectedIdea: { title: selected.title, openingHook: selected.openingHook }, durationSec: script.durationSec, scenes: script.scenes });
export const sceneChunkKey = (basis: ScenePromptBasis) => JSON.stringify(basisBody(basis));
export const bgmKey = (basis: ScenePromptBasis) => JSON.stringify([sceneChunkKey(basis), basis.bgmDirection.trim().slice(0, 240)]);
export const emptyParts = (basis: ScenePromptBasis): ScenePromptParts => ({ key: sceneChunkKey(basis), chunks: {}, bgm: null, version: 0 });

/** BGM 경로의 큐(최대 4개): 첫 장면·1/3·2/3·마지막 장면의 자막(없으면 나레이션) 120자. */
export function bgmCues(script: ShortsScript) {
  const last = script.scenes.length - 1;
  const picks = [...new Set([0, Math.round(last / 3), Math.round((last * 2) / 3), last])].sort((a, b) => a - b);
  return picks.map(index => { const scene = script.scenes[index];
    return { sceneNumber: scene.sceneNumber, startSec: scene.startSec, endSec: scene.endSec, note: clip(scene.caption ?? scene.narration, 120) }; });
}

/** 모든 구간과 BGM이 같은 기준으로 모였으면 기존 전체 묶음 계약을 통과하는 결과로 합친다. 하나라도 없거나 맞지 않으면 null.
 * F2: withoutBgm이면 장면만 모인 것으로 충분하고, 지금 기준의 BGM이 없으면 bgmPrompt를 null로 둔다(BGM만 실패한 부분 성공). */
export function assembleScenePrompts(basis: ScenePromptBasis, parts: ScenePromptParts, withoutBgm = false): ShortsScenePrompts | null {
  const bgm = parts.bgm && parts.bgm.key === bgmKey(basis) ? parts.bgm.value : null;
  if (parts.key !== sceneChunkKey(basis) || (!bgm && !withoutBgm)) return null;
  const plan = planSceneChunks(basis.script.scenes.length);
  if (plan.some(chunk => !parts.chunks[chunk.from])) return null;
  const generation = { kind: "creative_scene_prompts_draft" as const, durationSec: basis.script.durationSec,
    prompts: plan.flatMap(chunk => parts.chunks[chunk.from]), bgmPrompt: bgm };
  const checked = shortsScenePromptsBatchResult.safeParse({ schemaVersion: 1, geminiCredentialVersion: Math.max(1, parts.version),
    source: basis.source, generation });
  return checked.success ? checked.data.generation : null;
}

type Fill = {
  basis: ScenePromptBasis; parts: ScenePromptParts; signal: AbortSignal;
  /** 지금도 같은 작업·같은 대본인지. 아니면 늦은 응답을 버린다. */
  current: () => boolean;
  requestRange: (body: Record<string, unknown> & { range: SceneChunk }, signal: AbortSignal) => Promise<Reply<ShortsScenePromptsRangeResult>>;
  requestBgm: (body: Record<string, unknown>, signal: AbortSignal) => Promise<Reply<BgmResult>>;
  onPart: (parts: ScenePromptParts) => void;
  onProgress: (text: string) => void;
  /** F2: 장면은 모두 받았는데 BGM 요청만 실패했을 때. 이때 결과는 BGM 없이(null) 성공으로 돌려준다. */
  onBgmFailed?: (reply: Exclude<Reply<BgmResult>, { kind: "ok" }>) => void;
};
const stopped = { kind: "failed", code: "cancelled", status: 0 } as const;

/** 빠진 구간과 BGM만 차례로 받는다. 실패하면 거기서 멈추고, 이미 받은 부분은 onPart로 남긴다. */
export async function fillScenePromptParts({ basis, parts: start, signal, current, requestRange, requestBgm, onPart, onProgress, onBgmFailed }: Fill):
  Promise<Reply<ShortsScenePrompts>> {
  let parts = start.key === sceneChunkKey(basis) ? start : emptyParts(basis);
  const plan = planSceneChunks(basis.script.scenes.length);
  const total = plan.length + 1;
  for (const [index, chunk] of plan.entries()) {
    if (parts.chunks[chunk.from]) continue;
    onProgress(`장면 ${chunk.from}~${chunk.to} 만드는 중 (${index + 1}/${total})`);
    const reply = await requestRange({ ...basisBody(basis), range: chunk }, signal);
    if (signal.aborted || !current()) return stopped;
    if (reply.kind !== "ok") return reply;
    parts = { ...parts, chunks: { ...parts.chunks, [chunk.from]: reply.value.generation.prompts }, version: reply.value.geminiCredentialVersion };
    onPart(parts);
  }
  if (!parts.bgm || parts.bgm.key !== bgmKey(basis)) {
    onProgress(`BGM 프롬프트 만드는 중 (${total}/${total})`);
    const direction = basis.bgmDirection.trim().slice(0, 240);
    const { source, selectedIdea, durationSec } = basisBody(basis);
    const reply = await requestBgm({ source, selectedIdea, durationSec, cues: bgmCues(basis.script), ...(direction && { direction }) }, signal);
    if (signal.aborted || !current()) return stopped;
    if (reply.kind !== "ok") {
      // F2(원본 pipeline): 장면은 모두 받았으니 BGM 없이 결과를 살린다. 받은 장면 부분은 그대로 남아 다시 누르면 BGM만 요청한다.
      const scenesOnly = assembleScenePrompts(basis, parts, true);
      if (!scenesOnly) return reply;
      onBgmFailed?.(reply);
      return { kind: "ok", value: scenesOnly };
    }
    const { title, genreAndMood, recommendedBpmRange, instrumentation, dynamicStructure, audioMixingNotes, sunoPrompt } = reply.value.generation;
    parts = { ...parts, version: reply.value.geminiCredentialVersion, bgm: { key: bgmKey(basis),
      value: { title, genreAndMood, recommendedBpmRange, instrumentation, dynamicStructure, audioMixingNotes, sunoPrompt } } };
    onPart(parts);
  }
  const assembled = assembleScenePrompts(basis, parts);
  return assembled ? { kind: "ok", value: assembled } : { kind: "failed", code: "invalid_response", status: 0 };
}

/** 받아 둔 부분 수(대본이 같을 때만 센다). */
export function partsSummary(basis: ScenePromptBasis, parts: ScenePromptParts) {
  const plan = planSceneChunks(basis.script.scenes.length);
  if (parts.key !== sceneChunkKey(basis)) return { done: 0, total: plan.length + 1 };
  return { done: plan.filter(chunk => parts.chunks[chunk.from]).length + (parts.bgm?.key === bgmKey(basis) ? 1 : 0), total: plan.length + 1 };
}

/** 받아 둔 부분의 상태: 없음·일부·장면은 다 있고 BGM만 없음(방향이 바뀌었거나 BGM만 실패). */
export function partsState(basis: ScenePromptBasis, parts: ScenePromptParts): "none" | "partial" | "bgm" {
  if (parts.key !== sceneChunkKey(basis) || assembleScenePrompts(basis, parts)) return "none";
  const chunksDone = planSceneChunks(basis.script.scenes.length).every(chunk => parts.chunks[chunk.from]);
  if (chunksDone) return "bgm";
  return partsSummary(basis, parts).done > 0 ? "partial" : "none";
}

/** 원본 promptCopy.formatScenePrompts: 장면 번호 순으로 '[SCENE n]' 머리말을 붙여 한 종류씩 모은다(빈 프롬프트는 뺀다). 장면별 '복사'는 프롬프트 원문 그대로다. */
export function bulkPromptText(prompts: readonly Pick<TimedPrompt, "sceneNumber" | "imagePrompt" | "videoPrompt">[], kind: "image" | "video") {
  return [...prompts].sort((a, b) => a.sceneNumber - b.sceneNumber)
    .map(prompt => ({ number: prompt.sceneNumber, text: (kind === "image" ? prompt.imagePrompt : prompt.videoPrompt).trim() }))
    .filter(block => block.text)
    .map(block => `[SCENE ${block.number}]\n${block.text}`)
    .join("\n\n");
}

/** F2: 장면은 만들고 BGM만 실패했을 때의 완료 문구. reason은 실패 안내 그대로. 다시 누르기 안내는 단추 아래 힌트가 맡는다. */
export const bgmScenesOnlyText = (scenes: number, reason: string) =>
  `${scenes}개 장면 프롬프트를 만들었어요. BGM 프롬프트는 만들지 못했어요.${reason.trim() ? ` ${reason.trim()}` : ""}`;

/** 여러 번 나눠 보내는 ⑥ 실행 문구: 40초는 요청 하나의 상한이고, 전체는 남은 요청 수만큼 걸린다. */
export const chunkRunningText = (remaining: number) =>
  `Gemini가 나눠서 만들고 있어요. 요청마다 최대 40초쯤 걸리고, 남은 요청은 ${remaining}번이에요.`;

type VaultSave = { kind: "idle" | "saving" | "saved" | "closed" | "limit" } | { kind: "failed"; message: string };

export function ShortsPromptsStep({ goTo, settingsHref, work }: ShortsStepProps) {
  const { session } = work;
  const id = useId();
  const state = useRun(work, "prompts");
  const [bgmDirection, setBgmDirection] = useState("");
  const [parts, setParts] = useState<ScenePromptParts>({ key: "", chunks: {}, bgm: null, version: 0 });
  const [progress, setProgress] = useState("");
  // 지금 화면의 기준 키. 응답이 도착했을 때 대본·소재가 바뀌었으면(다른 프로젝트·새 대본) 그 응답을 버린다.
  const basisKey = useRef("");
  // 저장 상태는 그 상태를 만든 결과(scenePrompts)에 묶는다. 결과가 바뀌면 자동으로 '저장 전'이 된다.
  const [saved, setSaved] = useState<{ prompts: unknown; state: VaultSave }>({ prompts: null, state: { kind: "idle" } });
  const saving = useRef<AbortController | null>(null);
  const { selected, source, script, scenePrompts } = session;
  const document = useMemo(() => promptSetDocument(session), [session]);
  // 결과가 바뀌면 새 저장 요청 ID(같은 결과를 다시 눌러도 서버는 한 번만 저장한다).
  const requestId = useMemo(() => (scenePrompts ? newRequestId() : ""), [scenePrompts]);
  const vault: VaultSave = saved.prompts === scenePrompts ? saved.state : { kind: "idle" };
  useEffect(() => () => saving.current?.abort(), []);
  const liveKey = selected && source && script ? sceneChunkKey({ source, selected, script, bgmDirection }) : "";
  useEffect(() => { basisKey.current = liveKey; }, [liveKey]);
  if (!selected || !source || !script) return <NeedsStep title="🎨 9:16 비주얼 프롬프트" goTo={goTo} back="script" label="5. 대본으로"
    text="대본이 아직 없어요. 먼저 ⑤에서 대본을 만들어 주세요." />;

  const basis: ScenePromptBasis = { source, selected, script, bgmDirection };
  const summary = partsSummary(basis, parts);
  const kept = partsState(basis, parts);
  const ready = work.consent && !state.running;
  const run = () => {
    const key = sceneChunkKey(basis);
    const alive = work.alive();
    // 모두 모인 결과를 다시 만들 때는 처음부터, 일부만 있으면 빠진 구간·BGM만 보낸다.
    const start = assembleScenePrompts(basis, parts) ? emptyParts(basis) : parts;
    const current = () => alive() && basisKey.current === key;
    setProgress("");
    setParts(start);
    let bgmFailure = "";
    void state.run(signal => fillScenePromptParts({ basis, parts: start, signal, current, requestRange: requestScenePromptRange,
      requestBgm: requestBgmPrompt, onPart: next => { if (current()) setParts(next); }, onProgress: text => { if (current()) setProgress(text); },
      onBgmFailed: reply => { bgmFailure = replyMessage(reply); } }),
    value => { setProgress(""); work.commit({ scenePrompts: value }); },
    value => value.bgmPrompt ? `${script.scenes.length}개 장면 프롬프트와 BGM 프롬프트를 만들었어요.`
      : bgmScenesOnlyText(script.scenes.length, bgmFailure));
  };
  const save = async () => {
    if (!document || vault.kind === "saving" || vault.kind === "saved") return;
    saving.current?.abort();
    const controller = new AbortController();
    saving.current = controller;
    const alive = work.alive();
    const prompts = scenePrompts;
    const set = (state: VaultSave) => setSaved({ prompts, state });
    set({ kind: "saving" });
    const reply = await createPromptSet(requestId, document, controller.signal);
    if (saving.current !== controller || controller.signal.aborted || !alive()) return;
    saving.current = null;
    if (reply.kind === "ok") set({ kind: "saved" });
    else if (reply.kind === "failed" && reply.status === 503) set({ kind: "closed" });
    else if (reply.kind === "failed" && reply.code === "limit_reached") set({ kind: "limit" });
    else set({ kind: "failed", message: replyMessage(reply) });
  };

  return <div className={s.stepStack}>
    <section className={s.card} aria-labelledby={`${id}-head`}>
      <div className={s.cardHead}>
        <h3 id={`${id}-head`}>{selected.title}</h3>
        <span className={s.cardMeta}>{script.durationSec}초 · {script.scenes.length}씬</span>
      </div>
      <p className={s.readyText}>씬별 이미지·영상 생성 프롬프트와 전체 BGM 프롬프트를 만들어요. 장면은 {shortsScenePromptsRangeMax}개씩 나눠 차례로 받아요.</p>
      {/* 실행 중에는 BGM 방향을 잠근다: 실행이 시작할 때의 방향으로 만든 BGM이 바뀐 방향 아래 저장되지 않게. 실패·취소 뒤에는 고칠 수 있고, 방향만 바뀌면 BGM만 다시 만든다. */}
      <Field label="BGM 방향 (선택)" hint={state.running ? "만드는 동안에는 바꿀 수 없어요." : "240자까지."}><input className={s.input} value={bgmDirection} maxLength={240}
        disabled={state.running} placeholder="예: 가사 없는 밝은 로파이, 훅에서 잠깐 멈춤" onChange={event => setBgmDirection(event.target.value)} /></Field>
      <Consent work={work} disabled={state.running} />
      <div className={s.readyActions}>
        <button type="button" className={s.primary} disabled={!ready} onClick={run}>
          {state.running ? "프롬프트 생성 중…" : kept === "bgm" ? "BGM만 다시 만들기" : kept === "partial" ? "남은 부분 이어서 만들기"
            : scenePrompts ? "프롬프트 다시 만들기" : "프롬프트 생성"}
        </button>
      </div>
      <RunStatus state={state} settingsHref={settingsHref} onCancel={state.cancel} runningText={chunkRunningText(Math.max(1, summary.total - summary.done))} />
      {state.running && progress && <p className={s.fieldHint} aria-live="polite">{progress}</p>}
      {!state.running && kept === "partial" && <p className={s.fieldHint}>{summary.total}개 부분 중 {summary.done}개를 받아 두었어요. 다시 누르면 남은 부분만 만들어요.</p>}
      {!state.running && kept === "bgm" && <p className={s.fieldHint}>{parts.bgm ? "BGM 방향이 바뀌었어요." : "BGM 프롬프트만 아직 없어요."} 다시 누르면 장면 프롬프트는 그대로 두고 BGM만 새로 만들어요.</p>}
    </section>

    {state.running && <RunningCard title="프롬프트 생성 중…" text="장면 이미지·영상 프롬프트와 BGM 프롬프트를 차례로 받고 있어요. 받은 부분은 남아서 취소해도 이어 만들 수 있어요."
      done={summary.done} total={summary.total} />}
    {scenePrompts && <section className={s.card} aria-labelledby={`${id}-result`} aria-busy={state.running || undefined}>
      <div className={s.cardHead}>
        <h3 id={`${id}-result`}>이미지·영상 프롬프트</h3>
        <span className={s.rowActions}>
          <CopyButton copy={copyText} label="이미지 전체 복사" text={bulkPromptText(scenePrompts.prompts, "image")} />
          <CopyButton copy={copyText} label="영상 전체 복사" text={bulkPromptText(scenePrompts.prompts, "video")} />
          {document && <button type="button" className={s.ghost} onClick={() => downloadText(fileName(document.title, "prompts"), promptSetMarkdown(document))}>📥 .md 저장</button>}
        </span>
      </div>
      <p className={s.fieldHint}>씬 번호 순서로 [SCENE n] 머리말을 붙여 모아 복사해요.</p>
      <ol className={s.sceneList}>
        {scenePrompts.prompts.map(prompt => <li key={prompt.sceneNumber} className={s.sceneCard}>
          <div className={s.ideaHead}><span className={s.ideaTag}>SCENE {prompt.sceneNumber}</span><span className={s.cardMeta}>⏱️ {timecode(prompt)}</span></div>
          <p className={s.ideaBody}>{prompt.sceneSummary}</p>
          <div className={s.promptBox}><span className={s.hookLabel}>Image</span><p lang="en">{prompt.imagePrompt}</p>
            <CopyButton copy={copyText} label="복사" text={prompt.imagePrompt} /></div>
          <div className={s.promptBox}><span className={s.hookLabel}>Video</span><p lang="en">{prompt.videoPrompt}</p>
            <CopyButton copy={copyText} label="복사" text={prompt.videoPrompt} /></div>
        </li>)}
      </ol>
      {/* F2: BGM만 실패한 결과는 원본처럼 BGM 칸을 그리지 않는다(장면 프롬프트는 그대로 쓰고 저장한다). */}
      {scenePrompts.bgmPrompt && <BgmResult bgm={scenePrompts.bgmPrompt} headingId={`${id}-bgm`} />}
      <div className={s.splitActions}>
        <p role="status" className={s.statusText}>{{
          idle: "", saving: "보관함에 저장하고 있어요…", saved: "프롬프트 보관함에 저장했어요.",
          closed: "프롬프트 보관함이 아직 연결되지 않아 저장하지 않았어요. 복사·내려받기는 그대로 쓸 수 있어요.",
          limit: "보관함은 200세트까지 저장해요. 보관함에서 오래된 세트를 지운 뒤 다시 저장해 주세요.",
          failed: vault.kind === "failed" ? `보관함에 저장하지 못했어요. ${vault.message}` : "",
        }[vault.kind]}</p>
        <span className={s.rowActions}>
          <button type="button" className={s.primary} disabled={!document || vault.kind === "saving" || vault.kind === "saved" || state.running} onClick={() => void save()}>
            {vault.kind === "saved" ? "✓ 보관함에 저장됨" : vault.kind === "saving" ? "저장 중…" : "📚 보관함에 저장"}
          </button>
          <button type="button" className={s.ghost} onClick={() => goTo("vault")}>보관함 열기</button>
        </span>
      </div>
    </section>}
    <button type="button" className={s.inlineLink} onClick={() => goTo("script")}>← 대본 생성으로</button>
  </div>;
}

/** ⑥ BGM 결과: 원본처럼 이름표 붙은 칸으로 나눈다. 서버가 준 값만 그리고, 빈 값과 없는 BPM은 칸을 만들지 않는다. */
export function BgmResult({ bgm, headingId }: { bgm: NonNullable<BgmPrompt>; headingId: string }) {
  const facts = ([["🎼 장르·분위기", bgm.genreAndMood], ["🥁 악기", bgm.instrumentation], ["📈 전개", bgm.dynamicStructure], ["💡 믹싱 팁", bgm.audioMixingNotes]] as const)
    .filter(([, value]) => value.trim());
  return <section className={s.sceneCard} aria-labelledby={headingId}>
    <div className={s.ideaHead}><span className={s.ideaTag}>🎵 BGM</span>
      {bgm.recommendedBpmRange && <span className={s.cardMeta}>추천 {bgm.recommendedBpmRange.min}–{bgm.recommendedBpmRange.max} BPM</span>}</div>
    <h4 id={headingId} className={s.ideaTitle}>{bgm.title}</h4>
    {facts.length > 0 && <div className={s.detailGrid}>
      {facts.map(([label, value]) => <div key={label} className={s.hookBox}><span className={s.hookLabel}>{label}</span><p className={s.ideaBody}>{value}</p></div>)}
    </div>}
    <div className={s.promptBox}><span className={s.hookLabel}>🎵 Suno prompt</span><p lang="en">{bgm.sunoPrompt}</p>
      <CopyButton copy={copyText} label="Suno 복사" text={bgm.sunoPrompt} /></div>
  </section>;
}
