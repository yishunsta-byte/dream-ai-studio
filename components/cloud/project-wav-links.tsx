"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";

type Track = { id: string; title: string; durationMs: number; rightsNote: string | null };

export function ProjectWavLinks({ projectId, asset }: { projectId: string; asset: string }) {
  const path = `/api/projects/${encodeURIComponent(projectId)}/audio-assets`;
  const [tracks, setTracks] = useState<Track[]>();
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(path, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error();
        const result = await res.json();
        if (!Array.isArray(result.assets)) throw new Error();
        if (!controller.signal.aborted) setTracks(result.assets);
      } catch { if (!controller.signal.aborted) setLoadError(true); }
    }
    void load();
    return () => controller.abort();
  }, [path, revision]);
  function refresh() {
    setLoadError(false); setTracks(undefined); setRevision(value => value + 1);
  }
  async function attach() {
    if (writing.current || !asset) return;
    writing.current = true; setPending(true); setWriteError("");
    try {
      const res = await fetch(`${path}/${encodeURIComponent(asset)}`, { method: "PUT" });
      if (!res.ok || (await res.json()).assetId !== asset) throw new Error();
    } catch { setWriteError("연결 결과를 확인해 주세요. 목록에 없으면 같은 음원으로 다시 연결할 수 있어요."); }
    finally { writing.current = false; setPending(false); refresh(); }
  }
  const attached = tracks?.some(track => track.id === asset);
  return <section aria-label="프로젝트 연결 음원" className="stack">
    <h3>프로젝트 연결 음원</h3>
    {loadError ? <><p role="alert">연결 목록을 불러오지 못했어요.</p><Button type="button" onClick={refresh}>연결 목록 다시 확인</Button></>
      : !tracks ? <p role="status">연결 목록 확인 중</p>
      : tracks.length ? <ul>{tracks.map(track => <li key={track.id}>
        <strong>{track.title}</strong> · {track.durationMs / 1000}초
        {track.rightsNote && <p>{track.rightsNote}</p>}
        <audio controls preload="none" aria-label={track.title + " 듣기"} src={`/api/assets/${encodeURIComponent(track.id)}?format=wav`} />
      </li>)}</ul> : <p>연결된 음원이 없어요.</p>}
    {writeError && !attached && <p role="alert">{writeError}</p>}
    {asset && tracks && (attached ? <p role="status">이 프로젝트에 연결됨</p>
      : <Button type="button" loading={pending} loadingLabel="연결 중" onClick={attach}>등록한 음원을 프로젝트에 연결</Button>)}
  </section>;
}
