"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import styles from "./admin-music-semantic.module.css";
import { SceneDraftSave, useSceneDraftTarget } from "./admin-scene-draft-save";

// admin-music-semantic.tsx에서 옮김(P1-07 상세 보고서도 같은 부품을 쓴다). 동작은 그대로.
// 화면 안에서 고쳐 복사할 수 있다. 작업실에서 연 장면이 확인되면 '장면 N 초안에 저장'을 눌렀을 때만 그 장면 음악 초안으로
// 제안 원문(suggested)과 지금 편집문(text)을 저장한다(SceneDraftSave는 장면 문맥이 없으면 그리지 않는다).
export function SunoPrompt({ original }: { original: string }) {
  const [draft, setDraft] = useState(original);
  const [copy, setCopy] = useState("");
  const prompt = useRef<HTMLTextAreaElement>(null);
  const edited = draft !== original;
  const scene = useSceneDraftTarget();
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(draft); setCopy("Suno 프롬프트를 복사했어요."); }
    catch { prompt.current?.focus(); prompt.current?.select(); setCopy("선택된 프롬프트를 직접 복사해 주세요."); }
  }
  return <>
    <textarea ref={prompt} className={styles.prompt} aria-label="Suno용 프롬프트 제안" value={draft}
      onChange={event => { setDraft(event.target.value); setCopy(""); }} />
    <div className={styles.actions}>
      <Button type="button" variant="secondary" onClick={copyPrompt}>Suno 프롬프트 복사</Button>
      {edited && <Button type="button" variant="ghost" onClick={() => { setDraft(original); setCopy("제안된 프롬프트로 되돌렸어요."); }}>원래대로</Button>}
    </div>
    <p className={styles.hint}>{!edited ? "고쳐서 복사할 수 있어요." : scene ? "고친 내용은 복사하거나 장면 초안에 저장할 때만 쓰여요."
      : "고친 내용은 이 화면에서만 쓰고 저장하지 않아요."}</p>
    <p role="status">{copy}</p>
    <SceneDraftSave input={{ suggested: original, text: draft }} />
  </>;
}
