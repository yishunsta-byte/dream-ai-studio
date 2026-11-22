import "server-only";

import { z } from "zod";
import { readBounded } from "./read-bounded-body";

type YouTubeStage = "search" | "videos" | "channels" | "commentThreads" | "videoCategories";
export type YouTubeDataAccess = {
  key: string;
  signal: AbortSignal;
  stillCurrent: () => Promise<boolean>;
  send: typeof fetch;
};

type ProviderFailure = "quota_exceeded" | "invalid_key" | "provider_error" | "timed_out" | "comments_unavailable";
export class YouTubeDataError extends Error {
  constructor(readonly code: ProviderFailure | "stale") { super(code); }
}

const failureBody = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string() })).optional(),
    details: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});
const quotaReasons = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded",
  "dailyLimitExceededUnreg", "RESOURCE_EXHAUSTED"]);
const keyReasons = new Set(["keyInvalid", "API_KEY_INVALID", "accessNotConfigured", "SERVICE_DISABLED",
  "ipRefererBlocked", "forbidden", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED"]);

function failure(stage: YouTubeStage, status: number, body: unknown): ProviderFailure {
  const decoded = failureBody.safeParse(body);
  const details = decoded.success ? decoded.data.error : undefined;
  const reasons = [...(details?.errors ?? []), ...(details?.details ?? [])].flatMap(item => item.reason ?? []);
  if (stage === "commentThreads" && reasons.some(reason => reason === "commentsDisabled" || reason === "commentThreadNotFound")) {
    return "comments_unavailable";
  }
  if (status === 429 || reasons.some(reason => quotaReasons.has(reason))) return "quota_exceeded";
  if (status === 401 || reasons.some(reason => keyReasons.has(reason))) return "invalid_key";
  return "provider_error";
}

export function publicCount(value: string | undefined): number | null {
  if (!value || !/^\d{1,16}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function durationSeconds(raw: string | undefined): number | null {
  const match = raw?.match(/^P(?:(\d{1,5})D)?(?:T(?:(\d{1,5})H)?(?:(\d{1,5})M)?(?:(\d{1,5})S)?)?$/);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const [, days, hours, minutes, seconds] = match;
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

export function createYouTubeDataCaller({ key, signal, stillCurrent, send }: YouTubeDataAccess) {
  return async function call<T extends z.ZodType>(stage: YouTubeStage, params: Record<string, string>, schema: T): Promise<z.output<T>> {
    if (signal.aborted) throw new YouTubeDataError("timed_out");
    if (!await stillCurrent()) throw new YouTubeDataError("stale");
    const url = new URL("https://www.googleapis.com/youtube/v3/" + stage);
    url.search = new URLSearchParams(params).toString();
    try {
      signal.throwIfAborted();
      const response = await send(url, {
        method: "GET", headers: { "x-goog-api-key": key }, cache: "no-store",
        redirect: "error", credentials: "omit", signal,
      });
      const raw = await readBounded(response.body, 512 * 1024, signal);
      if (!raw) throw new YouTubeDataError("provider_error");
      let body: unknown;
      try { body = JSON.parse(raw.toString("utf8")); }
      catch { throw new YouTubeDataError(failure(stage, response.status, undefined)); }
      if (!response.ok) throw new YouTubeDataError(failure(stage, response.status, body));
      if (raw.includes(key)) throw new YouTubeDataError("provider_error");
      return schema.parse(body);
    } catch (error) {
      if (signal.aborted) throw new YouTubeDataError("timed_out");
      if (error instanceof YouTubeDataError) throw error;
      throw new YouTubeDataError("provider_error");
    }
  };
}
