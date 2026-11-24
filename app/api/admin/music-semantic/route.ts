import { currentGeminiSettings } from "@/lib/reference-analysis/analysis-gemini-settings";
import { createMusicSemanticHttp, musicProviderFromSettings } from "@/lib/reference-analysis/music-semantic-server";

export const runtime = "nodejs";
// Direct FLAC verification runs before the existing provider deadline.
// 오디오 시간 초과 조치(2026-11-24 운영 실측): 3분 16초 곡 상세 분석이 50초 상한에 걸려 '응답 시간이 길어졌어요'로 끝났다.
// 원본 키트 v1.01처럼 함수 한도 300초 안에서 모델을 충분히 기다린다(admin-audio-details-server·admin-audio-gemini 대기 시간과 짝).
export const maxDuration = 300;

const handlers = createMusicSemanticHttp({
  async provider(owner) {
    const settings = await currentGeminiSettings(owner, "music");
    return settings && musicProviderFromSettings(settings);
  },
});
export const GET = handlers.get;
export const POST = handlers.post;
