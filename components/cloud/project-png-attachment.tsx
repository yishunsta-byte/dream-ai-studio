"use client";

import { type FormEvent, useRef, useState } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { Field } from "@/components/ui/interactive";
import { createPrivatePngUpload } from "./private-png-request";

type Source = { id: string; title: string };
type Props = {
  endpoint: string; planId: string; revision: number; disabled: boolean;
  onBusy: (busy: boolean) => void; onAttached: (source: Source) => void;
};

export function ProjectPngAttachment({ endpoint, planId, revision, disabled, onBusy, onAttached }: Props) {
  const [upload] = useState(createPrivatePngUpload);
  const [file, setFile] = useState<File>();
  const [rights, setRights] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || disabled || submitting.current) return;
    const form = event.currentTarget;
    if (!file.size || file.size > 1024 * 1024) {
      setError("1 MiB 이하의 PNG 파일을 선택해 주세요.");
      return;
    }
    submitting.current = true;
    setPending(true);
    onBusy(true);
    setError("");
    setStatus("");
    try {
      const assetId = await upload(file, rights);
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "attach-png", planId, revision, assetId }),
      });
      const result = await response.json();
      if (!response.ok || typeof result?.id !== "string" || typeof result.title !== "string") {
        throw new Error(result?.error || "같은 파일로 다시 연결을 시도해 주세요.");
      }
      onAttached(result as Source);
      setStatus(`${result.title}을 프로젝트에 연결했어요.`);
      form.reset();
      setFile(undefined);
      setRights("");
    } catch (failure) {
      setError(failure instanceof TypeError ? "연결 결과를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요." :
        failure instanceof Error ? failure.message : "PNG 연결을 완료하지 못했어요.");
    } finally {
      submitting.current = false;
      setPending(false);
      onBusy(false);
    }
  }

  return <Card className="stack">
    <h2>제작용 PNG 추가</h2>
    <form className="stack" onSubmit={event => void submit(event)}>
      <Field label="추가할 PNG" help="1 MiB 이하 PNG 한 장">
        <input type="file" accept="image/png,.png" disabled={disabled || pending} onChange={event => {
          setFile(event.target.files?.[0]);
          setRights("");
          setError("");
          setStatus("");
        }} />
      </Field>
      <Field label="추가 PNG 출처·권리 메모" help="선택 사항 · 500자 이내">
        <textarea value={rights} maxLength={500} disabled={disabled || pending} onChange={event => setRights(event.target.value)} />
      </Field>
      <div><Button type="submit" loading={pending} loadingLabel="연결 중"
        disabled={!file || disabled}>PNG 프로젝트에 연결</Button></div>
    </form>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
