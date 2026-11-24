import { studioAnalysisResultSchema } from "@/lib/reference-analysis/studio-analysis-result-dto";
import type { RegisteredAnalysisProvider, RegisteredAnalysisResult } from "./studio-registered-analysis";

type Unavailable = Extract<RegisteredAnalysisResult, { status: "unavailable" }>;
// status는 선택 값이다. 없는 기존 주입 수단은 이전처럼 ok만 본다.
type TransportResponse = Pick<Response, "ok" | "json"> & { status?: number; body?: Pick<ReadableStream, "cancel"> | null };
type Transport = (uri: string, init: RequestInit) => Promise<TransportResponse>;
type Options = Readonly<{
  materials: RegisteredAnalysisProvider["materials"];
  uri: string;
  transport: Transport;
  timeoutMs: number;
  /**
   * 분석 POST가 401(로그인 없음)·403(허용 밖)으로 거절되면 결과를 돌려주기 전에 한 번 알린다(시간 초과·취소 뒤에는 알리지 않는다).
   * 결과 DTO는 바꾸지 않는다: 반환값은 이전과 같은 analysis_unavailable이고, 화면 상태 전환은 호출자가 맡는다.
   */
  onDenied?: (status: 401 | 403) => void;
}>;

function unavailable(reason: Unavailable["reason"]): Unavailable {
  return { schemaVersion: 1, status: "unavailable", reason };
}

function discardUnreadBody(response: TransportResponse) {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Injected transports may throw synchronously while cancelling an unread body.
  }
}

export function createStudioRegisteredAnalysisProvider({ materials, uri, transport, timeoutMs, onDenied }: Options): RegisteredAnalysisProvider {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new RangeError("Invalid analysis request timeout");

  return {
    materials,
    async analyze({ projectId, assetId }, callerSignal) {
      if (callerSignal.aborted) return unavailable("analysis_unavailable");
      const request = new AbortController();
      const deadline = performance.now() + timeoutMs;
      let interruption: Unavailable | undefined;
      let resolveInterruption!: (result: Unavailable) => void;
      const interrupted = new Promise<Unavailable>((resolve) => { resolveInterruption = resolve; });

      function stop(reason: "analysis_unavailable" | "timed_out") {
        if (interruption) return interruption;
        interruption = unavailable(reason);
        resolveInterruption(interruption);
        request.abort();
        return interruption;
      }

      function checkDeadline() {
        return interruption ?? (performance.now() >= deadline ? stop("timed_out") : undefined);
      }

      const cancel = () => checkDeadline() ?? stop("analysis_unavailable");
      callerSignal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => stop("timed_out"), timeoutMs);

      async function readResponse(): Promise<RegisteredAnalysisResult> {
        try {
          const response = await transport(uri, {
            method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, assetId }), signal: request.signal,
            cache: "no-store", credentials: "same-origin", redirect: "error",
          });
          const beforeBody = checkDeadline();
          if (beforeBody || !response.ok) {
            const denied = !beforeBody && (response.status === 401 || response.status === 403) ? response.status : undefined;
            const failure = beforeBody ?? stop("analysis_unavailable");
            if (denied && !callerSignal.aborted) onDenied?.(denied);
            discardUnreadBody(response);
            return failure;
          }
          const body: unknown = await response.json();
          const afterBody = checkDeadline();
          if (afterBody) return afterBody;
          const result = studioAnalysisResultSchema.safeParse(body);
          return checkDeadline() ?? (result.success ? result.data : unavailable("analysis_unavailable"));
        } catch {
          return checkDeadline() ?? unavailable("analysis_unavailable");
        }
      }

      try {
        return await Promise.race([interrupted, readResponse()]);
      } finally {
        clearTimeout(timer);
        callerSignal.removeEventListener("abort", cancel);
      }
    },
  };
}
