import {
  MUSIC_EXTERNAL_CONSENT_HEADER, MUSIC_SEMANTIC_URI, musicSemanticAvailabilitySchema, musicSemanticResultSchema,
  type MusicSemanticResult,
} from "@/lib/reference-analysis/music-semantic-contract";

type RequestProblem = { kind: "failed"; message: string };
type Availability = { kind: "ok"; configured: boolean } | RequestProblem;
type Analysis = { kind: "ok"; result: MusicSemanticResult } | RequestProblem;

const problems: Record<number, string> = {
  400: "파일과 외부 전송 동의를 확인해 주세요.",
  401: "다시 로그인한 뒤 시도해 주세요.",
  403: "관리자 권한과 현재 사이트에서 보낸 요청인지 확인해 주세요.",
  413: "음악 파일은 4 MiB까지 분석할 수 있어요.",
  422: "음악 파일을 읽지 못했어요. 파일 형식과 내용을 확인해 주세요.",
  429: "다른 음악 분석이 진행 중이에요. 잠시 뒤 다시 시도해 주세요.",
};
const failed = (status?: number): RequestProblem => ({ kind: "failed", message: problems[status ?? 0] ?? "응답을 확인하지 못했어요. 다시 시도해 주세요." });

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
          [MUSIC_EXTERNAL_CONSENT_HEADER]: "true",
        } });
        if (!response.ok) return failed(response.status);
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("semantic" in body)) return failed();
        return { kind: "ok", result: musicSemanticResultSchema.parse(body.semantic) };
      } catch { return failed(); }
    },
  };
}
export type AdminMusicSemanticClient = ReturnType<typeof createAdminMusicSemanticClient>;
