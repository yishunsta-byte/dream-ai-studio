type MediaUrlErrorCode = "invalid_url" | "unsupported_origin" | "unsupported_format" | "too_large";

export class MediaUrlError extends Error {
  constructor(readonly code: MediaUrlErrorCode, message: string) { super(message); }
}
