type MediaUrlErrorCode = "invalid_url" | "unsupported_origin" | "unsupported_format" | "too_large";

export class MediaUrlError extends Error {
  constructor(readonly code: MediaUrlErrorCode, message: string) { super(message); }
}

/** 분석이 어느 단계에서 멈췄는지(운영 진단용). URL·경로·서버 메시지는 담지 않는다. */
export type AnalysisStage = "fetch" | "download" | "inspect" | "proposals";
export class AnalysisStageError extends Error {
  constructor(readonly stage: AnalysisStage, readonly detail: string) { super(`${stage}:${detail}`); }
}
/** 오류 이름만 안전한 진단 값으로 줄인다(영문·숫자·밑줄, 40자). */
export const errorKind = (error: unknown) =>
  String((error as { name?: unknown } | null)?.name ?? typeof error).replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "unknown";
