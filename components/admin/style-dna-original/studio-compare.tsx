"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { StyleDnaComparison } from "@/lib/reference-analysis/style-dna-contract";
import {
  averageDiff, bestTrendIndex, colorDiffPercent, containPoint, defaultSplit, percentAt, percentForKey, promptPreview, sparklinePoints, sparklineXY,
  splitClip, spotChange, toHex, type RGB, type SplitMode,
} from "./compare-math";
import c from "./studio-compare.module.css";

// P1-06 3단계 원본(v1.39 components/dna/CompareSlider.tsx) 비교 슬라이더. 같은 틀에 원본·생성을 겹쳐 선을 끌어 비교하고(좌우/위아래),
// 동그라미 자리의 원본·생성 색(5×5 평균)과 차이를 보여 주며, 점검 지점을 8곳까지 모아 보관함에 저장하고, 저장 지점의 이전→지금 차이와 추세(최근 20회)를 본다.
// 제품 차이: 저장·추세는 서버(e440d72·3fae275)가 저장된 원본·결과에서 다시 잰 값이고(원본은 브라우저 값), 추세 기록은 작업실이 새 결과를 받을 때 한다(과거 기록 열기로는 안 함).
// 회차 패널의 외부 링크(이미지 스튜디오·바나나 캔버스)는 원본 키트에서도 숨겨져 있어 넣지 않는다. 접근성: 슬라이더에 원본·생성 비율 문구(aria-valuetext).
type Pixels = { data: Uint8ClampedArray; w: number; h: number; natW: number; natH: number };
/** 픽셀 읽기 상태(CMD-20261125-014): 읽는 중·준비됨·실패를 나눈다. 주소가 바뀌면 그 주소의 결과가 올 때까지 '읽는 중'이고 이전 픽셀을 쓰지 않는다. */
type PixelState = { status: "loading" } | { status: "failed" } | { status: "ready"; px: Pixels };
const LOADING: PixelState = { status: "loading" };
const MAX_SPOTS = 8;

/** 색 집게용: 이미지를 최대 1024px로 줄여 픽셀을 한 번 읽어 둔다(서버 측정과 같은 크기). */
function usePixels(src: string): PixelState {
  const [state, setState] = useState<{ src: string; value: PixelState } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    const fail = () => { if (!cancelled) setState({ src, value: { status: "failed" } }); };
    img.onerror = fail;
    img.onload = () => {
      if (cancelled) return;
      if (!img.naturalWidth || !img.naturalHeight) return fail();
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return fail();
      ctx.drawImage(img, 0, 0, w, h);
      try { setState({ src, value: { status: "ready", px: { data: ctx.getImageData(0, 0, w, h).data, w, h, natW: img.naturalWidth, natH: img.naturalHeight } } }); }
      catch { fail(); /* 읽을 수 없는 이미지(교차 출처 등) */ }
    };
    img.src = src;
    return () => { cancelled = true; img.onload = null; img.onerror = null; };
  }, [src]);
  return state?.src === src ? state.value : LOADING;
}

/** 틀 안 위치의 색(주변 5×5 평균). 그림 밖 여백이면 null */
function pick(px: Pixels | null, frameW: number, frameH: number, xPct: number, yPct: number): RGB | null {
  if (!px) return null;
  const p = containPoint(frameW, frameH, px.natW, px.natH, xPct, yPct);
  if (!p) return null;
  const cx = Math.floor((p.x * px.w) / px.natW);
  const cy = Math.floor((p.y * px.h) / px.natH);
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= px.w || y >= px.h) continue;
    const i = (y * px.w + x) * 4;
    r += px.data[i]; g += px.data[i + 1]; b += px.data[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

function Swatch({ label, rgb }: { label: string; rgb: RGB | null }) {
  const hex = rgb ? toHex(...rgb) : null;
  return <div className={c.swatch}>
    <span className={hex ? undefined : c.empty} style={hex ? { background: hex } : undefined} aria-hidden />
    <div><p>{label}</p><p className={c.hex}>{hex ?? "—"}</p></div>
  </div>;
}

/** 변화 표시 — 줄면 좋아짐(↓), 늘면 나빠짐(↑), 0.5%p 안쪽은 같음 */
function TrendMark({ trend, delta }: { trend: "better" | "worse" | "same"; delta: number }) {
  return <span data-trend={trend} className={`${c.mark} ${c[trend]}`}>{trend === "better" ? "↓" : trend === "worse" ? "↑" : "="} {Math.abs(delta)}%p</span>;
}

type Spot = { id: number; x: number; y: number; a: RGB | null; b: RGB | null };
export type CompareProps = {
  before: string; after: string; label: string; maxHeight?: number; comparison?: StyleDnaComparison;
  /** 점검 지점 저장(서버가 다시 잰다). 결과 문구를 돌려준다. 없으면 저장 단추를 숨긴다. */
  onSaveSpots?: (spots: { x: number; y: number }[], frame: { width: number; height: number }) => Promise<string>;
  onLoadPrompt?: (prompt: string, round: number) => void;
  when: (iso: string) => string;
};

export function StudioCompare({ before, after, label, maxHeight = 640, comparison, onSaveSpots, onLoadPrompt, when }: CompareProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [posY, setPosY] = useState(50);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<SplitMode | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const nextId = useRef(1);
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickedTrend, setPickedTrend] = useState<number | null>(null);
  const noteId = `${useId()}-pixels`;
  const beforeState = usePixels(before);
  const afterState = usePixels(after);
  const beforePx = beforeState.status === "ready" ? beforeState.px : null;
  const afterPx = afterState.status === "ready" ? afterState.px : null;
  // 지점 저장·불러오기는 두 이미지의 픽셀과 크기가 있는 틀이 모두 준비된 뒤에만(준비 전 '—'가 지점에 고정되던 문제). 준비 뒤의 '—'는 실제 여백이다.
  const pixelsFailed = beforeState.status === "failed" || afterState.status === "failed";
  const pixelsReady = !!beforePx && !!afterPx && !!frame && frame.w > 0 && frame.h > 0;
  const split: SplitMode = mode ?? (size ? defaultSplit(size.w, size.h) : "horizontal");
  const savedSpots = comparison?.spots ?? [];
  const trend = comparison?.trends ?? [];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const moveTo = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos(percentAt(clientX, r.left, r.width));
    setPosY(percentAt(clientY, r.top, r.height));
  };
  const a = frame ? pick(beforePx, frame.w, frame.h, pos, posY) : null;
  const b = frame ? pick(afterPx, frame.w, frame.h, pos, posY) : null;
  const diffOf = (x: RGB | null, y: RGB | null) => (x && y ? colorDiffPercent(x, y) : null);
  const avg = averageDiff(spots.map((s) => diffOf(s.a, s.b)));
  const nowDiff = diffOf(a, b);
  const compared = frame ? savedSpots.map((sp) => {
    const now = diffOf(pick(beforePx, frame.w, frame.h, sp.x, sp.y), pick(afterPx, frame.w, frame.h, sp.x, sp.y));
    return { sp, now, change: spotChange(sp.diff, now) };
  }) : [];
  const prevAvg = averageDiff(savedSpots.map((s) => s.diff));
  const nowAvg = averageDiff(compared.map((x) => x.now));
  const avgChange = spotChange(prevAvg, nowAvg);
  const trendValues = trend.map((t) => t.avg);
  const picked = pickedTrend !== null ? trend[pickedTrend] ?? null : null;
  const bestIdx = trendValues.length > 1 ? bestTrendIndex(trendValues) : -1;
  const trendChange = trendValues.length > 1 ? spotChange(trendValues[0], trendValues[trendValues.length - 1]) : null;
  const current = split === "vertical" ? posY : pos;

  const persist = async () => {
    if (!onSaveSpots || !spots.length || !frame) return;
    setSaving(true); setSaveMsg("");
    try { setSaveMsg(await onSaveSpots(spots.map((s) => ({ x: s.x, y: s.y })), { width: Math.max(1, Math.round(frame.w)), height: Math.max(1, Math.round(frame.h)) })); }
    finally { setSaving(false); }
  };
  const loadSaved = () => { if (!pixelsReady || !frame) return; setSpots(savedSpots.map((sp) => ({ id: nextId.current++, x: sp.x, y: sp.y,
    a: pick(beforePx, frame.w, frame.h, sp.x, sp.y), b: pick(afterPx, frame.w, frame.h, sp.x, sp.y) }))); };
  const saveSpot = () => { if (pixelsReady && spots.length < MAX_SPOTS) setSpots((list) => [...list, { id: nextId.current++, x: pos, y: posY, a, b }]); };
  const pixelNote = pixelsReady ? null : pixelsFailed
    ? `${beforeState.status !== "failed" ? "생성" : afterState.status === "failed" ? "원본·생성" : "원본"} 이미지의 색을 읽지 못해 지점을 저장할 수 없어요. 결과를 다시 열어 주세요.`
    : "이미지를 불러오는 중이에요. 원본과 생성 이미지가 모두 준비되면 이 자리를 저장할 수 있어요.";

  return <div className={c.root} aria-label={label} role="group">
    <div className={c.modes}>
      <span>나누기</span>
      {(["horizontal", "vertical"] as const).map((m) => <button key={m} type="button" aria-pressed={split === m} onClick={() => setMode(m)}>
        {m === "horizontal" ? "◧ 좌우" : "⬒ 위아래"}</button>)}
    </div>
    <div ref={box} className={`${c.frame} ${dragging ? c.dragging : ""}`}
      // 틀은 원본 비율 그대로, 최대 높이를 넘지 않게 폭을 줄인다(폭만 꽉 채우면 원본이 가운데에만 작게 보여 같은 자리 비교가 안 됨)
      style={size ? { aspectRatio: `${size.w} / ${size.h}`, maxWidth: `min(100%, ${Math.round((maxHeight * size.w) / size.h)}px)` } : { aspectRatio: "1 / 1", maxWidth: `min(100%, ${maxHeight}px)` }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); moveTo(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (dragging) moveTo(e.clientX, e.clientY); }}
      onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="생성 이미지" draggable={false} />
      <div className={c.clip} style={{ clipPath: splitClip(split, pos, posY) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt="원본 이미지" draggable={false}
          onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setSize({ w: i.naturalWidth, h: i.naturalHeight }); }} />
      </div>
      <span className={c.tagOriginal}>원본</span>
      <span className={`${c.tagResult} ${split === "vertical" ? c.tagBottom : ""}`}>생성</span>
      {split === "vertical" ? <span className={c.lineY} style={{ top: `${posY}%` }} /> : <span className={c.lineX} style={{ left: `${pos}%` }} />}
      {savedSpots.map((s, n) => <span key={`saved-${n}`} data-saved-spot={n + 1} className={c.saved} style={{ left: `${s.x}%`, top: `${s.y}%` }} />)}
      {spots.map((s, n) => <span key={s.id} data-spot={n + 1} className={c.spot} style={{ left: `${s.x}%`, top: `${s.y}%` }}>{n + 1}</span>)}
      <span role="slider" tabIndex={0} aria-label="원본과 생성 이미지 비교 위치" aria-orientation={split} aria-valuemin={0} aria-valuemax={100} aria-valuenow={current}
        aria-valuetext={split === "vertical" ? `위 원본 ${posY}% · 아래 생성 ${Math.round((100 - posY) * 10) / 10}%` : `왼쪽 원본 ${pos}% · 오른쪽 생성 ${Math.round((100 - pos) * 10) / 10}%`}
        className={c.handle} style={{ left: `${pos}%`, top: `${posY}%` }}
        onKeyDown={(e) => {
          // 제품 보완(Design·Tester 53e1c01 관찰): Home/End는 지금 나누기 축의 처음·끝으로(원본은 위아래 모드에서도 가로만 바뀌어 값이 그대로였음). 화살표·Shift는 원본 그대로.
          if (split === "vertical" && (e.key === "Home" || e.key === "End")) { e.preventDefault(); setPosY(e.key === "Home" ? 0 : 100); return; }
          const n = percentForKey(pos, e.key, e.shiftKey);
          if (n !== null) { e.preventDefault(); setPos(n); return; }
          const y = percentForKey(posY, e.key === "ArrowUp" ? "ArrowLeft" : e.key === "ArrowDown" ? "ArrowRight" : "", e.shiftKey);
          if (y !== null) { e.preventDefault(); setPosY(y); return; }
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); saveSpot(); }
        }}>{split === "vertical" ? "⇅" : "⇆"}</span>
    </div>
    <div className={c.panel} aria-label="색 집게">
      <div className={c.picker}>
        <Swatch label="원본 색" rgb={a} />
        <div className={c.center}><p>색 차이</p><p className={c.value}>{nowDiff === null ? "—" : `${nowDiff}%`}</p></div>
        <Swatch label="생성 색" rgb={b} />
      </div>
      <button type="button" className={c.wide} onClick={saveSpot} disabled={!pixelsReady || spots.length >= MAX_SPOTS}
        aria-describedby={pixelNote ? noteId : undefined}>📍 이 자리 저장 ({spots.length}/{MAX_SPOTS})</button>
      {pixelNote && <p id={noteId} className={c.small} role="status" data-pixels={pixelsFailed ? "failed" : "loading"}>{pixelNote}</p>}
    </div>
    {spots.length > 0 && <div className={c.panel} aria-label="점검 지점">
      <div className={c.panelHead}>
        <p>점검 지점 {spots.length}곳 · 평균 차이 <span data-avg>{avg === null ? "—" : `${avg}%`}</span></p>
        <div className={c.links}>
          {onSaveSpots && <button type="button" className={c.sky} onClick={() => void persist()} disabled={saving}>{saving ? "저장 중…" : "💾 보관함에 저장"}</button>}
          <button type="button" className={c.muted} onClick={() => setSpots([])}>모두 지우기</button>
        </div>
      </div>
      <ul className={c.rows}>
        {spots.map((s, n) => { const d = diffOf(s.a, s.b); return <li key={s.id}>
          <span className={c.num}>{n + 1}</span><span className={c.mono}>{s.a ? toHex(...s.a) : "—"}</span><span aria-hidden>→</span>
          <span className={c.mono}>{s.b ? toHex(...s.b) : "—"}</span><span className={c.right}>{d === null ? "—" : `${d}%`}</span>
          <button type="button" aria-label={`${n + 1}번 지점 지우기`} className={c.remove} onClick={() => setSpots((list) => list.filter((x) => x.id !== s.id))}>✕</button>
        </li>; })}
      </ul>
    </div>}
    {saveMsg && <p role="status" className={c.message}>{saveMsg}</p>}
    {savedSpots.length > 0 && <div className={`${c.panel} ${c.previous}`} aria-label="이전 기록과 비교">
      <div className={c.panelHead}>
        <p>이전 기록과 비교 · 평균 <span data-prev-avg>{prevAvg === null ? "—" : `${prevAvg}%`}</span> → <span data-now-avg>{nowAvg === null ? "—" : `${nowAvg}%`}</span>
          {avgChange && <TrendMark trend={avgChange.trend} delta={avgChange.delta} />}</p>
        <button type="button" className={c.sky} onClick={loadSaved} disabled={!pixelsReady}>지점 불러오기</button>
      </div>
      {trendValues.length > 0 && <div className={c.trend} aria-label="추세">
        <svg width="132" height="34" viewBox="0 0 132 34" role="group" aria-label="추세 회차 고르기">
          <polyline points={sparklinePoints(trendValues, 132, 34, 6)} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {sparklineXY(trendValues, 132, 34, 6).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={pickedTrend === i ? 5 : i === bestIdx ? 4.5 : 3.5}
            fill={pickedTrend === i ? "#f59e0b" : i === bestIdx ? "#22c55e" : "#38bdf8"} stroke="#fff" strokeWidth="1" className={c.dot} role="button" tabIndex={0}
            aria-label={`${i + 1}회차 ${trendValues[i]}%`} aria-pressed={pickedTrend === i} data-trend-dot={i + 1}
            onClick={() => setPickedTrend(pickedTrend === i ? null : i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPickedTrend(pickedTrend === i ? null : i); } }} />)}
        </svg>
        <p>추세 {trendValues.length}회 · 처음 <span data-trend-first>{trendValues[0]}%</span> → 최근 <span data-trend-last>{trendValues[trendValues.length - 1]}%</span>
          {trendChange && <TrendMark trend={trendChange.trend} delta={trendChange.delta} />}
          {bestIdx >= 0 && <button type="button" data-trend-best={bestIdx + 1} className={c.best} onClick={() => setPickedTrend(bestIdx)}>
            🏆 최고 기록 {bestIdx + 1}회차 {trendValues[bestIdx]}%</button>}
          <span className={c.small}>선이 올라갈수록 원본 색에 가까워진 것입니다. 점을 누르면 그때 쓴 프롬프트를 보여 드립니다.</span></p>
      </div>}
      {picked && <div className={c.picked} data-trend-picked>
        <b>{(pickedTrend ?? 0) + 1}회차{pickedTrend === bestIdx ? " 🏆" : ""}</b> · {when(picked.at)} · 버전 {picked.revision} · 평균 차이 <b>{picked.avg}%</b> ({picked.n}곳)
        <p className={c.mono}>{picked.prompt ? `「${promptPreview(picked.prompt)}」` : "이 회차는 프롬프트가 기록되지 않았습니다."}</p>
        {picked.prompt && onLoadPrompt && <button type="button" data-load-prompt className={c.sky} onClick={() => onLoadPrompt(picked.prompt!, (pickedTrend ?? 0) + 1)}>
          ✏ 이 프롬프트를 편집 칸으로 불러오기</button>}
      </div>}
      <ul className={c.rows}>
        {compared.map(({ sp, now, change }, n) => <li key={n}>
          <span className={`${c.num} ${c.dashed}`}>{n + 1}</span><span>{comparison ? when(comparison.baseline.at) : ""} 저장</span>
          <span className={`${c.mono} ${c.right}`}>{sp.diff === null ? "—" : `${sp.diff}%`}</span><span aria-hidden>→</span>
          <span className={c.mono}><b>{now === null ? "—" : `${now}%`}</b></span>
          {change ? <TrendMark trend={change.trend} delta={change.delta} /> : <span className={c.mark} />}
        </li>)}
      </ul>
      <p className={c.small}>점선 동그라미가 저장된 자리입니다. 차이가 줄면(↓) 원본 색에 더 가까워진 것입니다.</p>
    </div>}
    <p className={c.help}>틀을 누르거나 끌면 선과 동그라미가 그 자리로 옵니다. 동그라미 자리의 원본·생성 색을 비교하고 「📍 이 자리 저장」(또는 동그라미에서 Enter)으로 여러 곳을 모아 평균 차이를 보세요. 키보드: ←/→ 좌우, ↑/↓ 위아래. 「—」는 그 자리에 그림이 없는 여백입니다.</p>
  </div>;
}

/** 원본 3단계 편집 칸 위 안내: 추세 회차 프롬프트를 불러왔을 때 「되돌리기」(불러오기 전 편집 상태로)와 닫기. */
export function LoadedNotice({ round, onUndo, onClose }: { round: number; onUndo: () => void; onClose: () => void }) {
  return <div className={c.loaded} data-loaded-from={round} role="status">
    <span>추세 {round}회차 프롬프트를 불러왔습니다.</span>
    <span className={c.links}>
      <button type="button" className={c.sky} onClick={onUndo}>되돌리기</button>
      <button type="button" className={c.close} aria-label="안내 닫기" onClick={onClose}>✕</button>
    </span>
  </div>;
}
