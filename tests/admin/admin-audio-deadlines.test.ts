// 오디오 시간 초과 조치: 모델 대기 시간과 서버 단계 시간을 더해도 각 경로의 함수 한도(maxDuration) 안에 들어와야 한다.
// 한도를 넘으면 Vercel이 함수를 먼저 끊어 화면이 결과도 안내도 받지 못한다.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { detailedAudioDeadlineMs } from "@/lib/reference-analysis/admin-audio-details-server";
import { audioProviderDeadlineMs } from "@/lib/reference-analysis/admin-audio-gemini";
import { inlineAudioProbeDeadlineMs } from "@/lib/reference-analysis/admin-audio-media";

const routeSeconds = (path: string) => Number(/export const maxDuration = (\d+);/.exec(readFileSync(path, "utf8"))?.[1]);
const bodyReadMs = 10_000;
const providerPreparationMs = 50_000;

describe("audio deadlines fit inside the route limits", () => {
  it("gives long songs enough model time, like the original kit", () => {
    expect(detailedAudioDeadlineMs).toBeGreaterThanOrEqual(180_000);
    expect(audioProviderDeadlineMs).toBeGreaterThanOrEqual(90_000);
  });

  it("keeps direct analysis, music analysis and large uploads within their function limits", () => {
    const direct = routeSeconds("app/api/admin/audio-analysis/route.ts") * 1000;
    expect(bodyReadMs + inlineAudioProbeDeadlineMs + detailedAudioDeadlineMs).toBeLessThan(direct);
    expect(bodyReadMs + inlineAudioProbeDeadlineMs + audioProviderDeadlineMs).toBeLessThan(direct);
    expect(bodyReadMs + inlineAudioProbeDeadlineMs + audioProviderDeadlineMs)
      .toBeLessThan(routeSeconds("app/api/admin/music-semantic/route.ts") * 1000);
    expect(22_000 + providerPreparationMs + detailedAudioDeadlineMs).toBeLessThan(routeSeconds("app/api/admin/audio-uploads/[id]/route.ts") * 1000);
    for (const path of ["app/api/admin/audio-analysis/route.ts", "app/api/admin/music-semantic/route.ts", "app/api/admin/audio-uploads/[id]/route.ts"]) {
      expect(routeSeconds(path)).toBeLessThanOrEqual(300);
    }
  });
});
