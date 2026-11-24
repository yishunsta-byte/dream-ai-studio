"use client";

import { useEffect, useRef, useState } from "react";
import { v7 } from "uuid";
import { Button, Card } from "@/components/ui/primitives";
import { Field } from "@/components/ui/interactive";
import { ProjectWavLinks } from "./project-wav-links";

type Selection = { file: File; url: string };

export function PrivateWavPanel({ projectId }: { projectId?: string }) {
  const [selection, setSelection] = useState<Selection>();
  const [note, setNote] = useState("");
  const [asset, setAsset] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [readError, setReadError] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (asset) confirmation.current?.focus(); }, [asset]);
  const active = useRef(false);
  const request = useRef<{ file: File; note: string; key: string }>(undefined);
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url); }, [selection]);

  function select(file?: File) {
    setNote(""); setSelection(undefined); setAsset(""); setError(""); setPreviewError(false); setReadError(false);
    request.current = undefined;
    if (!file) return;
    if (!file.size || file.size > 1024 * 1024 || !/\.wav$/i.test(file.name)) {
      setError("1 MiB 이하의 16비트 PCM WAV 파일을 선택해 주세요."); return;
    }
    setSelection({ file, url: URL.createObjectURL(file) });
  }

  async function register() {
    if (!selection || active.current || asset) return;
    active.current = true; setPending(true); setError("");
    try {
      const { file } = selection;
      const rightsNote = note.trim();
      if (request.current?.file !== file || request.current.note !== rightsNote)
        request.current = { file, note: rightsNote, key: v7() };
      const query = new URLSearchParams({ format: "wav", filename: file.name, rightsNote });
      const response = await fetch(`/api/assets/upload?${query}`, {
        method: "POST", body: file, headers: { "Content-Type": "audio/wav", "Idempotency-Key": request.current.key },
      });
      const result = await response.json();
      if (response.status !== 201 || typeof result?.id !== "string" || !result.id) {
        setError(result?.error || "음원 등록 결과를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요."); return;
      }
      setAsset(result.id);
    } catch {
      setError("음원 등록 결과를 확인하지 못했어요. 같은 파일과 메모로 다시 시도해 주세요.");
    } finally { active.current = false; setPending(false); }
  }

  return <Card><section aria-label="비공개 음원" className="stack form-width">
    <h2>비공개 음원</h2>
    <Field label="음원 선택" help="16비트 정수 PCM WAV 한 곡 · 모노/스테레오 · 8–192 kHz · 최대 1 MiB">
      <input type="file" accept=".wav,audio/wav,audio/x-wav" disabled={pending} onChange={e => select(e.target.files?.[0])} />
    </Field>
    {selection && <>
      <p>기기에서 선택됨 · {selection.file.name} · {selection.file.size.toLocaleString("ko-KR")}바이트</p>
      <audio key={selection.url} aria-label="선택한 파일 미리 듣기" controls preload="metadata" src={selection.url} onError={() => setPreviewError(true)} />
      {previewError && <p role="status">기기에서 재생할 수 없어요. 파일 형식을 확인해 주세요.</p>}
      <Field label="음원 출처·권리 메모" help="선택 사항 · 500자 이내">
        <textarea maxLength={500} value={note} disabled={pending} placeholder="예: 직접 녹음한 피아노 연주" onChange={e => {
          if (e.target.value.trim() !== note.trim()) { setAsset(""); setReadError(false); setError(""); }
          setNote(e.target.value);
        }} />
      </Field>
      {!asset && <Button type="button" loading={pending} loadingLabel="등록 중" onClick={register}>비공개 음원 등록</Button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {asset && <>
      <p ref={confirmation} tabIndex={-1} role="status">{projectId ? "비공개 자료로 등록됨" : "비공개 자료로 등록됨 · 프로젝트 연결 전"}</p>
      <audio ref={player} controls preload="metadata" aria-label="등록한 음원 듣기" src={`/api/assets/${encodeURIComponent(asset)}?format=wav`}
        onError={() => setReadError(true)} onLoadedMetadata={() => setReadError(false)} />
      {readError && <Button type="button" onClick={() => player.current?.load()}>등록한 음원 다시 불러오기</Button>}
    </>}
    {projectId && <ProjectWavLinks key={projectId} projectId={projectId} asset={asset} />}
  </section></Card>;
}
