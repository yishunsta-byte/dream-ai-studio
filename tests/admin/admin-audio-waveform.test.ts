import { describe, expect, it } from "vitest";
import { clock, waveformPeaks } from "@/components/admin/admin-audio-waveform";

describe("오디오 파형 계산", () => {
  it("구간별 평균 세기를 가장 큰 구간 기준으로 맞추고 최소 높이를 둔다", () => {
    const channel = new Float32Array(400);
    channel.fill(0.5, 0, 100); channel.fill(-1, 300, 400);
    const peaks = waveformPeaks(channel, 4);
    expect(peaks).toEqual([0.5, 0.08, 0.08, 1]);
  });
  it("소리가 없거나 너무 짧으면 평평하거나 비운다", () => {
    expect(waveformPeaks(new Float32Array(8), 4)).toEqual([0.08, 0.08, 0.08, 0.08]);
    expect(waveformPeaks(new Float32Array(3), 4)).toEqual([]);
  });
  it("시간을 분:초로 쓴다", () => {
    expect([clock(0), clock(2.4), clock(65), clock(Number.NaN), clock(-1)]).toEqual(["0:00", "0:02", "1:05", "0:00", "0:00"]);
  });
});
