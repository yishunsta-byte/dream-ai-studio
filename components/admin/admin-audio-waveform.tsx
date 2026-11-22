"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/primitives";
import styles from "./admin-audio-waveform.module.css";

// Audio Analyzer v1.01 WaveformCanvas를 옮긴 부품: 선택한 파일을 브라우저에서 디코딩해 120구간 평균 진폭으로
// 파형을 그리고, 재생·일시정지·처음으로·음소거·위치 이동을 제공한다. 파일은 서버로 보내지 않는다.
// 위치 이동은 키보드로도 쓸 수 있게 파형 위에 겹친 range 입력으로 한다.
const SAMPLES = 120;
// 4 MiB보다 큰 파일(보호 업로드 대상)도 원본처럼 디코딩해 파형을 그린다(P1-07 A-2). 그리는 동안 안내만 바꾼다.
const LARGE = 4 * 1024 * 1024;

export function waveformPeaks(channel: Float32Array, samples = SAMPLES): number[] {
  const block = Math.floor(channel.length / samples);
  if (block < 1) return [];
  const sums = Array.from({ length: samples }, (_, index) => {
    let sum = 0;
    for (let offset = 0; offset < block; offset += 1) sum += Math.abs(channel[index * block + offset]);
    return sum / block;
  });
  const peak = Math.max(...sums);
  return peak > 0 ? sums.map(value => Math.max(0.08, value / peak)) : sums.map(() => 0.08);
}

export const clock = (seconds: number) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
};

type Wave = { peaks: number[] } | { failed: true };
type Playback = { kind: "loading" } | { kind: "ready"; duration: number } | { kind: "failed" };

// 파일 하나마다 재생기를 새로 만든다(같은 File 객체면 같은 번호). 이전 파일의 길이·위치·오류·늦게 끝난 디코딩이
// 새 파일에 남지 않는다. 부모가 key를 주지 않아도 되게 부품 안에서 처리한다.
const fileIds = new WeakMap<File, number>();
let lastFileId = 0;
function fileKey(file: File) {
  let key = fileIds.get(file);
  if (key === undefined) { key = ++lastFileId; fileIds.set(file, key); }
  return key;
}

export function AudioWaveform({ file }: { file: File }) {
  return <WaveformPlayer key={fileKey(file)} file={file} />;
}

function WaveformPlayer({ file }: { file: File }) {
  const id = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const [wave, setWave] = useState<Wave>();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  // 재생 조작은 이 파일의 재생 정보(길이)를 확인한 뒤에만 연다.
  const [playback, setPlayback] = useState<Playback>({ kind: "loading" });
  const [status, setStatus] = useState("");

  // 재생용 blob URL: 파일이 바뀌거나 화면에서 빠지면 해제한다.
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    const url = URL.createObjectURL(file);
    player.src = url;
    return () => {
      player.pause();
      player.removeAttribute("src");
      player.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) { queueMicrotask(() => { if (!cancelled) setWave({ failed: true }); }); return () => { cancelled = true; }; }
    const context = new Context();
    const close = () => { if (context.state !== "closed") void context.close().catch(() => undefined); };
    void file.arrayBuffer()
      .then(buffer => context.decodeAudioData(buffer))
      .then(decoded => {
        if (cancelled) return;
        const peaks = waveformPeaks(decoded.getChannelData(0));
        setWave(peaks.length ? { peaks } : { failed: true });
      })
      .catch(() => { if (!cancelled) setWave({ failed: true }); })
      .finally(close);
    // 파일이 바뀌거나 화면에서 빠지면 결과를 버리고 디코딩 맥락을 닫는다(큰 파일의 늦은 디코딩이 새 파일 화면에 남지 않게).
    return () => { cancelled = true; close(); };
  }, [file]);

  const current = wave;
  const ready = playback.kind === "ready";
  const duration = ready ? playback.duration : 0;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  async function toggle() {
    const player = audio.current;
    if (!player || !ready) return;
    if (!player.paused) { player.pause(); return; }
    try { await player.play(); setStatus(""); }
    catch { setStatus("이 브라우저에서 이 파일을 재생하지 못했어요."); }
  }

  return <section className={styles.wave} aria-labelledby={`${id}-name`}>
    <audio ref={audio} preload="metadata"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
      onLoadedMetadata={event => {
        const length = event.currentTarget.duration;
        setPlayback(Number.isFinite(length) && length > 0 ? { kind: "ready", duration: length } : { kind: "failed" });
      }}
      onError={() => { setPlayback({ kind: "failed" }); setPlaying(false); setTime(0); }}
      onVolumeChange={event => setMuted(event.currentTarget.muted)} />
    <div className={styles.head}>
      <h4 id={`${id}-name`}>{file.name}</h4>
      <span className={styles.time} aria-label={ready ? `재생 위치 ${clock(time)}, 전체 ${clock(duration)}` : "재생 위치 확인 전"}>{ready ? `${clock(time)} / ${clock(duration)}` : "–:– / –:–"}</span>
    </div>
    <div className={styles.track} style={{ "--progress": `${progress * 100}%` } as CSSProperties}>
      <div className={styles.bars} aria-hidden="true">
        {current && "peaks" in current
          ? current.peaks.map((peak, index) => <span key={index} data-played={(index + 0.5) / current.peaks.length <= progress || undefined} style={{ blockSize: `${Math.round(peak * 100)}%` }} />)
          : <span className={styles.placeholder}>{current ? "" : file.size > LARGE ? "큰 파일이라 파형을 그리는 데 시간이 걸릴 수 있어요…" : "파형을 그리는 중…"}</span>}
      </div>
      <input type="range" className={styles.seek} aria-label="재생 위치" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)}
        disabled={!ready} aria-valuetext={`${clock(time)} / ${clock(duration)}`}
        onChange={event => { const player = audio.current; const next = Number(event.target.value); if (player) player.currentTime = next; setTime(next); }} />
    </div>
    <div className={styles.controls}>
      <Button type="button" size="sm" disabled={!ready} onClick={() => void toggle()}>{playing ? "일시정지" : "재생"}</Button>
      <Button type="button" size="sm" variant="secondary" disabled={!ready} onClick={() => { const player = audio.current; if (player) { player.currentTime = 0; setTime(0); } }}>처음으로</Button>
      <Button type="button" size="sm" variant="secondary" disabled={!ready} aria-pressed={muted} onClick={() => { const player = audio.current; if (player) player.muted = !player.muted; }}>{muted ? "소리 켜기" : "음소거"}</Button>
    </div>
    <p className={styles.note}>{current && "failed" in current
      ? `이 파일의 파형을 그리지 못했어요(브라우저 디코딩·메모리 한계).${ready ? " 재생과 위치 이동은 그대로 쓸 수 있어요." : ""}`
      : "파형은 브라우저가 이 파일을 디코딩해 구간별 평균 세기로 그린 값이에요."}</p>
    {playback.kind === "failed" && <p className={styles.note}>이 브라우저에서 이 파일을 재생할 수 없어요. 분석은 따로 실행할 수 있어요.</p>}
    <p role="status" className={styles.note}>{status}</p>
  </section>;
}
