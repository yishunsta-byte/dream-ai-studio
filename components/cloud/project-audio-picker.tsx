"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Track = { id: string; title: string; durationMs: number; rightsNote: string | null };

export function ProjectAudioPicker({ projectId }: { projectId: string }) {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/audio-assets`;
  const selection = useSearchParams()?.get("track");
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playError, setPlayError] = useState(false);
  // 검수(LOCAL-PROJECT-EDITING-AUDIO-PICKER): 다시 확인 버튼이 사라지며 초점이 BODY로 떨어졌다.
  // 바깥 영역은 항상 남아 있으므로 누른 즉시 초점을 그곳에 두고, 결과가 그려지면 이어서 쓸 조작으로 옮긴다.
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error();
        const { assets } = await res.json();
        if (!Array.isArray(assets)) throw new Error();
        if (!controller.signal.aborted) setTracks(assets);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, attempt]);

  useEffect(() => {
    if (!pendingFocus.current || (!tracks && !failed)) return;
    pendingFocus.current = false;
    const area = root.current;
    // 같은 음원으로 이어서 듣도록 플레이어를 먼저, 음원이 없을 때만 선택 상자, 다시 실패하면 재시도 버튼.
    const next = failed ? area?.querySelector<HTMLElement>("button") : (area?.querySelector<HTMLElement>("audio") ?? area?.querySelector<HTMLElement>("select"));
    (next ?? area)?.focus();
  }, [tracks, failed]);

  function reload() {
    pendingFocus.current = true;
    root.current?.focus();
    setTracks(null);
    setFailed(false);
    setPlayError(false);
    setAttempt(value => value + 1);
  }
  return <div ref={root} tabIndex={-1} aria-label="편집 음원">{content()}</div>;

  function content() {
  if (failed) return <div role="alert">음원 목록을 불러오지 못했어요. <button type="button" onClick={reload}>목록 다시 확인</button></div>;
  if (!tracks) return <p role="status">음원 목록을 불러오는 중이에요.</p>;
  if (!tracks.length) return <p>연결된 음원이 없어요. 프로젝트 상세에서 음원을 연결해 주세요.</p>;
  const track = tracks.find(item => item.id === selection);
  return <section className="stack">
    <label htmlFor="editing-track">프로젝트에 연결된 음원</label>
    <select id="editing-track" value={track?.id ?? ""} onChange={event => {
      const url = new URL(window.location.href);
      if (event.target.value) url.searchParams.set("track", event.target.value);
      else url.searchParams.delete("track");
      window.history.replaceState(null, "", url);
      setPlayError(false);
    }}>
      <option value="">음원을 선택해 주세요</option>
      {tracks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select>
    {selection && !track && <p role="status">선택했던 음원을 사용할 수 없어요.</p>}
    {track && <>
      <p>{track.durationMs / 1000}초{track.rightsNote && <> · {track.rightsNote}</>}</p>
      <audio key={track.id} aria-label={track.title + " 미리 듣기"} controls preload="none"
        src={endpoint + "/" + encodeURIComponent(track.id)} onError={() => setPlayError(true)} />
      {playError && <p role="alert">음원을 재생할 수 없어요. <button type="button" onClick={reload}>연결 상태 다시 확인</button></p>}
    </>}
  </section>;
  }
}
