import {
  ADMIN_AUDIO_ANALYSIS_URI, ADMIN_AUDIO_MODE_HEADER, adminAudioResponseSchema, type AdminAudioMode, type AdminAudioResponse,
} from "@/lib/reference-analysis/admin-audio-contract";
import {
  ADMIN_AUDIO_REPORT_PROFILE_HEADER, ADMIN_AUDIO_REPORT_VERSION_HEADER, detailedAudioResponseSchema, EXPANDED_AUDIO_REPORT_PROFILE,
  type DetailedAudioResponse,
} from "@/lib/reference-analysis/admin-audio-details-contract";
import {
  MUSIC_EXTERNAL_CONSENT_HEADER, MUSIC_MODEL_VERSION_HEADER, MUSIC_SEMANTIC_URI, musicSemanticAvailabilitySchema, musicSemanticResultSchema,
  type MusicSemanticResult,
} from "@/lib/reference-analysis/music-semantic-contract";

type RequestProblem = { kind: "failed"; message: string };
type Availability = { kind: "ok"; configured: boolean } | RequestProblem;
type Analysis = { kind: "ok"; result: MusicSemanticResult } | RequestProblem;
type AudioAnalysis = { kind: "ok"; result: AdminAudioResponse } | RequestProblem;
type DetailedAnalysis = { kind: "ok"; result: DetailedAudioResponse } | RequestProblem;

const problems: Record<number, string> = {
  400: "파일과 외부 전송 동의를 확인해 주세요.",
  401: "다시 로그인한 뒤 시도해 주세요.",
  403: "관리자 권한과 현재 사이트에서 보낸 요청인지 확인해 주세요.",
  413: "음악 파일은 4 MiB까지 분석할 수 있어요.",
  415: "파일 전송 형식을 확인하지 못했어요. 화면을 새로 고친 뒤 다시 시도해 주세요.",
  422: "음악 파일을 읽지 못했어요. 파일 형식과 내용을 확인해 주세요.",
  429: "다른 오디오 분석이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.",
  503: "현재 분석 서비스에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.",
};
const failed = (status?: number): RequestProblem => ({ kind: "failed", message: problems[status ?? 0] ?? "응답을 확인하지 못했어요. 다시 시도해 주세요." });
// P1-07 A-2(3580c96): 503 {error:"media_unavailable"}은 서버의 오디오 검사 도구(FFprobe·FFmpeg)를 준비하지 못한 것이다. Gemini로 보내기 전에 멈춘다.
export const MEDIA_UNAVAILABLE_MESSAGE = "서버의 오디오 검사 도구를 준비하지 못해 분석하지 못했어요. Gemini로 보내지 않았어요. 서버 준비를 확인한 뒤 다시 시도해 주세요.";
async function rejected(response: Response): Promise<RequestProblem> {
  if (response.status === 503) {
    const body: unknown = await response.json().catch(() => undefined);
    if (body && typeof body === "object" && "error" in body && body.error === "media_unavailable") return { kind: "failed", message: MEDIA_UNAVAILABLE_MESSAGE };
  }
  return failed(response.status);
}

export function createAdminMusicSemanticClient(send: typeof fetch = (...args) => fetch(...args)) {
  const request = (init: RequestInit) => send(MUSIC_SEMANTIC_URI, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" });
  return {
    async availability(signal?: AbortSignal): Promise<Availability> {
      try {
        const response = await request({ method: "GET", signal });
        if (!response.ok) return failed(response.status);
        return { kind: "ok", configured: musicSemanticAvailabilitySchema.parse(await response.json()).semantic.music === "configured" };
      } catch { return failed(); }
    },
    async analyze(file: File, externalConsent: boolean, signal?: AbortSignal): Promise<Analysis> {
      if (!externalConsent) return failed(400);
      try {
        const response = await request({ method: "POST", signal, body: file, headers: {
          "content-type": "application/octet-stream", "x-dream-filename": encodeURIComponent(file.name),
          [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", [MUSIC_MODEL_VERSION_HEADER]: "1",
        } });
        if (!response.ok) return rejected(response);
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("semantic" in body)) return failed();
        return { kind: "ok", result: musicSemanticResultSchema.parse(body.semantic) };
      } catch { return failed(); }
    },
    // P1-07 자동·음성(Backend 0e511a0 계약): 같은 파일 본문·동의 머리글에 모드 머리글을 더해 새 경로로 보낸다. 음악 모드는 위 analyze를 그대로 쓴다.
    async analyzeAudio(file: File, mode: Exclude<AdminAudioMode, "music">, externalConsent: boolean, signal?: AbortSignal): Promise<AudioAnalysis> {
      if (!externalConsent) return failed(400);
      try {
        const response = await send(ADMIN_AUDIO_ANALYSIS_URI, { method: "POST", signal, body: file, credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { "content-type": "application/octet-stream", "x-dream-filename": encodeURIComponent(file.name),
            [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", [MUSIC_MODEL_VERSION_HEADER]: "1", [ADMIN_AUDIO_MODE_HEADER]: mode } });
        if (!response.ok) return rejected(response);
        const result = adminAudioResponseSchema.parse(await response.json());
        // 다른 모드의 응답은 받지 않는다(늦은 응답·잘못된 응답 방지).
        return result.requestedMode === mode ? { kind: "ok", result } : failed();
      } catch { return failed(); }
    },
    // P1-07 상세(v2, d35eea5 계약): 사용자가 상세 보고서를 고른 경우에만 같은 경로에 x-dream-audio-report-version: 2를 붙인다.
    // A-3(B-2 7e7a264): 새 상세 요청은 x-dream-audio-report-profile: expanded도 함께 보낸다(선택 항목 additionalFindings).
    // 음악 모드도 이 경로로 보낸다. 받은 응답이 v2가 아니거나 다른 모드면 받지 않는다.
    async analyzeDetailed(file: File, mode: AdminAudioMode, externalConsent: boolean, signal?: AbortSignal): Promise<DetailedAnalysis> {
      if (!externalConsent) return failed(400);
      try {
        const response = await send(ADMIN_AUDIO_ANALYSIS_URI, { method: "POST", signal, body: file, credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { "content-type": "application/octet-stream", "x-dream-filename": encodeURIComponent(file.name),
            [MUSIC_EXTERNAL_CONSENT_HEADER]: "true", [MUSIC_MODEL_VERSION_HEADER]: "1", [ADMIN_AUDIO_MODE_HEADER]: mode, [ADMIN_AUDIO_REPORT_VERSION_HEADER]: "2",
            [ADMIN_AUDIO_REPORT_PROFILE_HEADER]: EXPANDED_AUDIO_REPORT_PROFILE } });
        if (!response.ok) return rejected(response);
        const result = detailedAudioResponseSchema.parse(await response.json());
        return result.requestedMode === mode ? { kind: "ok", result } : failed();
      } catch { return failed(); }
    },
  };
}
export type AdminMusicSemanticClient = ReturnType<typeof createAdminMusicSemanticClient>;
