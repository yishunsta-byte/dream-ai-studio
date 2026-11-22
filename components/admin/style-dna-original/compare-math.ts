// P1-06 3단계 원본(v1.39) 비교 슬라이더의 순수 계산: src/lib/dna/compare.ts·checkSpots.ts에서 화면에 쓰는 함수만 그대로 옮겼다.
// 점검 지점 저장·추세 기록·프롬프트 보존은 서버(e440d72·3fae275)가 맡으므로 원본의 cleanCheckSpots·cleanTrend·appendTrend는 옮기지 않는다.

export type SplitMode = "horizontal" | "vertical";
export type RGB = [number, number, number];

/** 화면 좌표를 상자 안 비율(0~100, 소수 첫째 자리)로 바꾼다. 상자 밖이면 끝에 붙인다 */
export function percentAt(client: number, start: number, size: number): number {
  if (!(size > 0)) return 50;
  const p = ((client - start) / size) * 100;
  return Math.round(Math.min(100, Math.max(0, p)) * 10) / 10;
}

/** 키보드 이동: ←/→ 2칸, Shift와 함께 10칸, Home/End 끝으로. 해당 키가 아니면 null */
export function percentForKey(current: number, key: string, shift = false): number | null {
  const step = shift ? 10 : 2;
  if (key === "ArrowLeft") return Math.max(0, current - step);
  if (key === "ArrowRight") return Math.min(100, current + step);
  if (key === "Home") return 0;
  if (key === "End") return 100;
  return null;
}

/** 틀 안 비율 위치를, 틀 안에 잘리지 않게 맞춰 그린(object-contain) 이미지의 픽셀 좌표로. 그림이 없는 여백이면 null(서버 측정과 같은 식) */
export function containPoint(frameW: number, frameH: number, imgW: number, imgH: number, xPct: number, yPct: number): { x: number; y: number } | null {
  if (!(frameW > 0 && frameH > 0 && imgW > 0 && imgH > 0)) return null;
  const scale = Math.min(frameW / imgW, frameH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const fx = (xPct / 100) * frameW - (frameW - drawW) / 2;
  const fy = (yPct / 100) * frameH - (frameH - drawH) / 2;
  if (fx < 0 || fy < 0 || fx > drawW || fy > drawH) return null;
  return { x: Math.min(imgW - 1, Math.floor(fx / scale)), y: Math.min(imgH - 1, Math.floor(fy / scale)) };
}

/** RGB → #RRGGBB(대문자) */
export function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** 두 색의 차이(0 = 같음, 100 = 검정↔흰색), 소수 첫째 자리 */
export function colorDiffPercent(a: RGB, b: RGB): number {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return Math.round((d / Math.hypot(255, 255, 255)) * 1000) / 10;
}

/** 원본 쪽을 잘라 낼 clip-path. 가로 분할은 선의 왼쪽, 세로 분할은 선의 위쪽이 원본 */
export function splitClip(mode: SplitMode, pos: number, posY: number): string {
  return mode === "vertical" ? `inset(0 0 ${100 - posY}% 0)` : `inset(0 ${100 - pos}% 0 0)`;
}

/** 처음 분할 방식 — 세로가 가로보다 1.2배 이상 길면 위아래로 나눈다 */
export function defaultSplit(w: number, h: number): SplitMode {
  return w > 0 && h >= w * 1.2 ? "vertical" : "horizontal";
}

/** 차이 값들의 평균(소수 첫째 자리). 값이 없으면 null */
export function averageDiff(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

/** 이전 차이 → 지금 차이 변화. 둘 중 하나라도 없으면 null. 0.5%p 안쪽은 같음 */
export function spotChange(prev: number | null, now: number | null): { delta: number; trend: "better" | "worse" | "same" } | null {
  if (prev === null || now === null) return null;
  const delta = Math.round((now - prev) * 10) / 10;
  return { delta, trend: Math.abs(delta) < 0.5 ? "same" : delta < 0 ? "better" : "worse" };
}

/** 작은 꺾은선 그래프 점 좌표. 차이가 클수록 아래, 줄어들수록 위 — 원본에 가까워지면 선이 올라간다 */
export function sparklineXY(values: number[], width: number, height: number, pad = 3): [number, number][] {
  if (!values.length) return [];
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => {
    const x = values.length > 1 ? pad + i * step : width / 2;
    const y = pad + ((v - min) / span) * (height - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
}
export const sparklinePoints = (values: number[], width: number, height: number, pad = 3) =>
  sparklineXY(values, width, height, pad).map(([x, y]) => `${x},${y}`).join(" ");

/** 화면용 프롬프트 미리보기(공백 정리, 120자 + …) */
export function promptPreview(prompt: string): string {
  const one = prompt.replace(/\s+/g, " ").trim();
  return one.length > 120 ? `${one.slice(0, 120)}…` : one;
}

/** 평균 차이가 가장 낮은(원본에 가장 가까운) 회차 — 같으면 최근 회차. 없으면 -1 */
export function bestTrendIndex(values: number[]): number {
  let best = -1;
  values.forEach((v, i) => { if (best < 0 || v <= values[best]) best = i; });
  return best;
}
